const fs=require('fs'),vm=require('vm'); const ctx={console};ctx.window=ctx;
for(const f of ['chord-core.js','guitar-voicings.js']) vm.runInNewContext(fs.readFileSync(__dirname+'/../js/'+f,'utf8'),ctx);
const C=ctx.ChordCore,G=ctx.GuitarVoicings, open=[4,9,2,7,11,4];
let failed=0, checked=0;
for(const {key,values} of G.entries()){
 const [rootText,suffix]=key.split(':'); const root=+rootText; const type=C.TYPES.find(t=>t.suffix===suffix); checked++;
 const sounding=[]; values.forEach((f,i)=>{if(f>=0)sounding.push((open[i]+f)%12)});
 const set=new Set(sounding), allowed=new Set(type.intervals.map(r=>(root+r)%12)), required=type.required.map(r=>(root+r)%12);
 const ok=sounding.length>=3 && sounding[0]===root && sounding.every(pc=>allowed.has(pc)) && required.every(pc=>set.has(pc));
 if(!ok){failed++; console.log('FAIL',key,values.join(','),'notes',sounding.join(','));}
}
console.log((failed?'FAIL':'PASS'),checked,'curated shapes validated'); if(failed)process.exit(1);
