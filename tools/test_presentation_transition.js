/* Slide transitions: ids, speed scale, saved-setting compatibility and labels in every language. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js/presentation.js'), 'utf8');

// Speed scale: 1 = slowest (1.5 s) ... 10 = fastest (0.15 s); the default is about the old 300 ms.
const a = src.indexOf('  const SPEED_STEPS = ');
const b = src.indexOf('  const BLUR_PX');
assert.ok(a > 0 && b > a, 'speed constants found');
const ctx = vm.createContext({ Math, out: null });
vm.runInContext(src.slice(a, b) + '\nout = { SPEED_STEPS, DEFAULT_SPEED, speedMs };', ctx);
const { SPEED_STEPS, DEFAULT_SPEED, speedMs } = ctx.out;
assert.equal(speedMs(1), 1500);
assert.equal(speedMs(SPEED_STEPS), 150);
for (let i = 2; i <= SPEED_STEPS; i++) assert.ok(speedMs(i) < speedMs(i - 1), 'faster steps are shorter');
assert.ok(Math.abs(speedMs(DEFAULT_SPEED) - 300) <= 50, 'default speed is close to the old 300 ms');

// 'fade' stays the crossfade id, so settings saved by older versions keep their behaviour.
assert.match(src, /const TRANSITIONS = \['cut', 'fade', 'dip', 'blur'\]/);
assert.match(src, /const DEFAULT_TRANSITION = 'fade'/);

// Fade and Blur wait for the old slide to leave; Crossfade overlaps. Reduced motion still cuts.
assert.match(src, /effectiveTransition\(\) !== 'fade'; \/\/ Fade and Blur/);
assert.match(src, /effectiveTransition\(\) !== 'cut' && typeof Element\.prototype\.animate/);

// Every language names all four transitions and the speed control.
const keys = ['presentationCut', 'presentationFade', 'presentationDip', 'presentationBlur', 'presentationTransitionSpeed'];
for (const lang of ['eng', 'kr', 'mn', 'mn2']) {
  const text = fs.readFileSync(path.join(ROOT, 'lang', lang + '.js'), 'utf8');
  for (const key of keys) assert.match(text, new RegExp('  ' + key + ': \"[^\"]+\"'), lang + ' has ' + key);
}
const mn = fs.readFileSync(path.join(ROOT, 'lang/mn.js'), 'utf8');
assert.match(mn, /presentationCut: "Шууд"/);
assert.match(mn, /presentationFade: "Уусах"/);
assert.match(mn, /presentationDip: "Бүдгэрэх"/);
console.log('Presentation transitions PASS: speed scale, ids, sequencing and labels in four languages');
