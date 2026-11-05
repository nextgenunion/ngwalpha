// NGWorship — Saved preferences, settings controls and language application.
// Classic deferred script; functions share app.js state and existing helpers.
// Definitions only: app.js keeps initialization order and event registration.
// @begin/@end comments let source-based tests read the current implementations.

/* @begin:t */
function t(key, ...args) {
  const dict = (window.SONGBOOK_LANG && window.SONGBOOK_LANG[state.lang]) || {};
  const entry = dict[key];
  if (typeof entry === 'function') return entry(...args);
  return entry !== undefined ? entry : key;
}
/* @end:t */

/* @begin:refreshLangPicker */


// ---------------------------------------------------------
// Preferences (persisted locally — offline-first, no cloud)
// ---------------------------------------------------------
// Builds/rebuilds the language <select>'s option list from whichever
// lang/*.js files actually registered themselves on window.SONGBOOK_LANG
// (see lang/config.js's SONGBOOK_LANG_ORDER for the preferred ordering).
// Pulled out of loadPrefs() so it can also be re-run live when the
// "Traditional Mongolian script" developer toggle flips — see
// applyDevOptions() — without redoing loadPrefs()'s once-only theme/accent
// setup. isInit=true (the loadPrefs() call site) additionally resolves
// state.lang itself; later re-runs just rebuild the visible option list
// and leave the already-chosen language alone.
function refreshLangPicker({ isInit = false } = {}) {
  const savedLang = localStorage.getItem('sb-ui-lang');
  let available = Object.keys(window.SONGBOOK_LANG || {});
  // "mn2" (traditional Mongolian script) is always loaded (see the
  // <script> tags in index.html) so its data is ready the instant the
  // developer toggle turns it on, but it stays out of the picker itself —
  // and gets silently reset back to the default language if it was
  // somehow the active choice — whenever that toggle is off. See
  // applyDevOptions() for where devTradMongolian is set/read.
  if (!state.devTradMongolian) available = available.filter(code => code !== 'mn2');

  const preferredOrder = window.SONGBOOK_LANG_ORDER || [];
  const orderedLangs = [
    ...preferredOrder.filter(code => available.includes(code)),
    ...available.filter(code => !preferredOrder.includes(code)).sort(),
  ];

  if (isInit) {
    state.lang = (savedLang && available.includes(savedLang)) ? savedLang
      : (available.includes(window.SONGBOOK_DEFAULT_LANG) ? window.SONGBOOK_DEFAULT_LANG : orderedLangs[0]);
  } else if (!available.includes(state.lang)) {
    // The toggle just turned off while mn2 was the active language —
    // fall back the same way isInit does, then re-render everything in
    // the new language so nothing is left showing mn2 text with mn2
    // missing from the picker.
    state.lang = available.includes(window.SONGBOOK_DEFAULT_LANG) ? window.SONGBOOK_DEFAULT_LANG : orderedLangs[0];
    localStorage.setItem('sb-ui-lang', state.lang);
  }
  document.documentElement.setAttribute('lang', state.lang);

  const langSelect = document.getElementById('ui-lang-select');
  if (langSelect) {
    langSelect.innerHTML = orderedLangs
      .map(code => `<option value="${code}">${(window.SONGBOOK_LANG[code].meta && window.SONGBOOK_LANG[code].meta.name) || code}</option>`)
      .join('');
    langSelect.value = state.lang;
  }
}
/* @end:refreshLangPicker */

