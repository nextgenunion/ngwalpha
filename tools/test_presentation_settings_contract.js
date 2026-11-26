'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const pres = source('js/presentation.js');
const ui = source('js/ui.js');
const app = source('js/app.js');
const html = source('index.html');
const css = source('css/14-presentation.css');
const version = source('version.js');
assert.match(version, /SONGBOOK_VERSION_NUMBER = '5\.1\.\d+'/);
assert.match(pres, /boldItalic: 'fontStyleBoldItalic'/);
assert.match(pres, /adv\.fontStyle === 'boldItalic'/);
assert.match(pres, /ital,wght@0,400;0,700;1,400;1,700/);
assert.match(pres, /function mediaControls\(translate, refresh\)/);
assert.match(pres, /titles\.appendChild\(resetRow\)/);
assert.match(pres, /container\.append\(preview, tabs, text, media, effects, titles\)/);
// Background colour lives in the Background section, text colour in the Text section.
assert.match(pres, /media\.insertBefore\(plainRow, media\.firstChild\)/);
assert.match(pres, /media\.insertBefore\(gradientRow, media\.firstChild\)/);
// Reset and the title-slide switches share the Other tab; Effect and Transition share Effects.
assert.match(pres, /titles\.appendChild\(resetRow\)/);
assert.match(pres, /effects\.appendChild\(settingsRow\(translate, 'presEffect'/);
assert.match(pres, /text\.appendChild\(textColorRow\)/);
assert.doesNotMatch(pres, /presLook/);
assert.doesNotMatch(html, /id="page-presentation-advanced"/);
assert.doesNotMatch(app, /'presentation-advanced':\s*\{/);
assert.doesNotMatch(pres, /presentation-advanced-nav-row/);
assert.match(pres, /wrap\.append\(preview, dots\)/);
assert.doesNotMatch(pres, /pres-preview-arrow/);
assert.match(css, /\.pres-dot\[aria-current="true"\]::after/);
assert.match(pres, /sample\.replaceChildren\(buildCard\(slide\)\)/);
assert.doesNotMatch(pres, /presPreviewLabel/);
assert.doesNotMatch(pres, /sb-pres-fs/);
assert.match(pres, /titlePrefs\.presTitleSlide !== false/);
assert.match(pres, /function snapshot\(\)/);
assert.match(pres, /index, queuePosition, anchor: anchorOf\(slides\[index\]\)/);
assert.match(ui, /presentationSettingsResume = window\.SongPresentation\.snapshot\(\)/);
assert.match(ui, /openPresentationMode\(\{ resume \}\)/);
assert.match(ui, /if \(!resume\) pushNavState\(/);
assert.match(css, /text-shadow:\s+calc\(\.025em \* var\(--pres-fx-size\)\) calc\(\.045em \* var\(--pres-fx-size\)\) calc\(\.15em \* var\(--pres-fx-size\)\)/);
assert.match(css, /-webkit-text-stroke: calc\(\.06em \* var\(--pres-fx-size\)\)/);
assert.match(css, /background-clip: text/);
assert.match(pres, /const TRANSITIONS = \['cut', 'fade', 'dip', 'blur'\]/);
for (const file of ['eng.js','mn.js','mn2.js','kr.js']) {
  const lang = source('lang/' + file);
  for (const key of ['presPreviewLabel', 'presPreviewLyrics', 'presPreviewTitle', 'presPreviewExampleTitle','presPreviewExampleArtist','fontStyleBoldItalic']) {
    assert.match(lang, new RegExp('\\b' + key + ': '), file + ' missing ' + key);
  }
}
// Exercise the preference migration and render variables together.
const storage = new Map();
const context = { window: {}, localStorage: {
  getItem: key => storage.get(key),
  setItem: (key, value) => storage.set(key, value),
} };
const end = pres.lastIndexOf('})();');
assert.ok(end > 0);
vm.runInNewContext(pres.slice(0, end) + '\nwindow.check = { loadAdvanced, applyTone, paintCss };\n' + pres.slice(end), context);
const props = new Map();
const attributes = new Map();
const node = {
  dataset: {},
  style: { setProperty: (key, value) => props.set(key, value) },
  toggleAttribute: (key, value) => attributes.set(key, value),
};
const { loadAdvanced, applyTone, paintCss } = context.window.check;
function load(values) {
  storage.set('sb-pres-adv', JSON.stringify(values));
  loadAdvanced();
  applyTone(node);
}
load({ textColor: '#abcdef', bgColor: '#ffffff', effect: 'shadow' });
assert.equal(props.get('--pres-text'), '#abcdef');
assert.equal(props.get('--pres-fx'), '#000000');
assert.equal(props.get('--pres-fx-size'), '1');
assert.equal(attributes.get('data-text-gradient'), false);
const textColor = { angle: 120, start: '#6633cc', end: '#ffee00' };
const effects = { glow: { color: '#fa1290', strength: 85 }, outline: { strength: 25 } };
load({ textColor, effect: 'glow', effects });
assert.equal(props.get('--pres-text-gradient'), paintCss(textColor));
assert.equal(attributes.get('data-text-gradient'), true);
assert.equal(props.get('--pres-fx'), '#fa1290');
assert.equal(props.get('--pres-fx-size'), '1.7');
load({ textColor, effect: 'outline', effects });
assert.equal(props.get('--pres-fx-size'), '0.5');
assert.equal(props.get('--pres-fx'), '#000000');
load({ textColor: { ...textColor, end: 'invalid' }, effect: 'none' });
assert.equal(attributes.get('data-text-gradient'), false);
// Sliding pills: re-placed when shown/resized, and never white-on-nothing while unplaced.
assert.match(pres, /new ResizeObserver\(/);
assert.match(pres, /setAttribute\('data-pending', ''\)/);
assert.match(css, /\.seg-toggle\[data-pending\] \.seg-toggle-btn\[aria-pressed="true"\]/);
console.log('Presentation settings and paint preferences PASS');
