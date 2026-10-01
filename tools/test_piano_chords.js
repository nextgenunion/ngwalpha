// Piano mode: keyboard model, chord detection from pressed keys, generated
// voicings, and Chord Finder search/analysis wiring for the piano instrument.
const fs = require('fs'), vm = require('vm');
const ctx = { console, localStorage: { getItem() { return null; }, setItem() {} }, matchMedia() { return { matches: true }; } };
ctx.window = ctx; ctx.window.t = k => k;
ctx.document = { getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }, createElement() { return {}; } };
for (const f of ['chord-core.js', 'guitar-voicings.js', 'piano-chords.js']) vm.runInNewContext(fs.readFileSync(__dirname + '/../js/' + f, 'utf8'), ctx);
const P = ctx.PianoChords, Core = ctx.ChordCore;
let failed = 0;
const check = (ok, msg, extra = '') => { console.log(ok ? 'PASS' : 'FAIL', msg, extra); if (!ok) failed++; };

// 1. Keyboard geometry: 24 keys, 14 white, black keys centred between whites.
const blacks = [...Array(P.KEY_COUNT).keys()].filter(i => P.keyInfo(i).black);
check(P.KEY_COUNT === 24 && P.WHITE_COUNT === 14 && blacks.length === 10, 'two-octave layout has 14 white + 10 black keys');
check(P.layout(1).center === 1 && P.layout(3).center === 2 && P.layout(6).center === 4 && P.layout(13).center === 8, 'black keys sit on white-key boundaries');
check(P.keyInfo(0).name === 'C' && P.keyInfo(0).octave === 3 && P.keyInfo(23).name === 'B' && P.keyInfo(23).octave === 4, 'C3…B4 key naming');

// 2. Detection: root position, inversions (slash chords), power chord, rejects.
const name = keys => (P.identifyKeys(keys).ranked[0] || {}).name || '';
check(name([0, 4, 7]) === 'C', 'C-E-G => C');
check(name([4, 7, 12]) === 'C/E', 'E-G-C => C/E (first inversion)');
check(name([7, 12, 16]) === 'C/G', 'G-C-E => C/G (second inversion)');
check(name([9, 12, 16, 19]) === 'Am7', 'A-C-E-G => Am7');
check(name([0, 7]) === 'C5', 'C-G => C5');
check(name([0, 7, 12]) === 'C5', 'octave doubling (C-G-C) still reads C5');
check(P.identifyKeys([0, 12]).ranked.length === 0, 'same pitch class twice is not a chord');
check(P.identifyKeys([]).ranked.length === 0, 'no keys => no chord');

// 3. Round-trip: every root x common type -> root-position voicing is detected
// as that exact chord, and every returned voicing is musically correct.
const types = ['', 'm', '7', 'maj7', 'm7', 'dim', 'aug', 'sus2', 'sus4', '6', 'add9', '9', 'm9', '7sus4', 'm7b5', 'dim7'];
let roundTripBad = [], voicingBad = [], total = 0;
for (let root = 0; root < 12; root++) {
  for (const suffix of types) {
    const symbol = Core.NOTE_NAMES[root] + suffix;
    const parsed = Core.parse(symbol);
    const vs = P.voicings(parsed, 8);
    total++;
    if (!vs.length) { voicingBad.push(symbol + ' (none)'); continue; }
    const allowed = new Set(parsed.type.intervals.map(iv => (parsed.root + iv) % 12));
    const required = parsed.type.required.map(iv => (parsed.root + iv) % 12);
    for (const v of vs) {
      const pcs = new Set(v.keys.map(k => k % 12));
      const okTones = [...pcs].every(pc => allowed.has(pc)) && required.every(pc => pcs.has(pc));
      const inRange = v.keys.every(k => k >= 0 && k < P.KEY_COUNT);
      if (!okTones || !inRange) voicingBad.push(symbol + ':' + v.keys.join('-'));
    }
    const top = P.identifyKeys(vs[0].keys).ranked.map(c => c.name);
    if (!top.includes(parsed.canonical) ) roundTripBad.push(symbol + ' -> ' + top.slice(0, 3).join('|'));
    else if (vs[0].label === 'root' && top[0] !== parsed.canonical && !['dim7', 'aug', '6', 'm7b5', 'sus2', 'sus4', '7sus4'].includes(suffix)) roundTripBad.push(symbol + ' ranked ' + top[0]);
  }
}
check(!voicingBad.length, `all piano voicings use only chord tones (${total} chords)`, voicingBad.slice(0, 5).join(' '));
check(!roundTripBad.length, 'generated voicings are detected back as the same chord', roundTripBad.slice(0, 5).join(' '));