/* @begin:loadPrefs */
function loadPrefs() {
  // Default to the system's light/dark preference on first run (no saved
  // choice yet) rather than hardcoding 'light'. This matters beyond just
  // matching the phone's look: browsers that algorithmically "force dark"
  // pages which don't visibly follow prefers-color-scheme (Chrome's Auto
  // Dark Theme on Android, Samsung Internet's forced dark) back off once a
  // page's own colors actually track the system setting — so following it
  // ourselves, well, is also the fix for those forced/inverted-color
  // renders. Once the person picks a theme in Settings, that explicit
  // choice always wins over the system setting from then on.
  const savedTheme = localStorage.getItem('sb-theme');
  const systemPrefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = savedTheme || (systemPrefersDark ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('theme-toggle').setAttribute('aria-checked', String(theme === 'dark'));

  // If the person has never explicitly chosen a theme, keep following the
  // system setting live (e.g. Android's scheduled dark mode kicking in at
  // sunset) instead of freezing whatever it was on first load.
  if (!savedTheme && window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystemThemeChange = (e) => {
      if (localStorage.getItem('sb-theme')) return; // person has since made an explicit choice
      const next = e.matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', next);
      const toggle = document.getElementById('theme-toggle');
      if (toggle) toggle.setAttribute('aria-checked', String(next === 'dark'));
    };
    if (mq.addEventListener) mq.addEventListener('change', onSystemThemeChange);
    else if (mq.addListener) mq.addListener(onSystemThemeChange); // older WebView/Samsung Internet
  }

  const accent = localStorage.getItem('sb-accent') || 'aqua';
  document.documentElement.setAttribute('data-accent', accent);
  document.querySelectorAll('.accent-swatch').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.accent === accent));
  });

  refreshLangPicker({ isInit: true });

  const lyricsSize = parseFloat(localStorage.getItem('sb-lyrics-size'));
  const chordSize = parseFloat(localStorage.getItem('sb-chord-size'));
  if (!Number.isNaN(lyricsSize)) state.lyricsSize = lyricsSize;
  if (!Number.isNaN(chordSize)) state.chordSize = chordSize;
  applyFontSizes();

  const savedChordStyle = localStorage.getItem('sb-chord-style');
  if (savedChordStyle === 'chip' || savedChordStyle === 'text') state.chordStyle = savedChordStyle;
  applyChordStyle();

  state.hideChords = localStorage.getItem('sb-hide-chords') === 'true';
  applyHideChords();
  state.showTextSize = localStorage.getItem('sb-show-text-size') !== 'false';
  applyTextSizeVisibility();

  const savedLyricsWeight = localStorage.getItem('sb-lyrics-weight');
  if (savedLyricsWeight === 'normal' || savedLyricsWeight === 'semibold' || savedLyricsWeight === 'bold') {
    state.lyricsWeight = savedLyricsWeight;
  }
  applyLyricsWeight();

  const savedNoteNames = localStorage.getItem('sb-note-names');
  if (['letters', 'solfege', 'mongolian'].includes(savedNoteNames)) state.noteNames = savedNoteNames;
  applyNoteNames();

  const savedLyricsSpacing = localStorage.getItem('sb-lyrics-spacing');
  if (savedLyricsSpacing === 'tight' || savedLyricsSpacing === 'normal' || savedLyricsSpacing === 'loose') {
    state.lyricsSpacing = savedLyricsSpacing;
  }
  applyLyricsSpacing();

  const savedLyricsWordSpacing = localStorage.getItem('sb-lyrics-word-spacing');
  if (savedLyricsWordSpacing === 'tight' || savedLyricsWordSpacing === 'normal' || savedLyricsWordSpacing === 'loose') {
    state.lyricsWordSpacing = savedLyricsWordSpacing;
  }
  applyLyricsWordSpacing();

  const savedSongListView = localStorage.getItem('sb-song-view');
  if (savedSongListView === 'list' || savedSongListView === 'compact' || savedSongListView === 'tiles') {
    state.songListView = savedSongListView;
  }
  applySongListView();

  state.landscapeMode = localStorage.getItem('sb-landscape-mode') === 'true';
  applyLandscapeMode();

  const savedHideVerseNumbers = localStorage.getItem('sb-hide-verse-numbers');
  if (savedHideVerseNumbers === 'true') state.hideVerseNumbers = true;
  else if (savedHideVerseNumbers === 'false') state.hideVerseNumbers = false;
  applyHideVerseNumbers();

  // Restore which song database was active (see applyDbSource()). Since
  // this version, 'sb-db' stores a DB_SOURCES key directly — the database
  // picker's checklist items (see openDbPickerModal()) are each keyed by
  // their DB_SOURCES entry — so this resolves against DB_SOURCES rather
  // than a hardcoded pair, and keeps working as more databases are added.
  // A device upgrading from an older app version has 'mn' or 'en'
  // already saved — the two-value shorthand that older version's plain
  // <select> used — so those are translated here too. Anything else
  // unrecognized (including a source key from a since-removed database)
  // falls back to the default 'official' database rather than leaving no
  // source active.
  const savedDb = localStorage.getItem('sb-db');
  const legacyDbKeys = { mn: 'official', en: 'english' };
  const resolvedDb = legacyDbKeys[savedDb] || (DB_SOURCES[savedDb] ? savedDb : DEFAULT_DB_SOURCE);
  let savedSelection;
  try { savedSelection = JSON.parse(localStorage.getItem('sb-dbs')); } catch (_) {}
  const selected = SOURCE_REGISTRY.normalizeSelection(Array.isArray(savedSelection) ? savedSelection : [resolvedDb]);
  state.multiDbSelect = localStorage.getItem('sb-db-multi') === 'true' || selected.length > 1;
  applyDbSelection(selected, { primary: resolvedDb });
}
/* @end:loadPrefs */

/* @begin:applyFontSizes */
function applyFontSizes() {
  document.documentElement.style.setProperty('--lyrics-size', state.lyricsSize + 'rem');
  document.documentElement.style.setProperty('--chord-size', state.chordSize + 'rem');
}
/* @end:applyFontSizes */

/* @begin:applyChordStyle */


// Chip (default, unchanged for existing users until they opt in) vs. text
// chord display — see the .chord-tag / html[data-chord-style="text"] rules
// in style.css for what actually changes visually. This just toggles the
// attribute CSS reads, updates the two segmented-control buttons' pressed
// state, and persists the choice the same way the font-size prefs do.
function applyChordStyle() {
  document.documentElement.setAttribute('data-chord-style', state.chordStyle);
  document.querySelectorAll('#chord-style-toggle [data-chord-style]').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.chordStyle === state.chordStyle));
  });
  positionSegToggleThumb(document.getElementById('chord-style-toggle'));
}
/* @end:applyChordStyle */

/* @begin:applyHideChords */


// The Show chords switch is checked when visible. Keep the existing
// hide-chords preference so saved choices survive this UI change.
// Preserve the Chips/Text choice while its controls are disabled.
function applyHideChords() {
  document.documentElement.setAttribute('data-hide-chords', String(state.hideChords));
  const toggle = document.getElementById('show-chords-toggle');
  if (toggle) toggle.setAttribute('aria-checked', String(!state.hideChords));
  document.querySelectorAll('#chord-style-toggle [data-chord-style]').forEach(btn => {
    btn.disabled = state.hideChords;
  });
  const styles = document.getElementById('chord-style-toggle');
  if (styles) styles.setAttribute('aria-disabled', String(state.hideChords));
  const row = document.getElementById('chord-style-row');
  if (row) row.classList.toggle('is-disabled', state.hideChords);
}
/* @end:applyHideChords */

