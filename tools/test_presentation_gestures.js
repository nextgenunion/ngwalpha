'use strict';
// Exercise the actual stage handlers without a browser. Real touch-device
// rendering and gesture behavior still need browser/device verification.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, '../js/presentation.js'), 'utf8');
const handlers = source.slice(source.indexOf('  function onStagePointerDown('), source.indexOf('  function onVisibility('));
const context = { window: { innerWidth: 390 }, performance: { now: () => context.time }, time: 0 };
vm.runInNewContext(`
  const SWIPE_PX = ${source.match(/const SWIPE_PX = (\d+)/)[1]};
  const DOUBLE_CLICK_MS = ${source.match(/const DOUBLE_CLICK_MS = (\d+)/)[1]};
  let swipe = null, lastMiddleClick = null, index = 2, visible = false, toggles = 0;
  function go(n) { index = n; }
  function controlsVisible() { return visible; }
  function showControls() { visible = true; toggles++; }
  function hideControls() { visible = false; toggles++; }
  ${handlers}
  globalThis.api = {
    down: onStagePointerDown, up: onStagePointerUp,
    state: () => ({ index, visible, toggles }),
    reset() { swipe = lastMiddleClick = null; index = 2; visible = false; toggles = 0; }
  };
`, context);
const { api } = context;
function event(x, y = 400, type = 'touch', bar = false, id = 1) {
  return { clientX: x, clientY: y, pointerType: type, pointerId: id, target: { closest: () => bar } };
}
function tap(x = 195, delay = 100, type = 'touch', y = 400) {
  context.time += delay; const e = event(x, y, type); api.down(e); api.up(e);
}
tap(); assert.equal(api.state().visible, false);
tap(207); assert.equal(api.state().visible, true); assert.equal(api.state().toggles, 1); assert.equal(api.state().index, 2);
tap(); assert.equal(api.state().visible, true);
tap(); assert.equal(api.state().visible, false); assert.equal(api.state().toggles, 2);
api.reset(); tap(); tap(195, 500); assert.equal(api.state().visible, false);
api.reset(); tap(); tap(230); assert.equal(api.state().visible, false);
api.reset(); tap(); tap(195, 100, 'mouse'); assert.equal(api.state().visible, false);
api.reset(); tap(); tap(350); tap(); assert.equal(api.state().visible, false); assert.equal(api.state().index, 3);
api.reset(); tap(); api.down(event(320)); api.up(event(200)); tap(); assert.equal(api.state().visible, false); assert.equal(api.state().index, 3);
api.reset(); tap(); api.down(event(195, 50, 'touch', true)); api.up(event(195, 50, 'touch', true)); tap(); assert.equal(api.state().visible, false);
api.reset(); tap(); api.down(event(195)); api.up(event(195, 400, 'touch', false, 2)); tap(); assert.equal(api.state().visible, false);
api.reset(); tap(195, 100, 'mouse'); tap(195, 100, 'mouse'); assert.equal(api.state().visible, true);
api.reset(); tap(30); assert.equal(api.state().index, 1); assert.equal(api.state().visible, false);
console.log('PASS presentation gestures: double-tap toggles once, single/slow/distant taps stay quiet, side/swipe navigation, panel/pointer interruption, mouse behavior');
