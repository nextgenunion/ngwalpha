// NGWorship — Lyric syntax, search/sorting, transposition and lyric rendering.
// Classic deferred script; functions share app.js state and existing helpers.
// Definitions only: app.js keeps initialization order and event registration.
// @begin/@end comments let source-based tests read the current implementations.

/* @begin:splitLyricSectionLabel */


// Parse the app's explicit section-label syntax once so Search and the
// Song Rendering Engine agree on what is structural metadata. Any text
// before the first colon is a section label as long as that prefix contains
// neither another colon nor a [chord] marker. Examples: "Verse 1:",
// "Гүүр:", "Chorus x2:". The returned content is the lyric text after
// the colon (with only leading spacing removed).
function splitLyricSectionLabel(rawLine) {
  const line = String(rawLine == null ? '' : rawLine).replace(/^\s+/, '');
  const match = line.match(/^([^\[\]:]+):(.*)$/);
  if (!match) return null;
  const label = match[1].trim();
  if (!label) return null;
  return {
    label,
    content: match[2].replace(/^\s+/, ''),
  };
}
/* @end:splitLyricSectionLabel */

/* @begin:stripSongFormattingForSearch */


// Search indexes sung text, not rendering instructions. Chord tags and
// explicit section labels are structural metadata, so remove them while
// keeping any lyric text that follows the label on the same source line.
function stripSongFormattingForSearch(lyricsArr) {
  return (Array.isArray(lyricsArr) ? lyricsArr : []).map(rawLine => {
    const parsed = splitLyricSectionLabel(rawLine);
    const lyricLine = parsed ? parsed.content : String(rawLine == null ? '' : rawLine);
    return lyricLine.replace(/\[[^\]]+\]/g, '');
  }).join(' \n ');
}
/* @end:stripSongFormattingForSearch */

/* @begin:normalizeSearchText */


// Normalises only the things that should be invisible to a person while
// searching: Unicode composition, case, and repeated whitespace. We do NOT
// remove punctuation or fold different letters together, because doing so
// can create surprising false positives in song titles/lyrics.
function normalizeSearchText(value) {
  return String(value == null ? '' : value)
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
/* @end:normalizeSearchText */

/* @begin:compileSearchQuery */
function compileSearchQuery(q) {
  const query = normalizeSearchText(q);
  return {
    query,
    words: query ? query.split(' ').filter(Boolean) : [],
  };
}
/* @end:compileSearchQuery */

/* @begin:getSearchCache */
function getSearchCache(song) {
  let cached = songSearchCache.get(song);
  if (!cached) {
    const title = normalizeSearchText(song.title);
    const altTitles = (Array.isArray(song.alternateTitles) ? song.alternateTitles : [])
      .filter(Boolean)
      .map(normalizeSearchText)
      .filter(Boolean);
    const artist = normalizeSearchText(song.artist);
    const number = song.number != null ? normalizeSearchText(song.number) : '';
    const lyrics = normalizeSearchText(stripSongFormattingForSearch(song.lyrics));
    const titleAndAltHaystack = [title, ...altTitles].filter(Boolean).join(' \n ');
    const contentHaystack = [title, number, ...altTitles, lyrics].filter(Boolean).join(' \n ');
    const haystack = [contentHaystack, artist].filter(Boolean).join(' \n ');

    cached = {
      title,
      altTitles,
      artist,
      number,
      lyrics,
      titleAndAltHaystack,
      contentHaystack,
      haystack,
    };
    songSearchCache.set(song, cached);
  }
  return cached;
}
/* @end:getSearchCache */

/* @begin:getSearchLabelData */


// Search both the stored label value and the text the person actually sees.
// Preset labels use stable English keys internally (e.g. "christmas"), but
// a Mongolian/Korean UI should still find that label when the translated
// visible name is typed into Search. Custom labels naturally resolve to
// themselves through labelDisplayText().
function getSearchLabelData(sourceKey, song) {
  const values = [];
  const seen = new Set();

  effectiveLabels(sourceKey, song.id, song).forEach(label => {
    [label, labelDisplayText(label)].forEach(value => {
      const normalized = normalizeSearchText(value);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        values.push(normalized);
      }
    });
  });

  return {
    labels: values,
    haystack: values.join(' \n '),
  };
}
/* @end:getSearchLabelData */

/* @begin:evaluateSongSearch */


