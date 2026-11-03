'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
let offline = false, browser;
const server = http.createServer((q, r) => {
  if (offline) { q.socket.destroy(); return; }
  const url = new URL(q.url, 'http://localhost');
  if (!url.pathname.startsWith('/ngworship/') || url.pathname.endsWith('/announcements.json')) { r.writeHead(404); r.end(); return; }
  const file = path.join(root, url.pathname.slice('/ngworship/'.length) || 'index.html');
  fs.readFile(file, (e, d) => { r.writeHead(e ? 404 : 200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' }); r.end(e ? 'not found' : d); });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const base = `http://127.0.0.1:${server.address().port}/ngworship/`;
  const ready = async () => {
    await page.waitForFunction(() => typeof state !== 'undefined' && state.sources.official.loaded);
    await page.locator('#splash-screen').waitFor({ state: 'hidden' });
    await page.evaluate(() => { state.lang = 'en'; applyLanguage(); });
  };
  const unlock = async () => {
    await page.locator('.nav-btn[data-nav="settings"]').click();
    await page.locator('#about-nav-row').click();
    await page.locator('.about-logo').click({ clickCount: 3 });
    await page.waitForFunction(() => state.devUnlocked);
    await page.locator('#about-back-btn').click();
    await page.locator('#dev-options-nav-row').click();
    await page.waitForFunction(() => state.currentPage === 'dev-options');
  };
  await page.goto(base); await ready();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.evaluate(() => { previewAnnouncement('dialog'); previewAnnouncement('banner'); });
  assert.equal(await page.locator('#modal-overlay').isVisible(), false);
  assert.equal(await page.evaluate(() => state.devAnnouncementBanner), false);
  await unlock();
  await page.evaluate(() => {
    localStorage.setItem('ngw_seen_announcements', JSON.stringify(['real-once']));
    announcements = [{ id: 'real-once', mode: 'once', title: 'Real content', text: 'Already seen' }];
    dismissedAnnouncements.add('real-dismissed'); shownAnnouncements.add('real-shown');
  });
  const snapshot = () => page.evaluate(() => JSON.stringify({ seen: localStorage.getItem('ngw_seen_announcements'), items: announcements, dismissed: [...dismissedAnnouncements], shown: [...shownAnnouncements] }));
  const before = await snapshot();
  for (let i = 0; i < 2; i++) {
    await page.locator('#dev-preview-dialog-btn').click();
    assert.equal(await page.locator('#modal-title').innerText(), 'Preview');
    assert.match(await page.locator('.announcement-messages').innerText(), /test announcement/);
    await page.locator('.announcement-messages .btn-primary').click();
  }
  assert.equal(await snapshot(), before);
  await page.locator('#dev-preview-banner-btn').click();
  await page.waitForFunction(() => state.currentPage === 'songs');
  assert.match(await page.locator('#app-announcements').innerText(), /test banner/);
  await page.locator('.nav-btn[data-nav="settings"]').click();
  assert(await page.locator('#app-announcements').isVisible());
  await page.evaluate(() => openSong(state.sources.official.songs[0], { sourceKey: 'official' }));
  assert.equal(await page.locator('#app-announcements').isVisible(), false);
  await page.goBack(); await page.waitForFunction(() => state.currentPage === 'settings');
  await page.locator('.announcement-dismiss').click();
  assert.equal(await page.evaluate(() => state.devAnnouncementBanner), false);
  assert.equal(await snapshot(), before);
  console.log('PASS developer unlock, repeatable dialog/banner previews, real notice/seen/dismissed state unchanged, banner hides in songs');
  await page.locator('#dev-options-nav-row').click();
  for (const lang of ['en', 'mn', 'mn2', 'kr']) {
    await page.evaluate(lang => { state.lang = lang; applyLanguage(); }, lang);
    await page.setViewportSize({ width: 320, height: 640 });
    assert.equal(await page.locator('#dev-preview-dialog-btn').innerText(), await page.evaluate(() => t('devPreviewDialog')));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { state.lang = 'en'; applyLanguage(); });
  if (process.env.QA_DIR) {
    fs.mkdirSync(process.env.QA_DIR, { recursive: true });
    await page.locator('#t-devAnnouncementPreview').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(process.env.QA_DIR, 'developer-previews.png') });
  }
  await page.locator('#dev-preview-banner-btn').click();
  await page.reload(); await ready();
  assert.equal(await page.evaluate(() => state.devAnnouncementBanner), false);
  assert.equal(await page.locator('#app-announcements').isVisible(), false);
  assert.equal(await page.evaluate(() => localStorage.getItem('ngw_seen_announcements')), '["real-once"]');
  console.log('PASS four translated interfaces at 320px, preview resets on reload, and seen IDs remain intact');
  offline = true; await ctx.setOffline(true); await page.reload(); await ready();
  await unlock(); await page.locator('#dev-preview-dialog-btn').click();
  assert(await page.locator('.announcement-messages').isVisible());
  await page.locator('#modal-close-btn').click(); await page.locator('#dev-preview-banner-btn').click();
  assert(await page.locator('#app-announcements').isVisible());
  assert.deepEqual(errors, []);
  console.log('PASS both previews offline with no announcement file, no browser errors');
  console.log('ALL PASS');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); server.closeAllConnections(); server.close();
});