// 4. Slash chords: requested bass is the lowest key.
for (const s of ['C/E', 'D/F#', 'G/A', 'Am7/G', 'F/C', 'A/B']) {
  const parsed = Core.parse(s);
  const vs = P.voicings(parsed, 4);
  const bassOk = vs.length && vs.every(v => v.keys[0] % 12 === parsed.bass);
  check(bassOk, `slash chord ${s}: every voicing has the requested bass lowest`, vs.map(v => v.keys.join('-')).join(' | '));
}

// 5. Alternates: triads get root + 2 inversions; big extended chords stay single.
check(P.voicings('C', 6).length === 3, 'triad has root + two inversions');
check(P.voicings('Cmaj7', 6).length === 4, 'seventh chord has root + three inversions');
check(P.voicings('B13', 6).length === 1, 'seven-note chord is not offered as clusters');
check(P.voicings('not-a-chord').length === 0, 'invalid symbol => no voicings');

// 6. Chord Finder wiring (analysis + search) for the piano instrument.
let src = fs.readFileSync(__dirname + '/../js/chord-finder.js', 'utf8');
const marker = 'window.ChordFinder = Object.freeze({ init, refreshLanguage, exitPresentation, isPresenting, renderDiagram, diagramForChord, getChordVoicings, getPianoChordVoicings });';
if (!src.includes(marker)) { console.log('FAIL export marker missing'); process.exit(1); }
src = src.replace(marker, 'window.__CF={Search,Prefs,View,Menu,PianoState,analyze,Presentation};' + marker);
vm.runInNewContext(src, ctx);
const CF = ctx.__CF;
CF.View.buildBoard = () => {}; CF.View.renderBoard = () => {}; CF.View.renderResult = () => {}; CF.Menu.syncControls = () => {};
CF.Prefs.instrument = 'piano';
check(CF.analyze().isHint && CF.analyze().title === 'cfPianoHintStart', 'empty keyboard shows the piano hint');
CF.PianoState.set([0]);
check(CF.analyze().title === 'cfHintSelect', 'one key asks for at least two notes');
CF.PianoState.set([4, 7, 12]);
const a = CF.analyze();
check(a.title === 'C/E' && a.noteDetails.map(n => n.name).join('') === 'CEG' && a.noteDetails[0].role === 'ROOT', 'finder analysis names inversion and roles', JSON.stringify(a.noteDetails));
CF.PianoState.set([0, 1, 2, 3, 4, 5]);
check(CF.analyze().isHint, 'cluster of unrelated keys is reported as unknown');
CF.Search.run('Am7');
check(CF.Search.results.length === 4 && CF.PianoState.sorted().join(',') === '9,12,16,19', 'search loads root-position Am7 onto the keyboard', CF.PianoState.sorted().join(','));
CF.Search.move(1);
check(CF.Search.index === 1 && CF.PianoState.sorted().join(',') === '12,16,19,21', 'search arrows cycle piano inversions', CF.PianoState.sorted().join(','));
CF.Search.run('not-a-chord');
check(CF.Search.results.length === 0, 'invalid piano search clears results');
CF.Prefs.instrument = 'guitar';
CF.Search.run('Am');
check(CF.Search.results[0] && Array.isArray(CF.Search.results[0].values), 'guitar search is unchanged when guitar is active');

// 7. Presentation SVG draws one highlighted rect per pressed key.
CF.Prefs.instrument = 'piano'; CF.Prefs.pianoLabels = 'note';
const svg = CF.Presentation.pianoSvg([0, 4, 7, 13]);
const on = (svg.match(/class="cf-pd-(white|black) is-on"/g) || []).length;
check(on === 4 && (svg.match(/<rect/g) || []).length === 24, 'presentation keyboard has 24 keys, 4 highlighted', `on=${on}`);
check((svg.match(/cf-pd-label/g) || []).length === 4, 'presentation shows note names for pressed keys');
CF.Prefs.pianoLabels = 'hide';
check(!/cf-pd-label/.test(CF.Presentation.pianoSvg([0, 4, 7])), 'presentation hides names when marker is Hide');

const popupPiano = ctx.ChordFinder.getPianoChordVoicings('C', 4);
check(popupPiano.length === 3 && popupPiano.every(v => /cf-piano-diagram/.test(v.svg)), 'public piano popup API returns Presentation-style root + inversions');
check(popupPiano[0].keys.join(',') === '0,4,7', 'piano popup API keeps root position first for C');

if (failed) process.exit(1);
