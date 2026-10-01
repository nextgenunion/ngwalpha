// ============================================================================
// Curated guitar voicings — familiar first-choice shapes only.
//
// Values are low E -> high e. -1 = mute, 0 = open. This is intentionally a
// small data layer, not a chord encyclopedia; Chord Finder's generator remains
// the fallback for everything not listed here (including slash chords).
// ============================================================================
(function () {
  'use strict';

  function shape(text) {
    const chars = String(text).trim().split('');
    if (chars.length !== 6) throw new Error(`Guitar voicing must have six strings: ${text}`);
    return Object.freeze(chars.map(ch => ch.toLowerCase() === 'x' ? -1 : parseInt(ch, 16)));
  }

  // Key = pitch-class:suffix. Enharmonic spellings therefore share the same
  // physical guitar shape (Bb and A# resolve to the same entry).
  const RAW = {
    // Major
    '0:': 'x32010', '1:': 'x46664', '2:': 'xx0232', '3:': 'x68886',
    '4:': '022100', '5:': '133211', '6:': '244322', '7:': '320003',
    '8:': '466544', '9:': 'x02220', '10:': 'x13331', '11:': 'x24442',

    // Minor
    '0:m': 'x35543', '1:m': 'x46654', '2:m': 'xx0231', '3:m': 'x68876',
    '4:m': '022000', '5:m': '133111', '6:m': '244222', '7:m': '355333',
    '8:m': '466444', '9:m': 'x02210', '10:m': 'x13321', '11:m': 'x24432',

    // Dominant 7
    '0:7': 'x32310', '1:7': 'x46464', '2:7': 'xx0212', '3:7': 'x68686',
    '4:7': '020100', '5:7': '131211', '6:7': '242322', '7:7': '320001',
    '8:7': '464544', '9:7': 'x02020', '10:7': 'x13131', '11:7': 'x21202',

    // Major 7 — common open shapes where practical, familiar movable shapes otherwise.
    '0:maj7': 'x32000', '1:maj7': 'x46564', '2:maj7': 'xx0222', '3:maj7': 'x68786',
    '4:maj7': '021100', '5:maj7': 'xx3210', '6:maj7': '243322', '7:maj7': '320002',
    '8:maj7': '465544', '9:maj7': 'x02120', '10:maj7': 'x13231', '11:maj7': 'x24342',

    // Minor 7
    '0:m7': 'x35343', '1:m7': 'x46454', '2:m7': 'xx0211', '3:m7': 'x68676',
    '4:m7': '020000', '5:m7': '131111', '6:m7': '242222', '7:m7': '353333',
    '8:m7': '464444', '9:m7': 'x02010', '10:m7': 'x13121', '11:m7': 'x24232',
  };

  const LIBRARY = new Map(Object.entries(RAW).map(([key, value]) => [key, shape(value)]));

  function get(parsed) {
    if (!parsed || parsed.bass !== null) return null;
    const values = LIBRARY.get(`${parsed.root}:${parsed.type.suffix}`);
    return values ? { values: values.slice(), source: 'curated' } : null;
  }

  function entries() {
    return [...LIBRARY.entries()].map(([key, values]) => ({ key, values: values.slice() }));
  }

  window.GuitarVoicings = Object.freeze({ get, entries });
})();
