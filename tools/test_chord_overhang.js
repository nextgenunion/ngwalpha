const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const ctx = { console };
ctx.window = ctx;
vm.runInNewContext(fs.readFileSync(__dirname + '/../js/chord-overhang.js', 'utf8'), ctx);
// Arrays built inside the vm context have a different prototype; normalise them.
const computeRowShifts = (items, gap) => Array.from(ctx.ChordOverhang.computeRowShifts(items, gap));
const close = (a, b, m) => assert(Math.abs(a - b) < 1e-6, `${m || ''} expected ${b}, got ${a}`);

const GAP = 4.8;

// Tiny model of the real column layout so cases read like song lines.
// token = pieces [{chip: width|null, word: width}], pieces sit side by side
// (no gap), tokens are separated by GAP, each piece is max(chip, word) wide.
function layout(tokens, gap = GAP) {
  let x = 0;
  const items = [], model = [];
  tokens.forEach(pieces => {
    const left = x;
    let px = left, firstChipLeft = null, endChip = null;
    const placed = pieces.map((p, i) => {
      const w = Math.max(p.chip || 0, p.word);
      const rec = { left: px, width: w, chip: p.chip, word: p.word };
      if (p.chip != null) {
        if (firstChipLeft === null) firstChipLeft = px;
        if (i === pieces.length - 1) endChip = { left: px, width: w, slack: w - p.word };
      }
      px += w;
      return rec;
    });
    items.push({ left, firstChipLeft, endChip });
    model.push({ left, placed, width: px - left });
    x = px + gap;
  });
  return { items, model };
}

// ---- the real case: "Би [Am]та бүгдийг [D]амраана" ---------------------------------------
{
  const { items } = layout([
    [{ chip: null, word: 14 }],            // Би
    [{ chip: 25.4, word: 17 }],            // [Am]та   (chip wider than word: slack 8.4)
    [{ chip: null, word: 63 }],            // бүгдийг
    [{ chip: 14, word: 70 }],              // [D]амраана
  ]);
  const s = computeRowShifts(items, GAP);
  close(s[0], 0, 'Би'); close(s[1], 0, 'та');
  close(s[2], 8.4, 'бүгдийг slides left by the chip slack');
  close(s[3], 8.4, 'амраана moves with it');
}

// ---- chords directly adjacent: no room, nothing moves ------------------------------------
{
  const { items } = layout([
    [{ chip: 25.4, word: 17 }],
    [{ chip: 25.4, word: 17 }],            // next chord sits right after: collision
    [{ chip: null, word: 30 }],
  ]);
  const s = computeRowShifts(items, GAP);
  close(s[0], 0, 'first word');
  close(s[1], 0, 'second chord must not be pulled toward the first');
  // the second chip has only a chord-less word after it, so it may overhang that
  close(s[2], 8.4, 'chord-less word after the last chip slides left');
}

// ---- partial room: shift only as far as is safe -----------------------------------------
{
  // chip is 40 wide over a 20 wide word (slack 20), but the next chip is only
  // 12px beyond the chip's end + one gap, so the overhang must stop short of it.
  const left0 = 0;
  const items = [
    { left: left0, firstChipLeft: 0, endChip: { left: 0, width: 40, slack: 20 } },
    { left: 40 + GAP, firstChipLeft: null, endChip: null },
    { left: 60, firstChipLeft: 40 + GAP + 12, endChip: null },
  ];
  // nextChipLeft = 56.8 -> room = 56.8 - 0 - 40 - 4.8 = 12 -> shift = 12 - 0.5 safety = 11.5
  const s = computeRowShifts(items, GAP);
  close(s[1], 11.5, 'partial overhang keeps the normal chord gap');
  close(s[2], 11.5, 'and carries later words with it');
}

// ---- last word of a row / rows with nothing after ----------------------------------------
{
  const { items } = layout([[{ chip: null, word: 20 }], [{ chip: 30, word: 10 }]]);
  assert.deepStrictEqual(computeRowShifts(items, GAP), [0, 0]);
}

// ---- mid-word chord stays untouched (chip not on the token's last piece) ------------------
{
  // "ал[Em]даршаач"-style: chip on the FIRST piece, last piece has none
  const { items } = layout([
    [{ chip: 40, word: 10 }, { chip: null, word: 50 }],
    [{ chip: null, word: 30 }],
  ]);
  assert.deepStrictEqual(computeRowShifts(items, GAP), [0, 0]);
}