// Evaluate matching and relevance together. This is deliberately a pure
// consolidation of the previous matchesQuery() + relevanceRank() rules:
// query priority and broad cross-field matching stay exactly the same, but
// the query, song cache, and live label data are each prepared only once.
function evaluateSongSearch(song, compiled, sourceKey = state.activeDbSource) {
  const query = compiled.query;
  if (!query) return { matches: true, rank: 15 };

  const words = compiled.words;
  const {
    title,
    altTitles,
    artist,
    number,
    lyrics,
    titleAndAltHaystack,
    contentHaystack,
    haystack,
  } = getSearchCache(song);
  const { labels, haystack: labelHaystack } = getSearchLabelData(sourceKey, song);

  // Preserve forgiving AND-across-any-field matching exactly as before.
  if (!words.every(word => haystack.includes(word) || labelHaystack.includes(word))) {
    return { matches: false, rank: 15 };
  }

  // Lower rank = more relevant. Do not reorder these checks: this is the
  // user-facing search priority and is covered by regression tests.
  if (title === query) return { matches: true, rank: 0 };
  if (altTitles.some(a => a === query)) return { matches: true, rank: 1 };
  if (number && number === query) return { matches: true, rank: 2 };
  if (title.startsWith(query)) return { matches: true, rank: 3 };
  if (altTitles.some(a => a.startsWith(query))) return { matches: true, rank: 4 };
  if (title.includes(query)) return { matches: true, rank: 5 };
  if (altTitles.some(a => a.includes(query))) return { matches: true, rank: 6 };
  if (lyrics.includes(query)) return { matches: true, rank: 7 };
  if (words.every(word => titleAndAltHaystack.includes(word))) return { matches: true, rank: 8 };
  if (words.every(word => lyrics.includes(word))) return { matches: true, rank: 9 };
  if (words.every(word => contentHaystack.includes(word))) return { matches: true, rank: 10 };
  if (labels.some(label => label === query)) return { matches: true, rank: 11 };
  if (labels.some(label => label.startsWith(query))) return { matches: true, rank: 12 };
  if (labelHaystack.includes(query) ||
      (words.length && words.every(word => labelHaystack.includes(word)))) return { matches: true, rank: 13 };
  if (artist.includes(query) ||
      (words.length && words.every(word => artist.includes(word)))) return { matches: true, rank: 14 };

  // Words can be split across content + labels/artist, which intentionally
  // remains a valid lowest-priority discovery result.
  return { matches: true, rank: 15 };
}
/* @end:evaluateSongSearch */

/* @begin:matchesQuery */


// Compatibility wrappers. Main list/search paths below use the compiled,
// single-pass filterAndSortSongs() path instead of calling these per song.
function matchesQuery(song, q, sourceKey = state.activeDbSource) {
  return evaluateSongSearch(song, compileSearchQuery(q), sourceKey).matches;
}
/* @end:matchesQuery */

/* @begin:relevanceRank */
function relevanceRank(song, q, sourceKey = state.activeDbSource) {
  return evaluateSongSearch(song, compileSearchQuery(q), sourceKey).rank;
}
/* @end:relevanceRank */

/* @begin:scheduleSearchCacheWarmup */
function scheduleSearchCacheWarmup(sourceKey = state.activeDbSource) {
  const source = state.sources[sourceKey];
  if (!source || !source.loaded || !Array.isArray(source.songs) || !source.songs.length) return;
  if (searchCacheWarmSources.has(sourceKey)) return;
  searchCacheWarmSources.add(sourceKey);

  const songs = source.songs;
  let index = 0;
  const schedule = (fn) => {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(fn, { timeout: 1000 });
    } else {
      window.setTimeout(() => fn(null), 16);
    }
  };

  const work = (deadline) => {
    let processed = 0;
    const maxPerSlice = deadline ? 60 : 24;

    while (index < songs.length && processed < maxPerSlice) {
      if (processed >= 8 && deadline && !deadline.didTimeout && deadline.timeRemaining() < 3) break;
      getSearchCache(songs[index++]);
      processed++;
    }

    if (index < songs.length) schedule(work);
  };

  schedule(work);
}
/* @end:scheduleSearchCacheWarmup */

/* @begin:titleScriptRank */


