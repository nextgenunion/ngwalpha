// Text size in Presentation mode: every A+/A- step must visibly change the
// text, never wobble, never stall, and the default must be readable on a phone.
//   NODE_PATH=$(npm root -g) node tools/verify_presentation_size_browser.cjs
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
  for (const vp of [{ w: 390, h: 844, n: 'phone portrait' }, { w: 844, h: 390, n: 'phone landscape' }, { w: 1280, h: 720, n: 'desktop' }]) {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.goto(`http://localhost:${server.address().port}/`);
    await page.waitForFunction(() => typeof openSong === 'function' && document.querySelectorAll('#song-list > *').length > 5, null, { timeout: 30000 });
    await page.evaluate(() => {
      localStorage.removeItem('sb-pres-size'); localStorage.setItem('sb-pres-lines', '1');
      const k = state.activeDbSource;
      const s = state.sources[k].songs.find(x => x.lyrics && x.lyrics.some(l => /\[/.test(l)));
      openSong(s, { sourceKey: k });
      SongPresentation.open({ song: s, titleInfo: { title: 'T' }, t, onRequestClose() {} });
    });
    await page.waitForTimeout(300);
    await page.keyboard.press('ArrowRight');
    const size = () => page.evaluate(() => parseFloat(document.querySelector('.pres-slide.is-current').style.fontSize));
    const press = (sel) => page.evaluate((s) => document.querySelector(s).click(), sel);
    const def = await size();
    ok(vp.w > 600 || def >= 30, `${vp.n}: default size is readable (${def.toFixed(0)}px)`);
    // Go to the smallest, then climb to the largest, recording every step.
    for (let i = 0; i < 12; i++) await press('[data-pres="smaller"]');
    const up = [await size()];
    for (let i = 0; i < 9; i++) { await press('[data-pres="larger"]'); up.push(await size()); }
    const strictly = up.every((v, i) => i === 0 || v >= up[i - 1] - 0.01);
    ok(strictly, `${vp.n}: A+ never makes text smaller (${up.map(v => v.toFixed(0)).join(' → ')})`);
    // With one short line per slide nothing should be capped until very large sizes.
    const grown = up.slice(0, 7).every((v, i) => i === 0 || v > up[i - 1] * 1.1);
    ok(grown, `${vp.n}: each of the first 6 steps is clearly bigger (>10%)`);
    ok(up[0] <= def * 0.5, `${vp.n}: smallest size is at most half of default (${up[0].toFixed(0)} vs ${def.toFixed(0)}px)`);
    ok(await page.evaluate(() => document.querySelector('[data-pres="larger"]').disabled), `${vp.n}: A+ is disabled only at the largest step`);
    // A- mirrors A+ exactly (no hysteresis).
    const down = [await size()];
    for (let i = 0; i < 9; i++) { await press('[data-pres="smaller"]'); down.push(await size()); }
    ok(up.every((v, i) => Math.abs(v - down[9 - i]) < 0.6), `${vp.n}: A- retraces the same sizes as A+`);
    // Whatever the size, text stays on screen.
    for (let i = 0; i < 9; i++) {
      await press('[data-pres="larger"]');
      const inside = await page.evaluate(() => {
        const st = document.querySelector('.pres-stage'), c = st.querySelector('.pres-slide.is-current');
        const r = c.getBoundingClientRect(), sr = st.getBoundingClientRect();
        return r.top >= sr.top - 1 && r.bottom <= sr.bottom + 1 && r.left >= sr.left - 1 && r.right <= sr.right + 1;
      });
      if (!inside) { ok(false, `${vp.n}: slide is clipped at step ${i + 1}`); break; }
      if (i === 8) ok(true, `${vp.n}: slide stays on screen at every size`);
    }
    // Keyboard shortcuts.
    for (let i = 0; i < 12; i++) await press('[data-pres="smaller"]');
    const base = await size();
    await page.keyboard.press('+');
    const plus = await size();
    await page.keyboard.press('-');
    ok(plus > base && Math.abs(await size() - base) < 0.6, `${vp.n}: + and - keys change size`);
    await ctx.close();
  }
  await browser.close(); server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
