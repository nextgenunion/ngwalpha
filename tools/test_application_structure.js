'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const required = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8').match(/const REQUIRED_OFFLINE = \[([\s\S]*?)\];/)[1];
const core = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const refs = [...core.matchAll(/\/\* @extracted:([a-z-]+\.js):(\w+) \*\//g)];
const names = new Set();
for (const [, file, name] of refs) {
  assert(!names.has(name), `Duplicate extraction: ${name}`); names.add(name);
  const module = fs.readFileSync(path.join(root, 'js', file), 'utf8');
  assert.equal(module.split(`/* @begin:${name} */`).length, 2, `Missing/duplicate definition: ${name}`);
  assert.equal(module.split(`/* @end:${name} */`).length, 2, `Missing/duplicate end: ${name}`);
}
for (const file of ['song-engine.js', 'data.js', 'settings.js', 'ui.js']) {
  const tag = `<script src="js/${file}" defer></script>`;
  assert(html.includes(tag) && html.indexOf(tag) < html.indexOf('<script src="js/app.js" defer>'), `Load ${file} before app.js`);
  assert(required.includes(`'./js/${file}'`), `Required offline: ${file}`);
  new vm.Script(fs.readFileSync(path.join(root, 'js', file), 'utf8'), { filename: file });
}
const reconstructed = require('./read_application.cjs').readApplication();
assert(!reconstructed.includes('@extracted:'), 'Unresolved function reference');
new vm.Script(reconstructed);
console.log(`PASS application split: ${names.size} unique extracted definitions, valid scripts, deferred load order and atomic offline coverage`);
