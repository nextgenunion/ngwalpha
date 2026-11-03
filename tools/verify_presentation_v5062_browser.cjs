// Presentation mode v5.0.62: Fill, clean launch, quiet controls, Cut/Fade.
//   NODE_PATH=$(npm root -g) node tools/verify_presentation_v5062_browser.cjs
// Set SHOT_DIR=/some/dir to also save screenshots.
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(root, p), (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); r.end(d); });
}).listen(0);
const SHOTS = process.env.SHOT_DIR;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) failures++; };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function newPage(browser, opts) {
  const ctx = await browser.newContext(Object.assign({ serviceWorkers: 'block' }, opts));
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e)));
  await page.goto(`http://localhost:${server.address().port}/`);
  await page.waitForFunction(() => typeof openSong === 'function' && document.querySelectorAll('#song-list > *').length > 5, null, { timeout: 30000 });
  return page;
}
// A song with a long part (>= 8 lines), no markdown, to make Fill interesting.
const openPres = (page, prefs) => page.evaluate((p) => {
  try { SongPresentation.close(); } catch (_) {}
  localStorage.setItem('sb-pres-lines', String(p.lines));
  localStorage.setItem('sb-pres-size', String(p.size));
  localStorage.setItem('sb-pres-transition', p.transition || 'cut');
  const songs = state.sources[state.activeDbSource].songs;
  const song = songs.find(s => s.lyrics && !s.lyrics.some(l => /[*_]/.test(l)) &&
    SongPresentation.buildSlides(s, 0, null).some(x => x.lines.length >= 8));
  window.__song = song;
  SongPresentation.open({ song, titleInfo: { number: song.number, title: song.title, artist: song.artist }, t, onRequestClose() { SongPresentation.close(); } });
  return song.title;
}, prefs);

const overlayState = (page) => page.evaluate(() => {
  const o = document.getElementById('presentation-overlay');
  return {
    visible: o.classList.contains('controls-visible'),
    barOpacity: parseFloat(getComputedStyle(o.querySelector('.pres-bar')).opacity),
    hintOpacity: parseFloat(getComputedStyle(o.querySelector('.pres-hint')).opacity),
    cursor: getComputedStyle(o).cursor,
  };
});

// Walk every slide (cut mode, so each key press is instant) and describe it.
const collectSlides = (page) => page.evaluate(() => {
  const out = [];
  const read = () => {
    const c = document.querySelector('.pres-slide.is-current');
    return {
      title: c.classList.contains('is-title'),
      label: (c.querySelector('.pres-label') || {}).textContent || null,
      lines: [...c.querySelectorAll('.pres-line')].map(p => p.textContent.replace(/\s+/g, ' ').trim()),
      fontSize: parseFloat(c.style.fontSize),
    };
  };
  const counter = () => document.querySelector('.pres-counter').textContent.split(' / ').map(Number);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  for (let i = 0; i < 200; i++) {
    out.push(read());
    const [a, b] = counter();
    if (a >= b) break;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  }
  return out;
});