/* @begin:applyTextSizeVisibility */
function applyTextSizeVisibility() {
  document.documentElement.setAttribute('data-show-text-size', String(state.showTextSize));
  const toggle = document.getElementById('text-size-visibility-toggle');
  if (toggle) toggle.setAttribute('aria-checked', String(state.showTextSize));
}
/* @end:applyTextSizeVisibility */

/* @begin:applyNoteNames */


// Display-only note names. Chord symbols and all stored song data remain unchanged.
function applyNoteNames() {
  document.documentElement.setAttribute('data-note-names', state.noteNames);
  const select = document.getElementById('note-name-select');
  if (select) select.value = state.noteNames;
  if (window.ChordFinder) window.ChordFinder.refreshNoteNames();
}
/* @end:applyNoteNames */

/* @begin:applyLyricsWeight */


// Lyrics style (Settings → Songs → Display settings): font weight for lyric text only —
// see the html[data-lyrics-weight] rules by .lyric-word in style.css.
// Same attribute-driven segmented-control pattern as applyChordStyle().
function applyLyricsWeight() {
  document.documentElement.setAttribute('data-lyrics-weight', state.lyricsWeight);
  document.querySelectorAll('#lyrics-weight-toggle [data-lyrics-weight]').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.lyricsWeight === state.lyricsWeight));
  });
  positionSegToggleThumb(document.getElementById('lyrics-weight-toggle'));
}
/* @end:applyLyricsWeight */

/* @begin:applyLyricsSpacing */


// Line spacing (Settings → Songs → Display settings): vertical rhythm between lyric
// lines only — general app UI spacing is untouched. See the
// html[data-lyrics-spacing] --lyric-line-* overrides by .lyric-line in
// style.css. Same attribute-driven segmented-control pattern as above.
function applyLyricsSpacing() {
  document.documentElement.setAttribute('data-lyrics-spacing', state.lyricsSpacing);
  document.querySelectorAll('#lyrics-spacing-toggle [data-lyrics-spacing]').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.lyricsSpacing === state.lyricsSpacing));
  });
  positionSegToggleThumb(document.getElementById('lyrics-spacing-toggle'));
}
/* @end:applyLyricsSpacing */

/* @begin:applyLyricsWordSpacing */


// Word spacing is intentionally independent from vertical line spacing.
// It only changes the horizontal column gap between rendered lyric-word
// tokens, including wrapped rows and the hide-chords reading layout.
function applyLyricsWordSpacing() {
  document.documentElement.setAttribute('data-lyrics-word-spacing', state.lyricsWordSpacing);
  document.querySelectorAll('#lyrics-word-spacing-toggle [data-lyrics-word-spacing]').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.lyricsWordSpacing === state.lyricsWordSpacing));
  });
  positionSegToggleThumb(document.getElementById('lyrics-word-spacing-toggle'));
}
/* @end:applyLyricsWordSpacing */

/* @begin:applySongListView */


// Songbook list view (Settings → Songs → Display settings): how the Songbook's own list
// (#song-list) lays out its rows — 'list' (default), 'compact' (denser
// rows, no artist line), or 'tiles' (a numbered grid). Set as a
// data-view attribute directly on #song-list itself (not on <html>, and
// not via the shared .song-list class) so User Songs and playlist
// song-pickers — which reuse renderSongList()/buildSongRow() against
// their own listElId — are completely unaffected. See the
// #song-list[data-view] rules in style.css. Same attribute-driven
// segmented-control pattern as applyChordStyle()/applyLyricsWeight().
function applySongListView() {
  const listEl = document.getElementById('song-list');
  if (listEl) listEl.setAttribute('data-view', state.songListView);
  updateSongToolbarButtons();
  document.querySelectorAll('#song-view-toggle [data-song-view]').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.songView === state.songListView));
  });
  positionSegToggleThumb(document.getElementById('song-view-toggle'));
  // Rebuild the entries alongside the chosen view. Their row references
  // resolve live geometry for List, Compact and Tiles.
  renderSongList();
}
/* @end:applySongListView */

/* @begin:applyLandscapeMode */


// Landscape mode (Settings → Appearance): opt-in. Rotating a phone
// sideways leaves very little vertical room (roughly 360–430px tall)
// compared to the same phone in portrait, so this trims the header/title/
// nav chrome to give lyrics and the song lists more room. The attribute
// this sets is only ever acted on inside a gated media query in
// style.css — `@media (orientation: landscape) and (max-height: 500px)`
// — so switching it on here has zero visual effect in portrait, and zero
// effect on a wide desktop window or tablet (which is "landscape" by
// aspect ratio too, but has plenty of height to spare). Same attribute-
// driven pattern as applyHideChords()/applyChordStyle() above.
function applyLandscapeMode() {
  document.documentElement.setAttribute('data-landscape-mode', String(state.landscapeMode));
  const toggle = document.getElementById('landscape-mode-toggle');
  if (toggle) toggle.setAttribute('aria-checked', String(state.landscapeMode));
}
/* @end:applyLandscapeMode */

/* @begin:applyHideVerseNumbers */


