// ============================================================================
// Chord Core — instrument-neutral chord parsing + naming.
//
// Guitar/piano renderers should consume this canonical model instead of each
// teaching themselves how to read chord strings. No DOM, storage, or app state.
// ============================================================================
(function () {
  'use strict';

  const NOTE_NAMES = Object.freeze(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']);
  const NOTE_PC = Object.freeze({
    C: 0, 'C#': 1, DB: 1, D: 2, 'D#': 3, EB: 3, E: 4,
    F: 5, 'F#': 6, GB: 6, G: 7, 'G#': 8, AB: 8,
    A: 9, 'A#': 10, BB: 10, B: 11,
  });

  // `required` tones define the quality; `optional` tones are normal chord
  // tones that real-world voicings commonly omit (most often the fifth).
  const TYPES = Object.freeze([
    { suffix: '',        intervals: [0,4,7],          required: [0,4],       optional: [7],       weight: 0, family: 'major' },
    { suffix: 'm',       intervals: [0,3,7],          required: [0,3],       optional: [7],       weight: 0, family: 'minor' },
    { suffix: '5',       intervals: [0,7],            required: [0,7],       optional: [],        weight: 1, family: 'power' },
    { suffix: 'dim',     intervals: [0,3,6],          required: [0,3,6],     optional: [],        weight: 2, family: 'diminished' },
    { suffix: 'aug',     intervals: [0,4,8],          required: [0,4,8],     optional: [],        weight: 2, family: 'augmented' },
    { suffix: 'sus2',    intervals: [0,2,7],          required: [0,2,7],     optional: [],        weight: 2, family: 'suspended' },
    { suffix: 'sus4',    intervals: [0,5,7],          required: [0,5,7],     optional: [],        weight: 2, family: 'suspended' },
    { suffix: '6',       intervals: [0,4,7,9],        required: [0,4,9],     optional: [7],       weight: 3, family: 'major' },
    { suffix: 'm6',      intervals: [0,3,7,9],        required: [0,3,9],     optional: [7],       weight: 3, family: 'minor' },
    { suffix: 'add9',    intervals: [0,2,4,7],        required: [0,2,4],     optional: [7],       weight: 2, family: 'major' },
    { suffix: 'madd9',   intervals: [0,2,3,7],        required: [0,2,3],     optional: [7],       weight: 2, family: 'minor' },
    { suffix: 'add11',   intervals: [0,4,5,7],        required: [0,4,5],     optional: [7],       weight: 3, family: 'major' },
    { suffix: 'madd11',  intervals: [0,3,5,7],        required: [0,3,5],     optional: [7],       weight: 3, family: 'minor' },
    { suffix: '6/9',     intervals: [0,2,4,7,9],      required: [0,2,4,9],   optional: [7],       weight: 4, family: 'major' },
    { suffix: 'm6/9',    intervals: [0,2,3,7,9],      required: [0,2,3,9],   optional: [7],       weight: 4, family: 'minor' },
    { suffix: '7',       intervals: [0,4,7,10],       required: [0,4,10],    optional: [7],       weight: 1, family: 'dominant' },
    { suffix: 'maj7',    intervals: [0,4,7,11],       required: [0,4,11],    optional: [7],       weight: 1, family: 'major' },
    { suffix: 'm7',      intervals: [0,3,7,10],       required: [0,3,10],    optional: [7],       weight: 1, family: 'minor' },
    { suffix: 'mMaj7',   intervals: [0,3,7,11],       required: [0,3,11],    optional: [7],       weight: 3, family: 'minor' },
    { suffix: 'm7b5',    intervals: [0,3,6,10],       required: [0,3,6,10],  optional: [],        weight: 2, family: 'diminished' },
    { suffix: 'dim7',    intervals: [0,3,6,9],        required: [0,3,6,9],   optional: [],        weight: 3, family: 'diminished' },
    { suffix: '7sus4',   intervals: [0,5,7,10],       required: [0,5,10],    optional: [7],       weight: 3, family: 'suspended' },
    { suffix: '7b5',     intervals: [0,4,6,10],       required: [0,4,6,10],  optional: [],        weight: 3, family: 'dominant' },
    { suffix: '7#5',     intervals: [0,4,8,10],       required: [0,4,8,10],  optional: [],        weight: 3, family: 'dominant' },
    { suffix: 'maj7#5',  intervals: [0,4,8,11],       required: [0,4,8,11],  optional: [],        weight: 4, family: 'major' },
    { suffix: '9',       intervals: [0,2,4,7,10],     required: [0,2,4,10],  optional: [7],       weight: 2, family: 'dominant' },
    { suffix: 'maj9',    intervals: [0,2,4,7,11],     required: [0,2,4,11],  optional: [7],       weight: 2, family: 'major' },
    { suffix: 'm9',      intervals: [0,2,3,7,10],     required: [0,2,3,10],  optional: [7],       weight: 2, family: 'minor' },
    { suffix: 'mMaj9',   intervals: [0,2,3,7,11],     required: [0,2,3,11],  optional: [7],       weight: 4, family: 'minor' },
    { suffix: '7b9',     intervals: [0,1,4,7,10],     required: [0,1,4,10],  optional: [7],       weight: 3, family: 'dominant' },
    { suffix: '7#9',     intervals: [0,3,4,7,10],     required: [0,3,4,10],  optional: [7],       weight: 3, family: 'dominant' },
    { suffix: '9sus4',   intervals: [0,2,5,7,10],     required: [0,2,5,10],  optional: [7],       weight: 4, family: 'suspended' },
    { suffix: '7#11',    intervals: [0,2,4,6,7,10],   required: [0,4,6,10],  optional: [2,7],     weight: 4, family: 'dominant' },
    { suffix: 'maj7#11', intervals: [0,2,4,6,7,11],   required: [0,4,6,11],  optional: [2,7],     weight: 5, family: 'major' },
    { suffix: '11',      intervals: [0,2,4,5,7,10],   required: [0,4,5,10],  optional: [2,7],     weight: 5, family: 'dominant' },
    { suffix: 'm11',     intervals: [0,2,3,5,7,10],   required: [0,3,5,10],  optional: [2,7],     weight: 4, family: 'minor' },
    { suffix: '13',      intervals: [0,2,4,5,7,9,10], required: [0,4,9,10],  optional: [2,5,7],   weight: 5, family: 'dominant' },
    { suffix: 'maj13',   intervals: [0,2,4,5,7,9,11], required: [0,4,9,11],  optional: [2,5,7],   weight: 6, family: 'major' },
    { suffix: 'm13',     intervals: [0,2,3,5,7,9,10], required: [0,3,9,10],  optional: [2,5,7],   weight: 5, family: 'minor' },
    { suffix: '13b9',    intervals: [0,1,4,7,9,10],   required: [0,1,4,9,10],optional: [7],       weight: 6, family: 'dominant' },
    { suffix: '7b13',    intervals: [0,4,7,8,10],     required: [0,4,8,10],  optional: [7],       weight: 5, family: 'dominant' },
  ].map(Object.freeze));

  const TYPE_BY_SUFFIX = new Map(TYPES.map(type => [type.suffix, type]));
  const OMIT_LABELS = Object.freeze({ 2: '9', 5: '11', 7: '5' });
  const EXACT_ALIASES = new Map([
    ['maj', ''], ['major', ''], ['M', ''], ['64', ''],
    ['min', 'm'], ['minor', 'm'], ['-', 'm'],
    ['2', 'sus2'], ['add2', 'add9'], ['m2', 'madd9'],
    ['4', 'sus4'], ['(4)', 'sus4'], ['add4', 'add11'], ['m4', 'madd11'],
    ['sus', 'sus4'], ['sus7', '7sus4'], ['7sus', '7sus4'], ['9sus', '9sus4'], ['sus9', '9sus4'],
    ['+', 'aug'], ['o', 'dim'], ['°', 'dim'], ['o7', 'dim7'], ['°7', 'dim7'], ['dim6', 'dim7'],
    ['ø', 'm7b5'], ['ø7', 'm7b5'],
    ['M7', 'maj7'], ['M9', 'maj9'], ['M13', 'maj13'], ['ma7', 'maj7'], ['maj79', 'maj9'],
    ['7(b5)', '7b5'], ['m7(b5)', 'm7b5'], ['m7(11)', 'm11'],
  ]);
  const LOWER_ALIASES = Object.freeze({
    maj7: 'maj7', maj9: 'maj9', maj13: 'maj13',
    min7: 'm7', min9: 'm9', min11: 'm11', min13: 'm13',
    minor7: 'm7', minor9: 'm9', minor11: 'm11', minor13: 'm13',
    mi: 'm', min: 'm', minor: 'm',
  });

  function normalizeAccidentals(value) {
    return String(value || '').replace(/♯/g, '#').replace(/♭/g, 'b');
  }

  function normalizeNoteName(name) {
    const m = normalizeAccidentals(name).trim().match(/^([A-Ga-g])([#b]?)$/);
    return m ? m[1].toUpperCase() + (m[2] || '') : '';
  }

  function notePc(name) {
    const normal = normalizeNoteName(name).toUpperCase();
    return Object.prototype.hasOwnProperty.call(NOTE_PC, normal) ? NOTE_PC[normal] : null;
  }

  function parse(symbol) {
    const original = String(symbol || '').trim();
    let raw = normalizeAccidentals(original).replace(/\s+/g, '');
    if (!raw) return null;

    // Only a final /Note is an inversion/slash bass. This deliberately keeps
    // the quality "6/9" intact.
    let bassName = '';
    const bassMatch = raw.match(/\/([A-Ga-g](?:#|b)?)$/);
    if (bassMatch) {
      bassName = normalizeNoteName(bassMatch[1]);
      raw = raw.slice(0, bassMatch.index);
    }

    const match = raw.match(/^([A-Ga-g])([#b]?)(.*)$/);
    if (!match) return null;
    const rootName = normalizeNoteName(match[1] + (match[2] || ''));
    const root = notePc(rootName);
    const bass = bassName ? notePc(bassName) : null;
    if (root === null || (bassName && bass === null)) return null;

    let suffix = match[3] || '';
    // C(add9), C(maj7), etc. Parentheses around a complete supported suffix
    // are formatting, not a different harmonic meaning.
    if (/^\([^()]+\)$/.test(suffix)) suffix = suffix.slice(1, -1);
    if (EXACT_ALIASES.has(suffix)) suffix = EXACT_ALIASES.get(suffix);
    else {
      const lower = suffix.toLowerCase();
      if (LOWER_ALIASES[lower]) suffix = LOWER_ALIASES[lower];
    }

    const type = TYPE_BY_SUFFIX.get(suffix);
    if (!type) return null;
    const canonical = rootName + type.suffix + (bassName ? `/${bassName}` : '');
    return Object.freeze({
      symbol: original,
      canonical,
      root,
      bass,
      rootName,
      bassName,
      suffix: type.suffix,
      family: type.family,
      type,
    });
  }

  /** Ranked instrument-neutral chord names for pitch classes + actual bass. */
  function identify(pitchClasses, bass) {
    const set = new Set((pitchClasses || []).map(Number).filter(Number.isFinite).map(pc => ((pc % 12) + 12) % 12));
    const bassPc = Number.isFinite(+bass) ? (((+bass % 12) + 12) % 12) : null;
    if (set.size < 2 || bassPc === null) return [];

    const candidates = [];
    for (const root of set) {
      for (const type of TYPES) {
        const abs = rel => (root + rel) % 12;
        const chordPcs = new Set(type.intervals.map(abs));
        if ([...set].some(pc => !chordPcs.has(pc))) continue;
        if (type.required.some(rel => !set.has(abs(rel)))) continue;

        const missingOptional = type.optional.filter(rel => !set.has(abs(rel)));
        const base = NOTE_NAMES[root] + type.suffix;
        const isSlash = root !== bassPc;
        const slash = isSlash ? `/${NOTE_NAMES[bassPc]}` : '';
        const omitted = missingOptional.map(rel => OMIT_LABELS[rel]).filter(Boolean);
        const omitText = omitted.length ? `(omit${omitted.join(',omit')})` : '';
        // Naming priority is intentionally musician-facing rather than purely
        // theoretical. Prefer a chord whose root is the ACTUAL bass, then a
        // complete/common formula, and only then an inversion/slash reading.
        // This keeps obvious shapes obvious (x02210 => Am, x32210-style
        // root-bass sixth voicings => C6) while still naming real inversions
        // such as 200232 => D/F#.
        const exactBonus = set.size === chordPcs.size ? -10 : 0;
        const omissionPenalty = missingOptional.length * 5;
        const rootBassBonus = isSlash ? 0 : -24;
        const slashPenalty = isSlash ? 24 : 0;
        const complexityPenalty = Math.max(0, type.suffix.length - 3) * 0.35;
        const score = type.weight * 10 + omissionPenalty + slashPenalty + rootBassBonus + exactBonus + complexityPenalty;
        candidates.push({
          name: base + slash,
          voicingName: base + omitText + slash,
          score,
          root,
          type,
          missingOptional,
          bass: bassPc,
          isSlash,
        });
      }
    }

    candidates.sort((a, b) => a.score - b.score || a.name.length - b.name.length);
    const seen = new Set();
    return candidates.filter(candidate => {
      const key = `${candidate.name}|${candidate.voicingName}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  window.ChordCore = Object.freeze({
    NOTE_NAMES,
    TYPES,
    parse,
    identify,
    notePc,
    normalizeNoteName,
  });
})();
