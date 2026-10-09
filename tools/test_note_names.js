'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT,'index.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT,'js/app.js'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT,'service-worker.js'), 'utf8');
const translations = fs.readdirSync(path.join(ROOT, 'lang')).filter(n=>/^(?:eng|mn|mn2|kr)\.js$/.test(n));
for (const name of translations) {
  const content = fs.readFileSync(path.join(ROOT,'lang',name),'utf8');
  assert(content.includes('noteNamesTitle:') && content.includes('noteNamesSub:'), `${name} missing note name translations`);
}
assert(html.includes('id="note-name-select"'), 'Display settings note selector missing');
for (const val of ['letters','solfege','mongolian']) {
  assert(html.includes(`value="${val}"`), `note format option ${val} missing`);
}
assert(/noteNames: 'letters'/.test(app), 'default format must be letter notes');
assert(app.includes("localStorage.setItem('sb-note-names', choice)"), 'note format preference not saved');
assert(!/\.\/js\/note-(?:names|display)\.js/.test(sw), 'avoid new runtime dependency');
const ctx={console,localStorage:{getItem(){return null},setItem(){}},matchMedia(){return {matches: false}}, document:{documentElement:{getAttribute(){return ctx.noteStyle || 'letters';}},getElementById(){return null},querySelector(){return null},querySelectorAll(){return []}}};
ctx.window=ctx;ctx.t=(key,...args)=>key;
for(const f of ['chord-core.js','guitar-voicings.js','piano-chords.js','chord-finder.js']){
 vm.runInNewContext(fs.readFileSync(path.join(ROOT,'js',f),'utf8'),ctx,{filename:f});
}
const core=ctx.ChordCore, cf=ctx.ChordFinder;
for (const [style,expected] of Object.entries({
 letters:['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'],
 solfege:['Do','Do♯','Re','Re♯','Mi','Fa','Fa♯','Sol','Sol♯','La','La♯','Si'],
 mongolian:['До','До♯','Ре','Ре♯','Ми','Фа','Фа♯','Соль','Соль♯','Ля','Ля♯','Си'],
})) {
  for (let pc=0;pc<12;pc++) assert.strictEqual(core.displayNote(pc,style),expected[pc],`${style} pc=${pc}`);
  ctx.noteStyle=style;
  const piano=cf.getPianoChordVoicings('C#',1)[0];
  assert(piano && piano.svg.includes(expected[1]),`${style} piano SVG needs root name`);
  assert(piano.svg.includes(expected[5]),`${style} piano SVG needs third`); // E# = F
  const guitar=cf.diagramForChord('Am');
  assert(guitar && guitar.svg.includes('cf-diagram'),'guitar rendering unchanged');
  assert.strictEqual(core.parse('Am7').canonical,'Am7',`Chord name must not be renamed in ${style}`);
  assert.strictEqual(core.parse('F#m').canonical,'F#m',`Chord parser must not be renamed in ${style}`);
}
ctx.noteStyle='mongolian';
assert(cf.getPianoChordVoicings('G#',1)[0].svg.includes('Соль♯'),'long black-key note visible in SVG');
console.log('PASS note-name modes (36 pitch classes), sharps, presentation/popup SVG, chord parser stability, persistence wiring, translations');
