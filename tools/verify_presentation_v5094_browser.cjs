// Browser check for the 5.0.94 presentation changes (js/presentation.js, ui.js, lang/*.js).
//   NODE_PATH=$(npm root -g) CHROMIUM_EXECUTABLE=... node tools/verify_presentation_v5094_browser.cjs
// Covers: full screen on open (and remembering a deliberate exit), Blank / Full
// screen / Settings buttons, Settings handoff + history, the first-launch hint,
// longer touch timeout, the Mongolian name "Үзүүлэн", and the picture/video
// background being remembered on this device (IndexedDB, never Cache Storage).
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
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 1x1 red PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE });
  const errors = [];
  async function boot(opts = {}, init) {
    const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' }, opts));
    if (init) await ctx.addInitScript(init);
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`http://localhost:${server.address().port}/`);
    await page.waitForFunction(() => typeof state !== 'undefined' && typeof openSong === 'function' && document.querySelectorAll('#song-list > *').length > 5, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    return { ctx, page };
  }
  const openPresentation = async (page) => {
    await page.evaluate(() => {
      const k = state.activeDbSource, s = state.sources[k].songs.find(x => x.lyrics && x.lyrics.some(l => /\[/.test(l)));
      if (!state.activeSong || state.activeSong.id !== s.id) openSong(s, { sourceKey: k });
    });
    await page.waitForTimeout(400);
    await page.click('#sv-menu-btn');
    await page.click('#sv-kebab-presentation'); // a real click: the user gesture full screen needs
    await page.waitForSelector('#presentation-overlay');
    await page.waitForTimeout(400);
  };
  const isFull = (page) => page.evaluate(() => !!document.fullscreenElement && document.fullscreenElement.id === 'presentation-overlay');
  const showPanel = async (page) => { if (!(await page.evaluate(() => document.getElementById('presentation-overlay').classList.contains('controls-visible')))) await page.keyboard.press('s'); await sleep(350); };
  const closeOverlay = async (page) => { await page.evaluate(() => closePresentationMode()); await page.waitForFunction(() => !SongPresentation.isOpen()); await page.waitForTimeout(300); };

  // ---------- 1. full screen, Blank, Settings ----------
  {
    const { ctx, page } = await boot({}, () => { localStorage.setItem('sb-pres-intro', JSON.stringify({ n: 9, done: true })); });
    await openPresentation(page);
    ok(await isFull(page), 'opening presentation mode asks for full screen and gets it');
    await showPanel(page);
    ok(await page.evaluate(() => document.querySelector('[data-pres="fullscreen"]').getAttribute('aria-pressed') === 'true'), 'Full screen button shows it is on');
    ok(await page.evaluate(() => !document.querySelector('[data-pres="fullscreen"] .pres-fs-off').hidden && document.querySelector('[data-pres="fullscreen"] .pres-fs-on').hidden), 'Full screen button swaps to the exit icon');

    // leave on purpose → remembered; reopen stays windowed
    await page.keyboard.press('f');
    await page.waitForFunction(() => !document.fullscreenElement);
    await page.waitForTimeout(200);
    ok(await page.evaluate(() => localStorage.getItem('sb-pres-fs') === '0'), 'leaving full screen on purpose is remembered');
    await closeOverlay(page);
    await openPresentation(page);
    ok(!(await isFull(page)), 'next launch respects that and stays windowed');
    await showPanel(page);
    await page.click('[data-pres="fullscreen"]');
    await page.waitForFunction(() => !!document.fullscreenElement);
    ok(await isFull(page) && await page.evaluate(() => localStorage.getItem('sb-pres-fs') === '1'), 'the Full screen button goes back in and is remembered');
    await page.waitForTimeout(200);
    await showPanel(page);

    // Blank
    await page.click('[data-pres="blank"]');
    ok(await page.evaluate(() => document.querySelector('.pres-stage').classList.contains('is-blank') && document.querySelector('[data-pres="blank"]').getAttribute('aria-pressed') === 'true'), 'Blank button hides the lyrics and shows it is on');
    await page.click('[data-pres="blank"]');
    ok(await page.evaluate(() => !document.querySelector('.pres-stage').classList.contains('is-blank') && document.querySelector('[data-pres="blank"]').getAttribute('aria-pressed') === 'false'), 'Blank button toggles back');
    await page.keyboard.press('b');
    ok(await page.evaluate(() => document.querySelector('[data-pres="blank"]').getAttribute('aria-pressed') === 'true'), 'the B key keeps the button in step');
    await page.keyboard.press('ArrowRight');
    ok(await page.evaluate(() => document.querySelector('[data-pres="blank"]').getAttribute('aria-pressed') === 'false'), 'changing slide un-blanks and updates the button');

    // Settings handoff
    const histBefore = await page.evaluate(() => history.length);
    await showPanel(page);
    await page.click('[data-pres="settings"]');
    await page.waitForFunction(() => state.currentPage === 'presentation-settings');
    ok(await page.evaluate(() => !SongPresentation.isOpen() && !document.fullscreenElement), 'Settings button leaves the presentation (and full screen)');
    ok(await page.evaluate(() => !history.state || !history.state.presentation), 'the presentation history entry is not left behind');
    ok(await page.evaluate(() => history.length) === histBefore + 1, 'one history entry added for the Settings page');
    await page.goBack();
    await page.waitForFunction(() => state.currentPage === 'song-view');
    ok(await page.evaluate(() => state.currentPage === 'song-view' && !SongPresentation.isOpen() && !!state.activeSong), 'Back from Settings returns to the song');
    await ctx.close();
  }

  // ---------- 2. no element full screen (iPhone Safari) ----------
  {
    const { ctx, page } = await boot({}, () => {
      Object.defineProperty(Document.prototype, 'fullscreenEnabled', { get: () => false });
      Object.defineProperty(Document.prototype, 'webkitFullscreenEnabled', { get: () => false });
      localStorage.setItem('sb-pres-intro', JSON.stringify({ n: 9, done: true }));
    });
    await openPresentation(page);
    await showPanel(page);
    ok(await page.evaluate(() => document.querySelector('[data-pres="fullscreen"]').hidden === true && !document.fullscreenElement), 'where full screen is unavailable the button is hidden and nothing breaks');
    ok(await page.evaluate(() => !document.querySelector('[data-pres="blank"]').hidden && !document.querySelector('[data-pres="settings"]').hidden), 'Blank and Settings are still offered');
    await ctx.close();
  }

  // ---------- 3. first-launch hint ----------
  {
    const { ctx, page } = await boot({}, () => { if (!localStorage.getItem('sb-pres-fs')) localStorage.setItem('sb-pres-fs', '0'); });
    await openPresentation(page);
    ok(await page.evaluate(() => document.getElementById('presentation-overlay').classList.contains('show-intro')), 'first launch shows the hint');
    ok(await page.evaluate(() => /S/.test(document.querySelector('.pres-intro').textContent)), 'mouse hint names the S key');
    ok(await page.evaluate(() => JSON.parse(localStorage.getItem('sb-pres-intro')).n === 1), 'launch is counted');
    await page.waitForTimeout(5200);
    ok(await page.evaluate(() => !document.getElementById('presentation-overlay').classList.contains('show-intro')), 'the hint goes away by itself');
    await closeOverlay(page);
    await openPresentation(page);
    await page.keyboard.press('s');
    await page.waitForTimeout(300);
    ok(await page.evaluate(() => !document.getElementById('presentation-overlay').classList.contains('show-intro') && JSON.parse(localStorage.getItem('sb-pres-intro')).done === true), 'opening the panel ends the hint for good');
    await closeOverlay(page);
    await openPresentation(page);
    ok(await page.evaluate(() => !document.getElementById('presentation-overlay').classList.contains('show-intro') && JSON.parse(localStorage.getItem('sb-pres-intro')).n === 2), 'later launches stay clean');
    await ctx.close();
  }
  {
    const { ctx, page } = await boot({}, () => { localStorage.setItem('sb-pres-fs', '0'); if (!localStorage.getItem('sb-pres-intro')) localStorage.setItem('sb-pres-intro', JSON.stringify({ n: 4, done: false })); });
    await openPresentation(page);
    ok(await page.evaluate(() => !document.getElementById('presentation-overlay').classList.contains('show-intro')), 'the hint stops after four launches even if never discovered');
    await ctx.close();
  }

  // ---------- 4. touch: hint wording and a longer-lived panel ----------
  {
    const { ctx, page } = await boot({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, () => { localStorage.setItem('sb-pres-fs', '0'); });
    await openPresentation(page);
    ok(await page.evaluate(() => document.querySelector('.pres-intro').textContent === t('presentationIntroTouch')), 'touch hint talks about tapping, not a key');
    await page.touchscreen.tap(195, 420); await page.touchscreen.tap(195, 420);
    await sleep(400);
    ok(await page.evaluate(() => document.getElementById('presentation-overlay').classList.contains('controls-visible')), 'double-tap opens the panel');
    await sleep(3500);
    ok(await page.evaluate(() => document.getElementById('presentation-overlay').classList.contains('controls-visible')), 'on touch the panel is still open after 3.5 s');
    await sleep(3200);
    ok(await page.evaluate(() => !document.getElementById('presentation-overlay').classList.contains('controls-visible')), 'and closes itself after about 6 s');
    const fits = await page.evaluate(() => { document.getElementById('presentation-overlay').classList.add('controls-visible'); const r = document.querySelector('.pres-bar').getBoundingClientRect(); return r.left >= 0 && r.right <= 390; });
    ok(fits, 'the panel with its new icons still fits a 390px phone');
    await ctx.close();
  }

  // ---------- 5. Mongolian name ----------
  {
    const { ctx, page } = await boot({}, () => { localStorage.setItem('sb-ui-lang', 'mn'); localStorage.setItem('sb-pres-fs', '0'); });
    await page.evaluate(() => { const k = state.activeDbSource; openSong(state.sources[k].songs[0], { sourceKey: k }); });
    await page.waitForTimeout(400);
    await page.click('#sv-menu-btn');
    ok(await page.evaluate(() => document.getElementById('sv-kebab-presentation').textContent.trim() === 'Үзүүлэн'), 'song menu calls it Үзүүлэн');
    await page.click('#sv-kebab-presentation');
    await page.waitForSelector('#presentation-overlay');
    ok(await page.evaluate(() => document.querySelector('[data-pres="close"]').getAttribute('aria-label') === 'Үзүүлэнгээс гарах' && document.getElementById('presentation-overlay').getAttribute('aria-label') === 'Үзүүлэн'), 'exit label and dialog name use Үзүүлэн');
    await page.evaluate(() => { SongPresentation.close(); showPage('settings'); });
    await page.waitForTimeout(400);
    ok(await page.evaluate(() => document.getElementById('t-presSettingsTitle').textContent === 'Үзүүлэн'), 'Settings row uses the same word');
    await ctx.close();
  }

  // ---------- 6. picture/video remembered on this device ----------
  {
    const { ctx, page } = await boot({}, () => { localStorage.setItem('sb-pres-fs', '0'); localStorage.setItem('sb-pres-intro', JSON.stringify({ n: 9, done: true })); });
    await page.evaluate(() => { ['sb-pres-background', 'sb-pres-adv'].forEach(k => localStorage.removeItem(k)); showPage('presentation-advanced'); });
    await page.waitForTimeout(500);
    ok(await page.evaluate(() => document.getElementById('pres-background-remove').hidden === true), 'Remove is hidden while no picture is chosen');
    await page.setInputFiles('#pres-background-file', { name: 'church.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForFunction(() => /church\.png/.test(document.getElementById('pres-media-status').textContent) && document.getElementById('pres-media-status').textContent.includes(t('presFileSaved')), null, { timeout: 8000 });
    ok(true, 'status says the file is saved on this device');
    ok(await page.evaluate(() => JSON.parse(localStorage.getItem('sb-pres-adv')).dim === 30 && document.querySelector('.pres-range').value === '30'), 'a new picture starts dimmed to 30%');
    ok(await page.evaluate(() => !document.getElementById('pres-background-remove').hidden), 'Remove appears');

    // nothing goes into Cache Storage; the file is in IndexedDB
    const where = await page.evaluate(async () => {
      const names = await caches.keys();
      let inCache = false;
      for (const n of names) { const c = await caches.open(n); for (const r of await c.keys()) if (/church\.png/.test(r.url)) inCache = true; }
      const db = await new Promise((res, rej) => { const r = indexedDB.open('ngw-presentation'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const rec = await new Promise((res) => { const r = db.transaction('media').objectStore('media').get('background'); r.onsuccess = () => res(r.result); });
      db.close();
      return { inCache, name: rec && rec.name, size: rec && rec.blob && rec.blob.size };
    });
    ok(!where.inCache && where.name === 'church.png' && where.size === PNG.length, `file is in IndexedDB, not in Cache Storage (${JSON.stringify(where)})`);

    // restart the page: the background is still there, no re-selecting
    await page.reload();
    await page.waitForFunction(() => typeof state !== 'undefined' && typeof openSong === 'function' && document.querySelectorAll('#song-list > *').length > 5, null, { timeout: 30000 });
    await page.waitForTimeout(1200);
    await openPresentation(page);
    const bg = await page.evaluate(() => { const i = document.querySelector('#presentation-overlay .pres-bg img'); return i ? { src: i.src.slice(0, 5), w: i.naturalWidth } : null; });
    ok(bg && bg.src === 'blob:' && bg.w === 1, 'after restarting the app the picture is already the background');
    await closeOverlay(page);
    await page.evaluate(() => showPage('presentation-advanced'));
    await page.waitForTimeout(500);
    ok(await page.evaluate(() => document.getElementById('pres-media-status').textContent.includes(t('presFileSaved'))), 'Advanced still says saved after a restart');

    // Remove clears memory and storage
    await page.click('#pres-background-remove');
    await page.waitForTimeout(400);
    const gone = await page.evaluate(async () => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('ngw-presentation'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const rec = await new Promise((res) => { const r = db.transaction('media').objectStore('media').get('background'); r.onsuccess = () => res(r.result); });
      db.close();
      return { rec: !!rec, bg: JSON.parse(localStorage.getItem('sb-pres-background')).kind };
    });
    ok(!gone.rec && gone.bg === 'preset', 'Remove deletes the saved file and returns to a colour');
    ok(await page.evaluate(() => document.getElementById('pres-media-status').textContent === '' && document.getElementById('pres-background-remove').hidden), 'the Advanced row resets');

    // choosing a colour on the main page also removes it
    await page.setInputFiles('#pres-background-file', { name: 'again.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForFunction(() => document.getElementById('pres-media-status').textContent.includes(t('presFileSaved')), null, { timeout: 8000 });
    await page.evaluate(() => showPage('presentation-settings'));
    await page.waitForTimeout(400);
    await page.click('[data-pres-background="white"]');
    await page.waitForTimeout(400);
    const gone2 = await page.evaluate(async () => {
      const db = await new Promise((res, rej) => { const r = indexedDB.open('ngw-presentation'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const rec = await new Promise((res) => { const r = db.transaction('media').objectStore('media').get('background'); r.onsuccess = () => res(r.result); });
      db.close();
      return !!rec;
    });
    ok(!gone2, 'choosing a colour removes the saved picture too');

    // a saved choice whose file is gone says so instead of failing silently
    await page.evaluate(() => { localStorage.setItem('sb-pres-background', JSON.stringify({ kind: 'media', media: 'image', name: 'lost.png' })); showPage('presentation-advanced'); });
    await page.waitForTimeout(600);
    ok(await page.evaluate(() => document.getElementById('pres-media-status').textContent === 'lost.png — ' + t('presFileMissing')), 'a missing file is reported');
    ok(await page.evaluate(() => document.querySelector('#presentation-advanced-content .settings-row-actions .btn-secondary').textContent === t('presRelinkMedia')), 'and the button offers to choose it again');

    // oversize or failed saves still work for this session and say so
    await page.evaluate(() => { localStorage.removeItem('sb-pres-background'); showPage('presentation-settings'); showPage('presentation-advanced'); });
    await page.waitForTimeout(400);
    await page.evaluate(() => { const real = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function () { throw new DOMException('quota', 'QuotaExceededError'); }; window.__restorePut = () => { IDBObjectStore.prototype.put = real; }; });
    await page.setInputFiles('#pres-background-file', { name: 'huge.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForFunction(() => document.getElementById('pres-media-status').textContent.includes(t('presFileNotSaved')), null, { timeout: 8000 });
    ok(await page.evaluate(() => document.querySelector('#presentation-advanced-content .pres-bg img') !== null), 'when it cannot be saved the picture still shows for this session, with an honest message');
    await page.evaluate(() => window.__restorePut());
    await ctx.close();
  }

  ok(errors.length === 0, `no page errors ${errors.join(' | ')}`);
  await browser.close(); server.close();
  console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