// Developer options → Display → "Hide verse numbers": hides only the
// plain sequence badge (.lyric-section-index — "1", "2", "3"…) that
// renderLyrics() adds per section when a song has more than one part and
// no explicit label. Deliberately does NOT touch .lyric-section-label —
// the same badge element used when a section opens with an explicit
// label like "Bridge:"/"Гүүр:" (see renderLyrics()'s sectionLabel) — so
// that still renders regardless of this setting. Same attribute-driven
// pattern as applyLandscapeMode() above: setting an attribute on <html>
// and hiding via CSS means an already-open song updates immediately,
// with no re-render needed.
function applyHideVerseNumbers() {
  document.documentElement.setAttribute('data-hide-verse-numbers', String(state.hideVerseNumbers));
  const toggle = document.getElementById('dev-hide-verse-numbers-toggle');
  if (toggle) toggle.setAttribute('aria-checked', String(state.hideVerseNumbers));
}
/* @end:applyHideVerseNumbers */

/* @begin:isSheetMusicProductionEnabled */


// ---------------------------------------------------------
// Sheet Music (WIP / future-ready)
// ---------------------------------------------------------
// The planning model is intentionally data-driven: the app owns the library,
// routing, search, swipe viewer, attribution and song-link behavior; the
// catalog owns only sourceKey + songId + page image URLs. Future scores are
// added by editing data/sheet-music/catalog.js (and adding local images if
// desired), not by adding song-specific JS or HTML.
function isSheetMusicProductionEnabled() {
  const cfg = window.SONGBOOK_APP_CONFIG || {};
  return !!(cfg.features && cfg.features.sheetMusic === true);
}
/* @end:isSheetMusicProductionEnabled */

/* @begin:isSheetMusicFeatureEnabled */
function isSheetMusicFeatureEnabled() {
  return isSheetMusicProductionEnabled() || state.devSheetMusic;
}
/* @end:isSheetMusicFeatureEnabled */

/* @begin:unlockDevOptions */


// ---------------------------------------------------------
// Developer options — its own dedicated page (#page-dev-options), same
// shape as the About page, for a few things that don't belong in front of
// every visitor: moving playlists between browsers (export/import), and
// toggles for content that's still being finished (traditional Mongolian
// script, the About page credits list) or that's just for fun (forcing
// each easter egg on individually to preview it without waiting for the
// right date or finding its own trigger).
//
// Unlocked per-session only (not persisted — see state.devUnlocked) by
// tapping the About page's app icon 3 times in a row, the same
// 3-tap-within-800ms pattern as the existing accent-color disco easter
// egg. Unlocking reveals a nav row in Settings' About section (below
// Contact us — see #dev-options-nav-row in index.html) that opens this
// page, the same way #about-nav-row opens the About page itself — see
// bindDevOptionsUnlock() for the tap trigger and
// initDevOptions()/applyDevOptions() for the page's own toggles and their
// effects.
// ---------------------------------------------------------

function unlockDevOptions() {
  if (state.devUnlocked) return;
  state.devUnlocked = true;
  const navRow = document.getElementById('dev-options-nav-row');
  if (navRow) navRow.hidden = false;
  showToast(t('toastDevUnlocked'));
}
/* @end:unlockDevOptions */

/* @begin:bindDevOptionsUnlock */
function bindDevOptionsUnlock() {
  const icon = document.querySelector('.about-logo');
  if (!icon) return;
  let tapTimes = [];
  icon.addEventListener('click', () => {
    if (state.devUnlocked) return; // already unlocked, nothing left to trigger
    const now = Date.now();
    tapTimes = tapTimes.filter(ts => now - ts < 800).concat(now);
    if (tapTimes.length >= 3) {
      tapTimes = [];
      unlockDevOptions();
    }
  });
}
/* @end:bindDevOptionsUnlock */

/* @begin:applyDevOptions */


// Applies the current value of each developer toggle to the parts of the
// app they affect, and syncs the switches' own visual state. Called once
// on init (values are never persisted — every toggle starts OFF each
// fresh load, same as state.devUnlocked) and again after each toggle's
// own click handler flips its state field.
function applyDevOptions() {
  // Turning one of these three off doesn't disable that easter egg — it
  // just stops forcing it on; isSabbathToday()/isChristmasWeek() fall
  // back to their own date checks on their own next read, and party mode
  // falls back to its own 3-tap trigger (see discoForcedByDevToggle's
  // comment near startDiscoMode()). Only refresh the two that poll on an
  // interval rather than waiting for their own next check, so flipping
  // either switch shows an immediate result either way.
  const sabbathToggle = document.getElementById('dev-sabbath-toggle');
  if (sabbathToggle) sabbathToggle.setAttribute('aria-checked', String(state.devSabbathForced));
  const sabbathEl = document.getElementById('sabbath-mascot');
  if (sabbathEl) {
    const show = isSabbathToday();
    sabbathEl.hidden = !show;
    if (show) updateSabbathMascotText();
  }

  const christmasToggle = document.getElementById('dev-christmas-toggle');
  if (christmasToggle) christmasToggle.setAttribute('aria-checked', String(state.devChristmasForced));
  if (window.__ngwRefreshChristmasSnow) window.__ngwRefreshChristmasSnow();

  // Party mode (disco) has no polling loop to refresh — it's a
  // start/stop action, not a continuously-rechecked condition. Only act
  // on an actual state change here, and only take ownership of sessions
  // this same switch started (see discoForcedByDevToggle's comment).
  const partyToggle = document.getElementById('dev-party-toggle');
  if (partyToggle) partyToggle.setAttribute('aria-checked', String(state.devPartyForced));
  if (state.devPartyForced && !discoModeActive) {
    discoForcedByDevToggle = true;
    startDiscoMode();
  } else if (!state.devPartyForced && discoModeActive && discoForcedByDevToggle) {
    discoForcedByDevToggle = false;
    stopDiscoMode();
  }

  const sheetMusicToggle = document.getElementById('dev-sheet-music-toggle');
  if (sheetMusicToggle) sheetMusicToggle.setAttribute('aria-checked', String(state.devSheetMusic));
  applySheetMusicFeatureUI();

  const mongolianToggle = document.getElementById('dev-trad-mongolian-toggle');
  if (mongolianToggle) mongolianToggle.setAttribute('aria-checked', String(state.devTradMongolian));
  refreshLangPicker();
  applyLanguage();

  const creditsToggle = document.getElementById('dev-credits-toggle');
  if (creditsToggle) creditsToggle.setAttribute('aria-checked', String(state.devCredits));
  renderCredits();

  // Hides the description line under a specific, curated set of settings
  // rows (see the .settings-desc-hideable class in index.html — NOT every
  // .settings-row-sub in the app) — a density option for people who
  // already know what each row does and just want the list more compact.
  const hideDescToggle = document.getElementById('dev-hide-desc-toggle');
  if (hideDescToggle) hideDescToggle.setAttribute('aria-checked', String(state.devHideDescriptions));
  document.documentElement.toggleAttribute('data-hide-setting-desc', state.devHideDescriptions);

}
/* @end:applyDevOptions */

