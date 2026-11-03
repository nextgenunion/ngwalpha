'use strict';
// Synthetic data only. Exports from one browser context and restores into
// another empty context; it never opens the installed app or personal data.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer((q, r) => {
  const file = path.join(root, new URL(q.url, 'http://localhost').pathname.replace(/\/$/, '/index.html'));
  fs.readFile(file, (err, data) => {
    r.writeHead(err ? 404 : 200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
    r.end(err ? 'not found' : data);
  });
});
let browser;
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE });
  const errors = [];
  async function fresh() {
    const ctx = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: true });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => typeof state !== 'undefined' && state.sources.official.loaded && state.sources.user.loaded);
    // Complete the same startup loads before writing the fixture.
    await page.evaluate(async () => { await Promise.all([loadUserSongs(), loadPlaylists(), loadPersonalLabels(), loadTrash()]); });
    return { ctx, page };
  }
  const source = await fresh();
  await source.page.evaluate(async () => {
    await saveUserSong({ id: 'u_backup_proof', title: 'Backup proof Ө Ү', lyrics: ['[C]Туршилт', '[Am]Backup proof'], artist: 'Synthetic fixture', key: 'C', labels: ['fixture'], links: [], sheetMusic: [] });
    state.personalLabels = { bySongRef: { 'user:u_backup_proof': ['custom-label'], 'official:s001': ['official-label'] } };
    await LabelStorage.save(state.personalLabels);
    state.playlists = { order: ['favorites', 'pl_proof'], byId: {
      favorites: { id: 'favorites', name: '', isFavorites: true, songs: [{ sourceKey: 'user', songId: 'u_backup_proof' }] },
      pl_proof: { id: 'pl_proof', name: 'Backup set', isFavorites: false, songs: [{ sourceKey: 'official', songId: 's001' }, { sourceKey: 'user', songId: 'u_backup_proof' }] },
    } };
    await PlaylistStorage.save(state.playlists);
  });
  async function exported(fn) {
    const pending = source.page.waitForEvent('download');
    await source.page.evaluate(fn);
    const download = await pending;
    return JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  }
  const songs = await exported(() => exportUserSongs());
  const playlists = await exported(() => exportPlaylists());
  assert.equal(songs.songs[0].id, 'u_backup_proof');
  assert.equal(playlists.byId.pl_proof.songs[1].songId, 'u_backup_proof');
  console.log('PASS actual exports contain custom song content, stable IDs and playlist references');
  const target = await fresh();
  await target.page.evaluate(async playlists => {
    await importPlaylistsFromFile({ text: async () => JSON.stringify(playlists) });
  }, playlists);
  assert.equal(await target.page.evaluate(() => !!findSongByRef('user', 'u_backup_proof')), false);
  console.log('CONFIRMED playlist export alone does not contain or restore custom song content');
  await target.page.evaluate(async songs => {
    await importUserSongsFromFile({ text: async () => JSON.stringify(songs) });
  }, songs);
  await target.page.reload();
  await target.page.waitForFunction(() => typeof state !== 'undefined' && state.sources.user.loaded);
  await target.page.evaluate(async () => { await Promise.all([loadUserSongs(), loadPlaylists(), loadPersonalLabels()]); });
  const restored = await target.page.evaluate(() => ({ song: findSongByRef('user', 'u_backup_proof'), playlists: state.playlists, labels: state.personalLabels }));
  assert.equal(restored.song.title, 'Backup proof Ө Ү');
  assert.deepEqual(restored.song.lyrics, songs.songs[0].lyrics);
  assert.deepEqual(restored.playlists, playlists);
  assert.deepEqual(restored.labels.bySongRef['user:u_backup_proof'], ['custom-label']);
  console.log('PASS both exports restore custom lyrics/chords, IDs, Favorites, playlist order/references and custom-song personal labels after reload');
  assert.equal(restored.labels.bySongRef['official:s001'], undefined);
  console.log('CONFIRMED personal labels on built-in songs are not covered by these two exports');
  const before = await target.page.evaluate(() => JSON.stringify(state.sources.user.songs));
  await target.page.evaluate(async songs => {
    const invalid = { ...songs, songs: [songs.songs[0], songs.songs[0]] };
    await importUserSongsFromFile({ text: async () => JSON.stringify(invalid) });
  }, songs);
  assert.equal(await target.page.evaluate(() => JSON.stringify(state.sources.user.songs)), before);
  console.log('PASS invalid duplicate-ID import leaves existing custom songs intact');
  assert.deepEqual(errors, []);
  console.log('ALL PASS; confirmed backup coverage limits are reported above');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (browser) await browser.close();
  server.closeAllConnections(); server.close();
});
