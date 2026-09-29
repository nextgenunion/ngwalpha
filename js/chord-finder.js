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
    minNotes: 3,
    maxAlternatives: 3,
    presentationFrets: 5,   // fret rows shown in presentation mode
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
     selection[stringIndex] = null  → untouched ("auto"): counts as open
                              0     → explicitly open
                              1..N  → fretted
     muted[stringIndex]     = boolean (string is not played)
     String index 0 = high e … 5 = low E. */
  const State = {
    selection: CONFIG.strings.map(() => null),
    muted: CONFIG.strings.map(() => false),

    /** Toggle back to untouched if same fret, otherwise replace. Un-mutes. */
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

    /** Has the person touched the board at all? */
    touched() {
      return this.selection.some(f => f !== null) || this.muted.some(Boolean);
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
        present: document.getElementById('cf-present'),
      };
      return !!(this.els.board && this.els.name && this.els.notes && this.els.alts && this.els.clear);
    },

    buildBoard() {
      const { board } = this.els;
      const n = CONFIG.strings.length;
      board.style.setProperty('--cf-frets', CONFIG.frets);
      board.innerHTML = '';

      // Horizontal guitar neck: six string rows, 12 fret spaces, a thick nut
      // at the left, and the fret numbers below the neck. The visual fret wires
      // live in one overlay so they run only from the top string to the bottom
      // string, just like a real fretboard instead of a table/grid.
      const neck = document.createElement('div');
      neck.className = 'cf-neck';

      const strings = document.createElement('div');
      strings.className = 'cf-strings';

      const wires = document.createElement('div');
      wires.className = 'cf-fret-wires';
      wires.setAttribute('aria-hidden', 'true');
      for (let f = 1; f <= CONFIG.frets; f++) {
        wires.appendChild(document.createElement('span'));
      }
      strings.appendChild(wires);

      CONFIG.strings.forEach((str, s) => {
        const row = document.createElement('div');
        row.className = 'cf-string-row';
        row.dataset.string = s;

        // The tuning label doubles as the existing mute control. In its normal
        // state it is visually just the E/B/G/D/A/E label from the reference.
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'cf-string-toggle';
        toggle.dataset.string = s;
        toggle.textContent = str.name.toUpperCase();
        toggle.setAttribute('aria-pressed', 'false');
        row.appendChild(toggle);

        for (let f = 1; f <= CONFIG.frets; f++) {
          const cell = document.createElement('button');
          cell.type = 'button';
          cell.className = 'cf-cell';
          cell.dataset.string = s;
          cell.dataset.fret = f;
          // Wound strings get progressively heavier toward the low E.
          cell.style.setProperty('--cf-string-w', `${1.35 + (s / (n - 1)) * 1.65}px`);
          cell.setAttribute('aria-pressed', 'false');
          cell.innerHTML = '<span class="cf-dot" aria-hidden="true"></span>';
          row.appendChild(cell);
        }
        strings.appendChild(row);
      });

      const numbers = document.createElement('div');
      numbers.className = 'cf-fret-numbers';
      numbers.setAttribute('aria-hidden', 'true');
      const spacer = document.createElement('span');
      spacer.className = 'cf-fret-number-spacer';
      numbers.appendChild(spacer);
      for (let f = 1; f <= CONFIG.frets; f++) {
        const num = document.createElement('span');
        num.className = 'cf-fret-number';
        num.textContent = f;
        numbers.appendChild(num);
      }

      neck.append(strings, numbers);
      board.appendChild(neck);

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
    },

    /** Sync the fret dots and tuning-label mute states with State. */
    renderBoard() {
      const { board } = this.els;
      board.querySelectorAll('.cf-cell').forEach(cell => {
        const s = +cell.dataset.string;
        const f = +cell.dataset.fret;
        const on = State.selection[s] === f;
        const dot = cell.firstElementChild;
        dot.classList.toggle('cf-on', on);
        cell.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      board.querySelectorAll('.cf-string-row').forEach(row => {
        row.classList.toggle('cf-muted', State.muted[+row.dataset.string]);
      });
      board.querySelectorAll('.cf-string-toggle').forEach(btn => {
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
      host.innerHTML = this.svg();
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

  /* ---------- MODULE 6 — ANALYSIS (glue between State, Theory, View) ----------
     Untouched strings count as open, so Em needs only its two fretted notes.
     But a guitarist usually doesn't play the low strings below the chord
     (Am is x02210, not the low E), and can't say so without tapping mute.
     So we also try dropping untouched strings that sit BELOW the lowest
     fretted string, lowest first, and keep whichever reading is best:
     a root-position name beats a slash chord, and each dropped string costs
     a little. Em (low E open) → "Em"; Am (low E untouched) → "Am", not "Am/E". */
  const DROP_PENALTY = 3;

  function soundingFor(dropCount) {
    const n = CONFIG.strings.length;
    // Lowest-pitched fretted string (largest index), if any
    let lowestFretted = -1;
    for (let s = 0; s < n; s++) if (State.selection[s] > 0) lowestFretted = Math.max(lowestFretted, s);

    // Droppable = untouched, unmuted strings lower than the lowest fretted one
    const droppable = [];
    if (lowestFretted >= 0) {
      for (let s = n - 1; s > lowestFretted; s--) {
        if (State.selection[s] === null && !State.muted[s]) droppable.push(s);
      }
    }
    const dropped = new Set(droppable.slice(0, dropCount));

    const notes = [];
    for (let s = n - 1; s >= 0; s--) {            // low string → high string
      if (State.muted[s] || dropped.has(s)) continue;
      const fret = State.selection[s] === null ? 0 : State.selection[s];
      notes.push({ string: s, fret, pc: Theory.noteAt(CONFIG.strings[s], fret) });
    }
    return { notes, maxDrop: droppable.length };
  }

  function analyze() {
    if (!State.touched()) {
      return { title: tr('cfHintStart'), isHint: true, noteNames: '', alternatives: [] };
    }

    const merged = new Map();  // name → { name, score, notes }
    let maxDrop = 0;
    for (let k = 0; k <= maxDrop; k++) {
      const { notes, maxDrop: md } = soundingFor(k);
      if (k === 0) maxDrop = md;
      const unique = [...new Set(notes.map(x => x.pc))];
      if (unique.length < CONFIG.minNotes) continue;
      Theory.detect(unique, notes[0].pc).forEach(c => {
        const score = c.score + k * DROP_PENALTY;
        const prev = merged.get(c.name);
        if (!prev || score < prev.score) merged.set(c.name, { name: c.name, score, notes });
      });
    }

    const ranked = [...merged.values()].sort((a, b) => a.score - b.score);
    if (!ranked.length) {
      const base = soundingFor(0).notes;
      const uniq = new Set(base.map(x => x.pc)).size;
      return {
        title: uniq < CONFIG.minNotes ? tr('cfHintSelect') : tr('cfHintUnknown'),
        isHint: true,
        noteNames: base.map(x => NOTE_NAMES[x.pc]).join('  '),
        alternatives: [],
      };
    }

    return {
      title: ranked[0].name,
      isHint: false,
      noteNames: ranked[0].notes.map(x => NOTE_NAMES[x.pc]).join('  '),
      alternatives: ranked.slice(1, 1 + CONFIG.maxAlternatives).map(c => c.name),
    };
  }

  function update() {
    View.renderBoard();
    View.renderResult(analyze());
    if (Presentation.active) Presentation.render();
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
      const stringToggle = e.target.closest('.cf-string-toggle');
      if (stringToggle) {
        State.toggleMute(+stringToggle.dataset.string);
        update();
      }
    });
    View.els.clear.addEventListener('click', () => { State.clear(); update(); });

    const menuBtn = document.getElementById('cf-menu-btn');
    if (menuBtn) {
      menuBtn.addEventListener('click', e => { e.stopPropagation(); Menu.toggle(); });
      document.addEventListener('click', () => Menu.close());
    }

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
