/* Gradient paint: the optional Position (balance) value, old saved gradients, and the colour hint CSS. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const src = fs.readFileSync(path.resolve(__dirname, '../js/presentation.js'), 'utf8');
const a = src.indexOf('  function readPaint(value) {');
const b = src.indexOf('  function paintLuminance(value) {');
assert.ok(a > 0 && b > a, 'paint helpers found');
const ctx = vm.createContext({ Number, Math, HEX: /^#[0-9a-f]{6}$/i, out: null });
vm.runInContext(src.slice(a, b) + '\nout = { readPaint, paintCss };', ctx);
const { readPaint, paintCss } = ctx.out;

// A gradient saved before Position existed still loads, centred, with the same CSS as before.
const old = readPaint({ start: '#112233', end: '#445566', angle: 90 });
assert.equal(old.position, 50);
assert.equal(paintCss(old), 'linear-gradient(90deg, #112233, #445566)');
assert.equal(paintCss({ start: '#112233', end: '#445566', angle: 90 }), 'linear-gradient(90deg, #112233, #445566)');

// Moving Position adds a colour hint at that point.
assert.equal(paintCss(readPaint({ start: '#112233', end: '#445566', angle: 180, position: 30 })), 'linear-gradient(180deg, #112233, 30%, #445566)');
// Out-of-range values are clamped; plain colours are untouched; bad data is rejected.
assert.equal(readPaint({ start: '#112233', end: '#445566', angle: 0, position: 400 }).position, 100);
assert.equal(readPaint({ start: '#112233', end: '#445566', angle: 0, position: -5 }).position, 0);
assert.equal(paintCss('#abcdef'), '#abcdef');
assert.equal(readPaint({ start: 'red', end: '#445566', angle: 0 }), null);
console.log('Presentation gradient paint PASS: Position hint, clamping and old saved gradients');
