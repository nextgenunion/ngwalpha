const fs=require('fs'),vm=require('vm');
const ctx={console,localStorage:{getItem(){return null},setItem(){}},matchMedia(){return {matches:true}}};ctx.window=ctx;ctx.window.t=k=>k;
ctx.document={getElementById(){return null},querySelectorAll(){return []},createElement(){return {className:'',style:{setProperty(){}},appendChild(){}}}};
vm.runInNewContext(fs.readFileSync(__dirname+'/../js/chord-core.js','utf8'),ctx);
vm.runInNewContext(fs.readFileSync(__dirname+'/../js/guitar-voicings.js','utf8'),ctx);
let src=fs.readFileSync(__dirname+'/../js/chord-finder.js','utf8');
src=src.replace('window.ChordFinder = Object.freeze({ init, refreshLanguage, exitPresentation, isPresenting, renderDiagram, diagramForChord, getChordVoicings, getPianoChordVoicings });', 'window.__CF_STATE=State; window.__CF_VIEW=View; window.ChordFinder = Object.freeze({ init, refreshLanguage, exitPresentation, isPresenting, renderDiagram, diagramForChord, getChordVoicings, getPianoChordVoicings });');
vm.runInNewContext(src,ctx);
const S=ctx.__CF_STATE,V=ctx.__CF_VIEW; let failed=0;
S.toggleBarre(3);
if(S.barres.length!==1){console.log('FAIL create barre');failed++;}
// Remove both endpoints and all remaining exact notes; partial span should shrink,
// then disappear completely rather than leave ghost state.
for(let s=0;s<6;s++) S.toggleFret(s,3);
const noState=S.barres.length===0;
console.log(noState?'PASS':'FAIL','barre state clears after all held notes are removed',S.barres);
if(!noState)failed++;
const slot={dataset:{fret:'3'},innerHTML:'<i class="cf-barre-marker"></i>',appendChild(){throw new Error('should not append inactive marker')}};
const board={querySelectorAll(sel){return sel==='.cf-barre-slot'?[slot]:[]}};
V.els={board}; V.renderBoard();
const noVisual=slot.innerHTML==='';
console.log(noVisual?'PASS':'FAIL','stale barre background is cleared by renderBoard');if(!noVisual)failed++;
if(failed)process.exit(1);
