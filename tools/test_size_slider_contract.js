'use strict';
// Regression guard for NGWorship v5's song-view sizing controls.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root,name),'utf8');
const html = read('index.html');
const css = read('css/03-song-view.css');
const ui = read('js/ui.js');
const app = read('js/app.js');

function getRange(id) {
  const line = html.split('\n').find(line => line.includes(`id="${id}"`));
  assert(line, `Missing ${id}`);
  const attr = name => Number(line.match(new RegExp(`${name}="([0-9.]+)"`))[1]);
  return {min:attr('min'),max:attr('max'),step:attr('step')};
}
for(const [id, expected] of [
  ['lyrics-size-range',{min:.75,max:1.63,step:.08}],
  ['chords-size-range',{min:.60,max:1.26,step:.06}]
]) {
  const range=getRange(id);
  assert.deepEqual(range,expected,id);
  assert.equal(Math.round((range.max-range.min)/range.step)+1,12,`${id} has 12 positions`);
  assert(Math.abs((range.max-range.min)/range.step-11)<1e-8,`${id} fits exact positions`);
}
for(const args of ['.75, .08, 1.63, 1', '.75, .08, 1.63, -1', '.60, .06, 1.26, 1', '.60, .06, 1.26, -1']) assert(ui.includes(`stepSize(state.${args.startsWith('.75')?'lyricsSize':'chordSize'}, ${args})`),`Chip step mismatch: ${args}`);
assert(app.includes('devSliderDots: false'), 'Developer dots must default off');
assert(css.includes('html[data-slider-dots="true"] .app-range-ticks::-webkit-slider-runnable-track'), 'Only show dots when explicitly enabled');
const dotsSection = css.split('html[data-slider-dots="true"] .app-range-ticks::-webkit-slider-runnable-track')[1].split('.app-range:focus-visible')[0];
assert.equal((dotsSection.match(/radial-gradient\(/g) || []).length,12,'12 guide dots required');
assert(dotsSection.includes('linear-gradient(to right, var(--accent) var(--p), var(--paper-dim) var(--p))'), 'Keep the accent fill when dots are enabled');
assert(dotsSection.includes('background-color: var(--paper-dim)'), 'Ensure a track color fallback');
assert(!/calc\([^)]*\s[+-](?=\S)/.test(dotsSection), 'calc operators must be separated by spaces');
assert(!/calc\([^)]*(?<!\s)[+-]\s/.test(dotsSection), 'calc operators must be separated by spaces');
console.log('Size sliders: 12 stops for lyrics/chords, matching chip increments, faint optional dots, and accent track preserved.');