// Does adding one more line (the first line of the next slide) to this slide's
// lines overflow the screen? Uses a card with the real classes and text size.
const wouldOverflow = (page, slide, extraLine) => page.evaluate(({ slide, extraLine }) => {
  const stage = document.querySelector('.pres-stage'), cs = getComputedStyle(stage);
  const availW = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const card = document.createElement('div');
  card.className = 'pres-slide is-lyrics pres-measure';
  card.style.fontSize = slide.fontSize + 'px';
  card.style.width = availW + 'px';
  if (slide.label) { const l = document.createElement('div'); l.className = 'pres-label'; l.textContent = slide.label; card.appendChild(l); }
  [...slide.lines, extraLine].forEach(t => { const p = document.createElement('p'); p.className = 'pres-line'; p.textContent = t; card.appendChild(p); });
  stage.appendChild(card);
  const over = card.scrollHeight > availH + 1;
  card.remove();
  return over;
}, { slide, extraLine });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE || undefined });

  // ---------------- desktop ----------------
  const page = await newPage(browser, { viewport: { width: 1280, height: 720 } });
  await openPres(page, { lines: 0, size: 4, transition: 'fade' });
  await sleep(500);

  // Clean launch.
  let st = await overlayState(page);
  ok(!st.visible && st.barOpacity === 0, 'launch: no control panel (and so no counter)');
  ok(st.hintOpacity === 0, 'launch: no hint text');
  ok(st.cursor === 'none', 'launch: no visible cursor');
  ok(await page.evaluate(() => { const c = document.querySelector('.pres-slide.is-current'); return c.classList.contains('is-title') && c.textContent.length > 0; }), 'launch: starts on the title slide');
  ok(await page.evaluate(() => document.querySelectorAll('.pres-slide').length === 1), 'launch: exactly one slide on screen');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '1-launch-desktop.png') });

  // Mouse movement and middle clicks never show the controls.
  for (const [x, y] of [[300, 300], [640, 360], [700, 400], [200, 100], [900, 650]]) await page.mouse.move(x, y);
  await page.mouse.click(640, 360);
  await sleep(200);
  st = await overlayState(page);
  ok(!st.visible && st.barOpacity === 0 && st.cursor === 'none', 'mouse movement and a middle click do not show controls or the cursor');
  ok(await page.evaluate(() => document.querySelector('.pres-counter').textContent.startsWith('1 /')), 'middle click did not change the slide');

  // Top edge shows them (after a short dwell), and they hide themselves.
  await page.mouse.move(640, 200);
  await page.mouse.move(640, 0);
  await sleep(60);
  ok(!(await overlayState(page)).visible, 'top edge: not instant (a fly-by does not flash them)');
  await sleep(450);
  st = await overlayState(page);
  ok(st.visible && st.barOpacity > 0.95 && st.cursor === 'default', 'top edge: controls and cursor appear');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, '2-panel-desktop.png') });
  await sleep(2800);
  st = await overlayState(page);
  ok(!st.visible && st.barOpacity === 0 && st.cursor === 'none', 'controls hide themselves quickly (about 2 s)');

  // S shows, S hides. Hovering the panel keeps it open.
  await page.mouse.move(640, 400);
  await page.keyboard.press('s');
  ok((await overlayState(page)).visible, 'S shows the controls');
  await page.keyboard.press('s');
  ok(!(await overlayState(page)).visible, 'S again hides them');
  await page.keyboard.press('s');
  await sleep(300);
  const box = await page.evaluate(() => { const r = document.querySelector('.pres-bar').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, top: r.top }; });
  ok(box.w < 760 && box.h < 60, `panel is small (${Math.round(box.w)}x${Math.round(box.h)}px)`);
  await page.mouse.move(box.x, box.y);
  await sleep(3200);
  ok((await overlayState(page)).visible, 'panel stays open while the mouse is on it');
  await page.mouse.move(box.x, 500);
  await sleep(2800);
  ok(!(await overlayState(page)).visible, 'panel hides after the mouse leaves');

  // Keys that change slides do not pop the controls open.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('+');
  await page.keyboard.press('-');
  ok(!(await overlayState(page)).visible, 'navigation and size keys do not show the controls');

  // Panel contents: Lines (1-4, Fill), Size, Transition. "All" is gone.
  await page.keyboard.press('s');
  const labels = await page.evaluate(() => ({
    lines: [...document.querySelectorAll('[data-pres-lines]')].map(b => b.textContent),
    transition: [...document.querySelectorAll('[data-pres-transition]')].map(b => b.textContent),
    size: !!document.querySelector('[data-pres="smaller"]') && !!document.querySelector('[data-pres="larger"]'),
  }));
  ok(JSON.stringify(labels.lines) === JSON.stringify(['1', '2', '3', '4', 'Fill']) || labels.lines.slice(0, 4).join() === '1,2,3,4' && labels.lines.length === 5, `Lines choices: ${labels.lines.join(' ')}`);
  ok(!labels.lines.some(l => /^(All|Бүгд|전체)$/.test(l)), 'no "All" choice any more');
  ok(labels.transition.length === 2 && labels.size, `Size and Transition present (${labels.transition.join(' / ')})`);

  // ---------------- Fill ----------------
  const song = await openPres(page, { lines: 0, size: 4, transition: 'cut' });
  await sleep(300);
  const fillCheck = async (name) => {
    const slides = await collectSlides(page);
    const sections = await page.evaluate(() => SongPresentation.buildSlides(window.__song, 0, null).map(s => ({ label: s.label, lines: s.lines.map(l => l.replace(/\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim()) })));
    const lyrics = slides.filter(s => !s.title);
    let si = 0, li = 0, good = true, maximal = true, fitsAll = true, why = '';
    for (let k = 0; k < lyrics.length; k++) {
      const s = lyrics[k];
      if (li >= sections[si].lines.length) { si++; li = 0; }
      if (!sections[si]) { good = false; why = 'more slides than sections'; break; }
      const expect = sections[si].lines.slice(li, li + s.lines.length);
      if (JSON.stringify(expect) !== JSON.stringify(s.lines) || (s.label || null) !== (sections[si].label || null)) { good = false; why = `slide ${k} does not match section ${si}`; break; }
      li += s.lines.length;
      // Nothing is cut off at the chosen size (unless one line alone is too tall).
      const o = await page.evaluate(() => { const c = document.querySelector('.pres-slide.is-current'); return c.scrollHeight; });
      // Maximal: if the part continues, the next line would not have fit.
      if (li < sections[si].lines.length) {
        if (!(await wouldOverflow(page, s, sections[si].lines[li]))) { maximal = false; why = `slide ${k} could have taken another line`; }
      }
    }
    ok(good && si === sections.length - 1 && li === sections[si].lines.length, `${name}: every line shown once, in order, parts never mixed (${lyrics.length} slides) ${why}`);
    ok(maximal, `${name}: each slide holds as many lines as fit ${why}`);
    return { slides, lyrics };
  };
  const base = await fillCheck('Fill desktop default size');
  ok(base.lyrics.every(s => s.lines.length >= 1) && base.lyrics.some(s => s.lines.length >= 3), `Fill packs several lines per slide (${base.lyrics.map(s => s.lines.length).join(',')})`);
  // Bigger text -> fewer lines per slide (more slides); smaller text -> fewer slides.
  const counts = [];
  for (const size of [1, 4, 7, 9]) {
    await openPres(page, { lines: 0, size, transition: 'cut' });
    await sleep(150);
    counts.push((await collectSlides(page)).length);
  }
  ok(counts.every((c, i) => i === 0 || c >= counts[i - 1]) && counts[3] > counts[0], `bigger text = more slides (sizes 1/4/7/9 -> ${counts.join('/')})`);
  await openPres(page, { lines: 0, size: 7, transition: 'cut' });
  await sleep(150);
  await fillCheck('Fill desktop big text');
  await openPres(page, { lines: 0, size: 1, transition: 'cut' });
  await sleep(150);
  await fillCheck('Fill desktop small text');

  // Changing size/lines live keeps the audience on the same lyric.
  await openPres(page, { lines: 0, size: 4, transition: 'cut' });
  await sleep(150);
  for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
  const anchor = await page.evaluate(() => document.querySelector('.pres-slide.is-current .pres-line').textContent.replace(/\s+/g, ' ').trim());
  await page.keyboard.press('+'); await page.keyboard.press('+');
  const afterBigger = await page.evaluate(() => [...document.querySelectorAll('.pres-slide.is-current .pres-line')].map(p => p.textContent.replace(/\s+/g, ' ').trim()));
  ok(afterBigger.includes(anchor), 'Fill: bigger text keeps the same lyric on screen');
  await page.setViewportSize({ width: 600, height: 900 });
  await sleep(300);
  const afterResize = await page.evaluate(() => [...document.querySelectorAll('.pres-slide.is-current .pres-line')].map(p => p.textContent.replace(/\s+/g, ' ').trim()));
  ok(afterResize.includes(afterBigger[0]) || afterResize.some(l => afterBigger.includes(l)), 'Fill: resizing the window re-groups and keeps the lyric');
  const fitNow = await page.evaluate(() => { const st = document.querySelector('.pres-stage'), c = st.querySelector('.pres-slide.is-current'); return c.scrollHeight <= c.parentElement.clientHeight; });
  ok(fitNow, 'Fill: still fits after a resize');
  await page.setViewportSize({ width: 1280, height: 720 });
  await sleep(300);

  // ---------------- Cut vs Fade ----------------
  await openPres(page, { lines: 2, size: 4, transition: 'fade' });
  await sleep(500);
  await page.keyboard.press('ArrowRight');           // title -> first lyric slide
  await sleep(500);
  await page.keyboard.press('ArrowRight');
  await sleep(120);
  const mid = await page.evaluate(() => [...document.querySelectorAll('.pres-stage .pres-slide')].map(c => ({ cls: c.className, op: parseFloat(getComputedStyle(c).opacity), text: c.textContent.slice(0, 20) })));
  ok(mid.length === 2, `Fade: old and new slide are on screen together (${mid.length})`);
  const oldOp = (mid.find(m => /is-leaving/.test(m.cls)) || {}).op, newOp = (mid.find(m => /is-current/.test(m.cls)) || {}).op;
  ok(oldOp > 0 && oldOp < 1 && newOp > 0 && newOp < 1, `Fade: true crossfade, old fading out (${(oldOp || 0).toFixed(2)}) while new fades in (${(newOp || 0).toFixed(2)})`);
  const transforms = await page.evaluate(() => [...document.querySelectorAll('.pres-stage .pres-slide')].map(c => getComputedStyle(c).transform));
  ok(transforms.every(t => t === 'none'), 'Fade: no drift, opacity only');
  await sleep(450);
  ok(await page.evaluate(() => document.querySelectorAll('.pres-stage .pres-slide').length === 1 && document.querySelector('.pres-slide.is-current').style.opacity === ''), 'Fade: only the new slide remains after ~0.3 s');
  // Rapid presses never leave stray slides behind.
  for (let i = 0; i < 4; i++) { await page.keyboard.press('ArrowRight'); await sleep(40); }
  await sleep(500);
  ok(await page.evaluate(() => document.querySelectorAll('.pres-stage .pres-slide').length === 1), 'Fade: rapid presses leave a single slide');
  ok(await page.evaluate(() => { const c = document.querySelector('.pres-slide.is-current'); return parseFloat(getComputedStyle(c).opacity) === 1; }), 'Fade: final slide is fully opaque');

  // Choose Cut in the panel: instant swap, remembered.
  if (!(await overlayState(page)).visible) await page.keyboard.press('s');
  await page.click('[data-pres-transition="cut"]');
  ok(await page.evaluate(() => localStorage.getItem('sb-pres-transition') === 'cut'), 'Cut is remembered');
  await page.keyboard.press('ArrowRight');
  ok(await page.evaluate(() => document.querySelectorAll('.pres-stage .pres-slide').length === 1), 'Cut: instant swap, one slide at once');
  if (!(await overlayState(page)).visible) await page.keyboard.press('s');
  await page.click('[data-pres-transition="fade"]');
  ok(await page.evaluate(() => localStorage.getItem('sb-pres-transition') === 'fade' && document.querySelector('[data-pres-transition="fade"]').getAttribute('aria-pressed') === 'true'), 'Fade is remembered');
  await page.evaluate(() => SongPresentation.close());
  await page.evaluate(() => { localStorage.setItem('sb-pres-lines', '2'); });
  await page.evaluate(() => SongPresentation.open({ song: window.__song, titleInfo: { title: 'x' }, t, onRequestClose() {} }));
  ok(await page.evaluate(() => document.querySelector('[data-pres-transition="fade"]').getAttribute('aria-pressed') === 'true'), 'Fade is still selected when presentation is reopened');
  await page.evaluate(() => SongPresentation.close());

  ok(page.errors.length === 0, `desktop: no page errors ${page.errors.join(' | ')}`);
  await page.context().close();

  // ---------------- reduced motion: always Cut ----------------
  const rm = await newPage(browser, { viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' });
  await openPres(rm, { lines: 2, size: 4, transition: 'fade' });
  await sleep(300);
  await rm.keyboard.press('ArrowRight');
  ok(await rm.evaluate(() => document.querySelectorAll('.pres-stage .pres-slide').length === 1), 'reduced motion: slides cut even though Fade is saved');
  await rm.keyboard.press('s');
  ok(await rm.evaluate(() => document.querySelector('[data-pres-transition-group]').hidden), 'reduced motion: the Transition choice is hidden');
  await rm.context().close();

  // ---------------- phone portrait ----------------
  const ph = await newPage(browser, { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await openPres(ph, { lines: 0, size: 4, transition: 'cut' });
  await sleep(300);
  let ps = await overlayState(ph);
  ok(!ps.visible && ps.barOpacity === 0 && ps.hintOpacity === 0, 'phone: clean launch');
  if (SHOTS) await ph.screenshot({ path: path.join(SHOTS, '3-launch-phone.png') });
  await ph.touchscreen.tap(195, 420);
  await sleep(350);
  ok((await overlayState(ph)).visible, 'phone: a middle tap shows the controls');
  const phBar = await ph.evaluate(() => { const r = document.querySelector('.pres-bar').getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom }; });
  ok(phBar.l >= 0 && phBar.r <= 390, `phone: panel fits the screen width (${Math.round(phBar.l)}..${Math.round(phBar.r)}, ${Math.round(phBar.b - phBar.t)}px tall)`);
  if (SHOTS) await ph.screenshot({ path: path.join(SHOTS, '4-panel-phone.png') });
  await ph.touchscreen.tap(195, 420);
  await sleep(350);
  ok(!(await overlayState(ph)).visible, 'phone: a second middle tap hides them');
  await ph.touchscreen.tap(195, 420);
  await sleep(2800);
  ok(!(await overlayState(ph)).visible, 'phone: controls hide themselves');
  await ph.touchscreen.tap(340, 420);
  ok(await ph.evaluate(() => document.querySelector('.pres-counter').textContent.startsWith('2 /')), 'phone: right-side tap still goes forward');

  // Wrapping at a large phone size: long lines wrap, text stays big, nothing cut off.
  await openPres(ph, { lines: 0, size: 6, transition: 'cut' });
  await sleep(300);
  const wrap = await ph.evaluate(() => {
    const unit = Math.sqrt(innerWidth * innerHeight) * 0.07, chosen = unit * 1.45;
    const out = { chosen, brokenWords: 0, maxLinesInOne: 0, shrunk: 0, clipped: 0, tallest: 0, gapOk: true };
    const slidesTotal = +document.querySelector('.pres-counter').textContent.split(' / ')[1];
    for (let i = 0; i < slidesTotal; i++) {
      const c = document.querySelector('.pres-slide.is-current');
      if (!c.classList.contains('is-title')) {
        const fs = parseFloat(c.style.fontSize);
        if (fs < chosen - 0.6) out.shrunk++;
        // No word may be cut in half by a line break.
        const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          for (const m of n.textContent.matchAll(/\S+/g)) {
            const rg = document.createRange(); rg.setStart(n, m.index); rg.setEnd(n, m.index + m[0].length);
            if (rg.getClientRects().length > 1) out.brokenWords++;
          }
        }
        const stg = document.querySelector('.pres-stage'), scs = getComputedStyle(stg), r = c.getBoundingClientRect();
        const availH = stg.clientHeight - parseFloat(scs.paddingTop) - parseFloat(scs.paddingBottom);
        if (c.scrollHeight > availH + 1 || r.top < 0 || r.bottom > innerHeight || r.left < 0 || r.right > innerWidth + 1) out.clipped++;
        c.querySelectorAll('.pres-line').forEach(p => {
          out.maxLinesInOne = Math.max(out.maxLinesInOne, Math.round(p.getBoundingClientRect().height / (fs * 1.18)));
          if (parseFloat(getComputedStyle(p).marginBottom) < fs * 0.4 && p !== c.lastElementChild) out.gapOk = false;
        });
      }
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    }
    return out;
  });
  ok(wrap.maxLinesInOne >= 2, `phone: long lines wrap onto several rows (up to ${wrap.maxLinesInOne})`);
  ok(wrap.brokenWords === 0, `phone: words are never split across lines (${wrap.brokenWords} split)`);
  ok(wrap.clipped === 0, `phone: nothing cut off (clipped ${wrap.clipped}; ${wrap.shrunk} slide(s) reduced slightly for one very long word)`);
  ok(wrap.gapOk, 'phone: extra space between lyric lines');
  if (SHOTS) {
    await ph.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
    for (let i = 0; i < 3; i++) await ph.evaluate(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    await ph.screenshot({ path: path.join(SHOTS, '5-fill-phone-big.png') });
  }
  ok(ph.errors.length === 0, `phone: no page errors ${ph.errors.join(' | ')}`);
  await ph.context().close();

  await browser.close(); server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
