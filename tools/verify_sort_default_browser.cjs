// Libraries with book numbers must start in number order, and visiting a library
// without numbers (English) must not leave the Songs page stuck on A-Z.
//   CHROMIUM_EXECUTABLE=... node tools/verify_sort_default_browser.cjs [projectRoot]
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(root, p), (e, d) => {
    if (e) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); r.end(d);
  });
}).listen(0);
let failures = 0;
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) failures++; };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://localhost:${server.address().port}/`);
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof applyDbSelection === 'function' && document.getElementById('song-list'));
  await page.locator('#splash-logo').waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});

  // switch library, wait for the list, and describe what the person sees
  const open = async (keys, multi = false) => {
    await page.evaluate(([k, m]) => { state.multiDbSelect = m; applyDbSelection(k); }, [keys, multi]);
    await page.waitForFunction(() => document.querySelectorAll('#song-list > *').length > 5 && !document.querySelector('#song-list .skeleton'), null, { timeout: 30000 });
    await page.waitForTimeout(350);
    return page.evaluate(() => {
      const num = document.querySelector('.sort-btn[data-sort-by="num"]');
      const alpha = document.querySelector('.sort-btn[data-sort-by="alpha"]');
      const badges = [...document.querySelectorAll('#song-list .song-badge')].slice(0, 8).map(b => parseInt(b.textContent, 10));
      return { sortBy: state.sortBy, sortPref: state.sortPref, numHidden: num.hidden, numPressed: num.getAttribute('aria-pressed'),
        alphaPressed: alpha.getAttribute('aria-pressed'), badges,
        ascending: badges.length > 1 && badges.every((v, i) => i === 0 || v >= badges[i - 1]), startsAtOne: badges[0] === 1 };
    });
  };
  const tap = async (sort) => { await page.evaluate(s => document.querySelector(`.sort-btn[data-sort-by="${s}"]`).click(), sort); await page.waitForTimeout(350); };
  const sorted = () => page.evaluate(() => state.sortBy);

  // A. a numbered library starts in number order
  let s = await open(['official']);
  ok(s.sortBy === 'num' && s.numPressed === 'true' && !s.numHidden && s.ascending && s.startsAtOne, `numbered library starts in number order (${s.badges.slice(0, 5)})`);

  // B. a library without numbers is alphabetical and hides the number button
  s = await open(['english']);
  ok(s.sortBy === 'alpha' && s.numHidden, 'English (no numbers): alphabetical, number button hidden');
  ok(s.sortPref === 'num', 'visiting English does not overwrite the preference for numbered libraries');

  // C. the reported bug: coming back must restore number order
  s = await open(['official']);
  ok(s.sortBy === 'num' && s.numPressed === 'true' && s.alphaPressed === 'false' && s.ascending && s.startsAtOne,
    `back on the numbered library: number order again, not stuck on A-Z (${s.badges.slice(0, 5)})`);

  // D. an explicit A-Z choice on a numbered library is respected and survives a trip through English
  await tap('alpha');
  ok((await sorted()) === 'alpha', 'tapping A-Z on a numbered library sorts A-Z');
  await open(['english']); s = await open(['official']);
  ok(s.sortBy === 'alpha' && s.sortPref === 'alpha', 'explicit A-Z choice is kept after visiting English');
  s = await open(['sda']);
  ok(s.sortBy === 'alpha', 'explicit A-Z choice carries to the other numbered library');
  await tap('num');
  ok((await sorted()) === 'num', 'tapping number order switches back');

  // E. tapping A-Z while on a library WITHOUT numbers is not a preference about number order
  await open(['english']); await tap('alpha');
  s = await open(['official']);
  ok(s.sortBy === 'num' && s.sortPref === 'num' && s.startsAtOne, 'A-Z tapped on English does not turn number order off for numbered books');

  // F. mixed selection follows whether any selected library has numbers
  s = await open(['official', 'english'], true);
  const expectNum = await page.evaluate(() => sourceHasSongNumbers(SONGBOOK_SOURCE));
  ok(s.sortBy === (expectNum ? s.sortPref : 'alpha') && s.numHidden === !expectNum, `mixed selection: sort follows numbered=${expectNum}`);
  await page.evaluate(() => { state.multiDbSelect = false; });
  s = await open(['sda']);
  ok(s.sortBy === 'num' && s.startsAtOne, 'single numbered library after a mixed selection starts in number order');

  ok(errors.length === 0, 'no page errors ' + errors.join('|'));
  await browser.close(); server.close();
  console.log(failures ? `FAILURES: ${failures}` : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