/* @begin:initDevOptions */
function initDevOptions() {
  bindDevOptionsUnlock();
  document.getElementById('dev-preview-dialog-btn').addEventListener('click', () => previewAnnouncement('dialog'));
  document.getElementById('dev-preview-banner-btn').addEventListener('click', () => previewAnnouncement('banner'));

  document.getElementById('dev-options-nav-row').addEventListener('click', () => {
    showPage('dev-options', { pushHistory: true, resetScroll: true });
  });
  document.getElementById('dev-options-back-btn').addEventListener('click', () => history.back());

  document.getElementById('dev-sabbath-toggle').addEventListener('click', () => {
    state.devSabbathForced = !state.devSabbathForced;
    applyDevOptions();
  });
  document.getElementById('dev-christmas-toggle').addEventListener('click', () => {
    state.devChristmasForced = !state.devChristmasForced;
    applyDevOptions();
  });
  document.getElementById('dev-party-toggle').addEventListener('click', () => {
    state.devPartyForced = !state.devPartyForced;
    applyDevOptions();
  });
  document.getElementById('dev-sheet-music-toggle').addEventListener('click', () => {
    if (isSheetMusicProductionEnabled()) return;
    state.devSheetMusic = !state.devSheetMusic;
    applyDevOptions();
  });
  document.getElementById('dev-trad-mongolian-toggle').addEventListener('click', () => {
    state.devTradMongolian = !state.devTradMongolian;
    applyDevOptions();
  });
  document.getElementById('dev-credits-toggle').addEventListener('click', () => {
    state.devCredits = !state.devCredits;
    applyDevOptions();
  });
  document.getElementById('dev-hide-desc-toggle').addEventListener('click', () => {
    state.devHideDescriptions = !state.devHideDescriptions;
    applyDevOptions();
  });
  applySheetMusicFeatureUI();
}
/* @end:initDevOptions */

/* @begin:applyLanguage */


