'use strict';
// Real worker under the GitHub Pages prefix. Drop server connections as well
// as setting the browser offline, so the worker cannot quietly use the network.
const assert = require('node:assert/strict');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..'), prefix = '/ngworship/';
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };
let netDown = false, browser;
const requests = [];
const google = url => {
  const host = new URL(url).hostname;
  return ['google' + 'apis.com', 'g' + 'static.com'].some(domain => host === domain || host.endsWith('.' + domain));
};
const server = http.createServer((q, r) => {
  if (netDown) { q.socket.destroy(); return; }
  const url = new URL(q.url, 'http://localhost');
  if (url.pathname === '/ngworship') { r.writeHead(301, { Location: prefix }); r.end(); return; }
  if (!url.pathname.startsWith(prefix)) { r.writeHead(404); r.end(); return; }
  let name = decodeURIComponent(url.pathname.slice(prefix.length)) || 'index.html';
  const file = path.resolve(root, name);
  if (!file.startsWith(root + path.sep)) { r.writeHead(403); r.end(); return; }
  fs.readFile(file, (err, data) => {
    r.writeHead(err ? 404 : 200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    r.end(err ? 'not found' : data);
  });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}${prefix}`;
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE });
  // Persist installation only; restart Chromium to discard in-memory fonts and HTTP cache.
  const profile = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'ngw-fonts-'));
  await browser.close();
  browser = null;
  const launch = () => chromium.launchPersistentContext(profile, { executablePath: process.env.CHROMIUM_EXECUTABLE, viewport: { width: 390, height: 844 } });
  const observe = async ctx => {
    ctx.on('request', request => requests.push(request.url()));
    await ctx.route('**/*', route => google(route.request().url()) ? route.abort() : route.continue());
  };
  let ctx = await launch(); browser = ctx;
  await observe(ctx);
  let page = await ctx.newPage();
  await page.goto(base);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return r && r.active && r.active.state === 'activated' && !r.installing;
  });
  const expected = [...require('./read_stylesheet.cjs').readStylesheet().css.matchAll(/url\('\.\.\/fonts\/([^']+)'\)/g)].map(m => m[1]);
  const cached = await page.evaluate(async files => {
    const keys = (await caches.keys()).filter(k => k.startsWith('songbook-'));
    return Promise.all(files.map(async file => {
      for (const key of keys) if (await (await caches.open(key)).match(new URL('fonts/' + file, location.href))) return true;
      return false;
    }));
  }, expected);
  assert(cached.every(Boolean), 'all CSS fonts must be cached before going offline');
  console.log(`PASS atomic offline cache contains all ${expected.length} fonts`);
  await ctx.close();
  netDown = true;
  ctx = await launch(); browser = ctx;
  await observe(ctx); await ctx.setOffline(true);
  page = await ctx.newPage();
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  assert(await page.evaluate(() => !!navigator.serviceWorker.controller), 'offline launch must be controlled');
  console.log('PASS cold offline launch after browser restart, server connections dropped');
  const cases = [
    ['600 14px "IBM Plex Mono"', 'C Am7 F#m'], ['500 14px "IBM Plex Mono"', 'C Am7 F#m'],
    ['16px "Inter Variable"', 'Worship Latin'],
    ['16px "Noto Sans Variable"', 'Worship Latin'], ['16px "Noto Sans Variable"', 'Ө Ү Монгол'],
    ['italic 16px "Noto Sans Variable"', 'Worship Latin'], ['italic 16px "Noto Sans Variable"', 'Ө Ү Монгол'],
  ];
  for (const [font, text] of cases) {
    const result = await page.evaluate(async ({font, text}) => {
      const faces = await document.fonts.load(font, text);
      return { count: faces.length, loaded: faces.every(f => f.status === 'loaded'), check: document.fonts.check(font, text) };
    }, {font, text});
    assert(result.count > 0 && result.loaded && result.check, JSON.stringify({ font, text, result }));
    console.log(`PASS offline ${font} [${text}] (${result.count} loaded faces)`);
  }
  assert.equal(requests.filter(google).length, 0);
  console.log('PASS zero Google font requests');
  if (process.env.REQUEST_LOG) fs.writeFileSync(process.env.REQUEST_LOG, JSON.stringify(requests, null, 2));
  console.log(`ALL PASS (${requests.length} requests recorded)`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
});
