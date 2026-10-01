// ============================================================================
// Piano chords — keyboard model, chord detection and playable voicings.
//
// Piano counterpart to guitar-voicings.js + the guitar half of chord-finder.js.
// It consumes the instrument-neutral ChordCore model and has no DOM, storage
// or app state, so Chord Finder (and later the song chord popup) can render it
// however they like.
//
// Keys are plain indexes on a fixed two-octave keyboard: 0 = C3 … 23 = B4.
// ============================================================================
(function () {
  'use strict';

  const Core = window.ChordCore;
  if (!Core) {
    console.error('Piano chords: js/chord-core.js must load first.');
    return;
  }

  const KEY_COUNT = 24;
  const START_OCTAVE = 3;
  const WHITE_COUNT = 14;
  const BLACK_PCS = new Set([1, 3, 6, 8, 10]);
  // White-key ordinal inside one octave, by pitch class.
  const WHITE_ORDINAL = Object.freeze({ 0: 0, 2: 1, 4: 2, 5: 3, 7: 4, 9: 5, 11: 6 });

  function keyInfo(index) {
    const i = Math.max(0, Math.min(KEY_COUNT - 1, Math.floor(+index) || 0));
    const pc = i % 12;
    return {
      index: i,
      pc,
      name: Core.NOTE_NAMES[pc],
      octave: START_OCTAVE + Math.floor(i / 12),
      black: BLACK_PCS.has(pc),
    };
  }

  /** Horizontal placement in white-key widths: white keys occupy
      [ordinal, ordinal + 1); a black key is centred on the boundary between
      its two neighbouring white keys. */
  function layout(index) {
    const info = keyInfo(index);
    const octaveBase = Math.floor(info.index / 12) * 7;
    if (!info.black) {
      const ordinal = octaveBase + WHITE_ORDINAL[info.pc];
      return { black: false, ordinal, center: ordinal + 0.5 };
    }
    // The white key directly below a black key is always pc - 1.
    const below = octaveBase + WHITE_ORDINAL[info.pc - 1];
    return { black: true, ordinal: below, center: below + 1 };
  }

  /** Ranked chord names for a set of pressed keys. The lowest key is the bass,
      exactly like a real keyboard: E-G-C reads as C/E. */
  function identifyKeys(keys) {
    const sorted = [...new Set((keys || []).map(Number).filter(k => Number.isInteger(k) && k >= 0 && k < KEY_COUNT))]
      .sort((a, b) => a - b);
    if (!sorted.length) return { keys: [], ranked: [] };
    const pcs = [...new Set(sorted.map(k => k % 12))];
    return { keys: sorted, ranked: Core.identify(pcs, sorted[0] % 12) };
  }

  // Extension tones (9ths/11ths/13ths and their alterations) sit an octave
  // above the chord's core so a C9 reads C-E-G-Bb-D rather than a cluster.
  function isExtension(interval, suffix) {
    switch (interval) {
      case 1: return true;                    // b9
      case 2: return /9|11|13/.test(suffix);  // 9
      case 3: return /#9/.test(suffix);       // #9
      case 5: return /11|13/.test(suffix);    // 11
      case 6: return /#11/.test(suffix);      // #11
      case 8: return /b13/.test(suffix);      // b13
      case 9: return /13/.test(suffix);       // 13
      default: return false;
    }
  }

  /** Move a voicing down an octave while it overflows the keyboard. */
  function fit(keys) {
    let list = keys.slice();
    while (Math.max(...list) > KEY_COUNT - 1) {
      if (Math.min(...list) < 12) return null;
      list = list.map(k => k - 12);
    }
    return list;
  }

  /** Last resort for tall chords on high roots: fold overflowing tones down. */
  function fold(keys) {
    const out = new Set();
    keys.forEach(k => {
      let v = k;
      while (v > KEY_COUNT - 1) v -= 12;
      out.add(v);
    });
    return [...out].sort((a, b) => a - b);
  }

  function rawStack(parsed, lift = 0) {
    return parsed.type.intervals
      .map(iv => iv + (isExtension(iv, parsed.type.suffix) ? 12 : 0))
      .sort((a, b) => a - b)
      .map(offset => parsed.root + lift + offset);
  }

  function rootPosition(parsed) {
    const raw = rawStack(parsed);
    return fit(raw) || fold(raw);
  }

  function inversion(list, k) {
    if (!k) return list.slice();
    const rotated = list.slice(k).concat(list.slice(0, k).map(i => i + 12));
    return fit(rotated);
  }

  /** Distinct playable voicings for a chord symbol (or parsed chord).
      Root position first, then inversions; a slash chord leads with the shape
      that puts the requested bass note lowest. */
  function voicings(symbolOrParsed, limit = 4) {
    const parsed = typeof symbolOrParsed === 'string' ? Core.parse(symbolOrParsed) : symbolOrParsed;
    if (!parsed) return [];
    const cap = Math.max(1, Math.min(8, +limit || 4));
    const results = [];
    const seen = new Set();
    const add = (keys, label) => {
      if (!keys || !keys.length) return;
      const sorted = [...new Set(keys)].sort((a, b) => a - b);
      if (sorted[0] < 0 || sorted[sorted.length - 1] > KEY_COUNT - 1) return;
      const id = sorted.join(',');
      if (seen.has(id)) return;
      seen.add(id);
      results.push({ keys: sorted, label });
    };

    const base = rootPosition(parsed);

    if (parsed.bass !== null) {
      // Pure inversion when the bass is already a chord tone (C/E = E-G-C).
      const k = base.findIndex(key => key % 12 === parsed.bass);
      if (k > 0) add(inversion(base, k), 'inversion');
      else if (k === 0) add(base, 'root');
      // Bass note below the whole chord (works for non-chord basses too).
      // Folding (not shifting down) keeps every chord tone above the bass.
      const lift = parsed.root <= parsed.bass ? 12 : 0;
      const above = fold(rawStack(parsed, lift));
      if (Math.min(...above) > parsed.bass) add([parsed.bass].concat(above), 'slash');
    } else {
      add(base, 'root');
      // Inversions of six/seven-note extended chords are mostly clusters, so
      // only chords of up to five tones get them.
      if (base.length <= 5) for (let k = 1; k < base.length; k++) add(inversion(base, k), 'inversion');
    }
    return results.slice(0, cap);
  }

  window.PianoChords = Object.freeze({
    KEY_COUNT,
    WHITE_COUNT,
    START_OCTAVE,
    keyInfo,
    layout,
    identifyKeys,
    voicings,
  });
})();
