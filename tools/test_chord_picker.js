'use strict';
// No browser dependency: verify the small picker never creates a chord the
// central parser rejects, and all UI translations/HTML controls ship together.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const ctx = { console, localStorage: { getItem() { return null; }, setItem() {} } };
ctx.window = ctx;
ctx.document = { getElementById() { return null; }, documentElement: { getAttribute() { return 'letters'; } } };
ctx.matchMedia = () => ({ matches: false });
vm.runInNewContext(read('js/chord-core.js'), ctx);
const marker = '  /* ---------- MODULE 7 — EVENTS & INIT ---------- */';
vm.runInNewContext(read('js/chord-finder.js').replace(marker, '  window.__testPicker = Picker;\n' + marker), ctx);
const picker = ctx.__testPicker;
assert(picker, 'picker is available within the chord finder');
assert.equal(picker.roots.length, 12, 'all twelve chromatic roots');
assert.equal(new Set(picker.roots).size, 12, 'no duplicate roots');
assert.equal(picker.qualities.length, 7, 'short quality list');
let combinations = 0;
for (const quality of picker.qualities) {
  for (const [extra, suffix] of Object.entries(quality.extras)) {
    assert(ctx.ChordCore.TYPES.some(item => item.suffix === suffix), `Unsupported ${quality.id} + ${extra}`);
    for (const rootName of picker.roots) {
      const parsed = ctx.ChordCore.parse(rootName + suffix);
      assert(parsed && parsed.suffix === suffix, `Bad chord: ${rootName}${suffix}`);
      combinations++;
    }
  }
}
const html = read('index.html');
for (const id of ['cf-picker-toggle', 'cf-picker', 'cf-picker-root', 'cf-picker-quality', 'cf-picker-extra']) {
  assert(html.includes(`id="${id}"`), `missing ${id}`);
}
const langKeys = [
  'cfPickerOpen', 'cfPickerClose', 'cfPickerNote', 'cfPickerType', 'cfPickerExtra',
  'cfPickerNone', 'cfPickerMajor', 'cfPickerMinor', 'cfPickerSus2',
  'cfPickerSus4', 'cfPickerDim', 'cfPickerAug', 'cfPickerPower',
];
for (const lang of ['eng', 'mn', 'mn2', 'kr']) {
  vm.runInNewContext(read(`lang/${lang}.js`), ctx);
  const code = lang === 'eng' ? 'en' : lang;
  for (const key of langKeys) {
    assert(Object.hasOwn(ctx.SONGBOOK_LANG[code], key), `${lang}: missing ${key}`);
  }
}
console.log(`PASS chord picker: 12 roots × ${combinations / 12} valid quality/extra combinations, all controls and 4 languages`);