// Alphabetical sort's script grouping: Cyrillic titles first, then titles
// starting with any other letter (Latin, Mongolian traditional script,
// Korean, etc.), then anything starting with a digit/#/symbol last —
// rather than a plain localeCompare, which would interleave scripts
// character-code-by-character (and often put digits/symbols before
// letters entirely) instead of keeping each group together the way the
// Songbook's fast-scroll rail (see computeScrollIndexEntries()) expects
// to walk it. Only the string's first character decides the group; within
// a group, localeCompare still does the actual alphabetical ordering.
function titleScriptRank(title) {
  const ch = (title || '').trim().charAt(0);
  if (!ch) return 2;
  if (/\p{Script=Cyrillic}/u.test(ch)) return 0;
  if (/\p{L}/u.test(ch)) return 1;
  return 2; // digits, #, punctuation, anything not a letter
}
/* @end:titleScriptRank */

/* @begin:sortSongs */


// sourceKey (optional) lets this fall back to alphabetical even if
// state.sortBy is still 'num' from a previous source that had numbers —
// e.g. right after switching Settings → Song database from Mongolian to
// English, before the person has had a chance to notice/change the sort
// buttons themselves (which applyDbSource() also updates — see there for
// the other half of this).
function sortSongs(list, q, sourceKey = state.activeDbSource, precomputedRanks = null) {
  const arr = [...list];
  const dir = state.sortOrder === 'desc' ? -1 : 1;
  const query = normalizeSearchText(q);
  // Same "user songs aren't in DB_SOURCES" reasoning as renderSongList's
  // own hasNumbers — see the comment there.
  const hasNumbers = sourceHasSongNumbers(sourceKey);

  // Callers using the optimized filterAndSortSongs() path hand us ranks
  // computed during the one search pass. Other callers retain the previous
  // lazy per-sort cache as a safe compatibility fallback.
  const rankCache = query ? (precomputedRanks || new Map()) : null;
  const rankFor = (song) => {
    if (!rankCache.has(song)) rankCache.set(song, relevanceRank(song, query, songSourceKey(song, sourceKey)));
    return rankCache.get(song);
  };

  arr.sort((a, b) => {
    if (query) {
      const rankA = rankFor(a);
      const rankB = rankFor(b);
      if (rankA !== rankB) return rankA - rankB;
    }
    if (state.sortBy === 'num' && hasNumbers) {
      const aNumbered = songHasVisibleNumber(a, sourceKey, hasNumbers);
      const bNumbered = songHasVisibleNumber(b, sourceKey, hasNumbers);
      if (aNumbered !== bNumbered) return aNumbered ? -1 : 1;
      if (aNumbered && Number(a.number) !== Number(b.number)) return (Number(a.number) - Number(b.number)) * dir;
    }
    // dir flips both the group order and the in-group ordering together,
    // so Descending is a true mirror of Ascending (symbols/digits first,
    // then other-letter titles, then Cyrillic last) rather than only
    // reversing within a fixed group order.
    const scriptRankA = titleScriptRank(a.title);
    const scriptRankB = titleScriptRank(b.title);
    if (scriptRankA !== scriptRankB) return (scriptRankA - scriptRankB) * dir;
    return a.title.localeCompare(b.title) * dir;
  });

  return arr;
}
/* @end:sortSongs */

/* @begin:filterAndSortSongs */


// Compile the query once, then evaluate each song once for BOTH matching and
// rank. Previously the main list filtered with matchesQuery() and then the
// sort pass called relevanceRank(), repeating query normalization, cache
// lookups and live-label preparation for every matching song.
function filterAndSortSongs(list, q, sourceKey = state.activeDbSource, extraFilter = null) {
  const compiled = compileSearchQuery(q);
  const matches = [];
  const ranks = compiled.query ? new Map() : null;

  for (const song of list) {
    const result = evaluateSongSearch(song, compiled, songSourceKey(song, sourceKey));
    if (!result.matches) continue;
    if (extraFilter && !extraFilter(song)) continue;
    matches.push(song);
    if (ranks) ranks.set(song, result.rank);
  }

  return sortSongs(matches, compiled.query, sourceKey, ranks);
}
/* @end:filterAndSortSongs */

/* @begin:highlight */
function highlight(text, q) {
  if (!q) return escapeHtml(text);
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return escapeHtml(text);
  return escapeHtml(text.slice(0, idx)) + '<mark>' + escapeHtml(text.slice(idx, idx + q.length)) + '</mark>' + escapeHtml(text.slice(idx + q.length));
}
/* @end:highlight */

