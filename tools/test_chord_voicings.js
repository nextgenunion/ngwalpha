const fs=require('fs'),vm=require('vm');
const ctx={console,localStorage:{getItem(){return null},setItem(){}},matchMedia(){return {matches:true}}};
ctx.window=ctx;ctx.window.t=k=>k;ctx.document={getElementById(){return null},querySelectorAll(){return []}};
for(const f of ['chord-core.js','guitar-voicings.js','chord-finder.js']) vm.runInNewContext(fs.readFileSync(__dirname+'/../js/'+f,'utf8'),ctx);
const C=ctx.ChordCore, F=ctx.ChordFinder, open=[4,9,2,7,11,4];
let failed=0;
function validate(symbol){
  const parsed=C.parse(symbol), list=F.getChordVoicings(symbol,5);
  const unique=new Set(list.map(v=>v.values.join(',')));
  const diverse=new Set(list.map(v=>v.values.some(x=>x===0)?'open':Math.min(...v.values.filter(x=>x>0))));
  let ok=!!parsed && list.length>=2 && unique.size===list.length && list.every(v=>v.svg.includes('cf-diagram'));
  for(const v of list){
    const sounding=[]; v.values.forEach((f,i)=>{if(f>=0)sounding.push((open[i]+f)%12)});
    const allowed=new Set(parsed.type.intervals.map(r=>(parsed.root+r)%12)); if(parsed.bass!==null)allowed.add(parsed.bass);
    const required=parsed.type.required.map(r=>(parsed.root+r)%12), set=new Set(sounding);
    if(!sounding.length || (parsed.bass!==null ? sounding[0]!==parsed.bass : sounding[0]!==parsed.root) || sounding.some(pc=>!allowed.has(pc)) || required.some(pc=>!set.has(pc))) ok=false;
  }
  console.log(ok?'PASS':'FAIL',symbol,'count',list.length,'positions',[...diverse].join(','),'first',list[0]&&list[0].source,list[0]&&list[0].values.join(','));
  if(!ok)failed++;
}
['Am','F','Bm','C','G','Cadd9','D/F#'].forEach(validate);
const am=F.getChordVoicings('Am',5);
if(!am.length || am[0].source!=='curated'){console.log('FAIL Am curated first');failed++;} else console.log('PASS Am curated first');
if(failed)process.exit(1);
