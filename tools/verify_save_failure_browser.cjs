// When neither localStorage nor IndexedDB accepts a playlist/label save, the
// person must be told; when at least one works, nothing should be shown.
//   NODE_PATH=$(npm root -g) node tools/verify_save_failure_browser.cjs
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

// Break only the playlist/label storage so the rest of the app still starts.
const breakLocal = `(() => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (/^ngw-(playlists|labels)$/.test(k)) throw new DOMException('full', 'QuotaExceededError'); return set.call(this, k, v); }; })();`;
const breakIdb = `(() => { const open = indexedDB.open.bind(indexedDB); indexedDB.open = function (name, v) { if (/^ngworship-(playlists|labels)-db$/.test(name)) throw new Error('blocked'); return open(name, v); }; })();`;

async function run(label, scripts, expectToast) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  for (const s of scripts) await page.addInitScript(s);
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://localhost:${server.address().port}/`);
  await page.waitForFunction(() => typeof toggleFavorite === 'function' && document.querySelectorAll('#song-list > *').length > 5, null, { timeout: 30000 });
  await page.waitForTimeout(3500); // let the launch screen finish
  const shown = await page.evaluate(async () => {
    const key = state.activeDbSource, song = state.sources[key].songs[0];
    toggleFavorite(key, song.id);
    await new Promise(r => setTimeout(r, 700));
    const el = document.getElementById('toast');
    const msg = document.getElementById('toast-msg').textContent;
    const visible = !!el && !el.hidden && getComputedStyle(el).opacity !== '0' && !el.classList.contains('is-leaving') && msg.length > 0;
    return { msg, visible, expected: t('toastSaveFailed') };
  });
  const isFailure = shown.visible && shown.msg === shown.expected;
  ok(expectToast ? isFailure : !isFailure, `${label}: ${expectToast ? 'tells the person it could not save' : 'stays quiet'} (${shown.visible ? shown.msg : 'no toast'})`);
  ok(errors.length === 0, `${label}: no page errors ${errors.join(' | ')}`);
  await ctx.close();
}

let browser;
(async () => {
  browser = await chromium.launch();
  await run('everything works', [], false);
  await run('only IndexedDB blocked', [breakIdb], false);
  await run('only localStorage full', [breakLocal], false);
  await run('both blocked', [breakLocal, breakIdb], true);
  await browser.close(); server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
