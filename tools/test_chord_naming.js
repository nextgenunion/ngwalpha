const fs=require('fs'), vm=require('vm');
const ctx={console};ctx.window=ctx;vm.runInNewContext(fs.readFileSync(__dirname+'/../js/chord-core.js','utf8'),ctx);
const C=ctx.ChordCore;
const open=[4,9,2,7,11,4]; // low E -> high e
function identify(shape){
 const values=shape.trim().split(/\s+/).map(x=>x==='x'?-1:+x); const notes=[];
 for(let i=0;i<6;i++) if(values[i]>=0) notes.push((open[i]+values[i])%12);
 return C.identify([...new Set(notes)],notes[0]);
}
const cases=[
 ['x 0 2 2 1 0','Am'], ['0 0 2 2 1 0','Am/E'], ['x 3 2 0 1 0','C'],
 ['0 3 2 0 1 0','C/E'], ['2 0 0 2 3 2','D/F#'], ['1 3 3 2 1 1','F'],
 ['x 2 4 4 3 2','Bm'], ['x 2 4 2 3 2','Bm7'], ['x 0 2 0 2 0','A7'],
 ['x x 0 2 1 2','D7'], ['3 2 0 0 0 1','G7'], ['x 3 2 2 1 0','C6']
];
let failed=0;
for(const [shape,want] of cases){const ranked=identify(shape); const got=ranked[0]&&ranked[0].name; const ok=got===want; console.log(ok?'PASS':'FAIL',shape,'=>',got,'want',want,'alts',ranked.slice(1,4).map(x=>x.name).join(',')); if(!ok)failed++;}
if(failed)process.exit(1);
