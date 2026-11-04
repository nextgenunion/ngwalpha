// =========================================================
// Songbook — app.js
// Copyright (c) 2026 Next Gen Union. All rights reserved.
// Proprietary and confidential. No unauthorized copying, modification,
// or redistribution, in whole or in part, without prior written
// permission from Next Gen Union. See LICENSE for full terms.
//
// Data-driven: song content lives as one JSON file per song, one folder
// per song database under /data/ (see DB_SOURCES further down for the
// registry of which folder belongs to which source), loaded lazily at
// runtime. Each database may also ship a generated database.json bootstrap
// snapshot for the one-request fast path. Individual song JSON files remain
// authoritative and update that snapshot in the background, so rebuilding
// database.json is optional for ordinary one-song corrections.
// =========================================================

// Sourced from version.js (loaded before this file in index.html) so this
// never has to be edited here — bump the version in version.js instead.
const APP_VERSION = window.SONGBOOK_APP_VERSION;
const SEEN_VERSION_KEY = 'ngw_seen_version';

// Shipped song databases, their UI grouping, runtime-state factory, and
// IndexedDB store names all come from one registry module. Keeping this outside
// app.js removes the old three-way duplication between DB_SOURCES,
// state.sources, and SONGDB_STORES.
const SOURCE_REGISTRY = window.SongSourceRegistry;
if (!SOURCE_REGISTRY) throw new Error('SongSourceRegistry failed to load');
const DB_SOURCES = SOURCE_REGISTRY.databases;
const DB_GROUP_ORDER = SOURCE_REGISTRY.groupOrder;
const DB_GROUP_LABELS = SOURCE_REGISTRY.groupLabels;
const DEFAULT_DB_SOURCE = SOURCE_REGISTRY.defaultSource;
const SONGBOOK_SOURCE = '__songbook__';
const songbookSongSources = new WeakMap();

// Marks the version we're about to reload into as "already seen", so that
// when app.js re-executes after the reload, versionUpdateBackstop() below
// sees no mismatch and stays quiet. Called by every code path that already
// handles an update and is about to reload for it on its own (the normal
// controllerchange path, and the manual "Reload app" button) — so the
// backstop only ever fires for what it's actually meant for: a device that
// somehow never went through one of those normal paths at all. Without
// this, the backstop can't tell "a normal update just handled this" apart
// from "nothing has ever updated this device", and reloads a second time
// after every single normal update, on top of the reload that already
// handled it.
function markVersionSeen() {
  try {
    localStorage.setItem(SEEN_VERSION_KEY, APP_VERSION);
  } catch (e) {
    // localStorage unavailable — the reload still happens either way;
    // worst case here is the backstop redundantly double-checking on the
    // next load, not a stuck/stale app.
  }
}

// ---------------------------------------------------------
// Error log: remember the last few unexpected errors on this device so a
// tester can paste them into a bug report (Settings → Developer → Copy
// diagnostics). Nothing is sent anywhere.
// ---------------------------------------------------------
const ERROR_LOG_KEY = 'ngw_error_log';
const ERROR_LOG_MAX = 10;
function recordAppError(kind, err) {
  try {
    const log = JSON.parse(localStorage.getItem(ERROR_LOG_KEY) || '[]');
    const msg = String((err && (err.stack || err.message)) || err || 'unknown').slice(0, 600);
    log.push({ t: new Date().toISOString(), kind, v: APP_VERSION, msg });
    localStorage.setItem(ERROR_LOG_KEY, JSON.stringify(log.slice(-ERROR_LOG_MAX)));
  } catch (_) { /* storage unavailable: nothing to record into */ }
}
window.addEventListener('error', (e) => recordAppError('error', e.error || `${e.message} (${e.filename}:${e.lineno})`));
window.addEventListener('unhandledrejection', (e) => recordAppError('rejection', e.reason));

// Version changes request an update without removing the installed cache.
// Worker installation performs the complete, atomic handoff.
(function versionUpdateBackstop() {
  try {
    const seen = localStorage.getItem(SEEN_VERSION_KEY);
    localStorage.setItem(SEEN_VERSION_KEY, APP_VERSION);
    if (seen && seen !== APP_VERSION && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration()
        .then((reg) => reg && reg.update())
        .catch(() => {});
    }
  } catch (e) {
    // localStorage/service-worker access can be unavailable in private or
    // restricted browsing contexts. The ordinary registration path below
    // still works where the platform permits it.
  }
})();

// Every library keeps its own loader and offline store. The main Songbook
// derives a combined collection from selectedDbSources; personal song
// references always retain their original sourceKey + songId identity.
// Session-only UI state for editor drafts, navigation and announcements.
let editorBaseline = null;
let editorHistoryRecovery = false;
let currentNavIndex = 0;
let announcements = [];
const dismissedAnnouncements = new Set();
const shownAnnouncements = new Set();

const state = {
  sources: SOURCE_REGISTRY.createRuntimeSources(),
  // Primary/last selected database for the single picker and Sheet Music.
  // activeSourceKey instead identifies the song currently open in song view.
  activeDbSource: DEFAULT_DB_SOURCE,
  selectedDbSources: [DEFAULT_DB_SOURCE],
  multiDbSelect: false,
  sortBy: 'num',       // 'alpha' | 'num' — the sort in use right now (derived, see sortPref)
  // What the person asked for while looking at a library that HAS book numbers.
  // Numbered libraries start on 'num'. A library without numbers (English) is
  // always shown alphabetically WITHOUT touching this, so coming back to a
  // numbered one restores number order instead of staying stuck on A–Z.
  sortPref: 'num',
  sortOrder: 'asc',     // 'asc' | 'desc'
  query: '',
  // Main Songbook-only label filters. Multiple selected labels use OR
  // semantics (a song matching any selected label is shown); search text
  // still combines with this filter normally. Session-only by design so a
  // forgotten filter never makes a later app launch look mysteriously empty.
  songLabelFilters: [],
  // Keep each library's search query independent so switching tabs does not
  // clobber whichever search the person was mid-typing on another page.
  userSongQuery: '',
  sheetMusicQuery: '',
  activeSheetMusicId: null, // current catalog entry shown in #page-sheet-view
  sheetMusicPageIndex: 0,   // current horizontally-swiped page in the sheet viewer
  displayMode: false, // toggled from the song view's "…" menu — see
                            // toggleDisplayMode()/applyDisplayMode()
                            // below. Session-only (not persisted to
                            // localStorage/Settings): it's a "projecting
                            // right now" mode rather than a saved
                            // preference, so it starts back off on reload,
                            // and deliberately carries across songs within
                            // the session rather than resetting per-song —
                            // display mode is normally a whole-session thing,
                            // not a per-song one.
  personalLabels: { bySongRef: {} }, // see "Labels" section below; loaded
                                      // from storage by loadPersonalLabels()
  editorLabelsDraft: [], // Song Editor's held-until-Save label list — see
                          // openSongEditor()/saveSongFromEditor()
  activeSong: null,
  activeSourceKey: DEFAULT_DB_SOURCE, // which source the open song view came from
  editorSongId: null, // set while the editor is open for an EXISTING user
                       // song (its id); null means "New song" — see
                       // openSongEditor(). Read by saveSongFromEditor() to
                       // decide insert vs update.
  transpose: 0,
  lyricsSize: 1.05,   // rem
  chordSize: 0.82,    // rem
  chordStyle: 'chip', // 'chip' | 'text' — see applyChordStyle()
  noteNames: 'letters', // 'letters' | 'solfege' | 'mongolian' — display-only note labels
  hideChords: false,  // see applyHideChords()
  showTextSize: true, // visibility of A−/A+ on song pages
  lyricsWeight: 'normal',  // 'normal' | 'semibold' | 'bold' — see applyLyricsWeight()
  lyricsSpacing: 'tight', // vertical: 'tight' | 'normal' | 'loose' — see applyLyricsSpacing(); default is the compact/tight option
  lyricsWordSpacing: 'normal', // horizontal: 'tight' | 'normal' | 'loose' — see applyLyricsWordSpacing()
  songListView: 'list', // 'list' | 'compact' | 'tiles' — see applySongListView(); only affects the Songbook's own list (#song-list)
  landscapeMode: false, // see applyLandscapeMode() — trims header/nav chrome to reclaim vertical space; only takes visual effect on a short, wide (phone-in-landscape) viewport, see the gated media query in style.css
  // Developer options → Display → "Hide verse numbers" — see
  // applyHideVerseNumbers(). Only hides the plain "1, 2, 3…" sequence
  // badge renderLyrics() adds per section (.lyric-section-index); a
  // section opening with an explicit label like "Bridge:"/"Гүүр:" renders
  // as .lyric-section-label instead and is NOT affected by this — see the
  // comment above sectionLabel in renderLyrics() for that split.
  hideVerseNumbers: true,
  lang: 'mn',
  currentPage: 'songs', // mirrors whichever page is currently visible (see showPage)
  playlists: { order: [], byId: {} }, // see "Playlists" section below
  activePlaylistId: null,
  trashSongs: [], // User Songs trash bin — loaded by loadTrash(); see the
                   // "User Songs trash bin" section further down

  // ---- Developer options (see initDevOptions()) ----
  // The page itself is only reachable after tapping the About page's app
  // icon 3 times in a row (see bindDevOptionsUnlock()) — devUnlocked isn't
  // persisted, so the nav row to it is hidden again on every fresh load
  // and has to be re-unlocked, the same as the existing accent-color
  // easter egg.
  devUnlocked: false,
  devAnnouncementBanner: false, // sample only; cleared on reload/dismissal
  // devSabbathForced/devChristmasForced/devPartyForced: one switch per
  // easter egg, each OFF by default. Turning one ON force-shows that
  // single easter egg (Sabbath mascot / Christmas snow / accent disco
  // "party mode" respectively) regardless of today's date or manual-tap
  // state — the other two are untouched. Turning it back OFF does NOT
  // disable that egg — it just stops forcing it on, so it falls back to
  // its own original secret trigger exactly as before this feature
  // existed: Sabbath/Christmas by date, party mode by 3 taps on "Accent
  // color". See each easter egg's isXActive()-style check further down
  // for how its own override is read.
  devSabbathForced: false,
  devChristmasForced: false,
  devPartyForced: false,
  devSheetMusic: false,   // WIP Sheet Music feature gate; session-only
  devTradMongolian: false, // see refreshLangPicker()
  devCredits: false,       // see renderCredits()
  devHideDescriptions: false, // see applyDevOptions() — toggles .settings-desc-hideable
};

