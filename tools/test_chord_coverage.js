const fs=require('fs'),path=require('path'),vm=require('vm');
const root=path.resolve(__dirname,'..');
const ctx={console,localStorage:{getItem(){return null},setItem(){}},matchMedia(){return {matches:true}}};ctx.window=ctx;ctx.window.t=k=>k;ctx.document={getElementById(){return null},querySelectorAll(){return []}};
for(const f of ['chord-core.js','guitar-voicings.js','chord-finder.js']) vm.runInNewContext(fs.readFileSync(path.join(root,'js',f),'utf8'),ctx);
const tokens=new Map();
function walk(dir){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,ent.name);if(ent.isDirectory())walk(p);else if(ent.name.endsWith('.json')&&ent.name!=='database.json'&&ent.name!=='manifest.json'){let j;try{j=JSON.parse(fs.readFileSync(p,'utf8'))}catch{continue}const arr=Array.isArray(j)?j:[j];for(const song of arr){for(const line of (song.lyrics||[])){for(const m of String(line).matchAll(/\[([^\]]+)\]/g)){const t=m[1].trim();if(t)tokens.set(t,(tokens.get(t)||0)+1)}}}}}}
walk(path.join(root,'data'));
let supported=0, occurrences=0, supportedOcc=0; const unsupported=[];
for(const [t,n] of tokens){occurrences+=n;let d=null;try{d=ctx.ChordFinder.diagramForChord(t)}catch(e){unsupported.push([t,n,'ERROR '+e.message]);continue}if(d){supported++;supportedOcc+=n}else unsupported.push([t,n,'unsupported']);}
console.log('unique',tokens.size,'supported',supported,'occurrences',occurrences,'supportedOccurrences',supportedOcc,'coverage',((supportedOcc/occurrences)*100).toFixed(3)+'%');
console.log('unsupported sample',unsupported.sort((a,b)=>b[1]-a[1]).slice(0,25));
if(supportedOcc/occurrences < .995) process.exit(1);
