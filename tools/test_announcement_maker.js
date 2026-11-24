/* Tests the announcement maker's pure builder and checks its output works with the real app resolver. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'announcement-maker.html'), 'utf8');
const a = html.indexOf('/* @pure-begin */'), b = html.indexOf('/* @pure-end */');
assert.ok(a > 0 && b > a, 'maker pure block present');
const ctx = vm.createContext({ String, Object, Date, Number, Array });
vm.runInContext(html.slice(a, b), ctx);
const ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');
const s = ui.indexOf('function ngwResolveAnnouncement('), e = ui.indexOf('/* @begin:renderAnnouncements */', s);
const rctx = vm.createContext({ resolve: null, Map, String, Object, Array });
vm.runInContext(ui.slice(s, e) + '\nresolve = ngwResolveAnnouncement;', rctx);
const now = new Date(2026, 10, 24, 9, 5, 7);
const E = { title: '', text: '' };

assert.equal(ctx.buildNotice({ style: 'popup', when: 'once', langs: { en: E, mn: E, kr: E, mn2: E } }, now), null, 'empty message is rejected');

const one = ctx.buildNotice({ style: 'popup', when: 'once', langs: { en: { title: 'Update coming soon', text: 'A new update is coming this week.' }, mn: E, kr: E, mn2: E } }, now);
assert.deepEqual(JSON.parse(JSON.stringify(one)), { id: 'update-coming-soon-20261124-090507', mode: 'once', title: 'Update coming soon', text: 'A new update is coming this week.' });
for (const lang of ['en', 'mn', 'kr', 'mn2']) assert.equal(rctx.resolve(one, lang).text, 'A new update is coming this week.', 'single message reaches ' + lang);

const banner = ctx.buildNotice({ style: 'banner', when: 'every-open', from: '2026-12-09', until: '2026-12-10', langs: { en: { title: '', text: 'Short break.' }, mn: E, kr: E, mn2: E } }, now);
assert.equal(banner.display, 'banner'); assert.equal(banner.mode, 'every-open'); assert.equal(banner.title, undefined);
assert.match(banner.startsAt, /^2026-12-09T00:00:00[+-]\d\d:\d\d$/);
assert.match(banner.endsAt, /^2026-12-11T00:00:00[+-]\d\d:\d\d$/, 'end date covers the whole day');
assert.ok(Date.parse(banner.startsAt) < Date.parse(banner.endsAt));

const multi = ctx.buildNotice({ style: 'popup', when: 'once', langs: { en: { title: 'News', text: 'English' }, mn: { title: '', text: 'Монгол' }, kr: E, mn2: E } }, now);
assert.deepEqual(Object.keys(multi.translations).sort(), ['en', 'mn']);
assert.equal(rctx.resolve(multi, 'mn').text, 'Монгол');
assert.equal(rctx.resolve(multi, 'kr').text, 'English', 'languages without a version fall back to English');

const mnOnly = ctx.buildNotice({ style: 'popup', when: 'once', langs: { en: E, mn: { title: 'Мэдээ', text: 'Сайн байна' }, kr: E, mn2: E } }, now);
assert.match(mnOnly.id, /^notice-/, 'non-Latin titles still get a valid id');
assert.equal(rctx.resolve(mnOnly, 'en').text, 'Сайн байна');
assert.equal(ctx.noticeSummary(multi).title, 'News');
console.log('Announcement maker PASS: builds valid notices that the app resolver accepts');