// Registry of every page the router (showPage/bindNav) knows about. Adding
// a new page later — e.g. v2's "user-songs", or Playlists/Sheet Music —
// means adding one entry here plus its <main id="…"> and its
// <button data-nav="…"> in index.html; showPage() and bindNav() below
// don't need to change either way.
//   elId            — the <main> element's id.
//   navKey           — which bottom-nav button (its data-nav value) should
//                       light up while this page is open. song-view has no
//                       button of its own, so it borrows 'songs' (the list
//                       it was opened from). Omit for a page that hides the
//                       nav bar entirely (see hideNav).
//   hideNav          — true if the bottom nav should be hidden on this page.
//   rememberScroll    — true if this page's scroll position should be saved
//                       and restored across navigation. song-view is false:
//                       it shows different content each time it's opened,
//                       so it always starts at the top instead.
//   onEnter          — optional callback run each time this page is shown.
const PAGES = {
  // Songs deliberately does NOT re-render its potentially-thousands of
  // rows on every return. onSongsPageEnter() reconnects the existing
  // fast-scroll rows and syncs the thumb when the page is visible. Rebuilds
  // still happen when source/search/sort/view data changes.
  'songs':          { elId: 'page-songs',          navKey: 'songs',     rememberScroll: true, onEnter: () => onSongsPageEnter() },
  'song-view':      { elId: 'page-song-view',      navKey: 'songs',     rememberScroll: false, hideNav: true },
  'user-songs':     { elId: 'page-user-songs',      navKey: 'user-songs', rememberScroll: true, onEnter: () => renderUserSongList() },
  'sheet-music':    { elId: 'page-sheet-music',     navKey: 'sheet-music', rememberScroll: true, onEnter: () => renderSheetMusicLibrary() },
  'sheet-view':     { elId: 'page-sheet-view',      navKey: 'sheet-music', rememberScroll: false, hideNav: true },
  'song-editor':    { elId: 'page-song-editor',    navKey: 'user-songs', rememberScroll: false, hideNav: true },
  'playlists':      { elId: 'page-playlists',      navKey: 'playlists', rememberScroll: true,  onEnter: () => renderPlaylistsList() },
  'playlist-view':  { elId: 'page-playlist-view',  navKey: 'playlists', rememberScroll: false, hideNav: true },
  'settings':       { elId: 'page-settings',       navKey: 'settings',  rememberScroll: true,  onEnter: () => resetContactUI() },
  'song-display':   { elId: 'page-song-display',   navKey: 'settings',  rememberScroll: false, hideNav: true, onEnter: () => updateAllSegToggleThumbs({ instant: true }) },
  'about':          { elId: 'page-about',          navKey: 'settings',  rememberScroll: false, hideNav: true },
  // Built-in tool, opened from Settings → Tools. ChordFinder.init() builds
  // the fretboard once, the first time the page is shown (see js/chord-finder.js).
  'presentation-settings': { elId: 'page-presentation-settings', navKey: 'settings', rememberScroll: false, hideNav: true, onEnter: () => SongPresentation.settings(t) },
  'chord-finder':   { elId: 'page-chord-finder',   navKey: 'settings',  rememberScroll: false, hideNav: true, onEnter: () => { if (window.ChordFinder) window.ChordFinder.init(); updateAllSegToggleThumbs({ instant: true }); } },
  'trash':          { elId: 'page-trash',          navKey: 'settings',  rememberScroll: false, hideNav: true, onEnter: () => renderTrashList() },
  // Only reachable once unlocked (see unlockDevOptions()) — not through
  // history/deep-linking before that, since showPage() itself doesn't
  // gate on state.devUnlocked; the About page's row to get here is what's
  // hidden pre-unlock instead (see index.html).
  'dev-options':    { elId: 'page-dev-options',    navKey: 'settings',  rememberScroll: false, hideNav: true },
};

// Pages that open "on top of" another page (a song out of the songbook or
// a playlist, pushed over whatever list it was opened from) rather than
// being a sibling tab you switch between. These get the slide push/pop
// transition in showPage(); tab switches (Songs/Playlists/Settings) stay
// an instant cut, same as before.
const SLIDE_PAGES = new Set(['presentation-settings', 'song-view', 'sheet-view', 'playlist-view', 'song-display', 'about', 'chord-finder', 'trash', 'dev-options', 'song-editor']);

// The four bottom-nav tabs — sibling pages switched via .nav-btn taps
// rather than "opened on top of" one another, so they get the crossfade
// in runTabFadeTransition() below instead of SLIDE_PAGES' push/pop slide.
// See showPage()'s transitionType selection.
const TAB_PAGES = new Set(['songs', 'user-songs', 'sheet-music', 'playlists', 'settings']);

// Remembers each rememberScroll page's scroll position (each .page
// element's own scrollTop — see the CSS notes on .page for why it's no
// longer window/document scroll) across navigation, so leaving a page (open
// a song, switch tabs) and coming back lands where you left off, instead of
// jumping to the top every time. Derived from PAGES so a new page opts in
// just by setting rememberScroll: true there — nothing to add here. See
// showPage().
const scrollMemory = {};
Object.entries(PAGES).forEach(([name, page]) => {
  if (page.rememberScroll) scrollMemory[name] = 0;
});

// Chord transpose is limited to a full octave in either direction —
// beyond that you're just back to an enharmonic equivalent of an in-range key.
const TRANSPOSE_LIMIT = 12;

const CHROMATIC_SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const CHROMATIC_FLAT  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const FLAT_KEYS = new Set(['F','Bb','Eb','Ab','Db','Gb','Dm','Gm','Cm','Fm','Bbm']);

