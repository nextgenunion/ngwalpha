const fs=require('fs'),vm=require('vm');
const ctx={console,localStorage:{getItem(){return null},setItem(){}},matchMedia(){return {matches:true}}};ctx.window=ctx;ctx.window.t=k=>k;ctx.document={getElementById(){return null},querySelectorAll(){return []}};
for(const f of ['chord-core.js','guitar-voicings.js','chord-finder.js'])vm.runInNewContext(fs.readFileSync(__dirname+'/../js/'+f,'utf8'),ctx);
let failed=0;
const expected={Am:'curated',F:'curated',Bm:'curated','C#m':'curated','Cadd9':'generated','D/F#':'generated','F#m7/C#':'generated'};
for(const [chord,source] of Object.entries(expected)){const d=ctx.ChordFinder.diagramForChord(chord);const ok=!!d&&d.source===source&&d.svg.includes('cf-diagram');console.log(ok?'PASS':'FAIL',chord, d&&d.source, d&&d.values.join(','), d&&JSON.stringify(d.barres));if(!ok)failed++;}
if(failed)process.exit(1);
