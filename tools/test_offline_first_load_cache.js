/* Regression guard: offline completeness belongs to service-worker install,
   not ad-hoc page-side Cache Storage writes. */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const ROOT = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(ROOT,'js/app.js'),'utf8');
const sw = fs.readFileSync(path.join(ROOT,'service-worker.js'),'utf8');
assert.ok(!/persistResponseForOffline/.test(app), 'page still contains old first-load cache bridge');
assert.ok(/data\/english\/database\.json/.test(sw));
assert.ok(/data\/hymn\/database\.json/.test(sw));
assert.ok(/data\/mongolian\/database\.json/.test(sw));
assert.ok(/data\/mongolian2\/database\.json/.test(sw));
console.log('Offline ownership passed: service-worker atomic install owns all database snapshots; page-side cache bridge absent.');
