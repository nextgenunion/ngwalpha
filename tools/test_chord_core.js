const fs = require('fs');
const vm = require('vm');
const ctx = { console }; ctx.window = ctx;
vm.runInNewContext(fs.readFileSync(__dirname + '/../js/chord-core.js','utf8'), ctx);
const C = ctx.ChordCore;
const cases = [
  ['Am','Am',9,'m',null], ['Amin','Am',9,'m',null], ['C(add9)','Cadd9',0,'add9',null],
  ['C6/9','C6/9',0,'6/9',null], ['F#m7/C#','F#m7/C#',6,'m7',1],
  ['C♯m','C#m',1,'m',null], ['D♭maj7/F','Dbmaj7/F',1,'maj7',5],
  ['G7sus4','G7sus4',7,'7sus4',null], ['Bø7','Bm7b5',11,'m7b5',null]
];
let failed=0;
for (const [input,canonical,root,suffix,bass] of cases) {
 const p=C.parse(input); const ok=p&&p.canonical===canonical&&p.root===root&&p.suffix===suffix&&p.bass===bass;
 console.log(ok?'PASS':'FAIL', input, p&&p.canonical); if(!ok) failed++;
}
for (const bad of ['','x2','D7sus4-D7','(D','C,G..Dm7']) { const ok=C.parse(bad)===null; console.log(ok?'PASS':'FAIL','reject',bad); if(!ok) failed++; }
if(failed) process.exit(1);