// ---------------------------------------------------------
// Language: apply the active language to every labeled element
// ---------------------------------------------------------
function applyLanguage() {
  renderAnnouncements();
  document.documentElement.setAttribute('lang', state.lang);

  const map = {
    't-appTitle': 'appTitle',
    't-topbarAppName': 'appTitle',
    't-navSongs': 'navSongs',
    't-navSettings': 'navSettings',
    't-navPlaylists': 'navPlaylists',
    't-navUserSongs': 'navUserSongs',
    't-navSheetMusic': 'navSheetMusic',
    't-sheetMusicTitle': 'sheetMusicTitle',
    't-devSheetMusicTitle': 'devSheetMusicTitle',
    't-devSheetMusicSub': 'devSheetMusicSub',
    't-userSongsTitle': 'userSongsTitle',
    't-playlistsTitle': 'playlistsTitle',
    't-playlistsBackupTitle': 'playlistsBackupTitle',
    't-playlistsBackupSub': 'playlistsBackupSub',
    't-editorTitleLabel': 'editorTitleLabel',
    't-editorArtistLabel': 'editorArtistLabel',
    't-editorKeyLabel': 'editorKeyLabel',
    't-editorLinkLabel': 'editorLinkLabel',
    't-editorLabelsLabel': 'editorLabelsLabel',
    't-editorLyricsLabel': 'editorLyricsLabel',
    't-editorPreviewLabel': 'editorPreviewLabel',
    't-keyLabel': 'keyLabel',
    't-lyricsGroup': 'lyricsGroup',
    't-chordsGroup': 'chordsGroup',
    't-noteNamesTitle': 'noteNamesTitle',
    't-noteNamesSub': 'noteNamesSub',
    't-chordStyleGroup': 'chordStyleGroup',
    't-chordStyleSub': 'chordStyleSub',
    't-chordStyleChip': 'chordStyleChip',
    't-chordStyleText': 'chordStyleText',
    't-showChordsTitle': 'showChordsTitle',
    't-showChordsSub': 'showChordsSub',
    't-lyricsWeightTitle': 'lyricsWeightTitle',
    't-lyricsWeightSub': 'lyricsWeightSub',
    't-lyricsWeightNormal': 'lyricsWeightNormal',
    't-lyricsWeightSemibold': 'lyricsWeightSemibold',
    't-lyricsWeightBold': 'lyricsWeightBold',
    't-lyricsSpacingTitle': 'lyricsSpacingTitle',
    't-lyricsSpacingSub': 'lyricsSpacingSub',
    't-lyricsSpacingTight': 'lyricsSpacingTight',
    't-lyricsSpacingNormal': 'lyricsSpacingNormal',
    't-lyricsSpacingLoose': 'lyricsSpacingLoose',
    't-textSizeTitle': 'textSizeTitle',
    't-textSizeSub': 'textSizeSub',
    't-lyricsWordSpacingTitle': 'lyricsWordSpacingTitle',
    't-lyricsWordSpacingSub': 'lyricsWordSpacingSub',
    't-lyricsWordSpacingTight': 'lyricsSpacingTight',
    't-lyricsWordSpacingNormal': 'lyricsSpacingNormal',
    't-lyricsWordSpacingLoose': 'lyricsSpacingLoose',
    't-devAnnouncementPreview': 'devAnnouncementPreview',
    't-devAnnouncementPreviewSub': 'devAnnouncementPreviewSub',
    'dev-preview-dialog-btn': 'devPreviewDialog',
    'dev-preview-banner-btn': 'devPreviewBanner',
    't-presSettingsTitle': 'presSettingsTitle',
    't-presSettingsTitle2': 'presSettingsTitle',
    't-presSettingsSub': 'presSettingsSub',
    't-presAdvancedTitle2': 'presAdvancedTitle',
    't-settingsTitle': 'settingsTitle',
    't-sectionAppearance': 'sectionAppearance',
    't-darkModeTitle': 'darkModeTitle',
    't-darkModeSub': 'darkModeSub',
    't-accentTitle': 'accentTitle',
    't-accentSub': 'accentSub',
    't-songViewGroup': 'songViewGroup',
    't-songViewSub': 'songViewSub',
    't-songViewList': 'songViewList',
    't-songViewCompact': 'songViewCompact',
    't-songViewTiles': 'songViewTiles',
    't-sectionSongs': 'sectionSongs',
    't-displaySettingsTitle': 'displaySettingsTitle',
    't-displaySettingsTitle2': 'displaySettingsTitle',
    't-displaySettingsSub': 'displaySettingsSub',
    't-uiLangTitle': 'uiLangTitle',
    't-uiLangSub': 'uiLangSub',
    't-dbTitle': 'dbTitle',
    't-sectionApp': 'sectionApp',
    't-reloadTitle': 'reloadTitle',
    't-reloadSub': 'reloadSub',
    't-reloadAppTitle': 'reloadAppTitle',
    't-reloadAppSub': 'reloadAppSub',
    't-sectionAbout': 'sectionAbout',
    't-sectionAbout2': 'sectionAbout',
    't-sectionTools': 'sectionTools',
    't-chordFinderTitle': 'chordFinderTitle',
    't-chordFinderTitle2': 'chordFinderTitle',
    't-chordFinderSub': 'chordFinderSub',
    't-versionTitle': 'versionTitle',
    't-creditsHeading': 'creditsHeading',
    'about-nav-sub': 'aboutNavSub',
    't-sectionDevOptions': 'sectionDevOptions',
    't-sectionDevOptions2': 'sectionDevOptions',
    't-sectionDevEasterEggs': 'sectionDevEasterEggs',
    't-devSabbathTitle': 'devSabbathTitle',
    't-devSabbathSub': 'devSabbathSub',
    't-devChristmasTitle': 'devChristmasTitle',
    't-devChristmasSub': 'devChristmasSub',
    't-devPartyTitle': 'devPartyTitle',
    't-devPartySub': 'devPartySub',
    't-sectionDevDisplay': 'sectionDevDisplay',
    't-landscapeModeTitle': 'landscapeModeTitle',
    't-landscapeModeSub': 'landscapeModeSub',
    't-hideVerseNumbersTitle': 'hideVerseNumbersTitle',
    't-hideVerseNumbersSub': 'hideVerseNumbersSub',
    't-sectionDevInProgress': 'sectionDevInProgress',
    't-devTradMongolianTitle': 'devTradMongolianTitle',
    't-devTradMongolianSub': 'devTradMongolianSub',
    't-devCreditsTitle': 'devCreditsTitle',
    't-devCreditsSub': 'devCreditsSub',
    't-devDiagTitle': 'devDiagTitle',
    't-devDiagSub': 'devDiagSub',
    't-devHideDescTitle': 'devHideDescTitle',
    't-devHideDescSub': 'devHideDescSub',
    't-userSongsBackupTitle': 'userSongsBackupTitle',
    't-userSongsBackupSub': 'userSongsBackupSub',
    't-trashNavTitle': 'trashNavTitle',
    't-trashNavSub': 'trashNavSub',
    't-trashTitle': 'trashTitle',
    't-trashHint': 'trashHint',
  };
  Object.entries(map).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = t(key);
  });

  document.getElementById('search-input').placeholder = t('searchPlaceholder');
  document.getElementById('user-song-search-input').placeholder = t('searchPlaceholder');
  document.getElementById('sheet-music-search-input').placeholder = t('sheetMusicSearchPlaceholder');
  document.getElementById('editor-key').placeholder = t('editorKeyPlaceholder');
  document.getElementById('editor-link').placeholder = t('editorLinkPlaceholder');
  document.getElementById('editor-format-help-btn').setAttribute('aria-label', t('editorFormatHelpAria'));
  document.getElementById('back-btn').setAttribute('aria-label', t('backAria'));
  document.getElementById('transpose-reset').textContent = t('transposeReset');
  document.getElementById('editor-save-btn').textContent = t('saveBtn');

  document.querySelector('.sort-btn[data-sort-by="alpha"]').textContent = t('sortByAlpha');
  document.querySelector('.sort-btn[data-sort-by="num"]').textContent = t('sortByNumber');
  document.querySelector('.sort-btn[data-sort-order="asc"]').textContent = t('sortAsc');
  document.querySelector('.sort-btn[data-sort-order="desc"]').textContent = t('sortDesc');

  // The row subtitle shows the *current* database's name rather than a
  // static instruction (see updateDbRowSub()) — 'english's name is itself
  // language-dependent (dbOptionEnglish), so this needs a re-run here too,
  // not just from applyDbSource() when the selection changes.
  updateDbRowSub();

  document.getElementById('empty-state').textContent = t('emptyState');
  document.getElementById('about-version-line').textContent = t('versionSub', APP_VERSION);
  document.getElementById('about-nav-title').textContent = t('appName');
  const aboutDescription = document.getElementById('about-description');
  if (aboutDescription) {
    const langDict = (window.SONGBOOK_LANG && window.SONGBOOK_LANG[state.lang]) || {};
    const enDict = (window.SONGBOOK_LANG && window.SONGBOOK_LANG.en) || {};
    aboutDescription.textContent = langDict.appDescription || enDict.appDescription || 'Offline worship songbook.';
  }
  document.getElementById('scripture-verse-text').textContent = `«${t('scriptureVerse')}»`;
  document.getElementById('scripture-verse-ref').textContent = t('scriptureRef');

  const appConfig = window.SONGBOOK_APP_CONFIG || {};
  const orgName = appConfig.orgName || '';
  const showCopyright = appConfig.showCopyrightNotice !== false;
  const copyrightEl = document.getElementById('about-copyright');
  const copyrightTermsEl = document.getElementById('about-copyright-terms');
  copyrightEl.hidden = copyrightTermsEl.hidden = !showCopyright;
  copyrightEl.textContent = showCopyright
    ? `© ${new Date().getFullYear()} ${orgName}. All rights reserved.` : '';
  copyrightTermsEl.textContent = showCopyright ? t('copyrightTerms') : '';

  document.getElementById('t-contactBtn').textContent = t('contactBtn');
  document.getElementById('about-contact-copy').setAttribute('aria-label', t('copyEmailAria'));
  if (appConfig.contactEmail) {
    document.getElementById('about-contact-email').textContent = appConfig.contactEmail;
  }
  resetContactUI();

  const reloadBtn = document.getElementById('reload-songs-btn');
  if (!reloadBtn.disabled) reloadBtn.textContent = t('reloadBtn');
  const reloadAppBtn = document.getElementById('reload-app-btn');
  if (!reloadAppBtn.disabled) reloadAppBtn.textContent = t('reloadAppBtn');
  document.getElementById('dev-diag-btn').textContent = t('devDiagBtn');
  document.getElementById('export-playlists-btn').textContent = t('exportBtn');
  document.getElementById('import-playlists-btn').textContent = t('importBtn');
  document.getElementById('export-user-songs-btn').textContent = t('exportBtn');
  document.getElementById('import-user-songs-btn').textContent = t('importBtn');

  renderSocialLinks();
  renderCredits();

  refreshInstallLabels();
  updateSongToolbarButtons();
  renderSongList();
  if (state.currentPage === 'user-songs') renderUserSongList();
  if (state.activeSong) updateTransposeUI();
  if (state.currentPage === 'playlists') renderPlaylistsList();
  updateSabbathMascotText(); // re-translate the mascot's bubble if it's showing
  if (state.currentPage === 'playlist-view') renderPlaylistView();
  if (state.currentPage === 'trash') renderTrashList();
  if (state.activeSong) { updateFavoriteButtonUI(); updateSongViewMenuUI(); }
  // Translated labels (Normal/Semibold/Bold etc.) can be wider or narrower
  // in the new language — instant, since this isn't the person tapping a
  // pill themselves. No-ops harmlessly if Settings isn't the page on
  // screen right now (see positionSegToggleThumb's offsetParent guard).
  updateAllSegToggleThumbs({ instant: true });
  applySheetMusicFeatureUI();
  if (state.currentPage === 'sheet-music' && isSheetMusicFeatureEnabled()) renderSheetMusicLibrary();
  if (state.currentPage === 'sheet-view') updateSheetMusicPageUI();
  if (window.ChordFinder) window.ChordFinder.refreshLanguage();
}
/* @end:applyLanguage */