/* @begin:transposeChord */
function transposeChord(chord, steps) {
  if (!chord || !steps) return chord;
  // Split root (+ optional accidental) from the rest (quality/extensions), and handle slash bass.
  const parts = chord.split('/');
  const transposedParts = parts.map(part => transposeSingle(part, steps));
  return transposedParts.join('/');
}
/* @end:transposeChord */

/* @begin:transposeSingle */
function transposeSingle(token, steps) {
  // Leading/trailing whitespace inside a bracket — "[ Cm ]" instead of
  // "[Cm]" — is harmless to render but broke transposition entirely: the
  // old regex required the root letter at position 0, so a padded token
  // never matched and was silently returned unchanged. Capture and
  // preserve that padding instead of requiring its absence.
  const m = token.match(/^(\s*)([A-G])(#|b)?(.*?)(\s*)$/);
  if (!m) return token;
  const [, lead, letter, accidental, rest, trail] = m;
  const useFlats = FLAT_KEYS.has(letter + (accidental || '') + (rest.startsWith('m') ? 'm' : ''));
  const name = letter + (accidental || '');
  let idx = CHROMATIC_SHARP.indexOf(name);
  if (idx === -1) idx = CHROMATIC_FLAT.indexOf(name);
  if (idx === -1) return token;
  const newIdx = ((idx + steps) % 12 + 12) % 12;
  const table = useFlats ? CHROMATIC_FLAT : CHROMATIC_SHARP;
  return lead + table[newIdx] + rest + trail;
}
/* @end:transposeSingle */

/* @begin:encodeLyricMarkdown */
function encodeLyricMarkdown(line) {
  const chordStarPlaceholder = '\uE10F';
  let protectedLine = line.replace(/\[[^\]]*\]/g, chord =>
    chord.replace(/\*/g, chordStarPlaceholder)
  );
  protectedLine = protectedLine
    .replace(/\*\*\*([^*\n]+?)\*\*\*/g, `${LYRIC_MD_BOLD_ITALIC}$1${LYRIC_MD_BOLD_ITALIC}`)
    .replace(/\*\*([^*\n]+?)\*\*/g, `${LYRIC_MD_BOLD}$1${LYRIC_MD_BOLD}`)
    .replace(/\*([^*\n]+?)\*/g, `${LYRIC_MD_ITALIC}$1${LYRIC_MD_ITALIC}`);
  return protectedLine.replaceAll(chordStarPlaceholder, '*');
}
/* @end:encodeLyricMarkdown */

/* @begin:appendFormattedLyricText */
function appendFormattedLyricText(parent, text, markdownState) {
  if (!text) return;
  let buffer = '';
  const flush = () => {
    if (!buffer) return;
    const span = document.createElement('span');
    if (markdownState.boldItalic) span.className = 'lyric-md-bold-italic';
    else if (markdownState.bold) span.className = 'lyric-md-bold';
    else if (markdownState.italic) span.className = 'lyric-md-italic';
    span.textContent = buffer;
    parent.appendChild(span);
    buffer = '';
  };
  for (const ch of text) {
    if (ch === LYRIC_MD_ITALIC || ch === LYRIC_MD_BOLD || ch === LYRIC_MD_BOLD_ITALIC) {
      flush();
      if (ch === LYRIC_MD_ITALIC) markdownState.italic = !markdownState.italic;
      else if (ch === LYRIC_MD_BOLD) markdownState.bold = !markdownState.bold;
      else markdownState.boldItalic = !markdownState.boldItalic;
    } else buffer += ch;
  }
  flush();
}
/* @end:appendFormattedLyricText */

/* @begin:renderLyrics */
function renderLyrics(opts = {}) {
  const {
    animateChords = false,
    containerId = 'lyrics-container',
    song = state.activeSong,
    transpose = state.transpose,
  } = opts;
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  if (!song) return;

  // Running count of chord tags placed so far, used only to stagger the
  // chord-pop animation slightly per chord (a light ripple down the
  // page). Capped so long songs don't end up with a sluggish tail.
  let chordAnimIndex = 0;

  // Group lines into sections (verses/choruses) using blank lines as
  // boundaries — the same simple convention a future song editor can
  // produce by just leaving a blank line between parts. A section whose
  // first line starts with leading whitespace in the source is treated as
  // an indented part (e.g. a chorus set off from the verses), matching how
  // it's laid out in the original songbook document.
  const sections = [];
  let current = [];
  song.lyrics.forEach(rawLine => {
    if (rawLine.trim() === '') {
      if (current.length) { sections.push(current); current = []; }
    } else {
      current.push(rawLine);
    }
  });
  if (current.length) sections.push(current);

  // Only number parts when there's more than one — a single-section song
  // has nothing to distinguish, so a lone "1" would just be noise.
  const numberParts = sections.length > 1;

  sections.forEach((sectionLines, sectionIdx) => {
    const isIndented = /^\s{2,}/.test(sectionLines[0]);

    const sectionEl = document.createElement('div');
    sectionEl.className = 'lyric-section' + (isIndented ? ' is-indented' : '');

    // A section's first line can open with an explicit label like "Гүүр:"
    // (Bridge:) or "Дахилт:" (Chorus:) instead of relying on the plain
    // sequence number — the label is the text before the FIRST colon on
    // that line. Digits are valid too (for example "Verse 1:"). The only
    // structural restriction is that the label itself cannot contain a
    // [chord] marker or another colon. When present it's stripped from
    // the line before chord
    // tokenizing and rendered in place of the number; when absent, the
    // section falls back to the existing "1, 2, 3…" numbering below.
    const firstLineLabel = splitLyricSectionLabel(sectionLines[0]);
    const sectionLabel = firstLineLabel ? firstLineLabel.label : null;

    // A section made up of nothing but [Chord] markers — no actual sung
    // words anywhere in it — isn't a "part" in the verse/chorus sense, so
    // it shouldn't claim a numbered badge of its own. Without this check,
    // a blank-line-separated run of bare chord lines (an instrumental
    // interlude, or the degenerate one-chord-per-line case) gets numbered
    // as if each were its own verse, badging every single line.
    const hasLyricText = sectionLines.some(
      line => line.replace(/\[[^\]]+\]/g, '').trim() !== ''
    );

    if (sectionLabel) {
      const numEl = document.createElement('div');
      // .lyric-section-label (not -index) — see applyHideVerseNumbers()'s
      // comment for why this split matters: the "hide verse numbers" dev
      // option only ever targets .lyric-section-index, so an explicit
      // label like "Bridge:"/"Гүүр:" always keeps rendering regardless.
      numEl.className = 'lyric-section-number lyric-section-label';
      numEl.textContent = sectionLabel;
      sectionEl.appendChild(numEl);
    } else if (numberParts && hasLyricText) {
      const numEl = document.createElement('div');
      numEl.className = 'lyric-section-number lyric-section-index';
      numEl.textContent = String(sectionIdx + 1);
      sectionEl.appendChild(numEl);
    }

    sectionLines.forEach((rawLine, lineIdx) => {
      // Leading whitespace on the first line is only a structural indent
      // marker (see isIndented above), not literal spacing to render.
      //
      // Explicit part labels are also recognised later inside a blank-line
      // section, not only on its first line. Some of the real song data
      // writes e.g. "Гүүр:Т[C]эрээр..." immediately after the preceding
      // verse with no empty line. Requiring a blank line there made the
      // label render as ordinary lyric text even though the syntax itself
      // was valid. Treat the label as an inline structural marker instead.
      let line = lineIdx === 0 ? rawLine.replace(/^\s+/, '') : rawLine;
      const lineLabel = splitLyricSectionLabel(line);

      if (lineLabel) {
        // The first line's label was already rendered above in place of the
        // automatic section number. Labels found later need their own badge
        // at exactly this position in the lyrics.
        if (lineIdx > 0) {
          const labelEl = document.createElement('div');
          labelEl.className = 'lyric-section-number lyric-section-label';
          labelEl.textContent = lineLabel.label;
          sectionEl.appendChild(labelEl);
        }
        line = lineLabel.content;

        // A label commonly lives on a line by itself ("Дахилт:" / "Bridge:").
        // Once the label text has been pulled out there is no lyric left on
        // that source line. Do NOT create an empty .lyric-line for it: the
        // plain-line CSS gives such a line normal body height + margin,
        // which was the large blank gap visible in the editor preview.
        if (line.trim() === '') return;
      }

      const lineEl = document.createElement('div');
      lineEl.className = 'lyric-line';

      // Tokenize on [Chord] markers: each chord attaches to the text run that follows it,
      // up to the next chord marker (or end of line). Leading text with no chord is its own run.
      // `precededByBreak` records whether an actual word boundary (whitespace, or start of
      // line) separates this run from whatever text came right before it. Chords are
      // routinely dropped in the middle of a word to mark the exact syllable they land on
      // (e.g. "алдар[Em]шаач", "A[E]а" in this songbook's own data) — that split must NOT be
      // treated as a word break, or the two halves get rendered as separate words with a gap
      // torn into the middle of one, which is the "chords splitting text" bug.
      line = encodeLyricMarkdown(line);
      const markdownState = { italic: false, bold: false, boldItalic: false };
      const chordPositions = [...line.matchAll(/\[([^\]]+)\]/g)];
      const runs = [];
      if (chordPositions.length === 0) {
        runs.push({ chord: null, text: line, precededByBreak: true });
      } else {
        if (chordPositions[0].index > 0) {
          runs.push({ chord: null, text: line.slice(0, chordPositions[0].index), precededByBreak: true });
        }
        chordPositions.forEach((cm, i) => {
          const textStart = cm.index + cm[0].length;
          const textEnd = i + 1 < chordPositions.length ? chordPositions[i + 1].index : line.length;
          const precedingChar = cm.index > 0 ? line[cm.index - 1] : '';
          const runText = line.slice(textStart, textEnd);
          // A chord written at the end of a word, just before the space
          // ("Эзэн[C] гэж"), has real whitespace between it and the next
          // word — that's a word break too. Without the third check the
          // next word was treated as the rest of the previous one and
          // rendered glued to it ("Эзэнгэж"). Only counts when actual word
          // text follows the whitespace; a chord followed by nothing but
          // spaces (end of line, or straight into another chord) keeps its
          // old placement at the end of the word.
          const precededByBreak = cm.index === 0 || /\s/.test(precedingChar) || /^\s+\S/.test(runText);
          runs.push({ chord: cm[1], text: runText, precededByBreak });
        });
      }

      // Flatten each run into per-word "pieces". A chord can also cover a run of several
      // whole words before the next chord change (e.g. "[G]word1 word2 word3") — splitting
      // those into one piece per word (chord on the first only) gives flex-wrap normal
      // word-level wrapping granularity, so only the word that doesn't fit moves down, not
      // the whole run. Each piece remembers whether it starts a new word (normal spacing
      // before it) or is a mid-word continuation of the piece before it (no space in the
      // source — must render with zero gap so the letters stay visually joined).
      const pieces = [];
      runs.forEach(run => {
        const words = run.text.split(/\s+/).filter(Boolean);
        if (words.length === 0) {
          pieces.push({ chord: run.chord, text: '', startsNewWord: run.precededByBreak });
        } else {
          words.forEach((w, i) => {
            pieces.push({ chord: i === 0 ? run.chord : null, text: w, startsNewWord: i === 0 ? run.precededByBreak : true });
          });
        }
      });

      // Group consecutive continuation pieces (mid-word chord splits) together — each group
      // is rendered as ONE flex item on the line, so the outer line's word-gap only ever
      // appears between real words, never inside one.
      const groups = [];
      pieces.forEach(piece => {
        if (piece.startsNewWord || groups.length === 0) {
          groups.push([piece]);
        } else {
          groups[groups.length - 1].push(piece);
        }
      });

      // A line with no chord at all shouldn't still reserve a chord
      // badge's worth of height above its words — that leaves a "phantom"
      // gap with nothing filling it, which reads as loose and inconsistent
      // next to chorded lines where that space is doing visible work. Only
      // give this line the reserved chord row (and its tighter, chord-chart
      // line-height) when it actually has a chord on it; otherwise fall
      // back to normal, closer-set body-text spacing — same idea WorshipLeader
      // and similar chord-chart apps use for spoken/plain lyric lines.
      const lineHasChord = pieces.some(p => p.chord);
      lineEl.classList.toggle('is-plain', !lineHasChord);

      groups.forEach((group, groupIndex) => {
        // Flexbox's CSS gap is visual only and contributes no character to
        // the clipboard. Keep a real DOM space between visual words as a
        // native-copy fallback (especially Android/PWA context-menu copy).
        // A whitespace-only anonymous flex item is not rendered, so this does
        // not alter the on-screen spacing controlled by --lyric-word-gap.
        if (groupIndex > 0) lineEl.appendChild(document.createTextNode(' '));
        const wrap = document.createElement('span');
        wrap.className = 'lyric-token';
        group.forEach(piece => {
          const pieceEl = document.createElement('span');
          pieceEl.className = 'lyric-piece';
          if (piece.chord) {
            const chordEl = document.createElement('span');
            chordEl.className = 'chord-tag';
            const displayedChord = transposeChord(piece.chord, transpose);
            chordEl.textContent = displayedChord;
            // In the real song view, chord labels double as compact chord-
            // diagram buttons. The popup uses ChordFinder's Display SVG,
            // so there is only one visual renderer to maintain. Editor/help
            // previews stay display-only.
            if (containerId === 'lyrics-container') {
              chordEl.dataset.chord = displayedChord.trim();
              chordEl.setAttribute('role', 'button');
              chordEl.setAttribute('tabindex', '0');
              chordEl.setAttribute('aria-label', displayedChord.trim());
            }
            if (animateChords) {
              chordEl.classList.add('chord-pop');
              chordEl.style.setProperty('--chord-pop-delay', Math.min(chordAnimIndex * 12, 380) + 'ms');
              chordAnimIndex += 1;
            }
            pieceEl.appendChild(chordEl);
          } else if (piece.text && lineHasChord) {
            const spacer = document.createElement('span');
            spacer.className = 'chord-tag-spacer';
            pieceEl.appendChild(spacer);
          }
          const textEl = document.createElement('span');
          textEl.className = 'lyric-word';
          if (piece.text) appendFormattedLyricText(textEl, piece.text, markdownState);
          else textEl.textContent = '\u00A0';
          pieceEl.appendChild(textEl);
          wrap.appendChild(pieceEl);
        });
        lineEl.appendChild(wrap);
      });

      sectionEl.appendChild(lineEl);
    });

    container.appendChild(sectionEl);
  });

  // Reclaim the empty space a wide chord chip leaves after a short word, but
  // only where no other chord is close (see js/chord-overhang.js). Purely
  // visual: never changes the text, the layout or where lines wrap.
  if (window.ChordOverhang) window.ChordOverhang.register(container);
}
/* @end:renderLyrics */

