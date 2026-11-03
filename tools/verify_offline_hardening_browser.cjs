// Real Chrome + real service worker, hosted under /ngworship/ like GitHub Pages
// (including its /ngworship -> /ngworship/ redirect).
//   CHROMIUM_EXECUTABLE=... node tools/verify_offline_hardening_browser.cjs
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const PREFIX = '/ngworship';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };
let netDown = false;   // true = connections are dropped, like having no signal
const server = http.createServer((q, r) => {
  if (netDown) { q.socket.destroy(); return; }
  const u = q.url.split('?')[0];
  if (u === PREFIX) { r.writeHead(301, { Location: PREFIX + '/' }); r.end(); return; }
  if (!u.startsWith(PREFIX + '/')) { r.writeHead(404); r.end('not found'); return; }
  let p = decodeURIComponent(u.slice(PREFIX.length)); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(root, p), (e, d) => {
    if (e) { r.writeHead(404); r.end('nf'); return; }
    r.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream', 'cache-control': 'max-age=0' }); r.end(d);
  });
}).listen(0);
const base = `http://localhost:${server.address().port}`;
let failures = 0;
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) failures++; };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const pageErrors = [];
  await page.goto(base + PREFIX + '/');

  const cacheCount = () => page.evaluate(async () => {
    let n = 0; for (const k of await caches.keys()) n += (await (await caches.open(k)).keys()).length; return n;
  });
  // Real offline: pages are emulated offline AND the server drops every connection,
  // because Chrome's offline switch does not cover requests made by the service worker itself.
  const goOffline = async (off) => { netDown = off; await ctx.setOffline(off); };
  const waitInstalled = async () => {
    for (let i = 0; i < 160; i++) {
      const st = await page.evaluate(async () => {
        const r = (await navigator.serviceWorker.getRegistrations()).find(x => x.scope.endsWith('/ngworship/'));
        return r ? { a: r.active && r.active.state, i: !!r.installing, w: !!r.waiting } : null;
      }).catch(() => null);
      if (st && st.a === 'activated' && !st.i && !st.w && (await cacheCount().catch(() => 0)) >= 80) return true;
      await page.waitForTimeout(500);
    }
    return false;
  };
  ok(await waitInstalled(), 'worker installed and the full offline copy is cached');

  // ---- offline launches inside the app's scope ------------------------------------------
  const isApp = p => p.evaluate(() => !!document.getElementById('page-songs') || !!document.getElementById('splash-screen'));
  const launch = async (url) => {
    const p = await ctx.newPage();
    try {
      await p.goto(url, { timeout: 20000, waitUntil: 'domcontentloaded' });
      const result = p.url().startsWith('chrome-error') ? 'chrome-error'
        : (await isApp(p)) ? 'app' : 'text:' + (await p.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 80);
      await p.close(); return result;
    } catch (e) { await p.close(); return 'chrome-error'; }
  };
  await goOffline(true);
  for (const [label, u] of [['start address', ''], ['index.html', 'index.html'], ['?utm query', '?utm=share'], ['#hash', '#x'], ['unknown path in scope', 'no/such/page']]) {
    ok(await launch(base + PREFIX + '/' + u) === 'app', `offline launch works: ${label}`);
  }
  await goOffline(false);

  // ---- cache wiped, worker alive, ONLINE: must repair itself -----------------------------
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Storage.clearDataForOrigin', { origin: base, storageTypes: 'cache_storage' });
  ok((await cacheCount()) === 0, 'cache storage wiped (worker registration kept)');
  ok(await launch(base + PREFIX + '/') === 'app', 'online launch with a wiped cache shows the app, not a bare "Offline" page');
  let healed = false;
  for (let i = 0; i < 80 && !healed; i++) { healed = (await cacheCount()) >= 80; if (!healed) await page.waitForTimeout(500); }
  ok(healed, 'the offline copy rebuilt itself in the background');
  await goOffline(true);
  ok(await launch(base + PREFIX + '/') === 'app', 'after the repair, offline launch works again');

  // ---- cache wiped AND offline: a real page, never Chrome's error page --------------------
  await goOffline(false);
  await cdp.send('Storage.clearDataForOrigin', { origin: base, storageTypes: 'cache_storage' });
  await goOffline(true);
  const last = await launch(base + PREFIX + '/');
  ok(last.startsWith('text:') && last.includes('Офлайн'), `wiped cache + offline shows the bilingual fallback page (${last.slice(0, 40)})`);
  await goOffline(false);
  // let the worker finish any repair triggered above before the app checks
  await page.goto(base + PREFIX + '/'); await waitInstalled();

  // ---- manifest identity ---------------------------------------------------------------------
  const manifest = await page.evaluate(async () => (await fetch('manifest.json')).json());
  ok(!('id' in manifest) && manifest.start_url === './', 'manifest has no shared id, so each folder installs as its own app');

  // ---- About page: copyright notice hidden by config --------------------------------------
  await page.evaluate(() => { showPage('about'); });
  await page.waitForTimeout(400);
  const about = await page.evaluate(() => ({
    hidden: document.getElementById('about-copyright').hidden && document.getElementById('about-copyright-terms').hidden,
    shown: ['about-copyright', 'about-copyright-terms'].map(id => { const e = document.getElementById(id); return !!(e.offsetWidth || e.offsetHeight); }),
    text: document.getElementById('about-copyright').textContent + document.getElementById('about-copyright-terms').textContent,
    contact: !!document.getElementById('t-contactBtn') && document.getElementById('t-contactBtn').textContent.length > 0,
  }));
  ok(about.hidden && about.shown.every(v => !v) && about.text === '', 'copyright notice is hidden on the About page');
  ok(about.contact, 'the rest of the About page still renders');

  // ---- error log + Copy diagnostics ----------------------------------------------------------
  await page.evaluate(() => { localStorage.removeItem('ngw_error_log'); });
  await page.evaluate(() => { setTimeout(() => { throw new Error('probe-uncaught'); }, 0); Promise.reject(new Error('probe-rejection')); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { showPage('settings'); });
  await page.waitForTimeout(300);
  const diag = await page.evaluate(async () => {
    document.getElementById('dev-diag-btn').click();
    await new Promise(r => setTimeout(r, 800));
    return navigator.clipboard.readText();
  });
  ok(/^Version: v?5\./.test(diag), 'diagnostics: version line');
  ok(/Service worker: activated; controlling this page: true/.test(diag), 'diagnostics: worker state');
  ok(/Offline cache: songbook-v5\.[^\n]*= \d+ files/.test(diag), 'diagnostics: cache size');
  ok(/Storage protected from cleanup: (true|false)/.test(diag), 'diagnostics: storage protection');
  ok(/probe-uncaught/.test(diag) && /probe-rejection/.test(diag), 'diagnostics: recent errors were recorded and listed');
  const btnLabel = await page.evaluate(() => document.getElementById('dev-diag-btn').textContent);
  ok(btnLabel.length > 0, `diagnostics button has a label ("${btnLabel}")`);

  await browser.close(); server.close();
  console.log(failures ? `FAILURES: ${failures}` : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