// ---------------------------------------------------------
// Icons: every icon the app uses lives as its own file under
// icons/svg/ — this loader fetches each one and injects its markup into
// the matching <svg data-icon="…"> placeholder. To use a different icon,
// replace (or edit) the file in icons/svg/ — nothing here needs to change.
// A replacement file's own viewBox/attributes are honored, so a
// differently-proportioned icon still renders correctly.
// ---------------------------------------------------------
const ICON_FILES = {
  'brand-mark': 'icons/svg/brand-music-note.svg',
  'search': 'icons/svg/search.svg',
  'filter-tune': 'icons/svg/filter-tune.svg',
  'back-arrow': 'icons/svg/back-arrow.svg',
  'contact-mail': 'icons/svg/mail-contact.svg',
  'copy': 'icons/svg/copy.svg',
  'nav-songs': 'icons/svg/nav-songs-bookmark.svg',
  'nav-user-songs': 'icons/svg/nav-user-songs.svg',
  'nav-settings': 'icons/svg/nav-settings-gear.svg',
  'nav-playlist': 'icons/svg/nav-playlist.svg',
  'heart-outline': 'icons/svg/heart-outline.svg',
  'heart-filled': 'icons/svg/heart-filled.svg',
  'menu-kebab': 'icons/svg/menu-kebab.svg',
  'reading-mode': 'icons/svg/reading-mode.svg',
  'presentation': 'icons/svg/presentation.svg',
  'tag': 'icons/svg/tag.svg',
  'plus': 'icons/svg/plus.svg',
  'trash': 'icons/svg/trash.svg',
  'pencil': 'icons/svg/pencil.svg',
  'close': 'icons/svg/close.svg',
  'check': 'icons/svg/check.svg',
  'download': 'icons/svg/download.svg',
  'upload': 'icons/svg/upload.svg',
  'social-facebook': 'icons/svg/social-facebook.svg',
  'social-youtube': 'icons/svg/social-youtube.svg',
  'social-instagram': 'icons/svg/social-instagram.svg',
  'social-website': 'icons/svg/social-website.svg',
  // Settings page row icons — one per row in Appearance/Songs/App/About
  // (see index.html's #page-settings) so each option is easier to
  // recognize at a glance, not just read.
  'dark-mode': 'icons/svg/dark-mode.svg',
  'palette': 'icons/svg/palette.svg',
  'library-music': 'icons/svg/library-music.svg',
  'refresh': 'icons/svg/refresh.svg',
  'view-list': 'icons/svg/view-list.svg',
  'music-note': 'icons/svg/music-note.svg',
  'visibility-off': 'icons/svg/visibility-off.svg',
  'format-bold': 'icons/svg/format-bold.svg',
  'line-spacing': 'icons/svg/line-spacing.svg',
  'translate': 'icons/svg/translate.svg',
  'install-mobile': 'icons/svg/install-mobile.svg',
  'restart-alt': 'icons/svg/restart-alt.svg',
  'info-outline': 'icons/svg/info-outline.svg',
  'chord-finder': 'icons/svg/chord-finder.svg',
  // Full-color one-off (not part of the monochrome fill="currentColor" set
  // above) — the Saturday/Sabbath easter-egg mascot. See initSabbathMascot().
  'mascot-sabbath': 'icons/svg/mascot-sabbath.svg',
};

// Offline completeness is owned by the service worker's atomic install.
// The page does not maintain a second Cache Storage strategy.
const iconFileCache = new Map();
/* @extracted:ui.js:loadIconFile */

/* @extracted:ui.js:injectIcon */

/* @extracted:ui.js:initIcons */

// Social links shown in Settings → About. Leave `url` empty in config.js to
// hide that icon entirely — nothing else needs to change when these are
// filled in. Each icon's artwork lives in icons/svg/ (see ICON_FILES above);
// this table just maps a platform to its label and icon file key.
const SOCIAL_ICONS = {
  facebook: { label: 'Facebook', icon: 'social-facebook' },
  youtube: { label: 'YouTube', icon: 'social-youtube' },
  instagram: { label: 'Instagram', icon: 'social-instagram' },
  website: { label: 'Website', icon: 'social-website' },
};

/* @extracted:ui.js:renderSocialLinks *//* @extracted:ui.js:renderCredits */

/* @extracted:settings.js:t */

// ---------------------------------------------------------
// Boot
// ---------------------------------------------------------
// Start service-worker registration as soon as this deferred script executes,
// before waiting for DOMContentLoaded or window.load. That shrinks the first-
// visit window where an installed Chrome PWA has no controlling worker yet.
registerServiceWorker();
document.addEventListener('DOMContentLoaded', init);

// Each startup step runs independently — if one throws (a missing element,
// a bad selector, anything), the rest still run. Without this, one broken
// step could silently prevent applyLanguage() from ever running, leaving
// the static English placeholders in index.html on screen permanently
// instead of the real (translated) content.
function safe(label, fn) {
  try {
    fn();
  } catch (err) {
    console.error(`Songbook: "${label}" failed during startup —`, err);
  }
}

async function init() {
  safe('initIcons', initIcons);
  safe('initSplash', initSplash);
  safe('loadPrefs', loadPrefs);
  safe('bindNav', bindNav);
  safe('bindSongsPage', bindSongsPage);
  safe('bindScrollIndexInteraction', bindScrollIndexInteraction);
  safe('bindSongView', bindSongView);
  safe('bindChordViewer', bindChordViewer);
  safe('bindLyricsCopy', bindLyricsCopy);
  safe('bindUserSongsPage', bindUserSongsPage);
  safe('bindSheetMusicPage', bindSheetMusicPage);
  safe('bindSongEditor', bindSongEditor);
  safe('bindPlaylistsPage', bindPlaylistsPage);
  safe('bindPlaylistView', bindPlaylistView);
  safe('bindModalShell', bindModalShell);
  safe('bindSettings', bindSettings);
  safe('bindAboutPage', bindAboutPage);
  safe('bindChordFinderPage', bindChordFinderPage);
  safe('bindTrashPage', bindTrashPage);
  safe('applyLanguage', applyLanguage);
  safe('setupInstallPrompt', setupInstallPrompt);
  safe('initHistoryNav', initHistoryNav);
  safe('initSabbathMascot', initSabbathMascot);
  safe('initChristmasSnow', initChristmasSnow);
  safe('bindAccentDiscoEasterEgg', bindAccentDiscoEasterEgg);
  safe('initDevOptions', initDevOptions);
  safe('initWakeLock', initWakeLock);
  window.addEventListener('resize', renderAnnouncements);
  if (document.fonts) document.fonts.ready.then(renderAnnouncements);
  loadAnnouncements(); // Optional online content; never blocks startup.
  requestPersistentStorage(); // fire-and-forget; never block startup on this

  // Load the saved selection at startup. Unselected databases stay lazy
  // until selected or required by a playlist reference.
  await Promise.all([loadSelectedSongDatabases(), loadPlaylists(), loadUserSongs(), loadTrash(), loadPersonalLabels()]);
  // Sweep anything past its 30-day retention before the Trash Bin page (or
  // its Settings badge/count, if either ever reads trashSongs) can show it
  // — every app open gets a fresh, already-clean trash list rather than
  // the sweep happening lazily whenever the person next opens the page.
  // Repair old v4.2.41 playlist references before the 30-day purge. If an
  // old Trash entry has just expired, this still gets one last chance to
  // remove its stale Favorites/playlist references before the Trash record
  // itself is permanently swept away.
  await repairTrashedUserSongPlaylistRefs();
  await purgeExpiredTrash();
  safe('applyLanguage (post-load)', applyLanguage); // re-run so the results count reflects the loaded songs
  // Search stays lazy-correct either way, but warming immutable song text
  // during idle time keeps the person's first keystroke from having to
  // chord-strip/normalise thousands of lyric lines at once.
  safe('scheduleSearchCacheWarmup', scheduleSearchCacheWarmup);
  safe('scheduleFontWarmup', scheduleFontWarmup);
}

// Warm the self-hosted chord fonts during idle time so the first song
// does not wait for font loading. Both 500 and 600 are used by chord labels.
function scheduleFontWarmup() {
  if (!(document.fonts && document.fonts.load)) return;
  const warmFonts = () => {
    ['500 1em "IBM Plex Mono"', '600 1em "IBM Plex Mono"'].forEach((spec) => {
      document.fonts.load(spec).catch(() => {});
    });
  };
  const warm = warmFonts;
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(warm, { timeout: 1500 });
  } else {
    window.setTimeout(warm, 200);
  }
}

