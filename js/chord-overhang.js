// ============================================================================
// Chord Overhang — collision-aware spacing for chord-over-lyric lines.
//
// renderLyrics() lays every word out as a small column: the chord chip on
// top, the word underneath, and the column is as wide as the WIDER of the two.
// That keeps neighbouring chords from ever touching, but it also means a short
// word under a wide chip ("та" under "Am") gets padded on its right, so the
// space after it looks bigger than every other word gap.
//
// Chord charts avoid this by only adding space when two chords would really
// collide. This module does the same, without touching the layout:
//
//   * It never changes the DOM text, the flex layout, or where lines wrap.
//     Spare room is reclaimed purely visually, by sliding the words that
//     FOLLOW a wide chip left with `transform: translateX(...)`. Because
//     transforms don't take part in layout, no word can reflow onto another
//     row, copy/paste is untouched, and removing the transforms restores the
//     exact original layout at any moment.
//   * A chip may overhang the gap and the chord-less words after it, but never
//     closer than one normal word gap to the next chord (the same minimum
//     separation the plain column layout already guarantees).
//   * A word can never end up closer to the next word than the normal word
//     gap: a shift is capped by the chip's own spare width.
//   * Mid-word chords are left alone: only the chip at the END of a word is
//     allowed to overhang.
//   * If anything can't be measured (hidden container, zero width, RTL, no
//     ResizeObserver...) nothing is shifted and the original layout stands.
//
// computeRowShifts() is pure geometry (no DOM) so it can be unit-tested.
// ============================================================================
(function () {
  'use strict';

  // Collision-limited overhangs keep this much extra clearance, in CSS px, so
  // sub-pixel rounding can never put two chips edge to edge.
  const SAFETY = 0.5;
  // Shifts smaller than this aren't worth a transform.
  const MIN_SHIFT = 1;
  // Settings changes animate (--dur-base is .22s); wait this long, then
  // re-measure. A transitionend listener catches anything slower.
  const SETTLE_MS = 420;

  // ---------------------------------------------------------------------------
  // Pure geometry
  // ---------------------------------------------------------------------------
  // `items` = the tokens (visual words) of ONE flex row, left to right, in
  // un-shifted CSS px:
  //   left          token's left edge
  //   firstChipLeft left edge of the first chord chip inside the token, or null
  //   endChip       the chip on the token's LAST piece, or null:
  //                 { left, width, slack }  slack = chip width - word width
  // `gap` = the normal word gap in px.
  // Returns how far (px, >= 0) each token should slide LEFT. Shifts are
  // cumulative: sliding a word left carries every later word in the row with it.
  function computeRowShifts(items, gap) {
    const shifts = new Array(items.length).fill(0);
    let cumulative = 0;
    for (let i = 0; i < items.length; i++) {
      shifts[i] = cumulative;
      const chip = items[i].endChip;
      if (!chip || !(chip.slack >= MIN_SHIFT)) continue;
      // Nothing after the last word of a row to pull in.
      if (i === items.length - 1) continue;
      // First chord after this word on the same row (it may sit inside a later
      // word). With none, only the chip's own spare width limits the shift.
      let nextChipLeft = Infinity;
      for (let k = i + 1; k < items.length; k++) {
        if (items[k].firstChipLeft != null) { nextChipLeft = items[k].firstChipLeft; break; }
      }
      // Un-shifted distance from this chip's right edge to the next chip's left
      // edge, minus the normal gap we must always keep between two chords.
      // (Both chips move by the same earlier shifts, so those cancel out; only
      // this word's own shift opens up the distance.)
      const room = nextChipLeft - chip.left - chip.width - gap;
      let o = chip.slack;
      if (room - SAFETY < o) o = room - SAFETY;
      if (!(o >= MIN_SHIFT)) continue;
      cumulative += o;
    }
    return shifts;
  }

  // ---------------------------------------------------------------------------
  // DOM measuring / applying
  // ---------------------------------------------------------------------------
  function isToken(el) {
    return el.nodeType === 1 && el.classList.contains('lyric-token');
  }

  // Reads only (no writes), so a whole container costs one layout.
  function measureLine(line, k) {
    const cs = getComputedStyle(line);
    if (cs.direction === 'rtl') return null;
    const gap = (parseFloat(cs.columnGap) || 0);
    const rows = [];
    let row = null;
    let prevLeft = -Infinity;
    for (const tok of line.children) {
      if (!isToken(tok)) continue;
      const shift = tok._chordShift || 0;               // transform we applied earlier
      const tr = tok.getBoundingClientRect();
      const left = tr.left / k + shift;                 // back to un-shifted CSS px
      if (!row || Math.abs(tr.bottom - row.bottom) > 2 || left < prevLeft - 0.5) {
        row = { bottom: tr.bottom, toks: [], items: [] };
        rows.push(row);
      }
      prevLeft = left;
      let firstChipLeft = null;
      let endChip = null;
      const pieces = tok.children;
      for (let p = 0; p < pieces.length; p++) {
        const piece = pieces[p];
        const first = piece.firstElementChild;
        if (!first || !first.classList.contains('chord-tag')) continue;
        const pr = piece.getBoundingClientRect();
        const pLeft = pr.left / k + shift;
        if (firstChipLeft === null) firstChipLeft = pLeft;
        if (p === pieces.length - 1) {
          const word = piece.lastElementChild;
          const wr = word && word.classList.contains('lyric-word') ? word.getBoundingClientRect() : null;
          endChip = { left: pLeft, width: pr.width / k, slack: wr ? (pr.width - wr.width) / k : 0 };
        }
      }
      row.toks.push(tok);
      row.items.push({ left, firstChipLeft, endChip });
    }
    return { gap, rows };
  }

  function setShift(tok, px) {
    const v = px >= MIN_SHIFT ? Math.round(px * 100) / 100 : 0;
    if ((tok._chordShift || 0) === v) return;
    tok._chordShift = v;
    tok.style.transform = v ? 'translateX(' + (-v) + 'px)' : '';
  }

  function clear(container) {
    container.querySelectorAll('.lyric-token').forEach(tok => {
      if (tok._chordShift) setShift(tok, 0);
    });
  }

  function apply(container) {
    if (!container || !container.isConnected) return;
    if (!container.getClientRects().length) return;       // hidden: measure later
    const w = container.offsetWidth;
    if (!(w > 0)) return;
    // Ancestors can scale the page during a transition; measure in CSS px.
    const k = container.getBoundingClientRect().width / w || 1;
    const plans = [];
    container.querySelectorAll('.lyric-line:not(.is-plain)').forEach(line => {
      const m = measureLine(line, k);
      if (m) plans.push(m);
    });
    plans.forEach(m => {
      m.rows.forEach(row => {
        const shifts = computeRowShifts(row.items, m.gap);
        row.toks.forEach((tok, i) => setShift(tok, shifts[i]));
      });
    });
  }

  // ---------------------------------------------------------------------------
  // When to re-measure
  // ---------------------------------------------------------------------------
  const containers = new Set();
  let ro = null;
  let rafId = 0;
  let settleTimer = 0;
  let settling = false;
  let booted = false;
  let sizeKey = '';

  function refreshAll() {
    containers.forEach(apply);
  }

  function schedule() {
    if (settling || rafId) return;
    rafId = requestAnimationFrame(() => { rafId = 0; if (!settling) refreshAll(); });
  }

  // A display setting changed (font/chord size, chord style, weight, spacing,
  // hide chords, verse numbers). Widths are about to animate, so drop the
  // shifts right away (the original, always-safe layout) and measure again once
  // the transitions have settled.
  function settingsChanged() {
    if (!containers.size) return;
    settling = true;
    containers.forEach(clear);
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => { settling = false; refreshAll(); }, SETTLE_MS);
  }

  function readSizeKey() {
    const cs = document.documentElement.style;
    return cs.getPropertyValue('--lyrics-size') + '|' + cs.getPropertyValue('--chord-size');
  }

  function boot() {
    if (booted) return;
    booted = true;
    if (typeof ResizeObserver !== 'undefined') ro = new ResizeObserver(schedule);
    if (document.fonts) {
      if (document.fonts.ready) document.fonts.ready.then(schedule);
      if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', schedule);
    }
    sizeKey = readSizeKey();
    if (typeof MutationObserver !== 'undefined') {
      new MutationObserver(records => {
        let changed = false;
        for (const r of records) {
          if (r.attributeName === 'style') {
            const key = readSizeKey();            // style also carries unrelated vars
            if (key !== sizeKey) { sizeKey = key; changed = true; }
          } else {
            changed = true;
          }
        }
        if (changed) settingsChanged();
      }).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['style', 'data-chord-style', 'data-hide-chords', 'data-lyrics-weight',
          'data-lyrics-spacing', 'data-lyrics-word-spacing', 'data-hide-verse-numbers'],
      });
    }
  }

  // Call right after a lyrics container is (re)built.
  function register(container) {
    if (!container) return;
    boot();
    if (!containers.has(container)) {
      containers.add(container);
      if (ro) ro.observe(container);
      // Slow transitions (or a settings change mid-way) can finish after the
      // settle timer; whenever one ends, measure again.
      container.addEventListener('transitionend', schedule, true);
    }
    apply(container);
  }

  window.ChordOverhang = Object.freeze({
    register, apply, refreshAll, settingsChanged, computeRowShifts,
  });
})();
