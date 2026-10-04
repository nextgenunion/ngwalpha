/* ============================================================
   Chord Finder — built-in tool page (Settings → Tools → Chord Finder)

   Tap frets on a horizontal six-string guitar neck and the chord you are
   holding is named. Strings you leave alone count as open, so Em is just
   two taps; tap a tuning label at the left edge to mute that string.
   Pure client-side; no data, no network.

   Two instruments share the same page: Guitar (the fretboard above) and Piano
   (a two-octave keyboard from js/piano-chords.js). Tap keys and the chord is
   named from the pressed notes, lowest key = bass, so inversions come out as
   slash chords. Search and Presentation Mode follow the active instrument.

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
     ChordFinder.diagramForChord()  preferred diagram for a chord symbol
     ChordFinder.getChordVoicings() several distinct playable positions
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
    maxAlternatives: 3,
    presentationFrets: 5,   // fret rows shown in presentation mode
  };

  /* ---------- MODULE 2 — MUSIC THEORY DATA ---------- */
  const Core = window.ChordCore;
  if (!Core) {
    console.error('Chord Finder: js/chord-core.js must load first.');
    return;
  }
  const NOTE_NAMES = Core.NOTE_NAMES;
  const CHORD_TYPES = Core.TYPES;
  // Optional: if the piano module failed to load the tool simply stays
  // guitar-only (the instrument switch is hidden).
  const Piano = window.PianoChords || null;

  /* ---------- MODULE 3 — CHORD DETECTION (pure, no DOM) ---------- */
  const Theory = {
    noteAt(stringDef, fret) {
      return (stringDef.pitch + fret) % 12;
    },

    /** Ranked chord candidates for the given pitch classes + bass note. */
    detect(pitchClasses, bass) {
      return Core.identify(pitchClasses, bass);
    },
  };

  /* ---------- MODULE 4 — STATE ----------
     selection[stringIndex] = null → open string (unless muted)
                              1..N → selected fret
     This matches a real chord diagram: untouched strings sound open until the
     tuning label is tapped to mute them. It also keeps analysis and
     Presentation Mode in sync — a normal open Am therefore has A, not E, as
     its bass once the low-E string is muted.
     String index 0 = high e … 5 = low E. */
  const State = {
    selection: CONFIG.strings.map(() => null),
    muted: CONFIG.strings.map(() => false),
    // Interactive barres use the finder's string order: 0 = high e, 5 = low E.
    // The fret-number control creates one full barre; editing/muting endpoints
    // can naturally shrink it into a partial barre.
    barres: [],

    cleanupBarres() {
      const cleaned = [];
      for (const original of this.barres) {
        const fret = +original.fret;

        // Keep the span the musician originally asked the barre to cover
        // separate from the span that is currently drawable. Without this,
        // temporarily removing one endpoint permanently shrank the stored
        // barre; re-adding that note could never expand it again. That could
        // leave an F shape looking like a partial barre (or no barre at all)
        // in both the editor and Presentation Mode.
        const scopeFrom = Math.max(0, Math.min(
          this.selection.length - 1,
          Number.isFinite(+original.scopeFromString) ? +original.scopeFromString : +original.fromString,
        ));
        const scopeTo = Math.max(scopeFrom, Math.min(
          this.selection.length - 1,
          Number.isFinite(+original.scopeToString) ? +original.scopeToString : +original.toString,
        ));

        let best = null;
        let segStart = null;
        const consider = (a, b) => {
          if (a === null || b - a + 1 < 2) return;
          let exact = 0;
          for (let s = a; s <= b; s++) if (this.selection[s] === fret) exact++;
          if (!exact) return; // no note is still physically held by this barre
          const len = b - a + 1;
          if (!best || len > best.len || (len === best.len && exact > best.exact)) best = { a, b, len, exact };
        };

        for (let s = scopeFrom; s <= scopeTo; s++) {
          const held = !this.muted[s] && this.selection[s] !== null && this.selection[s] >= fret;
          if (held && segStart === null) segStart = s;
          if ((!held || s === scopeTo) && segStart !== null) {
            const segEnd = held && s === scopeTo ? s : s - 1;
            consider(segStart, segEnd);
            segStart = null;
          }
        }

        if (best) {
          cleaned.push({
            fret,
            fromString: best.a,
            toString: best.b,
            finger: original.finger || 1,
            scopeFromString: scopeFrom,
            scopeToString: scopeTo,
          });
        }
      }
      this.barres = cleaned;
    },

    /** Toggle a fretted note. Only one visible note can be selected per string. */
    toggleFret(s, fret) {
      this.muted[s] = false;
      const wasOn = this.selection[s] === fret;
      this.selection[s] = wasOn ? null : fret;
      this.cleanupBarres();
    },

    /** Clicking a bottom fret number creates/removes a full six-string barre. */
    toggleBarre(fret) {
      const existing = this.barres.find(b => b.fret === fret);
      if (existing) {
        for (let s = existing.fromString; s <= existing.toString; s++) {
          if (this.selection[s] === fret) this.selection[s] = null;
        }
        this.barres = this.barres.filter(b => b !== existing);
        this.cleanupBarres();
        return;
      }
      this.barres = [{ fret, fromString: 0, toString: this.selection.length - 1, finger: 1, scopeFromString: 0, scopeToString: this.selection.length - 1 }];
      this.muted.fill(false);
      this.selection.fill(fret);
    },

    toggleMute(s) {
      this.muted[s] = !this.muted[s];
      if (this.muted[s]) this.selection[s] = null;
      this.cleanupBarres();
    },

    clear() {
      this.selection.fill(null);
      this.muted.fill(false);
      this.barres = [];
    },

    clearOutsideRange(start, end) {
      this.selection = this.selection.map(f => (f !== null && (f < start || f > end)) ? null : f);
      this.barres = this.barres.filter(b => b.fret >= start && b.fret <= end);
      this.cleanupBarres();
    },

    /** Has the person placed at least one note? */
    touched() {
      return this.selection.some(f => f !== null);
    },
  };

  /* ---------- NORMAL-VIEW DISPLAY PREFERENCES ---------- */
  const Prefs = {
    rangeStart: 1,
    rangeEnd: 7,
    labelMode: 'hide', // note | finger | hide
    instrument: 'guitar', // guitar | piano
    pianoLabels: 'note',  // note | hide (pressed-key names on the keyboard)

    load() {
      try {
        const a = +localStorage.getItem('ngw-cf-range-start');
        const b = +localStorage.getItem('ngw-cf-range-end');
        const m = localStorage.getItem('ngw-cf-label-mode');
        const defaultsVersion = localStorage.getItem('ngw-cf-range-defaults');
        const markerDefaultsVersion = localStorage.getItem('ngw-cf-marker-defaults');

        // v5.0.4/5 could save the old 1–12 default as a side effect of
        // changing Marker mode. Migrate that old default once so existing
        // installs actually receive the new 1–7 default, while preserving
        // genuinely custom ranges such as 3–9 or 6–12.
        const oldDefault = defaultsVersion !== '1-7' && a === 1 && b === CONFIG.frets;
        if (!oldDefault) {
          if (Number.isFinite(a) && a >= 1 && a <= CONFIG.frets) this.rangeStart = a;
          if (Number.isFinite(b) && b >= 1 && b <= CONFIG.frets) this.rangeEnd = b;
        }
        if (this.rangeStart > this.rangeEnd) [this.rangeStart, this.rangeEnd] = [this.rangeEnd, this.rangeStart];

        // v5.0.11 changes the marker default from Note to Hide. Older builds
        // frequently persisted the old default (\"note\") as a side effect of
        // saving another Chord Finder preference, so migrate that old default
        // once. Explicit Finger/Hide choices are preserved.
        if (markerDefaultsVersion !== 'hide-v1' && (m === null || m === 'note')) {
          this.labelMode = 'hide';
        } else if (['note', 'finger', 'hide'].includes(m)) {
          this.labelMode = m;
        }
        const instrument = localStorage.getItem('ngw-cf-instrument');
        if (instrument === 'guitar' || (instrument === 'piano' && Piano)) this.instrument = instrument;
        const pianoLabels = localStorage.getItem('ngw-cf-piano-labels');
        if (pianoLabels === 'note' || pianoLabels === 'hide') this.pianoLabels = pianoLabels;
        localStorage.setItem('ngw-cf-range-defaults', '1-7');
        localStorage.setItem('ngw-cf-marker-defaults', 'hide-v1');
      } catch (_) {}
    },

    save() {
      try {
        localStorage.setItem('ngw-cf-range-start', String(this.rangeStart));
        localStorage.setItem('ngw-cf-range-end', String(this.rangeEnd));
        localStorage.setItem('ngw-cf-label-mode', this.labelMode);
        localStorage.setItem('ngw-cf-instrument', this.instrument);
        localStorage.setItem('ngw-cf-piano-labels', this.pianoLabels);
      } catch (_) {}
    },
  };

  /* Piano state: the set of pressed key indexes (0 = C3 … 23 = B4). The lowest
     pressed key is the bass, exactly as on a real keyboard. */
  const PianoState = {
    keys: new Set(),
    toggle(index) {
      if (this.keys.has(index)) this.keys.delete(index);
      else this.keys.add(index);
    },
    set(list) { this.keys = new Set(list); },
    clear() { this.keys.clear(); },
    sorted() { return [...this.keys].sort((a, b) => a - b); },
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

  function fingerLabels(selection = State.selection, barres = State.barres) {
    const out = new Map();
    let nextFinger = 1;
    const covered = new Set();
    if (Array.isArray(barres) && barres.length) {
      for (const barre of barres) {
        for (let s = barre.fromString; s <= barre.toString; s++) {
          if (selection[s] === barre.fret) {
            out.set(`${s}:${barre.fret}`, String(barre.finger || 1));
            covered.add(`${s}:${barre.fret}`);
          }
        }
      }
      nextFinger = 2;
    }
    const rest = [];
    for (let s = 0; s < selection.length; s++) {
      const fret = selection[s];
      if (fret === null || covered.has(`${s}:${fret}`)) continue;
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
        panel: document.querySelector('#page-chord-finder .cf-panel'),
        piano: document.getElementById('cf-piano-board'),
        instrument: document.getElementById('cf-instrument-toggle'),
      };
      return !!(this.els.board && this.els.name && this.els.notes && this.els.alts && this.els.clear);
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
        slot.dataset.fret = f;
        State.barres.filter(b => b.fret === f).forEach(barre => {
          slot.insertAdjacentHTML('beforeend', `<i class="cf-barre-marker" style="--cf-barre-from:${barre.fromString};--cf-barre-to:${barre.toString}"></i>`);
        });
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
        num.setAttribute('aria-pressed', State.barres.some(b => b.fret === f) ? 'true' : 'false');
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
      const { board, clear } = this.els;
      clear.textContent = tr('cfClear');

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
        const active = State.barres.some(b => b.fret === +btn.dataset.fret);
        btn.classList.toggle('is-barre', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
      // The barre background is a separate visual layer created by buildBoard().
      // Keep it in sync during ordinary cell edits too; otherwise clearing a
      // barre through its note dots leaves a stale/ghost capsule behind until
      // the board is rebuilt.
      board.querySelectorAll('.cf-barre-slot').forEach(slot => {
        const fret = +slot.dataset.fret;
        slot.innerHTML = '';
        State.barres.filter(b => b.fret === fret).forEach(barre => {
          const marker = document.createElement('i');
          marker.className = 'cf-barre-marker';
          marker.style.setProperty('--cf-barre-from', barre.fromString);
          marker.style.setProperty('--cf-barre-to', barre.toString);
          slot.appendChild(marker);
        });
      });
    },

    /* ----- Piano keyboard (interactive) ----- */
    buildPiano() {
      const host = this.els && this.els.piano;
      if (!host || !Piano) return;
      host.innerHTML = '';
      host.style.setProperty('--cf-white-count', Piano.WHITE_COUNT);

      const keys = document.createElement('div');
      keys.className = 'cf-keys';
      const whites = [];
      const blacks = [];
      for (let i = 0; i < Piano.KEY_COUNT; i++) {
        const info = Piano.keyInfo(i);
        const pos = Piano.layout(i);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `cf-key ${info.black ? 'cf-key-black' : 'cf-key-white'}`;
        btn.dataset.key = i;
        btn.setAttribute('aria-pressed', 'false');
        if (info.black) {
          btn.style.left = `calc(${(pos.center / Piano.WHITE_COUNT * 100).toFixed(4)}% - var(--cf-black-w) / 2)`;
        }
        const label = document.createElement('span');
        label.className = 'cf-key-label';
        btn.appendChild(label);
        (info.black ? blacks : whites).push(btn);
      }
      // Black keys come last in the DOM so they sit above the white keys.
      keys.append(...whites, ...blacks);
      host.appendChild(keys);
      this.applyPianoLabels();
      this.renderPiano();
    },

    applyPianoLabels() {
      const host = this.els && this.els.piano;
      if (!host || !Piano) return;
      host.setAttribute('role', 'group');
      host.setAttribute('aria-label', tr('cfPianoBoardAria'));
      host.querySelectorAll('.cf-key').forEach(btn => {
        const info = Piano.keyInfo(+btn.dataset.key);
        btn.setAttribute('aria-label', tr('cfKeyAria', info.name, info.octave));
      });
    },

    /** Sync pressed keys and their labels. Unpressed C keys carry a faint
        octave marker (C3, C4) so the player can find their place. */
    renderPiano() {
      const host = this.els && this.els.piano;
      if (!host || !Piano) return;
      host.querySelectorAll('.cf-key').forEach(btn => {
        const info = Piano.keyInfo(+btn.dataset.key);
        const on = PianoState.keys.has(info.index);
        btn.classList.toggle('cf-on', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        const label = btn.firstElementChild;
        let text = '';
        let hint = false;
        if (on && Prefs.pianoLabels === 'note') text = info.name;
        else if (!on && info.pc === 0) { text = `C${info.octave}`; hint = true; }
        label.textContent = text;
        label.classList.toggle('cf-key-hint', hint);
      });
    },

    /** Show the board for the active instrument and sync the switch. */
    applyInstrument() {
      if (!this.els) return;
      const { board, piano: pianoHost, panel, instrument } = this.els;
      const piano = Prefs.instrument === 'piano' && !!Piano;
      if (board) board.hidden = piano;
      if (pianoHost) pianoHost.hidden = !piano;
      if (panel) panel.setAttribute('aria-label', tr(piano ? 'cfPianoBoardAria' : 'cfGuitarBoardAria'));
      if (instrument) {
        const wrap = instrument.closest('.cf-instrument');
        if (wrap) wrap.hidden = !Piano;
        instrument.setAttribute('aria-label', tr('cfInstrument'));
        instrument.querySelectorAll('[data-cf-instrument]').forEach(btn => {
          const on = btn.dataset.cfInstrument === (piano ? 'piano' : 'guitar');
          btn.textContent = tr(btn.dataset.cfInstrument === 'piano' ? 'cfPiano' : 'cfGuitar');
          btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        if (typeof window.positionSegToggleThumb === 'function') window.positionSegToggleThumb(instrument);
      }
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
     A clean chord-viewer diagram for showing the voicing to other people:
     6 strings, 5 fret rows, a continuous barre when a barre is active, and
     a clear starting-fret label for shapes played above first position.

     Which 5 frets? The window slides along the neck:
       - chord fits in frets 1-5  → window starts at fret 1, thick nut on top
       - otherwise                → window starts at the lowest fretted note,
                                    and a "7fr"-style label anchors the shape
     Above the strings: × = muted / not played, ○ = open string. */
  const Presentation = {
    active: false,

    /** Fret currently chosen on each string, ignoring muted ones. Accepts a
        supplied diagram state so the SVG renderer can be used as a pure API. */
    held(diagramState) {
      const selection = diagramState ? diagramState.selection : State.selection;
      const muted = diagramState ? diagramState.muted : State.muted;
      return CONFIG.strings.map((_, s) => muted[s] ? 'x' : (selection[s] === null ? 0 : selection[s]));
    },

    /** First fret of the 5-fret window (1 = shows the nut). */
    startFret(values) {
      const fretted = values.filter(v => typeof v === 'number' && v > 0);
      if (!fretted.length) return 1;
      const lo = Math.min(...fretted);
      const hi = Math.max(...fretted);
      if (hi <= CONFIG.presentationFrets) return 1;
      // Keep the lowest held fret visible and never run off the 12-fret neck.
      return Math.min(lo, CONFIG.frets - CONFIG.presentationFrets + 1);
    },

    /** Return visible column spans for all active barres. Diagram state uses
        the finder's string order (0 = high e, 5 = low E). */
    barreSpans(start, rows, diagramState) {
      const selection = diagramState ? diagramState.selection : State.selection;
      const muted = diagramState ? diagramState.muted : State.muted;
      const barres = diagramState && Array.isArray(diagramState.barres) ? diagramState.barres : State.barres;
      const spans = [];
      const n = CONFIG.strings.length;
      for (const barre of barres || []) {
        const fret = +barre.fret;
        if (!Number.isFinite(fret) || fret < start || fret >= start + rows) continue;
        const cols = [];
        for (let s = barre.fromString; s <= barre.toString; s++) {
          const held = selection[s];
          if (!muted[s] && typeof held === 'number' && held >= fret) cols.push(n - 1 - s);
        }
        if (cols.length < 2) continue;
        spans.push({ fret, first: Math.min(...cols), last: Math.max(...cols), finger: barre.finger || 1 });
      }
      return spans;
    },

    /** Build the diagram as an inline SVG string. Colors come from CSS
        classes (see the Chord Finder block in style.css) so it follows the
        app's light/dark theme automatically. */
    svg(diagramState = null) {
      const values = this.held(diagramState);
      const n = CONFIG.strings.length;
      const rows = CONFIG.presentationFrets;
      const start = this.startFret(values);
      const atNut = start === 1;

      // Geometry (viewBox units; the SVG scales to fit its container)
      const gap = 44;
      const rowH = 52;
      const padL = 78;                   // permanent room for a visible "7fr" label
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
      const strAt = c => n - 1 - c;
      const rowY = r => padTop + r * rowH;
      const barres = this.barreSpans(start, rows, diagramState);

      let out = `<svg class="cf-diagram" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeAttr(diagramAria(values, start))}" preserveAspectRatio="xMidYMid meet">`;

      // Fret wires (horizontal). The top line is the thick nut only at first position.
      for (let r = 0; r <= rows; r++) {
        const isNut = r === 0 && atNut;
        out += `<line class="${isNut ? 'cf-d-nut' : 'cf-d-fret'}" x1="${colX(0)}" x2="${colX(n - 1)}" y1="${rowY(r)}" y2="${rowY(r)}"/>`;
      }
      // Strings (vertical)
      for (let c = 0; c < n; c++) {
        out += `<line class="cf-d-string" x1="${colX(c)}" x2="${colX(c)}" y1="${rowY(0)}" y2="${rowY(rows)}"/>`;
      }

      // Higher-position diagrams must explicitly show where the grid starts.
      if (!atNut) {
        out += `<text class="cf-d-startfret" x="${colX(0) - 16}" y="${rowY(0) + rowH / 2}" text-anchor="end" dominant-baseline="central">${start}fr</text>`;
      }

      // A barre is one finger laid across a contiguous string span. Render
      // full and partial barres with the exact same continuous capsule.
      for (const barre of barres) {
        const cy = rowY(barre.fret - start) + rowH / 2;
        const x1 = colX(barre.first);
        const x2 = colX(barre.last);
        out += `<rect class="cf-d-barre" x="${x1 - dotR}" y="${cy - dotR}" width="${x2 - x1 + dotR * 2}" height="${dotR * 2}" rx="${dotR}" ry="${dotR}"/>`;
        out += `<text class="cf-d-barre-num" x="${x1}" y="${cy}" text-anchor="middle" dominant-baseline="central">${barre.finger || 1}</text>`;
      }

      // Markers above the nut + individual fretted dots. Notes exactly on the
      // active barre are already represented by the long bar; notes above it
      // remain individual finger placements.
      const fingers = fingerLabels(diagramState ? diagramState.selection : State.selection, diagramState && Array.isArray(diagramState.barres) ? diagramState.barres : State.barres);
      for (let c = 0; c < n; c++) {
        const s = strAt(c);
        const v = values[s];
        const x = colX(c);
        if (v === 'x') {
          const y = padTop - 26, d = 7;
          out += `<path class="cf-d-x" d="M${x - d} ${y - d}L${x + d} ${y + d}M${x + d} ${y - d}L${x - d} ${y + d}"/>`;
        } else if (v === 0) {
          out += `<circle class="cf-d-open" cx="${x}" cy="${padTop - 26}" r="8"/>`;
        } else if (barres.some(barre => v === barre.fret && c >= barre.first && c <= barre.last)) {
          continue;
        } else if (v >= start && v < start + rows) {
          const cy = rowY(v - start) + rowH / 2;
          const finger = fingers.get(`${s}:${v}`) || '';
          out += `<circle class="cf-d-dot" cx="${x}" cy="${cy}" r="${dotR}"/>`;
          if (finger) out += `<text class="cf-d-num" x="${x}" y="${cy}" text-anchor="middle" dominant-baseline="central">${finger}</text>`;
        }
      }
      return out + '</svg>';
    },

    /** Two-octave keyboard as inline SVG with the pressed keys highlighted.
        Uses the same fixed ivory/ebony colours as the interactive keyboard so
        it reads identically in light and dark themes. */
    pianoSvg(keys) {
      const on = new Set(keys);
      const wW = 40, wH = 176, bW = 25, bH = 108, pad = 10;
      const W = pad * 2 + Piano.WHITE_COUNT * wW;
      const H = pad * 2 + wH;
      const showNames = Prefs.pianoLabels === 'note';
      const spoken = [...on].sort((a, b) => a - b).map(k => {
        const info = Piano.keyInfo(k);
        return `${info.name}${info.octave}`;
      }).join(', ');

      let out = `<svg class="cf-diagram cf-piano-diagram" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeAttr(`${tr('chordFinderTitle')} — ${spoken}`)}" preserveAspectRatio="xMidYMid meet">`;
      const labels = [];
      const blacks = [];
      for (let i = 0; i < Piano.KEY_COUNT; i++) {
        const info = Piano.keyInfo(i);
        const pos = Piano.layout(i);
        if (info.black) { blacks.push({ i, info, pos }); continue; }
        const x = pad + pos.ordinal * wW;
        out += `<rect class="cf-pd-white${on.has(i) ? ' is-on' : ''}" x="${x}" y="${pad}" width="${wW}" height="${wH}" rx="7" ry="7"/>`;
        if (on.has(i) && showNames) labels.push(`<text class="cf-pd-label is-white" x="${x + wW / 2}" y="${pad + wH - 18}" text-anchor="middle" dominant-baseline="central">${info.name}</text>`);
      }
      // Black keys are drawn after every white key so they sit on top.
      for (const { i, info, pos } of blacks) {
        const x = pad + pos.center * wW - bW / 2;
        out += `<rect class="cf-pd-black${on.has(i) ? ' is-on' : ''}" x="${x}" y="${pad}" width="${bW}" height="${bH}" rx="6" ry="6"/>`;
        if (on.has(i) && showNames) labels.push(`<text class="cf-pd-label is-black" x="${x + bW / 2}" y="${pad + bH - 16}" text-anchor="middle" dominant-baseline="central">${info.name}</text>`);
      }
      return out + labels.join('') + '</svg>';
    },

    render() {
      const host = View.els.present;
      if (!host) return;
      const piano = Prefs.instrument === 'piano' && !!Piano;

      // Presentation mode should still identify what is being shown. Keep a
      // fixed title slot above the diagram so entering presentation mode (or
      // changing the voicing before re-entering it) never makes the chart jump.
      const result = analyze();
      const chordName = result && !result.isHint ? result.title : '';
      host.innerHTML =
        `<div class="cf-present-stage${piano ? ' is-piano' : ''}">` +
          `<h1 class="cf-present-chord${chordName ? '' : ' is-empty'}">${escapeHtmlLocal(chordName || '–')}</h1>` +
          (piano ? this.pianoSvg(PianoState.sorted()) : this.svg()) +
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
      const fretOptions = selected => {
        let html = '';
        for (let f = 1; f <= CONFIG.frets; f++) {
          html += `<option value="${f}"${f === selected ? ' selected' : ''}>${f}</option>`;
        }
        return html;
      };
      const isPiano = Prefs.instrument === 'piano' && !!Piano;
      const markerNames = { note: 'cfMarkerNote', finger: 'cfMarkerFinger', hide: 'cfMarkerHide' };
      // A keyboard has no fingering or fret range: just show/hide key names.
      const markerModes = isPiano ? ['note', 'hide'] : ['note', 'finger', 'hide'];
      const activeMarker = isPiano ? Prefs.pianoLabels : Prefs.labelMode;
      const markerButtons = markerModes.map(mode =>
        `<button type="button" data-cf-menu-label-mode="${mode}" aria-pressed="${activeMarker === mode}">${escapeHtmlLocal(tr(markerNames[mode]))}</button>`
      ).join('');

      wrap.innerHTML =
        `<button type="button" id="cf-kebab-presentation" class="cf-menu-primary" aria-pressed="${Presentation.active}">` +
          `<svg data-icon="presentation" viewBox="0 0 24 24"></svg>${escapeHtmlLocal(label)}</button>` +
        `<div class="cf-menu-settings">` +
          (isPiano ? '' :
          `<div class="cf-menu-section">` +
            `<span class="cf-menu-label">${escapeHtmlLocal(tr('cfFrets'))}</span>` +
            `<div class="cf-menu-range">` +
              `<select id="cf-menu-range-start" aria-label="${escapeHtmlLocal(tr('cfFrets'))} start">${fretOptions(Prefs.rangeStart)}</select>` +
              `<span aria-hidden="true">–</span>` +
              `<select id="cf-menu-range-end" aria-label="${escapeHtmlLocal(tr('cfFrets'))} end">${fretOptions(Prefs.rangeEnd)}</select>` +
            `</div>` +
          `</div>`) +
          `<div class="cf-menu-section">` +
            `<span class="cf-menu-label">${escapeHtmlLocal(tr('cfMarker'))}</span>` +
            `<div class="cf-menu-segment" role="group" aria-label="${escapeHtmlLocal(tr('cfMarker'))}">${markerButtons}</div>` +
          `</div>` +
        `</div>`;
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

      const startSelect = wrap.querySelector('#cf-menu-range-start');
      const endSelect = wrap.querySelector('#cf-menu-range-end');
      if (startSelect && endSelect) {
        startSelect.addEventListener('change', () => applyRangeValues(+startSelect.value, +endSelect.value, 'start'));
        endSelect.addEventListener('change', () => applyRangeValues(+startSelect.value, +endSelect.value, 'end'));
      }
      wrap.querySelectorAll('[data-cf-menu-label-mode]').forEach(markerBtn => {
        markerBtn.addEventListener('click', () => {
          const mode = markerBtn.dataset.cfMenuLabelMode;
          if (isPiano) {
            Prefs.pianoLabels = mode;
            View.renderPiano();
            if (Presentation.active) Presentation.render();
          } else {
            Prefs.labelMode = mode;
            View.renderBoard();
          }
          Prefs.save();
          Menu.syncControls();
        });
      });
      wrap.addEventListener('click', e => e.stopPropagation());
      if (isPiano) this.syncControls(); // show the active Note/Hide choice immediately
    },

    syncControls() {
      const wrap = document.getElementById('cf-kebab-dropdown');
      if (!wrap) return;
      const start = wrap.querySelector('#cf-menu-range-start');
      const end = wrap.querySelector('#cf-menu-range-end');
      if (start) start.value = String(Prefs.rangeStart);
      if (end) end.value = String(Prefs.rangeEnd);
      wrap.querySelectorAll('[data-cf-menu-label-mode]').forEach(btn => {
        const current = Prefs.instrument === 'piano' && Piano ? Prefs.pianoLabels : Prefs.labelMode;
        const on = btn.dataset.cfMenuLabelMode === current;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
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
     A guitar chord shape treats every unmuted untouched string as OPEN. That
     is also how Presentation Mode already draws the shape, so analysis must
     use the same rule. The earlier selected-dots-only pass made an ordinary
     x02210 Am lose its open A bass and get mislabeled Am/E. */
  function soundingSelected() {
    const notes = [];
    for (let s = CONFIG.strings.length - 1; s >= 0; s--) { // low string → high string
      if (State.muted[s]) continue;
      const selected = State.selection[s];
      const fret = selected === null ? 0 : selected;
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

  function analyzePiano() {
    const keys = PianoState.sorted();
    if (!keys.length) {
      return { title: tr('cfPianoHintStart'), isHint: true, voicingName: '', noteDetails: [], alternatives: [] };
    }
    // Lowest key first, so the list reads like the keyboard from the bass up.
    const notes = keys.map(key => ({ key, pc: key % 12 }));
    const unique = [...new Set(notes.map(x => x.pc))];
    if (unique.length < CONFIG.minNotes) {
      return { title: tr('cfHintSelect'), isHint: true, voicingName: '', noteDetails: noteDetailsFor(null, notes), alternatives: [] };
    }
    const ranked = Piano.identifyKeys(keys).ranked;
    if (!ranked.length) {
      return { title: tr('cfHintUnknown'), isHint: true, voicingName: '', noteDetails: noteDetailsFor(null, notes), alternatives: [] };
    }
    return {
      title: ranked[0].name,
      isHint: false,
      voicingName: ranked[0].voicingName,
      noteDetails: noteDetailsFor(ranked[0], notes),
      alternatives: ranked.slice(1, 1 + CONFIG.maxAlternatives).map(c => c.name),
    };
  }

  function analyze() {
    if (Prefs.instrument === 'piano' && Piano) return analyzePiano();
    // At rest all six strings are technically open, but showing a chord name
    // before the person has touched the tool would be surprising. Wait until
    // at least one fret is placed or one string is muted, then analyze the
    // complete sounding shape (including every remaining open string).
    if (!State.touched() && !State.muted.some(Boolean)) {
      return { title: tr('cfHintStart'), isHint: true, voicingName: '', noteDetails: [], alternatives: [] };
    }
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
    View.renderPiano();
    View.renderResult(analyze());
    if (Presentation.active) Presentation.render();
  }

  function setInstrument(name) {
    const next = name === 'piano' && Piano ? 'piano' : 'guitar';
    if (next === Prefs.instrument) return;
    Prefs.instrument = next;
    Prefs.save();
    Search.invalidate();
    Menu.close(true);
    View.applyInstrument();
    update();
  }

  function applyRangeValues(start, end, changed) {
    Search.invalidate();
    start = Number.isFinite(start) ? start : Prefs.rangeStart;
    end = Number.isFinite(end) ? end : Prefs.rangeEnd;
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
    update();
    Menu.syncControls();
  }

  /* ---------- MODULE 6b — CHORD → DIAGRAM (song-view popup) ----------
     The song page can ask for a chord chart by symbol (Am, D/F#, Cmaj7…).
     No bitmap library is stored: the symbol is parsed into the same interval
     formulas above, a playable six-string voicing is generated locally, and
     the existing Presentation SVG renderer draws it. */
  const parseChordSymbol = Core.parse;

  function inferGeneratedBarres(valuesLowToHigh) {
    const fretted = valuesLowToHigh.filter(v => v > 0);
    if (!fretted.length) return [];
    const fret = Math.min(...fretted);
    const exact = [];
    valuesLowToHigh.forEach((v, i) => { if (v === fret) exact.push(i); });
    if (exact.length < 2) return [];
    const first = Math.min(...exact);
    const last = Math.max(...exact);
    // Avoid falsely turning ordinary two/three-note clusters (A, D, etc.)
    // into barres. Four-plus contiguous strings is a strong conventional
    // signal and correctly captures F/F#m and five-string B/Bm/C#m shapes.
    if (last - first + 1 < 4) return [];
    for (let i = first; i <= last; i++) {
      if (valuesLowToHigh[i] < fret) return [];
    }
    return [{ fret, fromString: first, toString: last, finger: 1 }];
  }

  function generatedVoicingScore(values, parsed, targetPcs) {
    const sounding = [];
    const lowStrings = [...CONFIG.strings].reverse();
    for (let i = 0; i < values.length; i++) {
      const fret = values[i];
      if (fret < 0) continue;
      sounding.push({ i, fret, pc: Theory.noteAt(lowStrings[i], fret) });
    }
    if (sounding.length < 3) return null;

    const pcs = new Set(sounding.map(x => x.pc));
    const chordPcsPresent = new Set([...pcs].filter(pc => targetPcs.has(pc)));
    const required = new Set(parsed.type.required.map(rel => (parsed.root + rel) % 12));
    if ([...required].some(pc => !chordPcsPresent.has(pc))) return null;
    if (chordPcsPresent.size < Math.min(3, targetPcs.size)) return null;

    const bass = sounding[0].pc;
    if (parsed.bass !== null && bass !== parsed.bass) return null;
    if (parsed.bass === null && bass !== parsed.root) return null;
    // A slash bass is allowed to be a non-chord tone (D/E, G/A, etc.), but
    // no other accidental pitch is allowed into the generated voicing.
    if ([...pcs].some(pc => !targetPcs.has(pc) && pc !== parsed.bass)) return null;

    const fretted = values.filter(v => v > 0);
    const minFret = fretted.length ? Math.min(...fretted) : 0;
    const maxFret = fretted.length ? Math.max(...fretted) : 0;
    const span = fretted.length ? maxFret - minFret : 0;
    if (span > 4) return null; // one clean five-fret presentation window

    const firstSound = values.findIndex(v => v >= 0);
    let lastSound = -1;
    for (let i = values.length - 1; i >= 0; i--) {
      if (values[i] >= 0) { lastSound = i; break; }
    }
    let internalMutes = 0;
    let adjacentTravel = 0;
    let prevFret = null;
    for (let i = firstSound; i <= lastSound; i++) {
      const fret = values[i];
      if (fret < 0) { internalMutes++; continue; }
      if (prevFret !== null) adjacentTravel += Math.abs(fret - prevFret);
      prevFret = fret;
    }

    const barres = inferGeneratedBarres(values);
    let fingerCount = fretted.length;
    for (const barre of barres) {
      let exactOnBarre = 0;
      for (let i = barre.fromString; i <= barre.toString; i++) if (values[i] === barre.fret) exactOnBarre++;
      fingerCount -= Math.max(0, exactOnBarre - 1);
    }

    const muted = values.filter(v => v < 0).length;
    const opens = values.filter(v => v === 0).length;
    const missing = [...targetPcs].filter(pc => !pcs.has(pc)).length;

    // Practical guitar-first ranking, following the same principle Fretscape
    // documents: familiar/simple voicings first, theoretical alternatives
    // later. Edge mutes are normal; holes inside a shape are strongly
    // discouraged. Root bass wins unless a slash bass was explicitly asked.
    let score = 0;
    score += muted * 12;
    score += internalMutes * 24;
    score += missing * 3;
    score += span * 3;
    score += fingerCount * 2;
    score += fretted.reduce((a, b) => a + b, 0) * 0.3;
    score += maxFret * 2;
    score += adjacentTravel * 2;
    if (opens && maxFret > 3) score += (maxFret - 3) * 7;
    score -= opens * 2.5;
    score += Math.abs(5 - sounding.length) * 2;
    score += parsed.bass !== null ? -10 : (bass === parsed.root ? -25 : 8);
    score += minFret * 0.5;

    return { score, values: values.slice(), barres };
  }

  const VOICING_CACHE = new Map();

  function voicingKey(values) {
    return values.join(',');
  }

  function voicingPositionKey(values) {
    if (values.some(v => v === 0)) return 'open';
    const fretted = values.filter(v => v > 0);
    return fretted.length ? String(Math.min(...fretted)) : 'none';
  }

  function searchGeneratedVoicings(parsed) {
    const targetPcs = new Set(parsed.type.intervals.map(rel => (parsed.root + rel) % 12));
    const lowStrings = [...CONFIG.strings].reverse(); // low E → high e
    const allowedPcs = new Set(targetPcs);
    if (parsed.bass !== null) allowedPcs.add(parsed.bass);
    const options = lowStrings.map(stringDef => {
      const out = [-1]; // muted
      for (let fret = 0; fret <= CONFIG.frets; fret++) {
        if (allowedPcs.has(Theory.noteAt(stringDef, fret))) out.push(fret);
      }
      return out;
    });

    // Keep the best candidate for each neck position so alternate-voicing
    // arrows actually move the hand to a meaningfully different shape rather
    // than cycling through tiny mute/doubling variations of the same grip.
    const bestByPosition = new Map();
    const bestOverall = [];
    const seenOverall = new Set();
    const current = new Array(lowStrings.length).fill(-1);

    function remember(candidate) {
      if (!candidate) return;
      const key = voicingKey(candidate.values);
      const posKey = voicingPositionKey(candidate.values);
      const atPos = bestByPosition.get(posKey);
      if (!atPos || candidate.score < atPos.score) bestByPosition.set(posKey, candidate);

      if (!seenOverall.has(key)) {
        seenOverall.add(key);
        bestOverall.push(candidate);
        bestOverall.sort((a, b) => a.score - b.score);
        if (bestOverall.length > 30) {
          const removed = bestOverall.pop();
          if (removed) seenOverall.delete(voicingKey(removed.values));
        }
      }
    }

    function walk(i, minPositive, maxPositive) {
      if (i === options.length) {
        remember(generatedVoicingScore(current, parsed, targetPcs));
        return;
      }
      for (const fret of options[i]) {
        let lo = minPositive;
        let hi = maxPositive;
        if (fret > 0) {
          lo = lo === null ? fret : Math.min(lo, fret);
          hi = hi === null ? fret : Math.max(hi, fret);
          if (hi - lo > 4) continue;
        }
        current[i] = fret;
        walk(i + 1, lo, hi);
      }
    }
    walk(0, null, null);

    return {
      byPosition: [...bestByPosition.values()].sort((a, b) => a.score - b.score),
      overall: bestOverall,
    };
  }

  /** Return several distinct playable voicings. Familiar curated shapes stay
      first; generated alternatives prefer different neck positions. */
  function generateVoicings(symbol, limit = 5) {
    const parsed = parseChordSymbol(symbol);
    if (!parsed) return [];
    const cappedLimit = Math.max(1, Math.min(8, +limit || 5));
    const cacheKey = parsed.canonical;
    let cached = VOICING_CACHE.get(cacheKey);
    if (!cached) {
      const results = [];
      const seen = new Set();
      const add = (candidate, source) => {
        if (!candidate || !Array.isArray(candidate.values)) return;
        const key = voicingKey(candidate.values);
        if (seen.has(key)) return;
        seen.add(key);
        results.push({
          score: candidate.score,
          values: candidate.values.slice(),
          barres: (candidate.barres || inferGeneratedBarres(candidate.values)).map(barre => ({ ...barre })),
          parsed,
          source: source || candidate.source || 'generated',
        });
      };

      // Familiar first-choice guitar shapes win for ordinary major/minor/7th
      // chords. The generator supplies alternate positions and uncommon chords.
      const curated = window.GuitarVoicings && window.GuitarVoicings.get(parsed);
      if (curated) add({
        score: -Infinity,
        values: curated.values,
        barres: inferGeneratedBarres(curated.values),
      }, curated.source || 'curated');

      const searched = searchGeneratedVoicings(parsed);
      searched.byPosition.forEach(candidate => add(candidate, 'generated'));
      // If position diversity yields fewer choices, fill with the next-best
      // distinct grips rather than returning an artificially tiny list.
      searched.overall.forEach(candidate => add(candidate, 'generated'));

      cached = results.slice(0, 8);
      VOICING_CACHE.set(cacheKey, cached);
    }
    return cached.slice(0, cappedLimit).map(item => ({
      ...item,
      values: item.values.slice(),
      barres: item.barres.map(barre => ({ ...barre })),
    }));
  }

  function generateVoicing(symbol) {
    return generateVoicings(symbol, 1)[0] || null;
  }

  /** Pure diagram renderer used by both Presentation Mode and external
      callers. `values` are ordered low E → high e and contain -1 (mute),
      0 (open), or a positive fret number. `barres` use that same low-to-high
      string numbering (0 = low E, 5 = high e). No interactive state is read
      or mutated. `barreFret` remains accepted as a legacy full-span hint. */
  function renderDiagram({ values, barres = null, barreFret = null } = {}) {
    if (!Array.isArray(values) || values.length !== CONFIG.strings.length) return null;

    const selection = CONFIG.strings.map(() => null);
    const muted = CONFIG.strings.map(() => false);
    values.forEach((value, lowIndex) => {
      const stateIndex = CONFIG.strings.length - 1 - lowIndex;
      const fret = Number(value);
      if (!Number.isFinite(fret) || fret < 0) {
        selection[stateIndex] = null;
        muted[stateIndex] = true;
      } else if (fret === 0) {
        selection[stateIndex] = null;
        muted[stateIndex] = false;
      } else {
        selection[stateIndex] = fret;
        muted[stateIndex] = false;
      }
    });

    let publicBarres = Array.isArray(barres) ? barres : [];
    if (!publicBarres.length && barreFret !== null) {
      const fret = +barreFret;
      const held = values.map((v, i) => ({ v: +v, i })).filter(x => x.v >= fret);
      if (held.length >= 2) publicBarres = [{ fret, fromString: held[0].i, toString: held[held.length - 1].i, finger: 1 }];
    }
    const stateBarres = publicBarres.map(barre => {
      const fromLow = Math.max(0, Math.min(CONFIG.strings.length - 1, +barre.fromString));
      const toLow = Math.max(fromLow, Math.min(CONFIG.strings.length - 1, +barre.toString));
      return {
        fret: +barre.fret,
        fromString: CONFIG.strings.length - 1 - toLow,
        toString: CONFIG.strings.length - 1 - fromLow,
        finger: +barre.finger || 1,
      };
    }).filter(barre => Number.isFinite(barre.fret) && barre.toString > barre.fromString);

    return Presentation.svg({ selection, muted, barres: stateBarres });
  }

  function getChordVoicings(symbol, limit = 5) {
    return generateVoicings(symbol, limit).map(generated => {
      const svg = renderDiagram({ values: generated.values, barres: generated.barres || [] });
      if (!svg) return null;
      return {
        svg,
        values: generated.values.slice(),
        barres: (generated.barres || []).map(barre => ({ ...barre })),
        // Compatibility for any older caller that only inspected one barre.
        barreFret: generated.barres && generated.barres[0] ? generated.barres[0].fret : null,
        source: generated.source || 'generated',
      };
    }).filter(Boolean);
  }

  function getPianoChordVoicings(symbol, limit = 4) {
    if (!Piano) return [];
    const parsed = Core.parse(symbol);
    if (!parsed) return [];
    return Piano.voicings(parsed, limit).map(voicing => ({
      svg: Presentation.pianoSvg(voicing.keys),
      keys: voicing.keys.slice(),
      label: voicing.label || 'root',
      source: 'piano',
    })).filter(item => item.svg);
  }

  function diagramForChord(symbol) {
    return getChordVoicings(symbol, 1)[0] || null;
  }

  /* ---------- MODULE 6c — CHORD SEARCH ----------
     Search uses the same parser + curated/generator pipeline as the song
     popup. A result is loaded into the actual interactive fretboard, so the
     person can immediately edit it instead of looking at a second viewer. */
  const Search = {
    results: [],
    index: 0,
    symbol: '',

    els() {
      return {
        form: document.getElementById('cf-search-form'),
        input: document.getElementById('cf-search-input'),
        submit: document.getElementById('cf-search-submit'),
        prev: document.getElementById('cf-search-prev'),
        next: document.getElementById('cf-search-next'),
        count: document.getElementById('cf-search-count'),
        nav: document.getElementById('cf-search-nav'),
        status: document.getElementById('cf-search-status'),
      };
    },

    applyLanguage() {
      const { input, submit, prev, next } = this.els();
      if (input) {
        input.placeholder = tr('cfSearchPlaceholder');
        input.setAttribute('aria-label', tr('cfSearchAria'));
      }
      if (submit) {
        submit.setAttribute('aria-label', tr('cfSearchButton'));
        submit.title = tr('cfSearchButton');
      }
      if (prev) {
        prev.setAttribute('aria-label', tr('cfPreviousVoicing'));
        prev.title = tr('cfPreviousVoicing');
      }
      if (next) {
        next.setAttribute('aria-label', tr('cfNextVoicing'));
        next.title = tr('cfNextVoicing');
      }
    },

    invalidate() {
      this.results = [];
      this.index = 0;
      const { nav, status } = this.els();
      if (nav) nav.hidden = true;
      if (status) status.textContent = '';
    },

    preferredRange(values) {
      const fretted = values.filter(v => v > 0);
      if (!fretted.length) return { start: 1, end: 7 };
      const lo = Math.min(...fretted);
      const hi = Math.max(...fretted);
      if (hi <= 7) return { start: 1, end: 7 };
      let start = Math.min(lo, Math.max(1, hi - 6));
      start = Math.min(start, CONFIG.frets - 6);
      return { start, end: Math.min(CONFIG.frets, start + 6) };
    },

    load(voicing) {
      // Piano voicings are plain key lists; guitar voicings carry string values.
      if (voicing && Array.isArray(voicing.keys)) {
        PianoState.set(voicing.keys);
        update();
        this.sync();
        return;
      }
      if (!voicing || !Array.isArray(voicing.values)) return;
      State.selection.fill(null);
      State.muted.fill(false);
      State.barres = [];

      // Public voicings are low E → high e; interactive state is reversed.
      voicing.values.forEach((value, lowIndex) => {
        const stateIndex = CONFIG.strings.length - 1 - lowIndex;
        const fret = +value;
        if (!Number.isFinite(fret) || fret < 0) {
          State.muted[stateIndex] = true;
        } else if (fret > 0) {
          State.selection[stateIndex] = fret;
        }
      });
      State.barres = (voicing.barres || []).map(barre => {
        const fromLow = Math.max(0, Math.min(CONFIG.strings.length - 1, +barre.fromString));
        const toLow = Math.max(fromLow, Math.min(CONFIG.strings.length - 1, +barre.toString));
        const fromString = CONFIG.strings.length - 1 - toLow;
        const toString = CONFIG.strings.length - 1 - fromLow;
        return {
          fret: +barre.fret,
          fromString,
          toString,
          finger: +barre.finger || 1,
          scopeFromString: fromString,
          scopeToString: toString,
        };
      });
      State.cleanupBarres();

      const range = this.preferredRange(voicing.values);
      Prefs.rangeStart = range.start;
      Prefs.rangeEnd = range.end;
      View.buildBoard();
      update();
      Menu.syncControls();
      this.sync();
    },

    run(rawSymbol) {
      const { input, status } = this.els();
      const symbol = String(rawSymbol != null ? rawSymbol : (input ? input.value : '')).trim();
      if (!symbol) return;
      const parsed = parseChordSymbol(symbol);
      if (!parsed) {
        this.results = [];
        this.index = 0;
        this.symbol = '';
        this.sync();
        if (status) status.textContent = tr('cfSearchInvalid');
        return;
      }
      const results = Prefs.instrument === 'piano' && Piano
        ? Piano.voicings(parsed, 4)
        : getChordVoicings(parsed.canonical, 5);
      if (!results.length) {
        this.results = [];
        this.index = 0;
        this.symbol = parsed.canonical;
        this.sync();
        if (status) status.textContent = tr('cfSearchUnavailable');
        return;
      }
      this.results = results;
      this.index = 0;
      this.symbol = parsed.canonical;
      if (input) input.value = parsed.canonical;
      if (status) status.textContent = '';
      this.load(results[0]);
    },

    move(delta) {
      if (this.results.length < 2) return;
      this.index = (this.index + delta + this.results.length) % this.results.length;
      this.load(this.results[this.index]);
    },

    sync() {
      const { nav, prev, next, count, status } = this.els();
      const hasResults = this.results.length > 0;
      if (nav) nav.hidden = !hasResults;
      if (prev) prev.disabled = this.results.length < 2;
      if (next) next.disabled = this.results.length < 2;
      if (count) count.textContent = hasResults ? `${this.index + 1} / ${this.results.length}` : '';
      if (!hasResults && status && !status.textContent) status.textContent = '';
    },
  };

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
        Search.invalidate();
        State.toggleBarre(+fretNumber.dataset.fret);
        View.buildBoard();
        return update();
      }
      const cell = e.target.closest('.cf-cell');
      if (cell) {
        Search.invalidate();
        State.toggleFret(+cell.dataset.string, +cell.dataset.fret);
        return update();
      }
      const stringToggle = e.target.closest('.cf-string-toggle');
      if (stringToggle) {
        Search.invalidate();
        State.toggleMute(+stringToggle.dataset.string);
        update();
      }
    });
    View.els.clear.addEventListener('click', () => {
      Search.invalidate();
      if (Prefs.instrument === 'piano' && Piano) {
        PianoState.clear();
      } else {
        State.clear();
        View.buildBoard();
      }
      update();
    });

    if (Piano && View.els.piano) {
      View.els.piano.addEventListener('click', e => {
        const key = e.target.closest('.cf-key');
        if (!key) return;
        Search.invalidate();
        PianoState.toggle(+key.dataset.key);
        update();
      });
    }
    if (View.els.instrument) {
      View.els.instrument.addEventListener('click', e => {
        const btn = e.target.closest('[data-cf-instrument]');
        if (btn) setInstrument(btn.dataset.cfInstrument);
      });
    }

    const searchEls = Search.els();
    if (searchEls.form) {
      searchEls.form.addEventListener('submit', e => {
        e.preventDefault();
        Search.run();
      });
      if (searchEls.prev) searchEls.prev.addEventListener('click', () => Search.move(-1));
      if (searchEls.next) searchEls.next.addEventListener('click', () => Search.move(1));
    }

    const menuBtn = document.getElementById('cf-menu-btn');
    if (menuBtn) {
      menuBtn.addEventListener('click', e => { e.stopPropagation(); Menu.toggle(); });
      document.addEventListener('click', () => Menu.close());
    }

    Search.applyLanguage();
    View.buildBoard();
    View.buildPiano();
    View.applyInstrument();
    update();
  }

  function refreshLanguage() {
    if (!inited) return;
    View.applyLabels();
    View.applyPianoLabels();
    View.applyInstrument();
    if (View.els.instrument && typeof window.positionSegToggleThumb === 'function') {
      window.positionSegToggleThumb(View.els.instrument, { instant: true });
    }
    Search.applyLanguage();
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

  window.ChordFinder = Object.freeze({ init, refreshLanguage, exitPresentation, isPresenting, renderDiagram, diagramForChord, getChordVoicings, getPianoChordVoicings });
})();
