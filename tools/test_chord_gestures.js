'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
class Element {
 constructor(){this.children=[];this.listeners={};this.dataset={};this.style={};this.isConnected=true;this.classList={add(){},remove(){}};}
 append(...elements){elements.forEach(e=>this.appendChild(e));}
 appendChild(element){this.children.push(element);return element;}
 addEventListener(type,fn){(this.listeners[type]||=[]).push(fn);}
 dispatch(type,event){for(const fn of this.listeners[type]||[])fn(event);}
 setAttribute(){}
 getBoundingClientRect(){return {height:180};}
 set innerHTML(value){this.html=value;this.children=[];}
}
let now=0,timerId=0,modal=null;
const timers=new Map(),documentEvents=new Map(),finder=[];
const root=new Element();
const chord=new Element();chord.dataset.chord='Am';chord.textContent='Am';chord.closest=()=>chord;
root.contains=el=>el===chord;
const outside={closest:()=>null};
const doc={getElementById:()=>root,createElement:()=>new Element(),addEventListener(type,fn){const listeners=documentEvents.get(type)||[];listeners.push(fn);documentEvents.set(type,listeners);}};
const context={document:doc,console,Date:{now:()=>now},matchMedia:()=>({matches:true}),
 setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id)};
context.window=context;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../js/chord-viewer.js'),'utf8'),context);
context.SongChordViewer.bind({
 openModal:(title,body,options)=>{if(modal)modal.options.onClose();modal={title,body,options};},
 renderVoicings:()=>[{svg:'<svg></svg>'}],
 openFinder:snapshot=>{finder.push(snapshot);if(modal)modal.options.onClose();modal=null;},
 isActive:()=>true,
});
function event(target=chord,detail=1){return {target,detail,clientX:30,clientY:80,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};}
function docEvent(type,e){for(const listener of documentEvents.get(type)||[])listener(e);}
function click(e){docEvent('click',e);if(!e.stopped&&e.target===chord)root.dispatch('click',e);}
function runTimer(){const [id,timer]=timers.entries().next().value;timers.delete(id);timer.fn();}
// All interruptions clear the deferred action before it opens a popup.
click(event());docEvent('pointerdown',event(outside));assert.equal(timers.size,0);assert.equal(modal,null);
click(event());docEvent('click',event(outside));assert.equal(timers.size,0);assert.equal(modal,null);
click(event());docEvent('keydown',{key:'Escape'});assert.equal(timers.size,0);
click(event());docEvent('wheel',{});assert.equal(timers.size,0);
click(event());docEvent('touchmove',{});assert.equal(timers.size,0);
// A focus/layout scroll must not cancel a valid tap.
click(event());docEvent('scroll',{target:root});assert.equal(timers.size,1);now+=330;runTimer();assert.equal(modal.title,'Am');modal.options.onClose();modal=null;
// Native double-click intent wins at the timer boundary, even if delayed.
click(event());now+=325;click(event(chord,2));assert.equal(finder.length,1);assert.equal(timers.size,0);assert.equal(modal,null);
// If the popup already opened, the same native second click is intercepted
// before the overlay can dismiss it or the instrument control can receive it.
click(event());now+=330;runTimer();const late=event(outside,2);docEvent('click',late);
assert.equal(finder.length,2);assert.equal(finder.at(-1).symbol,'Am');assert.equal(late.prevented,true);assert.equal(late.stopped,true);
// An ordinary popup click clears the origin. A later double click does not
// borrow the old song gesture and open a tool accidentally.
click(event());now+=330;runTimer();docEvent('click',event(outside));docEvent('click',event(outside,2));assert.equal(finder.length,2);
modal.options.onClose();modal=null;
// Keyboard activation stays immediate.
root.dispatch('keydown',{target:chord,key:'Enter',shiftKey:false,preventDefault(){}});assert.equal(modal.title,'Am');assert.equal(timers.size,0);
console.log('Chord gestures: interruptions, scroll intent, boundary/late native double clicks, stale origins, and keyboard activation PASS');
