/* Regression checks for the future-ready Sheet Music subsystem. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const manifestPath = path.join(ROOT, 'data', 'sheet-music', 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
assert.strictEqual(manifest.schemaVersion, 1, 'Sheet Music schema version must remain explicit');
assert.ok(Array.isArray(manifest.entries) && manifest.entries.length > 0, 'Sheet Music catalog needs entries');

const ids = new Set();
const songRefs = new Set();
for (const entry of manifest.entries) {
  assert.ok(entry.id && entry.sourceKey && entry.songId, `Bad Sheet Music entry: ${JSON.stringify(entry)}`);
  assert.ok(!ids.has(entry.id), `Duplicate Sheet Music id: ${entry.id}`);
  ids.add(entry.id);
  const ref = `${entry.sourceKey}:${entry.songId}`;
  assert.ok(!songRefs.has(ref), `Duplicate Sheet Music song ref: ${ref}`);
  songRefs.add(ref);
  assert.ok(Array.isArray(entry.pages) && entry.pages.length, `${entry.id} needs at least one page`);
  for (const page of entry.pages) {
    assert.ok(page.src && typeof page.src === 'string', `${entry.id} has invalid page src`);
    if (!/^https?:\/\//i.test(page.src)) {
      assert.ok(fs.existsSync(path.join(ROOT, page.src.replace(/^\.\//, ''))), `${entry.id} local page missing: ${page.src}`);
    }
  }
  assert.ok(Array.isArray(entry.attributions), `${entry.id} attributions must be an array`);
  for (const credit of entry.attributions) {
    assert.ok(credit.label && credit.url && credit.license, `${entry.id} attribution is incomplete`);
  }
}

// Resolve every entry against the canonical song-source registry and real song file.
const sourceContext = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'song-sources.js'), 'utf8'), sourceContext);
const registry = sourceContext.window.SongSourceRegistry;
assert.ok(registry, 'SongSources registry failed to initialize');
for (const entry of manifest.entries) {
  const def = registry.databases[entry.sourceKey];
  assert.ok(def, `${entry.id} references unknown source ${entry.sourceKey}`);
  const songPath = path.join(ROOT, 'data', def.folder, `${entry.songId}.json`);
  assert.ok(fs.existsSync(songPath), `${entry.id} references missing song file ${songPath}`);
  const song = JSON.parse(fs.readFileSync(songPath, 'utf8'));
  assert.strictEqual(String(song.id), entry.songId, `${entry.id} song id mismatch`);
}

// Exercise the actual catalog module with a mocked local fetch.
const sheetContext = {
  window: {},
  fetch: async (url) => {
    assert.strictEqual(url, './data/sheet-music/manifest.json');
    return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(manifest)) };
  },
  console,
};
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'sheet-music.js'), 'utf8'), sheetContext);
(async () => {
  const api = sheetContext.window.SheetMusicCatalog;
  assert.ok(api, 'SheetMusicCatalog failed to initialize');
  assert.ok(fs.readFileSync(path.join(ROOT, 'js', 'sheet-music.js'), 'utf8').includes('unsupported src scheme'),
    'Catalog page src scheme validation is missing');
  await api.load();
  assert.strictEqual(api.list('sda').length, manifest.entries.filter(e => e.sourceKey === 'sda').length);
  for (const entry of manifest.entries) {
    assert.strictEqual(api.getForSong(entry.sourceKey, entry.songId).id, entry.id);
    assert.strictEqual(api.getById(entry.id).songId, entry.songId);
  }

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(html.includes('id="page-sheet-music"'), 'Sheet Music library page missing');
  assert.ok(html.includes('id="page-sheet-view"'), 'Sheet Music viewer page missing');
  assert.ok(html.includes('id="dev-sheet-music-toggle"'), 'Sheet Music developer toggle missing');
  assert.ok(html.includes('id="sheet-music-nav-btn"'), 'Sheet Music nav button missing');
  assert.ok(html.includes('id="sv-sheet-music-btn"'), 'Song-view Sheet Music button missing');
  assert.ok(html.includes('src="js/sheet-music.js"'), 'Sheet Music module script missing');

  const config = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
  assert.ok(/sheetMusic\s*:\s*false/.test(config), 'Sheet Music must remain dev/WIP-gated by default');

  const sw = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
  assert.ok(sw.includes("'./js/sheet-music.js'"), 'Sheet Music module must be in core shell');
  assert.ok(sw.includes("'./data/sheet-music/manifest.json'"), 'Sheet Music manifest must be seeded for offline use');
  assert.ok(sw.includes('SHEET_MUSIC_ASSET_CACHE'), 'Remote sheet pages need stable runtime caching');

  console.log(`Sheet Music tests passed: ${manifest.entries.length} entries, ${manifest.entries.reduce((n,e)=>n+e.pages.length,0)} pages.`);
})().catch((err) => { console.error(err); process.exit(1); });