// Ask the browser not to automatically evict our Cache Storage / IndexedDB
// under storage pressure. This is a real, standard API — but it's worth
// being clear about what it does and doesn't cover: it protects against
// the browser's own automatic eviction, not against a user (or an OEM
// "phone manager" cleanup tool) explicitly clearing the app's storage —
// that's a stronger, OS-level action no web page can prevent.
async function requestPersistentStorage() {
  if (!(navigator.storage && navigator.storage.persist)) return;
  try {
    const already = await navigator.storage.persisted();
    if (already) return;
    const granted = await navigator.storage.persist();
    console.log('Songbook: persistent storage', granted ? 'granted' : 'not granted (browser declined)');
  } catch (err) {
    console.warn('Songbook: persistent storage request failed —', err);
  }
}/* @extracted:data.js:dbSourceLabel *//* @extracted:ui.js:updateDbRowSub */

/* @extracted:data.js:isSelectedDbSource */

/* @extracted:data.js:songbookSelectionKey */

/* @extracted:data.js:songSourceKey */

/* @extracted:data.js:songHasVisibleNumber */

/* @extracted:data.js:getSongbookSource */

/* @extracted:data.js:loadSelectedSongDatabases */

let songbookRenderFrame = 0;
/* @extracted:ui.js:scheduleSongbookRender */

/* @extracted:ui.js:appendSongbookLoadErrors *//* @extracted:data.js:songDataBaseUrl */

/* @extracted:data.js:fetchSongBundleSnapshot */

/* @extracted:data.js:fetchIndividualSongData *//* @extracted:data.js:mergePartialSongUpdate */

// ---------------------------------------------------------
// IndexedDB latest-local copy. Unlike database.json, this is rewritten after
// a successful/partial authoritative sync, so returning devices can render the
// newest library they have ever seen without waiting on the network.
// ---------------------------------------------------------
const SONGDB_NAME = 'songbook-db';
// Bumped 1 -> 2 to add 'user-songs', 2 -> 3 to add 'english-songs', then
// 3 -> 4 to add 'sda-songs', 4 -> 5 to add trash, and 5 -> 6 to add
// 'mongolian2-songs'. No schema change is needed for the bootstrap/sync
// architecture: each fetched source still stores one array under 'all-songs'.
const SONGDB_VERSION = SOURCE_REGISTRY.indexedDbVersion;
const SONGDB_STORES = SOURCE_REGISTRY.stores;

/* @extracted:data.js:openSongDb */

/* @extracted:data.js:saveSongsToIndexedDb */

/* @extracted:data.js:loadSongsFromIndexedDb */

// Thin, text-free progress line below the Songs search box. It only reflects
// the primary selected database's work. Pending collection loads also
// show it indeterminately; playlist-only source resolution stays quiet.
let songSyncFadeTimer = null;
/* @extracted:ui.js:setSongSyncProgress */

/* @extracted:ui.js:finishSongSyncProgress */

/* @extracted:ui.js:resetSongSyncProgress */

/* @extracted:data.js:isAbortError *//* @extracted:data.js:syncSongDataFromIndividuals */

/* @extracted:data.js:scheduleSongDataSync */

/* @extracted:data.js:loadSongDataFor */

// If the app started offline and later regains connectivity, give the selected
// database one chance to catch up automatically. No other database is touched.
window.addEventListener('online', () => {
  state.selectedDbSources.forEach(key => {
    const source = state.sources[key];
    if (!source) return;
    source.syncAttempted = false;
    if (source.loadFailed) {
      source.loaded = false;
      loadSongDataFor(key).then(scheduleSongbookRender).catch(() => {});
    } else if (source.loaded) {
      syncSongDataFromIndividuals(key).catch(() => {});
    }
  });
});

// ---------------------------------------------------------
// User Songs (v3): locally-authored/imported songs, stored on-device only
// — there's no server, so this store IS the song, not a cache of one.
// Reuses the same songbook-db database and its reserved 'user-songs'
// object store (see the comment above SONGDB_VERSION), but unlike the
// fetch-backup stores, each song is its own key (its `id`) rather than one
// combined 'all-songs' blob — so adding/editing/deleting one song is a
// single small write, not a read-modify-write of the entire list.
//
// state.sources.user.songs is the in-memory mirror renderSongList() etc.
// read from; every mutator below updates both IndexedDB and that array
// together so the UI never needs a separate reload to see its own change.
// ---------------------------------------------------------
const UserSongStorage = {
  async loadAll() {
    const db = await openSongDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(SONGDB_STORES.user, 'readonly');
        const store = tx.objectStore(SONGDB_STORES.user);
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  },
  async put(song) {
    const db = await openSongDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(SONGDB_STORES.user, 'readwrite');
        tx.objectStore(SONGDB_STORES.user).put(song, song.id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('User Song write aborted'));
      });
    } finally {
      db.close();
    }
  },
  // Full-replace import in one transaction. If clear() or any put() fails,
  // IndexedDB rolls the entire transaction back, leaving the old library
  // intact instead of committing a half-imported replacement.
  async replaceAll(songs) {
    const db = await openSongDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(SONGDB_STORES.user, 'readwrite');
        const store = tx.objectStore(SONGDB_STORES.user);
        try {
          store.clear();
          songs.forEach(song => store.put(song, song.id));
        } catch (err) {
          try { tx.abort(); } catch (_) {}
          reject(err);
          return;
        }
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('User Songs import aborted'));
      });
    } finally {
      db.close();
    }
  },
  // Moving between User Songs and Trash is one cross-store transaction, so
  // there is never a committed moment where the song exists in neither store.
  async moveToTrash(song, entry) {
    const db = await openSongDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction([SONGDB_STORES.user, SONGDB_STORES.trash], 'readwrite');
        try {
          tx.objectStore(SONGDB_STORES.trash).put(entry, entry.id);
          tx.objectStore(SONGDB_STORES.user).delete(song.id);
        } catch (err) {
          try { tx.abort(); } catch (_) {}
          reject(err);
          return;
        }
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Move to Trash aborted'));
      });
    } finally {
      db.close();
    }
  },
  // Exact inverse of moveToTrash(): restore the song and remove its Trash
  // copy together, or roll both operations back together on failure.
  async restoreFromTrash(song, trashId) {
    const db = await openSongDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction([SONGDB_STORES.user, SONGDB_STORES.trash], 'readwrite');
        try {
          tx.objectStore(SONGDB_STORES.user).put(song, song.id);
          tx.objectStore(SONGDB_STORES.trash).delete(trashId);
        } catch (err) {
          try { tx.abort(); } catch (_) {}
          reject(err);
          return;
        }
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Trash recovery aborted'));
      });
    } finally {
      db.close();
    }
  },
};

/* @extracted:data.js:genUserSongId *//* @extracted:data.js:sanitizeUserSongRecord */

/* @extracted:data.js:isPlainObject *//* @extracted:data.js:safeExternalHttpUrl */

/* @extracted:data.js:normalizeImportedUserSongs *//* @extracted:data.js:loadUserSongs *//* @extracted:data.js:saveUserSong *//* @extracted:data.js:deleteUserSong */

// ---------------------------------------------------------
// User Songs trash bin (v4.2): a deleted User Song moves here — its own
// object store (see SONGDB_STORES.trash) — instead of being wiped outright,
// and is hard-deleted automatically once it's been sitting for
// TRASH_RETENTION_DAYS. Same one-key-per-song access pattern as
// UserSongStorage above (each song is its own key, its `id`), plus one
// extra field this store actually needs: `deletedAt`, an epoch-ms
// timestamp stamped on the way in and read back by purgeExpiredTrash() to
// decide what's aged out.
//
// state.trashSongs is the in-memory mirror the Trash Bin page renders
// from, exactly the same relationship UserSongStorage has with
// state.sources.user.songs — every mutator below keeps IndexedDB and this
// array in lockstep so the UI never needs a separate reload to see its
// own change.
// ---------------------------------------------------------
const TRASH_RETENTION_DAYS = 30;
const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

