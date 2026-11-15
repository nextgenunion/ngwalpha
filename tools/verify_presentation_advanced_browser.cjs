// Presentation settings (5.0.94 layout): the main page holds background, text
// colour, font, style, effect and Reset; Advanced holds custom colours,
// picture/video and dim. Everything must show in the preview and in the real overlay.
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

  const main = '#presentation-settings-content', adv = '#presentation-advanced-content';
  ok(await q(() => !document.getElementById('pres-background-file')), 'picture/video is not on the main Presentation page');
  ok(await q(() => document.querySelector('[data-pres-background="white"]').style.getPropertyValue('--pres-swatch-color') === '#fff'), 'preset color uses the circular swatch layer');
  ok(await q((m) => !!document.querySelector(`${m} [data-pres-picker="presFont"]`) && document.querySelectorAll(`${m} .seg-toggle`).length === 4 && !!document.querySelector(`${m} [data-pres-picker="presCustomTextColor"]`) && !!document.querySelector(`${m} [data-pres-picker="presCustomBgColor"]`), main), 'font menu, text colour, style, effect, slide change and both custom-colour swatches are on the main page');
  ok(await q(() => [...document.querySelectorAll('#presentation-settings-content .seg-toggle-thumb')].every(t => parseFloat(t.style.width) > 20)), 'segmented control thumbs are positioned');
  const headings = await q((m) => [...document.querySelectorAll(`${m} .settings-heading`)].map(h => h.textContent), main);
  ok(headings.length === 3, `main page has Look, Text and Title slide sections (${headings.join(' / ')})`);
  ok(await q(() => { const row = document.getElementById('presentation-advanced-nav-row'); return row && !row.closest('section').querySelector('.settings-heading') && row.closest('section') !== document.querySelector('#presentation-settings-content .settings-section'); }), 'Advanced is in a section of its own, away from the basic rows');

  const sample = (prop, scope = main) => q(([p, sc]) => getComputedStyle(document.querySelector(`${sc} .pres-background-sample`))[p], [prop, scope]);

  // Effect
  ok((await sample('textShadow')) !== 'none', 'default effect is a soft shadow');
  await page.click(`${main} [data-value="outline"]`);
  ok(parseFloat(await sample('webkitTextStrokeWidth')) > 0, 'Outline adds a text stroke');
  await page.click(`${main} [data-value="glow"]`);
  ok(((await sample('textShadow')).match(/0px 0px/g) || []).length >= 2, 'Glow adds a layered glow');
  await page.click(`${main} [data-value="none"]`);
  ok((await sample('textShadow')) === 'none' && parseFloat(await sample('webkitTextStrokeWidth')) === 0, 'None removes every effect');

  // Font
  const choose = async (picker, value) => {
    await page.click(`[data-pres-picker="${picker}"]`);
    await page.click(`#modal-body [data-choice="${value}"]`);
  };
  await page.click(`[data-pres-picker="presFont"]`);
  const fontValues = await q(() => [...document.querySelectorAll('#modal-body [data-choice]')].map(b => b.dataset.choice));
  ok(!fontValues.includes('lato') && !fontValues.includes('poppins') && !fontValues.includes('noto-sans-kr') && fontValues.includes('roboto'), `font list keeps only Cyrillic-capable online fonts (${fontValues.join(',')})`);
  ok(await q(() => [...document.querySelectorAll('#modal-body [data-choice="roboto"]')].every(b => /·/.test(b.textContent))), 'online fonts are tagged');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await choose('presFont', 'classic');
  ok(/Times|Georgia|serif/i.test(await sample('fontFamily')), 'Serif uses the device serif stack');
  await choose('presFont', 'standard');
  ok(/Noto Sans/i.test(await sample('fontFamily')), 'Standard is Noto Sans (covers Ө and Ү)');

  ok(fontRequests.length === 0, 'bundled fonts make no Google Fonts requests');
  await choose('presFont', 'roboto');
  await page.waitForFunction(() => document.querySelector('#pres-font-roboto'));
  ok(/Roboto/.test(await sample('fontFamily')) && /Noto Sans/.test(await sample('fontFamily')), 'online font keeps the bundled fallback');
  await page.click(`${main} [data-value="bold"]`);
  ok((await sample('fontWeight')) === '700', 'Bold applies to the preview');
  await page.click(`${main} [data-value="italic"]`);
  ok((await sample('fontStyle')) === 'italic', 'Italic applies to the preview');
  ok(fontRequests.length === 1 && fontRequests[0].includes('family=Roboto'), 'only the chosen online family is requested');
  await ctx.setOffline(true);
  await choose('presFont', 'merriweather');
  ok(/Merriweather/.test(await sample('fontFamily')) && /Noto Sans/.test(await sample('fontFamily')) && fontRequests.length === 1, 'offline font selection keeps the local fallback without requesting Google Fonts');
  await ctx.setOffline(false);
  // a saved font that is no longer offered must not break the page
  await q(() => { localStorage.setItem('sb-pres-adv', JSON.stringify({ ...JSON.parse(localStorage.getItem('sb-pres-adv')), font: 'lato' })); showPage('presentation-advanced'); showPage('presentation-settings'); });
  await page.waitForTimeout(500);
  ok(await q(() => document.querySelector('#presentation-settings-content [data-pres-picker="presFont"] .settings-row-sub').textContent === t('presFontStandard')), 'an old saved font (Lato) falls back to Standard quietly');
  await choose('presFont', 'standard');

  // The color dialog supports both HEX and sliders and saves only on Done.
  const setColor = async (picker, hex) => {
    await page.click(`[data-pres-picker="${picker}"]`);
    const input = page.locator('#modal-body .pres-color-hex');
    await input.fill('#badhex');
    ok(await page.locator('#modal-body .btn-primary').isDisabled(), 'invalid HEX cannot be applied');
    await input.fill(hex);
    await page.click('#modal-body .btn-primary');
  };
  await setColor('presCustomTextColor', '#ff0000');
  ok((await sample('color', main)) === 'rgb(255, 0, 0)', 'custom text colour shows in the preview');
  ok(await q(() => { const sw = document.querySelector('[data-pres-picker="presCustomTextColor"]'); return sw.getAttribute('aria-pressed') === 'true' && !document.querySelector('#presentation-settings-content .seg-toggle .seg-toggle-btn[aria-pressed="true"][data-value="auto"]') && document.querySelector('#presentation-settings-content .seg-toggle.is-none') !== null; }), 'with a custom text colour none of Auto/White/Black is selected and the custom swatch is lit');
  await setColor('presCustomBgColor', '#112233');
  ok(await q(() => document.querySelector('[data-pres-picker="presCustomBgColor"]').getAttribute('aria-pressed') === 'true' && [...document.querySelectorAll('[data-pres-background]')].every(b => b.getAttribute('aria-pressed') === 'false')), 'with a custom background no preset swatch is selected and the custom swatch is lit');
  ok(await q((a) => getComputedStyle(document.querySelector(`${a} .pres-bg`)).backgroundColor === 'rgb(17, 34, 51)', main), 'custom background colour shows in the preview');
  ok(await q(() => JSON.parse(localStorage.getItem('sb-pres-adv')).bgColor === '#112233'), 'custom colours are saved');
  await page.click('[data-pres-picker="presCustomBgColor"]');
  const hexBefore = await page.locator('#modal-body .pres-color-hex').inputValue();
  await page.locator('#modal-body input[type="range"]').first().press('ArrowRight');
  ok((await page.locator('#modal-body .pres-color-hex').inputValue()) !== hexBefore, 'hue slider updates HEX');
  await page.click('#modal-body .btn-secondary');
  ok(await q(() => JSON.parse(localStorage.getItem('sb-pres-adv')).bgColor === '#112233'), 'Cancel preserves the saved colour');

  // Advanced page
  await page.click('#presentation-advanced-nav-row');
  await page.waitForTimeout(700);
  ok(await q(() => state.currentPage === 'presentation-advanced'), 'Advanced row opens the Advanced page');
  ok(await q(() => !!document.getElementById('pres-background-file')), 'picture/video lives on the Advanced page');
  ok(await q((a) => document.querySelectorAll(`${a} [data-pres-picker]`).length === 0 && document.querySelectorAll(`${a} .seg-toggle`).length === 0 && !!document.querySelector('.pres-range') && !document.getElementById('presentation-advanced-reset') && !document.getElementById('presentation-reset-advanced'), adv), 'Advanced holds only picture/video and dim (no colours, font, effect or Reset)');
  ok(await q(() => { const st = document.getElementById('pres-media-status'); return st.hidden && st.getBoundingClientRect().height === 0; }), 'no empty line (gap) above the picture/video button');
  await page.screenshot({ path: '/tmp/adv_page.png' });

  // Dim
  await q(() => { const r = document.querySelector('.pres-range'); r.value = '40'; r.dispatchEvent(new Event('input', { bubbles: true })); });
  ok(await q((a) => getComputedStyle(document.querySelector(`${a} .pres-bg`), '::after').opacity === '0.4', adv), 'Dim darkens only the background layer');
  ok(await q(() => document.querySelector('.pres-range-value').textContent === '40%'), 'dim value is shown');

  // Effect + style chosen earlier (main page) must reach the real overlay too
  await q(() => { const a = JSON.parse(localStorage.getItem('sb-pres-adv')); a.effect = 'none'; a.fontStyle = 'italic'; localStorage.setItem('sb-pres-adv', JSON.stringify(a)); });

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
  await page.click(`${main} .seg-toggle [data-value="dark"]`);
  ok(await q(() => JSON.parse(localStorage.getItem('sb-pres-adv')).textColor === null), 'choosing Auto/White/Black clears a custom text colour');
  ok(await q(() => document.querySelector('[data-pres-picker="presCustomTextColor"]').getAttribute('aria-pressed') === 'false' && document.querySelector('#presentation-settings-content .seg-toggle-btn[data-value="dark"]').getAttribute('aria-pressed') === 'true'), 'the custom text swatch goes dark and the chosen fixed colour is selected');
  await page.click('[data-pres-background="white"]');
  ok(await q(() => JSON.parse(localStorage.getItem('sb-pres-adv')).bgColor === null), 'choosing a background swatch clears a custom background colour');
  ok(await q(() => document.querySelector('[data-pres-picker="presCustomBgColor"]').getAttribute('aria-pressed') === 'false' && document.querySelector('[data-pres-background="white"]').getAttribute('aria-pressed') === 'true'), 'the custom background swatch goes dark and the chosen preset is selected');

  // One Reset on the main page restores the whole look (basic and advanced)
  await q(() => { const a = JSON.parse(localStorage.getItem('sb-pres-adv')); Object.assign(a, { font: 'classic', fontStyle: 'bold', effect: 'glow', dim: 25, textColor: '#00ff00', bgColor: '#123456' }); localStorage.setItem('sb-pres-adv', JSON.stringify(a)); localStorage.setItem('sb-pres-text', 'dark'); localStorage.setItem('sb-pres-transition', 'cut'); showPage('presentation-advanced'); showPage('presentation-settings'); });
  await page.waitForTimeout(500);
  ok(await q((m) => document.getElementById('presentation-reset').textContent === t('presResetLook') && t('presResetLook').length < 12 && !!document.querySelector(`${m} #presentation-reset`), main), 'Reset lives on the main page with its own label');
  await page.click('#presentation-reset');
  const after = await q(() => ({ adv: JSON.parse(localStorage.getItem('sb-pres-adv')), text: localStorage.getItem('sb-pres-text'), bg: JSON.parse(localStorage.getItem('sb-pres-background')), transition: localStorage.getItem('sb-pres-transition') }));
  ok(after.adv.font === 'standard' && after.adv.fontStyle === 'normal' && after.adv.textColor === null && after.adv.bgColor === null && after.adv.effect === 'shadow' && after.adv.dim === 0 && after.text === 'auto' && after.bg.preset === 'black' && after.transition === 'fade', `Reset restores every default (${JSON.stringify(after)})`);
  ok(await q((m) => document.querySelector(`${m} [data-value="shadow"]`).getAttribute('aria-pressed') === 'true' && document.querySelector('[data-pres-background="black"]').getAttribute('aria-pressed') === 'true', main), 'Reset also updates the controls');

  ok(errors.length === 0, `no page errors ${errors.join(' | ')}`);
  await browser.close(); server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
