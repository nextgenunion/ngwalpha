/* ============================================================
   Chord Finder — built-in tool page (Settings → Tools → Chord Finder)

   Tap frets on a six-string guitar fretboard and the chord you are
   holding is named. Pure client-side; no data, no network.

   Ported from the standalone Chord Finder index.html into the app:
   the same theory/detection/state logic, but the DOM is scoped to
   #page-chord-finder (all ids/classes prefixed "cf-") and the look
   comes from the app's own theme tokens (see the "Chord Finder"
   block at the end of css/style.css).

   Public surface (used by app.js):
     ChordFinder.init()             build the board once (idempotent)
     ChordFinder.refreshLanguage()  re-render translated text
   ============================================================ */
(function () {
  'use strict';

  /* ---------- MODULE 1 — CONFIG (edit to change the instrument) ---------- */
  const CONFIG = {
    // Listed high string → low string, so the board reads like a chord
    // diagram (thin strings on top). Each string stores its open pitch class.
    strings: [
      { name: 'e', pitch: 4 },   // high E
      { name: 'B', pitch: 11 },
      { name: 'G', pitch: 7 },
      { name: 'D', pitch: 2 },
      { name: 'A', pitch: 9 },
      { name: 'E', pitch: 4 },   // low E
    ],
    frets: 12,
    minNotes: 3,
    maxAlternatives: 3,
  };

  /* ---------- MODULE 2 — MUSIC THEORY DATA ----------
     `intervals` are semitones above the root. `weight` biases ranking
     (lower = more likely to be picked first). Add a row to add a chord. */
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  const CHORD_TYPES = [
    { suffix: '',      intervals: [0, 4, 7],        weight: 0 },
    { suffix: 'm',     intervals: [0, 3, 7],        weight: 0 },
    { suffix: '7',     intervals: [0, 4, 7, 10],    weight: 1 },
    { suffix: 'maj7',  intervals: [0, 4, 7, 11],    weight: 1 },
    { suffix: 'm7',    intervals: [0, 3, 7, 10],    weight: 1 },
    { suffix: 'dim',   intervals: [0, 3, 6],        weight: 2 },
    { suffix: 'aug',   intervals: [0, 4, 8],        weight: 2 },
    { suffix: 'sus2',  intervals: [0, 2, 7],        weight: 2 },
    { suffix: 'sus4',  intervals: [0, 5, 7],        weight: 2 },
    { suffix: '6',     intervals: [0, 4, 7, 9],     weight: 3 },
    { suffix: 'm6',    intervals: [0, 3, 7, 9],     weight: 3 },
    { suffix: 'add9',  intervals: [0, 2, 4, 7],     weight: 2 },
    { suffix: 'm7b5',  intervals: [0, 3, 6, 10],    weight: 2 },
    { suffix: 'dim7',  intervals: [0, 3, 6, 9],     weight: 3 },
    { suffix: '7sus4', intervals: [0, 5, 7, 10],    weight: 3 },
    { suffix: '9',     intervals: [0, 2, 4, 7, 10], weight: 1 },
    { suffix: 'maj9',  intervals: [0, 2, 4, 7, 11], weight: 2 },
    { suffix: 'm9',    intervals: [0, 2, 3, 7, 10], weight: 2 },
    { suffix: '5',     intervals: [0, 7],           weight: 4, powerChord: true },
  ];

  /* ---------- MODULE 3 — CHORD DETECTION (pure, no DOM) ---------- */
  const Theory = {
    noteAt(stringDef, fret) {
      return (stringDef.pitch + fret) % 12;
    },

    /** Ranked chord candidates for the given pitch classes + bass note. */
    detect(pitchClasses, bass) {
      const set = new Set(pitchClasses);
      const candidates = [];

      for (const root of set) {
        for (const type of CHORD_TYPES) {
          const chordPcs = type.intervals.map(i => (root + i) % 12);
          // Must contain exactly the same pitch classes (no extras, none missing)
          if (chordPcs.length !== set.size) continue;
          if (!chordPcs.every(pc => set.has(pc))) continue;

          const base = NOTE_NAMES[root] + type.suffix;
          const isSlash = root !== bass;
          const name = isSlash ? `${base}/${NOTE_NAMES[bass]}` : base;

          // Lower score = better. Root position beats inversions.
          candidates.push({ name, score: type.weight * 10 + (isSlash ? 25 : 0) });
        }
      }

      candidates.sort((a, b) => a.score - b.score);
      const seen = new Set();
      return candidates.filter(c => !seen.has(c.name) && seen.add(c.name));
    },
  };

  /* ---------- MODULE 4 — STATE ----------
     selection[stringIndex] = fret number | null (unset)
     muted[stringIndex]     = boolean */
  const State = {
    selection: CONFIG.strings.map(() => null),
    muted: CONFIG.strings.map(() => false),

    /** Toggle off if same fret, otherwise replace. Un-mutes the string. */
    toggleFret(s, fret) {
      this.muted[s] = false;
      this.selection[s] = this.selection[s] === fret ? null : fret;
    },

    toggleMute(s) {
      this.muted[s] = !this.muted[s];
      if (this.muted[s]) this.selection[s] = null;
    },

    clear() {
      this.selection.fill(null);
      this.muted.fill(false);
    },

    /** Sounding notes, ordered low string → high string. */
    soundingNotes() {
      const notes = [];
      for (let s = CONFIG.strings.length - 1; s >= 0; s--) {
        const fret = this.selection[s];
        if (fret === null) continue;
        notes.push({ string: s, fret, pc: Theory.noteAt(CONFIG.strings[s], fret) });
      }
      return notes;
    },
  };

  /* ---------- i18n helper (falls back to English-ish keys) ---------- */
  function tr(key, ...args) {
    return typeof window.t === 'function' ? window.t(key, ...args) : key;
  }

  /* ---------- MODULE 5 — VIEW (all DOM work lives here) ---------- */
  const View = {
    els: null,
    built: false,

    grab() {
      this.els = {
        board: document.getElementById('cf-board'),
        name: document.getElementById('cf-chord-name'),
        notes: document.getElementById('cf-notes-line'),
        alts: document.getElementById('cf-alts-line'),
        clear: document.getElementById('cf-clear-btn'),
      };
      return !!(this.els.board && this.els.name && this.els.notes && this.els.alts && this.els.clear);
    },

    buildBoard() {
      const { board } = this.els;
      const cols = CONFIG.frets + 1; // fret 0 … fret N
      board.style.setProperty('--cf-cols', cols);
      board.innerHTML = '';

      CONFIG.strings.forEach((str, s) => {
        const row = document.createElement('div');
        row.className = 'cf-string-row';
        row.setAttribute('role', 'group');
        row.dataset.string = s;

        // Left column: string name + mute toggle
        const head = document.createElement('div');
        head.className = 'cf-string-head';
        const label = document.createElement('span');
        label.className = 'cf-string-name';
        label.setAttribute('aria-hidden', 'true');
        label.textContent = str.name;
        head.appendChild(label);

        const mute = document.createElement('button');
        mute.type = 'button';
        mute.className = 'cf-mute-btn';
        mute.dataset.string = s;
        mute.textContent = '×';
        mute.setAttribute('aria-pressed', 'false');
        head.appendChild(mute);
        row.appendChild(head);

        // Thicker strings toward the bass side (visual only)
        row.style.setProperty('--cf-string-w', `${1 + (s / (CONFIG.strings.length - 1)) * 2}px`);

        // Fret cells
        for (let f = 0; f <= CONFIG.frets; f++) {
          const cell = document.createElement('button');
          cell.type = 'button';
          cell.className = 'cf-cell' + (f === 0 ? ' cf-open' : '') + (f === 1 ? ' cf-nut-side' : '');
          cell.dataset.string = s;
          cell.dataset.fret = f;
          cell.setAttribute('aria-pressed', 'false');
          cell.innerHTML = '<span class="cf-dot"></span>';
          row.appendChild(cell);
        }
        board.appendChild(row);
      });

      // Fret number labels
      const nums = document.createElement('div');
      nums.className = 'cf-fret-numbers';
      nums.setAttribute('aria-hidden', 'true');
      nums.innerHTML = '<span></span>' +
        Array.from({ length: cols }, (_, f) => `<span>${f === 0 ? '' : f}</span>`).join('');
      board.appendChild(nums);

      this.built = true;
      this.applyLabels();
    },

    /** (Re)apply translated aria-labels/tooltips — cheap, safe to call any time. */
    applyLabels() {
      if (!this.built) return;
      const { board, clear } = this.els;
      clear.textContent = tr('cfClear');
      board.querySelectorAll('.cf-string-row').forEach(row => {
        const str = CONFIG.strings[+row.dataset.string];
        row.setAttribute('aria-label', tr('cfStringAria', str.name));
      });
      board.querySelectorAll('.cf-mute-btn').forEach(btn => {
        const str = CONFIG.strings[+btn.dataset.string];
        btn.setAttribute('aria-label', tr('cfMuteAria', str.name));
        btn.title = tr('cfMuteTitle');
      });
      board.querySelectorAll('.cf-cell').forEach(cell => {
        const str = CONFIG.strings[+cell.dataset.string];
        const f = +cell.dataset.fret;
        cell.setAttribute('aria-label', f === 0 ? tr('cfCellOpenAria', str.name) : tr('cfCellFretAria', str.name, f));
      });
      // The "open" caption under the fret numbers follows the language too.
      const first = board.querySelector('.cf-fret-numbers span:nth-child(2)');
      if (first) first.textContent = tr('cfOpen');
    },

    /** Sync dots and mute buttons with State. */
    renderBoard() {
      const { board } = this.els;
      board.querySelectorAll('.cf-cell').forEach(cell => {
        const s = +cell.dataset.string;
        const f = +cell.dataset.fret;
        const on = State.selection[s] === f;
        const dot = cell.firstElementChild;
        dot.classList.toggle('cf-on', on);
        cell.setAttribute('aria-pressed', on ? 'true' : 'false');
        // Show the note name inside fretted dots (open strings are hollow rings).
        dot.textContent = on && f !== 0 ? NOTE_NAMES[Theory.noteAt(CONFIG.strings[s], f)] : '';
      });
      board.querySelectorAll('.cf-mute-btn').forEach(btn => {
        btn.setAttribute('aria-pressed', State.muted[+btn.dataset.string] ? 'true' : 'false');
      });
    },

    renderResult(result) {
      const { name, notes, alts } = this.els;
      name.textContent = result.title;
      name.classList.toggle('cf-is-hint', !!result.isHint);
      notes.textContent = result.noteNames;
      alts.textContent = result.alternatives.length
        ? `${tr('cfAlso')} ${result.alternatives.join(' · ')}` : '';
    },
  };

  /* ---------- MODULE 6 — ANALYSIS (glue between State, Theory, View) ---------- */
  function analyze() {
    const notes = State.soundingNotes();
    const noteNames = notes.map(n => NOTE_NAMES[n.pc]).join('  ');

    const unique = [...new Set(notes.map(n => n.pc))];
    if (unique.length < CONFIG.minNotes) {
      return { title: tr('cfHintSelect'), isHint: true, noteNames, alternatives: [] };
    }

    const bass = notes[0].pc; // lowest sounding string
    const ranked = Theory.detect(unique, bass);
    if (!ranked.length) {
      return { title: tr('cfHintUnknown'), isHint: true, noteNames, alternatives: [] };
    }

    return {
      title: ranked[0].name,
      isHint: false,
      noteNames,
      alternatives: ranked.slice(1, 1 + CONFIG.maxAlternatives).map(c => c.name),
    };
  }

  function update() {
    View.renderBoard();
    View.renderResult(analyze());
  }

  /* ---------- MODULE 7 — EVENTS & INIT ---------- */
  let inited = false;
  function init() {
    if (inited) return;
    if (!View.grab()) return;
    inited = true;

    View.els.board.addEventListener('click', e => {
      const cell = e.target.closest('.cf-cell');
      if (cell) {
        State.toggleFret(+cell.dataset.string, +cell.dataset.fret);
        return update();
      }
      const mute = e.target.closest('.cf-mute-btn');
      if (mute) {
        State.toggleMute(+mute.dataset.string);
        update();
      }
    });
    View.els.clear.addEventListener('click', () => { State.clear(); update(); });

    View.buildBoard();
    update();
  }

  function refreshLanguage() {
    if (!inited) return;
    View.applyLabels();
    View.renderResult(analyze());
  }

  window.ChordFinder = { init, refreshLanguage, _theory: Theory };
})();