const TrashStorage = {
  async loadAll() {
    const db = await openSongDb();
    const songs = await new Promise((resolve, reject) => {
      const tx = db.transaction(SONGDB_STORES.trash, 'readonly');
      const req = tx.objectStore(SONGDB_STORES.trash).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return songs;
  },
  // Updates Trash entries in one transaction. Used by the v4.2.42 repair
  // pass to attach the playlist memberships that older builds left behind
  // as dangling live references while the song was in Trash.
  async putMany(entries) {
    if (!entries.length) return;
    const db = await openSongDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(SONGDB_STORES.trash, 'readwrite');
      const store = tx.objectStore(SONGDB_STORES.trash);
      entries.forEach(entry => store.put(entry, entry.id));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Trash update aborted'));
    });
    db.close();
  },
  // Deletes several at once — used by the trash bin's multi-select "Delete"
  // action so an N-song bulk action is N IndexedDB deletes in one pass
  // through openSongDb() rather than N separate open/close round-trips.
  async removeMany(ids) {
    if (!ids.length) return;
    const db = await openSongDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(SONGDB_STORES.trash, 'readwrite');
      const store = tx.objectStore(SONGDB_STORES.trash);
      ids.forEach(id => store.delete(id));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  },
};/* @extracted:data.js:loadTrash *//* @extracted:data.js:restoreTrashedSong *//* @extracted:data.js:restoreTrashedSongs *//* @extracted:data.js:permanentlyDeleteTrashSongs *//* @extracted:data.js:purgeExpiredTrash */

// ---------------------------------------------------------
// Trash Bin page: its own list (sorted newest-deleted-first), a per-row
// "…" menu for Recover/Delete one at a time, and a select mode — mirroring
// playlistEditMode's shape (see setPlaylistEditMode() above) — for
// recovering or deleting several songs in one go. Reached from
// Settings → Songs → "Trash bin" (#trash-nav-row, see bindSettings()).
// ---------------------------------------------------------
let trashSelectMode = false;
let trashSelectedIds = new Set();
let trashKebabOpenId = null;/* @extracted:ui.js:bindTrashPage */

/* @extracted:ui.js:renderTrashList */

/* @extracted:ui.js:daysRemaining */

/* @extracted:ui.js:buildTrashRow */

/* @extracted:ui.js:toggleTrashSelected */

/* @extracted:ui.js:toggleTrashSelectAll *//* @extracted:ui.js:updateTrashSelectionUI */

/* @extracted:ui.js:setTrashSelectMode *//* @extracted:ui.js:toggleTrashRowMenu */

/* @extracted:ui.js:closeTrashRowMenu *//* @extracted:ui.js:confirmPermanentlyDeleteTrashSongs *//* @extracted:data.js:exportUserSongs */

/* @extracted:data.js:importUserSongsFromFile *//* @extracted:ui.js:reloadSongLibrary *//* @extracted:ui.js:reloadApp */

// ---------------------------------------------------------
// In-app back navigation: the hardware/gesture/browser back button should
// move within the app (song → list, settings → list) instead of leaving
// it, and only exit after a second back press at the root within a short
// window — the same "press back again to exit" pattern many apps use.
// ---------------------------------------------------------
let lastBackPressAt = 0;
const EXIT_CONFIRM_WINDOW_MS = 2000;

// Every history entry we push carries a monotonically increasing `seq`
// alongside its page data. popstate alone doesn't say whether the browser
// moved back or forward — only that the state changed — so comparing the
// incoming seq to the last one we saw is what lets showPage() tell a real
// "back to the list" from a "forward into a song" and pick the right slide
// direction (see pendingNavDirection / SLIDE_PAGES in showPage()).
let navSeq = 0;
let currentNavSeq = 0;
/* @extracted:ui.js:pushNavState */

// Set by the popstate handler right before it calls showPage/openSong/
// openPlaylist so showPage() knows whether this particular navigation is
// a back or a forward move — see the slide-transition logic in showPage().
// Direct in-app calls (tapping a song, tapping a playlist, a nav tab) never
// touch this, so it stays 'forward' for them, which is exactly right: those
// are always moving deeper into the app, never back out of it.
let pendingNavDirection = 'forward';

/* @extracted:ui.js:initHistoryNav *//* @extracted:ui.js:initSplash *//* @extracted:settings.js:refreshLangPicker */

/* @extracted:settings.js:loadPrefs */

/* @extracted:settings.js:applyFontSizes *//* @extracted:settings.js:applyChordStyle *//* @extracted:ui.js:positionSegToggleThumb */

/* @extracted:ui.js:updateAllSegToggleThumbs */

// A resize (rotation, desktop window resize, font-group rows wrapping
// differently) can change a seg-toggle-btn's own width without any
// aria-pressed change ever firing — nothing else above would notice, so
// this re-measures all of them directly. Debounced since 'resize' fires
// continuously while dragging; instant:true because a viewport resize
// isn't the person tapping a pill, so it shouldn't visibly slide.
let segToggleResizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(segToggleResizeTimer);
  segToggleResizeTimer = setTimeout(() => updateAllSegToggleThumbs({ instant: true }), 120);
});

// The very first positionSegToggleThumb() call (Settings opened before the
// person has tapped anything) can land before the real 'Inter' webfont has
// swapped in — offsetWidth at that moment reflects the fallback font's
// metrics, not Inter's, so the thumb can end up a few px off from the
// button it's meant to sit under. The container/button boxes themselves
// aren't affected (their width is plain CSS, so the browser keeps them in
// sync with whichever font is actually painted) — only this JS-measured,
// JS-set thumb width can go stale. document.fonts.ready resolves once
// every requested face has finished loading, so re-measuring then closes
// that gap; instant:true for the same reason as the resize handler above —
// this isn't the person tapping a pill, so it shouldn't visibly slide.
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => updateAllSegToggleThumbs({ instant: true })).catch(() => {});
}/* @extracted:settings.js:applyHideChords */

/* @extracted:settings.js:applyTextSizeVisibility *//* @extracted:settings.js:applyNoteNames *//* @extracted:settings.js:applyLyricsWeight *//* @extracted:settings.js:applyLyricsSpacing *//* @extracted:settings.js:applyLyricsWordSpacing *//* @extracted:settings.js:applySongListView *//* @extracted:settings.js:applyLandscapeMode *//* @extracted:settings.js:applyHideVerseNumbers *//* @extracted:ui.js:renderSongLoadingState */

let dbSelectionRevision = 0;
/* @extracted:data.js:applyDbSource */

/* @extracted:data.js:applyDbSelection *//* @extracted:settings.js:isSheetMusicProductionEnabled */

/* @extracted:settings.js:isSheetMusicFeatureEnabled */

/* @extracted:ui.js:ensureSheetMusicCatalog */

/* @extracted:ui.js:updateSongSheetMusicButton */

/* @extracted:ui.js:applySheetMusicFeatureUI */

/* @extracted:ui.js:bindSheetMusicPage */

/* @extracted:ui.js:renderSheetMusicLibrary */

/* @extracted:ui.js:openSheetMusicEntry */

/* @extracted:ui.js:renderSheetMusicViewer */

/* @extracted:ui.js:getActiveSheetMusicEntry */

/* @extracted:ui.js:syncSheetMusicPageFromScroll */

/* @extracted:ui.js:goToSheetMusicPage */

/* @extracted:ui.js:updateSheetMusicPageUI *//* @extracted:settings.js:unlockDevOptions */

/* @extracted:settings.js:bindDevOptionsUnlock *//* @extracted:settings.js:applyDevOptions */

/* @extracted:settings.js:initDevOptions *//* @extracted:settings.js:applyLanguage *//* @extracted:ui.js:bindNav */

/* @extracted:ui.js:showPage *//* @extracted:ui.js:prefersReducedMotion *//* @extracted:ui.js:cancelRowExit */

/* @extracted:ui.js:animateRowEnter */

/* @extracted:ui.js:animateRowExit *//* @extracted:ui.js:tapSongRowThenOpen *//* @extracted:ui.js:runPageSlideTransition *//* @extracted:ui.js:runTabFadeTransition *//* @extracted:ui.js:coalesceToNextFrame *//* @extracted:ui.js:bindSongsPage *//* @extracted:ui.js:bindUserSongsPage */

/* @extracted:ui.js:renderUserSongList *//* @extracted:song-engine.js:splitLyricSectionLabel *//* @extracted:song-engine.js:stripSongFormattingForSearch *//* @extracted:song-engine.js:normalizeSearchText */

/* @extracted:song-engine.js:compileSearchQuery */

// Search performance: the expensive, immutable parts of each song are
// prepared ONCE, but kept outside the song object in a WeakMap. Derived
// search state must never leak into User Song exports/IndexedDB or survive
// an import as stale metadata.
//
// Labels are deliberately NOT cached here. Personal labels can change while
// the same song object remains alive, and preset labels can display
// differently after a language switch.
const songSearchCache = new WeakMap();
/* @extracted:song-engine.js:getSearchCache *//* @extracted:song-engine.js:getSearchLabelData *//* @extracted:song-engine.js:evaluateSongSearch *//* @extracted:song-engine.js:matchesQuery */

