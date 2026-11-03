'use strict';
const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
let notices = [], status = 200, offline = false, browser;
const server = http.createServer((q, r) => {
  if (offline) { q.socket.destroy(); return; }
  const url = new URL(q.url, 'http://localhost');
  if (!url.pathname.startsWith('/ngworship/')) { r.writeHead(404); r.end(); return; }
  if (url.pathname === '/ngworship/announcements.json') {
    r.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    r.end(typeof notices === 'string' ? notices : JSON.stringify(notices)); return;
  }
  const file = path.join(root, url.pathname.slice('/ngworship/'.length) || 'index.html');
  fs.readFile(file, (e, d) => { r.writeHead(e ? 404 : 200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' }); r.end(e ? 'not found' : d); });
});
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await ctx.newPage(), errors = [], dialogs = [];
  let decision = 'accept';
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async d => { dialogs.push(d.message()); if (decision === 'dismiss') await d.dismiss(); else await d.accept(); });
  const base = `http://127.0.0.1:${server.address().port}/ngworship/`;
  async function ready() {
    await page.waitForFunction(() => typeof state !== 'undefined' && state.sources.official.loaded && state.sources.user.loaded);
    await page.locator('#splash-screen').waitFor({ state: 'hidden' });
    await page.evaluate(() => { state.lang = 'en'; applyLanguage(); });
  }
  await page.goto(base); await ready();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  assert.equal(await page.locator('#app-announcements').isVisible(), false);
  await page.evaluate(() => showPage('user-songs', { pushHistory: true }));
  await page.locator('#new-user-song-btn').click();
  await page.locator('#editor-back-btn').click();
  await page.waitForFunction(() => state.currentPage === 'user-songs'); assert.equal(dialogs.length, 0);
  console.log('PASS unchanged editor leaves without prompting');
  await page.locator('#new-user-song-btn').click(); await page.locator('#editor-title').fill('Unsaved proof');
  await page.locator('#editor-lyrics').fill('[C]Ө Ү unsaved lyrics');
  decision = 'dismiss'; await page.locator('#editor-back-btn').click();
  await page.waitForFunction(() => history.state.page === 'song-editor');
  assert.equal(await page.locator('#editor-title').inputValue(), 'Unsaved proof'); assert.equal(dialogs.length, 1);
  await page.goBack(); await page.waitForFunction(() => history.state.page === 'song-editor'); assert.equal(dialogs.length, 2);
  decision = 'accept'; await page.goBack(); await page.waitForFunction(() => state.currentPage === 'user-songs');
  assert.equal(await page.evaluate(() => state.sources.user.songs.length), 0);
  console.log('PASS Back/Close and browser Back: cancel preserves draft/history; discard exits without saving');
  await page.locator('#new-user-song-btn').click(); await page.locator('#editor-title').fill('Reverted'); await page.locator('#editor-title').fill('');
  const count = dialogs.length; await page.locator('#editor-back-btn').click();
  await page.waitForFunction(() => state.currentPage === 'user-songs'); assert.equal(dialogs.length, count);
  await page.locator('#new-user-song-btn').click();
  await page.evaluate(() => { state.editorLabelsDraft = ['label-only-change']; });
  decision = 'dismiss'; await page.evaluate(() => showPage('settings', { pushHistory: true }));
  assert.equal(await page.evaluate(() => state.currentPage), 'song-editor'); assert.equal(dialogs.length, count + 1);
  decision = 'accept'; await page.evaluate(() => showPage('user-songs', { pushHistory: true }));
  console.log('PASS reverted fields do not prompt; label-only changes and direct in-app navigation do');
  await page.locator('#new-user-song-btn').click(); await page.locator('#editor-title').fill('Saved proof'); await page.locator('#editor-lyrics').fill('[G]Saved lyrics');
  const beforeSave = dialogs.length; await page.locator('#editor-save-btn').click();
  await page.waitForFunction(() => state.currentPage === 'user-songs' && state.sources.user.songs.some(s => s.title === 'Saved proof'));
  assert.equal(dialogs.length, beforeSave);
  await page.evaluate(() => openSongEditor(state.sources.user.songs.find(s => s.title === 'Saved proof')));
  await page.locator('#editor-title').fill('Changed'); await page.locator('#editor-delete-btn').click();
  await page.locator('#delete-song-confirm').click(); await page.waitForFunction(() => state.currentPage !== 'song-editor');
  assert.equal(dialogs.length, beforeSave);
  console.log('PASS successful save and confirmed delete leave without an extra discard prompt');
  await page.evaluate(() => { showPage('settings', { pushHistory: true }); showPage('user-songs', { pushHistory: true }); });
  await page.locator('#new-user-song-btn').click(); await page.locator('#editor-title').fill('Multi-step history');
  decision = 'dismiss'; await page.evaluate(() => history.go(-2));
  await page.waitForFunction(() => history.state.page === 'song-editor' && !editorHistoryRecovery);
  assert.equal(await page.locator('#editor-title').inputValue(), 'Multi-step history');
  decision = 'accept'; await page.evaluate(() => history.go(-2)); await page.waitForFunction(() => state.currentPage === 'settings');
  await page.goForward(); await page.goForward(); await page.waitForFunction(() => state.currentPage === 'song-editor');
  await page.evaluate(() => showPage('settings', { pushHistory: true }));
  await page.goBack(); await page.waitForFunction(() => state.currentPage === 'song-editor');
  await page.locator('#editor-title').fill('Forward history'); decision = 'dismiss'; await page.goForward();
  await page.waitForFunction(() => history.state.page === 'song-editor' && !editorHistoryRecovery);
  assert.equal(await page.locator('#editor-title').inputValue(), 'Forward history');
  decision = 'accept'; await page.goForward(); await page.waitForFunction(() => state.currentPage === 'settings');
  console.log('PASS multi-entry Back and Forward cancellation restores the exact editor history entry after branching');
  notices = [
    { id: 'feature-proof', mode: 'once', display: 'banner', title: 'New feature', text: 'A new feature is available.' },
    { id: 'maintenance-proof', mode: 'every-open', display: 'banner', title: 'Maintenance', text: 'Online updates may be unavailable. Offline reading still works.' },
    { id: 'expired', mode: 'every-open', display: 'banner', text: 'Expired', endsAt: '2000-01-01T00:00:00Z' },
    { id: 'future', mode: 'every-open', display: 'banner', text: 'Future', startsAt: '2100-01-01T00:00:00Z' },
    { id: 'bad-date', mode: 'once', display: 'banner', text: 'Bad date', endsAt: 'invalid' },
    { id: 'bad-mode', mode: 'invalid', text: 'Bad mode' },
  ];
  await page.reload(); await ready(); await page.waitForFunction(() => document.querySelectorAll('.announcement').length === 2);
  assert.match(await page.locator('#app-announcements').innerText(), /New feature/);
  await page.evaluate(() => { showPage('settings'); showPage('songs'); }); assert.equal(await page.locator('.announcement').count(), 2);
  await page.locator('.announcement-dismiss').first().click(); assert.equal(await page.locator('.announcement').count(), 1);
  await page.evaluate(() => { showPage('settings'); showPage('songs'); }); assert.equal(await page.locator('.announcement').count(), 1);
  await page.reload(); await ready(); await page.waitForFunction(() => document.querySelectorAll('.announcement').length === 1);
  assert.match(await page.locator('.announcement').innerText(), /Maintenance/);
  await page.locator('.announcement-dismiss').click(); assert.equal(await page.locator('#app-announcements').isVisible(), false);
  await page.reload(); await ready(); await page.waitForFunction(() => document.querySelectorAll('.announcement').length === 1);
  console.log('PASS once/every-open modes, per-launch dismissal, no repeat on page navigation, scheduled/expired/invalid entries');
  notices = [{ id: 'feature-proof-v2', mode: 'once', display: 'banner', title: 'New version', text: '<img src=x onerror=alert(1)> Plain text only' }];
  await page.reload(); await ready(); await page.waitForFunction(() => document.querySelectorAll('.announcement').length === 1);
  assert.equal(await page.locator('.announcement img').count(), 0); assert.match(await page.locator('.announcement').innerText(), /<img/);
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const qa = process.env.QA_DIR;
  if (qa) {
    fs.mkdirSync(qa, { recursive: true });
    await page.evaluate(() => {
      announcements = [{ id: 'screenshot-example', mode: 'every-open', display: 'banner', title: "What's new", text: 'Note names are now available inside Chord Finder.' }];
      renderAnnouncements();
    });
    for (const [width, height] of [[320, 640], [390, 844], [844, 390]]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => renderAnnouncements());
      const geometry = await page.evaluate(() => {
        const nav = document.getElementById('bottom-nav').getBoundingClientRect();
        const banner = document.getElementById('app-announcements').getBoundingClientRect();
        const buttons = document.querySelector('.bottom-nav-inner').getBoundingClientRect();
        const padding = parseFloat(getComputedStyle(document.querySelector('#page-songs > .page-inner')).paddingBottom);
        return { nav: nav.height, bannerBottom: banner.bottom, buttonsTop: buttons.top, padding, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert(geometry.bannerBottom <= geometry.buttonsTop + 1);
      assert(geometry.padding >= geometry.nav + 39, JSON.stringify(geometry));
      assert.equal(geometry.overflow, false);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    console.log('PASS navigation banner reserves content space without covering buttons at 320px, 390px and landscape');
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
      await page.waitForTimeout(400); await page.screenshot({ path: path.join(qa, `announcement-${theme}.png`) });
    }
  }
  await page.evaluate(() => openSong(state.sources.official.songs[0], { sourceKey: 'official' }));
  assert.equal(await page.locator('#app-announcements').isVisible(), false);
  await page.goBack(); await page.waitForFunction(() => state.currentPage === 'songs');
  assert(await page.locator('#app-announcements').isVisible());
  await page.evaluate(() => showPage('settings', { pushHistory: true }));
  assert(await page.locator('#app-announcements').isVisible());
  await page.evaluate(() => showPage('song-display', { pushHistory: true }));
  assert.equal(await page.locator('#app-announcements').isVisible(), false);
  await page.reload(); await ready();
  assert.equal(await page.locator('#app-announcements').isVisible(), false);
  notices = [{ id: 'removal-proof', mode: 'every-open', display: 'banner', text: 'Remove this notice' }];
  await page.reload(); await ready(); await page.waitForFunction(() => document.querySelectorAll('.announcement').length === 1);
  status = 404; await page.reload(); await ready();
  assert.equal(await page.locator('#app-announcements').isVisible(), false);
  status = 200;
  notices = [
    { id: 'normal-once', mode: 'once', title: 'Normal notice', text: 'An ordinary one-time announcement.' },
    { id: 'normal-repeat', mode: 'every-open', text: 'An ordinary announcement on each launch.' },
  ];
  await page.reload(); await ready(); await page.locator('.announcement-messages').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#app-announcements').isVisible(), false);
  assert.match(await page.locator('.announcement-messages').innerText(), /one-time/);
  if (qa) await page.screenshot({ path: path.join(qa, 'ordinary-announcement-dialog.png') });
  await page.locator('.announcement-messages .btn-primary').click();
  await page.evaluate(() => { showPage('settings'); showPage('songs'); });
  assert.equal(await page.locator('.announcement-messages').isVisible(), false);
  await page.reload(); await ready(); await page.locator('.announcement-messages').waitFor({ state: 'visible' });
  assert.doesNotMatch(await page.locator('.announcement-messages').innerText(), /one-time/);
  assert.match(await page.locator('.announcement-messages').innerText(), /each launch/);
  await page.locator('#modal-close-btn').click();
  await page.evaluate(() => { showPage('settings'); showPage('songs'); });
  assert.equal(await page.locator('.announcement-messages').isVisible(), false);
  console.log('PASS default ordinary dialog: once/every-open, one Done button, close-button dismissal and no repeat during navigation');
  console.log('PASS urgent banner lives inside navigation, remains on main tabs, and hides in songs/full-screen settings');
  status = 200; notices = '{bad json'; await page.reload(); await ready();
  assert.equal(await page.locator('#app-announcements').isVisible(), false);
  notices = []; offline = true; await ctx.setOffline(true); await page.goto('about:blank');
  await page.goto(base); await ready(); assert.equal(await page.locator('#app-announcements').isVisible(), false);
  assert(await page.evaluate(() => !!navigator.serviceWorker.controller));
  console.log('PASS new IDs, plain-text rendering, missing/removed/malformed file, and offline launch with no stale banner');
  assert.deepEqual(errors, []); console.log('ALL PASS');
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close(); server.closeAllConnections(); server.close();
});
