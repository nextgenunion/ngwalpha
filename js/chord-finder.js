/* ============================================================
   Chord Finder — built-in tool page (Settings → Tools → Chord Finder)

   Tap frets on a horizontal six-string guitar neck and the chord you are
   holding is named. Strings you leave alone count as open, so Em is just
   two taps; tap a tuning label at the left edge to mute that string.
   Pure client-side; no data, no network.

   Ported from the standalone Chord Finder index.html into the app:
   the same theory/detection/state logic, but the DOM is scoped to
   #page-chord-finder (all ids/classes prefixed "cf-") and the look
   comes from the app's own theme tokens (see the "Chord Finder"
   block at the end of css/style.css).

   Public surface (used by app.js):
     ChordFinder.init()             build the board once (idempotent)
     ChordFinder.refreshLanguage()  re-render translated text
     ChordFinder.exitPresentation() leave presentation mode (called when
                                    the page is left, so it never reopens
                                    stuck in it)
     ChordFinder.isPresenting()     true while presentation mode is on
                                    (app.js uses it to keep the screen awake)
   ============================================================ */
(function () {
  'use strict';

  /* ---------- MODULE 1 — CONFIG (edit to change the instrument) ---------- */
  const CONFIG = {
    // Listed high string → low string, matching the horizontal fretboard
    // rows from top to bottom. Each string stores its open pitch class.
    strings: [
      { name: 'e', pitch: 4 },   // high E
      { name: 'B', pitch: 11 },
      { name: 'G', pitch: 7 },
      { name: 'D', pitch: 2 },
      { name: 'A', pitch: 9 },
      { name: 'E', pitch: 4 },   // low E
    ],
    frets: 12,
    minNotes: 2,
    maxAlternatives: 4,
    presentationFrets: 5,   // fret rows shown in presentation mode
  };

  /* ---------- MODULE 2 — MUSIC THEORY DATA ----------
     `required` notes define the chord quality. `optional` notes are normal
     chord tones that guitar voicings commonly leave out (most often the 5th).
     This makes the finder useful for real-world voicings instead of rejecting
     everything that is not a textbook stack of every chord tone. */
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  const CHORD_TYPES = [
    { suffix: '',        intervals: [0,4,7],          required: [0,4],       optional: [7],       weight: 0 },
    { suffix: 'm',       intervals: [0,3,7],          required: [0,3],       optional: [7],       weight: 0 },
    { suffix: '5',       intervals: [0,7],            required: [0,7],       optional: [],        weight: 1 },
    { suffix: 'dim',     intervals: [0,3,6],          required: [0,3,6],     optional: [],        weight: 2 },
    { suffix: 'aug',     intervals: [0,4,8],          required: [0,4,8],     optional: [],        weight: 2 },
    { suffix: 'sus2',    intervals: [0,2,7],          required: [0,2,7],     optional: [],        weight: 2 },
    { suffix: 'sus4',    intervals: [0,5,7],          required: [0,5,7],     optional: [],        weight: 2 },

    { suffix: '6',       intervals: [0,4,7,9],        required: [0,4,9],     optional: [7],       weight: 3 },
    { suffix: 'm6',      intervals: [0,3,7,9],        required: [0,3,9],     optional: [7],       weight: 3 },
    { suffix: 'add9',    intervals: [0,2,4,7],        required: [0,2,4],     optional: [7],       weight: 2 },
    { suffix: 'madd9',   intervals: [0,2,3,7],        required: [0,2,3],     optional: [7],       weight: 2 },
    { suffix: 'add11',   intervals: [0,4,5,7],        required: [0,4,5],     optional: [7],       weight: 3 },
    { suffix: 'madd11',  intervals: [0,3,5,7],        required: [0,3,5],     optional: [7],       weight: 3 },
    { suffix: '6/9',     intervals: [0,2,4,7,9],      required: [0,2,4,9],   optional: [7],       weight: 4 },
    { suffix: 'm6/9',    intervals: [0,2,3,7,9],      required: [0,2,3,9],   optional: [7],       weight: 4 },

    { suffix: '7',       intervals: [0,4,7,10],       required: [0,4,10],    optional: [7],       weight: 1 },
    { suffix: 'maj7',    intervals: [0,4,7,11],       required: [0,4,11],    optional: [7],       weight: 1 },
    { suffix: 'm7',      intervals: [0,3,7,10],       required: [0,3,10],    optional: [7],       weight: 1 },
    { suffix: 'mMaj7',   intervals: [0,3,7,11],       required: [0,3,11],    optional: [7],       weight: 3 },
    { suffix: 'm7b5',    intervals: [0,3,6,10],       required: [0,3,6,10],  optional: [],        weight: 2 },
    { suffix: 'dim7',    intervals: [0,3,6,9],        required: [0,3,6,9],   optional: [],        weight: 3 },
    { suffix: '7sus4',   intervals: [0,5,7,10],       required: [0,5,10],    optional: [7],       weight: 3 },
    { suffix: '7b5',     intervals: [0,4,6,10],       required: [0,4,6,10],  optional: [],        weight: 3 },
    { suffix: '7#5',     intervals: [0,4,8,10],       required: [0,4,8,10],  optional: [],        weight: 3 },
    { suffix: 'maj7#5',  intervals: [0,4,8,11],       required: [0,4,8,11],  optional: [],        weight: 4 },

    { suffix: '9',       intervals: [0,2,4,7,10],     required: [0,2,4,10],  optional: [7],       weight: 2 },
    { suffix: 'maj9',    intervals: [0,2,4,7,11],     required: [0,2,4,11],  optional: [7],       weight: 2 },
    { suffix: 'm9',      intervals: [0,2,3,7,10],     required: [0,2,3,10],  optional: [7],       weight: 2 },
    { suffix: 'mMaj9',   intervals: [0,2,3,7,11],     required: [0,2,3,11],  optional: [7],       weight: 4 },
    { suffix: '7b9',     intervals: [0,1,4,7,10],     required: [0,1,4,10],  optional: [7],       weight: 3 },
    { suffix: '7#9',     intervals: [0,3,4,7,10],     required: [0,3,4,10],  optional: [7],       weight: 3 },
    { suffix: '9sus4',   intervals: [0,2,5,7,10],     required: [0,2,5,10],  optional: [7],       weight: 4 },
    { suffix: '7#11',    intervals: [0,2,4,6,7,10],   required: [0,4,6,10],  optional: [2,7],     weight: 4 },
    { suffix: 'maj7#11', intervals: [0,2,4,6,7,11],   required: [0,4,6,11],  optional: [2,7],     weight: 5 },

    { suffix: '11',      intervals: [0,2,4,5,7,10],   required: [0,4,5,10],  optional: [2,7],     weight: 5 },
    { suffix: 'm11',     intervals: [0,2,3,5,7,10],   required: [0,3,5,10],  optional: [2,7],     weight: 4 },
    { suffix: '13',      intervals: [0,2,4,5,7,9,10], required: [0,4,9,10],  optional: [2,5,7],   weight: 5 },
    { suffix: 'maj13',   intervals: [0,2,4,5,7,9,11], required: [0,4,9,11],  optional: [2,5,7],   weight: 6 },
    { suffix: 'm13',     intervals: [0,2,3,5,7,9,10], required: [0,3,9,10],  optional: [2,5,7],   weight: 5 },
    { suffix: '13b9',    intervals: [0,1,4,7,9,10],   required: [0,1,4,9,10],optional: [7],       weight: 6 },
  ];

  const OMIT_LABELS = { 2: '9', 5: '11', 7: '5' };

  /* ---------- MODULE 3 — CHORD DETECTION (pure, no DOM) ---------- */
  const Theory = {
    noteAt(stringDef, fret) {
      return (stringDef.pitch + fret) % 12;
    },

    /** Ranked chord candidates for the given pitch classes + bass note. */
    detect(pitchClasses, bass) {
      const set = new Set(pitchClasses);
      const candidates = [];
      if (set.size < CONFIG.minNotes) return candidates;

      // A practical identifier should try every selected note as a possible
      // root. That catches inversions and slash chords while avoiding wild
      // rootless guesses that would swamp simple guitar shapes with theory.
      for (const root of set) {
        for (const type of CHORD_TYPES) {
          const abs = rel => (root + rel) % 12;
          const chordPcs = new Set(type.intervals.map(abs));

          // A selected pitch that is not part of the formula is a real extra,
          // so this formula cannot be the selected chord.
          if ([...set].some(pc => !chordPcs.has(pc))) continue;
          // Defining tones must be present. Optional tones may be omitted.
          if (type.required.some(rel => !set.has(abs(rel)))) continue;

          const missingOptional = type.optional.filter(rel => !set.has(abs(rel)));
          const base = NOTE_NAMES[root] + type.suffix;
          const isSlash = root !== bass;
          const slash = isSlash ? `/${NOTE_NAMES[bass]}` : '';

          const omitted = missingOptional
            .map(rel => OMIT_LABELS[rel])
            .filter(Boolean);
          const omitText = omitted.length ? `(omit${omitted.join(',omit')})` : '';
          const name = base + slash;
          const voicingName = base + omitText + slash;

          // Lower score = better. Simpler names, complete voicings and root
          // position win, but incomplete real-world voicings remain valid.
          const exactBonus = set.size === chordPcs.size ? -6 : 0;
          const omissionPenalty = missingOptional.length * 4;
          const slashPenalty = isSlash ? 25 : 0;
          const score = type.weight * 10 + omissionPenalty + slashPenalty + exactBonus;
          candidates.push({ name, voicingName, score, root, type, missingOptional });
        }
      }

      candidates.sort((a, b) => a.score - b.score || a.name.length - b.name.length);
      const seen = new Set();
      return candidates.filter(c => {
        const key = `${c.name}|${c.voicingName}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    },
  };

  /* ---------- MODULE 4 — STATE ----------
     selection[stringIndex] = null → not selected / not sounding
                              1..N → selected fret
     muted remains available for presentation mode, but normal chord analysis
     is based only on the notes the person actually placed on the fretboard.
     String index 0 = high e … 5 = low E. */
  const State = {
    selection: CONFIG.strings.map(() => null),
    muted: CONFIG.strings.map(() => false),
    barreFret: null,

    /** Toggle a fretted note. Only one visible note can be selected per string. */
    toggleFret(s, fret) {
      this.muted[s] = false;
      const wasOn = this.selection[s] === fret;
      this.selection[s] = wasOn ? null : fret;
      // If a note that visually defined the current full barre is removed (or
      // a lower fret is chosen), stop advertising it as a full barre.
      if (this.barreFret !== null && ((wasOn && fret === this.barreFret) || fret < this.barreFret)) {
        this.barreFret = null;
      }
    },

    /** Clicking a bottom fret number creates/removes a full six-string barre. */
    toggleBarre(fret) {
      if (this.barreFret === fret) {
        for (let s = 0; s < this.selection.length; s++) {
          if (this.selection[s] === fret) this.selection[s] = null;
        }
        this.barreFret = null;
        return;
      }
      this.barreFret = fret;
      this.muted.fill(false);
      this.selection.fill(fret);
    },

    toggleMute(s) {
      this.muted[s] = !this.muted[s];
      if (this.muted[s]) this.selection[s] = null;
    },

    clear() {
      this.selection.fill(null);
      this.muted.fill(false);
      this.barreFret = null;
    },

    clearOutsideRange(start, end) {
      this.selection = this.selection.map(f => (f !== null && (f < start || f > end)) ? null : f);
      if (this.barreFret !== null && (this.barreFret < start || this.barreFret > end)) this.barreFret = null;
    },

    /** Has the person placed at least one note? */
    touched() {
      return this.selection.some(f => f !== null);
    },
  };

  /* ---------- NORMAL-VIEW DISPLAY PREFERENCES ---------- */
  const Prefs = {
    rangeStart: 1,
    rangeEnd: CONFIG.frets,
    labelMode: 'note', // note | finger | hide

    load() {
      try {
        const a = +localStorage.getItem('ngw-cf-range-start');
        const b = +localStorage.getItem('ngw-cf-range-end');
        const m = localStorage.getItem('ngw-cf-label-mode');
        if (Number.isFinite(a) && a >= 1 && a <= CONFIG.frets) this.rangeStart = a;
        if (Number.isFinite(b) && b >= 1 && b <= CONFIG.frets) this.rangeEnd = b;
        if (this.rangeStart > this.rangeEnd) [this.rangeStart, this.rangeEnd] = [this.rangeEnd, this.rangeStart];
        if (['note', 'finger', 'hide'].includes(m)) this.labelMode = m;
      } catch (_) {}
    },

    save() {
      try {
        localStorage.setItem('ngw-cf-range-start', String(this.rangeStart));
        localStorage.setItem('ngw-cf-range-end', String(this.rangeEnd));
        localStorage.setItem('ngw-cf-label-mode', this.labelMode);
      } catch (_) {}
    },
  };

  function roleForInterval(interval, suffix) {
    if (interval === 0) return 'ROOT';
    if (interval === 1) return 'b9';
    if (interval === 2) return /9|11|13/.test(suffix) ? '9TH' : '2ND';
    if (interval === 3) return /#9/.test(suffix) ? '#9' : 'm3';
    if (interval === 4) return '3RD';
    if (interval === 5) return /11|13/.test(suffix) ? '11TH' : '4TH';
    if (interval === 6) return /#11/.test(suffix) ? '#11' : 'b5';
    if (interval === 7) return '5TH';
    if (interval === 8) return '#5';
    if (interval === 9) return /13/.test(suffix) ? '13TH' : '6TH';
    if (interval === 10) return 'b7';
    if (interval === 11) return '7TH';
    return '';
  }

  function fingerLabels() {
    const out = new Map();
    let nextFinger = 1;
    if (State.barreFret !== null) {
      for (let s = 0; s < State.selection.length; s++) {
        if (State.selection[s] === State.barreFret) out.set(`${s}:${State.barreFret}`, '1');
      }
      nextFinger = 2;
    }
    const rest = [];
    for (let s = 0; s < State.selection.length; s++) {
      const fret = State.selection[s];
      if (fret === null || fret === State.barreFret) continue;
      rest.push({ s, fret });
    }
    // Lowest fret first; on one fret, number from the bass side upward.
    rest.sort((a, b) => a.fret - b.fret || b.s - a.s);
    for (const x of rest) {
      out.set(`${x.s}:${x.fret}`, String(Math.min(nextFinger, 4)));
      nextFinger++;
    }
    return out;
  }

  /* ---------- i18n helper (falls back to English-ish keys) ---------- */
  function tr(key, ...args) {
    return typeof window.t === 'function' ? window.t(key, ...args) : key;
  }

  /* ---------- MODULE 5 — VIEW (normal interactive finder only) ---------- */
  const View = {
    els: null,
    built: false,

    grab() {
      this.els = {
        board: document.getElementById('cf-board'),
        name: document.getElementById('cf-chord-name'),
        voicing: document.getElementById('cf-voicing-line'),
        notes: document.getElementById('cf-notes-line'),
        alts: document.getElementById('cf-alts-line'),
        clear: document.getElementById('cf-clear-btn'),
        present: document.getElementById('cf-present'),
        rangeStart: document.getElementById('cf-range-start'),
        rangeEnd: document.getElementById('cf-range-end'),
        rangeLabel: document.getElementById('cf-range-label'),
        markerLabel: document.getElementById('cf-marker-label'),
        barreHint: document.getElementById('cf-barre-hint'),
        labelButtons: [...document.querySelectorAll('[data-cf-label-mode]')],
      };
      return !!(this.els.board && this.els.name && this.els.notes && this.els.alts && this.els.clear);
    },

    buildControls() {
      const { rangeStart, rangeEnd } = this.els;
      if (!rangeStart || !rangeEnd) return;
      const makeOptions = selected => {
        let html = '';
        for (let f = 1; f <= CONFIG.frets; f++) html += `<option value="${f}"${f === selected ? ' selected' : ''}>${f}</option>`;
        return html;
      };
      rangeStart.innerHTML = makeOptions(Prefs.rangeStart);
      rangeEnd.innerHTML = makeOptions(Prefs.rangeEnd);
      this.syncControls();
    },

    syncControls() {
      const { rangeStart, rangeEnd, labelButtons } = this.els;
      if (rangeStart) rangeStart.value = String(Prefs.rangeStart);
      if (rangeEnd) rangeEnd.value = String(Prefs.rangeEnd);
      labelButtons.forEach(btn => {
        const on = btn.dataset.cfLabelMode === Prefs.labelMode;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    },

    buildBoard() {
      const { board } = this.els;
      const n = CONFIG.strings.length;
      const start = Prefs.rangeStart;
      const end = Prefs.rangeEnd;
      const visibleFrets = end - start + 1;
      board.style.setProperty('--cf-frets', visibleFrets);
      board.innerHTML = '';

      const neck = document.createElement('div');
      neck.className = `cf-neck${start === 1 ? ' cf-at-nut' : ''}`;

      const strings = document.createElement('div');
      strings.className = 'cf-strings';

      // Familiar guitar inlays: single dots at 3/5/7/9 and a double dot at 12.
      const inlays = document.createElement('div');
      inlays.className = 'cf-inlays';
      inlays.setAttribute('aria-hidden', 'true');
      for (let f = start; f <= end; f++) {
        const slot = document.createElement('span');
        slot.className = 'cf-inlay-slot';
        if ([3, 5, 7, 9, 12].includes(f)) {
          slot.classList.add('has-inlay');
          slot.dataset.inlay = f === 12 ? 'double' : 'single';
          slot.innerHTML = f === 12 ? '<i></i><i></i>' : '<i></i>';
        }
        inlays.appendChild(slot);
      }
      strings.appendChild(inlays);

      // Fret wires run only from the first string to the sixth string.
      const wires = document.createElement('div');
      wires.className = 'cf-fret-wires';
      wires.setAttribute('aria-hidden', 'true');
      for (let f = start; f <= end; f++) wires.appendChild(document.createElement('span'));
      strings.appendChild(wires);

      // A bottom-number click makes a full barre; the subtle vertical capsule
      // keeps that relationship visible without turning the neck into a grid.
      const barreLayer = document.createElement('div');
      barreLayer.className = 'cf-barre-layer';
      barreLayer.setAttribute('aria-hidden', 'true');
      for (let f = start; f <= end; f++) {
        const slot = document.createElement('span');
        slot.className = 'cf-barre-slot';
        if (State.barreFret === f) slot.innerHTML = '<i class="cf-barre-marker"></i>';
        barreLayer.appendChild(slot);
      }
      strings.appendChild(barreLayer);

      CONFIG.strings.forEach((str, s) => {
        const row = document.createElement('div');
        row.className = 'cf-string-row';
        row.dataset.string = s;

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'cf-string-toggle';
        toggle.dataset.string = s;
        toggle.textContent = str.name.toUpperCase();
        toggle.setAttribute('aria-pressed', 'false');
        row.appendChild(toggle);

        for (let f = start; f <= end; f++) {
          const cell = document.createElement('button');
          cell.type = 'button';
          cell.className = 'cf-cell';
          cell.dataset.string = s;
          cell.dataset.fret = f;
          cell.style.setProperty('--cf-string-w', `${1.25 + (s / (n - 1)) * 1.55}px`);
          cell.setAttribute('aria-pressed', 'false');
          cell.innerHTML = '<span class="cf-dot" aria-hidden="true"></span>';
          row.appendChild(cell);
        }
        strings.appendChild(row);
      });

      const numbers = document.createElement('div');
      numbers.className = 'cf-fret-numbers';
      const spacer = document.createElement('span');
      spacer.className = 'cf-fret-number-spacer';
      spacer.setAttribute('aria-hidden', 'true');
      numbers.appendChild(spacer);
      for (let f = start; f <= end; f++) {
        const num = document.createElement('button');
        num.type = 'button';
        num.className = 'cf-fret-number';
        num.dataset.fret = f;
        num.textContent = f;
        num.setAttribute('aria-pressed', State.barreFret === f ? 'true' : 'false');
        numbers.appendChild(num);
      }

      neck.append(strings, numbers);
      board.appendChild(neck);

      this.built = true;
      this.applyLabels();
      this.renderBoard();
    },

    /** (Re)apply translated aria-labels/tooltips — cheap, safe to call any time. */
    applyLabels() {
      if (!this.built) return;
      const { board, clear, rangeLabel, markerLabel, barreHint, labelButtons } = this.els;
      clear.textContent = tr('cfClear');
      if (rangeLabel) rangeLabel.textContent = tr('cfFrets');
      if (markerLabel) markerLabel.textContent = tr('cfMarker');
      if (barreHint) barreHint.textContent = tr('cfBarreHint');
      const markerNames = { note: 'cfMarkerNote', finger: 'cfMarkerFinger', hide: 'cfMarkerHide' };
      labelButtons.forEach(btn => { btn.textContent = tr(markerNames[btn.dataset.cfLabelMode]); });

      board.querySelectorAll('.cf-string-row').forEach(row => {
        const str = CONFIG.strings[+row.dataset.string];
        row.setAttribute('role', 'group');
        row.setAttribute('aria-label', tr('cfStringAria', str.name));
      });
      board.querySelectorAll('.cf-string-toggle').forEach(btn => {
        const str = CONFIG.strings[+btn.dataset.string];
        btn.setAttribute('aria-label', tr('cfMuteAria', str.name));
        btn.title = tr('cfMuteTitle');
      });
      board.querySelectorAll('.cf-cell').forEach(cell => {
        const str = CONFIG.strings[+cell.dataset.string];
        const f = +cell.dataset.fret;
        cell.setAttribute('aria-label', tr('cfCellFretAria', str.name, f));
      });
      board.querySelectorAll('.cf-fret-number').forEach(btn => {
        const f = +btn.dataset.fret;
        btn.setAttribute('aria-label', tr('cfBarreAria', f));
        btn.title = tr('cfBarreTitle', f);
      });
      this.syncControls();
    },

    /** Sync note markers, labels, barre state and tuning-label mute states. */
    renderBoard() {
      const { board } = this.els;
      const fingers = fingerLabels();
      board.querySelectorAll('.cf-cell').forEach(cell => {
        const s = +cell.dataset.string;
        const f = +cell.dataset.fret;
        const on = State.selection[s] === f;
        const dot = cell.firstElementChild;
        let label = '';
        if (on && Prefs.labelMode === 'note') label = NOTE_NAMES[Theory.noteAt(CONFIG.strings[s], f)];
        if (on && Prefs.labelMode === 'finger') label = fingers.get(`${s}:${f}`) || '';
        dot.textContent = label;
        dot.classList.toggle('cf-on', on);
        dot.classList.toggle('cf-dot-unlabeled', Prefs.labelMode === 'hide');
        cell.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      board.querySelectorAll('.cf-string-row').forEach(row => {
        row.classList.toggle('cf-muted', State.muted[+row.dataset.string]);
      });
      board.querySelectorAll('.cf-string-toggle').forEach(btn => {
        btn.setAttribute('aria-pressed', State.muted[+btn.dataset.string] ? 'true' : 'false');
      });
      board.querySelectorAll('.cf-fret-number').forEach(btn => {
        btn.classList.toggle('is-barre', +btn.dataset.fret === State.barreFret);
        btn.setAttribute('aria-pressed', +btn.dataset.fret === State.barreFret ? 'true' : 'false');
      });
    },

    renderResult(result) {
      const { name, voicing, notes, alts } = this.els;
      name.textContent = result.title;
      name.classList.toggle('cf-is-hint', !!result.isHint);
      if (voicing) {
        voicing.textContent = result.voicingName && result.voicingName !== result.title
          ? `${tr('cfStrictVoicing')}: ${result.voicingName}`
          : (!result.isHint && result.voicingName ? `${tr('cfStrictVoicing')}: ${result.voicingName}` : '');
      }

      notes.innerHTML = '';
      (result.noteDetails || []).forEach(item => {
        const pill = document.createElement('span');
        pill.className = 'cf-note-pill';
        const strong = document.createElement('strong');
        strong.textContent = item.name;
        pill.appendChild(strong);
        if (item.role) {
          const small = document.createElement('small');
          small.textContent = item.role;
          pill.appendChild(small);
        }
        notes.appendChild(pill);
      });

      alts.innerHTML = '';
      if (result.alternatives && result.alternatives.length) {
        const lead = document.createElement('span');
        lead.className = 'cf-alts-label';
        lead.textContent = tr('cfAlso');
        alts.appendChild(lead);
        result.alternatives.forEach(alt => {
          const chip = document.createElement('span');
          chip.className = 'cf-alt-chip';
          chip.textContent = alt;
          alts.appendChild(chip);
        });
      }
    },
  };

  /* ---------- MODULE 5b — PRESENTATION MODE ----------
     A plain, printed-style chord diagram for showing the chord to other
     people: 6 strings, 5 fret rows, and each held note marked with just
     its FRET NUMBER (no note names, no string names, no controls).

     Which 5 frets? Real chord charts slide a window along the neck:
       - chord fits in frets 1-5  → window starts at fret 1, thick nut on top
       - otherwise                → window starts at the lowest fretted note,
                                    a "3fr"-style label names where it starts
     Above the strings: × = muted / not played, ○ = open string. */
  const Presentation = {
    active: false,

    /** Fret currently chosen on each string, ignoring muted ones. */
    held() {
      return CONFIG.strings.map((_, s) => State.muted[s] ? 'x' : (State.selection[s] === null ? 0 : State.selection[s]));
    },

    /** First fret of the 5-fret window (1 = shows the nut). */
    startFret(values) {
      const fretted = values.filter(v => typeof v === 'number' && v > 0);
      if (!fretted.length) return 1;
      const lo = Math.min(...fretted);
      const hi = Math.max(...fretted);
      if (hi <= CONFIG.presentationFrets) return 1;
      // Never run off the end of the neck.
      return Math.min(lo, CONFIG.frets - CONFIG.presentationFrets + 1);
    },

    /** Build the diagram as an inline SVG string. Colors come from CSS
        classes (see the Chord Finder block in style.css) so it follows the
        app's light/dark theme and accent automatically. */
    svg() {
      const values = this.held();
      const n = CONFIG.strings.length;
      const rows = CONFIG.presentationFrets;
      const start = this.startFret(values);
      const atNut = start === 1;

      // Geometry (viewBox units; the SVG scales to fit its container)
      const gap = 44;                    // string spacing
      const rowH = 52;                   // fret spacing
      const padL = 62;                   // always reserve room for the "3fr" label so the
                                         // diagram keeps one size (and doesn't jump) as chords change
      const padR = 62;
      const padTop = 58;                 // room for x / o markers
      const padBottom = 22;
      const gridW = gap * (n - 1);
      const gridH = rowH * rows;
      const W = padL + gridW + padR;
      const H = padTop + gridH + padBottom;
      const dotR = 17;

      // Column order: low E on the left, like a printed chord chart.
      const colX = c => padL + c * gap;
      const strAt = c => n - 1 - c;      // column → string index
      const rowY = r => padTop + r * rowH;   // top edge of fret row r (0-based)

      let out = `<svg class="cf-diagram" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeAttr(diagramAria(values, start))}" preserveAspectRatio="xMidYMid meet">`;

      // Fret wires (horizontal). The top line is the thick nut only at the open position.
      for (let r = 0; r <= rows; r++) {
        const isNut = r === 0 && atNut;
        out += `<line class="${isNut ? 'cf-d-nut' : 'cf-d-fret'}" x1="${colX(0)}" x2="${colX(n - 1)}" y1="${rowY(r)}" y2="${rowY(r)}"/>`;
      }
      // Strings (vertical)
      for (let c = 0; c < n; c++) {
        out += `<line class="cf-d-string" x1="${colX(c)}" x2="${colX(c)}" y1="${rowY(0)}" y2="${rowY(rows)}"/>`;
      }

      // "3fr"-style label when the window doesn't start at the nut
      if (!atNut) {
        out += `<text class="cf-d-startfret" x="${colX(0) - 14}" y="${rowY(0) + rowH / 2}" text-anchor="end" dominant-baseline="central">${start}fr</text>`;
      }

      // Markers above the nut + fretted dots
      for (let c = 0; c < n; c++) {
        const v = values[strAt(c)];
        const x = colX(c);
        if (v === 'x') {
          const y = padTop - 26, d = 7;
          out += `<path class="cf-d-x" d="M${x - d} ${y - d}L${x + d} ${y + d}M${x + d} ${y - d}L${x - d} ${y + d}"/>`;
        } else if (v === 0) {
          out += `<circle class="cf-d-open" cx="${x}" cy="${padTop - 26}" r="8"/>`;
        } else if (v >= start && v < start + rows) {
          const cy = rowY(v - start) + rowH / 2;
          out += `<circle class="cf-d-dot" cx="${x}" cy="${cy}" r="${dotR}"/>`;
          out += `<text class="cf-d-num" x="${x}" y="${cy}" text-anchor="middle" dominant-baseline="central">${v}</text>`;
        }
      }
      return out + '</svg>';
    },

    render() {
      const host = View.els.present;
      if (!host) return;

      // Presentation mode should still identify what is being shown. Keep a
      // fixed title slot above the diagram so entering presentation mode (or
      // changing the voicing before re-entering it) never makes the chart jump.
      const result = analyze();
      const chordName = result && !result.isHint ? result.title : '';
      host.innerHTML =
        `<div class="cf-present-stage">` +
          `<h1 class="cf-present-chord${chordName ? '' : ' is-empty'}">${escapeHtmlLocal(chordName || '–')}</h1>` +
          this.svg() +
        `</div>`;
    },
  };

  function escapeAttr(str) {
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  /** Screen-reader description of the diagram. */
  function diagramAria(values, start) {
    const parts = values.map((v, s) => {
      const name = CONFIG.strings[s].name;
      if (v === 'x') return `${name}: ${tr('cfMutedWord')}`;
      if (v === 0) return `${name}: ${tr('cfOpen')}`;
      return `${name}: ${v}`;
    });
    return `${tr('chordFinderTitle')} — ${parts.join(', ')}`;
  }

  /* ---------- MODULE 5c — KEBAB MENU ----------
     Same pattern as the song view's "…" menu (see openSongViewMenu() in
     app.js): a .kebab-dropdown anchored under the button, closed by any
     outside tap. The menu holds the single "Presentation mode" item for
     now; add more buttons here as the tool grows. */
  const Menu = {
    open: false,

    toggle() { this.open ? this.close() : this.show(); },

    show() {
      this.close(true);
      const btn = document.getElementById('cf-menu-btn');
      if (!btn) return;
      const host = btn.parentElement;
      const wrap = document.createElement('div');
      wrap.className = 'kebab-dropdown';
      wrap.id = 'cf-kebab-dropdown';
      const label = Presentation.active ? tr('exitPresentationModeBtn') : tr('presentationModeBtn');
      wrap.innerHTML =
        `<button type="button" id="cf-kebab-presentation" aria-pressed="${Presentation.active}">` +
        `<svg data-icon="presentation" viewBox="0 0 24 24"></svg>${escapeHtmlLocal(label)}</button>`;
      host.style.position = 'relative';
      host.appendChild(wrap);
      if (typeof window.initIcons === 'function') window.initIcons(wrap);
      this.open = true;
      btn.setAttribute('aria-expanded', 'true');

      wrap.querySelector('#cf-kebab-presentation').addEventListener('click', e => {
        e.stopPropagation();
        Menu.close();
        setPresentation(!Presentation.active);
      });
      wrap.addEventListener('click', e => e.stopPropagation());
    },

    close(immediate) {
      const btn = document.getElementById('cf-menu-btn');
      if (btn) btn.setAttribute('aria-expanded', 'false');
      const wrap = document.getElementById('cf-kebab-dropdown');
      this.open = false;
      if (!wrap) return;
      const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (immediate || reduce) { wrap.remove(); return; }
      wrap.removeAttribute('id');               // free the id while it animates out
      wrap.classList.add('kebab-dropdown-exit');
      wrap.addEventListener('animationend', () => wrap.remove(), { once: true });
    },
  };

  function escapeHtmlLocal(str) {
    return String(str).replace(/[&<>"']/g, ch => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
  }

  function setPresentation(on) {
    Presentation.active = !!on;
    const page = document.getElementById('page-chord-finder');
    if (page) page.classList.toggle('presentation-mode', Presentation.active);
    if (View.els && View.els.present) View.els.present.hidden = !Presentation.active;
    if (Presentation.active) Presentation.render();
    // Keep the screen awake while presenting (app.js decides via isPresenting()).
    if (typeof window.updateWakeLock === 'function') window.updateWakeLock();
  }

  /* ---------- MODULE 6 — ANALYSIS (normal finder only) ----------
     Normal mode now behaves like a reverse chord lookup: only the dots the
     person actually places are analyzed. Untouched strings are not silently
     counted as open strings. Presentation mode keeps its own existing logic. */
  function soundingSelected() {
    const notes = [];
    for (let s = CONFIG.strings.length - 1; s >= 0; s--) { // low string → high string
      const fret = State.selection[s];
      if (fret === null || State.muted[s]) continue;
      notes.push({ string: s, fret, pc: Theory.noteAt(CONFIG.strings[s], fret) });
    }
    return notes;
  }

  function noteDetailsFor(candidate, notes) {
    if (!candidate) {
      const seen = new Set();
      return notes.filter(x => !seen.has(x.pc) && seen.add(x.pc)).map(x => ({ name: NOTE_NAMES[x.pc], role: '' }));
    }
    const byPc = new Map();
    notes.forEach(x => {
      const interval = (x.pc - candidate.root + 12) % 12;
      if (!byPc.has(x.pc)) byPc.set(x.pc, { name: NOTE_NAMES[x.pc], role: roleForInterval(interval, candidate.type.suffix), interval });
    });
    return [...byPc.values()]
      .sort((a, b) => a.interval - b.interval)
      .map(({ name, role }) => ({ name, role }));
  }

  function analyze() {
    const notes = soundingSelected();
    if (!notes.length) {
      return { title: tr('cfHintStart'), isHint: true, voicingName: '', noteDetails: [], alternatives: [] };
    }

    const unique = [...new Set(notes.map(x => x.pc))];
    if (unique.length < CONFIG.minNotes) {
      return {
        title: tr('cfHintSelect'),
        isHint: true,
        voicingName: '',
        noteDetails: noteDetailsFor(null, notes),
        alternatives: [],
      };
    }

    const ranked = Theory.detect(unique, notes[0].pc);
    if (!ranked.length) {
      return {
        title: tr('cfHintUnknown'),
        isHint: true,
        voicingName: '',
        noteDetails: noteDetailsFor(null, notes),
        alternatives: [],
      };
    }

    return {
      title: ranked[0].name,
      isHint: false,
      voicingName: ranked[0].voicingName,
      noteDetails: noteDetailsFor(ranked[0], notes),
      alternatives: ranked.slice(1, 1 + CONFIG.maxAlternatives).map(c => c.name),
    };
  }

  function update() {
    View.renderBoard();
    View.renderResult(analyze());
    if (Presentation.active) Presentation.render();
  }

  function applyRangeFromControls(changed) {
    let start = +(View.els.rangeStart && View.els.rangeStart.value) || 1;
    let end = +(View.els.rangeEnd && View.els.rangeEnd.value) || CONFIG.frets;
    start = Math.max(1, Math.min(CONFIG.frets, start));
    end = Math.max(1, Math.min(CONFIG.frets, end));
    if (start > end) {
      if (changed === 'start') end = start;
      else start = end;
    }
    Prefs.rangeStart = start;
    Prefs.rangeEnd = end;
    Prefs.save();
    State.clearOutsideRange(start, end);
    View.buildBoard();
    View.syncControls();
    update();
  }

  /* ---------- MODULE 7 — EVENTS & INIT ---------- */
  let inited = false;
  function init() {
    if (inited) return;
    if (!View.grab()) return;
    inited = true;
    Prefs.load();
    State.clearOutsideRange(Prefs.rangeStart, Prefs.rangeEnd);

    View.els.board.addEventListener('click', e => {
      const fretNumber = e.target.closest('.cf-fret-number');
      if (fretNumber) {
        State.toggleBarre(+fretNumber.dataset.fret);
        View.buildBoard();
        return update();
      }
      const cell = e.target.closest('.cf-cell');
      if (cell) {
        State.toggleFret(+cell.dataset.string, +cell.dataset.fret);
        return update();
      }
      const stringToggle = e.target.closest('.cf-string-toggle');
      if (stringToggle) {
        State.toggleMute(+stringToggle.dataset.string);
        update();
      }
    });
    View.els.clear.addEventListener('click', () => { State.clear(); View.buildBoard(); update(); });

    if (View.els.rangeStart) View.els.rangeStart.addEventListener('change', () => applyRangeFromControls('start'));
    if (View.els.rangeEnd) View.els.rangeEnd.addEventListener('change', () => applyRangeFromControls('end'));
    View.els.labelButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        Prefs.labelMode = btn.dataset.cfLabelMode;
        Prefs.save();
        View.syncControls();
        View.renderBoard();
      });
    });

    const menuBtn = document.getElementById('cf-menu-btn');
    if (menuBtn) {
      menuBtn.addEventListener('click', e => { e.stopPropagation(); Menu.toggle(); });
      document.addEventListener('click', () => Menu.close());
    }

    View.buildControls();
    View.buildBoard();
    update();
  }

  function refreshLanguage() {
    if (!inited) return;
    View.applyLabels();
    View.renderResult(analyze());
    Menu.close(true);
    if (Presentation.active) Presentation.render();
  }

  /** Called by app.js when the page is left: drop presentation mode so the
      tool never reopens stuck in it (its only exit is the small kebab). */
  function exitPresentation() {
    if (!inited) return;
    Menu.close(true);
    if (Presentation.active) setPresentation(false);
  }

  function isPresenting() { return Presentation.active; }

  window.ChordFinder = { init, refreshLanguage, exitPresentation, isPresenting, _theory: Theory, _presentation: Presentation };
})();