/* @extracted:song-engine.js:relevanceRank */

// Opportunistically prepare immutable search data only for a database that
// is actually loaded/used. This keeps first-search latency low without
// quietly warming every other registered database in the background.
const searchCacheWarmSources = new Set();
/* @extracted:song-engine.js:scheduleSearchCacheWarmup *//* @extracted:song-engine.js:titleScriptRank *//* @extracted:song-engine.js:sortSongs *//* @extracted:song-engine.js:filterAndSortSongs */

/* @extracted:song-engine.js:highlight */

/* @extracted:ui.js:escapeHtml *//* @extracted:ui.js:visibleSongRowKeys */

/* @extracted:ui.js:renderSongList *//* @extracted:ui.js:onSongsPageEnter */

/* @extracted:ui.js:refreshSongScrollIndexMeasurements *//* @extracted:ui.js:scrollIndexLetter *//* @extracted:ui.js:computeScrollIndexEntries */

let scrollIndexEntries = [];
let scrollIndexIsNumeric = false;/* @extracted:ui.js:measureScrollIndexEntries *//* @extracted:ui.js:updateSongScrollIndex */

const SCROLL_INDEX_SEARCH_LABEL = '__search__';/* @extracted:ui.js:labelForScrollTop */

// ---- Squishy thumb physics --------------------------------------------
// A tiny damped spring layered on top of the thumb's ordinary position —
// which still tracks scroll 1:1 below, with no lag of its own — for a
// playful, fluid squash-and-stretch feel: a quick squeeze the instant you
// grab it (see the pointerdown handler in bindScrollIndexInteraction),
// and a stretch that grows the faster you scrub (see nudgeThumbSquish's
// call site in applyDrag), both settling back to normal on their own.
// thumbSquish is the current stretch amount (positive = taller/thinner,
// negative = shorter/wider, always conserving apparent volume across both
// axes); thumbSquishVelocity is its rate of change. Both only run via
// requestAnimationFrame while non-zero, so this costs nothing at rest.
let thumbTranslateY = 0;
let thumbSquish = 0;
let thumbSquishVelocity = 0;
let thumbSquishRAF = null;
let thumbSquishLastFrame = null;
const THUMB_SQUISH_STIFFNESS = 500; // spring constant — higher = snappier
const THUMB_SQUISH_DAMPING = 18;    // higher = settles faster, less wobble
const THUMB_SQUISH_MAX = 0.6;/* @extracted:ui.js:renderThumbTransform *//* @extracted:ui.js:stepThumbSquish *//* @extracted:ui.js:nudgeThumbSquish *//* @extracted:ui.js:updateScrollThumbPosition *//* @extracted:ui.js:setScrollIndexActive */

let scrollIndexIdleTimer = null;
let scrollIndexDragging = false;/* @extracted:ui.js:scheduleScrollIndexFade *//* @extracted:ui.js:bindScrollIndexInteraction *//* @extracted:ui.js:getSongListSubtitle */

/* @extracted:ui.js:buildSongRow */

const FAVORITE_BADGE_HEART = '<svg class="song-badge-heart" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35 10.55 20.03C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35Z"/></svg>';

/* @extracted:ui.js:updateSongRowContent */

/* @extracted:ui.js:refreshSongbookFavoriteMarkers *//* @extracted:ui.js:animateListRefresh *//* @extracted:ui.js:bindSongView *//* @extracted:ui.js:updateSongViewMenuUI */

let songViewMenuOpen = false;
/* @extracted:ui.js:toggleSongViewMenu */

/* @extracted:ui.js:openSongViewMenu */

/* @extracted:ui.js:closeSongViewMenu *//* @extracted:ui.js:toggleDisplayMode */
/* @extracted:ui.js:applyDisplayMode */
/* @extracted:ui.js:openPresentationMode *//* @extracted:ui.js:closePresentationMode */

/* @extracted:ui.js:updateFavoriteButtonUI *//* @extracted:ui.js:fixNativeAudioControlsPaint */

/* @extracted:ui.js:openSong */

/* @extracted:ui.js:updateTransposeUI */

/* @extracted:song-engine.js:transposeChord */

/* @extracted:song-engine.js:transposeSingle */

// containerId/song/transpose default to the real song-view page (its
// container id, state.activeSong, state.transpose) so every existing call
// site keeps working unchanged. The song editor's live preview (see
// renderEditorPreview()) overrides all three to render a draft song's
// lyrics — built from the same textarea the person is actively typing
// into, not yet saved anywhere — into its own #editor-preview container
// instead, through this exact same chord/lyric engine rather than a
// second, separate implementation that could drift out of sync with how
// a saved song actually renders.
// Matched inline markers are converted to text-only toggles before chords
// and words are split, so formatting may span a chord or several words.
const LYRIC_MD_ITALIC = '\uE100';
const LYRIC_MD_BOLD = '\uE101';
const LYRIC_MD_BOLD_ITALIC = '\uE102';

/* @extracted:song-engine.js:encodeLyricMarkdown */

/* @extracted:song-engine.js:appendFormattedLyricText */

/* @extracted:song-engine.js:renderLyrics *//* @extracted:ui.js:rememberSongChordViewer */

/* @extracted:ui.js:openChordFinderFromSong */

/* @extracted:ui.js:bindChordViewer *//* @extracted:song-engine.js:lyricsFragmentToPlainText */

/* @extracted:ui.js:bindLyricsCopy *//* @extracted:ui.js:bindSongEditor *//* @extracted:ui.js:openSongEditor *//* @extracted:ui.js:renderEditorPreview */

/* @extracted:ui.js:openEditorFormattingHelp */

/* @extracted:ui.js:saveSongFromEditor */

/* @extracted:ui.js:confirmDeleteUserSong *//* @extracted:data.js:createMirroredKeyValueStorage */

const PlaylistStorage = createMirroredKeyValueStorage({
  dbName: 'ngworship-playlists-db',
  key: 'playlists',
  localStorageKey: 'ngw-playlists',
  logName: 'playlist',
});

/* @extracted:data.js:genPlaylistId */

/* @extracted:data.js:normalizePlaylistData */

/* @extracted:data.js:loadPlaylists */

/* @extracted:data.js:reportSaveResult *//* @extracted:data.js:persistPlaylists *//* @extracted:data.js:exportPlaylists */

/* @extracted:data.js:importPlaylistsFromFile */

/* @extracted:data.js:getPlaylist */

/* @extracted:data.js:playlistDisplayName */

/* @extracted:data.js:findSongByRef */

/* @extracted:data.js:sourceHasSongNumbers */

/* @extracted:data.js:getUserSongPlaylistMemberships */

/* @extracted:data.js:removeUserSongFromAllPlaylists */

/* @extracted:data.js:restoreUserSongPlaylistMemberships *//* @extracted:data.js:repairTrashedUserSongPlaylistRefs */

/* @extracted:data.js:playlistSongCount */

/* @extracted:data.js:isSongInPlaylist */

/* @extracted:data.js:addSongToPlaylist */

/* @extracted:data.js:removeSongFromPlaylist */

/* @extracted:data.js:toggleSongInPlaylist */

/* @extracted:data.js:toggleFavorite */

/* @extracted:data.js:createPlaylist */

/* @extracted:data.js:renamePlaylist */

/* @extracted:data.js:deletePlaylist */

// ---------------------------------------------------------
// Labels — lets a person tag ANY song (official or their own) with a
// category for later filtering/browsing, without needing write access to
// the official (read-only) song databases. A song's *official* `labels`
// field (see README's "Song data structure") exists in the schema but is
// always empty today — nothing ships with built-in labels yet — so this
// is entirely a personal, on-device layer: stored separately, keyed by
// "sourceKey:songId", same IndexedDB-primary/localStorage-fallback
// pattern as PlaylistStorage above (see that block's comment for the
// reasoning). effectiveLabels() below merges the two, so if a future
// content update ever does ship built-in labels, they show up
// automatically alongside whatever's been personally added, with no
// changes needed here.
// ---------------------------------------------------------
const LabelStorage = createMirroredKeyValueStorage({
  dbName: 'ngworship-labels-db',
  key: 'labels',
  localStorageKey: 'ngw-labels',
  logName: 'labels',
});

