// Presentation settings page + background/text tone, built from the app's own
// components (swatches, segmented control, switches) with no darkening layer.
//   NODE_PATH=$(npm root -g) node tools/verify_presentation_settings_browser.cjs
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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.5, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://localhost:${server.address().port}/`);
  await page.waitForFunction(() => typeof showPage === 'function' && document.querySelectorAll('#song-list > *').length > 5, null, { timeout: 30000 });
  await page.waitForTimeout(3500);
  await page.evaluate(() => { localStorage.removeItem('sb-pres-background'); localStorage.removeItem('sb-pres-text'); localStorage.removeItem('sb-pres-title'); localStorage.removeItem('sb-pres-adv'); showPage('presentation-settings'); });
  await page.waitForTimeout(800);
  const q = (fn, a) => page.evaluate(fn, a);

  ok(await q(() => document.querySelectorAll('#presentation-settings-content input[type=checkbox]').length === 0), 'no native checkboxes (uses the app switches)');
  ok(await q(() => document.querySelectorAll('#presentation-settings-content .switch').length === 4), 'title slide options are 4 app switches');
  ok(await q(() => document.querySelectorAll('.pres-swatch').length === 6), 'six colour swatches');
  ok(await q(() => !document.querySelector('#presentation-settings-content .btn-secondary[data-pres-background]')), 'background choices are no longer outlined buttons');
  ok(await q(() => parseFloat(document.querySelector('#presentation-settings-content .seg-toggle-thumb').style.width) > 20), 'segmented control thumb is positioned');

  // Controls update in place (so press animations play) and the preview follows.
  await q(() => { window.__sw = document.querySelector('[data-pres-background="white"]'); });
  await page.click('[data-pres-background="white"]');
  ok(await q(() => document.querySelector('[data-pres-background="white"]') === window.__sw), 'clicking a swatch keeps the same element (animation can play)');
  ok(await q(() => window.__sw.getAttribute('aria-pressed') === 'true' && document.querySelectorAll('.pres-swatch[aria-pressed=true]').length === 1), 'exactly the clicked swatch is selected');
  ok(await q(() => document.querySelector('.pres-background-preview').dataset.tone === 'dark'), 'Auto text turns dark on a white background');
  await page.click('[data-pres-background="ocean"]');
  ok(await q(() => document.querySelector('.pres-background-preview').dataset.tone === 'light'), 'Auto text turns light on the ocean background');
  await page.click('#presentation-settings-content [data-value="dark"]');
  ok(await q(() => document.querySelector('.pres-background-preview').dataset.tone === 'dark' && localStorage.getItem('sb-pres-text') === 'dark'), 'Black text overrides Auto and is saved');
  await page.click('#presentation-settings-content [data-value="light"]');
  await page.click('[data-pres-background="sky"]');
  ok(await q(() => document.querySelector('.pres-background-preview').dataset.tone === 'light'), 'White text override beats a light background');
  await page.screenshot({ path: '/tmp/ps_settings.png' });
  await page.click('#presentation-settings-content [data-value="auto"]');

  // Switches: master off disables the others; choices are saved.
  const master = '#presentation-settings-content .switch >> nth=0';
  await page.click(master);
  ok(await q(() => [...document.querySelectorAll('#presentation-settings-content .switch')].slice(1).every(s => s.disabled)), 'turning the title slide off disables its options');
  ok(await q(() => JSON.parse(localStorage.getItem('sb-pres-title')).presTitleSlide === false), 'title slide choice saved');
  await page.click(master);

  // Overlay: the background is shown as-is (no dark layer) with the right text colour.
  await page.click('[data-pres-background="white"]');
  await q(() => {
    const k = state.activeDbSource, s = state.sources[k].songs.find(x => x.lyrics && x.lyrics.some(l => /\[/.test(l)));
    openSong(s, { sourceKey: k });
    SongPresentation.open({ song: s, titleInfo: { title: 'T' }, t, onRequestClose() {} });
  });
  await page.waitForTimeout(500);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  const o = await q(() => {
    const ov = document.getElementById('presentation-overlay'), bg = ov.querySelector('.pres-bg');
    return { color: getComputedStyle(ov).color, bg: getComputedStyle(bg).backgroundColor, dim: getComputedStyle(bg, '::after').opacity };
  });
  ok(o.bg === 'rgb(255, 255, 255)', `white background is really white (${o.bg}) with no dark layer`);
  ok(o.dim === '0', `no darkening by default (dim ${o.dim})`);
  ok(o.color === 'rgb(17, 17, 17)', `text is near-black on white (${o.color})`);
  await page.screenshot({ path: '/tmp/ps_overlay_white.png' });
  await page.evaluate(() => SongPresentation.close());

  ok(errors.length === 0, `no page errors ${errors.join(' | ')}`);
  await browser.close(); server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
