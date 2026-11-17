'use strict';
const assert = require('node:assert/strict');
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
assert.match(version, /SONGBOOK_VERSION_NUMBER = '5\.1\.2'/);
assert.match(pres, /boldItalic: 'fontStyleBoldItalic'/);
assert.match(pres, /adv\.fontStyle === 'boldItalic'/);
assert.match(pres, /ital,wght@0,400;0,700;1,400;1,700/);
assert.match(pres, /function mediaControls\(translate, refresh\)/);
assert.match(pres, /container\.append\(preview, section, media, text, titles, resetSection\)/);
assert.doesNotMatch(html, /id="page-presentation-advanced"/);
assert.doesNotMatch(app, /'presentation-advanced':\s*\{/);
assert.doesNotMatch(pres, /presentation-advanced-nav-row/);
assert.match(pres, /const modes = segControl\(translate, 'presPreviewLabel'/);
assert.match(pres, /sample\.appendChild\(card\)/);
assert.match(pres, /titlePrefs\.presTitleSlide !== false/);
assert.match(pres, /function snapshot\(\)/);
assert.match(pres, /index, queuePosition, anchor: anchorOf\(slides\[index\]\)/);
assert.match(ui, /presentationSettingsResume = window\.SongPresentation\.snapshot\(\)/);
assert.match(ui, /openPresentationMode\(\{ resume \}\)/);
assert.match(ui, /if \(!resume\) pushNavState\(/);
assert.match(css, /text-shadow: 0 \.045em \.12em .*0 \.09em \.24em/s);
assert.match(pres, /const TRANSITIONS = \['cut', 'fade'\]/);
for (const file of ['eng.js','mn.js','mn2.js','kr.js']) {
  const lang = source('lang/' + file);
  for (const key of ['presPreviewLabel', 'presPreviewLyrics', 'presPreviewTitle', 'presPreviewExampleTitle','presPreviewExampleArtist','fontStyleBoldItalic']) {
    assert.match(lang, new RegExp('\\b' + key + ': '), file + ' missing ' + key);
  }
}
console.log('Presentation v5.1.2 contract PASS');