/* @extracted:data.js:loadPersonalLabels *//* @extracted:data.js:persistPersonalLabels */

/* @extracted:data.js:songRefKey */

// A small set of common worship/church categories offered in the label
// picker alongside free-typed custom labels. The STORED value for a
// preset is always this stable, language-independent key (e.g.
// 'christmas'), never its translated display text (see labelDisplayText
// below) — so a song tagged from the picker under one interface language
// still matches when filtering under a different one.
const LABEL_PRESETS = [
  'christmas', 'easter', 'communion', 'baptism', 'wedding',
  'praise', 'worship', 'kids', 'choir', 'opening', 'closing',
];
const LABEL_PRESET_TRANSLATION_KEYS = {
  christmas: 'labelPresetChristmas',
  easter: 'labelPresetEaster',
  communion: 'labelPresetCommunion',
  baptism: 'labelPresetBaptism',
  wedding: 'labelPresetWedding',
  funeral: 'labelPresetFuneral',
  praise: 'labelPresetPraise',
  worship: 'labelPresetWorship',
  kids: 'labelPresetKids',
  choir: 'labelPresetChoir',
  opening: 'labelPresetOpening',
  closing: 'labelPresetClosing',
};/* @extracted:data.js:labelDisplayText *//* @extracted:data.js:effectiveLabels *//* @extracted:data.js:markSongListLabelsStale *//* @extracted:data.js:addPersonalLabel */
/* @extracted:data.js:removePersonalLabel *//* @extracted:data.js:setPersonalLabels *//* @extracted:data.js:allPersonalLabelValues *//* @extracted:data.js:matchesSongLabelFilter */

/* @extracted:ui.js:updateSongToolbarButtons *//* @extracted:ui.js:openSongSearchToolsModal *//* @extracted:ui.js:labelsInUse *//* @extracted:ui.js:bindPlaylistsPage *//* @extracted:ui.js:buildPlaylistRow *//* @extracted:ui.js:updatePlaylistRowContent *//* @extracted:ui.js:renderPlaylistsList *//* @extracted:ui.js:bindPlaylistView */

let playlistMenuOpen = false;
/* @extracted:ui.js:togglePlaylistMenu */

/* @extracted:ui.js:openPlaylistMenu */

/* @extracted:ui.js:closePlaylistMenu */

let playlistEditMode = false;
/* @extracted:ui.js:setPlaylistEditMode *//* @extracted:ui.js:showOrHidePillDone *//* @extracted:ui.js:renderPlaylistTitle */

/* @extracted:ui.js:commitPlaylistTitleEdit */

/* @extracted:ui.js:openPlaylist *//* @extracted:ui.js:renderPlaylistView */

// ---------------------------------------------------------
// Drag-to-reorder for the playlist-view list (edit mode only). Uses
// Pointer Events so it works with touch (phones) as well as mouse.
// ---------------------------------------------------------
let dragLi = null;
let dragStartY = 0;

/* @extracted:ui.js:onPlaylistDragStart *//* @extracted:ui.js:flipReorderedSiblings */

/* @extracted:ui.js:onPlaylistDragMove */

/* @extracted:ui.js:onPlaylistDragEnd */

/* @extracted:ui.js:commitPlaylistOrderFromDom *//* @extracted:ui.js:openModal */

/* @extracted:ui.js:restoreModalFocus */

/* @extracted:ui.js:closeModal */

/* @extracted:ui.js:bindModalShell *//* @extracted:ui.js:initViewportSync *//* @extracted:ui.js:focusModalInput *//* @extracted:ui.js:playlistNameForm */

/* @extracted:ui.js:promptCreatePlaylist */

/* @extracted:ui.js:confirmDeletePlaylist *//* @extracted:ui.js:openAddToPlaylistModal *//* @extracted:ui.js:openDbPickerModal *//* @extracted:ui.js:buildLabelEditor *//* @extracted:ui.js:renderSongViewLabels *//* @extracted:ui.js:openEditLabelsModal *//* @extracted:ui.js:songSourceFilePath */

/* @extracted:ui.js:buildInfoRow */

/* @extracted:ui.js:openSongInfoModal *//* @extracted:ui.js:animateWrapHeightTo */

/* @extracted:ui.js:openAddSongsModal *//* @extracted:ui.js:copyDiagnostics */

/* @extracted:ui.js:copyContactEmail *//* @extracted:ui.js:resetContactUI */

/* @extracted:ui.js:bindAboutPage */

/* @extracted:ui.js:bindChordFinderPage */

/* @extracted:settings.js:bindSettings *//* @extracted:ui.js:showToast */

// ---------------------------------------------------------
// Screen Wake Lock — keeps the display on while a song is actually open
// on screen (song-view), so it doesn't dim/lock mid-song the way it
// would browsing any other page. Released the instant the person leaves
// song-view for anything else (song list, a playlist, settings, ...) —
// there's no reason to hold the screen awake there.
// ---------------------------------------------------------
let wakeLockSentinel = null;
// Tracks whether song-view is the current page, independent of whether
// we actually hold the sentinel right now — the browser revokes the
// sentinel the moment the tab is backgrounded, but the person hasn't
// "left" song-view when that happens, so visibilitychange below needs
// this to know whether to ask for it back on return.
let wakeLockWanted = false;

function initWakeLock() {
  // Re-request on return to the tab/app: a wake lock is automatically
  // (and silently) released by the browser the moment the page is
  // backgrounded — switching apps, locking the phone by hand, the
  // screen timing out on its own first — so coming back to a song still
  // open needs to explicitly ask for it again rather than assuming the
  // original lock is still held.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && wakeLockWanted && !wakeLockSentinel) {
      requestWakeLock();
    }
    // Nothing to do on hide — the browser releases the sentinel itself
    // and fires its own 'release' listener (see requestWakeLock below).
  });
}

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return; // unsupported browser — screen just times out as normal, nothing else depends on this
  try {
    wakeLockSentinel = await navigator.wakeLock.request('screen');
    wakeLockSentinel.addEventListener('release', () => {
      // Covers both releaseWakeLock() below AND the browser revoking it
      // on its own (tab backgrounded) — either way our reference is now
      // stale, so clear it rather than risk a future .release() call on
      // an already-released sentinel.
      wakeLockSentinel = null;
    });
  } catch (err) {
    // Common, harmless causes: battery saver mode, the document isn't
    // visible at the exact moment of the request, or the platform just
    // doesn't grant it here — none worth surfacing to the person; the
    // screen simply behaves as it always did (times out normally).
    wakeLockSentinel = null;
  }
}

function releaseWakeLock() {
  if (!wakeLockSentinel) return;
  wakeLockSentinel.release().catch(() => {});
  wakeLockSentinel = null;
}

// Called from showPage() on every navigation — cheap no-op when nothing
// actually needs to change (e.g. moving between two non-song pages).
function updateWakeLock() {
  // Song view always (reading lyrics); Chord Finder only while in display mode, showing a
  // chord diagram to others, so the screen doesn't dim mid-demonstration.
  wakeLockWanted = state.currentPage === 'song-view'
    || (state.currentPage === 'chord-finder' && !!window.ChordFinder && window.ChordFinder.isDisplaying());
  if (wakeLockWanted) {
    if (!wakeLockSentinel && document.visibilityState === 'visible') requestWakeLock();
  } else {
    releaseWakeLock();
  }
}

// ---------------------------------------------------------
// PWA: install prompt (Android/Desktop) + iOS fallback
// ---------------------------------------------------------
let deferredPrompt = null;
let installState = 'unavailable'; // 'unavailable' | 'insecure' | 'ios' | 'promptable' | 'installed'

