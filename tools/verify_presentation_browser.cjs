// Browser check for Presentation mode (js/presentation.js + ui.js hooks).
//   CHROMIUM_EXECUTABLE=... node tools/verify_presentation_browser.cjs
// Covers: menu item below Reading mode, slide building (no chords, labels,
// 1-4 lines/whole section), keyboard + click + swipe-free navigation, blank,
// size controls, history (Back closes, song stays), desktop and phone sizes.
// (5.0.62: the control panel is hidden until S / top edge, so the checks reveal it first.
// Fill, the clean launch and the crossfade are covered by verify_presentation_v5062_browser.cjs.)
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg' };
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
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(`http://localhost:${server.address().port}/`);
  await page.waitForFunction(() => typeof state !== 'undefined' && typeof openSong === 'function' && document.getElementById('song-list'));
  await page.locator('#splash-logo').waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll('#song-list > *').length > 5, null, { timeout: 30000 });

  // Open the first song (has chords, labels-free sections).
  await page.evaluate(() => {
    const key = state.activeDbSource;
    const song = state.sources[key].songs.find(s => s.lyrics && s.lyrics.some(l => /\[/.test(l)));
    openSong(song, { sourceKey: key });
  });
  await page.waitForTimeout(600);

  // Menu: Presentation mode sits right below Reading mode.
  await page.click('#sv-menu-btn');
  const order = await page.evaluate(() => [...document.querySelectorAll('#sv-kebab-dropdown button')].map(b => b.id));
  const i = order.indexOf('sv-kebab-display-mode');
  ok(i >= 0 && order[i + 1] === 'sv-kebab-presentation', `menu order puts presentation right below reading mode (${order.join(',')})`);
  const histBefore = await page.evaluate(() => history.length);
  await page.click('#sv-kebab-presentation');
  await page.waitForSelector('#presentation-overlay');

  const q = async (fn, arg) => page.evaluate(fn, arg);
  const showPanel = async () => { if (!(await q(() => document.getElementById('presentation-overlay').classList.contains('controls-visible')))) await page.keyboard.press('s'); };
  ok(await q(() => SongPresentation.isOpen()), 'overlay opens');
  ok(await q(() => history.length) === histBefore + 1 && await q(() => history.state.presentation === true), 'opening adds one history entry');

  // Title slide first, then lyrics without chords.
  ok(await q(() => !!document.querySelector('.pres-slide.is-current.is-title')), 'first slide is the title slide');
  await page.keyboard.press('ArrowRight');
  const s1 = await q(() => ({ txt: document.querySelector('.pres-slide.is-current').textContent, lines: document.querySelectorAll('.pres-slide.is-current .pres-line').length }));
  ok(!/\[|\]/.test(s1.txt), 'no chord brackets on lyric slides');
  ok(s1.lines === 2, `default is 2 lines per slide (got ${s1.lines})`);

  // Lines per slide.
  for (const n of [1, 3, 4]) {
    await showPanel();
    await page.click(`[data-pres-lines="${n}"]`);
    const got = await q(() => document.querySelectorAll('.pres-slide.is-current .pres-line').length);
    ok(got >= 1 && got <= n, `${n} line(s) per slide -> ${got} lines shown`);
  }
  await showPanel();
  await page.click('[data-pres-lines="0"]');
  const whole = await q(() => document.querySelectorAll('.pres-slide.is-current .pres-line').length);
  ok(whole >= 2, `Fill shows several lines of the part (${whole} lines)`);
  await showPanel();
  await page.click('[data-pres-lines="2"]');

  // Fit: text never overflows the stage.
  const fits = await q(() => { const st = document.querySelector('.pres-stage'), c = st.querySelector('.pres-slide.is-current'); const cs = getComputedStyle(st), w = st.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), h = st.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom); const r = c.getBoundingClientRect(), sr = st.getBoundingClientRect(); return c.scrollHeight <= h + 1 && c.scrollWidth <= w + 1 && r.left >= sr.left && r.right <= sr.right + 1; });
  ok(fits, 'slide text fits the stage');

  // Navigation: keys.
  await page.keyboard.press('Home');
  ok(await q(() => !!document.querySelector('.pres-slide.is-current.is-title')), 'Home goes to first slide');
  await page.keyboard.press('End');
  const last = await q(() => document.querySelector('.pres-counter').textContent.split(' / '));
  ok(last[0] === last[1], `End goes to last slide (${last.join('/')})`);
  await page.keyboard.press('ArrowRight');
  const stay = await q(() => document.querySelector('.pres-counter').textContent.split(' / '));
  ok(stay[0] === stay[1], 'Next on the last slide stays put');
  await page.keyboard.press('ArrowLeft');
  const back1 = await q(() => +document.querySelector('.pres-counter').textContent.split(' / ')[0]);
  ok(back1 === +last[1] - 1, 'ArrowLeft goes back one slide');

  // Click: right third advances, left third goes back, middle never changes the slide.
  await page.keyboard.press('Home');
  await page.mouse.click(900, 400);
  ok(await q(() => +document.querySelector('.pres-counter').textContent.split(' / ')[0]) === 2, 'click on the right third advances');
  await page.waitForTimeout(2800); // let the panel (opened earlier with S) hide itself first
  await page.mouse.click(640, 400);
  await page.mouse.click(640, 400);
  await page.mouse.click(640, 400);
  ok(await q(() => +document.querySelector('.pres-counter').textContent.split(' / ')[0]) === 2, 'clicking the middle never changes the slide');
  ok(await q(() => !document.getElementById('presentation-overlay').classList.contains('controls-visible')), 'a mouse click in the middle does not show the controls');
  await page.mouse.click(100, 400);
  ok(await q(() => +document.querySelector('.pres-counter').textContent.split(' / ')[0]) === 1, 'click on the left third goes back');

  // Blank.
  await page.keyboard.press('b');
  ok(await q(() => document.querySelector('.pres-stage').classList.contains('is-blank')), 'B blanks the screen');
  await page.keyboard.press('ArrowRight');
  ok(await q(() => !document.querySelector('.pres-stage').classList.contains('is-blank')), 'navigating un-blanks');

  // Size controls persist (details are covered by verify_presentation_size_browser.cjs).
  await showPanel();
  await page.click('[data-pres="larger"]');
  ok(await q(() => localStorage.getItem('sb-pres-lines') === '2' && localStorage.getItem('sb-pres-size') === '5'), 'line and size choices are remembered');
  await showPanel();
  await page.click('[data-pres="smaller"]');

  // Controls: never from plain mouse movement; S shows them; they hide again by themselves.
  await page.mouse.move(640, 300);
  await page.waitForTimeout(3200);
  ok(await q(() => !document.getElementById('presentation-overlay').classList.contains('controls-visible')), 'controls hide when idle');
  await page.mouse.move(650, 310);
  await page.mouse.move(700, 350);
  ok(await q(() => !document.getElementById('presentation-overlay').classList.contains('controls-visible')), 'mouse move does not show controls');
  await page.keyboard.press('s');
  ok(await q(() => document.getElementById('presentation-overlay').classList.contains('controls-visible')), 'S shows controls');

  // Resize keeps fit.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  const fitsPhone = await q(() => { const st = document.querySelector('.pres-stage'), c = st.querySelector('.pres-slide.is-current'); const cs = getComputedStyle(st), w = st.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight), h = st.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom); const r = c.getBoundingClientRect(), sr = st.getBoundingClientRect(); return c.scrollHeight <= h + 1 && c.scrollWidth <= w + 1 && r.left >= sr.left && r.right <= sr.right + 1; });
  ok(fitsPhone, 'slide still fits at phone size');
  await page.screenshot({ path: '/tmp/pres-phone.png' });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(150);
  await page.screenshot({ path: '/tmp/pres-desktop.png' });

  // Browser Back closes presentation and stays on the same song, no re-render jump.
  const titleBefore = await q(() => document.getElementById('sv-title').textContent);
  await page.evaluate(() => { document.getElementById('page-song-view').scrollTop = 120; });
  await page.goBack();
  await page.waitForTimeout(300);
  ok(await q(() => !SongPresentation.isOpen() && !document.getElementById('presentation-overlay')), 'Back closes the overlay');
  ok(await q(() => state.currentPage === 'song-view') && await q(() => document.getElementById('sv-title').textContent) === titleBefore, 'still on the same song after Back');

  // Escape and the X button close through history too.
  await page.click('#sv-menu-btn'); await page.click('#sv-kebab-presentation');
  await page.waitForSelector('#presentation-overlay');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  ok(await q(() => !SongPresentation.isOpen()) && await q(() => state.currentPage === 'song-view'), 'Escape closes and stays on the song');
  await page.click('#sv-menu-btn'); await page.click('#sv-kebab-presentation');
  await page.waitForSelector('#presentation-overlay');
  await page.keyboard.press('s');
  await page.click('[data-pres="close"]');
  await page.waitForTimeout(300);
  ok(await q(() => !SongPresentation.isOpen()) && await q(() => state.currentPage === 'song-view'), 'X button closes and stays on the song');
  // Back out of the song still works afterwards (history not corrupted).
  await page.goBack();
  await page.waitForTimeout(400);
  ok(await q(() => state.currentPage === 'songs'), 'Back after closing returns to the song list');

  ok(errors.length === 0, `no page errors ${errors.join(' | ')}`);
  await browser.close(); server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
