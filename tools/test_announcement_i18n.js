/* Regression tests for language-specific announcements.
   Runs the actual resolver function extracted from the shipped JS files. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const version = fs.readFileSync(path.join(ROOT, 'version.js'), 'utf8').match(/var SONGBOOK_VERSION_NUMBER = '([^']+)'/)[1];
const isV5 = version.startsWith('5.');
const file = path.join(ROOT, isV5 ? 'js/ui.js' : 'js/announcements.js');
const src = fs.readFileSync(file, 'utf8');
const start = src.indexOf('function ngwResolveAnnouncement(');
const end = src.indexOf(isV5 ? '/* @begin:renderAnnouncements */' : 'function seenSet()', start);
assert.ok(start >= 0 && end > start, 'Announcement resolver is present');
const source = src.slice(start, end) + '\nresolve = ngwResolveAnnouncement;';
const ctx = vm.createContext({resolve: null, Map, String, Object, Array});
vm.runInContext(source, ctx, {filename: file});
const resolve = (notice, lang) => ctx.resolve(notice, lang);
const original = {
  id:'n1', mode:'once', display:'banner',
  translations: {
    en: {title:'News', text:'English body'},
    mn: {title:'Мэдээлэл', text:'Монгол мэдээ'},
    kr: {title:'공지', text:'한국어'},
    mn2: {title:'ᠮᠡᠳᠡᠭᠡ', text:'ᠮᠣᠩᠭᠣᠯ'}
  }
};
assert.equal(resolve(original, 'en').text, 'English body');
assert.equal(resolve(original, 'mn').text, 'Монгол мэдээ');
assert.equal(resolve(original, 'kr').text, '한국어');
assert.equal(resolve(original, 'ko').text, '한국어');
assert.equal(resolve(original, 'mn2').text, 'ᠮᠣᠩᠭᠣᠯ');
assert.equal(resolve(original, 'mn-Mong').text, 'ᠮᠣᠩᠭᠣᠯ');
assert.equal(resolve(original, 'fr').text, 'English body', 'English fallback');
assert.equal(resolve({translations:{mn:{text:'Only Mongolian'}}}, 'kr').text, 'Only Mongolian', 'Single fallback');
assert.equal(resolve({translations:{kr:{text:'KR only'},mn:{text:'MN only'}}}, 'en').text, 'KR only', 'Deterministic first fallback');
assert.equal(resolve({title:'Old',text:'Legacy body'},'mn').text,'Legacy body','Legacy announcements preserved');
assert.equal(resolve({title:'Old',text:'Legacy body',translations:{mn:{title:'New',text:'MN'}}},'mn').title,'New');
assert.equal(resolve({title:'Old',text:'Legacy body',translations:{mn:{text:'MN'}}},'kr').text,'Legacy body');
assert.equal(resolve({translations:{en:{text:'EN'},mn:{text:''}}},'mn').text,'EN','Empty translations ignored');
assert.equal(resolve({translations:{ko:'한국어'}},'kr').text,'한국어','Simple text shorthand');
assert.equal(resolve({translations:{en:{text:'EN'},mn:{text:'MN'}}},'mn').title,'','Do not mix translations');
assert.equal(resolve({translations:{en:{text:''}}},'mn'),null, 'No empty notice');
assert.equal(resolve(null,'en'),null);
assert.equal(original.translations.en.text,'English body','Resolver does not mutate source');
if (isV5) {
  assert.ok(src.includes('ngwResolveAnnouncement(item, state.lang)'), 'v5 should use selected UI language');
  assert.ok(src.includes('buildAnnouncementContent(shownItem)'), 'v5 should use localized display content');
} else {
  assert.ok(src.includes("ngwResolveAnnouncement(item, document.documentElement.lang || 'mn')"), 'older apps should use document UI language');
  assert.ok(src.includes("attributeFilter: ['lang']"), 'older app should re-render when language changes');
  assert.ok(src.includes('result.push({ ...item, ...localized })'), 'older app should use localized display content');
}
const worker = fs.readFileSync(path.join(ROOT,'service-worker.js'),'utf8');
assert.ok(worker.includes('announcements.json'), 'Announcement request must retain offline service worker exception');
assert.ok(fs.readFileSync(path.join(ROOT,'ANNOUNCEMENTS.md'),'utf8').includes('Language-specific announcements'), 'Documentation updated');
console.log(`v${version}: multilingual announcement resolver passed (${path.basename(file)})`);