function isStandaloneNow() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function setupInstallPrompt() {
  if (isStandaloneNow()) {
    installState = 'installed';
    refreshInstallLabels();
    return;
  }

  // Install (and the underlying service worker) only work on HTTPS or localhost —
  // this is a browser security requirement, not something the app can work around.
  if (!window.isSecureContext) {
    installState = 'insecure';
    refreshInstallLabels();
    return;
  }

  // Modern iPadOS (13+) spoofs its user agent as a desktop Mac by default, so a
  // plain UA check misses iPads. We additionally detect that case: a "MacIntel"
  // platform that actually has touch support is an iPad, not a real Mac.
  const ua = window.navigator.userAgent;
  const isSpoofedIPad = window.navigator.platform === 'MacIntel'
    && navigator.maxTouchPoints > 1
    && !window.MSStream;
  const isIOS = /iphone|ipad|ipod/i.test(ua) || isSpoofedIPad;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installState = 'promptable';
    refreshInstallLabels();
  });

  document.getElementById('install-btn').addEventListener('click', async () => {
    if (deferredPrompt) {
      // The prompt is single-use: capture and clear it before awaiting, so a
      // stray second click can't reuse an already-consumed prompt event.
      const promptEvent = deferredPrompt;
      deferredPrompt = null;
      promptEvent.prompt();
      await promptEvent.userChoice;
      // Intentionally not branching on `outcome` here: accepting the native
      // dialog does not guarantee installation actually completed. The
      // `appinstalled` event (and isStandaloneNow() as a fallback) is the
      // only source of truth for "installed" — see the listener below.
      if (!isStandaloneNow()) {
        installState = 'unavailable';
        refreshInstallLabels();
      }
    } else if (isIOS) {
      showToast(t('toastIosHint'));
    }
  });

  installState = isIOS ? 'ios' : 'unavailable';
  refreshInstallLabels();

  window.addEventListener('appinstalled', () => {
    installState = 'installed';
    refreshInstallLabels();
  });
}

function refreshInstallLabels() {
  const installBtn = document.getElementById('install-btn');
  const installedBadge = document.getElementById('installed-badge');
  const installSub = document.getElementById('install-sub');
  const installTitle = document.getElementById('install-title');

  installTitle.textContent = t('installTitle');
  installBtn.textContent = t('installBtn');

  switch (installState) {
    case 'installed':
      installBtn.hidden = true;
      installedBadge.hidden = false;
      installedBadge.textContent = t('installedBadgeDone');
      installSub.textContent = t('installSubInstalled');
      break;
    case 'insecure':
      installBtn.hidden = true;
      installedBadge.hidden = true;
      installSub.textContent = t('installSubInsecure');
      break;
    case 'ios':
      installBtn.hidden = false;
      installedBadge.hidden = true;
      installSub.textContent = t('installSubIOS');
      break;
    case 'promptable':
      installBtn.hidden = false;
      installedBadge.hidden = true;
      installSub.textContent = t('installSub');
      break;
    default:
      installBtn.hidden = true;
      installedBadge.hidden = true;
      installSub.textContent = t('installSub');
  }
}

// ---------------------------------------------------------
// Service worker registration (offline-first)
// Requires HTTPS or localhost — browsers refuse to register
// service workers on plain http:// or file:// origins.
// ---------------------------------------------------------
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    console.warn('Songbook: service workers are not supported in this browser — offline mode and Install are unavailable.');
    return;
  }
  if (!window.isSecureContext) {
    console.warn('Songbook: not a secure context (HTTPS or localhost) — service worker registration skipped.');
    return;
  }

  // When an updated service worker takes over an already-open tab/PWA
  // window, the JS that's already parsed and running in memory here is
  // still the OLD version — only the *next* navigation gets the new files.
  // A single manual reload isn't reliably enough to trigger that either:
  // per the spec, a reload's navigation request can start (and still get
  // served by the outgoing worker) before the new one has fully taken
  // over. So instead of relying on the person to notice something's stale
  // and refresh, reload automatically — exactly once — the moment control
  // actually changes hands.
  //
  // Two things used to make this fire way more than that "exactly once":
  //
  // 1. `controllerchange` also fires the FIRST time a page ever gets a
  //    service worker (no previous controller to hand off from — this
  //    page was just loaded plain and a worker claimed it a moment
  //    later). There's nothing stale to fix in that case; the page in
  //    memory already matches what just got installed. hadController
  //    below distinguishes a real handoff from that harmless first claim.
  //
  // 2. Retain the session flag from older manual-reset implementations,
  //    so an update already in flight does not cause a duplicate reload.
  const hadController = !!navigator.serviceWorker.controller;
  let reloadedForUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadedForUpdate) return;
    reloadedForUpdate = true;
    if (!hadController) return;
    let skip = false;
    try {
      skip = sessionStorage.getItem('ngw_skip_next_auto_reload') === '1';
      sessionStorage.removeItem('ngw_skip_next_auto_reload');
    } catch (e) {
      // sessionStorage unavailable — fall through and reload as normal;
      // worst case here is the rare double-reload this was added to
      // prevent, not a stuck/stale app.
    }
    if (skip) return;
    markVersionSeen();
    window.location.reload();
  });

  // Register immediately; do not wait for window.load. Installed PWAs can be
  // launched again before every image/font has finished, and Chrome's own
  // generated offline screen is what appears when there is no controlling
  // worker available to answer that launch navigation. updateViaCache:none
  // also keeps update checks from reusing an HTTP-cached worker script.
  navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' }).then((reg) => {
    console.log('Songbook: service worker registered with scope', reg.scope);
  }).catch(err => {
    console.error('Songbook: service worker registration failed —', err);
  });
}/* @extracted:ui.js:isSabbathToday */

/* @extracted:ui.js:updateSabbathMascotText */

/* @extracted:ui.js:initSabbathMascot *//* @extracted:ui.js:isChristmasWeek */

/* @extracted:ui.js:initChristmasSnow */

// ---------------------------------------------------------
// Easter egg #2: tap "Accent color" in Settings 3 times to send the
// accent hues on a slow, continuous drift through the color wheel; tap
// 3 times again to stop. Only --accent/--accent-strong/--accent-tint
// drift — ink/paper/surface stay put, so the app stays readable.
// ---------------------------------------------------------

// Mirrors the values in css/style.css's html[data-accent="…"] rules —
// kept here (rather than read live off computed styles) so disco mode
// always starts from the *true* base color, even if it's re-triggered
// mid-animation.
const ACCENT_PALETTE = {
  periwinkle: { light: ['#5B7FDE', '#3A56AE', '#E4EAFB'], dark: ['#8CA6EE', '#C7D4F8', '#1E2A44'] },
  sage:       { light: ['#6FA37E', '#3F6350', '#E3EEE6'], dark: ['#8FC29E', '#C8E6D0', '#1C2E22'] },
  lavender:   { light: ['#8C7FCB', '#5B4FA8', '#EDEAFB'], dark: ['#B3A8E8', '#DCD5F5', '#241F3D'] },
  aqua:       { light: ['#44CAFD', '#0E86B8', '#E1F6FE'], dark: ['#6FDBFF', '#BEEFFF', '#113247'] },
  cinnamon:   { light: ['#A9762F', '#8C6526', '#F1E4C8'], dark: ['#D9A94B', '#E7BE6C', '#2C2618'] },
  red:        { light: ['#E8919E', '#B5586B', '#FBEBEE'], dark: ['#F0A3AF', '#FBD6DC', '#3A252A'] },
  peach:      { light: ['#E5A982', '#995B39', '#FBEDE3'], dark: ['#F0BE9C', '#F7D9C3', '#38271F'] },
};

/* @extracted:ui.js:hexToHsl */

/* @extracted:ui.js:hslToHex */

let discoModeActive = false;
let discoInterval = null;
let discoHue = 0;
// Tracks *why* disco mode is currently running — set when Developer
// options' "Force party mode on" switch turned it on, so turning that
// switch back off only stops it if it's still the reason disco mode is
// active. If the person separately 3-tapped "Accent color" (the original
// secret trigger) either before or after, that manual session is left
// alone — the dev switch never stops a session it didn't start. See
// applyDevOptions() and bindAccentDiscoEasterEgg() below for both sides
// of this handoff.
let discoForcedByDevToggle = false;

const DISCO_TICK_MS = 300;
const DISCO_PERIOD_SECONDS = 48;/* @extracted:ui.js:startDiscoMode */

/* @extracted:ui.js:stopDiscoMode */

/* @extracted:ui.js:bindAccentDiscoEasterEgg */

/* @extracted:ui.js:editorSnapshot */

/* @extracted:ui.js:editorHasChanges */

/* @extracted:data.js:loadAnnouncements */

/* @extracted:ui.js:renderAnnouncements */

/* @extracted:ui.js:buildAnnouncementContent */

/* @extracted:ui.js:openAnnouncementDialog */

/* @extracted:ui.js:previewAnnouncement */
