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
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1.5, serviceWorkers: 'block', colorScheme: 'dark' });
  const page = await ctx.newPage();
  const fontRequests = [];
  await page.route('https://fonts.googleapis.com/**', async route => {
    fontRequests.push(route.request().url());
    await route.fulfill({ contentType: 'text/css', body: '' });
  });
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://localhost:${server.address().port}/`);
  await page.waitForFunction(() => typeof showPage === 'function' && document.querySelectorAll('#song-list > *').length > 5, null, { timeout: 30000 });
  await page.waitForTimeout(3500);
  const q = (fn, a) => page.evaluate(fn, a);
  ok(await q(() => document.documentElement.dataset.theme === 'light' && state.textSizeSliders), 'fresh installs use light mode and text-size sliders');
  await q(() => { ['sb-pres-background', 'sb-pres-text', 'sb-pres-title', 'sb-pres-adv'].forEach(k => localStorage.removeItem(k)); showPage('presentation-settings'); });
  await page.waitForTimeout(700);

  ok(await q(() => !document.getElementById('pres-background-file')), 'picture/video is no longer on the main Presentation page');
  ok(await q(() => document.querySelector('[data-pres-background="white"]').style.getPropertyValue('--pres-swatch-color') === '#fff'), 'preset color uses the circular swatch layer');
  await page.click('#presentation-advanced-nav-row');
  await page.waitForTimeout(700);
  ok(await q(() => state.currentPage === 'presentation-advanced'), 'Advanced row opens the Advanced page');
  ok(await q(() => !!document.getElementById('pres-background-file')), 'picture/video lives on the Advanced page');
  ok(await q(() => document.querySelectorAll('#presentation-advanced-content [data-pres-picker]').length === 4 && document.querySelectorAll('#presentation-advanced-content .seg-toggle').length === 1 && !!document.querySelector('.pres-range')), 'font and style menus, effect, two colour pickers and a dim slider');
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
  const choose = async (picker, value) => {
    await page.click(`[data-pres-picker="${picker}"]`);
    await page.click(`#modal-body [data-choice="${value}"]`);
  };
  await choose('presFont', 'classic');
  ok(/Times|Georgia|serif/i.test(await sample('fontFamily')), 'Serif uses the device serif stack');
  await choose('presFont', 'standard');
  ok(/Noto Sans/i.test(await sample('fontFamily')), 'Standard is Noto Sans (covers Ө and Ү)');

  ok(fontRequests.length === 0, 'bundled fonts make no Google Fonts requests');
  await choose('presFont', 'roboto');
  await page.waitForFunction(() => document.querySelector('#pres-font-roboto'));
  ok(/Roboto/.test(await sample('fontFamily')) && /Noto Sans/.test(await sample('fontFamily')), 'online font keeps the bundled fallback');
  await choose('fontStyle', 'bold');
  ok((await sample('fontWeight')) === '700', 'Bold applies to the preview');
  await choose('fontStyle', 'italic');
  ok((await sample('fontStyle')) === 'italic', 'Italic applies to the preview');
  ok(fontRequests.length === 1 && fontRequests[0].includes('family=Roboto'), 'only the chosen online family is requested');
  await ctx.setOffline(true);
  await choose('presFont', 'lato');
  ok(/Lato/.test(await sample('fontFamily')) && /Noto Sans/.test(await sample('fontFamily')) && fontRequests.length === 1, 'offline font selection keeps the local fallback without requesting Google Fonts');
  await ctx.setOffline(false);

  // The color dialog supports both HEX and sliders and saves only on Done.
  const setColor = async (picker, hex) => {
    await page.click(`[data-pres-picker="${picker}"]`);
    const input = page.locator('#modal-body .pres-color-hex');
    await input.fill('#badhex');
    ok(await page.locator('#modal-body .btn-primary').isDisabled(), 'invalid HEX cannot be applied');
    await input.fill(hex);
    await page.click('#modal-body .btn-primary');
  };
  await setColor('presTextColor', '#ff0000');
  ok((await sample('color')) === 'rgb(255, 0, 0)', 'custom text colour shows in the preview');
  await setColor('presBgColor', '#112233');
  ok(await q(() => getComputedStyle(document.querySelector('#presentation-advanced-content .pres-bg')).backgroundColor === 'rgb(17, 34, 51)'), 'custom background colour shows in the preview');
  ok(await q(() => JSON.parse(localStorage.getItem('sb-pres-adv')).bgColor === '#112233'), 'custom colours are saved');
  await page.click('[data-pres-picker="presBgColor"]');
  const hexBefore = await page.locator('#modal-body .pres-color-hex').inputValue();
  await page.locator('#modal-body input[type="range"]').first().press('ArrowRight');
  ok((await page.locator('#modal-body .pres-color-hex').inputValue()) !== hexBefore, 'hue slider updates HEX');
  await page.click('#modal-body .btn-secondary');
  ok(await q(() => JSON.parse(localStorage.getItem('sb-pres-adv')).bgColor === '#112233'), 'Cancel preserves the saved colour');

  // Dim
  await q(() => { const r = document.querySelector('.pres-range'); r.value = '40'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  ok(await q(() => getComputedStyle(document.querySelector('#presentation-advanced-content .pres-bg'), '::after').opacity === '0.4'), 'Dim darkens only the background layer');
  ok(await q(() => document.querySelector('.pres-range-value').textContent === '40%'), 'dim value is shown');

  // Real overlay uses all of it
  await q(() => {
    const k = state.activeDbSource, s = state.sources[k].songs.find(x => x.lyrics && x.lyrics.some(l => /\[/.test(l)));
    openSong(s, { sourceKey: k });
    SongPresentation.open({ song: s, titleInfo: { title: 'T', artist: 'Hidden Artist' }, t, onRequestClose() {} });
  });
  await page.waitForTimeout(500);
  const o = await q(() => { const ov = document.getElementById('presentation-overlay'); return { color: getComputedStyle(ov).color, bg: getComputedStyle(ov.querySelector('.pres-bg')).backgroundColor, dim: getComputedStyle(ov.querySelector('.pres-bg'), '::after').opacity, effect: ov.dataset.effect }; });
  ok(o.color === 'rgb(255, 0, 0)' && o.bg === 'rgb(17, 34, 51)' && o.dim === '0.4' && o.effect === 'none', `overlay applies colours, dim and effect (${JSON.stringify(o)})`);
  ok(await q(() => getComputedStyle(document.querySelector('.pres-slide')).fontStyle === 'italic' && !document.querySelector('.pres-title-artist')), 'overlay uses the selected style and hides artist by default');
  await q(() => SongPresentation.close());

  // Auto tone follows a custom background; basic text choice clears the custom colour
  await q(() => showPage('presentation-advanced'));
  await page.waitForTimeout(500);
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
  ok(adv.font === 'standard' && adv.fontStyle === 'normal' && adv.textColor === null && adv.bgColor === null && adv.effect === 'shadow' && adv.dim === 0, `Reset restores the defaults (${JSON.stringify(adv)})`);
  ok(await q(() => document.getElementById('presentation-advanced-reset').textContent === t('transposeReset')), 'Reset reuses the transpose label');
  ok(await q(() => document.querySelector('.pres-range').value === '0' && document.querySelector('#presentation-advanced-content [data-value="shadow"]').getAttribute('aria-pressed') === 'true'), 'Reset also updates the controls');

  ok(errors.length === 0, `no page errors ${errors.join(' | ')}`);
  await browser.close(); server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
