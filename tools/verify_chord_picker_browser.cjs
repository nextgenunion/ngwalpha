// Browser check: the simplified chord chooser shows the chord on every change,
// the note-names setting lives in Developer options, and Clear still works.
//   NODE_PATH=$(npm root -g) node tools/verify_chord_picker_browser.cjs
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(root, p), (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); r.end(d); });
}).listen(0);
let failures = 0;
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) failures++; };
(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })).newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://localhost:${server.address().port}/`);
  await page.waitForFunction(() => typeof showPage === 'function' && document.querySelectorAll('#song-list > *').length > 5, null, { timeout: 30000 });
  await page.evaluate(() => showPage('chord-finder'));
  await page.waitForTimeout(500);

  ok(await page.evaluate(() => !document.querySelector('#page-chord-finder #note-name-select')), 'note names row is gone from the Chord Finder');
  ok(await page.evaluate(() => !!document.querySelector('#page-dev-options #note-name-select')), 'note names row is in Developer options');
  ok(await page.evaluate(() => !document.getElementById('cf-picker-show')), 'no separate Show button');

  await page.click('#cf-picker-toggle');
  await page.selectOption('#cf-picker-root', 'A');
  await page.selectOption('#cf-picker-quality', 'minor');
  const name = await page.evaluate(() => document.getElementById('cf-chord-name').textContent.trim());
  ok(/^Am/.test(name), `choosing A + Minor shows the chord immediately (${name})`);
  ok(await page.evaluate(() => document.getElementById('cf-search-input').value === 'Am'), 'search box follows the choice');
  await page.selectOption('#cf-picker-extra', '7');
  ok(await page.evaluate(() => document.getElementById('cf-search-input').value === 'Am7'), 'extra applies immediately (Am7)');

  await page.click('#cf-clear-btn');
  const cleared = await page.evaluate(() => document.getElementById('cf-chord-name').classList.contains('cf-is-hint'));
  ok(cleared, 'Clear still resets the board');

  // Note names still switch from Developer options.
  await page.evaluate(() => { state.devUnlocked = true; showPage('dev-options'); });
  await page.selectOption('#note-name-select', 'solfege');
  ok(await page.evaluate(() => document.documentElement.getAttribute('data-note-names') === 'solfege' && state.noteNames === 'solfege'), 'note names setting still works from Developer options');

  ok(errors.length === 0, `no page errors ${errors.join(' | ')}`);
  await browser.close(); server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
