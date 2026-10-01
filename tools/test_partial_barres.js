const fs=require('fs'),vm=require('vm');
const ctx={console, localStorage:{getItem(){return null},setItem(){}}, matchMedia(){return {matches:true}}}; ctx.window=ctx;
ctx.document={getElementById(){return null},querySelectorAll(){return []}}; ctx.window.t=(k)=>k;
for(const f of ['chord-core.js','guitar-voicings.js','chord-finder.js']) vm.runInNewContext(fs.readFileSync(__dirname+'/../js/'+f,'utf8'),ctx);
let failed=0;
function check(name, wantSpan){
 const d=ctx.ChordFinder.diagramForChord(name); const b=d&&d.barres&&d.barres[0];
 const got=b?`${b.fret}:${b.fromString}-${b.toString}`:'none'; const ok=got===wantSpan;
 console.log(ok?'PASS':'FAIL',name,'barre',got,'source',d&&d.source); if(!ok)failed++;
 if(d && b && !d.svg.includes('cf-d-barre')){console.log('FAIL',name,'missing SVG barre');failed++;}
}
check('F','1:0-5');
check('Bm','2:1-5');
check('C#m','4:1-5');
check('D','none');
// Explicit 3-string mini-barre proves the shared renderer is no longer tied to full/5-string shapes.
const mini=ctx.ChordFinder.renderDiagram({values:[-1,-1,-1,2,2,2],barres:[{fret:2,fromString:3,toString:5,finger:1}]});
const rects=(mini.match(/class="cf-d-barre"/g)||[]).length; const okMini=rects===1;
console.log(okMini?'PASS':'FAIL','explicit three-string partial barre render',rects); if(!okMini)failed++;
if(failed)process.exit(1);
