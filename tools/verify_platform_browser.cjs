// Proves js/platform.js: the website and PWA behave exactly as before, and a
// native wrapper (Capacitor-style plugins, or a window.NGWorshipNative bridge)
// is used only when present. Run: node tools/verify_platform_browser.cjs
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(root, p), (e, d) => {
    if (e) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); r.end(d);
  });
});

const CAPACITOR = () => {
  window.__calls = [];
  window.Capacitor = {
    isNativePlatform: () => true, getPlatform: () => 'android',
    Plugins: {
      Filesystem: { writeFile: async o => { window.__calls.push(['write', o.path, o.directory, o.encoding]); return { uri: 'file:///cache/' + o.path }; } },
      Share: { share: async o => { window.__calls.push(['share', o.url]); if (window.__cancelShare) throw new Error('Share canceled'); } },
      Browser: { open: async o => { window.__calls.push(['browser', o.url]); } },
    },
  };
};
const BRIDGE = () => {
  window.__calls = [];
  window.NGWorshipNative = {
    saveFile: async o => { window.__calls.push(['bridge-save', o.filename, o.mime]); },
    openExternal: u => { window.__calls.push(['bridge-open', u]); },
  };
};
const STANDALONE = () => {
  const mm = window.matchMedia.bind(window);
  window.matchMedia = q => /display-mode:\s*standalone/.test(q)
    ? { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} } : mm(q);
};

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE });
  const errors = [];
  async function open(init) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block', acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    if (init) await page.addInitScript(init);
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => typeof state !== 'undefined' && state.sources.user.loaded && typeof NGPlatform !== 'undefined');
    await page.locator('#splash-screen').waitFor({ state: 'hidden' });
    await page.evaluate(() => { window.__toasts = []; const t = showToast; window.showToast = (...a) => { window.__toasts.push(a[0]); return t(...a); }; });
    return { ctx, page };
  }
  const styleOf = (page, sel, prop) => page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s))[p], [sel, prop]);

  // 1. Website: nothing native, original download link, install row and selection untouched.
  {
    const { ctx, page } = await open();
    assert.equal(await page.evaluate(() => NGPlatform.kind), 'web');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.platform), 'web');
    const [download] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => exportPlaylists())]);
    assert.equal(download.suggestedFilename(), 'ngworship-playlists.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(await download.path(), 'utf8')), await page.evaluate(() => state.playlists));
    assert.notEqual(await styleOf(page, '#install-row', 'display'), 'none');
    assert.notEqual(await styleOf(page, 'body', 'userSelect'), 'none');
    assert.equal(await page.evaluate(() => NGPlatform.isNative), false);
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
    assert.equal(await styleOf(page, '#install-row', 'display'), 'none');
    await ctx.close(); console.log('PASS website: download link, install row and text selection unchanged');
  }
  // 2. Installed PWA: still web behaviour, flagged as pwa.
  {
    const { ctx, page } = await open(STANDALONE);
    assert.equal(await page.evaluate(() => NGPlatform.kind), 'pwa');
    assert.equal(await styleOf(page, '#install-row', 'display'), 'none');
    assert.equal(await page.evaluate(() => NGPlatform.isInstalled), true);
    assert.equal(await page.evaluate(() => NGPlatform.isNative), false);
    const [download] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => exportUserSongs())]);
    assert.equal(download.suggestedFilename(), 'ngworship-user-songs.json');
    await ctx.close(); console.log('PASS installed PWA: flagged pwa, downloads exactly like the website');
  }
  // 3. Native wrapper with Capacitor-style plugins.
  {
    const { ctx, page } = await open(CAPACITOR);
    let downloads = 0; page.on('download', () => downloads++);
    assert.equal(await page.evaluate(() => NGPlatform.kind), 'native');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.platform), 'native');
    assert.equal(await page.evaluate(() => NGPlatform.saveFile({ filename: 'a.json', text: '{}' })), 'shared');
    assert.deepEqual(await page.evaluate(() => window.__calls), [['write', 'a.json', 'CACHE', 'utf8'], ['share', 'file:///cache/a.json']]);
    await page.evaluate(() => { window.__calls.length = 0; exportPlaylists(); });
    await page.waitForFunction(() => window.__toasts.length === 1);
    assert.equal(downloads, 0, 'no browser download inside a wrapper');
    await page.evaluate(() => { window.__cancelShare = true; window.__toasts.length = 0; return exportUserSongs(); });
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__toasts.length), 0, 'closing the share sheet shows no "exported" toast');
    assert.equal(await page.evaluate(() => NGPlatform.saveFile({ filename: 'b.json', text: '{}' })), 'cancelled');
    assert.equal(downloads, 0);
    assert.equal(await styleOf(page, '#install-row', 'display'), 'none');
    assert.equal(await styleOf(page, 'body', 'userSelect'), 'none');
    assert.equal(await styleOf(page, '#editor-title', 'userSelect'), 'text');
    await page.evaluate(() => { window.__calls.length = 0; const a = document.createElement('a'); a.id = 'ext'; a.target = '_blank'; a.href = 'https://example.com/x'; a.textContent = 'x'; a.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;padding:20px;background:#fff'; document.body.appendChild(a); });
    await page.locator('#ext').click();
    assert.deepEqual(await page.evaluate(() => window.__calls), [['browser', 'https://example.com/x']]);
    await ctx.close(); console.log('PASS native (Capacitor plugins): share sheet, cancel handling, external links, no install row, no UI text selection, no downloads');
  }
  // 4. Native wrapper with a bridge object instead of Capacitor.
  {
    const { ctx, page } = await open(BRIDGE);
    assert.equal(await page.evaluate(() => NGPlatform.kind), 'native');
    assert.equal(await page.evaluate(() => NGPlatform.saveFile({ filename: 'c.json', text: '{}', mime: 'application/json' })), 'native');
    await page.evaluate(() => { const a = document.createElement('a'); a.id = 'ext'; a.target = '_blank'; a.href = 'https://example.org/'; a.textContent = 'x'; a.style.cssText = 'position:fixed;top:0;left:0;z-index:99999;padding:20px;background:#fff'; document.body.appendChild(a); });
    await page.locator('#ext').click();
    assert.deepEqual(await page.evaluate(() => window.__calls), [['bridge-save', 'c.json', 'application/json'], ['bridge-open', 'https://example.org/']]);
    await ctx.close(); console.log('PASS native (NGWorshipNative bridge): save and open-external routed to the wrapper');
  }
  // 5. A broken plugin never loses the backup: falls back to the download link.
  {
    const { ctx, page } = await open(() => {
      window.Capacitor = { isNativePlatform: () => true, Plugins: { Filesystem: { writeFile: async () => { throw new Error('disk full'); } }, Share: { share: async () => {} } } };
    });
    const [download] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => NGPlatform.saveFile({ filename: 'd.json', text: '{"ok":1}' }))]);
    assert.equal(download.suggestedFilename(), 'd.json');
    await ctx.close(); console.log('PASS plugin failure falls back to the download link');
  }
  assert.deepEqual(errors.filter(m => !/service worker/i.test(m)), []);
  await browser.close(); server.close();
  console.log('ALL PASS');
})().catch(async e => { console.error(e); try { server.close(); } catch (_) {} process.exit(1); });
