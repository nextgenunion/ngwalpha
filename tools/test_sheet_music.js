/* Regression checks for the future-ready Sheet Music subsystem. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const catalogDataPath = path.join(ROOT, 'data', 'sheet-music', 'catalog.js');
const catalogDataCode = fs.readFileSync(catalogDataPath, 'utf8');
const dataContext = { window: {} };
vm.runInNewContext(catalogDataCode, dataContext);
const manifest = dataContext.window.NGW_SHEET_MUSIC_CATALOG;
assert.ok(manifest, 'Sheet Music static data registry failed to initialize');
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
    if (!/^https?:/i.test(page.src)) {
      const localAsset = path.join(ROOT, page.src);
      assert.ok(fs.existsSync(localAsset), `${entry.id} local score asset is missing: ${page.src}`);
      assert.ok(fs.statSync(localAsset).size > 0, `${entry.id} local score asset is empty: ${page.src}`);
    }
  }
  assert.ok(Array.isArray(entry.attributions), `${entry.id} attributions must be an array`);
  for (const credit of entry.attributions) assert.ok(credit.label && credit.url && credit.license, `${entry.id} attribution is incomplete`);
}

// Resolve every official entry against the canonical source registry + song file.
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

// Exercise the real catalog module with the static registry: no runtime fetch.
const sheetContext = { window: { NGW_SHEET_MUSIC_CATALOG: manifest }, console };
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'js', 'sheet-music.js'), 'utf8'), sheetContext);
(async () => {
  const api = sheetContext.window.SheetMusicCatalog;
  assert.ok(api, 'SheetMusicCatalog failed to initialize');
  await api.load();
  assert.strictEqual(api.list('sda').length, manifest.entries.filter(e => e.sourceKey === 'sda').length);
  assert.ok(api.list('sda').length >= 1, 'English SDA source should expose at least one proof-of-concept score');
  assert.ok(api.list('sda').some(e => e.songId === 'h108'), 'Amazing Grace proof-of-concept score missing');
  for (const entry of manifest.entries) {
    assert.strictEqual(api.getForSong(entry.sourceKey, entry.songId).id, entry.id);
    assert.strictEqual(api.getById(entry.id).songId, entry.songId);
  }

  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(html.includes('id="page-sheet-music"'), 'Sheet Music library page missing');
  assert.ok(html.includes('id="page-sheet-view"'), 'Sheet Music viewer page missing');
  assert.ok(html.includes('id="dev-sheet-music-toggle"'), 'Separate Sheet Music developer toggle missing');
  assert.ok(html.includes('id="sheet-music-nav-btn"') && /id="sheet-music-nav-btn"[^>]*hidden/.test(html), 'Sheet Music nav must start hidden');
  assert.ok(html.includes('id="sv-sheet-music-btn"') && /id="sv-sheet-music-btn"[^>]*hidden/.test(html), 'Song-view Sheet Music button must start hidden');
  assert.ok(!html.includes('sheet-music-dev-note'), 'Removed WIP preview description must not remain');
  assert.ok(html.indexOf('data/sheet-music/catalog.js') < html.indexOf('js/sheet-music.js'), 'Catalog data must load before catalog API');

  const css = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');
  assert.ok(/\.nav-btn\[hidden\][\s\S]*?display:\s*none/.test(css), 'nav-btn[hidden] override missing');
  assert.ok(/\.icon-btn\[hidden\][\s\S]*?display:\s*none/.test(css), 'icon-btn[hidden] override missing');

  const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  assert.ok(/devSheetMusic:\s*false/.test(app), 'Sheet Music developer preview must default OFF');
  const unlock = app.slice(app.indexOf('function unlockDevOptions()'), app.indexOf('function bindDevOptionsUnlock()'));
  assert.ok(!/devSheetMusic\s*=/.test(unlock), 'Unlocking Developer Options must not enable Sheet Music');
  assert.ok(/toggle\.setAttribute\('aria-checked', String\(state\.devSheetMusic\)\)/.test(app), 'Sheet Music toggle must reflect its own preview state');
  assert.ok(/const entry = window\.SheetMusicCatalog\.getForSong[\s\S]*?if \(!entry\) return;[\s\S]*?btn\.hidden = false;/.test(app), 'Song Sheet Music button must show only for catalog-backed songs');

  const config = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8');
  assert.ok(/sheetMusic\s*:\s*false/.test(config), 'Sheet Music must remain non-production by default');

  const sw = fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8');
  assert.ok(sw.includes("'./data/sheet-music/catalog.js'"), 'Static Sheet Music catalog must be in atomic offline install');
  assert.ok(sw.includes("'./data/sheet-music/assets/sda/h108-amazing-grace.svg'"), 'Packaged proof score must be in atomic offline install');
  assert.ok(!sw.includes('SHEET_MUSIC_ASSET_CACHE'), 'Sheet Music should not reintroduce a separate cache strategy');
  assert.ok(/cache\.addAll\(REQUIRED_OFFLINE\)/.test(sw), 'Sheet Music must inherit the same atomic offline contract as the rest of the app');

  console.log(`Sheet Music tests passed: ${manifest.entries.length} entries, ${manifest.entries.reduce((n,e)=>n+e.pages.length,0)} packaged page(s); gating/catalog/atomic-offline checks passed.`);
})().catch((err) => { console.error(err); process.exit(1); });
