'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const app = fs.readFileSync(path.join(__dirname, '../js/app.js'), 'utf8');
const code = app.slice(app.indexOf('function scrollIndexLetter('), app.indexOf('// ---- Squishy thumb physics'));
let rowHeight = 100, columns = 1, header = 0;
const page = { scrollTop: 0, clientHeight: 100, getBoundingClientRect: () => ({ top: 20 }) };
const list = { dataset: { renderSourceKey: 'future' }, children: [] };
const context = { songbookSongSources: new WeakMap(), document: { getElementById: id => id === 'song-list' ? list : id === 'page-songs' ? page : null } };
vm.runInNewContext(code + '\nglobalThis.api = { computeScrollIndexEntries, measureScrollIndexEntries, scrollIndexLetter, labelForScrollTop, setEntries: entries => { scrollIndexEntries = entries; } };', context);
const api = context.api;
let songs;
function install(numbers, cols = 1) {
  columns = cols;
  songs = numbers.map((number, i) => ({ id: 'song' + i, title: 'Song ' + i, number }));
  list.children = songs.map((song, i) => ({
    dataset: { rowKey: `future:${song.id}` }, isConnected: true,
    getBoundingClientRect: () => {
      const top = 20 + header + Math.floor(i / columns) * rowHeight - page.scrollTop;
      return { top, bottom: top + rowHeight };
    },
  }));
  api.setEntries(api.measureScrollIndexEntries(api.computeScrollIndexEntries(songs, 'num', true)));
}
function maxScroll() { return Math.max(0, header + Math.ceil(songs.length / columns) * rowHeight - page.clientHeight); }
function labelAt(scroll) { page.scrollTop = scroll; return api.labelForScrollTop(scroll, maxScroll()); }
function assertVisible(scroll) {
  const label = labelAt(scroll);
  if (label === '__search__') return;
  assert(songs.some((song, i) => {
    const row = list.children[i].getBoundingClientRect();
    return String(song.number) === label && row.bottom > 20 && row.top < 20 + page.clientHeight;
  }), `${label} must identify a song on screen at ${scroll}`);
}
// Printed numbers are data, not zero-based indexes or multiples of ten.
install([7, 19, 104, 901]);
assert.equal(labelAt(0), '7');
assert.equal(labelAt(200), '104');
assert.equal(labelAt(maxScroll()), '901');
install([901, 104, 19, 7]);
assert.equal(labelAt(200), '19');
assert.equal(labelAt(maxScroll()), '7');

// Reproduce stale placeholder measurements: geometry changes after the
// index was built, without another list render. Also exercise resize/fonts.
install(Array.from({ length: 360 }, (_, i) => i + 1));
rowHeight = 56; page.clientHeight = 844;
for (let r = 0; r <= 100; r++) assertVisible(maxScroll() * r / 100);
assert.equal(labelAt(maxScroll()), '360');
rowHeight = 74; page.clientHeight = 390;
for (let r = 0; r <= 100; r++) assertVisible(maxScroll() * r / 100);

// A grid's final viewport must be traversed gradually. Every real song
// number remains reachable, including non-contiguous numbers and reversals.
rowHeight = 80; page.clientHeight = 160;
const sparse = Array.from({ length: 80 }, (_, i) => 101 + i * 13);
for (const numbers of [sparse, sparse.slice().reverse()]) {
  install(numbers, 4);
  const reached = new Set();
  for (let scroll = 0; scroll <= maxScroll(); scroll++) {
    assertVisible(scroll); reached.add(labelAt(scroll));
  }
  assert.equal(reached.size, numbers.length, 'all numbers must be reachable through the grid');
  assert.equal(labelAt(maxScroll()), String(numbers.at(-1)));
}

header = 250;
install(sparse);
assert.equal(labelAt(0), '__search__');
assertVisible(maxScroll() / 2);
assert.equal(labelAt(maxScroll()), String(sparse.at(-1)));
// Hidden-page rendering cannot provide geometry; it must not emit a number.
page.clientHeight = 0;
assert.equal(labelAt(0), '');
page.clientHeight = 160;
assertVisible(maxScroll() / 2);

// Identical-looking letters in different scripts are not interchangeable.
assert.equal(api.scrollIndexLetter('Найз'), 'Н');
assert.equal(api.scrollIndexLetter('Happy'), 'H');
assert.equal(api.scrollIndexLetter(' Өглөө'), 'Ө');
assert.equal(api.scrollIndexLetter('99 songs'), '#');
const alphabet = api.computeScrollIndexEntries([{ id: 'a', title: 'Амин' }, { id: 'b', title: 'Blessed' }], 'alpha', false);
assert.deepEqual(Array.from(alphabet, e => e.label), ['А', 'B']);
console.log('Fast-scroll: exact/sparse/reversed numbers, live geometry, resize, grid reachability, hidden pages and original alphabet PASS');
