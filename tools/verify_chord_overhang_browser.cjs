// Browser check for js/chord-overhang.js.
//   CHROMIUM_EXECUTABLE=... node tools/verify_chord_overhang_browser.cjs [libs] [stride]
// libs   comma list of data folders (default: mongolian,hymn,english,mongolian2)
// stride sample every Nth song of each library (default 1 = all; the big
//        English library defaults to every 3rd when no stride is given)
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const root = path.join(__dirname, '..');
const libs = (process.argv[2] || 'mongolian,hymn,english,mongolian2').split(',');
const strideArg = process.argv[3] ? +process.argv[3] : 0;
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  fs.readFile(path.join(root, p), (e, d) => {
    if (e) { r.writeHead(404); r.end(); return; }
    r.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); r.end(d);
  });
}).listen(0);

let failures = 0;
const ok = (c, m) => { console.log(c ? 'PASS' : 'FAIL', m); if (!c) failures++; };

// Runs inside the page. Returns violations + stats for the lyrics container as rendered now.
const CHECK = () => {
  const container = document.getElementById('lyrics-container');
  const cr = container.getBoundingClientRect();
  const stats = { lines: 0, shiftedTokens: 0, reclaimed: 0, maxShift: 0 };
  const bad = [];
  const snap = () => {
    const res = [];
    container.querySelectorAll('.lyric-line:not(.is-plain)').forEach((line, li) => {
      const gap = parseFloat(getComputedStyle(line).columnGap) || 0;
      const toks = [...line.children].filter(e => e.classList.contains('lyric-token'));
      const rows = []; let row = null;
      toks.forEach((tok, ti) => {
        const r = tok.getBoundingClientRect();
        if (!row || Math.abs(r.bottom - row.bottom) > 2) { row = { bottom: r.bottom, items: [] }; rows.push(row); }
        const pieces = [...tok.children];
        const words = pieces.map(p => p.lastElementChild.getBoundingClientRect());
        const chips = pieces.filter(p => p.firstElementChild && p.firstElementChild.classList.contains('chord-tag'))
          .map(p => { const c = p.firstElementChild; const w = parseFloat(getComputedStyle(c).display === 'none' ? 0 : 1);
            const b = c.getBoundingClientRect(); return w ? { l: b.left, r: b.right } : null; }).filter(Boolean);
        row.items.push({ ti, offL: tok.offsetLeft, offT: tok.offsetTop, tokRight: r.right,
          firstWordLeft: words[0].left, lastWordRight: words[words.length - 1].right, chips, text: tok.textContent,
          shift: tok._chordShift || 0 });
      });
      res.push({ li, gap, rows });
    });
    return res;
  };
  const after = snap();
  // un-shifted copy of the same render
  const toks = [...container.querySelectorAll('.lyric-token')];
  const saved = toks.map(t => t.style.transform);
  toks.forEach(t => { t.style.transform = ''; });
  const before = snap();
  toks.forEach((t, i) => { t.style.transform = saved[i]; });

  after.forEach((A, i) => {
    const B = before[i]; stats.lines++;
    if (A.rows.length !== B.rows.length) { bad.push(`line ${i}: row count changed ${B.rows.length}->${A.rows.length}`); return; }
    A.rows.forEach((ra, ri) => {
      const rb = B.rows[ri];
      if (ra.items.length !== rb.items.length) { bad.push(`line ${i} row ${ri}: token count changed`); return; }
      ra.items.forEach((ia, k) => {
        const ib = rb.items[k];
        if (ia.offL !== ib.offL || ia.offT !== ib.offT) bad.push(`line ${i}: layout box moved (reflow)`);
        if (ia.text !== ib.text) bad.push(`line ${i}: text changed`);
        if (ia.tokRight > cr.right + 0.5) bad.push(`line ${i}: token pokes out of the container (${(ia.tokRight - cr.right).toFixed(1)}px)`);
        if (ia.shift > 0) { stats.shiftedTokens++; stats.maxShift = Math.max(stats.maxShift, ia.shift); }
        if (k > 0) {
          const pa = ra.items[k - 1], pb = rb.items[k - 1];
          const wordGap = ia.firstWordLeft - pa.lastWordRight;
          if (wordGap < A.gap - 0.6) bad.push(`line ${i}: words closer than the normal gap (${wordGap.toFixed(2)} < ${A.gap.toFixed(2)})`);
          stats.reclaimed += Math.max(0, (ib.firstWordLeft - pb.lastWordRight) - wordGap);
        }
      });
      // adjacent chips on the row
      const ca = ra.items.flatMap(i => i.chips), cb = rb.items.flatMap(i => i.chips);
      for (let c = 1; c < ca.length; c++) {
        const sepA = ca[c].l - ca[c - 1].r, sepB = cb[c].l - cb[c - 1].r;
        if (sepA < Math.min(sepB, A.gap) - 0.6) bad.push(`line ${i}: chips closer (${sepA.toFixed(2)} < min(${sepB.toFixed(2)}, ${A.gap.toFixed(2)}))`);
      }
    });
  });
  if (document.documentElement.scrollWidth > window.innerWidth + 1) bad.push('page scrolls sideways');
  return { bad, stats };
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE });
  const base = `http://localhost:${server.address().port}`;
  const newPage = async width => {
    const ctx = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, serviceWorkers: 'block' });
    const page = await ctx.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/');
    await page.waitForFunction(() => typeof state !== 'undefined' && typeof showPage === 'function' && typeof renderLyrics === 'function' && typeof applyFontSizes === 'function', null, { timeout: 30000 });
    await page.evaluate(() => { state.activeSong = { id: 'x', title: 'x', artist: '', key: 'G', lyrics: ['[G]a'] }; showPage('song-view'); renderLyrics(); });
    await page.evaluate(() => document.fonts.ready);
    return { ctx, page, errors };
  };

  const SWEEP_ONLY = !!process.env.SWEEP_ONLY;
  // ---------------- 1. the reported case: Mongolian #151, last line --------------------
  if (!SWEEP_ONLY) {
    const { ctx, page, errors } = await newPage(390);
    const r = await page.evaluate(async () => {
      const song = await (await fetch('data/mongolian/s151.json')).json();
      song.lyrics = [song.lyrics[song.lyrics.length - 1]];
      state.activeSong = song; renderLyrics({ song }); await document.fonts.ready;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const line = document.querySelector('#lyrics-container .lyric-line');
      const gap = parseFloat(getComputedStyle(line).columnGap);
      const toks = [...line.querySelectorAll('.lyric-token')];
      const words = toks.map(t => ({ w: t.querySelector('.lyric-word').textContent, r: t.querySelector('.lyric-word').getBoundingClientRect(), shift: t._chordShift || 0 }));
      const i = words.findIndex(w => w.w === 'та');
      return { gap, between: words[i + 1].r.left - words[i].r.right, shift: words[i + 1].shift, check: null };
    });
    ok(Math.abs(r.between - r.gap) < 0.6, `song 151 "та бүгдийг": gap is now the normal word gap (${r.between.toFixed(2)} vs ${r.gap.toFixed(2)}px)`);
    ok(r.shift > 5, `song 151: following word slid left by ${r.shift}px`);
    const c = await page.evaluate(CHECK);
    ok(c.bad.length === 0, `song 151 line passes every layout guarantee ${c.bad.slice(0, 3).join('; ')}`);
    ok(errors.length === 0, 'no page errors ' + errors.join('|'));
    await page.screenshot({ path: path.join(process.env.QA_DIR || '/tmp', 'overhang-151.png'), clip: { x: 0, y: 0, width: 390, height: 300 } });
    await ctx.close();
  }

  // ---------------- 2. stress lines + every display setting ---------------------------
  const STRESS = { id: 'stress', title: 'stress', artist: '', key: 'G', lyrics: [
    'Би [Am]та [D]бүгдийг [G]амраана',
    '[F#m7b5]а [Bbmaj7]б [C#dim7]в [G#m7b5]г',
    'Эзэн [C]минь [Am7]чи [Dm7]намайг [G7]хайрла',
    '[Am]Хэрэв тэрээр дэлхийг бүхэлд нь мөрөн дээр[Am]ээ үүрвэл',
    'Ал[Em]даршаач [D]нь тус[G]лаач',
    '[C]',
    '[C] [G] [Am] [F]',
    '[G]Мөнхийн [D]Эзэн [Em]минь [C]ээ [G]би [D]чамд [Em]баярлан [C]магтъя [G]амен',
    '',
    '[Am7]Нэг [D7]хоёр [Gmaj7]гурав [Cmaj7]дөрөв [F#m7b5]тав [B7]зургаа [Em]долоо [Am]найм',
  ] };
  for (const width of (SWEEP_ONLY ? [] : [390, 320])) {
    const { ctx, page, errors } = await newPage(width);
    const run = async label => {
      await page.waitForTimeout(650);                       // transitions + settle
      const c = await page.evaluate(CHECK);
      ok(c.bad.length === 0, `[${width}px] ${label}: guarantees hold (shifted ${c.stats.shiftedTokens}, reclaimed ${c.stats.reclaimed.toFixed(0)}px) ${c.bad.slice(0, 3).join('; ')}`);
      return c;
    };
    await page.evaluate(s => { state.activeSong = s; renderLyrics({ song: s }); }, STRESS);
    await run('default');
    const set = (code) => page.evaluate(code);
    await set(() => { state.lyricsSize = 1.7; applyFontSizes(); });
    // right after a change the shifts must already be gone (safe state), until it settles
    const early = await page.evaluate(() => new Promise(r => setTimeout(() => r([...document.querySelectorAll('#lyrics-container .lyric-token')].filter(t => t.style.transform).length), 60)));
    ok(early === 0, `[${width}px] a settings change drops every shift immediately (${early} left)`);
    await run('largest lyrics size');
    await set(() => { state.lyricsSize = 0.9; state.chordSize = 1.3; applyFontSizes(); });
    await run('small lyrics + big chords');
    await set(() => { state.chordSize = 0.6; applyFontSizes(); });
    await run('tiny chords');
    await set(() => { state.chordSize = 0.82; state.lyricsSize = 1.05; applyFontSizes(); state.chordStyle = 'text'; applyChordStyle(); });
    await run('plain-text chords');
    await set(() => { state.chordStyle = 'chip'; applyChordStyle(); state.lyricsWeight = 'bold'; applyLyricsWeight(); });
    await run('bold lyrics');
    for (const ws of ['tight', 'loose']) {
      await set(`state.lyricsWordSpacing='${ws}'; applyLyricsWordSpacing();`);
      await run(`${ws} word spacing`);
    }
    await set(() => { state.hideChords = true; document.documentElement.setAttribute('data-hide-chords', 'true'); });
    const hid = await (async () => { await page.waitForTimeout(650); return page.evaluate(() => [...document.querySelectorAll('#lyrics-container .lyric-token')].filter(t => t.style.transform).length); })();
    ok(hid === 0, `[${width}px] hide-chords: no shifts left over (${hid})`);
    await set(() => { state.hideChords = false; document.documentElement.setAttribute('data-hide-chords', 'false'); });
    await run('chords shown again');
    // transpose through every key (chord widths change each time)
    for (let t = 1; t < 12; t++) {
      await page.evaluate(n => { state.transpose = n; renderLyrics({ song: STRESS_SONG() }); function STRESS_SONG() { return state.activeSong; } }, t);
      const c = await page.evaluate(CHECK);
      if (c.bad.length) { ok(false, `[${width}px] transpose +${t}: ${c.bad.slice(0, 3).join('; ')}`); break; }
      if (t === 11) ok(true, `[${width}px] all 12 transpositions keep the guarantees`);
    }
    await page.evaluate(() => { state.transpose = 0; });
    // rotate / resize
    await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(400);
    await run('landscape');
    await page.setViewportSize({ width, height: 844 }); await page.waitForTimeout(400);
    await run('back to portrait');
    ok(errors.length === 0, `[${width}px] no page errors ${errors.join('|')}`);
    await ctx.close();
  }

  // ---------------- 3. every song in the libraries ----------------------------------------
  for (const width of [390, 320]) {
    const { ctx, page, errors } = await newPage(width);
    for (const lib of libs) {
      const stride = strideArg || (lib === 'english' ? 3 : lib === 'mongolian2' ? 2 : 1);
      const res = await page.evaluate(async ({ lib, stride, checkSrc }) => {
        const CHECK = eval('(' + checkSrc + ')');
        const files = await (await fetch(`data/${lib}/manifest.json`)).json();
        const out = { songs: 0, withChords: 0, lines: 0, shifted: 0, reclaimed: 0, maxShift: 0, bad: [] };
        for (let i = 0; i < files.length; i += stride) {
          const f = typeof files[i] === 'string' ? files[i] : (files[i].file || files[i].path);
          let song; try { song = await (await fetch(`data/${lib}/${f}`)).json(); } catch (_) { continue; }
          if (!song || !Array.isArray(song.lyrics)) continue;
          state.activeSong = song; renderLyrics({ song });
          out.songs++;
          const r = CHECK();
          out.lines += r.stats.lines; out.shifted += r.stats.shiftedTokens; out.reclaimed += r.stats.reclaimed;
          out.maxShift = Math.max(out.maxShift, r.stats.maxShift);
          if (r.stats.lines) out.withChords++;
          if (r.bad.length && out.bad.length < 5) out.bad.push(`${song.id}: ${r.bad[0]}`);
        }
        return out;
      }, { lib, stride, checkSrc: CHECK.toString() });
      ok(res.bad.length === 0, `[${width}px] ${lib}: ${res.songs} songs (${res.withChords} with chords), ${res.lines} chord lines, ${res.shifted} words slid, ${res.reclaimed.toFixed(0)}px of dead space reclaimed, max ${res.maxShift.toFixed(1)}px ${res.bad.join(' | ')}`);
    }
    ok(errors.length === 0, `[${width}px] no page errors in library sweep ${errors.slice(0, 2).join('|')}`);
    await ctx.close();
  }

  await browser.close(); server.close();
  console.log(failures ? `FAILURES: ${failures}` : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})();