// ---- cumulative: two overhangs in one row ------------------------------------------------
{
  const { items } = layout([
    [{ chip: 30, word: 20 }],               // slack 10
    [{ chip: null, word: 80 }],
    [{ chip: 30, word: 20 }],               // slack 10
    [{ chip: null, word: 80 }],
    [{ chip: 20, word: 40 }],
  ]);
  const s = computeRowShifts(items, GAP);
  close(s[1], 10); close(s[2], 10); close(s[3], 20); close(s[4], 20);
}

// ---- degenerate input ---------------------------------------------------------------------
assert.deepStrictEqual(computeRowShifts([], GAP), []);
assert.deepStrictEqual(computeRowShifts([{ left: 0, firstChipLeft: null, endChip: null }], GAP), [0]);

// ---- property test: random rows can never produce overlap ---------------------------------
let seed = 12345;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
const between = (a, b) => a + rnd() * (b - a);
let rowsChecked = 0, shiftedRows = 0, totalSaved = 0;
for (let n = 0; n < 6000; n++) {
  const gap = [2.5, 4.8, 8][Math.floor(rnd() * 3)];
  const tokens = [];
  const count = 1 + Math.floor(rnd() * 10);
  for (let i = 0; i < count; i++) {
    const pieces = [];
    const np = rnd() < 0.2 ? 2 : 1;
    for (let p = 0; p < np; p++) {
      pieces.push({ chip: rnd() < 0.45 ? between(14, 64) : null, word: between(6, 90) });
    }
    tokens.push(pieces);
  }
  const { items, model } = layout(tokens, gap);
  const s = computeRowShifts(items, gap);
  rowsChecked++;
  if (s.some(v => v > 0)) shiftedRows++;
  totalSaved += s[s.length - 1];

  // shifts never decrease along the row and never go negative
  for (let i = 0; i < s.length; i++) {
    assert(s[i] >= 0, 'non-negative shift');
    if (i) assert(s[i] >= s[i - 1] - 1e-9, 'shifts accumulate left to right');
  }
  // Guarantee: a shift never brings any neighbouring pair closer than the normal
  // gap, and never closer than the pair already was (chips inside ONE word, a
  // mid-word chord split, already touch in the plain layout and both move together).
  const chipsBefore = [], chipsAfter = [];
  model.forEach((t, ti) => t.placed.forEach(pc => {
    if (pc.chip != null) {
      chipsBefore.push({ left: pc.left, right: pc.left + pc.chip, tok: ti });
      chipsAfter.push({ left: pc.left - s[ti], right: pc.left - s[ti] + pc.chip, tok: ti });
    }
  }));
  for (let i = 1; i < chipsAfter.length; i++) {
    const before = chipsBefore[i].left - chipsBefore[i - 1].right;
    const after = chipsAfter[i].left - chipsAfter[i - 1].right;
    assert(after >= Math.min(before, gap) - 1e-6,
      `chips keep their spacing (row ${n}: before ${before}, after ${after}, gap ${gap})`);
    if (chipsAfter[i].tok === chipsAfter[i - 1].tok) close(after, before, 'chips in one word move together');
  }
  const wordsBefore = [], wordsAfter = [];
  model.forEach((t, ti) => {
    const last = t.placed[t.placed.length - 1];
    wordsBefore.push({ left: t.left, right: last.left + last.word });
    wordsAfter.push({ left: t.left - s[ti], right: last.left - s[ti] + last.word });
  });
  for (let i = 1; i < wordsAfter.length; i++) {
    const before = wordsBefore[i].left - wordsBefore[i - 1].right;
    const after = wordsAfter[i].left - wordsAfter[i - 1].right;
    assert(after >= gap - 1e-6, `words keep at least the normal gap (row ${n}: ${after} < ${gap})`);
    assert(after <= before + 1e-6, 'a shift only ever tightens a gap toward the normal gap');
  }
}
assert(shiftedRows > 500, 'the property test should actually exercise shifts (' + shiftedRows + ')');
console.log(`chord overhang: PASS (${rowsChecked} random rows, ${shiftedRows} used overhang, ${totalSaved.toFixed(0)}px reclaimed)`);
