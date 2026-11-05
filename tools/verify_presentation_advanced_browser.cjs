// Presentation → Advanced page: font, custom colours, effect, dim, picture/video
// and Reset. Everything must show in the preview and in the real overlay.
//   NODE_PATH=$(npm root -g) node tools/verify_presentation_advanced_browser.cjs
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
  const q = (fn, a) => page.evaluate(fn, a);
  await q(() => { ['sb-pres-background', 'sb-pres-text', 'sb-pres-title', 'sb-pres-adv'].forEach(k => localStorage.removeItem(k)); showPage('presentation-settings'); });
  await page.waitForTimeout(700);

  ok(await q(() => !document.getElementById('pres-background-file')), 'picture/video is no longer on the main Presentation page');
  await page.click('#presentation-advanced-nav-row');
  await page.waitForTimeout(700);
  ok(await q(() => state.currentPage === 'presentation-advanced'), 'Advanced row opens the Advanced page');
  ok(await q(() => !!document.getElementById('pres-background-file')), 'picture/video lives on the Advanced page');
  ok(await q(() => document.querySelectorAll('#presentation-advanced-content .seg-toggle').length === 2 && document.querySelectorAll('#presentation-advanced-content .pres-custom').length === 2 && !!document.querySelector('.pres-range')), 'font + effect controls, two colour pickers and a dim slider');
  ok(await q(() => [...document.querySelectorAll('#presentation-advanced-content .seg-toggle-thumb')].every(t => parseFloat(t.style.width) > 20)), 'segmented control thumbs are positioned');
  await page.screenshot({ path: '/tmp/adv_page.png' });

  const sample = (prop) => q((p) => getComputedStyle(document.querySelector('#presentation-advanced-content .pres-background-sample'))[p], prop);

  // Effect
  ok((await sample('textShadow')) !== 'none', 'default effect is a soft shadow');
  await page.click('#presentation-advanced-content [data-value="outline"]');
  ok(parseFloat(await sample('webkitTextStrokeWidth')) > 0, 'Outline adds a text stroke');
  await page.click('#presentation-advanced-content [data-value="glow"]');
  ok(((await sample('textShadow')).match(/0px 0px/g) || []).length >= 2, 'Glow adds a layered glow');
  await page.click('#presentation-advanced-content [data-value="none"]');
  ok((await sample('textShadow')) === 'none' && parseFloat(await sample('webkitTextStrokeWidth')) === 0, 'None removes every effect');

  // Font
  await page.click('#presentation-advanced-content [data-value="classic"]');
  ok(/Times|Georgia|serif/i.test(await sample('fontFamily')), 'Serif uses the device serif stack');
  await page.click('#presentation-advanced-content [data-value="standard"]');
  ok(/Noto Sans/i.test(await sample('fontFamily')), 'Standard is Noto Sans (covers Ө and Ү)');

  // Custom colours (drive the native inputs the way the OS picker does)
  const setColor = (label, hex) => q(([l, h]) => { const i = document.querySelector(`#presentation-advanced-content input[type=color][aria-label="${t(l)}"]`); i.value = h; i.dispatchEvent(new Event('input', { bubbles: true })); }, [label, hex]);
  await setColor('presTextColor', '#ff0000');
  ok((await sample('color')) === 'rgb(255, 0, 0)', 'custom text colour shows in the preview');
  await setColor('presBgColor', '#112233');
  ok(await q(() => getComputedStyle(document.querySelector('#presentation-advanced-content .pres-bg')).backgroundColor === 'rgb(17, 34, 51)'), 'custom background colour shows in the preview');
  ok(await q(() => JSON.parse(localStorage.getItem('sb-pres-adv')).bgColor === '#112233'), 'custom colours are saved');

  // Dim
  await q(() => { const r = document.querySelector('.pres-range'); r.value = '40'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  ok(await q(() => getComputedStyle(document.querySelector('#presentation-advanced-content .pres-bg'), '::after').opacity === '0.4'), 'Dim darkens only the background layer');
  ok(await q(() => document.querySelector('.pres-range-value').textContent === '40%'), 'dim value is shown');

  // Real overlay uses all of it
  await q(() => {
    const k = state.activeDbSource, s = state.sources[k].songs.find(x => x.lyrics && x.lyrics.some(l => /\[/.test(l)));
    openSong(s, { sourceKey: k });
    SongPresentation.open({ song: s, titleInfo: { title: 'T' }, t, onRequestClose() {} });
  });
  await page.waitForTimeout(500);
  const o = await q(() => { const ov = document.getElementById('presentation-overlay'); return { color: getComputedStyle(ov).color, bg: getComputedStyle(ov.querySelector('.pres-bg')).backgroundColor, dim: getComputedStyle(ov.querySelector('.pres-bg'), '::after').opacity, effect: ov.dataset.effect }; });
  ok(o.color === 'rgb(255, 0, 0)' && o.bg === 'rgb(17, 34, 51)' && o.dim === '0.4' && o.effect === 'none', `overlay applies colours, dim and effect (${JSON.stringify(o)})`);
  await q(() => SongPresentation.close());

  // Auto tone follows a custom background; basic text choice clears the custom colour
  await q(() => showPage('presentation-advanced'));
  await page.waitForTimeout(500);
  await q(() => { const i = document.querySelector('#presentation-advanced-content input[type=color][aria-label="' + t('presTextColor') + '"]'); });
  await q(() => showPage('presentation-settings'));
  await page.waitForTimeout(500);
  await page.click('#presentation-settings-content [data-value="dark"]');
  ok(await q(() => JSON.parse(localStorage.getItem('sb-pres-adv')).textColor === null), 'choosing Auto/White/Black clears a custom text colour');
  await page.click('[data-pres-background="white"]');
  ok(await q(() => JSON.parse(localStorage.getItem('sb-pres-adv')).bgColor === null), 'choosing a background swatch clears a custom background colour');

  // Back button + Reset
  await q(() => showPage('presentation-advanced'));
  await page.waitForTimeout(500);
  await page.click('#presentation-advanced-reset');
  const adv = await q(() => JSON.parse(localStorage.getItem('sb-pres-adv')));
  ok(adv.font === 'standard' && adv.textColor === null && adv.bgColor === null && adv.effect === 'shadow' && adv.dim === 0, `Reset restores the defaults (${JSON.stringify(adv)})`);
  ok(await q(() => document.querySelector('.pres-range').value === '0' && document.querySelector('#presentation-advanced-content [data-value="shadow"]').getAttribute('aria-pressed') === 'true'), 'Reset also updates the controls');

  ok(errors.length === 0, `no page errors ${errors.join(' | ')}`);
  await browser.close(); server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
