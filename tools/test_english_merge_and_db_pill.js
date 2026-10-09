'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const databases = {
  english: 3143,
  hymn: 695,
  mongolian: 360,
  mongolian2: 1433,
};
for (const [folder, count] of Object.entries(databases)) {
  const bundle = JSON.parse(read(`data/${folder}/database.json`));
  const manifest = JSON.parse(read(`data/${folder}/manifest.json`));
  assert.equal(bundle.count, count, `${folder}: count`);
  assert.equal(bundle.songs.length, count, `${folder}: bundle length`);
  assert.equal(manifest.length, count, `${folder}: manifest length`);
  const ids = bundle.songs.map(s => s.id);
  assert.equal(new Set(ids).size, count, `${folder}: duplicate IDs`);
  assert.deepEqual(new Set(manifest), new Set(ids.map(id => `${id}.json`)), `${folder}: manifest coverage`);
  for (const song of bundle.songs) {
    assert.deepEqual(JSON.parse(read(`data/${folder}/${song.id}.json`)), song, `${folder}: ${song.id} differs from bundle`);
  }
}
const registry = read('js/song-sources.js');
assert.match(registry, /english:\s*Object\.freeze\([\s\S]*?bundlePrimary:\s*true/);
const app = read('js/app.js');
assert.match(app, /if \(DB_SOURCES\[sourceKey\]\.bundlePrimary\) \{/);
assert.match(app, /const shouldSync = !bundlePrimary &&/);
assert.match(app, /if \(bundlePrimary\) \{[\s\S]*?await fetchSongBundleSnapshot\(sourceKey\)/);
const css = read('css/style.css');
assert.match(css, /\.seg-toggle \{[^}]*--seg-inset:\s*2px;[^}]*padding:\s*var\(--seg-inset\);/);
assert.match(css, /\.seg-toggle-thumb \{[^}]*top:\s*var\(--seg-inset\);\s*bottom:\s*var\(--seg-inset\);\s*left:\s*var\(--seg-inset\);/);
assert.match(css, /\.db-picker-tabs\.seg-toggle\s*\{\s*--seg-inset:\s*3px;\s*\}/);
console.log('English 3,143 + remaining 2,488 songs: bundle, IDs, manifest, individual songs PASS');
console.log('English bundle-primary code path and DB selector shared inset PASS');
