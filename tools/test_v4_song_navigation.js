// Cross-version navigation regression. v5 must keep the working v4-style
// push/pop song opening instead of silently switching to a brief fade.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname,'../js/ui.js'),'utf8');
const css = require('./read_stylesheet.cjs').readStylesheet().css;
const app = fs.readFileSync(path.join(__dirname,'../js/app.js'),'utf8');
const page = src.slice(src.indexOf('function showPage('),src.indexOf('/* @end:showPage */'));
const slide = src.slice(src.indexOf('function runPageSlideTransition('),src.indexOf('/* @end:runPageSlideTransition */'));
assert(/const SLIDE_PAGES = new Set\(\['song-view'/.test(app),'song-view must actually be in SLIDE_PAGES');
assert(page.includes("SLIDE_PAGES.has(name)"),'song-view must allow v4 push');
assert(page.includes("SLIDE_PAGES.has(prevName)"),'Back must allow v4 pop');
assert(!page.includes("name !== 'song-view' && prevName !== 'song-view'"),'song page no longer excluded');
assert(!page.includes('native-song-push') && !page.includes('targetEl.animate?.('),'no separate Android or mini-fade animation');
assert(slide.includes('page-slide-in') && slide.includes('page-slide-out'),'v4 CSS page animation applied');
assert(css.includes('page-slide-in 320ms') && css.includes('page-slide-out 260ms'),'v4 animation timing preserved');
assert(!src.includes('runNativeSongSlide('),'removed delayed 3-frame native route');
assert(/const SLIDE_PAGES = new Set\(\['song-view'/.test(app), 'song opening in slide eligibility list');
assert(slide.includes('fixNativeAudioControlsPaint()'),'repaint native controls once the full slide completes');
assert(slide.includes('event.target !== topEl || event.animationName !== expectedAnimation'), 'ignore child animationend while opening');
console.log('Song navigation: same v4 push/pop and durations for web/PWA/Android.');
