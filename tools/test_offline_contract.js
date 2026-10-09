/* Offline contract: one atomic cache contains every normal app dependency and
   every shipped database bundle. */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const sw = read('service-worker.js');
const app = read('js/app.js');
const html = read('index.html');
const offline = read('offline.html');

const m = sw.match(/const\s+REQUIRED_OFFLINE\s*=\s*\[([\s\S]*?)\n\];/);
assert.ok(m, 'REQUIRED_OFFLINE array missing');
const required = new Set(Array.from(m[1].matchAll(/^\s*['"]([^'"]+)['"],?/gm), x => x[1].replace(/^\.\//,'')));

// Every local JS/CSS/manifest dependency in index is installed atomically.
for (const hit of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["']/gi)) {
  let ref = hit[1];
  if (/^(?:https?:|data:|#)/i.test(ref)) continue;
  ref = ref.split('?')[0].split('#')[0].replace(/^\.\//,'');
  if (!ref || !/\.(?:js|css|json)$/i.test(ref)) continue;
  assert.ok(required.has(ref), `index dependency missing from atomic cache: ${ref}`);
}

// Runtime icon registry must be complete offline.
const iconBlock = app.match(/const ICON_FILES\s*=\s*\{([\s\S]*?)\n\};/);
assert.ok(iconBlock, 'ICON_FILES registry missing');
const icons = new Set(Array.from(iconBlock[1].matchAll(/['"](icons\/svg\/[^'"]+\.svg)['"]/g), x => x[1]));
for (const icon of icons) assert.ok(required.has(icon), `runtime icon missing from atomic cache: ${icon}`);

// All shipped database snapshots are application assets, not runtime cache luck.
for (const db of [
  'data/english/database.json',
  'data/hymn/database.json',
  'data/mongolian/database.json',
  'data/mongolian2/database.json',
]) {
  assert.ok(required.has(db), `database snapshot missing from atomic cache: ${db}`);
  assert.ok(fs.existsSync(path.join(ROOT,db)), `database snapshot file missing: ${db}`);
}

assert.ok(required.has('data/sheet-music/catalog.js'), 'Sheet Music catalog missing');
assert.ok(required.has('data/sheet-music/assets/sda/h108-amazing-grace.svg'), 'Sheet Music proof page missing');
assert.ok(required.has('offline.html'), 'offline.html missing from atomic cache');
assert.ok(!/persistResponseForOffline/.test(app), 'page-side Cache Storage bridge should be removed');
assert.ok(!/SONGDATA_CACHE|SHEET_MUSIC_ASSET_CACHE|BEST_EFFORT_ASSETS/.test(sw), 'old multi-cache strategy still present');
assert.ok(/cache\.addAll\(REQUIRED_OFFLINE\)/.test(sw), 'required assets are not installed atomically');
assert.ok(!/\.catch\(\(\)\s*=>\s*\{?\s*\}?\)/.test(sw), 'install failures must not be swallowed');
assert.ok(!/<(?:script|link|img)\b[^>]*(?:src|href)=["'](?:https?:|\/|\.\/)/i.test(offline), 'offline.html must be self-contained');

console.log(`Simple offline contract passed: ${required.size} atomic assets, ${icons.size} runtime icons, 4 database snapshots, Sheet Music, and self-contained fallback.`);
