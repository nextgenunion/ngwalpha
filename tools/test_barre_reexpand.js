const fs=require('fs'),vm=require('vm');
const ctx={console,localStorage:{getItem(){return null},setItem(){}},matchMedia(){return {matches:true}}};ctx.window=ctx;ctx.window.t=k=>k;
ctx.document={getElementById(){return null},querySelectorAll(){return []},createElement(){return {className:'',style:{setProperty(){}},appendChild(){}}}};
vm.runInNewContext(fs.readFileSync(__dirname+'/../js/chord-core.js','utf8'),ctx);
vm.runInNewContext(fs.readFileSync(__dirname+'/../js/guitar-voicings.js','utf8'),ctx);
let src=fs.readFileSync(__dirname+'/../js/chord-finder.js','utf8');
src=src.replace('window.ChordFinder = Object.freeze({ init, refreshLanguage, refreshNoteNames, exitDisplay, isDisplaying, renderDiagram, diagramForChord, getChordVoicings, getPianoChordVoicings });', 'window.__CF_STATE=State; window.__CF_DISPLAY=Display; window.ChordFinder = Object.freeze({ init, refreshLanguage, refreshNoteNames, exitDisplay, isDisplaying, renderDiagram, diagramForChord, getChordVoicings, getPianoChordVoicings });');
vm.runInNewContext(src,ctx);
const S=ctx.__CF_STATE,P=ctx.__CF_DISPLAY; let failed=0;
function expect(label, cond, detail=''){console.log(cond?'PASS':'FAIL',label,detail); if(!cond)failed++;}
function span(){const b=S.barres[0];return b?`${b.fret}:${b.fromString}-${b.toString}`:'none';}

// Start from the explicit fret-number barre, then shape it into a normal F.
S.clear(); S.toggleBarre(1);
S.toggleFret(2,2); // G string: fret 1 -> 2
S.toggleFret(3,3); // D string: fret 1 -> 3
S.toggleFret(4,3); // A string: fret 1 -> 3
expect('F shape keeps full barre', span()==='1:0-5', span());

// Reproduce the transient edit that used to make the shrink permanent.
S.toggleFret(0,1); // temporarily remove high-e endpoint
expect('barre shrinks while endpoint is absent', span()==='1:1-5', span());
S.toggleFret(0,1); // put high-e endpoint back
expect('barre re-expands when endpoint returns', span()==='1:0-5', span());

S.toggleFret(5,1); // temporarily remove low-E endpoint
expect('barre shrinks from opposite endpoint', span()==='1:0-4', span());
S.toggleFret(5,1);
expect('barre re-expands from opposite endpoint', span()==='1:0-5', span());

const svg=P.svg();
expect('Display Mode still draws continuous barre', (svg.match(/class="cf-d-barre"/g)||[]).length===1);
// Full six-string barre should span from the left-most to right-most chart columns.
expect('Display barre covers full six-string span', /width="254"/.test(svg), svg.match(/<rect class="cf-d-barre"[^>]+>/)?.[0]||'');

// Ghost-barre regression remains fixed: remove every fret-1 contact and the
// active barre must disappear rather than leave a background capsule.
S.toggleFret(0,1); S.toggleFret(1,1); S.toggleFret(5,1);
expect('barre clears when no fret-1 contact remains', S.barres.length===0, JSON.stringify(S.barres));

if(failed)process.exit(1);