/* @begin:bindSettings */
function bindSettings() {
  document.getElementById('song-display-back-btn').addEventListener('click', () => history.back());

  document.getElementById('song-display-nav-row').addEventListener('click', () => {
    showPage('song-display', { pushHistory: true, resetScroll: true });
  });

  document.getElementById('about-nav-row').addEventListener('click', () => {
    showPage('about', { pushHistory: true, resetScroll: true });
  });

  document.getElementById('trash-nav-row').addEventListener('click', () => {
    showPage('trash', { pushHistory: true, resetScroll: true });
  });

  document.getElementById('reload-songs-btn').addEventListener('click', reloadSongLibrary);
  document.getElementById('dev-diag-btn').addEventListener('click', copyDiagnostics);
  document.getElementById('reload-app-btn').addEventListener('click', reloadApp);
  document.getElementById('export-playlists-btn').addEventListener('click', exportPlaylists);
  document.getElementById('import-playlists-btn').addEventListener('click', () => {
    document.getElementById('import-playlists-file').click();
  });
  document.getElementById('import-playlists-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) importPlaylistsFromFile(file);
    e.target.value = '';
  });
  document.getElementById('export-user-songs-btn').addEventListener('click', exportUserSongs);
  document.getElementById('import-user-songs-btn').addEventListener('click', () => {
    document.getElementById('import-user-songs-file').click();
  });
  document.getElementById('import-user-songs-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) importUserSongsFromFile(file);
    e.target.value = '';
  });

  document.getElementById('about-contact-btn').addEventListener('click', () => {
    // Let the mailto: link proceed as normal (opens the person's mail app,
    // where available) — this fires alongside that, not instead of it.
    copyContactEmail({ silent: true });
    document.getElementById('about-contact-btn').hidden = true;
    document.getElementById('about-contact-fallback').hidden = false;
  });

  document.getElementById('about-contact-copy').addEventListener('click', () => {
    copyContactEmail();
  });

  const toggle = document.getElementById('theme-toggle');
  toggle.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const next = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    toggle.setAttribute('aria-checked', String(next === 'dark'));
    localStorage.setItem('sb-theme', next);
  });

  document.querySelectorAll('.accent-swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      if (discoModeActive) stopDiscoMode(); // manual pick wins over the easter egg
      const accent = btn.dataset.accent;
      document.documentElement.setAttribute('data-accent', accent);
      localStorage.setItem('sb-accent', accent);
      document.querySelectorAll('.accent-swatch').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
    });
  });

  document.querySelectorAll('#chord-style-toggle [data-chord-style]').forEach(btn => {
    btn.addEventListener('click', () => {
      const style = btn.dataset.chordStyle;
      if (state.hideChords || style === state.chordStyle) return;
      state.chordStyle = style;
      applyChordStyle();
      localStorage.setItem('sb-chord-style', state.chordStyle);
    });
  });

  const showChordsToggle = document.getElementById('show-chords-toggle');
  showChordsToggle.addEventListener('click', () => {
    state.hideChords = !state.hideChords;
    applyHideChords();
    localStorage.setItem('sb-hide-chords', String(state.hideChords));
  });

  document.getElementById('text-size-visibility-toggle').addEventListener('click', () => {
    state.showTextSize = !state.showTextSize;
    applyTextSizeVisibility();
    localStorage.setItem('sb-show-text-size', String(state.showTextSize));
  });

  const landscapeModeToggle = document.getElementById('landscape-mode-toggle');
  landscapeModeToggle.addEventListener('click', () => {
    state.landscapeMode = !state.landscapeMode;
    applyLandscapeMode();
    localStorage.setItem('sb-landscape-mode', String(state.landscapeMode));
  });

  document.getElementById('note-name-select').addEventListener('change', e => {
    const choice = e.target.value;
    if (!['letters', 'solfege', 'mongolian'].includes(choice) || choice === state.noteNames) return;
    state.noteNames = choice;
    applyNoteNames();
    localStorage.setItem('sb-note-names', choice);
  });

  const hideVerseNumbersToggle = document.getElementById('dev-hide-verse-numbers-toggle');
  hideVerseNumbersToggle.addEventListener('click', () => {
    state.hideVerseNumbers = !state.hideVerseNumbers;
    applyHideVerseNumbers();
    localStorage.setItem('sb-hide-verse-numbers', String(state.hideVerseNumbers));
  });

  document.querySelectorAll('#lyrics-weight-toggle [data-lyrics-weight]').forEach(btn => {
    btn.addEventListener('click', () => {
      const weight = btn.dataset.lyricsWeight;
      if (weight === state.lyricsWeight) return;
      state.lyricsWeight = weight;
      applyLyricsWeight();
      localStorage.setItem('sb-lyrics-weight', state.lyricsWeight);
    });
  });

  document.querySelectorAll('#lyrics-spacing-toggle [data-lyrics-spacing]').forEach(btn => {
    btn.addEventListener('click', () => {
      const spacing = btn.dataset.lyricsSpacing;
      if (spacing === state.lyricsSpacing) return;
      state.lyricsSpacing = spacing;
      applyLyricsSpacing();
      localStorage.setItem('sb-lyrics-spacing', state.lyricsSpacing);
    });
  });

  document.querySelectorAll('#lyrics-word-spacing-toggle [data-lyrics-word-spacing]').forEach(btn => {
    btn.addEventListener('click', () => {
      const spacing = btn.dataset.lyricsWordSpacing;
      if (spacing === state.lyricsWordSpacing) return;
      state.lyricsWordSpacing = spacing;
      applyLyricsWordSpacing();
      localStorage.setItem('sb-lyrics-word-spacing', state.lyricsWordSpacing);
    });
  });

  document.querySelectorAll('#song-view-toggle [data-song-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.songView;
      if (view === state.songListView) return;
      state.songListView = view;
      applySongListView();
      localStorage.setItem('sb-song-view', state.songListView);
    });
  });

  const langSelect = document.getElementById('ui-lang-select');
  langSelect.addEventListener('change', () => {
    state.lang = langSelect.value;
    localStorage.setItem('sb-ui-lang', state.lang);
    applyLanguage();
  });

  document.getElementById('db-nav-row').addEventListener('click', openDbPickerModal);
}
/* @end:bindSettings */