/* @begin:lyricsFragmentToPlainText */


// ---------------------------------------------------------
// Copy = lyrics only.
//
// The rendered lyrics are a grid of flex items (one column per word, chord
// tag stacked on top of it — see renderLyrics), and the gap between words is
// CSS, not a space character. So the browser's own "copy" would put chord
// names in the clipboard and either glue words together or drop each one on
// its own line. Instead, when a selection sits inside a lyrics container we
// rebuild the text ourselves from the selected part of the DOM: chords and
// the "1, 2, 3…" part numbers are dropped, mid-word chord splits are rejoined
// into one word, words are separated by a space, lines by a newline, and
// parts (verse/chorus) by a blank line. An explicit label like "Гүүр" stays,
// since it's written into the song itself. `root` is the DocumentFragment
// from Range.cloneContents() — a copy, so removing nodes never touches the
// page.
// ---------------------------------------------------------
function lyricsFragmentToPlainText(root) {
  root.querySelectorAll('.chord-tag, .chord-tag-spacer, .lyric-section-index')
    .forEach(el => el.remove());

  const out = [];
  root.querySelectorAll('.lyric-section, .lyric-section-label, .lyric-line').forEach(el => {
    if (el.classList.contains('lyric-section')) {
      // Blank line between parts (never doubled, never leading).
      if (out.length && out[out.length - 1] !== '') out.push('');
    } else if (el.classList.contains('lyric-section-label')) {
      const label = (el.textContent || '').trim();
      if (label) out.push(label);
    } else {
      // One .lyric-token = one visual word; its .lyric-word pieces are the
      // halves of a word a chord landed in the middle of, so they join with
      // no space. A chord-only piece renders a lone nbsp — strip it, and
      // skip a line that ends up with no words at all (an instrumental
      // chord line) rather than copying an empty row.
      const words = [];
      el.querySelectorAll('.lyric-token').forEach(tok => {
        const word = Array.from(tok.querySelectorAll('.lyric-word'))
          .map(w => w.textContent || '')
          .join('')
          .replace(/\u00A0/g, '')
          .trim();
        if (word) words.push(word);
      });
      if (words.length) out.push(words.join(' '));
    }
  });
  while (out.length && out[out.length - 1] === '') out.pop();

  // Selection fell entirely inside a single word: the cloned fragment is
  // just a bare text node with none of the structure above.
  if (!out.length) return (root.textContent || '').replace(/\u00A0/g, ' ').trim();
  return out.join('\n');
}
/* @end:lyricsFragmentToPlainText */

