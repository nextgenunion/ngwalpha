// Regression test for keyboard-safe dialog geometry. Simulates the Android
// visual viewport shrinking while the layout viewport remains fixed OR also
// shrinks. The overlay stays anchored; the card gets one eased translation.
'use strict';
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const src = fs.readFileSync(require('path').join(__dirname, '../js/ui.js'), 'utf8');
const start = src.indexOf('function initViewportSync()');
const end = src.indexOf('/* @end:initViewportSync */', start);
assert(start >= 0 && end > start, 'initViewportSync must exist');
const css = require('./read_stylesheet.cjs').readStylesheet().css;
assert(src.includes('function focusModalInput(input, delay = 360)'), 'wait until modal opening animation completes before triggering keyboard');
const overlayRules = (css.match(/\.modal-overlay\s*\{[\s\S]*?\n\}/) || [''])[0];
const cardRules = (css.match(/\.modal-card\s*\{[\s\S]*?\n\}/) || [''])[0];
assert(cardRules.includes('translate: 0 var(--keyboard-card-shift, 0px)'), 'keyboard adjustment must use translated card, not padding recenter');
assert(cardRules.includes('transition: translate 300ms'), 'card should ease instead of jump');
assert(!css.includes('html.keyboard-open .modal-overlay {'), 'must not change overlay alignment as keyboard opens');
assert(overlayRules.includes('align-items: center'), 'modal must remain centered initially');
assert(cardRules.includes('--modal-height-limit'), 'modal max height must not depend on shrinking visualViewport');
assert(css.includes('.modal-card.modal-card-anchored'), 'text-entry modals must keep their pre-keyboard vertical origin');
function fixture({initial=800,cardTop=250,cardHeight=220,typing=true}={}) {
  const props = {};
  const classes = new Set();
  const listeners = {};
  const frames = [];
  let vvHeight = initial;
  const style = {getPropertyValue:(k)=>props[k]||'',setProperty:(k,v)=>props[k]=v,removeProperty:k=>delete props[k]};
  const card = {offsetTop:cardTop,offsetHeight:cardHeight,style:{maxHeight:''}};
  const overlay = {hidden:false,_baseViewportHeight:initial,style,querySelector:()=>card,getBoundingClientRect:()=>({top:0})};
  const root = {style:{setProperty:(k,v)=>props['root:'+k]=v},classList:{toggle:(k,v)=>v?classes.add(k):classes.delete(k)}};
  const vv = {height:initial, offsetTop:0, scale:1,addEventListener:(k,fn)=>listeners[k]=fn};
  const win = {innerHeight:initial,visualViewport:vv,addEventListener:(k,fn)=>listeners['window:'+k]=fn};
  const doc = {documentElement:root,activeElement:{matches:()=>typing},getElementById:(id)=>id==='modal-overlay'?overlay:null};
  const ctx={window:win,document:doc,requestAnimationFrame:(cb)=>{frames.push(cb);return frames.length;}};
  vm.createContext(ctx);
  vm.runInContext(src.slice(start,end)+'\ninitViewportSync();',ctx);
  const fire=()=>{listeners.resize();while(frames.length)frames.shift()();};
  return {props,classes,vv,win,fire};
}
let t=fixture();
assert(!t.classes.has('keyboard-open'));
t.vv.height=480;t.fire();
assert(t.classes.has('keyboard-open'),'keyboard should be detected');
assert.equal(t.props['--keyboard-card-shift'],'-2px','should move only enough to clear the keyboard');
t.vv.height=340;t.fire();
assert.equal(t.props['--keyboard-card-shift'],'-142px','shift should be based on the stationary original position');
t.win.innerHeight=340;t.fire();
assert.equal(t.props['--keyboard-card-shift'],'-142px','layout resizing must not hide keyboard detection');
t.vv.height=800;t.fire();
assert(!t.classes.has('keyboard-open'));
assert(!('--keyboard-card-shift' in t.props),'shift should reset when keyboard closes');
t=fixture({cardTop:50,cardHeight:200});t.vv.height=480;t.fire();
assert.equal(t.props['--keyboard-card-shift'],'0px','dialog fully above keyboard must not move');
t=fixture();t.vv.scale=2;t.vv.height=420;t.fire();
assert(!t.classes.has('keyboard-open'),'pinch zoom is not a keyboard');
t=fixture({typing:false});t.vv.height=400;t.fire();
assert(!t.classes.has('keyboard-open'),'no typing, no keyboard state');
console.log('Keyboard viewport: anchored overlay, one eased card translation, safe resize/focus handling.');
