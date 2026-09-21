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

// Marks the version we're about to reload into as "already seen", so that
// when app.js re-executes after the reload, hardUpdateBackstop() below
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

// --- Version/update backstop -------------------------------------------------
// A previous version of this backstop tried to "self-heal" a stale install by
// unregistering every service worker and deleting every cache before reloading.
// That created a real offline hole: the installed PWA icon could remain while
// Chrome temporarily had no worker/app shell left to launch, which is exactly
// when Chrome falls back to its own generated "You're offline" PWA screen.
//
// Keep the backstop non-destructive instead. If fresh page code notices that
// the remembered version changed, simply mark it seen and nudge the existing
// registration to check for an update. Normal service-worker versioning and the
// controllerchange handler below do the actual handoff atomically, so the old
// worker/cache remain usable until the new one is ready. The explicit
// Settings -> Reload app action is still available when a person deliberately
// wants the destructive full reset while online.
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

// Song sources: each is an independent collection of songs — its own list,
// its own load-state, and (see SONGDB_STORES further down) its own offline
// backup store. Version 1 only ever populates and shows 'official'. The
// list/search/sort/song-view code below all takes a source key as a
// parameter rather than assuming 'official' is the only one, so a future
// 'user' source (v2's User Songs) can reuse it — add its loader, its own
// page, and a call site — without rewriting any of this.
const state = {
  sources: {
    official: { songs: [], loadFailed: false, loaded: false, loadPromise: null, syncPromise: null, syncAttempted: false, syncController: null },
    english: { songs: [], loadFailed: false, loaded: false, loadPromise: null, syncPromise: null, syncAttempted: false, syncController: null },
    sda: { songs: [], loadFailed: false, loaded: false, loadPromise: null, syncPromise: null, syncAttempted: false, syncController: null },
    mongolian2: { songs: [], loadFailed: false, loaded: false, loadPromise: null, syncPromise: null, syncAttempted: false, syncController: null },
    // User Songs (v3): not fetched from a manifest like official/english —
    // loaded from IndexedDB via UserSongStorage (see loadUserSongs()) —
    // but shaped identically otherwise, so every list/search/sort/song-view
    // function below works against it with no source-specific branches.
    user: { songs: [], loadFailed: false },
  },
  // Which entry in `sources` (and which folder under data/) the Songs
  // page, search, sort, and the playlist song-picker all currently browse.
  // Driven by Settings → Song database (see openDbPickerModal() and
  // 'sb-db' in bindSettings and DB_SOURCES below) — not the same thing as
  // activeSourceKey below, which instead remembers where an *already
  // open* song came from, since a person can switch databases while a
  // song from the other one is still open in the song view.
  activeDbSource: 'official',
  sortBy: 'num',       // 'alpha' | 'num'
  sortOrder: 'asc',     // 'asc' | 'desc'
  query: '',
  userSongQuery: '', // User Songs page's own search box — kept separate
                      // from `query` (the Songs page's) so switching tabs
                      // doesn't clobber whichever search the person was
                      // mid-typing on the other page.
  presentationMode: false, // toggled from the song view's "…" menu — see
                            // togglePresentationMode()/applyPresentationMode()
                            // below. Session-only (not persisted to
                            // localStorage/Settings): it's a "projecting
                            // right now" mode rather than a saved
                            // preference, so it starts back off on reload,
                            // and deliberately carries across songs within
                            // the session rather than resetting per-song —
                            // presenting is normally a whole-session thing,
                            // not a per-song one.
  personalLabels: { bySongRef: {} }, // see "Labels" section below; loaded
                                      // from storage by loadPersonalLabels()
  editorLabelsDraft: [], // Song Editor's held-until-Save label list — see
                          // openSongEditor()/saveSongFromEditor()
  activeSong: null,
  activeSourceKey: 'official', // which source the open song view came from
  editorSongId: null, // set while the editor is open for an EXISTING user
                       // song (its id); null means "New song" — see
                       // openSongEditor(). Read by saveSongFromEditor() to
                       // decide insert vs update.
  transpose: 0,
  lyricsSize: 1.05,   // rem
  chordSize: 0.82,    // rem
  chordStyle: 'chip', // 'chip' | 'text' — see applyChordStyle()
  hideChords: false,  // see applyHideChords()
  lyricsWeight: 'normal',  // 'normal' | 'semibold' | 'bold' — see applyLyricsWeight()
  lyricsSpacing: 'tight', // 'tight' | 'normal' | 'loose' — see applyLyricsSpacing()
  songListView: 'list', // 'list' | 'compact' | 'tiles' — see applySongListView(); only affects the Songbook's own list (#song-list)
  landscapeMode: false, // see applyLandscapeMode() — trims header/nav chrome to reclaim vertical space; only takes visual effect on a short, wide (phone-in-landscape) viewport, see the gated media query in style.css
  // Developer options → Display → "Hide verse numbers" — see
  // applyHideVerseNumbers(). Only hides the plain "1, 2, 3…" sequence
  // badge renderLyrics() adds per section (.lyric-section-index); a
  // section opening with an explicit label like "Bridge:"/"Гүүр:" renders
  // as .lyric-section-label instead and is NOT affected by this — see the
  // comment above sectionLabel in renderLyrics() for that split.
  hideVerseNumbers: false,
  lang: 'mn',
  currentPage: 'songs', // mirrors whichever page is currently visible (see showPage)
  playlists: { order: [], byId: {} }, // see "Playlists" section below
  activePlaylistId: null,
  trashSongs: [], // User Songs trash bin — loaded by loadTrash(); see the
                   // "User Songs trash bin" section further down
  trashQuery: '', // reserved for a future search box on the trash bin page,
                   // kept separate from query/userSongQuery for the same
                   // reason those two are kept apart from each other

  // ---- Developer options (see initDevOptions()) ----
  // The page itself is only reachable after tapping the About page's app
  // icon 3 times in a row (see bindDevOptionsUnlock()) — devUnlocked isn't
  // persisted, so the nav row to it is hidden again on every fresh load
  // and has to be re-unlocked, the same as the existing accent-color
  // easter egg.
  devUnlocked: false,
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
  devTradMongolian: false, // see refreshLangPicker()
  devCredits: false,       // see renderCredits()
  devHideDescriptions: false, // see applyDevOptions() — toggles .settings-desc-hideable
  // devVividGlass: OFF by default (the subtler frosted-white song header
  // glass). ON switches it to the more colorful accent-tinted variant —
  // see the html[data-vivid-glass] rule in css/style.css. Light mode
  // only; dark mode's song header glass doesn't change either way.
  devVividGlass: false,
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
  // rows on every return. onSongsPageEnter() only re-measures the existing
  // fast-scroll buckets once the hidden page is visible again (hidden-page
  // getBoundingClientRect() values collapse to zero). Actual list rebuilds
  // still happen when source/search/sort/view data changes.
  'songs':          { elId: 'page-songs',          navKey: 'songs',     rememberScroll: true, onEnter: () => onSongsPageEnter() },
  'song-view':      { elId: 'page-song-view',      navKey: 'songs',     rememberScroll: false, hideNav: true },
  'user-songs':     { elId: 'page-user-songs',      navKey: 'user-songs', rememberScroll: true, onEnter: () => renderUserSongList() },
  'song-editor':    { elId: 'page-song-editor',    navKey: 'user-songs', rememberScroll: false, hideNav: true },
  'playlists':      { elId: 'page-playlists',      navKey: 'playlists', rememberScroll: true,  onEnter: () => renderPlaylistsList() },
  'playlist-view':  { elId: 'page-playlist-view',  navKey: 'playlists', rememberScroll: false, hideNav: true },
  'settings':       { elId: 'page-settings',       navKey: 'settings',  rememberScroll: true,  onEnter: () => { resetContactUI(); updateAllSegToggleThumbs({ instant: true }); } },
  'about':          { elId: 'page-about',          navKey: 'settings',  rememberScroll: false, hideNav: true },
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
const SLIDE_PAGES = new Set(['song-view', 'playlist-view', 'about', 'trash', 'dev-options', 'song-editor']);

// The four bottom-nav tabs — sibling pages switched via .nav-btn taps
// rather than "opened on top of" one another, so they get the crossfade
// in runTabFadeTransition() below instead of SLIDE_PAGES' push/pop slide.
// See showPage()'s transitionType selection.
const TAB_PAGES = new Set(['songs', 'user-songs', 'playlists', 'settings']);

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
  // Full-color one-off (not part of the monochrome fill="currentColor" set
  // above) — the Saturday/Sabbath easter-egg mascot. See initSabbathMascot().
  'mascot-sabbath': 'icons/svg/mascot-sabbath.svg',
};

const iconFileCache = new Map();
function loadIconFile(path) {
  if (!iconFileCache.has(path)) {
    iconFileCache.set(path, fetch(path).then((res) => {
      if (!res.ok) throw new Error(`${path} responded ${res.status}`);
      return res.text();
    }));
  }
  return iconFileCache.get(path);
}

async function injectIcon(el) {
  const name = el.dataset.icon;
  const path = ICON_FILES[name];
  if (!path) return;
  try {
    const svgText = await loadIconFile(path);
    const src = new DOMParser().parseFromString(svgText, 'image/svg+xml').querySelector('svg');
    if (!src) throw new Error('no <svg> root found');
    // Adopt the file's own viewBox/attributes (so a replacement icon with
    // different proportions still renders correctly), but never touch
    // class/id — those belong to the placeholder markup, not the icon file.
    Array.from(src.attributes).forEach((attr) => {
      if (attr.name === 'class' || attr.name === 'id') return;
      el.setAttribute(attr.name, attr.value);
    });
    el.innerHTML = src.innerHTML;
  } catch (err) {
    console.warn(`Songbook: could not load icon "${name}" from ${path} —`, err);
  }
}

function initIcons(root = document) {
  return Promise.all(Array.from(root.querySelectorAll('[data-icon]')).map(injectIcon));
}

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

function renderSocialLinks() {
  const el = document.getElementById('about-social');
  if (!el) return;
  const social = (window.SONGBOOK_APP_CONFIG && window.SONGBOOK_APP_CONFIG.social) || {};
  el.innerHTML = Object.keys(SOCIAL_ICONS)
    .filter(key => social[key])
    .map(key => `<a href="${escapeHtml(social[key])}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(SOCIAL_ICONS[key].label)}"><svg data-icon="${SOCIAL_ICONS[key].icon}" viewBox="0 0 24 24"></svg></a>`)
    .join('');
  initIcons(el);
}

// Credits list on the About page — who's behind the app. Config-driven
// (see config.js's `creditsEnabled`/`credits`) so showing/hiding it, or
// adding/removing people, never needs a code change. creditsEnabled is a
// separate on/off switch from the list itself — flipping it off hides the
// section without losing the entries in `credits`, so turning it back on
// later doesn't mean re-typing everyone in. Developer options' own
// Credits toggle (state.devCredits) is a second, runtime way to turn it
// back on for preview purposes without editing config.js — either one
// being on is enough to show the section.
function renderCredits() {
  const section = document.getElementById('about-credits');
  const list = document.getElementById('about-credits-list');
  if (!section || !list) return;
  const config = window.SONGBOOK_APP_CONFIG || {};
  const credits = config.credits || [];
  if (!(config.creditsEnabled || state.devCredits) || !credits.length) {
    section.hidden = true;
    list.innerHTML = '';
    return;
  }
  section.hidden = false;
  list.innerHTML = credits.map(c => `
    <li class="about-credits-item">
      <span class="about-credits-role">${escapeHtml(c.role || '')}</span>
      <span class="about-credits-name">${escapeHtml(c.name || '')}</span>
    </li>`).join('');
}

function t(key, ...args) {
  const dict = (window.SONGBOOK_LANG && window.SONGBOOK_LANG[state.lang]) || {};
  const entry = dict[key];
  if (typeof entry === 'function') return entry(...args);
  return entry !== undefined ? entry : key;
}

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
  safe('bindLyricsCopy', bindLyricsCopy);
  safe('bindUserSongsPage', bindUserSongsPage);
  safe('bindSongEditor', bindSongEditor);
  safe('bindPlaylistsPage', bindPlaylistsPage);
  safe('bindPlaylistView', bindPlaylistView);
  safe('bindModalShell', bindModalShell);
  safe('bindSettings', bindSettings);
  safe('bindAboutPage', bindAboutPage);
  safe('bindTrashPage', bindTrashPage);
  safe('applyLanguage', applyLanguage);
  safe('setupInstallPrompt', setupInstallPrompt);
  safe('initHistoryNav', initHistoryNav);
  safe('initSabbathMascot', initSabbathMascot);
  safe('initChristmasSnow', initChristmasSnow);
  safe('bindAccentDiscoEasterEgg', bindAccentDiscoEasterEgg);
  safe('initDevOptions', initDevOptions);
  safe('initWakeLock', initWakeLock);
  requestPersistentStorage(); // fire-and-forget; never block startup on this

  // Only the selected official database is loaded at startup. Other
  // databases stay untouched until the person actually switches to them
  // (or opens a playlist that references one), which keeps startup fast
  // and avoids downloading thousands of songs the person may never use.
  await Promise.all([loadSongDataFor(state.activeDbSource), loadPlaylists(), loadUserSongs(), loadTrash(), loadPersonalLabels()]);
  // Sweep anything past its 30-day retention before the Trash Bin page (or
  // its Settings badge/count, if either ever reads trashSongs) can show it
  // — every app open gets a fresh, already-clean trash list rather than
  // the sweep happening lazily whenever the person next opens the page.
  safe('purgeExpiredTrash', () => purgeExpiredTrash());
  safe('applyLanguage (post-load)', applyLanguage); // re-run so the results count reflects the loaded songs
  // Search stays lazy-correct either way, but warming immutable song text
  // during idle time keeps the person's first keystroke from having to
  // chord-strip/normalise thousands of lyric lines at once.
  safe('scheduleSearchCacheWarmup', scheduleSearchCacheWarmup);
  safe('scheduleFontWarmup', scheduleFontWarmup);
}

// IBM Plex Mono (--font-mono) is used only for chords, which only appear
// once a song is actually open — so without this, the browser doesn't even
// start fetching that font file until the person's first song open, and
// that fetch (plus, before this fix, the opaque/uncached font-CSS request
// fixed in index.html/service-worker.js) is exactly the lag they'd see:
// fine on every song after the first, laggy again after a fresh app
// launch. document.fonts.load() here kicks that fetch off at idle time
// instead, while the person is still on the song list, so by the time they
// tap a song the font is very likely already in hand. Only the two weights
// actually requested in index.html's Google Fonts URL (500, 600) are
// warmed; no visible element or layout is touched.
function scheduleFontWarmup() {
  if (!(document.fonts && document.fonts.load)) return;
  const warm = () => {
    ['500 1em "IBM Plex Mono"', '600 1em "IBM Plex Mono"'].forEach((spec) => {
      document.fonts.load(spec).catch(() => {});
    });
  };
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
}

// ---------------------------------------------------------
// Song databases — each is its own folder under data/, with its own
// manifest.json listing that folder's song files. Registered here in one
// place (DB_SOURCES), which every list/search/sort/song-view function
// below reads a source's folder/hasNumbers from rather than assuming
// 'data/songs/' or that every song has a number — so none of THAT code
// needs to change for a new database. Adding one (the sda database is
// the worked example) does still touch a small, fixed set of spots
// elsewhere, each a small fixed addition:
//   1. A new folder + manifest.json + song files under data/. Optionally run
//      tools/build_song_bundles.py to create a fast bootstrap database.json.
//   2. One entry here in DB_SOURCES (folder + hasNumbers + group + label).
//   3. One entry in state.sources, above (just above this block).
//   4. One entry in SONGDB_STORES (the source's IndexedDB backup store),
//      further below — AND a SONGDB_VERSION bump so existing installs
//      create the new store in onupgradeneeded.
// That's it — no index.html edit needed. The Settings → Song database row
// opens the database-picker modal (see openDbPickerModal()), which reads
// DB_SOURCES itself and sorts each entry into its group's tab, so a new
// source just appears there once it's registered here. A brand-new group
// value picks up its own tab automatically too — see DB_GROUP_ORDER below.
//
// service-worker.js no longer needs a per-database registry: /data/
// requests are handled generically, and databases are cached only when
// app.js actually asks for them.
//
//   folder     — the data/ subfolder this source's songs and
//                manifest.json live in.
//   hasNumbers — false means this source's songs have no `number` field
//                (see the English database) — see applySongNumberUI() for
//                what that changes in the Songs page (hides "Sort by
//                number" and the number badges) once this source is the
//                active one.
//   group      — which tab of the database-picker modal this source is
//                sorted into. Any value works as long as it also has an
//                entry in DB_GROUP_ORDER/DB_GROUP_LABELS below; sources
//                sharing a group are listed together, in DB_SOURCES'
//                own key order, under that one tab.
//   label      — the fixed, never-translated display name shown for this
//                source in the picker (a proper name for that specific
//                songbook, e.g. "Монгол (ДАС)"). Use labelKey instead (see
//                'english' below) for the one case where the name itself
//                should follow the app's interface language.
//   labelKey   — a lang-file key (see lang/*.js) to look up via t() for a
//                display name that changes with the interface language,
//                instead of a fixed `label`.
// ---------------------------------------------------------
const DB_SOURCES = {
  official: { folder: 'mongolian', hasNumbers: true,  group: 'sda', label: 'Монгол (ДАС)' },
  english:  { folder: 'english',   hasNumbers: false, group: 'all', labelKey: 'dbOptionEnglish' },
  sda:      { folder: 'hymn',      hasNumbers: true,  group: 'sda', label: 'English (SDA)' },
  // Second Mongolian-language database ("Монгол" in the picker, no "(ДАС)"
  // qualifier since it isn't the ДАС songbook the 'official' source is).
  // Its source files have no `number` field, same situation as 'english'.
  mongolian2: { folder: 'mongolian2', hasNumbers: false, group: 'all', label: 'Монгол' },
};

// Tabs for the database-picker modal (see openDbPickerModal()), in display
// order — 'sda' for the denomination's own official songbooks, 'all' for
// every other database. A new group only needs an entry here (order) and
// in DB_GROUP_LABELS (its tab's label) — every DB_SOURCES entry tagged with
// that group value then shows up under it automatically.
const DB_GROUP_ORDER = ['sda', 'all'];
const DB_GROUP_LABELS = { sda: 'dbGroupSda', all: 'dbGroupAll' };

// The display name for a DB_SOURCES entry — its fixed `label`, or t() of
// its `labelKey` when the name itself should follow the interface
// language (see 'english' in DB_SOURCES above).
function dbSourceLabel(sourceKey) {
  const src = DB_SOURCES[sourceKey];
  if (!src) return '';
  return src.labelKey ? t(src.labelKey) : (src.label || sourceKey);
}

// Keeps the Settings → Song database row's subtitle showing the *current*
// database's name (rather than a static instructional line) so the active
// choice is visible at a glance without opening the picker — see
// openDbPickerModal(). Called from applyDbSource() (selection changed) and
// applyLanguage() (the 'english' source's name is language-dependent).
function updateDbRowSub() {
  const el = document.getElementById('t-dbSub');
  if (el) el.textContent = dbSourceLabel(state.activeDbSource);
}

// One JSON file per song remains the editable/latest source of truth, listed
// in <folder>/manifest.json. database.json is intentionally only a fast
// bootstrap snapshot: it lets a first-time device show a complete library in
// one request, but it does NOT need to be regenerated every time one song is
// corrected. After the bootstrap is visible, the selected database quietly
// refreshes from the individual files in bounded batches and saves the merged
// latest result to IndexedDB for the next launch.
//
// Startup priority therefore is:
//   1. IndexedDB latest merged copy (instant on returning devices)
//   2. database.json bootstrap snapshot (one request on a first load)
//   3. individual files as a last-resort bootstrap if both above are absent
// Then, while online, the individual files are fetched in the background and
// become authoritative. Only the currently selected database gets that
// background sync; other databases stay untouched until selected.
// ---------------------------------------------------------

function songDataBaseUrl(sourceKey) {
  const dbSource = DB_SOURCES[sourceKey];
  if (!dbSource) throw new Error(`unknown song source "${sourceKey}"`);
  return `data/${dbSource.folder}`;
}

async function fetchSongBundleSnapshot(sourceKey, { forceRefresh = false, signal } = {}) {
  const base = songDataBaseUrl(sourceKey);
  const headers = forceRefresh ? { 'X-Force-Refresh': '1' } : {};
  // Versioned URL means a newly deployed app can ship a refreshed snapshot,
  // while an older snapshot can still remain perfectly useful as a bootstrap
  // between releases. The service worker treats this as cache-first.
  const url = `${base}/database.json?v=${encodeURIComponent(SONGBOOK_VERSION_NUMBER)}`;
  const res = await fetch(url, {
    headers,
    signal,
    cache: forceRefresh ? 'reload' : 'default',
  });
  if (!res.ok) throw new Error(`database.json responded ${res.status}`);
  const payload = await res.json();
  const songs = Array.isArray(payload)
    ? payload
    : payload && Array.isArray(payload.songs) ? payload.songs : null;
  if (!songs) throw new Error('database.json did not contain a song array');
  if (payload && !Array.isArray(payload) && Number.isFinite(payload.count) && payload.count !== songs.length) {
    throw new Error(`database.json count mismatch (${payload.count} declared, ${songs.length} loaded)`);
  }
  return songs;
}

async function fetchIndividualSongData(sourceKey, {
  forceRefresh = false,
  signal,
  onProgress,
} = {}) {
  const base = songDataBaseUrl(sourceKey);
  const headers = forceRefresh ? { 'X-Force-Refresh': '1' } : {};
  const fetchOptions = {
    headers,
    signal,
    // These are the authoritative/latest files. Ask HTTP caches to validate
    // them rather than accepting a fresh-but-old browser cache entry forever.
    cache: forceRefresh ? 'reload' : 'no-cache',
  };

  const manifestRes = await fetch(`${base}/manifest.json`, fetchOptions);
  if (!manifestRes.ok) throw new Error(`manifest.json responded ${manifestRes.status}`);
  const files = await manifestRes.json();
  if (!Array.isArray(files)) throw new Error('manifest.json did not contain a file list');

  const SONG_FETCH_BATCH_SIZE = 16;
  const successful = [];
  const failed = [];
  let completed = 0;
  if (onProgress) onProgress(0, files.length);

  for (let i = 0; i < files.length; i += SONG_FETCH_BATCH_SIZE) {
    if (signal && signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const batch = files.slice(i, i + SONG_FETCH_BATCH_SIZE);
    const settled = await Promise.allSettled(batch.map(async (file) => {
      let lastErr = null;
      try {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const res = await fetch(`${base}/${file}`, fetchOptions);
            if (!res.ok) throw new Error(`${file} responded ${res.status}`);
            const song = await res.json();
            return { file, song };
          } catch (err) {
            lastErr = err;
            if (err && err.name === 'AbortError') throw err;
            if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 60));
          }
        }
        throw lastErr;
      } finally {
        completed += 1;
        if (onProgress) onProgress(completed, files.length);
      }
    }));

    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') successful.push(result.value);
      else failed.push({ file: batch[index], error: result.reason });
    });

    // Cached responses can make a whole batch resolve nearly instantly. Give
    // input/scroll/paint work one event-loop turn between batches so a large
    // 1,000+ song sync stays background work instead of monopolizing a frame.
    if (i + SONG_FETCH_BATCH_SIZE < files.length) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  if (successful.length === 0 && files.length > 0) {
    throw new Error('all song files failed to load');
  }
  if (failed.length) {
    console.warn(
      `Songbook: ${failed.length} of ${files.length} authoritative song file(s) failed to load —`,
      failed.map(item => item.error && item.error.message ? item.error.message : item.error)
    );
  }

  return {
    songs: successful.map(item => item.song),
    files,
    successfulFiles: successful.map(item => item.file),
    hadFailures: failed.length > 0,
  };
}

// If an individual-file sync is partial, never shrink a previously usable
// library just because a few requests failed. Successful individual files
// overwrite the same IDs in the bootstrap/local copy and brand-new songs are
// appended; old entries are only removed when a complete authoritative sync
// succeeds, because only then do we know a missing manifest entry is a real
// deletion rather than a network failure.
function mergePartialSongUpdate(baseSongs, updatedSongs) {
  const result = Array.isArray(baseSongs) ? baseSongs.slice() : [];
  const indexById = new Map();
  result.forEach((song, index) => {
    if (song && song.id != null) indexById.set(String(song.id), index);
  });
  updatedSongs.forEach((song) => {
    if (!song || song.id == null) return;
    const key = String(song.id);
    if (indexById.has(key)) result[indexById.get(key)] = song;
    else {
      indexById.set(key, result.length);
      result.push(song);
    }
  });
  return result;
}

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
const SONGDB_VERSION = 6;
const SONGDB_STORES = {
  official: 'songs',
  english: 'english-songs',
  sda: 'sda-songs',
  mongolian2: 'mongolian2-songs',
  user: 'user-songs',
  trash: 'user-songs-trash',
};

function openSongDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(SONGDB_NAME, SONGDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      Object.values(SONGDB_STORES).forEach((storeName) => {
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
      });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveSongsToIndexedDb(sourceKey, songs) {
  const storeName = SONGDB_STORES[sourceKey];
  if (!storeName) return;
  try {
    const db = await openSongDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(songs, 'all-songs');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn(`Songbook: could not save "${sourceKey}" songs to IndexedDB —`, err);
  }
}

async function loadSongsFromIndexedDb(sourceKey) {
  const storeName = SONGDB_STORES[sourceKey];
  if (!storeName) return null;
  const db = await openSongDb();
  const songs = await new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).get('all-songs');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return songs;
}

// Thin, text-free progress line below the Songs search box. It only reflects
// the selected database's work; background/bootstrap loads done solely to
// resolve another database referenced by a playlist do not surface UI here.
let songSyncFadeTimer = null;
function setSongSyncProgress(sourceKey, completed, total, { indeterminate = false } = {}) {
  if (sourceKey !== state.activeDbSource) return;
  const track = document.getElementById('song-sync-progress');
  const bar = document.getElementById('song-sync-progress-bar');
  if (!track || !bar) return;
  if (songSyncFadeTimer) {
    clearTimeout(songSyncFadeTimer);
    songSyncFadeTimer = null;
  }
  track.classList.add('is-active');
  track.classList.toggle('is-indeterminate', indeterminate);
  if (!indeterminate) {
    const ratio = total > 0 ? Math.max(0, Math.min(1, completed / total)) : 0;
    bar.style.transform = `scaleX(${ratio})`;
  }
}

function finishSongSyncProgress(sourceKey) {
  if (sourceKey !== state.activeDbSource) return;
  const track = document.getElementById('song-sync-progress');
  const bar = document.getElementById('song-sync-progress-bar');
  if (!track || !bar) return;
  track.classList.remove('is-indeterminate');
  bar.style.transform = 'scaleX(1)';
  songSyncFadeTimer = setTimeout(() => {
    track.classList.remove('is-active');
    songSyncFadeTimer = setTimeout(() => {
      bar.style.transform = 'scaleX(0)';
      songSyncFadeTimer = null;
    }, 300);
  }, 150);
}

function resetSongSyncProgress(sourceKey) {
  if (sourceKey !== state.activeDbSource) return;
  const track = document.getElementById('song-sync-progress');
  const bar = document.getElementById('song-sync-progress-bar');
  if (!track || !bar) return;
  if (songSyncFadeTimer) clearTimeout(songSyncFadeTimer);
  songSyncFadeTimer = null;
  track.classList.remove('is-active', 'is-indeterminate');
  bar.style.transform = 'scaleX(0)';
}

function isAbortError(err) {
  return !!(err && err.name === 'AbortError');
}

// Fetch the latest individual files for the selected database without
// blocking its already-visible bootstrap/local copy. One sync attempt per
// source per session is enough; switching away aborts the old source so the
// app never keeps downloading a database that is no longer selected.
async function syncSongDataFromIndividuals(sourceKey, { forceRefresh = false, manual = false } = {}) {
  const source = state.sources[sourceKey];
  if (!source || !DB_SOURCES[sourceKey]) return Promise.resolve(null);
  if (!manual && source.syncAttempted) return source.songs;
  if (source.syncPromise) {
    const oldSyncWasAborted = !!(source.syncController && source.syncController.signal.aborted);
    if (!manual && !oldSyncWasAborted) return source.syncPromise;
    // A person explicitly requested Refresh, or this source was selected
    // again while its previous pass was still unwinding from an abort. Wait
    // for that cleanup before starting another 1,000+ file sweep.
    if (manual && source.syncController && !source.syncController.signal.aborted) {
      try { source.syncController.abort(); } catch (e) {}
    }
    try { await source.syncPromise; } catch (e) {}
  }
  if (!manual && sourceKey !== state.activeDbSource) return source.songs;
  if (!navigator.onLine && !manual) return source.songs;

  // Abort a different selected database that may still be downloading.
  Object.entries(state.sources).forEach(([key, other]) => {
    if (key !== sourceKey && other && other.syncController) {
      try { other.syncController.abort(); } catch (e) {}
      // Let that promise clear its own controller/promise in finally; clearing
      // them here would allow a second sync to overlap before the abort has
      // actually unwound.
      other.syncAttempted = false;
    }
  });

  const controller = new AbortController();
  source.syncController = controller;
  setSongSyncProgress(sourceKey, 0, 0, { indeterminate: true });

  source.syncPromise = (async () => {
    try {
      const result = await fetchIndividualSongData(sourceKey, {
        forceRefresh,
        signal: controller.signal,
        onProgress: (completed, total) => {
          setSongSyncProgress(sourceKey, completed, total, { indeterminate: total <= 0 });
        },
      });

      const nextSongs = result.hadFailures
        ? mergePartialSongUpdate(source.songs, result.songs)
        : result.songs;

      source.songs = nextSongs;
      source.loadFailed = false;
      source.loaded = true;
      source.syncAttempted = true;
      await saveSongsToIndexedDb(sourceKey, nextSongs);

      // Update the visible Songs list once at the END, not after each file,
      // so a background sync never makes rows jump around while the person
      // is reading/searching. Preserve current query/sort state.
      searchCacheWarmSources.delete(sourceKey);
      if (state.activeDbSource === sourceKey && state.currentPage === 'songs') {
        renderSongList();
        scheduleSearchCacheWarmup(sourceKey);
      } else if (state.activeDbSource === sourceKey) {
        // The list is hidden (song view/settings/etc.). Mark its DOM snapshot
        // stale so onSongsPageEnter() rebuilds it once when the person comes
        // back instead of displaying the pre-sync rows indefinitely.
        const listEl = document.getElementById('song-list');
        if (listEl) listEl.dataset.renderSourceKey = '';
      }
      finishSongSyncProgress(sourceKey);
      return nextSongs;
    } catch (err) {
      if (!isAbortError(err)) {
        console.warn(`Songbook: latest individual-file sync failed for "${sourceKey}" —`, err);
        // Avoid hammering the same broken connection on every page revisit.
        // A manual Refresh can always retry; an offline->online transition
        // resets this below when the browser actually reports connectivity.
        source.syncAttempted = true;
        finishSongSyncProgress(sourceKey);
      } else {
        resetSongSyncProgress(sourceKey);
      }
      if (manual && !isAbortError(err)) throw err;
      return source.songs;
    } finally {
      if (source.syncController === controller) {
        source.syncController = null;
        source.syncPromise = null;
      }
    }
  })();

  return source.syncPromise;
}

function scheduleSongDataSync(sourceKey) {
  const start = () => {
    if (state.activeDbSource !== sourceKey) return;
    syncSongDataFromIndividuals(sourceKey);
  };
  // Let the bootstrap/local list paint first; the authoritative sweep is
  // intentionally background work and should never compete with first paint.
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => setTimeout(start, 0));
  } else {
    setTimeout(start, 0);
  }
}

async function loadSongDataFor(sourceKey, { syncLatest } = {}) {
  const source = state.sources[sourceKey];
  if (!source || !DB_SOURCES[sourceKey]) throw new Error(`unknown song source "${sourceKey}"`);
  const shouldSync = syncLatest !== undefined ? syncLatest : sourceKey === state.activeDbSource;

  if (source.loaded) {
    if (shouldSync) scheduleSongDataSync(sourceKey);
    return source.songs;
  }
  if (source.loadPromise) {
    const songs = await source.loadPromise;
    if (shouldSync) scheduleSongDataSync(sourceKey);
    return songs;
  }

  source.loadPromise = (async () => {
    // Returning device: the merged IndexedDB copy is normally the newest and
    // requires no network at all, so prefer it over the release snapshot.
    try {
      const localSongs = await loadSongsFromIndexedDb(sourceKey);
      if (Array.isArray(localSongs) && localSongs.length) {
        source.songs = localSongs;
        source.loadFailed = false;
        source.loaded = true;
        return source.songs;
      }
    } catch (err) {
      console.warn(`Songbook: no IndexedDB bootstrap available for "${sourceKey}" —`, err);
    }

    // First-time/recovered device: one-request snapshot so the UI can become
    // usable quickly before thousands of authoritative files are checked.
    try {
      if (sourceKey === state.activeDbSource) setSongSyncProgress(sourceKey, 0, 0, { indeterminate: true });
      const snapshot = await fetchSongBundleSnapshot(sourceKey);
      source.songs = snapshot;
      source.loadFailed = false;
      source.loaded = true;
      // Keep storage writes ordered: the background authoritative sync only
      // starts after this bootstrap promise resolves, so this older snapshot
      // can never finish writing *after* a newer individual-file result.
      await saveSongsToIndexedDb(sourceKey, snapshot);
      return source.songs;
    } catch (bundleErr) {
      console.warn(`Songbook: database.json bootstrap failed for "${sourceKey}"; trying individual files —`, bundleErr);
    }

    // Last-resort first load: if neither local nor database.json is usable,
    // the individual source files can still construct the app database.
    try {
      const result = await fetchIndividualSongData(sourceKey, {
        onProgress: (completed, total) => {
          if (sourceKey === state.activeDbSource) setSongSyncProgress(sourceKey, completed, total, { indeterminate: total <= 0 });
        },
      });
      source.songs = result.songs;
      source.loadFailed = false;
      source.loaded = true;
      source.syncAttempted = !result.hadFailures;
      await saveSongsToIndexedDb(sourceKey, source.songs);
      finishSongSyncProgress(sourceKey);
      return source.songs;
    } catch (err) {
      console.error(`Songbook: failed to bootstrap "${sourceKey}" song data —`, err);
      source.songs = [];
      source.loadFailed = true;
      source.loaded = true;
      resetSongSyncProgress(sourceKey);
      return source.songs;
    }
  })();

  try {
    const songs = await source.loadPromise;
    // Once bootstrap is visible, authoritative sync is deliberately detached
    // from this promise so startup/navigation never waits for it.
    if (shouldSync && source.loaded && !source.loadFailed && !source.syncAttempted) {
      if (navigator.onLine) scheduleSongDataSync(sourceKey);
      else finishSongSyncProgress(sourceKey);
    }
    return songs;
  } finally {
    source.loadPromise = null;
  }
}

// If the app started offline and later regains connectivity, give the selected
// database one chance to catch up automatically. No other database is touched.
window.addEventListener('online', () => {
  const source = state.sources[state.activeDbSource];
  if (source && source.loaded) {
    source.syncAttempted = false;
    syncSongDataFromIndividuals(state.activeDbSource);
  }
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
  async _store(mode) {
    const db = await openSongDb();
    return db.transaction(SONGDB_STORES.user, mode).objectStore(SONGDB_STORES.user);
  },
  async loadAll() {
    const db = await openSongDb();
    const songs = await new Promise((resolve, reject) => {
      const tx = db.transaction(SONGDB_STORES.user, 'readonly');
      const store = tx.objectStore(SONGDB_STORES.user);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return songs;
  },
  async put(song) {
    const db = await openSongDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(SONGDB_STORES.user, 'readwrite');
      tx.objectStore(SONGDB_STORES.user).put(song, song.id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  },
  async remove(id) {
    const db = await openSongDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(SONGDB_STORES.user, 'readwrite');
      tx.objectStore(SONGDB_STORES.user).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  },
  // Wipes every song out of the store — used by importUserSongsFromFile()
  // below to clear out pre-import songs before writing the imported list,
  // since (unlike PlaylistStorage's single blob) User Songs are one key
  // per song and a stale leftover key wouldn't just be overwritten.
  async clear() {
    const db = await openSongDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(SONGDB_STORES.user, 'readwrite');
      tx.objectStore(SONGDB_STORES.user).clear();
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  },
};

function genUserSongId() {
  return 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Older builds stored a derived __searchCache directly on song objects.
// Strip it whenever User Songs cross a persistence/export boundary so that
// implementation detail can never leak into backups or be re-imported as
// stale data. New builds use a WeakMap for search caches, so this is mainly
// cleanup for existing installs/files created by an older version.
function sanitizeUserSongRecord(song) {
  if (song && typeof song === 'object' && Object.prototype.hasOwnProperty.call(song, '__searchCache')) {
    delete song.__searchCache;
  }
  return song;
}

// Loaded once at startup (see init()) alongside the selected database/
// loadPlaylists() — a failure here just leaves User Songs empty (with
// state.sources.user.loadFailed set so renderSongList() shows the same
// "couldn't load" row it already knows how to show for official/English),
// never blocks the rest of the app from starting.
async function loadUserSongs() {
  try {
    const loaded = await UserSongStorage.loadAll();
    let cleanedLegacyCache = false;
    loaded.forEach(song => {
      if (song && Object.prototype.hasOwnProperty.call(song, '__searchCache')) cleanedLegacyCache = true;
      sanitizeUserSongRecord(song);
    });
    state.sources.user.songs = loaded;
    state.sources.user.loadFailed = false;
    state.sources.user.loaded = true;
    // Clean old persisted records once, without making startup wait on it.
    if (cleanedLegacyCache) loaded.forEach(song => UserSongStorage.put(song).catch(() => {}));
  } catch (err) {
    console.error('Songbook: failed to load user songs from IndexedDB —', err);
    state.sources.user.songs = [];
    state.sources.user.loadFailed = true;
    state.sources.user.loaded = true;
  }
}

// Inserts or updates one song (id decides which — an id already present in
// state.sources.user.songs is an update, otherwise it's an insert) in both
// IndexedDB and the in-memory list, keeping them in lockstep.
async function saveUserSong(song) {
  sanitizeUserSongRecord(song);
  const list = state.sources.user.songs;
  const idx = list.findIndex(s => s.id === song.id);
  if (idx === -1) list.push(song);
  else list[idx] = song;
  await UserSongStorage.put(song);
}

// Moves a User Song to the trash instead of wiping it outright — see the
// "User Songs trash bin" section below for TrashStorage/purgeExpiredTrash/
// restoreTrashedSong, which is where the rest of the trash lifecycle lives.
// Kept as its own function (rather than folding into trashUserSong) so
// every existing call site (song-view kebab, editor, confirmDeleteUserSong)
// keeps working unchanged — "delete" now means "move to trash" everywhere
// in the app; a separate, explicit action inside the trash bin itself is
// what actually removes a song for good (see permanentlyDeleteTrashSongs).
async function deleteUserSong(id) {
  const song = state.sources.user.songs.find(s => s.id === id);
  state.sources.user.songs = state.sources.user.songs.filter(s => s.id !== id);
  await UserSongStorage.remove(id);
  // A song can be referenced from playlists/Favorites by {sourceKey:
  // 'user', songId} — same reasoning as official songs (playlists never
  // duplicate song data, only ids), so deleting the song here doesn't
  // touch playlists directly. findSongByRef() simply stops resolving it,
  // and renderPlaylistView()/renderPlaylistsList() already tolerate a ref
  // that no longer resolves to a song (see their own null-checks) — same
  // as if an official song were ever removed from a manifest. The same is
  // true once a song lands in the trash: it's still gone from every
  // playlist's point of view until (if ever) it's recovered.
  if (song) await trashUserSong(song);
}

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
  async put(entry) {
    const db = await openSongDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(SONGDB_STORES.trash, 'readwrite');
      tx.objectStore(SONGDB_STORES.trash).put(entry, entry.id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  },
  async remove(id) {
    const db = await openSongDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(SONGDB_STORES.trash, 'readwrite');
      tx.objectStore(SONGDB_STORES.trash).delete(id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
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
};

// Loaded once at startup (see init()) alongside loadUserSongs() — a
// failure here just leaves the trash bin empty for this session (nothing
// else in the app depends on trash having loaded), same fail-soft
// treatment as loadUserSongs() itself.
async function loadTrash() {
  try {
    state.trashSongs = await TrashStorage.loadAll();
  } catch (err) {
    console.error('Songbook: failed to load trash from IndexedDB —', err);
    state.trashSongs = [];
  }
}

// Moves one song into the trash: stamps it with deletedAt and writes it to
// the trash store. Called from deleteUserSong() above — the one and only
// place a User Song is ever removed from state.sources.user.songs — so
// every existing delete entry point (song-view kebab, the editor's delete
// confirm) already routes through here with no changes needed at those
// call sites.
async function trashUserSong(song) {
  const entry = { ...song, deletedAt: Date.now() };
  state.trashSongs.push(entry);
  await TrashStorage.put(entry);
}

// Restores one trashed song back into User Songs — the inverse of
// trashUserSong(). deletedAt is simply dropped rather than carried into
// state.sources.user.songs, since saveUserSong()/UserSongStorage never
// expect that field and a stale one left over from a previous trash trip
// would otherwise leak back out through exportUserSongs().
async function restoreTrashedSong(id) {
  const entry = state.trashSongs.find(s => s.id === id);
  if (!entry) return;
  state.trashSongs = state.trashSongs.filter(s => s.id !== id);
  const { deletedAt, ...song } = entry;
  await saveUserSong(song);
  await TrashStorage.remove(id);
}

// Restores several trashed songs at once — the trash bin's multi-select
// "Recover" action. Sequential (not Promise.all) so a mid-batch IndexedDB
// hiccup can't leave User Songs and the trash store disagreeing about
// which songs made it across; a failure here still leaves whatever
// completed before it fully recovered rather than none of it.
async function restoreTrashedSongs(ids) {
  for (const id of ids) {
    await restoreTrashedSong(id);
  }
}

// Removes one or more trashed songs for good — the trash bin's own
// "Delete" action (permanent, unlike deleteUserSong() above which only
// moves a song here in the first place) and the multi-select bulk
// equivalent. No confirmation lives inside this function itself — see
// confirmPermanentlyDeleteTrashSongs() in the "Trash Bin page" section,
// which is what every call site actually goes through.
async function permanentlyDeleteTrashSongs(ids) {
  const idSet = new Set(ids);
  state.trashSongs = state.trashSongs.filter(s => !idSet.has(s.id));
  await TrashStorage.removeMany(ids);
}

// Hard-deletes anything that's been sitting in the trash for more than
// TRASH_RETENTION_DAYS. Run once at startup (see init()) rather than on a
// timer — this is a PWA with no background process, so "once per app
// open" is the only reliable cadence available; a song that ages out
// while the app isn't running simply gets swept the next time it is.
async function purgeExpiredTrash() {
  try {
    const cutoff = Date.now() - TRASH_RETENTION_MS;
    const expired = state.trashSongs.filter(s => s.deletedAt <= cutoff).map(s => s.id);
    if (!expired.length) return;
    await permanentlyDeleteTrashSongs(expired);
  } catch (err) {
    // Non-fatal — worst case a handful of expired songs linger one extra
    // session and get swept next time instead of this one.
    console.error('Songbook: purgeExpiredTrash failed —', err);
  }
}

// ---------------------------------------------------------
// Trash Bin page: its own list (sorted newest-deleted-first), a per-row
// "…" menu for Recover/Delete one at a time, and a select mode — mirroring
// playlistEditMode's shape (see setPlaylistEditMode() above) — for
// recovering or deleting several songs in one go. Reached from
// Settings → Songs → "Trash bin" (#trash-nav-row, see bindSettings()).
// ---------------------------------------------------------
let trashSelectMode = false;
let trashSelectedIds = new Set();
let trashKebabOpenId = null; // id of the row whose "…" menu is currently open, if any

function bindTrashPage() {
  document.getElementById('trash-back-btn').addEventListener('click', () => history.back());

  document.getElementById('trash-select-btn').addEventListener('click', () => {
    setTrashSelectMode(!trashSelectMode);
  });
  document.getElementById('trash-select-all-btn').addEventListener('click', () => {
    toggleTrashSelectAll();
  });
  document.getElementById('trash-recover-btn').addEventListener('click', () => {
    if (!trashSelectedIds.size) return;
    const ids = Array.from(trashSelectedIds);
    restoreTrashedSongs(ids).then(() => {
      showToast(t('toastTrashRecovered', ids.length));
      setTrashSelectMode(false);
      renderTrashList({ animate: true });
      if (state.currentPage === 'user-songs') renderUserSongList();
    }).catch(err => {
      console.error('Songbook: failed to recover trashed songs —', err);
      showToast(t('toastSongSaveFailed'));
    });
  });
  document.getElementById('trash-delete-btn').addEventListener('click', () => {
    if (!trashSelectedIds.size) return;
    confirmPermanentlyDeleteTrashSongs(Array.from(trashSelectedIds));
  });

  // Closes whichever row's "…" menu is open when a tap lands outside it —
  // same pattern as closeSongViewMenu()/closePlaylistMenu() above.
  document.addEventListener('click', () => closeTrashRowMenu());
}

function renderTrashList(opts = {}) {
  const { animate = false } = opts;
  const listEl = document.getElementById('trash-list');
  const emptyEl = document.getElementById('trash-empty-state');
  const countEl = document.getElementById('trash-count');

  // Newest-deleted-first — the songs someone is most likely looking to
  // recover (an accidental delete they just made) land at the top instead
  // of being buried under whatever's aged out furthest.
  const sorted = [...state.trashSongs].sort((a, b) => b.deletedAt - a.deletedAt);

  countEl.textContent = t('resultsAll', sorted.length);
  emptyEl.hidden = sorted.length !== 0;
  emptyEl.textContent = t('trashEmptyState');

  listEl.innerHTML = '';
  sorted.forEach(song => listEl.appendChild(buildTrashRow(song)));
  initIcons(listEl);
  if (animate && !prefersReducedMotion()) animateListRefresh(listEl, emptyEl, countEl);

  updateTrashSelectionUI();
}

function daysRemaining(deletedAt) {
  const msLeft = (deletedAt + TRASH_RETENTION_MS) - Date.now();
  return Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
}

function buildTrashRow(song) {
  const li = document.createElement('li');
  li.dataset.trashId = song.id;

  const row = document.createElement('div');
  row.className = 'song-row trash-row';
  row.innerHTML = `
    <span class="checklist-check trash-row-check"><svg data-icon="check" viewBox="0 0 24 24"></svg></span>
    <span class="song-row-text">
      <span class="song-row-title">${escapeHtml(song.title)}</span>
      <span class="song-row-sub">${escapeHtml(t('trashDaysLeft', daysRemaining(song.deletedAt)))}</span>
    </span>
    <button type="button" class="icon-btn trash-row-menu-btn" aria-label="${escapeHtml(t('songOptionsAria'))}">
      <svg data-icon="menu-kebab" viewBox="0 0 24 24"></svg>
    </button>
  `;
  li.appendChild(row);

  row.addEventListener('click', (e) => {
    if (e.target.closest('.trash-row-menu-btn')) return;
    if (trashSelectMode) toggleTrashSelected(song.id);
  });

  row.querySelector('.trash-row-menu-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleTrashRowMenu(song.id, row);
  });

  li.classList.toggle('is-selected', trashSelectedIds.has(song.id));
  row.setAttribute('aria-pressed', String(trashSelectedIds.has(song.id)));
  return li;
}

function toggleTrashSelected(id) {
  if (trashSelectedIds.has(id)) trashSelectedIds.delete(id);
  else trashSelectedIds.add(id);
  updateTrashSelectionUI();
}

function toggleTrashSelectAll() {
  const allIds = state.trashSongs.map(s => s.id);
  const allSelected = allIds.length > 0 && allIds.every(id => trashSelectedIds.has(id));
  trashSelectedIds = allSelected ? new Set() : new Set(allIds);
  updateTrashSelectionUI();
}

// Refreshes everything that depends on trashSelectMode/trashSelectedIds —
// row checkmarks, the selected-count label, the enabled state of
// Recover/Delete, and the Select-all pill's label — called after every
// change to either so the UI can never drift out of sync with them.
function updateTrashSelectionUI() {
  const listEl = document.getElementById('trash-list');
  listEl.classList.toggle('is-selecting', trashSelectMode);
  listEl.querySelectorAll('li[data-trash-id]').forEach(li => {
    const id = li.dataset.trashId;
    const selected = trashSelectedIds.has(id);
    li.classList.toggle('is-selected', selected);
    const row = li.firstElementChild;
    if (row) row.setAttribute('aria-pressed', String(selected));
  });

  const bar = document.getElementById('trash-select-bar');
  bar.hidden = !trashSelectMode;
  document.getElementById('page-trash').classList.toggle('is-selecting', trashSelectMode);

  const count = trashSelectedIds.size;
  document.getElementById('trash-selected-count').textContent = t('trashSelectedCount', count);
  document.getElementById('trash-recover-btn').disabled = count === 0;
  document.getElementById('trash-recover-btn').textContent = t('trashRecoverBtn');
  document.getElementById('trash-delete-btn').disabled = count === 0;
  document.getElementById('trash-delete-btn').textContent = t('deleteBtn');

  const allIds = state.trashSongs.map(s => s.id);
  const allSelected = allIds.length > 0 && allIds.every(id => trashSelectedIds.has(id));
  const selectAllBtn = document.getElementById('trash-select-all-btn');
  selectAllBtn.textContent = allSelected ? t('trashDeselectAllBtn') : t('trashSelectAllBtn');
  // Showing/hiding the pill itself is handled once, on the actual mode
  // transition, by setTrashSelectMode() below — not here. This function
  // runs on every render (including the page's very first render, well
  // before select mode has ever been toggled), and showOrHidePillDone()
  // queues a real CSS animationend listener each time it's called; calling
  // it unconditionally on every one of those renders — most of which
  // aren't a transition at all — stacks up stale listeners from calls
  // whose animation never played (the button was already display:none),
  // and one of those going off later is what was silently re-hiding this
  // button the first time select mode actually turned on.
}

function setTrashSelectMode(on) {
  if (trashSelectMode === on) return;
  trashSelectMode = on;
  if (!on) trashSelectedIds = new Set();
  closeTrashRowMenu();

  const selectBtn = document.getElementById('trash-select-btn');
  selectBtn.innerHTML = `<svg data-icon="${on ? 'close' : 'check'}" viewBox="0 0 24 24"></svg>`;
  selectBtn.setAttribute('aria-label', t(on ? 'cancelBtn' : 'trashSelectBtn'));
  initIcons(selectBtn.parentElement);

  // Runs exactly once per actual transition (guarded by the early-return
  // above) — see updateTrashSelectionUI()'s comment on why the animated
  // show/hide can't just run unconditionally on every render.
  showOrHidePillDone(document.getElementById('trash-select-all-btn'), on);

  updateTrashSelectionUI();
}

// Per-row "…" menu — same open/close/outside-click shape as
// closeSongViewMenu()/closePlaylistMenu() above, just scoped to one row
// at a time (trashKebabOpenId) since the trash list can have many rows,
// unlike song-view/playlist-view which only ever have the one kebab.
function toggleTrashRowMenu(id, rowEl) {
  if (trashKebabOpenId === id) { closeTrashRowMenu(); return; }
  closeTrashRowMenu();
  const song = state.trashSongs.find(s => s.id === id);
  if (!song) return;

  const wrap = document.createElement('div');
  wrap.className = 'kebab-dropdown';
  wrap.id = 'trash-kebab-dropdown';
  wrap.innerHTML = `
    <button type="button" id="trash-kebab-recover"><svg data-icon="upload" viewBox="0 0 24 24"></svg>${escapeHtml(t('trashRecoverBtn'))}</button>
    <button type="button" id="trash-kebab-delete" class="is-danger"><svg data-icon="trash" viewBox="0 0 24 24"></svg>${escapeHtml(t('deleteBtn'))}</button>
  `;
  rowEl.style.position = 'relative';
  rowEl.appendChild(wrap);
  initIcons(wrap);
  trashKebabOpenId = id;

  wrap.querySelector('#trash-kebab-recover').addEventListener('click', (e) => {
    e.stopPropagation();
    closeTrashRowMenu();
    restoreTrashedSong(id).then(() => {
      showToast(t('toastTrashRecovered', 1));
      renderTrashList({ animate: true });
      if (state.currentPage === 'user-songs') renderUserSongList();
    }).catch(err => {
      console.error('Songbook: failed to recover trashed song —', err);
      showToast(t('toastSongSaveFailed'));
    });
  });
  wrap.querySelector('#trash-kebab-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    closeTrashRowMenu();
    confirmPermanentlyDeleteTrashSongs([id]);
  });
  wrap.addEventListener('click', (e) => e.stopPropagation());
}

function closeTrashRowMenu() {
  const wrap = document.getElementById('trash-kebab-dropdown');
  trashKebabOpenId = null;
  if (!wrap) return;
  if (prefersReducedMotion()) { wrap.remove(); return; }
  wrap.removeAttribute('id');
  wrap.classList.add('kebab-dropdown-exit');
  wrap.addEventListener('animationend', () => wrap.remove(), { once: true });
}

// Shared confirm modal for permanent deletion — takes one id or several
// (the per-row kebab's Delete and the select-mode bulk Delete both funnel
// through here), same confirm/cancel shape as confirmDeleteUserSong()'s
// own modal above.
function confirmPermanentlyDeleteTrashSongs(ids) {
  if (!ids.length) return;
  const wrap = document.createElement('div');
  const p = document.createElement('p');
  p.className = 'modal-hint';
  p.style.marginTop = '0';
  p.textContent = ids.length === 1
    ? t('deleteTrashConfirmOne', (state.trashSongs.find(s => s.id === ids[0]) || {}).title || '')
    : t('deleteTrashConfirmMany', ids.length);
  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  actions.innerHTML = `
    <button type="button" class="btn-secondary" id="delete-trash-cancel"></button>
    <button type="button" class="btn-primary btn-danger" id="delete-trash-confirm"></button>
  `;
  wrap.appendChild(p);
  wrap.appendChild(actions);
  actions.querySelector('#delete-trash-cancel').textContent = t('cancelBtn');
  actions.querySelector('#delete-trash-confirm').textContent = t('deleteBtn');

  actions.querySelector('#delete-trash-cancel').addEventListener('click', closeModal);
  actions.querySelector('#delete-trash-confirm').addEventListener('click', () => {
    closeModal();
    permanentlyDeleteTrashSongs(ids).then(() => {
      showToast(t('toastTrashDeleted', ids.length));
      if (trashSelectMode) setTrashSelectMode(false);
      renderTrashList({ animate: true });
    }).catch(err => {
      console.error('Songbook: failed to permanently delete trashed songs —', err);
      showToast(t('toastSongSaveFailed'));
    });
  });

  openModal(t('deleteBtn'), wrap);
}

// Manual export/import: mirrors exportPlaylists/importPlaylistsFromFile
// (see the "Playlists" section below) for exactly the same reason — User
// Songs live in IndexedDB, which is scoped to one browser on the device,
// so this is the honest way to carry hand-authored songs to a different
// browser on the same phone (or as a manual backup) without a server.
function exportUserSongs() {
  const exportSongs = state.sources.user.songs.map(song => sanitizeUserSongRecord({ ...song }));
  const blob = new Blob([JSON.stringify(exportSongs, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ngworship-user-songs.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(t('toastUserSongsExported'));
}

async function importUserSongsFromFile(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!Array.isArray(data) || !data.every(s => s && typeof s.id === 'string' && typeof s.title === 'string')) {
      throw new Error('not a user songs export file');
    }
    // Same full-replace behavior as importPlaylistsFromFile — this is a
    // device-to-device move, not a merge, so the imported file becomes
    // the new User Songs list. Unlike PlaylistStorage's single blob,
    // User Songs are stored one key per song (see UserSongStorage above),
    // so the store is cleared first rather than just overwritten, to
    // avoid leaving pre-import songs orphaned behind the new list.
    const cleanData = data.map(song => sanitizeUserSongRecord(song));
    await UserSongStorage.clear();
    for (const song of cleanData) {
      await UserSongStorage.put(song);
    }
    state.sources.user.songs = cleanData;
    state.sources.user.loaded = true;
    if (state.currentPage === 'user-songs') renderUserSongList();
    if (state.currentPage === 'playlists') renderPlaylistsList();
    if (state.currentPage === 'playlist-view') renderPlaylistView();
    if (state.activeSong) updateFavoriteButtonUI();
    showToast(t('toastUserSongsImported'));
  } catch (err) {
    console.error('Songbook: user songs import failed —', err);
    showToast(t('toastUserSongsImportFailed'));
  }
}

// Manual "Refresh song database" button: checks the authoritative individual
// song files for whichever database is currently selected. database.json is
// only the bootstrap snapshot, so it does not have to be regenerated for a
// one-song correction. While offline the action simply keeps the current local
// copy intact; while online it uses the same thin progress line as automatic
// background sync and never wipes already-visible songs on a failed refresh.
async function reloadSongLibrary() {
  const btn = document.getElementById('reload-songs-btn');
  btn.disabled = true;
  btn.textContent = t('reloadBtnBusy');

  const sourceKey = state.activeDbSource;
  const source = state.sources[sourceKey];
  if (!navigator.onLine) {
    showToast(t('toastLibraryOffline'));
    btn.disabled = false;
    btn.textContent = t('reloadBtn');
    return;
  }
  try {
    // Manual refresh means "check the authoritative individual files now".
    // database.json remains only the fast bootstrap snapshot and is never
    // required to be rebuilt for a one-song correction.
    if (source) source.syncAttempted = false;
    await syncSongDataFromIndividuals(sourceKey, { forceRefresh: true, manual: true });
    renderSongList();
    searchCacheWarmSources.delete(sourceKey);
    scheduleSearchCacheWarmup(sourceKey);
    showToast(navigator.onLine ? t('toastLibraryReloaded') : t('toastLibraryOffline'));
  } catch (err) {
    console.error('Songbook: manual song database refresh failed —', err);
    showToast(t('toastLibraryReloadFailed'));
  } finally {
    btn.disabled = false;
    btn.textContent = t('reloadBtn');
  }
}

// Manual "Reload app" button: a different, heavier reload than the song
// database refresh above — this clears the offline app-shell cache and the
// service worker entirely, then reloads the page, so it picks up a fresh
// copy of everything (HTML/CSS/JS included), not just the song data. This
// exists as an explicit, deliberate action the person has to tap, since the
// browser's native swipe-down-to-reload gesture is disabled in this app
// (accidental pull-to-refresh mid-scroll was closing songs/losing state).
async function reloadApp() {
  const btn = document.getElementById('reload-app-btn');
  btn.disabled = true;
  btn.textContent = t('reloadAppBtnBusy');

  // Offline: unregistering the service worker and clearing every cache
  // leaves nothing behind to serve the reload with — nothing can be
  // re-downloaded without a connection. That combination used to be
  // exactly what stranded people on a broken/blank reload while offline.
  // Skip the destructive cleanup entirely here and just reload normally —
  // the still-intact service worker and cache keep serving the app as-is,
  // and the offline fallback page (see service-worker.js) covers it even
  // if something's still missing.
  if (!navigator.onLine) {
    showToast(t('toastReloadAppOffline'));
    btn.disabled = false;
    btn.textContent = t('reloadAppBtn');
    window.location.reload();
    return;
  }

  // This function's own reload (below) is the deliberate, complete fix —
  // the fresh load it triggers will register a new service worker, which
  // will then claim this page and fire 'controllerchange' again. Without
  // these, two other independent update-detection paths would each see
  // that fresh load as a separate, unrelated update and reload it AGAIN,
  // right on top of this one: registerServiceWorker()'s controllerchange
  // listener (suppressed for this one cycle via the sessionStorage flag),
  // and hardUpdateBackstop() at the top of this file (suppressed by
  // marking the version as seen before we go). See the comments on those
  // two for the full picture.
  try {
    sessionStorage.setItem('ngw_skip_next_auto_reload', '1');
  } catch (e) {
    // sessionStorage unavailable — worst case is one extra (harmless,
    // if annoying) reload; not worth failing the whole action over.
  }
  markVersionSeen();

  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (window.caches) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (err) {
    console.error('Songbook: app reload cleanup failed —', err);
  } finally {
    window.location.reload();
  }
}

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
function pushNavState(data) {
  navSeq += 1;
  currentNavSeq = navSeq;
  history.pushState({ ...data, seq: navSeq }, '', location.href);
}

// Set by the popstate handler right before it calls showPage/openSong/
// openPlaylist so showPage() knows whether this particular navigation is
// a back or a forward move — see the slide-transition logic in showPage().
// Direct in-app calls (tapping a song, tapping a playlist, a nav tab) never
// touch this, so it stays 'forward' for them, which is exactly right: those
// are always moving deeper into the app, never back out of it.
let pendingNavDirection = 'forward';

function initHistoryNav() {
  // Every pushState below reuses the same URL (only the state object
  // changes — {page: 'songs'} vs {page: 'song-view'}, etc.), since this is
  // a single-page app with no per-page URLs. Left on its default 'auto',
  // the browser tries to restore its own remembered scroll position on
  // top of ours whenever you navigate back/forward — and because all the
  // entries share one URL, it can restore the wrong one (typically 0),
  // silently overwriting the position showPage() just set. Switching to
  // 'manual' hands scroll restoration entirely to our own code below,
  // which is the only thing that actually knows which page is showing.
  if ('scrollRestoration' in history) {
    history.scrollRestoration = 'manual';
  }

  // Establish the app's root state so the very first back press has
  // something of ours to land on instead of leaving immediately.
  history.replaceState({ page: 'songs', seq: 0 }, '', location.href);
  navSeq = 0;
  currentNavSeq = 0;

  window.addEventListener('popstate', (e) => {
    const st = e.state;
    // Figure out which way we just moved before anything below touches
    // currentNavSeq, so showPage() can read pendingNavDirection once it
    // runs (see the direction comment near pendingNavDirection).
    if (st) {
      const newSeq = typeof st.seq === 'number' ? st.seq : 0;
      pendingNavDirection = newSeq < currentNavSeq ? 'back' : 'forward';
      currentNavSeq = newSeq;
    }
    if (st && st.page) {
      if (st.page === 'song-view' && st.songId) {
        const sourceKey = st.sourceKey || 'official';
        const source = state.sources[sourceKey];
        const song = source && source.songs.find(s => s.id === st.songId);
        if (song) { openSong(song, { pushHistory: false, sourceKey }); return; }
      }
      if (st.page === 'playlist-view' && st.playlistId) {
        if (state.playlists.byId[st.playlistId]) {
          openPlaylist(st.playlistId, { pushHistory: false });
          return;
        }
      }
      if (st.page === 'song-editor') {
        // editorSongId may be null (a "New song" form back/forward-ed to)
        // — that's a valid state to land back on as-is, same blank form.
        const song = st.editorSongId ? findSongByRef('user', st.editorSongId) : null;
        openSongEditor(song, { pushHistory: false });
        return;
      }
      showPage(st.page, { pushHistory: false });
      return;
    }

    // No app state left to land on — the next back would leave the app.
    const now = Date.now();
    if (now - lastBackPressAt < EXIT_CONFIRM_WINDOW_MS) {
      // Second press in time: let this one actually exit.
      return;
    }
    lastBackPressAt = now;
    // Re-plant the root state so this press doesn't leave the app, and
    // tell the person to press back again if they really want to exit.
    pushNavState({ page: 'songs' });
    showPage('songs', { pushHistory: false });
    showToast(t('toastPressBackAgain'));
  });
}

// ---------------------------------------------------------
// Splash screen: shown briefly on launch, then fades into the app
// ---------------------------------------------------------
function initSplash() {
  const splash = document.getElementById('splash-screen');
  if (!splash) return;
  const MIN_DISPLAY_MS = 900;
  const FADE_MS = 1100;
  const shownAt = Date.now();
  const hide = () => {
    const wait = Math.max(0, MIN_DISPLAY_MS - (Date.now() - shownAt));
    setTimeout(() => {
      splash.classList.add('is-hidden');
      setTimeout(() => splash.remove(), FADE_MS);
    }, wait);
  };
  if (document.readyState === 'complete') {
    hide();
  } else {
    window.addEventListener('load', hide);
  }
}

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

  const savedLyricsWeight = localStorage.getItem('sb-lyrics-weight');
  if (savedLyricsWeight === 'normal' || savedLyricsWeight === 'semibold' || savedLyricsWeight === 'bold') {
    state.lyricsWeight = savedLyricsWeight;
  }
  applyLyricsWeight();

  const savedLyricsSpacing = localStorage.getItem('sb-lyrics-spacing');
  if (savedLyricsSpacing === 'tight' || savedLyricsSpacing === 'normal' || savedLyricsSpacing === 'loose') {
    state.lyricsSpacing = savedLyricsSpacing;
  }
  applyLyricsSpacing();

  const savedSongListView = localStorage.getItem('sb-song-view');
  if (savedSongListView === 'list' || savedSongListView === 'compact' || savedSongListView === 'tiles') {
    state.songListView = savedSongListView;
  }
  applySongListView();

  state.landscapeMode = localStorage.getItem('sb-landscape-mode') === 'true';
  applyLandscapeMode();

  state.hideVerseNumbers = localStorage.getItem('sb-hide-verse-numbers') === 'true';
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
  const resolvedDb = legacyDbKeys[savedDb] || (DB_SOURCES[savedDb] ? savedDb : 'official');
  applyDbSource(resolvedDb);
}

function applyFontSizes() {
  document.documentElement.style.setProperty('--lyrics-size', state.lyricsSize + 'rem');
  document.documentElement.style.setProperty('--chord-size', state.chordSize + 'rem');
}

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

// Slides/resizes a .seg-toggle-thumb (see the CSS) to sit exactly behind
// whichever button in `container` is currently aria-pressed="true" — sized
// to that button's own offsetWidth, so this works the same whether the
// options are equal-width (Chips/Text) or not (Normal/Semibold/Bold).
// Measured as the distance from the *first* button's left edge rather than
// the container's, so it comes out right regardless of exactly how a
// browser accounts for the container's own border/padding in offsetLeft —
// both buttons are measured the identical way, so that constant cancels
// out of the difference.
//
// opts.instant skips the CSS transition for this one update (container
// becoming visible, a language change re-flowing button widths, a window
// resize) so the thumb snaps straight to the right spot instead of
// visibly growing/sliding in from wherever it last was — reserved for
// updates the person didn't just tap themselves in this toggle.
// offsetParent is null while `container` sits on a hidden page (e.g. at
// startup, before Settings has ever been opened) — skip until it's
// actually on screen, since every measurement below would just come back
// zero; see the Settings page's onEnter and updateAllSegToggleThumbs()
// for where it gets corrected once that's no longer true.
function positionSegToggleThumb(container, opts = {}) {
  if (!container) return;
  const thumb = container.querySelector('.seg-toggle-thumb');
  const pressed = container.querySelector('.seg-toggle-btn[aria-pressed="true"]');
  const first = container.querySelector('.seg-toggle-btn');
  if (!thumb || !pressed || !first || container.offsetParent === null) return;

  const { instant = false } = opts;
  if (instant) thumb.style.transitionDuration = '0s';
  thumb.style.width = pressed.offsetWidth + 'px';
  thumb.style.transform = `translateX(${pressed.offsetLeft - first.offsetLeft}px)`;
  if (instant) {
    void thumb.offsetWidth; // apply the instant move before restoring the animated duration
    thumb.style.transitionDuration = '';
  }
}

function updateAllSegToggleThumbs(opts = {}) {
  document.querySelectorAll('.seg-toggle').forEach(el => positionSegToggleThumb(el, opts));
}

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
}

// Hide chords entirely (opt-in, sits right below the Chips/Text toggle):
// lyrics-only view for people who already know the song, or a leader who
// wants the words on screen without chord clutter. Doesn't touch song
// data or the Chips/Text choice underneath — see the
// html[data-hide-chords="true"] rule in style.css for what's actually
// hidden, same attribute-driven pattern as applyChordStyle() above.
function applyHideChords() {
  document.documentElement.setAttribute('data-hide-chords', String(state.hideChords));
  const toggle = document.getElementById('hide-chords-toggle');
  if (toggle) toggle.setAttribute('aria-checked', String(state.hideChords));
}

// Lyrics style (Settings → Appearance): font weight for lyric text only —
// see the html[data-lyrics-weight] rules by .lyric-word in style.css.
// Same attribute-driven segmented-control pattern as applyChordStyle().
function applyLyricsWeight() {
  document.documentElement.setAttribute('data-lyrics-weight', state.lyricsWeight);
  document.querySelectorAll('#lyrics-weight-toggle [data-lyrics-weight]').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.lyricsWeight === state.lyricsWeight));
  });
  positionSegToggleThumb(document.getElementById('lyrics-weight-toggle'));
}

// Line spacing (Settings → Appearance): vertical rhythm between lyric
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

// Songbook list view (Settings → Appearance): how the Songbook's own list
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
  document.querySelectorAll('#song-view-toggle [data-song-view]').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.songView === state.songListView));
  });
  positionSegToggleThumb(document.getElementById('song-view-toggle'));
  // List/Compact/Tiles have very different row heights (Tiles in particular
  // packs several songs into one grid row), which changes where every
  // letter/number lands pixel-wise. The fast-scroll rail's popup
  // (scrollIndexEntries, see measureScrollIndexEntries()) is only ever
  // re-measured from inside renderSongList() — so without this call here,
  // switching views leaves it comparing the real (new) scroll position
  // against pixel offsets measured under the *previous* view's geometry,
  // which is what made the popup show the wrong letter/number (or get
  // stuck near one end) after switching to Compact or Tiles.
  renderSongList();
}

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

// Switches which song database (see DB_SOURCES) the Songs page, search,
// and playlist song-picker all browse — called from Settings → Song
// database's dbSelect (see bindSettings()) and on startup to restore the
// saved choice.
//
// Resets the search query on switch (a query typed against one source's
// titles/lyrics is unlikely to mean anything in a different source, and
// leaving it behind would just show a confusing "no results"). If the
// new source has no song numbers (see DB_SOURCES' hasNumbers — the
// English database), this also hides the "Sort by number" button and
// snaps sortBy to 'alpha' so the Songs page never gets stuck showing a
// sort control for a field that doesn't exist; switching to a numbered
// source later restores it.
function renderSongLoadingState() {
  const listEl = document.getElementById('song-list');
  const emptyEl = document.getElementById('empty-state');
  const countEl = document.getElementById('results-count');
  // Loading is intentionally represented ONLY by the thin progress line
  // under Search — no spinner, status sentence, or temporary list row.
  if (listEl) listEl.innerHTML = '';
  if (emptyEl) emptyEl.hidden = true;
  if (countEl) countEl.textContent = '';
  setSongSyncProgress(state.activeDbSource, 0, 0, { indeterminate: true });
  const track = document.getElementById('song-scroll-index');
  if (track) track.hidden = true;
}

function applyDbSource(sourceKey) {
  if (!DB_SOURCES[sourceKey]) sourceKey = 'official';
  const previousSourceKey = state.activeDbSource;
  if (previousSourceKey !== sourceKey) {
    const previousSource = state.sources[previousSourceKey];
    if (previousSource && previousSource.syncController) {
      try { previousSource.syncController.abort(); } catch (e) {}
      previousSource.syncAttempted = false;
    }
  }
  state.activeDbSource = sourceKey;
  updateDbRowSub();
  resetSongSyncProgress(sourceKey);
  state.query = '';
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';

  const hasNumbers = (DB_SOURCES[sourceKey] || {}).hasNumbers !== false;
  const numBtn = document.querySelector('.sort-btn[data-sort-by="num"]');
  const alphaBtn = document.querySelector('.sort-btn[data-sort-by="alpha"]');
  if (numBtn) numBtn.hidden = !hasNumbers;
  if (!hasNumbers && state.sortBy === 'num') {
    state.sortBy = 'alpha';
    if (numBtn) numBtn.setAttribute('aria-pressed', 'false');
    if (alphaBtn) alphaBtn.setAttribute('aria-pressed', 'true');
  }

  const source = state.sources[sourceKey];
  const listEl = document.getElementById('song-list');
  if (source && source.loaded) {
    // Database changes are made from Settings, where #page-songs is hidden.
    // Don't spend a frame building thousands of invisible rows there; mark
    // the list stale and let onSongsPageEnter() build it once when needed.
    if (state.currentPage === 'songs') renderSongList();
    else if (listEl) listEl.dataset.renderSourceKey = '';
    scheduleSearchCacheWarmup(sourceKey);
    loadSongDataFor(sourceKey); // schedules the selected source's latest sync
    return;
  }

  // Settings can switch databases while the Songs page is hidden. Start
  // the selected database immediately, but don't touch any unrelated DB or
  // build a hidden song list. The thin progress line will already be active
  // if the person returns to Songs before bootstrap/sync finishes.
  if (state.currentPage === 'songs') renderSongLoadingState();
  else if (listEl) listEl.dataset.renderSourceKey = '';
  loadSongDataFor(sourceKey).then(() => {
    if (state.activeDbSource !== sourceKey) return;
    if (state.currentPage === 'songs') renderSongList();
    else if (listEl) listEl.dataset.renderSourceKey = '';
    scheduleSearchCacheWarmup(sourceKey);
  });
}

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

  // See css/style.css: html[data-theme="light"][data-vivid-glass]
  // .sv-header-immersive::before — light mode only, dark mode's own
  // override is unconditional either way.
  const vividGlassToggle = document.getElementById('dev-vivid-glass-toggle');
  if (vividGlassToggle) vividGlassToggle.setAttribute('aria-checked', String(state.devVividGlass));
  document.documentElement.toggleAttribute('data-vivid-glass', state.devVividGlass);
}

function initDevOptions() {
  bindDevOptionsUnlock();

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
  document.getElementById('dev-vivid-glass-toggle').addEventListener('click', () => {
    state.devVividGlass = !state.devVividGlass;
    applyDevOptions();
  });
}

// ---------------------------------------------------------
// Language: apply the active language to every labeled element
// ---------------------------------------------------------
function applyLanguage() {
  document.documentElement.setAttribute('lang', state.lang);

  const map = {
    't-appTitle': 'appTitle',
    't-topbarAppName': 'appTitle',
    't-navSongs': 'navSongs',
    't-navSettings': 'navSettings',
    't-navPlaylists': 'navPlaylists',
    't-navUserSongs': 'navUserSongs',
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
    't-editorLyricsHint': 'editorLyricsHint',
    't-editorPreviewLabel': 'editorPreviewLabel',
    't-keyLabel': 'keyLabel',
    't-lyricsGroup': 'lyricsGroup',
    't-chordsGroup': 'chordsGroup',
    't-chordStyleGroup': 'chordStyleGroup',
    't-chordStyleSub': 'chordStyleSub',
    't-chordStyleChip': 'chordStyleChip',
    't-chordStyleText': 'chordStyleText',
    't-hideChordsTitle': 'hideChordsTitle',
    't-hideChordsSub': 'hideChordsSub',
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
    't-devHideDescTitle': 'devHideDescTitle',
    't-devHideDescSub': 'devHideDescSub',
    't-devVividGlassTitle': 'devVividGlassTitle',
    't-devVividGlassSub': 'devVividGlassSub',
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
  document.getElementById('editor-key').placeholder = t('editorKeyPlaceholder');
  document.getElementById('editor-link').placeholder = t('editorLinkPlaceholder');
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
  document.getElementById('scripture-verse-text').textContent = `«${t('scriptureVerse')}»`;
  document.getElementById('scripture-verse-ref').textContent = t('scriptureRef');

  const appConfig = window.SONGBOOK_APP_CONFIG || {};
  const orgName = appConfig.orgName || '';
  document.getElementById('about-copyright').textContent =
    `© ${new Date().getFullYear()} ${orgName}. All rights reserved.`;
  document.getElementById('about-copyright-terms').textContent = t('copyrightTerms');

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
  document.getElementById('export-playlists-btn').textContent = t('exportBtn');
  document.getElementById('import-playlists-btn').textContent = t('importBtn');
  document.getElementById('export-user-songs-btn').textContent = t('exportBtn');
  document.getElementById('import-user-songs-btn').textContent = t('importBtn');

  renderSocialLinks();
  renderCredits();

  refreshInstallLabels();
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
}

// ---------------------------------------------------------
// Navigation — data-driven off PAGES above, so it doesn't need to change
// when a page is added; only PAGES (+ its markup) does.
// ---------------------------------------------------------
function bindNav() {
  document.querySelectorAll('.nav-btn[data-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const target = btn.dataset.nav;
      // Tapping a tab you're ALREADY on is a deliberate "jump to top of
      // the list" action — standard tab-bar behavior. Tapping it to come
      // back from a different page (settings, a song) is a normal "go
      // back" and should instead restore wherever that list was
      // scrolled to, same as the in-song back button.
      const alreadyThere = state.currentPage === target;
      showPage(target, { pushHistory: true, resetScroll: alreadyThere });
    });
  });
}

function showPage(name, opts = {}) {
  const { pushHistory = false, replaceHistory = false, resetScroll = false } = opts;
  const page = PAGES[name];
  if (!page) {
    console.error(`Songbook: showPage() called with unknown page "${name}"`);
    return;
  }

  // Re-navigating to the page already on screen (e.g. tapping the "Songs"
  // tab while already viewing the song list) normally shouldn't move the
  // scroll at all — just leave it exactly where it is. resetScroll is the
  // explicit override for that (see bindNav's already-there case): it
  // always wins and jumps to the top, even on the same page.
  const isSamePage = state.currentPage === name;

  // Leaving the song page for good (not just re-opening it) — stop any
  // audio that's playing there. Otherwise the browser/OS keeps the media
  // session (and its floating widget) alive for an <audio> element that's
  // no longer visible or reachable from the UI.
  if (!isSamePage && state.currentPage === 'song-view') {
    document.querySelectorAll('#sv-audio audio').forEach(a => a.pause());
  }

  // Otherwise, before switching away, remember where we were scrolled on
  // the page's own scroll container (see the CSS/.page notes for why it's
  // an element's scrollTop now, not window.scrollY) so coming back to it
  // later restores that exact spot.
  const prevName = state.currentPage;
  if (!isSamePage && (prevName in scrollMemory)) {
    const prevPage = PAGES[prevName];
    const prevEl = prevPage && document.getElementById(prevPage.elId);
    if (prevEl) scrollMemory[prevName] = prevEl.scrollTop;
  }

  const targetEl = document.getElementById(page.elId);

  // Slide transition for song-view/playlist-view: pushed forward (opened)
  // slides in from the right over whatever's underneath; popped (backed
  // out of) slides back out to the right, revealing what was underneath —
  // which was never hidden or moved, so nothing has to re-render for it.
  // See pendingNavDirection/SLIDE_PAGES for how the direction is decided.
  let transitionType = null;
  if (!isSamePage && !prefersReducedMotion()) {
    const prevEl = PAGES[prevName] && document.getElementById(PAGES[prevName].elId);
    if (pendingNavDirection === 'back' && SLIDE_PAGES.has(prevName) && prevEl) {
      transitionType = 'pop';
    } else if (pendingNavDirection !== 'back' && SLIDE_PAGES.has(name) && prevEl) {
      transitionType = 'push';
    } else if (TAB_PAGES.has(name) && TAB_PAGES.has(prevName) && prevEl) {
      transitionType = 'tabfade';
    }
  }
  pendingNavDirection = 'forward';

  if (transitionType === 'push' || transitionType === 'pop') {
    const prevEl = document.getElementById(PAGES[prevName].elId);
    runPageSlideTransition(transitionType, prevEl, targetEl, {
      onDone: name === 'song-view' ? fixNativeAudioControlsPaint : null,
    });
  } else if (transitionType === 'tabfade') {
    const prevEl = document.getElementById(PAGES[prevName].elId);
    runTabFadeTransition(prevEl, targetEl);
  } else {
    Object.values(PAGES).forEach(p => { document.getElementById(p.elId).hidden = true; });
    targetEl.hidden = false;
    // No slide animation ran (reduced-motion, or a non-slide page), but the
    // <audio controls> element in openSong() was still built while its page
    // was `hidden`. Chromium's native audio controls (play button, scrubber)
    // are a shadow-DOM widget that doesn't always get laid out properly for
    // elements constructed off-screen/hidden — they can render as blank or
    // half-drawn until something forces a reflow. A tap "fixes" it because
    // that's exactly the kind of forced reflow. Do that proactively instead
    // of waiting on the user to discover the trick.
    if (name === 'song-view') fixNativeAudioControlsPaint();
  }

  document.querySelectorAll('.nav-btn[data-nav]').forEach(b => b.classList.remove('is-active'));
  if (page.navKey) {
    const navBtn = document.querySelector(`.nav-btn[data-nav="${page.navKey}"]`);
    if (navBtn) navBtn.classList.add('is-active');
  }
  if (page.onEnter) page.onEnter();

  // A page can opt to hide the bottom tab bar so nothing competes with its
  // content (song-view does this — it has its own slim top bar instead).
  document.getElementById('bottom-nav').hidden = !!page.hideNav;
  document.body.classList.toggle('nav-hidden', !!page.hideNav);

  if (resetScroll) {
    // Explicit override: always end up at the top, same page or not.
    if (isSamePage) {
      // Already on this page (tapping the tab you're on) — animate back to
      // the top instead of an instant cut, so the jump reads as motion.
      targetEl.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      // Landing on the page fresh (e.g. opening a song): nothing to
      // animate from, just start at the top.
      targetEl.scrollTop = 0;
    }
  } else if (!isSamePage) {
    if (name in scrollMemory) {
      // Returning to a page we've been on before: put the scroll back where it was.
      targetEl.scrollTop = scrollMemory[name];
    } else {
      // Fresh page (e.g. opening a song): start at the top.
      targetEl.scrollTop = 0;
    }
  }

  state.currentPage = name;
  updateWakeLock();

  if (pushHistory) {
    pushNavState({ page: name });
  } else if (replaceHistory) {
    history.replaceState({ page: name, seq: currentNavSeq }, '', location.href);
  }
}

// Whether the person has asked the OS/browser to minimize motion — the
// slide transition below is skipped entirely for them (falls back to the
// original instant cut) rather than trying to offer a "reduced" version.
function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

// Plays the .song-row-tap press animation on the clicked row and gives it
// a beat to actually be seen before running the navigation itself — see
// the .song-row-tap comment in style.css for why plain :active isn't
// enough here. Skipped for reduced-motion users, who go straight through.
function tapSongRowThenOpen(rowEl, openFn) {
  if (prefersReducedMotion()) { openFn(); return; }
  rowEl.classList.add('song-row-tap');
  rowEl.addEventListener('animationend', () => rowEl.classList.remove('song-row-tap'), { once: true });
  setTimeout(openFn, 90);
}

// Runs the push/pop slide for the two SLIDE_PAGES. Both pages involved are
// simple CSS transforms on their own compositor layer (no layout/paint
// work on the surrounding page), so this is cheap to animate even on
// low-end devices — it's the same technique native app frameworks use for
// this exact transition.
function runPageSlideTransition(type, fromEl, toEl, opts = {}) {
  const { onDone = null } = opts;
  // Anything other than the two pages actually involved stays hidden as
  // before — only these two are ever visible at once, and only briefly.
  Object.values(PAGES).forEach(p => {
    const el = document.getElementById(p.elId);
    if (el !== fromEl && el !== toEl) el.hidden = true;
  });
  fromEl.hidden = false;
  toEl.hidden = false;

  const topEl = type === 'push' ? toEl : fromEl;
  const bottomEl = type === 'push' ? fromEl : toEl;
  topEl.style.zIndex = '2';
  bottomEl.style.zIndex = '1';

  topEl.classList.remove('page-slide-in', 'page-slide-out');
  // Force a reflow so re-adding the same animation class (e.g. opening a
  // second song while one is already mid-transition) restarts it instead
  // of the browser treating it as a no-op.
  void topEl.offsetWidth;
  topEl.classList.add(type === 'push' ? 'page-slide-in' : 'page-slide-out');

  // If a previous transition involving either of these elements got
  // interrupted before finishing (rapid back-to-back navigation), its
  // 'animationend' listener never fired and is still attached. Left in
  // place, it can fire later and hide whatever element that stale
  // closure captured as *its* fromEl — even after this new transition has
  // moved on to a different fromEl/toEl pairing. Drop stale cleanups on
  // both elements, not just topEl, before attaching this one.
  [topEl, bottomEl].forEach(el => {
    if (el._slideCleanup) {
      el.removeEventListener('animationend', el._slideCleanup);
      el._slideCleanup = null;
    }
  });
  const cleanup = () => {
    topEl.classList.remove('page-slide-in', 'page-slide-out');
    topEl.style.zIndex = '';
    bottomEl.style.zIndex = '';
    // fromEl is always the page we're leaving — whether it was the one
    // visually sliding away (pop) or just sitting static underneath while
    // the new page slid over it (push) — so it's always the one to hide
    // once the transition's done; toEl (== the page showPage() is
    // switching to) always stays visible, same as the instant-cut path.
    fromEl.hidden = true;
    topEl.removeEventListener('animationend', cleanup);
    topEl._slideCleanup = null;
    if (onDone) onDone();
  };
  topEl._slideCleanup = cleanup;
  topEl.addEventListener('animationend', cleanup);
}

// Crossfade for TAB_PAGES switches (tapping a different bottom-nav
// button). The incoming page fades/rises in on top of the outgoing one —
// see the .tab-fade-in CSS comment for why the outgoing page doesn't need
// its own fade-out animation.
function runTabFadeTransition(fromEl, toEl) {
  // Cancel any cleanup left pending from an earlier, still-in-flight
  // transition on EITHER element. Without this, rapid A->B->A switching
  // leaves B's cleanup (from the A->B leg) still armed and listening for
  // B's animationend; when that fires later it hides A — the page we've
  // since navigated back to and are mid-fade-in on — even though A is now
  // the correct, current page. Cancelling both, not just toEl's, is what
  // fixes that: fromEl can just as easily be carrying a stale cleanup from
  // when it was itself a toEl a moment ago.
  [fromEl, toEl].forEach(el => {
    if (el._tabFadeCleanup) {
      el.removeEventListener('animationend', el._tabFadeCleanup);
      el._tabFadeCleanup = null;
    }
  });

  Object.values(PAGES).forEach(p => {
    const el = document.getElementById(p.elId);
    if (el !== fromEl && el !== toEl) el.hidden = true;
  });
  fromEl.hidden = false;
  toEl.hidden = false;
  toEl.style.zIndex = '2';
  fromEl.style.zIndex = '1';

  toEl.classList.remove('tab-fade-in');
  void toEl.offsetWidth; // restart the animation if one is already mid-flight
  toEl.classList.add('tab-fade-in');

  const cleanup = () => {
    toEl.classList.remove('tab-fade-in');
    toEl.style.zIndex = '';
    fromEl.style.zIndex = '';
    fromEl.hidden = true;
    toEl.removeEventListener('animationend', cleanup);
    toEl._tabFadeCleanup = null;
  };
  toEl._tabFadeCleanup = cleanup;
  toEl.addEventListener('animationend', cleanup);
}

// Coalesces rapid-fire calls (e.g. several 'input' events landing before
// the browser gets a chance to paint — common on mobile when holding
// backspace, which can auto-repeat faster than one search-list re-render
// takes) down to a single call on the next animation frame, always using
// whatever's current at that point rather than queuing up one run per
// keystroke. Combined with getSearchCache() above (which removes the
// actual per-song recompute cost), this is a second, cheap safety net
// specifically for bursts of events arriving faster than a frame.
function coalesceToNextFrame(fn) {
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      fn();
    });
  };
}

// ---------------------------------------------------------
// Songs page: search + sort + list rendering
// ---------------------------------------------------------
function bindSongsPage() {
  const input = document.getElementById('search-input');
  input.addEventListener('input', coalesceToNextFrame(() => {
    state.query = input.value.trim().toLowerCase();
    renderSongList({ animate: true });
  }));

  /* Plays the sort-btn-tap keyframe animation (see .sort-btn-tap in
     css/style.css) on whichever button was just clicked. This can't be
     a plain CSS :active rule because :active only lasts as long as the
     mouse button is physically held down, and that ends *before* this
     click handler runs (click fires on mouseup) — so a :active-based
     press would only ever show up on the previously-selected button if
     you happened to still be holding the mouse down on it, not on the
     newly-clicked one. Re-triggering an already-running CSS animation
     needs a reflow between removing and re-adding the class, or rapid
     clicks on the same button (already selected, tapped again) would
     silently no-op on the second tap. */
  function playSortBtnTap(btn) {
    btn.classList.remove('sort-btn-tap');
    void btn.offsetWidth; // force reflow so the animation restarts
    btn.classList.add('sort-btn-tap');
  }
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('animationend', () => btn.classList.remove('sort-btn-tap'));
  });

  document.querySelectorAll('.sort-btn[data-sort-by]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.sortBy = btn.dataset.sortBy;
      document.querySelectorAll('.sort-btn[data-sort-by]').forEach(b => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      playSortBtnTap(btn);
      renderSongList({ animate: true });
    });
  });

  document.querySelectorAll('.sort-btn[data-sort-order]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.sortOrder = btn.dataset.sortOrder;
      document.querySelectorAll('.sort-btn[data-sort-order]').forEach(b => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      playSortBtnTap(btn);
      renderSongList({ animate: true });
    });
  });
}

// ---------------------------------------------------------
// User Songs page: its own list, search, and "+ New song" entry point.
// Deliberately no sort controls (see the planning doc: "Sorting systems
// are not required because Official Songs and User Songs are separate
// sections") — renderSongList() falls back to alphabetical for this
// source on its own (see its hasNumbers note), so there's nothing this
// page needs to drive that itself.
// ---------------------------------------------------------
function bindUserSongsPage() {
  const input = document.getElementById('user-song-search-input');
  input.addEventListener('input', coalesceToNextFrame(() => {
    state.userSongQuery = input.value.trim().toLowerCase();
    renderUserSongList({ animate: true });
  }));

  document.getElementById('new-user-song-btn').addEventListener('click', () => {
    openSongEditor(null);
  });
}

function renderUserSongList(opts = {}) {
  renderSongList({
    sourceKey: 'user',
    listElId: 'user-song-list',
    emptyElId: 'user-songs-empty-state',
    countElId: 'user-songs-results-count',
    query: state.userSongQuery,
    animate: opts.animate,
  });
  document.getElementById('user-songs-empty-state').textContent = t('userSongsEmptyState');
}

function stripChords(lyricsArr) {
  return (Array.isArray(lyricsArr) ? lyricsArr : []).join(' \n ').replace(/\[[^\]]+\]/g, '');
}

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

function searchWords(q) {
  const query = normalizeSearchText(q);
  return query ? query.split(' ').filter(Boolean) : [];
}

// Search performance: the expensive, immutable parts of each song are
// prepared ONCE, but kept outside the song object in a WeakMap. Derived
// search state must never leak into User Song exports/IndexedDB or survive
// an import as stale metadata.
//
// Labels are deliberately NOT cached here. Personal labels can change while
// the same song object remains alive, and preset labels can display
// differently after a language switch.
const songSearchCache = new WeakMap();
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
    const lyrics = normalizeSearchText(stripChords(song.lyrics));
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

function matchesQuery(song, q, sourceKey = state.activeDbSource) {
  const query = normalizeSearchText(q);
  if (!query) return true;

  const words = searchWords(query);
  const { haystack } = getSearchCache(song);
  const labelHaystack = getSearchLabelData(sourceKey, song).haystack;

  // Preserve the current forgiving search behaviour: every query word must
  // exist somewhere, in any order. Labels now participate too, but because
  // ranking is handled separately they do not crowd out stronger title or
  // lyric matches.
  return words.every(word => haystack.includes(word) || labelHaystack.includes(word));
}

// Lower rank = more relevant. This order is intentionally user-facing:
// identify the song first (exact title/number), then title partial matches
// (a song actually called/titled this beats one that merely quotes the
// query somewhere in its lyrics), then lyric/content discovery, and
// finally low-priority metadata (labels and artist).
function relevanceRank(song, q, sourceKey = state.activeDbSource) {
  const query = normalizeSearchText(q);
  if (!query) return 15;

  const words = searchWords(query);
  const {
    title,
    altTitles,
    artist,
    number,
    lyrics,
    titleAndAltHaystack,
    contentHaystack,
  } = getSearchCache(song);
  const { labels, haystack: labelHaystack } = getSearchLabelData(sourceKey, song);

  if (title === query) return 0;                                      // exact main title
  if (altTitles.some(a => a === query)) return 1;                     // exact alternate title
  if (number && number === query) return 2;                           // exact song number
  // Title/alt-title matches (start-of-string or contiguous-substring) rank
  // above an exact lyric phrase on purpose: someone typing what looks like
  // a title wants the song actually called that before a song that merely
  // quotes the same phrase somewhere in its lyrics. The lyric-phrase check
  // still sits above the looser word-scatter checks below it, and above
  // title matches that are themselves only word-scattered (not contiguous)
  // — see relevanceRank's module comment.
  if (title.startsWith(query)) return 3;                              // main title starts with query
  if (altTitles.some(a => a.startsWith(query))) return 4;             // alternate title starts with query
  if (title.includes(query)) return 5;                                // main title contains query
  if (altTitles.some(a => a.includes(query))) return 6;               // alternate title contains query
  if (lyrics.includes(query)) return 7;                               // exact/contiguous lyric phrase
  if (words.every(word => titleAndAltHaystack.includes(word))) return 8; // all words in title/alt-title area
  if (words.every(word => lyrics.includes(word))) return 9;           // all words somewhere in lyrics
  if (words.every(word => contentHaystack.includes(word))) return 10; // words spread across number/title/alt/lyrics
  if (labels.some(label => label === query)) return 11;               // exact label (kept intentionally low)
  if (labels.some(label => label.startsWith(query))) return 12;       // label starts with query
  if (labelHaystack.includes(query) ||
      (words.length && words.every(word => labelHaystack.includes(word)))) return 13; // partial/all-word label
  if (artist.includes(query) ||
      (words.length && words.every(word => artist.includes(word)))) return 14; // artist match

  // A result can still legitimately reach here when its words are split
  // across content + label/artist fields. matchesQuery() allows that useful
  // broad discovery behaviour, but these mixed-metadata matches belong last.
  return 15;
}

// Opportunistically prepare immutable search data only for a database that
// is actually loaded/used. This keeps first-search latency low without
// quietly warming every other registered database in the background.
const searchCacheWarmSources = new Set();
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

// sourceKey (optional) lets this fall back to alphabetical even if
// state.sortBy is still 'num' from a previous source that had numbers —
// e.g. right after switching Settings → Song database from Mongolian to
// English, before the person has had a chance to notice/change the sort
// buttons themselves (which applyDbSource() also updates — see there for
// the other half of this).
function sortSongs(list, q, sourceKey = state.activeDbSource) {
  const arr = [...list];
  const dir = state.sortOrder === 'desc' ? -1 : 1;
  const query = normalizeSearchText(q);
  // Same "user songs aren't in DB_SOURCES" reasoning as renderSongList's
  // own hasNumbers — see the comment there.
  const hasNumbers = sourceKey === 'user' ? false : (DB_SOURCES[sourceKey] || {}).hasNumbers !== false;

  // Array.sort() may compare the same song many times. Relevance now checks
  // several fields (including live labels), so compute each song's rank at
  // most once per sort/render rather than once per comparator invocation.
  const rankCache = query ? new Map() : null;
  const rankFor = (song) => {
    if (!rankCache.has(song)) rankCache.set(song, relevanceRank(song, query, sourceKey));
    return rankCache.get(song);
  };

  arr.sort((a, b) => {
    if (query) {
      const rankA = rankFor(a);
      const rankB = rankFor(b);
      if (rankA !== rankB) return rankA - rankB;
    }
    if (state.sortBy === 'num' && hasNumbers) {
      return (a.number - b.number) * dir;
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

function highlight(text, q) {
  if (!q) return escapeHtml(text);
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return escapeHtml(text);
  return escapeHtml(text.slice(0, idx)) + '<mark>' + escapeHtml(text.slice(idx, idx + q.length)) + '</mark>' + escapeHtml(text.slice(idx + q.length));
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// Search result animations are intentionally limited to rows that are
// actually visible. Animating hundreds/thousands of off-screen rows wastes
// main-thread/compositor work the person can never see. Sampling a few
// points across the viewport handles list/compact/tile layouts without a
// layout read for every row.
function visibleSongRowKeys(listEl) {
  const keys = new Set();
  if (!listEl || !listEl.isConnected || listEl.hidden) return keys;
  const rect = listEl.getBoundingClientRect();
  const top = Math.max(0, rect.top);
  const bottom = Math.min(window.innerHeight, rect.bottom);
  if (bottom <= top || rect.width <= 0) return keys;

  const xPositions = [0.12, 0.5, 0.88].map(ratio =>
    Math.max(1, Math.min(window.innerWidth - 2, rect.left + rect.width * ratio))
  );
  const step = 28;
  for (let y = top + 2; y <= bottom; y += step) {
    xPositions.forEach(x => {
      const hit = document.elementFromPoint(x, y);
      const item = hit && hit.closest ? hit.closest('li[data-row-key]') : null;
      if (item && listEl.contains(item)) keys.add(item.dataset.rowKey);
    });
  }
  // Include the bottom edge in case a short visible row falls between the
  // sampling steps.
  xPositions.forEach(x => {
    const hit = document.elementFromPoint(x, Math.max(top, bottom - 2));
    const item = hit && hit.closest ? hit.closest('li[data-row-key]') : null;
    if (item && listEl.contains(item)) keys.add(item.dataset.rowKey);
  });
  return keys;
}

function renderSongList(opts = {}) {
  const {
    sourceKey = state.activeDbSource,
    listElId = 'song-list',
    emptyElId = 'empty-state',
    countElId = 'results-count',
    query = state.query,
    // Set by the search inputs and sort buttons (see bindSongsPage/
    // bindUserSongsPage) — everything else that re-renders a list (tab
    // navigation, language change, db switch) leaves this off, since an
    // animation there would fire on every page visit rather than reading
    // as a response to something the person just did.
    animate = false,
  } = opts;

  const source = state.sources[sourceKey];
  const listEl = document.getElementById(listElId);
  const emptyEl = document.getElementById(emptyElId);
  const countEl = document.getElementById(countElId);

  if (listEl) {
    listEl.dataset.renderSourceKey = sourceKey;
    listEl.dataset.renderQuery = query || '';
  }

  if (source && DB_SOURCES[sourceKey] && !source.loaded) {
    listEl.innerHTML = '';
    emptyEl.hidden = true;
    countEl.textContent = '';
    if (listElId === 'song-list') {
      setSongSyncProgress(sourceKey, 0, 0, { indeterminate: true });
      updateSongScrollIndex([], false, '');
    }
    return;
  }

  if (!source || source.loadFailed) {
    listEl.innerHTML = `<li class="load-error">${escapeHtml(t('songLoadError'))}</li>`;
    emptyEl.hidden = true;
    countEl.textContent = '';
    if (animate) animateListRefresh(listEl, emptyEl, countEl);
    if (listElId === 'song-list') updateSongScrollIndex([], false, '');
    return;
  }

  const filtered = sortSongs(
    source.songs.filter(s => matchesQuery(s, query, sourceKey)),
    query, sourceKey
  );

  countEl.textContent = filtered.length === source.songs.length
    ? t('resultsAll', filtered.length)
    : t('resultsFiltered', filtered.length, source.songs.length);

  emptyEl.hidden = filtered.length !== 0;

  // Some sources' songs have no `number` field at all (see DB_SOURCES'
  // hasNumbers) — the badge that normally shows it is dropped instead of
  // rendering "undefined" for those. User Songs aren't in DB_SOURCES at
  // all (they're not a fetched database — see state.sources.user's own
  // comment), so they're treated the same as an explicit hasNumbers:
  // false rather than falling through to DB_SOURCES' "unknown key means
  // true" default, which would try to show a number none of these songs
  // actually have.
  const hasNumbers = sourceKey === 'user' ? false : (DB_SOURCES[sourceKey] || {}).hasNumbers !== false;

  const q = query;

  if (!animate || prefersReducedMotion()) {
    // Plain rebuild for non-search-driven renders (tab visits, db switch,
    // language change, reduced-motion) — nothing is animating, so there's
    // no reason to pay for the diff below.
    listEl.innerHTML = '';
    filtered.forEach(song => listEl.appendChild(buildSongRow(song, hasNumbers, q, sourceKey)));
    // The fast-scroll rail (see updateSongScrollIndex()) only exists on
    // the Songbook list — User Songs and playlist song-pickers reuse this
    // same function against their own listElId with no rail in their
    // markup, so this is a no-op for those.
    if (listElId === 'song-list') updateSongScrollIndex(filtered, hasNumbers, q);
    return;
  }

  // Diffed render: only songs that are newly appearing or dropping out of
  // the results fade — anything present both before and after this render
  // (the common case, since one keystroke usually only trims a few songs)
  // is reused as-is and just repositioned, so it never flickers. Rows are
  // keyed by sourceKey+id rather than id alone so a db switch (which
  // reuses this same function against a different source but can, in
  // principle, share this listEl across renders) can never accidentally
  // treat a same-numbered song from a different source as a match.
  const existingRows = new Map();
  Array.from(listEl.children).forEach(li => {
    if (li.dataset.rowKey) existingRows.set(li.dataset.rowKey, li);
  });

  const visibleBefore = visibleSongRowKeys(listEl);
  const fragment = document.createDocumentFragment();
  const keptKeys = new Set();
  const newRows = new Map();

  filtered.forEach(song => {
    const key = `${sourceKey}:${song.id}`;
    keptKeys.add(key);
    let li = existingRows.get(key);
    if (li) {
      // Already on screen — bring back from a leave-animation if this
      // song reappeared mid-fade (e.g. one character got backspaced),
      // and refresh its highlighted title text for the new query.
      if (li.dataset.state === 'exiting') {
        delete li.dataset.state;
        li.classList.remove('song-row-exit');
        if (li._exitCleanup) {
          li.removeEventListener('animationend', li._exitCleanup);
          li._exitCleanup = null;
        }
      }
      updateSongRowContent(li, song, hasNumbers, q);
    } else {
      li = buildSongRow(song, hasNumbers, q, sourceKey);
      newRows.set(key, li);
    }
    fragment.appendChild(li); // detaches reused rows from listEl, leaving only dropped-out ones behind
  });

  // Whatever's left in listEl now fell out of the results — fade each one
  // out and remove it once its animation finishes, instead of cutting it
  // instantly.
  existingRows.forEach((li, key) => {
    if (keptKeys.has(key) || li.dataset.state === 'exiting') return;
    if (!visibleBefore.has(key)) {
      li.remove();
      return;
    }
    li.dataset.state = 'exiting';
    li.classList.add('song-row-exit');
    const cleanup = () => {
      li.removeEventListener('animationend', cleanup);
      li._exitCleanup = null;
      li.remove();
    };
    li._exitCleanup = cleanup;
    li.addEventListener('animationend', cleanup);
  });

  // New order goes in ahead of anything still fading out, so the visible
  // results read top-to-bottom correctly while leaving rows finish
  // underneath.
  listEl.insertBefore(fragment, listEl.firstChild);

  // Force one layout read now to identify which newly-created rows are
  // actually visible, then add animation classes before the browser paints.
  // This avoids both off-screen animation work and a one-frame flash where a
  // new row would otherwise appear fully opaque before its animation starts.
  if (newRows.size) {
    const visibleAfter = visibleSongRowKeys(listEl);
    visibleAfter.forEach(key => {
      const li = newRows.get(key);
      if (!li || !listEl.contains(li)) return;
      li.classList.add('song-row-enter');
      li.addEventListener('animationend', function onEnd() {
        li.classList.remove('song-row-enter');
        li.removeEventListener('animationend', onEnd);
      }, { once: true });
    });
  }

  if (listElId === 'song-list') updateSongScrollIndex(filtered, hasNumbers, q);
}

// Returning to Songs should not rebuild thousands of rows just because the
// page became visible again. The rows themselves are already current; the
// only thing that needs a visible-page pass is the fast-scroll rail, whose
// pixel positions can't be measured correctly while #page-songs is hidden.
function onSongsPageEnter() {
  const source = state.sources[state.activeDbSource];
  const listEl = document.getElementById('song-list');

  if (!source || !source.loaded) {
    renderSongLoadingState();
    if (source && !source.loadPromise) {
      loadSongDataFor(state.activeDbSource).then(() => {
        if (state.currentPage === 'songs') renderSongList();
      });
    }
    return;
  }

  const renderMatchesCurrentState = listEl
    && listEl.dataset.renderSourceKey === state.activeDbSource
    && listEl.dataset.renderQuery === (state.query || '');

  if (!renderMatchesCurrentState) {
    renderSongList();
    return;
  }

  refreshSongScrollIndexMeasurements();
}

function refreshSongScrollIndexMeasurements() {
  if (!scrollIndexEntries.length) return;
  scrollIndexEntries = measureScrollIndexEntries(scrollIndexEntries);
  updateScrollThumbPosition();
}

// ---------------------------------------------------------
// Songbook fast-scroll indicator — a small One-UI/Pixel-style scrollbar
// thumb along the right edge of the Songbook list (#song-list
// specifically; see #song-scroll-index/#song-scroll-thumb in index.html
// and its CSS in css/style.css). Not a permanently-visible A-Z rail: it
// rests as a faint, still-touchable sliver when the list is still,
// brightens to fully solid the instant the list scrolls — by an ordinary
// touch-swipe OR by dragging the thumb itself — and only pops up a
// letter/number bubble while the thumb is actually being dragged.
// Songbook-only (#song-list specifically) — User Songs and playlist
// song-pickers have no rail in their markup, so updateSongScrollIndex()
// below is a no-op for those (see its call sites in renderSongList).
// ---------------------------------------------------------

// A handful of Cyrillic capitals are visually identical, in this UI's
// fonts, to a Latin capital — Cyrillic А/В/Е/К/М/Н/О/Р/С/Т/Х render as the
// exact same glyph shapes as Latin A/B/E/K/M/H/O/P/C/T/X. Without this map,
// a Mongolian-source title starting with Cyrillic "А" and an English-source
// title starting with Latin "A" would land in two different scroll-index
// buckets that look identical on the popup — so this folds the Cyrillic
// lookalike onto its Latin twin before bucketing.
const CYRILLIC_LATIN_HOMOGLYPHS = {
  'А': 'A', 'В': 'B', 'Е': 'E', 'К': 'K', 'М': 'M',
  'Н': 'H', 'О': 'O', 'Р': 'P', 'С': 'C', 'Т': 'T', 'Х': 'X'
};

// Canonicalizes a title's leading character into the scroll-index bucket
// label it belongs in: a leading digit always collapses to a single '#'
// bucket (rather than separate 1/2/3… entries fragmenting the alphabetic
// index), and CYRILLIC_LATIN_HOMOGLYPHS above merges lookalike letters.
function scrollIndexLetter(title) {
  const raw = (title || '').trim().charAt(0);
  if (!raw || /[0-9]/.test(raw)) return '#';
  const upper = raw.toUpperCase();
  return CYRILLIC_LATIN_HOMOGLYPHS[upper] || upper;
}

// Groups the already-sorted list into buckets and records, for each
// bucket, the index (into that same sorted array) of the first song in
// it. Only detects where a bucket *changes* from the previous song, so it
// automatically reads correctly whichever direction the list is sorted in
// (ascending or descending) without needing to know which — sortSongs()
// already applied that direction before this ever runs, so "the next
// bucket" just falls out of walking the array in order either way.
function computeScrollIndexEntries(sortedSongs, sortBy, hasNumbers) {
  const entries = [];
  if (sortBy === 'num' && hasNumbers) {
    // Buckets of ten (0, 10, 20, 30…) rather than one entry per song
    // number — a continuous drag already covers the fine positions
    // between buckets, so this just keeps the popup's number changing at
    // a sensible, readable rate as you drag.
    let lastBucket = null;
    sortedSongs.forEach((song, i) => {
      if (typeof song.number !== 'number') return;
      const bucket = Math.floor(song.number / 10) * 10;
      if (bucket !== lastBucket) {
        entries.push({ label: String(bucket), index: i });
        lastBucket = bucket;
      }
    });
  } else {
    let lastLetter = null;
    sortedSongs.forEach((song, i) => {
      const letter = scrollIndexLetter(song.title);
      if (letter !== lastLetter) {
        entries.push({ label: letter, index: i });
        lastLetter = letter;
      }
    });
  }
  return entries;
}

// Populated by updateSongScrollIndex() below; each entry also gets a
// `.top` (see measureScrollIndexEntries) recording where its first song's
// row actually sits within the Songbook page's scrollable content, so a
// scrollTop reached mid-drag can be mapped back to "which bucket is this"
// (see labelForScrollTop()). Whether those buckets are numbers or letters
// for the *current* render — needed so the popup knows which font/style
// to use — is tracked alongside in scrollIndexIsNumeric.
let scrollIndexEntries = [];
let scrollIndexIsNumeric = false;

// #page-songs is the actual scrolling element (see .page's overflow-y:auto
// in css/style.css) — #song-list itself doesn't scroll on its own — so
// every row's position has to be measured relative to that, not the
// viewport or #song-list.
function measureScrollIndexEntries(entries) {
  const listEl = document.getElementById('song-list');
  const pageEl = document.getElementById('page-songs');
  if (!listEl || !pageEl) return entries;
  const pageTop = pageEl.getBoundingClientRect().top;
  const baseScroll = pageEl.scrollTop;
  entries.forEach(entry => {
    const li = listEl.children[entry.index];
    entry.top = li ? (li.getBoundingClientRect().top - pageTop + baseScroll) : 0;
  });
  return entries;
}

// Rebuilds scrollIndexEntries from whatever the Songbook list's most
// recent render actually produced, and re-syncs the thumb to the list's
// current scroll position. Called from renderSongList() itself (see its
// two `if (listElId === 'song-list')` call sites) so the indicator always
// reflects the current source, sort, and direction with no separate
// wiring at each of their own call sites (search input, both sort-button
// groups, db switch, language change all already funnel through
// renderSongList).
function updateSongScrollIndex(sortedSongs, hasNumbers, query) {
  const track = document.getElementById('song-scroll-index');
  if (!track) return;

  // A search query narrows the list to a subset that may skip whole
  // buckets/letters entirely — "jump to the S section" stops meaning
  // anything coherent once the list itself isn't the full songbook
  // anymore, so the indicator just steps aside until the search is
  // cleared.
  if (query) {
    scrollIndexEntries = [];
    track.hidden = true;
    return;
  }

  const isNumeric = state.sortBy === 'num' && hasNumbers;
  const entries = computeScrollIndexEntries(sortedSongs, state.sortBy, hasNumbers);

  // Fewer than two entries means the whole list is already one bucket —
  // nothing meaningful to jump between, and a list that short rarely
  // needs a scrollbar assist anyway.
  if (entries.length < 2) {
    scrollIndexEntries = [];
    track.hidden = true;
    return;
  }

  scrollIndexIsNumeric = isNumeric;
  scrollIndexEntries = measureScrollIndexEntries(entries);
  track.hidden = false;
  updateScrollThumbPosition();
}

// Returned by labelForScrollTop() below instead of a real bucket label
// when the drag position is still above the very first bucket — i.e.
// still within the header/search-bar area at the top of the Songbook
// page, where no letter/number applies yet. applyDrag() checks for this
// exact value to swap the bubble into its icon state (see
// .scroll-index-bubble.is-search in css/style.css) rather than printing
// it as text.
const SCROLL_INDEX_SEARCH_LABEL = '__search__';

// Finds which bucket a given scrollTop currently falls in — the last
// entry whose row hasn't scrolled past yet — the same "which section am I
// in" logic a sticky section header would use. Assumes scrollIndexEntries
// is already sorted top-to-bottom, which it always is: it's built by
// walking the sorted song list in order.
//
// maxScroll (the deepest #page-songs can ever actually scroll to) matters
// here for a reason that isn't obvious from the loop below: whenever the
// content from the LAST bucket's row to the very end of the list is
// shorter than one screenful — normal for Tiles, where ten songs' worth
// of a bucket can be barely a hundred pixels tall — that row's own
// measured top ends up further down the page than the deepest point
// it's ever possible to scroll to. Its "have we scrolled far enough"
// check then never passes, no matter how far you drag, and dragging to
// the very bottom silently reports an earlier bucket instead — the
// popup topping out at, say, "310" or "340" when the list actually goes
// to "360". Treating "at the bottom of the scrollable area" as always
// meaning the last bucket sidesteps that entirely, and matches what
// dragging all the way down actually means to someone doing it.
function labelForScrollTop(scrollTop, maxScroll) {
  const entries = scrollIndexEntries;
  if (!entries.length) return '';
  // Above the first bucket's own row — still in the search-bar/header
  // area, not any lettered/numbered section yet.
  if (scrollTop < entries[0].top - 1) return SCROLL_INDEX_SEARCH_LABEL;
  if (maxScroll != null && scrollTop >= maxScroll - 1) {
    return entries[entries.length - 1].label;
  }
  let current = entries[0];
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].top <= scrollTop + 1) current = entries[i];
    else break;
  }
  return current.label;
}

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
const THUMB_SQUISH_MAX = 0.6;       // clamp so a hard flick can't look broken

// Writes the thumb's position and current squish together as one
// transform — see the CSS comment on .scroll-thumb for why these two
// pieces have to be combined here rather than split across a JS-driven
// translate and a CSS-transitioned scale.
function renderThumbTransform() {
  const thumb = document.getElementById('song-scroll-thumb');
  if (!thumb) return;
  const s = Math.max(-THUMB_SQUISH_MAX, Math.min(THUMB_SQUISH_MAX, thumbSquish));
  const scaleY = 1 + s;
  const scaleX = 1 - s * 0.6;
  thumb.style.transform = `translateY(${thumbTranslateY}px) scaleY(${scaleY.toFixed(3)}) scaleX(${scaleX.toFixed(3)})`;
}

// The spring's own animation loop — steps thumbSquish/thumbSquishVelocity
// one frame via simple Euler integration and keeps re-scheduling itself
// only while there's still visible motion, so it stops (and stays
// stopped) the moment the thumb settles back to its resting shape.
function stepThumbSquish(now) {
  const last = thumbSquishLastFrame || now;
  const dt = Math.min(0.032, Math.max(0, (now - last) / 1000));
  thumbSquishLastFrame = now;
  const force = -THUMB_SQUISH_STIFFNESS * thumbSquish - THUMB_SQUISH_DAMPING * thumbSquishVelocity;
  thumbSquishVelocity += force * dt;
  thumbSquish += thumbSquishVelocity * dt;
  renderThumbTransform();
  if (Math.abs(thumbSquish) > 0.002 || Math.abs(thumbSquishVelocity) > 0.002) {
    thumbSquishRAF = requestAnimationFrame(stepThumbSquish);
  } else {
    thumbSquish = 0;
    thumbSquishVelocity = 0;
    renderThumbTransform();
    thumbSquishRAF = null;
    thumbSquishLastFrame = null;
  }
}

// Kicks the spring with an instantaneous velocity change — a quick squeeze
// on grab, or an ongoing nudge proportional to drag speed — and (re)starts
// the animation loop if it isn't already running.
function nudgeThumbSquish(velocityDelta) {
  thumbSquishVelocity += velocityDelta;
  if (!thumbSquishRAF) {
    thumbSquishLastFrame = null;
    thumbSquishRAF = requestAnimationFrame(stepThumbSquish);
  }
}

// Moves the thumb to match #page-songs' current scroll position —
// continuous/proportional, like a normal scrollbar, not stepped between
// buckets. Called on every scroll event and right after a fresh render.
function updateScrollThumbPosition() {
  const track = document.getElementById('song-scroll-index');
  const thumb = document.getElementById('song-scroll-thumb');
  const pageEl = document.getElementById('page-songs');
  if (!track || !thumb || !pageEl || track.hidden) return;
  const travel = Math.max(0, track.getBoundingClientRect().height - thumb.offsetHeight);
  const maxScroll = Math.max(1, pageEl.scrollHeight - pageEl.clientHeight);
  const ratio = Math.min(1, Math.max(0, pageEl.scrollTop / maxScroll));
  thumbTranslateY = ratio * travel;
  renderThumbTransform();
}

// Brings the indicator to full opacity (see .scroll-index.is-active in
// css/style.css) and cancels any pending fade — used both by an ordinary
// list scroll and by grabbing the thumb itself.
function setScrollIndexActive(active) {
  const track = document.getElementById('song-scroll-index');
  if (track) track.classList.toggle('is-active', active);
}

let scrollIndexIdleTimer = null;
let scrollIndexDragging = false;

// Fades the indicator back to its quiet resting state a moment after
// scrolling/dragging stops — never while still dragging (checked at fire
// time, not at schedule time, so holding the thumb still mid-drag doesn't
// fade it out from under your finger).
function scheduleScrollIndexFade() {
  if (scrollIndexIdleTimer) clearTimeout(scrollIndexIdleTimer);
  scrollIndexIdleTimer = setTimeout(() => {
    if (!scrollIndexDragging) setScrollIndexActive(false);
  }, 900);
}

// Tap-to-jump and drag-to-scrub on the indicator as a single pointerdown/
// pointermove/pointerup trio — Pointer Events unify mouse and touch, so
// this covers both a desktop click and a phone drag with one code path. A
// tap is simply a pointerdown with no follow-up pointermove, so it's
// handled the same way a drag's first frame is: both just set the page's
// scrollTop to whatever position was touched.
function bindScrollIndexInteraction() {
  const track = document.getElementById('song-scroll-index');
  const bubble = document.getElementById('song-scroll-index-bubble');
  const pageEl = document.getElementById('page-songs');
  if (!track || !pageEl) return;

  // Ordinary swipe-scrolling of the list: brings the thumb to full opacity
  // and keeps it tracking the scroll position in real time, but never
  // shows the popup bubble — that's reserved for actually grabbing the
  // thumb (see pointerdown below), matching the reference behavior of a
  // plain scroll vs. a deliberate scrub.
  pageEl.addEventListener('scroll', () => {
    if (track.hidden) return;
    updateScrollThumbPosition();
    setScrollIndexActive(true);
    scheduleScrollIndexFade();
  }, { passive: true });

  // Tracks the previous drag position/time so applyDrag() can turn "how
  // fast is this drag moving right now" into a squish impulse (see
  // nudgeThumbSquish) — reset to null at the start of every new drag (in
  // pointerdown below) so the first move of a new drag never computes a
  // bogus speed against a leftover position from a previous one.
  let lastDragY = null;
  let lastDragTime = null;

  function applyDrag(clientY) {
    const rect = track.getBoundingClientRect();
    const ratio = rect.height === 0 ? 0 : Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
    const maxScroll = Math.max(1, pageEl.scrollHeight - pageEl.clientHeight);
    pageEl.scrollTop = ratio * maxScroll;
    updateScrollThumbPosition();

    // The faster the drag is currently moving, the more the thumb
    // stretches — same spring as the grab squeeze below, just fed
    // continuously while scrubbing instead of as one initial kick.
    const now = performance.now();
    if (lastDragY !== null) {
      const dt = Math.max(1, now - lastDragTime);
      const speed = Math.abs(clientY - lastDragY) / dt; // px per ms
      if (speed > 0) nudgeThumbSquish(Math.min(2.6, speed * 3.2));
    }
    lastDragY = clientY;
    lastDragTime = now;

    if (bubble) {
      const label = labelForScrollTop(pageEl.scrollTop, maxScroll);
      const isSearch = label === SCROLL_INDEX_SEARCH_LABEL;
      const labelEl = document.getElementById('song-scroll-index-bubble-label');
      const labelText = isSearch ? '' : label;
      // Only re-measure/animate width when the label actually changed —
      // during a fast drag this function can run many times per frame,
      // and re-running the measure-and-restart dance on every single call
      // regardless (as this used to) forces a layout thrash each time and
      // races with itself: by the time a later call reads the "current"
      // width to animate from, an earlier call's update may not have
      // committed yet, so the box reads a stale size and appears stuck
      // until the drag slows down enough for everything to catch up.
      // Skipping the work entirely when nothing changed removes both the
      // thrash and the race.
      if (labelEl && labelEl.textContent !== labelText) {
        labelEl.textContent = labelText;
        // Crossing a digit boundary (song 9 -> 10, 99 -> 100) changes how
        // wide the label naturally needs to be — measure that with the
        // constraint released for a moment, then commit the new width
        // immediately (synchronously, not via requestAnimationFrame) so
        // the CSS transition picks it up from whatever was last actually
        // painted and animates straight to it, with no deferred step for
        // a later call to race against.
        bubble.style.width = 'auto';
        const naturalWidth = bubble.offsetWidth;
        bubble.style.width = naturalWidth + 'px';
        // A small squishy "tick" pop each time the drag crosses into a
        // new letter/number bucket — remove-reflow-readd so consecutive
        // bucket changes during a fast drag each get their own pop rather
        // than one call's animation just continuing where the last left
        // off (same retrigger pattern used for row enter/exit animations
        // elsewhere in this file).
        bubble.classList.remove('is-ticking');
        void bubble.offsetWidth;
        bubble.classList.add('is-ticking');
      }
      bubble.classList.toggle('is-search', isSearch);
      bubble.classList.toggle('is-numeric', !isSearch && scrollIndexIsNumeric);
      // Centered on the touch/cursor position, but clamped to stay fully
      // within the viewport — near the very top of the track (barely
      // below the status bar/notch) an uncentered bubble would otherwise
      // hang half off the top of the screen, and this keeps it fully
      // visible at any drag position on any device instead.
      const margin = 4;
      const desiredTop = clientY - bubble.offsetHeight / 2;
      const maxTop = window.innerHeight - bubble.offsetHeight - margin;
      const clampedTop = Math.max(margin, Math.min(maxTop, desiredTop));
      bubble.style.top = `${Math.round(clampedTop)}px`;
    }
  }

  track.addEventListener('pointerdown', (e) => {
    if (track.hidden) return;
    scrollIndexDragging = true;
    lastDragY = null;
    lastDragTime = null;
    if (track.setPointerCapture) track.setPointerCapture(e.pointerId);
    setScrollIndexActive(true);
    track.classList.add('is-dragging');
    // The initial "grabbed!" squeeze — a quick squash that the spring
    // rebounds out of on its own (see stepThumbSquish), independent of
    // any actual movement yet.
    nudgeThumbSquish(-4.2);
    if (bubble) {
      bubble.classList.add('is-visible');
      // Give the bubble a concrete starting width (rather than leaving it
      // on its auto/fit-content sizing) so the very first label of this
      // drag has an actual pixel value to transition width from, instead
      // of snapping in at whatever size the new label happens to need.
      bubble.style.width = bubble.offsetWidth + 'px';
    }
    applyDrag(e.clientY);
    e.preventDefault();
  });
  track.addEventListener('pointermove', (e) => {
    if (!scrollIndexDragging) return;
    applyDrag(e.clientY);
  });
  const endDrag = () => {
    if (!scrollIndexDragging) return;
    scrollIndexDragging = false;
    track.classList.remove('is-dragging');
    if (bubble) bubble.classList.remove('is-visible');
    scheduleScrollIndexFade();
  };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);
  if (bubble) {
    bubble.addEventListener('animationend', (e) => {
      if (e.animationName === 'scroll-bubble-tick') bubble.classList.remove('is-ticking');
    });
  }

  // A resize (rotation, on-screen keyboard, browser chrome show/hide) can
  // change the track's own height or the page's scrollable range without
  // firing a scroll event, so the thumb needs its own recompute here too.
  window.addEventListener('resize', () => updateScrollThumbPosition());
}

// Song-list subtitle priority: show the first alternate title when one
// exists; the artist is only a fallback. This applies consistently across
// the main song list, playlist contents, and the add-songs picker so a
// remembered/secondary song name is visible wherever songs are browsed.
function getSongListSubtitle(song) {
  if (!song) return '';
  const rawAltTitles = Array.isArray(song.alternateTitles)
    ? song.alternateTitles
    : (song.alternateTitles ? [song.alternateTitles] : []);
  const firstAltTitle = rawAltTitles
    .map(title => String(title || '').trim())
    .find(Boolean);
  if (firstAltTitle) return firstAltTitle;
  return String(song.artist || '').trim();
}

function buildSongRow(song, hasNumbers, q, sourceKey) {
  const li = document.createElement('li');
  li.dataset.rowKey = `${sourceKey}:${song.id}`;
  const row = document.createElement('button');
  row.className = 'song-row';
  row.addEventListener('click', () => tapSongRowThenOpen(row, () => openSong(song, { sourceKey })));
  li.appendChild(row);
  updateSongRowContent(li, song, hasNumbers, q);
  return li;
}

function updateSongRowContent(li, song, hasNumbers, q) {
  const row = li.firstElementChild;
  // Read by the #song-list[data-view="tiles"] CSS (see style.css) to fall
  // back to showing the title when a source has no song numbers to put
  // in a tile (see DB_SOURCES' hasNumbers) — harmless in list/compact,
  // where nothing selects on this class.
  row.classList.toggle('has-badge', hasNumbers);
  const subtitle = getSongListSubtitle(song);
  row.innerHTML = `
    ${hasNumbers ? `<span class="song-badge">${song.number}</span>` : ''}
    <span class="song-row-text">
      <span class="song-row-title">${highlight(song.title, q)}</span>
      ${subtitle ? `<span class="song-row-sub">${highlight(subtitle, q)}</span>` : ''}
    </span>
  `;
}

// Whole-block opacity/translate dip-and-recover. Ordinary search/sort
// updates no longer use this — see the per-row song-row-enter/exit
// animations in renderSongList's diffed render — but it's kept here for
// the "source failed to load" branch above, where there's no song list to
// diff against, just the list/empty-state/count settling in together.
// Restarting a CSS animation that's already mid-flight needs the
// remove/reflow/re-add dance (same trick used for the page-slide and
// heart-pop animations elsewhere in this file), since re-adding a class
// that's already present is a no-op.
function animateListRefresh(...els) {
  if (prefersReducedMotion()) return;
  const targets = els.filter(Boolean);
  if (!targets.length) return;
  targets.forEach(el => el.classList.remove('list-refresh-flash'));
  void targets[0].offsetWidth;
  targets.forEach(el => el.classList.add('list-refresh-flash'));
}

// ---------------------------------------------------------
// Song view: chord-over-lyric rendering + transpose
// ---------------------------------------------------------
function bindSongView() {
  document.getElementById('back-btn').addEventListener('click', () => history.back());

  document.getElementById('transpose-up').addEventListener('click', () => {
    if (state.transpose >= TRANSPOSE_LIMIT) return;
    state.transpose += 1;
    updateTransposeUI({ animate: true });
  });
  document.getElementById('transpose-down').addEventListener('click', () => {
    if (state.transpose <= -TRANSPOSE_LIMIT) return;
    state.transpose -= 1;
    updateTransposeUI({ animate: true });
  });
  document.getElementById('transpose-reset').addEventListener('click', () => {
    if (state.transpose === 0) return;
    state.transpose = 0;
    updateTransposeUI({ animate: true });
  });

  document.querySelectorAll('[data-font]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.font;
      if (action === 'lyrics-up') state.lyricsSize = Math.min(1.6, state.lyricsSize + 0.08);
      if (action === 'lyrics-down') state.lyricsSize = Math.max(0.75, state.lyricsSize - 0.08);
      if (action === 'chords-up') state.chordSize = Math.min(1.2, state.chordSize + 0.06);
      if (action === 'chords-down') state.chordSize = Math.max(0.6, state.chordSize - 0.06);
      applyFontSizes();
      localStorage.setItem('sb-lyrics-size', state.lyricsSize);
      localStorage.setItem('sb-chord-size', state.chordSize);
    });
  });

  document.getElementById('sv-favorite-btn').addEventListener('click', () => {
    const song = state.activeSong;
    if (!song) return;
    toggleFavorite(state.activeSourceKey, song.id);
    updateFavoriteButtonUI();
    const favBtn = document.getElementById('sv-favorite-btn');
    favBtn.classList.remove('heart-pop');
    void favBtn.offsetWidth; // restart the animation if a previous tap's spin hasn't finished
    favBtn.classList.add('heart-pop');
    favBtn.addEventListener('animationend', () => favBtn.classList.remove('heart-pop'), { once: true });
  });

  document.getElementById('sv-menu-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSongViewMenu();
  });
  document.addEventListener('click', () => closeSongViewMenu());
}

// The "…" menu itself has no reason to hide anymore — "Add to playlist"
// applies to every song, official or user-authored — so this is now just
// a safety net that closes any open dropdown when the active song or
// language changes out from under it (called from openSong() and again
// from applyLanguage()).
function updateSongViewMenuUI() {
  closeSongViewMenu();
}

let songViewMenuOpen = false;
function toggleSongViewMenu() {
  songViewMenuOpen ? closeSongViewMenu() : openSongViewMenu();
}

function openSongViewMenu() {
  const song = state.activeSong;
  if (!song) return;
  closeSongViewMenu();
  const isUserSong = state.activeSourceKey === 'user';
  const btn = document.getElementById('sv-menu-btn');
  const wrap = document.createElement('div');
  wrap.className = 'kebab-dropdown';
  wrap.id = 'sv-kebab-dropdown';
  wrap.innerHTML = `
    <button type="button" id="sv-kebab-add-playlist"><svg data-icon="plus" viewBox="0 0 24 24"></svg>${escapeHtml(t('addToPlaylistTitle'))}</button>
    <button type="button" id="sv-kebab-labels"><svg data-icon="tag" viewBox="0 0 24 24"></svg>${escapeHtml(t('editLabelsBtn'))}</button>
    ${isUserSong ? `
    <button type="button" id="sv-kebab-edit"><svg data-icon="pencil" viewBox="0 0 24 24"></svg>${escapeHtml(t('editBtn'))}</button>
    <button type="button" id="sv-kebab-delete" class="is-danger"><svg data-icon="trash" viewBox="0 0 24 24"></svg>${escapeHtml(t('menuDelete'))}</button>
    ` : ''}
    <button type="button" id="sv-kebab-presentation" aria-pressed="${String(state.presentationMode)}"><svg data-icon="presentation" viewBox="0 0 24 24"></svg>${escapeHtml(state.presentationMode ? t('exitPresentationModeBtn') : t('presentationModeBtn'))}</button>
  `;
  btn.parentElement.style.position = 'relative';
  btn.parentElement.appendChild(wrap);
  initIcons(wrap);
  songViewMenuOpen = true;

  wrap.querySelector('#sv-kebab-add-playlist').addEventListener('click', (e) => {
    e.stopPropagation();
    closeSongViewMenu();
    openAddToPlaylistModal(state.activeSourceKey, song.id);
  });
  wrap.querySelector('#sv-kebab-labels').addEventListener('click', (e) => {
    e.stopPropagation();
    closeSongViewMenu();
    openEditLabelsModal(state.activeSourceKey, song.id);
  });
  const editBtn = wrap.querySelector('#sv-kebab-edit');
  if (editBtn) editBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeSongViewMenu();
    openSongEditor(song);
  });
  const deleteBtn = wrap.querySelector('#sv-kebab-delete');
  if (deleteBtn) deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeSongViewMenu();
    confirmDeleteUserSong(song);
  });
  wrap.querySelector('#sv-kebab-presentation').addEventListener('click', (e) => {
    e.stopPropagation();
    closeSongViewMenu();
    togglePresentationMode();
  });
  wrap.addEventListener('click', (e) => e.stopPropagation());
}

function closeSongViewMenu() {
  const wrap = document.getElementById('sv-kebab-dropdown');
  songViewMenuOpen = false;
  if (!wrap) return;
  if (prefersReducedMotion()) { wrap.remove(); return; }
  // See closePlaylistMenu()'s comment on why the id is freed up-front.
  wrap.removeAttribute('id');
  wrap.classList.add('kebab-dropdown-exit');
  wrap.addEventListener('animationend', () => wrap.remove(), { once: true });
}

// Presentation mode: hides everything on the song view except the lyrics
// themselves — back button, favorite, transpose, text size, links, audio
// — for reading off a screen while projecting without any of the app's
// own chrome competing for attention. The "…" menu is the one thing that
// stays, since it's the only way back out of this mode; applyPresentationMode()
// (via #page-song-view.presentation-mode in style.css) shrinks it down to
// a low-profile dot instead of hiding it outright.
function togglePresentationMode() {
  state.presentationMode = !state.presentationMode;
  applyPresentationMode();
}
function applyPresentationMode() {
  document.getElementById('page-song-view').classList.toggle('presentation-mode', state.presentationMode);
}

function updateFavoriteButtonUI() {
  const song = state.activeSong;
  const btn = document.getElementById('sv-favorite-btn');
  if (!btn || !song) return;
  const isFav = isSongInPlaylist('favorites', state.activeSourceKey, song.id);
  btn.setAttribute('aria-pressed', String(isFav));
  const svg = btn.querySelector('svg');
  if (svg) svg.setAttribute('data-icon', isFav ? 'heart-filled' : 'heart-outline');
  injectIcon(svg);
}

// Chromium's native <audio controls> is a shadow-DOM widget (play button,
// scrubber, time, volume) that's laid out once when the element becomes
// visible. openSong() below builds it via innerHTML while the song-view
// page is still hidden/off-screen (so its content is ready the instant the
// page transition starts), which means that first layout pass can happen
// before the element has real size — the controls then render blank or as
// disconnected fragments, and stay that way until something forces a
// reflow. A tap does that by accident; this does it on purpose, right
// after the page has actually become visible; toggling `hidden` twice is a
// no-op visually but makes the browser redo layout for the audio controls.
function fixNativeAudioControlsPaint() {
  document.querySelectorAll('#sv-audio audio').forEach(a => {
    a.hidden = true;
    // eslint-disable-next-line no-unused-expressions
    void a.offsetHeight;
    a.hidden = false;
  });
}

function openSong(song, opts = {}) {
  const { pushHistory = true, sourceKey = state.activeDbSource } = opts;
  state.activeSong = song;
  state.activeSourceKey = sourceKey;
  state.transpose = 0;

  const numberEl = document.getElementById('sv-number');
  if (song.number != null) {
    numberEl.textContent = `#${song.number}`;
    numberEl.hidden = false;
  } else {
    // Some sources' songs have no number (see DB_SOURCES' hasNumbers) —
    // hide the badge entirely rather than show "#undefined".
    numberEl.textContent = '';
    numberEl.hidden = true;
  }
  document.getElementById('sv-title').textContent = song.title;

  const altEl = document.getElementById('sv-alt-title');
  const altTitles = (song.alternateTitles || []).filter(Boolean);
  if (altTitles.length) {
    // Now rendered at the bottom of the song (see index.html), detached
    // from the title it's naming — so it gets a translated label prefix
    // (t('altTitlesPrefix')) here that it didn't need when it sat right
    // under the title itself.
    altEl.textContent = `${t('altTitlesPrefix')} ${altTitles.join(' • ')}`;
    altEl.hidden = false;
  } else {
    altEl.textContent = '';
    altEl.hidden = true;
  }

  const artistEl = document.getElementById('sv-artist');
  if (song.artist) {
    artistEl.textContent = song.artist;
    artistEl.hidden = false;
  } else {
    artistEl.textContent = '';
    artistEl.hidden = true;
  }

  renderSongViewLabels(sourceKey, song);

  const audioEl = document.getElementById('sv-audio');
  // Pause/release whatever's currently playing before we blow it away with
  // innerHTML below. If a track is mid-playback, the browser/OS may have
  // already registered it with the system media session (that's the little
  // floating play-bar widget Android shows) — just overwriting innerHTML
  // destroys the <audio> element without telling the OS, so that widget is
  // left behind with nothing playing underneath it, which is what made it
  // look broken/shrunk. Explicitly pausing and clearing src first makes the
  // browser tear the media session down cleanly.
  audioEl.querySelectorAll('audio').forEach(a => {
    a.pause();
    a.removeAttribute('src');
    a.load();
  });
  if (song.audio && song.audio.length) {
    audioEl.hidden = false;
    audioEl.innerHTML = song.audio.map(a => {
      const url = escapeHtml(a.url || a);
      return `
        <div class="audio-item">
          <audio controls style="width:100%" src="${url}"></audio>
        </div>`;
    }).join('');
  } else {
    audioEl.hidden = true;
    audioEl.innerHTML = '';
  }

  const linksEl = document.getElementById('sv-links');
  if (song.links && song.links.length) {
    linksEl.hidden = false;
    linksEl.innerHTML = song.links.map(l => {
      const url = typeof l === 'string' ? l : l.url;
      const label = (typeof l === 'object' && l.label) ? l.label : t('listenLink');
      return `<a class="sv-link-btn" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
    }).join('');
  } else {
    linksEl.hidden = true;
    linksEl.innerHTML = '';
  }

  updateTransposeUI();
  updateFavoriteButtonUI();
  updateSongViewMenuUI();
  showPage('song-view', { resetScroll: true });
  if (pushHistory) {
    pushNavState({ page: 'song-view', songId: song.id, sourceKey });
  }
}

function updateTransposeUI(opts = {}) {
  const { animate = false } = opts;
  const offsetEl = document.getElementById('transpose-offset');
  offsetEl.textContent = (state.transpose > 0 ? '+' : '') + state.transpose;
  if (animate && !prefersReducedMotion()) {
    // Reuses chord-pop's spring keyframe — same little "settle in" pop as
    // each transposed chord gets, just on the offset readout itself
    // instead of snapping straight to the new digit.
    offsetEl.classList.remove('chord-pop');
    void offsetEl.offsetWidth;
    offsetEl.classList.add('chord-pop');
  }
  document.getElementById('transpose-up').disabled = state.transpose >= TRANSPOSE_LIMIT;
  document.getElementById('transpose-down').disabled = state.transpose <= -TRANSPOSE_LIMIT;
  const song = state.activeSong;
  document.getElementById('sv-key').textContent = song ? transposeChord(song.key, state.transpose) : '—';
  renderLyrics({ animateChords: animate });
}

function transposeChord(chord, steps) {
  if (!chord || !steps) return chord;
  // Split root (+ optional accidental) from the rest (quality/extensions), and handle slash bass.
  const parts = chord.split('/');
  const transposedParts = parts.map(part => transposeSingle(part, steps));
  return transposedParts.join('/');
}

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

// containerId/song/transpose default to the real song-view page (its
// container id, state.activeSong, state.transpose) so every existing call
// site keeps working unchanged. The song editor's live preview (see
// renderEditorPreview()) overrides all three to render a draft song's
// lyrics — built from the same textarea the person is actively typing
// into, not yet saved anywhere — into its own #editor-preview container
// instead, through this exact same chord/lyric engine rather than a
// second, separate implementation that could drift out of sync with how
// a saved song actually renders.
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
    // sequence number — the label is whatever text (letters/spaces only,
    // no digits or [chord] markers) sits before the FIRST colon on that
    // line. When present it's stripped from the line before chord
    // tokenizing and rendered in place of the number; when absent, the
    // section falls back to the existing "1, 2, 3…" numbering below.
    const firstLineTrimmed = sectionLines[0].replace(/^\s+/, '');
    const labelMatch = firstLineTrimmed.match(/^([^\d\[\]:]+):(.*)$/);
    const sectionLabel = labelMatch ? labelMatch[1].trim() : null;

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
      // marker (see isIndented above), not literal spacing to render. The
      // section label (if any) was already pulled out above and is
      // likewise stripped here so it isn't rendered twice.
      let line = lineIdx === 0 ? rawLine.replace(/^\s+/, '') : rawLine;
      if (lineIdx === 0 && labelMatch) line = labelMatch[2].replace(/^\s+/, '');

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

      groups.forEach(group => {
        const wrap = document.createElement('span');
        wrap.className = 'lyric-token';
        group.forEach(piece => {
          const pieceEl = document.createElement('span');
          pieceEl.className = 'lyric-piece';
          if (piece.chord) {
            const chordEl = document.createElement('span');
            chordEl.className = 'chord-tag';
            chordEl.textContent = transposeChord(piece.chord, transpose);
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
          textEl.textContent = piece.text || '\u00A0';
          pieceEl.appendChild(textEl);
          wrap.appendChild(pieceEl);
        });
        lineEl.appendChild(wrap);
      });

      sectionEl.appendChild(lineEl);
    });

    container.appendChild(sectionEl);
  });
}

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

function bindLyricsCopy() {
  document.addEventListener('copy', (e) => {
    const sel = window.getSelection && window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !e.clipboardData) return;

    const parts = [];
    for (let i = 0; i < sel.rangeCount; i++) {
      const range = sel.getRangeAt(i);
      const anc = range.commonAncestorContainer;
      const host = anc.nodeType === 1 ? anc : anc.parentElement;
      // Anything outside the song view / editor preview (the editor's own
      // textarea, page titles, …) keeps the browser's normal copy.
      if (!host || !host.closest('.lyrics-container')) return;
      parts.push(lyricsFragmentToPlainText(range.cloneContents()));
    }
    const text = parts.filter(Boolean).join('\n');
    if (!text) return;
    e.clipboardData.setData('text/plain', text);
    e.preventDefault();
  });
}

// ---------------------------------------------------------
// Song editor (v3): shared by both "New song" and "Edit song" (see
// state.editorSongId). Parses the same [Am]-before-syllable notation
// official songs use straight out of a plain textarea — no separate
// chord-entry UI — and previews it live through the real renderLyrics()
// engine, so what's shown while editing is exactly how the song will
// look once saved (see renderLyrics()'s containerId/song/transpose
// params, added specifically so this could reuse it as-is).
// ---------------------------------------------------------
function bindSongEditor() {
  document.getElementById('editor-back-btn').addEventListener('click', () => history.back());
  document.getElementById('editor-save-btn').addEventListener('click', saveSongFromEditor);
  // coalesceToNextFrame (same pattern as the search box in bindSongsPage
  // and the picker filter in openAddSongsModal) batches this to once per
  // animation frame instead of running on every single keystroke.
  // renderEditorPreview -> renderLyrics is not cheap: it re-tokenizes every
  // lyric line with regex, walks chord/word runs, and rebuilds a handful
  // of DOM nodes per word from scratch. Left un-batched (as this was), a
  // longer song made typing in the lyrics box visibly laggy — each
  // keystroke paid that full rebuild synchronously, even for someone who
  // just typed several characters in a fast burst.
  document.getElementById('editor-lyrics').addEventListener('input', coalesceToNextFrame(renderEditorPreview));
  document.getElementById('editor-delete-btn').addEventListener('click', () => {
    const song = findSongByRef('user', state.editorSongId);
    if (song) confirmDeleteUserSong(song, { fromEditor: true });
  });
}

// song: null opens a blank "New song" form; an existing user-song object
// opens it pre-filled for editing. Always navigates via showPage (pushing
// history), same as openSong/openPlaylist, so the hardware/gesture back
// button leaves the editor the same way it leaves anywhere else in the app.
function openSongEditor(song, opts = {}) {
  const { pushHistory = true } = opts;
  state.editorSongId = song ? song.id : null;

  document.getElementById('editor-page-title').textContent =
    song ? t('editSongTitle') : t('newSongTitle');
  document.getElementById('editor-title').value = song ? song.title || '' : '';
  document.getElementById('editor-artist').value = song ? song.artist || '' : '';
  document.getElementById('editor-key').value = song ? song.key || '' : '';
  // Prefer the new `links` field; fall back to a legacy `audio` entry so a
  // song saved before this field became a plain link (rather than an
  // embedded audio player) still shows its URL back in the editor.
  document.getElementById('editor-link').value =
    (song && song.links && song.links[0] && song.links[0].url) ||
    (song && song.audio && song.audio[0] && song.audio[0].url) || '';
  document.getElementById('editor-lyrics').value = song ? (song.lyrics || []).join('\n') : '';

  // Labels: a local draft, like every other field here — see this field's
  // markup comment in index.html and saveSongFromEditor() below for where
  // it actually gets committed. Existing user songs start from whatever's
  // currently stored (official-vs-user is a non-issue here: the editor is
  // only ever used for User Songs, so sourceKey is always 'user').
  state.editorLabelsDraft = song ? effectiveLabels('user', song.id, song) : [];
  const labelsContainer = document.getElementById('editor-labels-editor');
  labelsContainer.innerHTML = '';
  labelsContainer.appendChild(buildLabelEditor({
    getLabels: () => state.editorLabelsDraft,
    addLabel: (label) => {
      const value = label.trim();
      if (value && !state.editorLabelsDraft.some(l => l.toLowerCase() === value.toLowerCase())) {
        state.editorLabelsDraft = [...state.editorLabelsDraft, value];
      }
    },
    removeLabel: (label) => {
      state.editorLabelsDraft = state.editorLabelsDraft.filter(l => l !== label);
    },
    suggestionSourceKey: 'user',
  }));

  document.getElementById('editor-delete-btn').hidden = !song;
  document.getElementById('editor-delete-btn').textContent = t('deleteSongBtn');

  renderEditorPreview();
  showPage('song-editor', { resetScroll: true });
  if (pushHistory) {
    pushNavState({ page: 'song-editor', editorSongId: state.editorSongId });
  }
}

// Renders the textarea's CURRENT (unsaved) content through the same
// renderLyrics() engine a real song view uses, into #editor-preview
// instead of #lyrics-container — see renderLyrics()'s containerId param.
// Runs on every keystroke (see bindSongEditor's input listener), so chord
// placement is visibly correct before the person ever taps Save.
function renderEditorPreview() {
  const raw = document.getElementById('editor-lyrics').value;
  const lyrics = raw.split('\n');
  const hasContent = raw.trim() !== '';
  const previewEl = document.getElementById('editor-preview');

  if (!hasContent) {
    previewEl.innerHTML = `<p class="editor-preview-empty">${escapeHtml(t('editorPreviewEmpty'))}</p>`;
    return;
  }

  renderLyrics({
    containerId: 'editor-preview',
    song: { lyrics },
    transpose: 0, // preview always shows the song's own written key — transposing is a song-view-only control
  });
}

function saveSongFromEditor() {
  const title = document.getElementById('editor-title').value.trim();
  if (!title) {
    showToast(t('toastSongTitleRequired'));
    document.getElementById('editor-title').focus();
    return;
  }

  const artist = document.getElementById('editor-artist').value.trim();
  const key = document.getElementById('editor-key').value.trim();
  const linkUrl = document.getElementById('editor-link').value.trim();
  const lyrics = document.getElementById('editor-lyrics').value.split('\n');

  const existing = state.editorSongId ? findSongByRef('user', state.editorSongId) : null;
  const song = {
    id: existing ? existing.id : genUserSongId(),
    title,
    artist: artist || undefined,
    key: key || undefined,
    lyrics,
    // A plain, clickable link (YouTube, a streaming page, anything) — not
    // an embedded audio player, since the URL isn't guaranteed to be a
    // playable audio file. Rendered via the same sv-link-btn list as the
    // official songbook's own links (see renderSongView()).
    links: linkUrl ? [{ url: linkUrl, label: t('songLinkLabel') }] : [],
    // labels/sheetMusic are wired into the data model now (matching how
    // official songs already carry these fields — see README's "Song data
    // structure") so v3.5's label UI can start writing here without any
    // schema change to songs saved today.
    labels: existing ? existing.labels || [] : [],
    sheetMusic: existing ? existing.sheetMusic || [] : [],
  };

  saveUserSong(song).then(() => {
    // Commit the label draft now that the song itself is confirmed saved
    // — see openSongEditor()'s comment on why labels are held as a local
    // draft rather than writing straight through like the song-view
    // modal does. song.id is stable across create/update (genUserSongId()
    // only runs above when there's no existing song), so this is correct
    // for both cases.
    setPersonalLabels('user', song.id, state.editorLabelsDraft);
    showToast(existing ? t('toastSongUpdated') : t('toastSongCreated'));
    if (state.currentPage === 'user-songs') renderUserSongList({ animate: true });
    // Whatever page this editor was opened from (the User Songs list, or
    // song-view via the kebab menu) is one history entry back — its
    // popstate handler re-resolves the song by id from
    // state.sources.user.songs (see initHistoryNav's song-view branch),
    // which saveUserSong() above already updated in place, so backing out
    // shows the edit immediately with no separate refresh call needed here.
    history.back();
  }).catch(err => {
    console.error('Songbook: failed to save user song —', err);
    showToast(t('toastSongSaveFailed'));
  });
}

function confirmDeleteUserSong(song, opts = {}) {
  const { fromEditor = false } = opts;
  const wrap = document.createElement('div');
  const p = document.createElement('p');
  p.className = 'modal-hint';
  p.style.marginTop = '0';
  p.textContent = t('deleteSongConfirm', song.title);
  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  actions.innerHTML = `
    <button type="button" class="btn-secondary" id="delete-song-cancel"></button>
    <button type="button" class="btn-primary btn-danger" id="delete-song-confirm"></button>
  `;
  wrap.appendChild(p);
  wrap.appendChild(actions);
  actions.querySelector('#delete-song-cancel').textContent = t('cancelBtn');
  actions.querySelector('#delete-song-confirm').textContent = t('deleteBtn');

  actions.querySelector('#delete-song-cancel').addEventListener('click', closeModal);
  actions.querySelector('#delete-song-confirm').addEventListener('click', () => {
    closeModal();
    // Decide how many history entries to pop BEFORE deleting/navigating —
    // once the song is gone, state.currentPage will have changed by the
    // time any of this runs async, so this can't be figured out after the
    // fact. Two cases need two pops, not one: deleting from the editor
    // when it was opened from this exact song's song-view (editor sits on
    // top of a song-view that also has nothing left to show once the song
    // is gone), and deleting from song-view's own kebab menu never has an
    // editor above it, so needs just one.
    const wasOnEditorOverSongView =
      fromEditor && state.activeSong && state.activeSourceKey === 'user' && state.activeSong.id === song.id;
    const popCount = wasOnEditorOverSongView ? 2 : (state.currentPage === 'song-editor' || state.currentPage === 'song-view') ? 1 : 0;

    deleteUserSong(song.id).then(() => {
      showToast(t('toastSongDeleted'));
      if (state.currentPage === 'user-songs') renderUserSongList({ animate: true });
      for (let i = 0; i < popCount; i++) history.back();
    }).catch(err => {
      console.error('Songbook: failed to delete user song —', err);
      showToast(t('toastSongSaveFailed'));
    });
  });

  openModal(t('deleteSongTitle'), wrap);
}

// ---------------------------------------------------------
// Playlists (v2): a permanent "Favorites" playlist plus any number of
// user-created playlists. Each playlist just holds a list of song
// references — {sourceKey, songId} — rather than copies of the song data
// itself, so a playlist always reflects the current song content and
// works against any source (state.sources.official and state.sources.english
// today, a future state.sources.user tomorrow) without extra plumbing.
//
// Storage: playlists are saved on-device via IndexedDB (primary) with a
// localStorage mirror as a fallback for browsers/contexts where
// IndexedDB isn't available. This is intentionally isolated behind the
// small load/persist functions below (PlaylistStorage) so it can be
// swapped later — e.g. for a real on-disk file via the File System
// Access API — without touching any of the playlist logic that calls it.
// Note: browser storage (IndexedDB/localStorage) is scoped per-browser,
// not shared between different browsers on the same phone. Use
// Settings → Export/Import playlists to carry playlists from one browser
// to another on the same device.
// ---------------------------------------------------------
const PLAYLIST_DB_NAME = 'ngworship-playlists-db';
const PLAYLIST_DB_STORE = 'kv';
const PLAYLIST_DB_KEY = 'playlists';
const PLAYLIST_LS_KEY = 'ngw-playlists';

const PlaylistStorage = {
  _openDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open(PLAYLIST_DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(PLAYLIST_DB_STORE)) db.createObjectStore(PLAYLIST_DB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async load() {
    try {
      const db = await this._openDb();
      const data = await new Promise((resolve, reject) => {
        const tx = db.transaction(PLAYLIST_DB_STORE, 'readonly');
        const req = tx.objectStore(PLAYLIST_DB_STORE).get(PLAYLIST_DB_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      db.close();
      if (data) return data;
    } catch (err) {
      console.warn('Songbook: playlist IndexedDB load failed, trying localStorage —', err);
    }
    try {
      const raw = localStorage.getItem(PLAYLIST_LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.warn('Songbook: playlist localStorage load failed —', err);
      return null;
    }
  },
  async save(data) {
    try {
      localStorage.setItem(PLAYLIST_LS_KEY, JSON.stringify(data));
    } catch (err) {
      console.warn('Songbook: playlist localStorage save failed —', err);
    }
    try {
      const db = await this._openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(PLAYLIST_DB_STORE, 'readwrite');
        tx.objectStore(PLAYLIST_DB_STORE).put(data, PLAYLIST_DB_KEY);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (err) {
      console.warn('Songbook: playlist IndexedDB save failed (localStorage copy still saved) —', err);
    }
  },
};

function genPlaylistId() {
  return 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function loadPlaylists() {
  const saved = await PlaylistStorage.load();
  if (saved && saved.byId && saved.byId.favorites) {
    state.playlists = saved;
  } else {
    state.playlists = {
      order: ['favorites'],
      byId: { favorites: { id: 'favorites', name: '', isFavorites: true, songs: [] } },
    };
  }
}

function persistPlaylists() {
  PlaylistStorage.save(state.playlists); // fire-and-forget
}

// Manual export/import: browser storage (IndexedDB/localStorage) is
// scoped to one browser on the device, so it's the honest way to carry
// playlists to a different browser on the same phone (or as a manual
// backup) without needing a server.
function exportPlaylists() {
  const blob = new Blob([JSON.stringify(state.playlists, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ngworship-playlists.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(t('toastPlaylistsExported'));
}

async function importPlaylistsFromFile(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || !data.byId || !data.byId.favorites) throw new Error('not a playlists export file');
    state.playlists = data;
    persistPlaylists();
    if (state.currentPage === 'playlists') renderPlaylistsList();
    if (state.currentPage === 'playlist-view') renderPlaylistView();
    if (state.activeSong) updateFavoriteButtonUI();
    showToast(t('toastPlaylistsImported'));
  } catch (err) {
    console.error('Songbook: playlist import failed —', err);
    showToast(t('toastPlaylistsImportFailed'));
  }
}

function getPlaylist(id) {
  return state.playlists.byId[id] || null;
}

function playlistDisplayName(pl) {
  return pl.isFavorites ? t('favoritesName') : pl.name;
}

function findSongByRef(sourceKey, songId) {
  const source = state.sources[sourceKey];
  if (!source) return null;
  return source.songs.find(s => s.id === songId) || null;
}

function isSongInPlaylist(playlistId, sourceKey, songId) {
  const pl = getPlaylist(playlistId);
  if (!pl) return false;
  return pl.songs.some(ref => ref.sourceKey === sourceKey && ref.songId === songId);
}

function addSongToPlaylist(playlistId, sourceKey, songId) {
  const pl = getPlaylist(playlistId);
  if (!pl || isSongInPlaylist(playlistId, sourceKey, songId)) return;
  pl.songs.push({ sourceKey, songId });
  persistPlaylists();
}

function removeSongFromPlaylist(playlistId, sourceKey, songId) {
  const pl = getPlaylist(playlistId);
  if (!pl) return;
  pl.songs = pl.songs.filter(ref => !(ref.sourceKey === sourceKey && ref.songId === songId));
  persistPlaylists();
}

function toggleSongInPlaylist(playlistId, sourceKey, songId) {
  const nowIn = !isSongInPlaylist(playlistId, sourceKey, songId);
  if (nowIn) addSongToPlaylist(playlistId, sourceKey, songId);
  else removeSongFromPlaylist(playlistId, sourceKey, songId);
  return nowIn;
}

function toggleFavorite(sourceKey, songId) {
  const nowFav = toggleSongInPlaylist('favorites', sourceKey, songId);
  return nowFav;
}

function createPlaylist(name) {
  const id = genPlaylistId();
  state.playlists.byId[id] = { id, name, isFavorites: false, songs: [], createdAt: Date.now() };
  state.playlists.order.push(id);
  persistPlaylists();
  return id;
}

function renamePlaylist(id, name) {
  const pl = getPlaylist(id);
  if (!pl || pl.isFavorites) return;
  pl.name = name;
  persistPlaylists();
}

function deletePlaylist(id) {
  const pl = getPlaylist(id);
  if (!pl || pl.isFavorites) return;
  delete state.playlists.byId[id];
  state.playlists.order = state.playlists.order.filter(pid => pid !== id);
  persistPlaylists();
}

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
const LABELS_DB_NAME = 'ngworship-labels-db';
const LABELS_DB_VERSION = 1;
const LABELS_DB_STORE = 'kv';
const LABELS_DB_KEY = 'labels';
const LABELS_LS_KEY = 'ngw-labels';

const LabelStorage = {
  _openDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error('no indexedDB')); return; }
      const req = indexedDB.open(LABELS_DB_NAME, LABELS_DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(LABELS_DB_STORE)) {
          req.result.createObjectStore(LABELS_DB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async load() {
    try {
      const db = await this._openDb();
      const data = await new Promise((resolve, reject) => {
        const tx = db.transaction(LABELS_DB_STORE, 'readonly');
        const req = tx.objectStore(LABELS_DB_STORE).get(LABELS_DB_KEY);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      db.close();
      if (data) return data;
    } catch (err) {
      console.warn('Songbook: labels IndexedDB read failed, trying localStorage —', err);
    }
    try {
      const raw = localStorage.getItem(LABELS_LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      console.warn('Songbook: labels localStorage read failed —', err);
      return null;
    }
  },
  async save(data) {
    // Keep a current localStorage mirror on every successful change, just
    // like playlists do. If IndexedDB later becomes unavailable/corrupt,
    // the fallback is therefore current instead of being an old or missing
    // copy that was only ever written after a previous failure.
    try {
      localStorage.setItem(LABELS_LS_KEY, JSON.stringify(data));
    } catch (err) {
      console.warn('Songbook: labels localStorage mirror write failed —', err);
    }
    try {
      const db = await this._openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(LABELS_DB_STORE, 'readwrite');
        tx.objectStore(LABELS_DB_STORE).put(data, LABELS_DB_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (err) {
      console.warn('Songbook: labels IndexedDB write failed (localStorage mirror still saved) —', err);
    }
  },
};

async function loadPersonalLabels() {
  const saved = await LabelStorage.load();
  state.personalLabels = (saved && saved.bySongRef) ? saved : { bySongRef: {} };
}

// Fire-and-forget, like persistPlaylists() — every call site already
// updates state.personalLabels synchronously first, so the UI never
// waits on this.
function persistPersonalLabels() {
  LabelStorage.save(state.personalLabels);
}

function songRefKey(sourceKey, songId) {
  return `${sourceKey}:${songId}`;
}

// A small set of common worship/church categories offered in the label
// picker alongside free-typed custom labels. The STORED value for a
// preset is always this stable, language-independent key (e.g.
// 'christmas'), never its translated display text (see labelDisplayText
// below) — so a song tagged from the picker under one interface language
// still matches when filtering under a different one.
const LABEL_PRESETS = [
  'christmas', 'easter', 'communion', 'baptism', 'wedding', 'funeral',
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
};
// Display text for a label value — a preset's stable key gets translated;
// anything else is a person's own free-typed text, shown exactly as they
// wrote it (translating that would be putting words in their mouth).
function labelDisplayText(label) {
  const key = LABEL_PRESET_TRANSLATION_KEYS[label];
  return key ? t(key) : label;
}

// The label chips actually shown for a song: whatever's personally
// assigned, plus anything already baked into the song's own (currently
// always-empty) `labels` field — see this section's intro comment.
function effectiveLabels(sourceKey, songId, song) {
  const personal = state.personalLabels.bySongRef[songRefKey(sourceKey, songId)] || [];
  const builtIn = (song && song.labels) || [];
  return Array.from(new Set([...builtIn, ...personal]));
}

// Adds/removes one label at a time, applied immediately — used by the
// song-view "Edit labels" modal (openEditLabelsModal), matching how
// "Add to playlist" also commits each tap straight through rather than
// waiting on a separate save step.
function addPersonalLabel(sourceKey, songId, label) {
  const value = label.trim();
  if (!value) return;
  const key = songRefKey(sourceKey, songId);
  const current = state.personalLabels.bySongRef[key] || [];
  if (current.some(l => l.toLowerCase() === value.toLowerCase())) return;
  state.personalLabels.bySongRef[key] = [...current, value];
  persistPersonalLabels();
}
function removePersonalLabel(sourceKey, songId, label) {
  const key = songRefKey(sourceKey, songId);
  const current = state.personalLabels.bySongRef[key];
  if (!current) return;
  const next = current.filter(l => l !== label);
  if (next.length) state.personalLabels.bySongRef[key] = next;
  else delete state.personalLabels.bySongRef[key];
  persistPersonalLabels();
}
// Replaces a song's whole personal-label set in one go — used by the Song
// Editor (see openSongEditor/saveSongFromEditor), which holds label edits
// as a local draft like every other field on that page and only commits
// them here once Save actually succeeds.
function setPersonalLabels(sourceKey, songId, labels) {
  const key = songRefKey(sourceKey, songId);
  if (labels && labels.length) state.personalLabels.bySongRef[key] = [...labels];
  else delete state.personalLabels.bySongRef[key];
  persistPersonalLabels();
}

// Every label personally assigned to ANY song, official or user — feeds
// the label picker's "previously used" suggestions so a person's own
// custom tags stay reusable/consistent instead of retyping "Youth
// Service" slightly differently each time.
function allPersonalLabelValues() {
  const set = new Set();
  Object.values(state.personalLabels.bySongRef).forEach(arr => arr.forEach(l => set.add(l)));
  return set;
}

// Every label currently in use within one source (the active official
// database, or 'user') — feeds that page's browse/filter chip row, so
// e.g. the Songs page never offers a chip for a label that only exists
// on a User Song, and vice versa.
function labelsInUse(sourceKey) {
  const source = state.sources[sourceKey];
  if (!source) return [];
  const set = new Set();
  source.songs.forEach(song => {
    effectiveLabels(sourceKey, song.id, song).forEach(l => set.add(l));
  });
  return Array.from(set);
}

// ---------------------------------------------------------
// Playlists page: list of playlists (Favorites pinned first)
// ---------------------------------------------------------
function bindPlaylistsPage() {
  document.getElementById('new-playlist-btn').addEventListener('click', () => {
    promptCreatePlaylist((id) => openPlaylist(id));
  });
}

// Builds one playlist row <li> from scratch (icon + title + song count +
// click handler). Used for every row on a plain rebuild, and for rows
// that are newly entering on a diffed (animate: true) render — see
// updatePlaylistRowContent() for the reused-row counterpart.
function buildPlaylistRow(id, pl) {
  const li = document.createElement('li');
  li.dataset.plId = id;
  const row = document.createElement('button');
  row.className = 'playlist-row' + (pl.isFavorites ? ' is-favorites' : '');
  row.innerHTML = `
    <span class="playlist-icon"><svg viewBox="0 0 24 24" data-icon="${pl.isFavorites ? 'heart-filled' : 'nav-playlist'}"></svg></span>
    <span class="playlist-row-text">
      <span class="playlist-row-title">${escapeHtml(playlistDisplayName(pl))}</span>
      <span class="playlist-row-sub">${t('playlistSongCount', pl.songs.length)}</span>
    </span>
  `;
  row.addEventListener('click', () => openPlaylist(id));
  li.appendChild(row);
  initIcons(li);
  return li;
}

// Refreshes an existing row's text in place (name/song-count can change —
// e.g. a rename, or a song added elsewhere) without touching its icon or
// click handler. isFavorites never changes for a given id, so the icon
// never needs to be re-picked here.
function updatePlaylistRowContent(li, pl) {
  const row = li.firstElementChild;
  row.querySelector('.playlist-row-title').textContent = playlistDisplayName(pl);
  row.querySelector('.playlist-row-sub').textContent = t('playlistSongCount', pl.songs.length);
}

// animate: true fades newly-created/newly-removed playlists in/out
// (see the song-row-enter/song-row-exit pair renderSongList's diffed
// render uses for the same purpose) instead of the whole list just
// popping to its new state — pass this from the specific action that
// added or removed a playlist (create/delete), not from routine
// re-renders like a tab visit or a language change, so the animation
// reads as a response to what the person just did rather than firing on
// every page visit.
function renderPlaylistsList(opts = {}) {
  const { animate = false } = opts;
  const listEl = document.getElementById('playlist-list');
  const emptyEl = document.getElementById('playlists-empty-state');
  emptyEl.textContent = t('playlistsEmptyState');

  const ids = state.playlists.order.filter(id => state.playlists.byId[id]);
  // Favorites is always pinned in (see loadPlaylists), so ids.length is
  // never actually 0 — only count the user's own playlists when deciding
  // whether to show the "no playlists yet" text below Favorites.
  const ownCount = ids.filter(id => !state.playlists.byId[id].isFavorites).length;
  const hasFavoritesPinned = ids.length > 0 && state.playlists.byId[ids[0]].isFavorites;
  emptyEl.hidden = ownCount !== 0;
  // When Favorites is the only playlist, the empty-state text sits right
  // below it — use the tighter, divider-attached spacing instead of the
  // large centered gap meant for a page with nothing in it at all.
  emptyEl.classList.toggle('playlists-empty-state--pinned', ownCount === 0 && hasFavoritesPinned);

  if (!animate || prefersReducedMotion()) {
    // Plain rebuild — used for routine re-renders (tab visits, language
    // change, import) where nothing is animating, so there's no reason to
    // pay for the diff below.
    listEl.innerHTML = '';
    ids.forEach((id, index) => {
      // Favorites is always pinned first (see loadPlaylists/createPlaylist),
      // so a divider right after it visually separates it from the user's
      // own playlists below — shown whether or not there are any yet, so it
      // also sits between Favorites and the "no playlists yet" text.
      if (index === 1 && hasFavoritesPinned) {
        const divider = document.createElement('li');
        divider.className = 'playlist-list-divider';
        listEl.appendChild(divider);
      }
      listEl.appendChild(buildPlaylistRow(id, state.playlists.byId[id]));
    });
    // Only Favorites exists — the index===1 divider above never runs
    // (there's no second item to trigger it), so add it here instead,
    // right before the "no playlists yet" text.
    if (ownCount === 0 && hasFavoritesPinned) {
      const divider = document.createElement('li');
      divider.className = 'playlist-list-divider';
      listEl.appendChild(divider);
    }
    return;
  }

  // Diffed render: only the playlist actually being added or removed
  // animates — every other row is reused in place (just its text
  // refreshed) so it never flickers. Same approach as renderSongList's
  // diffed render, keyed by playlist id instead of song id.
  const existingRows = new Map();
  Array.from(listEl.children).forEach(li => {
    if (li.dataset.plId) existingRows.set(li.dataset.plId, li);
  });

  const fragment = document.createDocumentFragment();
  const keptIds = new Set();

  ids.forEach((id, index) => {
    if (index === 1 && hasFavoritesPinned) {
      const divider = document.createElement('li');
      divider.className = 'playlist-list-divider';
      fragment.appendChild(divider);
    }
    keptIds.add(id);
    const pl = state.playlists.byId[id];
    let li = existingRows.get(id);
    if (li) {
      // Already on screen — bring back from a leave-animation if this
      // playlist reappears mid-fade (shouldn't normally happen, but
      // mirrors renderSongList's same safeguard), and refresh its text.
      if (li.dataset.state === 'exiting') {
        delete li.dataset.state;
        li.classList.remove('song-row-exit');
        if (li._exitCleanup) {
          li.removeEventListener('animationend', li._exitCleanup);
          li._exitCleanup = null;
        }
      }
      updatePlaylistRowContent(li, pl);
    } else {
      li = buildPlaylistRow(id, pl);
      li.classList.add('song-row-enter');
      li.addEventListener('animationend', function onEnd() {
        li.classList.remove('song-row-enter');
        li.removeEventListener('animationend', onEnd);
      }, { once: true });
    }
    fragment.appendChild(li); // detaches reused rows from listEl, leaving only dropped-out ones (and stale dividers) behind
  });

  if (ownCount === 0 && hasFavoritesPinned) {
    const divider = document.createElement('li');
    divider.className = 'playlist-list-divider';
    fragment.appendChild(divider);
  }

  // Whatever's left in listEl now got deleted — fade it out and remove it
  // once its animation finishes, instead of cutting it instantly.
  existingRows.forEach((li, id) => {
    if (keptIds.has(id) || li.dataset.state === 'exiting') return;
    li.dataset.state = 'exiting';
    li.classList.add('song-row-exit');
    const cleanup = () => {
      li.removeEventListener('animationend', cleanup);
      li._exitCleanup = null;
      li.remove();
    };
    li._exitCleanup = cleanup;
    li.addEventListener('animationend', cleanup);
  });

  // Old dividers are cheap to just drop and recreate fresh above (they
  // carry no content worth preserving), rather than diffing them too.
  Array.from(listEl.children).forEach(li => {
    if (!li.dataset.plId) li.remove();
  });

  // New order goes in ahead of anything still fading out, so the visible
  // list reads top-to-bottom correctly while leaving rows finish
  // underneath.
  listEl.insertBefore(fragment, listEl.firstChild);
}

// ---------------------------------------------------------
// Playlist-view page: songs inside one playlist
// ---------------------------------------------------------
function bindPlaylistView() {
  document.getElementById('playlist-back-btn').addEventListener('click', () => history.back());

  document.getElementById('playlist-menu-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    togglePlaylistMenu();
  });

  document.getElementById('playlist-done-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    setPlaylistEditMode(false);
  });

  document.addEventListener('click', () => closePlaylistMenu());

  // Drag-to-reorder (pointer events cover touch + mouse). Only active
  // while playlistEditMode is on; see renderPlaylistView for handle setup.
  document.addEventListener('pointermove', onPlaylistDragMove);
  document.addEventListener('pointerup', onPlaylistDragEnd);
  document.addEventListener('pointercancel', onPlaylistDragEnd);
}

let playlistMenuOpen = false;
function togglePlaylistMenu() {
  playlistMenuOpen ? closePlaylistMenu() : openPlaylistMenu();
}

function openPlaylistMenu() {
  const pl = getPlaylist(state.activePlaylistId);
  if (!pl) return;
  closePlaylistMenu();
  const btn = document.getElementById('playlist-menu-btn');
  const wrap = document.createElement('div');
  wrap.className = 'kebab-dropdown';
  wrap.id = 'playlist-kebab-dropdown';
  wrap.innerHTML = `
    <button type="button" id="kebab-add-songs"><svg data-icon="plus" viewBox="0 0 24 24"></svg>${escapeHtml(t('addSongsTitle'))}</button>
    <button type="button" id="kebab-edit"><svg data-icon="${playlistEditMode ? 'check' : 'pencil'}" viewBox="0 0 24 24"></svg>${escapeHtml(playlistEditMode ? t('doneBtn') : t('editBtn'))}</button>
    ${pl.isFavorites ? '' : `
    <button type="button" id="kebab-delete" class="is-danger"><svg data-icon="trash" viewBox="0 0 24 24"></svg>${escapeHtml(t('menuDelete'))}</button>
    `}
  `;
  btn.parentElement.style.position = 'relative';
  btn.parentElement.appendChild(wrap);
  initIcons(wrap);
  playlistMenuOpen = true;

  wrap.querySelector('#kebab-add-songs').addEventListener('click', (e) => {
    e.stopPropagation();
    closePlaylistMenu();
    openAddSongsModal(state.activePlaylistId);
  });
  wrap.querySelector('#kebab-edit').addEventListener('click', (e) => {
    e.stopPropagation();
    closePlaylistMenu();
    setPlaylistEditMode(!playlistEditMode);
  });
  const deleteBtn = wrap.querySelector('#kebab-delete');
  if (deleteBtn) deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closePlaylistMenu();
    confirmDeletePlaylist(state.activePlaylistId);
  });
  wrap.addEventListener('click', (e) => e.stopPropagation());
}

function closePlaylistMenu() {
  const wrap = document.getElementById('playlist-kebab-dropdown');
  playlistMenuOpen = false;
  if (!wrap) return;
  if (prefersReducedMotion()) { wrap.remove(); return; }
  // Free the id immediately (rather than waiting for the exit animation to
  // finish) so a fast re-open — which looks up this same id — never
  // collides with the copy that's still fading out underneath it.
  wrap.removeAttribute('id');
  wrap.classList.add('kebab-dropdown-exit');
  wrap.addEventListener('animationend', () => wrap.remove(), { once: true });
}

let playlistEditMode = false;
function setPlaylistEditMode(on) {
  // Already in the requested state — nothing to actually change. Without
  // this, openPlaylist()'s unconditional setPlaylistEditMode(false) (to
  // guarantee every playlist opens fresh, not mid-edit) would replay the
  // Finish-pill/title-swap/row-handle animations on every single ordinary
  // open, not just the ones actually leaving edit mode.
  if (playlistEditMode === on) return;

  // Leaving edit mode commits any pending title edit first, so Done
  // (or backing out) always saves rather than silently discarding it.
  if (playlistEditMode && !on) commitPlaylistTitleEdit();

  playlistEditMode = on;
  const listEl = document.getElementById('playlist-song-list');
  listEl.classList.toggle('is-editing', on);

  // The drag-handle/remove-button (entering) and queue-index (leaving)
  // swap via a plain CSS display toggle above — necessary to keep the
  // row width/alignment stable (see the big comment on .song-row-with-
  // remove in style.css), but on its own that reads as an abrupt pop
  // rather than a transition. Reuse the same fade-in the song list
  // already uses for newly-appeared rows on whichever set just became
  // visible, so entering/exiting edit mode reads as one smooth change
  // instead of a hard cut.
  if (!prefersReducedMotion()) {
    const justShown = on
      ? listEl.querySelectorAll('.drag-handle, .song-row-remove')
      : listEl.querySelectorAll('.queue-index');
    justShown.forEach(el => {
      el.classList.remove('song-row-enter');
      void el.offsetWidth; // restart the animation even if it's mid-run from a fast toggle
      el.classList.add('song-row-enter');
      el.addEventListener('animationend', function onEnd() {
        el.classList.remove('song-row-enter');
        el.removeEventListener('animationend', onEnd);
      }, { once: true });
    });
  }

  const doneBtn = document.getElementById('playlist-done-btn');
  doneBtn.textContent = t('doneBtn');
  showOrHidePillDone(doneBtn, on);

  // If the three-dot menu happens to be open while edit mode changes out
  // from under it (e.g. the person hits the top "Finish" button without
  // closing the still-open kebab menu first), its "Edit"/"Done" row was
  // built from playlistEditMode at open time and is now stale — both its
  // label and icon would keep showing the old state, AND worse, tapping
  // it reads the (already-updated) live playlistEditMode variable, so it
  // would silently do the opposite of what it displays (e.g. show "Done"
  // but actually re-enter edit mode). Refresh it in place so it always
  // matches reality.
  const kebabEditBtn = document.getElementById('kebab-edit');
  if (kebabEditBtn) {
    kebabEditBtn.innerHTML = `<svg data-icon="${on ? 'check' : 'pencil'}" viewBox="0 0 24 24"></svg>${escapeHtml(on ? t('doneBtn') : t('editBtn'))}`;
    initIcons(kebabEditBtn);
  }

  renderPlaylistTitle({ animateSwap: true });
}

// The [hidden] attribute maps straight to display:none, which can't be
// transitioned — so on its own, toggling `.hidden` makes the Finish pill
// just pop in/out instead of appearing/disappearing smoothly. This
// animates the button in on show, and defers actually hiding it on the
// way out until the fade-out animation has finished playing.
function showOrHidePillDone(btn, show) {
  btn.classList.remove('is-entering', 'is-exiting');
  if (prefersReducedMotion()) {
    btn.hidden = !show;
    return;
  }
  if (show) {
    btn.hidden = false;
    void btn.offsetWidth; // restart the animation even if a previous run is still settling
    btn.classList.add('is-entering');
    btn.addEventListener('animationend', function onEnd() {
      btn.classList.remove('is-entering');
      btn.removeEventListener('animationend', onEnd);
    }, { once: true });
  } else {
    btn.classList.add('is-exiting');
    btn.addEventListener('animationend', function onEnd() {
      btn.classList.remove('is-exiting');
      btn.hidden = true;
      btn.removeEventListener('animationend', onEnd);
    }, { once: true });
  }
}

// Renders pv-title as either a static heading (normal browsing) or an
// inline text input (edit mode) — the "rename" affordance IS the title
// itself while editing, rather than a separate menu item + popup.
// animateSwap: true fades the swap between the two (including the
// input's edit-mode underline appearing/disappearing) instead of it
// popping instantly — pass this only from the actual edit-mode toggle
// (setPlaylistEditMode), not from routine re-renders (adding a song,
// reopening the playlist, a language change) where the mode itself
// isn't changing and nothing should animate.
function renderPlaylistTitle(opts = {}) {
  const { animateSwap = false } = opts;
  const pl = getPlaylist(state.activePlaylistId);
  if (!pl) return;
  const titleEl = document.getElementById('pv-title');

  if (playlistEditMode && !pl.isFavorites) {
    titleEl.innerHTML = '';
    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'pv-title-input';
    input.className = 'pv-title-input';
    input.maxLength = 60;
    input.autocomplete = 'off';
    input.value = pl.name;
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    });
    input.addEventListener('blur', () => commitPlaylistTitleEdit());
    titleEl.appendChild(input);
  } else {
    titleEl.textContent = playlistDisplayName(pl);
  }

  if (animateSwap && !prefersReducedMotion()) {
    titleEl.classList.remove('pv-title-swap');
    void titleEl.offsetWidth;
    titleEl.classList.add('pv-title-swap');
    titleEl.addEventListener('animationend', function onEnd() {
      titleEl.classList.remove('pv-title-swap');
      titleEl.removeEventListener('animationend', onEnd);
    }, { once: true });
  }
}

function commitPlaylistTitleEdit() {
  const pl = getPlaylist(state.activePlaylistId);
  const input = document.getElementById('pv-title-input');
  if (!pl || !input || pl.isFavorites) return;
  const name = input.value.trim();
  if (name && name !== pl.name) {
    renamePlaylist(pl.id, name);
    if (state.currentPage === 'playlists') renderPlaylistsList();
  }
}

function openPlaylist(id, opts = {}) {
  const { pushHistory = true } = opts;
  const pl = getPlaylist(id);
  if (!pl) return;
  state.activePlaylistId = id;
  setPlaylistEditMode(false); // always open a playlist fresh, not mid-edit
  renderPlaylistView();
  showPage('playlist-view', { resetScroll: true });
  if (pushHistory) {
    pushNavState({ page: 'playlist-view', playlistId: id });
  }

  // Startup only loads the selected song database. A playlist can still
  // contain references to databases used on an earlier session, so hydrate
  // those sources only when this playlist actually needs them. This keeps
  // startup lean without making cross-database Favorites/playlists lose
  // rows after a reload.
  const missingSourceKeys = Array.from(new Set(pl.songs
    .map(ref => ref.sourceKey)
    .filter(key => DB_SOURCES[key] && state.sources[key] && !state.sources[key].loaded)));
  if (missingSourceKeys.length) {
    Promise.all(missingSourceKeys.map(loadSongDataFor)).then(() => {
      if (state.activePlaylistId === id && state.currentPage === 'playlist-view') renderPlaylistView();
    });
  }
}

// animate: true fades newly-added songs in (see the song-row-enter/exit
// pair renderSongList's and renderPlaylistsList's diffed renders use for
// the same purpose) instead of the new row just popping straight into
// place. Pass this from the specific action that added a song (the Add
// Songs modal), not from routine re-renders (opening the playlist, a
// drag reorder finishing, a language change) where nothing new actually
// entered the list.
function renderPlaylistView(opts = {}) {
  const { animate = false } = opts;
  const pl = getPlaylist(state.activePlaylistId);
  const listEl = document.getElementById('playlist-song-list');
  const emptyEl = document.getElementById('playlist-view-empty-state');
  if (!pl) return;

  document.getElementById('pv-count').textContent = t('playlistSongCount', pl.songs.length);
  emptyEl.textContent = pl.isFavorites ? t('playlistViewEmptyStateFavorites') : t('playlistViewEmptyState');
  emptyEl.classList.toggle('empty-state--favorites', pl.isFavorites);

  // Snapshot which songs were already on screen before the rebuild below,
  // so a song that's actually new to the list can be told apart from one
  // that was already there (which should just re-settle with no fade).
  const prevKeys = animate
    ? new Set(Array.from(listEl.children)
        .filter(li => li.dataset && li.dataset.sourceKey)
        .map(li => `${li.dataset.sourceKey}:${li.dataset.songId}`))
    : null;

  listEl.innerHTML = '';
  const resolved = pl.songs
    .map(ref => ({ ref, song: findSongByRef(ref.sourceKey, ref.songId) }))
    .filter(x => x.song);
  // If references exist but their lazy source is still loading, don't flash
  // a false "playlist is empty" message for a moment.
  emptyEl.hidden = pl.songs.length !== 0 || resolved.length !== 0;

  resolved.forEach(({ ref, song }, index) => {
    const li = document.createElement('li');
    li.className = 'song-row-with-remove';
    li.dataset.sourceKey = ref.sourceKey;
    li.dataset.songId = song.id;

    const queueIndex = document.createElement('span');
    queueIndex.className = 'queue-index';
    queueIndex.textContent = String(index + 1);
    queueIndex.setAttribute('aria-hidden', 'true');
    li.appendChild(queueIndex);

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'drag-handle';
    handle.setAttribute('aria-label', t('reorderHandle'));
    handle.innerHTML = '<svg data-icon="menu-kebab" viewBox="0 0 24 24" style="transform:rotate(90deg)"></svg>';
    handle.addEventListener('pointerdown', (e) => onPlaylistDragStart(e, li));

    const row = document.createElement('button');
    row.className = 'song-row';
    // Some sources' songs have no number (see DB_SOURCES' hasNumbers) —
    // drop the badge entirely for those rather than show "undefined".
    const hasNumbers = (DB_SOURCES[ref.sourceKey] || {}).hasNumbers !== false;
    const subtitle = getSongListSubtitle(song);
    row.innerHTML = `
      ${hasNumbers ? `<span class="song-badge">${song.number}</span>` : ''}
      <span class="song-row-text">
        <span class="song-row-title">${escapeHtml(song.title)}</span>
        ${subtitle ? `<span class="song-row-sub">${escapeHtml(subtitle)}</span>` : ''}
      </span>
    `;
    row.addEventListener('click', () => { if (!playlistEditMode) tapSongRowThenOpen(row, () => openSong(song, { sourceKey: ref.sourceKey })); });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'song-row-remove';
    removeBtn.setAttribute('aria-label', t('removeFromPlaylist'));
    removeBtn.innerHTML = '<svg data-icon="close" viewBox="0 0 24 24"></svg>';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Optimistically remove from the UI right away, but hold off on
      // persisting it — a mistaken tap here (no confirm dialog, on
      // purpose, since this happens often) is only one "Undo" tap away
      // from being fixed for the next few seconds.
      const originalIndex = pl.songs.findIndex(r => r.sourceKey === ref.sourceKey && r.songId === ref.songId);
      pl.songs = pl.songs.filter(r => !(r.sourceKey === ref.sourceKey && r.songId === ref.songId));
      renderPlaylistView();
      if (pl.isFavorites && state.activeSong && state.activeSong.id === ref.songId) updateFavoriteButtonUI();

      showToast(t('toastSongRemoved'), {
        label: t('undoBtn'),
        onAction: () => {
          // Put it back where it was, not just at the end.
          const idx = Math.min(originalIndex, pl.songs.length);
          pl.songs.splice(idx, 0, ref);
          renderPlaylistView();
          if (pl.isFavorites && state.activeSong && state.activeSong.id === ref.songId) updateFavoriteButtonUI();
        },
        onCommit: () => persistPlaylists(),
      }, 4000);
    });

    li.appendChild(handle);
    li.appendChild(row);
    li.appendChild(removeBtn);

    if (animate && !prefersReducedMotion() && !prevKeys.has(`${ref.sourceKey}:${song.id}`)) {
      li.classList.add('song-row-enter');
      li.addEventListener('animationend', function onEnd() {
        li.classList.remove('song-row-enter');
        li.removeEventListener('animationend', onEnd);
      }, { once: true });
    }

    listEl.appendChild(li);
    initIcons(li);
  });

  // Re-apply edit-mode class/label (keeps Edit/Done in sync with language
  // changes) without re-running the commit-on-exit logic in
  // setPlaylistEditMode, since we're not actually toggling anything here.
  document.getElementById('playlist-song-list').classList.toggle('is-editing', playlistEditMode);
  const doneBtn = document.getElementById('playlist-done-btn');
  doneBtn.hidden = !playlistEditMode;
  doneBtn.textContent = t('doneBtn');
  renderPlaylistTitle();
}

// ---------------------------------------------------------
// Drag-to-reorder for the playlist-view list (edit mode only). Uses
// Pointer Events so it works with touch (phones) as well as mouse.
// ---------------------------------------------------------
let dragLi = null;
let dragStartY = 0;

function onPlaylistDragStart(e, li) {
  if (!playlistEditMode) return;
  dragLi = li;
  dragStartY = e.clientY;
  li.classList.add('is-dragging');
  // Lift off the list with a small spring pop (same overshoot curve as
  // every other press interaction) rather than the row just starting to
  // track the finger flat — this is what sells "picking it up" before
  // the drag itself takes over.
  li.style.transition = 'transform .18s var(--press-ease)';
  li.style.transform = 'scale(1.035)';
  try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  e.preventDefault();
}

// FLIP-animates every sibling row that just shifted position (because the
// dragged row was inserted before/after it) from where it visually was to
// where it now sits, on the same overshoot spring used for a picked-up
// item settling into place — instead of the reorder just cutting straight
// to the new layout, which is what made this feel like rows snapping
// rather than sliding out of the way. beforeRects is a Map<element,
// DOMRect> captured immediately before the DOM reorder that triggered
// this call; dragLi is excluded since its own motion is driven directly
// by the pointer, not this spring.
function flipReorderedSiblings(listEl, dragLi, beforeRects) {
  Array.from(listEl.children).forEach(child => {
    if (child === dragLi) return;
    const before = beforeRects.get(child);
    if (!before) return;
    const after = child.getBoundingClientRect();
    const deltaY = before.top - after.top;
    if (Math.abs(deltaY) < 1) return; // didn't actually move — nothing to animate
    if (child._reorderCleanup) {
      child.removeEventListener('transitionend', child._reorderCleanup);
      child.style.transition = 'none';
    }
    child.style.transform = `translateY(${deltaY}px)`;
    void child.offsetWidth; // force the browser to register the start position before animating away from it
    child.style.transition = 'transform .38s var(--press-ease)';
    requestAnimationFrame(() => { child.style.transform = ''; });
    const cleanup = () => {
      child.style.transition = '';
      child.removeEventListener('transitionend', cleanup);
      child._reorderCleanup = null;
    };
    child._reorderCleanup = cleanup;
    child.addEventListener('transitionend', cleanup);
  });
}

function onPlaylistDragMove(e) {
  if (!dragLi) return;
  const dy = e.clientY - dragStartY;
  dragLi.style.transition = 'none'; // direct 1:1 finger tracking — no lag while actually dragging
  dragLi.style.transform = `translateY(${dy}px) scale(1.035)`;

  const listEl = document.getElementById('playlist-song-list');
  const dragRect = dragLi.getBoundingClientRect();
  const dragCenter = dragRect.top + dragRect.height / 2;

  for (const sib of Array.from(listEl.children)) {
    if (sib === dragLi) continue;
    const sRect = sib.getBoundingClientRect();
    const sCenter = sRect.top + sRect.height / 2;
    const dragIsBeforeSib = !!(dragLi.compareDocumentPosition(sib) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (dragIsBeforeSib && dragCenter > sCenter) {
      const beforeRects = new Map();
      Array.from(listEl.children).forEach(c => { if (c !== dragLi) beforeRects.set(c, c.getBoundingClientRect()); });
      listEl.insertBefore(dragLi, sib.nextSibling);
      flipReorderedSiblings(listEl, dragLi, beforeRects);
      dragStartY = e.clientY;
      dragLi.style.transform = 'translateY(0) scale(1.035)';
      break;
    }
    if (!dragIsBeforeSib && dragCenter < sCenter) {
      const beforeRects = new Map();
      Array.from(listEl.children).forEach(c => { if (c !== dragLi) beforeRects.set(c, c.getBoundingClientRect()); });
      listEl.insertBefore(dragLi, sib);
      flipReorderedSiblings(listEl, dragLi, beforeRects);
      dragStartY = e.clientY;
      dragLi.style.transform = 'translateY(0) scale(1.035)';
      break;
    }
  }
}

function onPlaylistDragEnd() {
  if (!dragLi) return;
  const li = dragLi;
  dragLi = null;
  // Drop with the same overshoot spring the pickup used, instead of
  // snapping straight to rest — the lift scale eases back to 1 at the
  // same time as any residual translateY resolves to 0.
  li.style.transition = 'transform .32s var(--press-ease)';
  li.style.transform = 'translateY(0) scale(1)';
  const cleanup = (ev) => {
    if (ev && ev.propertyName !== 'transform') return;
    li.style.transition = '';
    li.style.transform = '';
    li.removeEventListener('transitionend', cleanup);
    li._dropCleanup = null;
  };
  if (li._dropCleanup) li.removeEventListener('transitionend', li._dropCleanup);
  li._dropCleanup = cleanup;
  li.addEventListener('transitionend', cleanup);
  li.classList.remove('is-dragging');
  commitPlaylistOrderFromDom();
  renderPlaylistView(); // refresh the small queue-position numbers to match the new order
}

function commitPlaylistOrderFromDom() {
  const pl = getPlaylist(state.activePlaylistId);
  if (!pl) return;
  const listEl = document.getElementById('playlist-song-list');
  const newOrder = Array.from(listEl.children).map(li => ({
    sourceKey: li.dataset.sourceKey,
    songId: li.dataset.songId,
  }));
  // songId in the dataset is always a string; match loosely so numeric ids still line up.
  pl.songs = newOrder
    .map(ref => pl.songs.find(s => s.sourceKey === ref.sourceKey && String(s.songId) === String(ref.songId)))
    .filter(Boolean);
  persistPlaylists();
}

// ---------------------------------------------------------
// Shared modal shell
// ---------------------------------------------------------
// This one overlay/card pair is reused for every modal in the app (Add
// Songs, rename/create playlist, etc.) — see bindModalShell() below.
function openModal(title, bodyEl) {
  document.getElementById('modal-title').textContent = title;
  const body = document.getElementById('modal-body');
  body.innerHTML = '';
  body.appendChild(bodyEl);
  const overlay = document.getElementById('modal-overlay');
  const card = overlay.querySelector('.modal-card');

  // A previous modal's close animation may still be in flight (e.g. this
  // one was opened immediately after closing another) — cancel it rather
  // than letting its transitionend fire later and hide the modal we're
  // opening right now out from under the person.
  if (overlay._closeCleanup) {
    overlay.removeEventListener('transitionend', overlay._closeCleanup);
    overlay._closeCleanup = null;
  }
  overlay.classList.remove('modal-overlay-closing');
  overlay.hidden = false;

  if (prefersReducedMotion()) {
    overlay.style.opacity = '';
  } else {
    // The card's slide-up-and-fade is a plain CSS animation (see
    // .modal-card in style.css), which only plays once per element
    // unless explicitly restarted — the remove/reflow/re-add trick used
    // elsewhere in this file (e.g. the kebab menus) so it replays on
    // every open, not just the first.
    if (card) {
      card.style.animation = 'none';
      void card.offsetWidth;
      card.style.animation = '';
    }
    // The backdrop fade needs an actual "from" state to animate out of —
    // clearing `hidden` alone would otherwise just snap it straight to
    // its resting opacity:1 the instant it becomes visible. Setting 0 now
    // and clearing it (back to that CSS resting value) on the next frame
    // is what gives the transition something to animate across.
    overlay.style.opacity = '0';
    requestAnimationFrame(() => { overlay.style.opacity = ''; });
  }
  initIcons(overlay);
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay.hidden) return;

  if (prefersReducedMotion()) {
    overlay.hidden = true;
    document.getElementById('modal-body').innerHTML = '';
    return;
  }

  // .modal-overlay-closing plays the card's slide-down (see style.css)
  // alongside this opacity fade, instead of the whole modal just
  // disappearing the instant this function runs.
  overlay.classList.add('modal-overlay-closing');
  overlay.style.opacity = '0';
  const cleanup = (e) => {
    if (e && e.propertyName !== 'opacity') return;
    overlay.removeEventListener('transitionend', cleanup);
    overlay._closeCleanup = null;
    overlay.hidden = true;
    overlay.classList.remove('modal-overlay-closing');
    overlay.style.opacity = '';
    document.getElementById('modal-body').innerHTML = '';
  };
  overlay._closeCleanup = cleanup;
  overlay.addEventListener('transitionend', cleanup);
}

function bindModalShell() {
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeModal();
  });
  initViewportSync();
}

// ---------------------------------------------------------
// Mobile keyboard / viewport fix
// ---------------------------------------------------------
// On phones (mainly Android Chrome), opening the on-screen keyboard
// resizes the *visual* viewport but not the *layout* viewport. Our
// modal overlay is `position: fixed; inset: 0`, which is sized against
// the layout viewport — so it doesn't know the keyboard ate the bottom
// half of the screen. Depending on the device this makes the sheet
// jump upward, get clipped, or appear to only show part of its content.
//
// The fix: mirror window.visualViewport's height/offset into CSS custom
// properties (--vvh, --vv-top) that the modal uses instead of 100vh/0.
// Browsers without visualViewport support just keep the old 100vh/0
// fallback defined in the CSS.
function initViewportSync() {
  if (!window.visualViewport) return;
  const root = document.documentElement;
  const sync = () => {
    const vv = window.visualViewport;
    root.style.setProperty('--vvh', `${vv.height}px`);
    root.style.setProperty('--vv-top', `${vv.offsetTop}px`);
  };
  sync();
  window.visualViewport.addEventListener('resize', sync);
  window.visualViewport.addEventListener('scroll', sync);
}

// Focuses `input` only after any in-flight modal-open animation has
// settled, then — once the keyboard has actually finished animating in —
// scrolls the input into view within the modal body. Opening the
// keyboard the instant the sheet starts sliding up was the other half
// of the "jumps/only shows part of itself" behavior; giving the sheet
// a moment to land first avoids the two animations fighting each other.
function focusModalInput(input, delay = 260) {
  if (!input) return;
  setTimeout(() => {
    input.focus();
    setTimeout(() => {
      input.scrollIntoView({ block: 'nearest' });
    }, 300);
  }, delay);
}

// ---------------------------------------------------------
// Create / rename playlist modal
// ---------------------------------------------------------
function playlistNameForm(initialValue, onSave) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <input type="text" class="modal-text-input" id="playlist-name-input" maxlength="60" autocomplete="off">
    <div class="modal-actions">
      <button type="button" class="btn-secondary" id="playlist-name-cancel"></button>
      <button type="button" class="btn-primary" id="playlist-name-save"></button>
    </div>
  `;
  const input = wrap.querySelector('#playlist-name-input');
  input.placeholder = t('playlistNamePlaceholder');
  input.value = initialValue || '';
  wrap.querySelector('#playlist-name-cancel').textContent = t('cancelBtn');
  wrap.querySelector('#playlist-name-save').textContent = t('saveBtn');

  wrap.querySelector('#playlist-name-cancel').addEventListener('click', closeModal);
  const submit = () => {
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    onSave(name);
  };
  wrap.querySelector('#playlist-name-save').addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });

  focusModalInput(input);
  return wrap;
}

function promptCreatePlaylist(onCreated) {
  const form = playlistNameForm('', (name) => {
    const id = createPlaylist(name);
    closeModal();
    showToast(t('toastPlaylistCreated'));
    if (state.currentPage === 'playlists') renderPlaylistsList({ animate: true });
    if (onCreated) onCreated(id);
  });
  openModal(t('newPlaylistTitle'), form);
}

function confirmDeletePlaylist(id) {
  const pl = getPlaylist(id);
  if (!pl) return;
  const wrap = document.createElement('div');
  const p = document.createElement('p');
  p.className = 'modal-hint';
  p.style.marginTop = '0';
  p.textContent = t('deletePlaylistConfirm', playlistDisplayName(pl));
  const actions = document.createElement('div');
  actions.className = 'modal-actions';
  actions.innerHTML = `
    <button type="button" class="btn-secondary" id="delete-cancel"></button>
    <button type="button" class="btn-primary btn-danger" id="delete-confirm"></button>
  `;
  wrap.appendChild(p);
  wrap.appendChild(actions);
  actions.querySelector('#delete-cancel').textContent = t('cancelBtn');
  actions.querySelector('#delete-confirm').textContent = t('deleteBtn');

  actions.querySelector('#delete-cancel').addEventListener('click', closeModal);
  actions.querySelector('#delete-confirm').addEventListener('click', () => {
    deletePlaylist(id);
    closeModal();
    showToast(t('toastPlaylistDeleted'));
    if (state.activePlaylistId === id) {
      state.activePlaylistId = null;
      history.back();
    }
    if (state.currentPage === 'playlists') renderPlaylistsList({ animate: true });
  });

  openModal(t('deletePlaylistTitle'), wrap);
}

// ---------------------------------------------------------
// "Add to playlist" modal — opened from inside a song. Lists every
// playlist (Favorites first) as a toggleable checklist, plus a row to
// create a brand-new playlist and add the song to it in one step.
// ---------------------------------------------------------
function openAddToPlaylistModal(sourceKey, songId) {
  const wrap = document.createElement('div');
  const list = document.createElement('ul');
  list.className = 'checklist';
  wrap.appendChild(list);

  const renderItems = () => {
    list.innerHTML = '';
    // Favorites is deliberately excluded here: it already has its own
    // dedicated heart button right on this same song page (see
    // #sv-favorite-btn), so offering a second way to do the same thing
    // from inside this "add to a playlist" picker is redundant — and
    // worse, easy to mix up with an actual playlist since it renders in
    // the same list. This modal is only ever opened from that song-page
    // "+" button (see openAddToPlaylistModal's call sites), so filtering
    // it out here doesn't affect Favorites anywhere else in the app.
    state.playlists.order.filter(id => state.playlists.byId[id] && !state.playlists.byId[id].isFavorites).forEach(id => {
      const pl = state.playlists.byId[id];
      const inIt = isSongInPlaylist(id, sourceKey, songId);
      const li = document.createElement('li');
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'checklist-item' + (pl.isFavorites ? ' is-favorites' : '');
      item.setAttribute('aria-pressed', String(inIt));
      item.innerHTML = `
        <span class="checklist-item-icon"><svg data-icon="${pl.isFavorites ? 'heart-filled' : 'nav-playlist'}" viewBox="0 0 24 24"></svg></span>
        <span style="flex:1">${escapeHtml(playlistDisplayName(pl))}</span>
        <span class="checklist-check"><svg data-icon="check" viewBox="0 0 24 24"></svg></span>
      `;
      item.addEventListener('click', () => {
        toggleSongInPlaylist(id, sourceKey, songId);
        if (id === 'favorites') updateFavoriteButtonUI();
        renderItems();
      });
      li.appendChild(item);
      list.appendChild(li);
    });
    initIcons(list);
  };
  renderItems();

  const newRow = document.createElement('button');
  newRow.type = 'button';
  newRow.className = 'modal-new-playlist-row';
  newRow.innerHTML = `<svg data-icon="plus" viewBox="0 0 24 24"></svg><span>${escapeHtml(t('newPlaylistTitle'))}</span>`;
  newRow.addEventListener('click', () => {
    promptCreatePlaylist((id) => {
      addSongToPlaylist(id, sourceKey, songId);
      openAddToPlaylistModal(sourceKey, songId); // reopen this modal with the new playlist checked
    });
  });
  wrap.appendChild(newRow);

  openModal(t('addToPlaylistTitle'), wrap);
}

// ---------------------------------------------------------
// Database picker (Settings → Song database) — a popup rather than a
// plain <select>, specifically so it scales as more databases get added:
// a top seg-toggle tab per DB_GROUP_ORDER entry (currently "All"/"SDA"),
// and under the active tab a single-select checklist of just that group's
// DB_SOURCES entries. Both are driven straight off DB_SOURCES/
// DB_GROUP_ORDER — a new database or a new group needs no changes here,
// see the comment above DB_SOURCES.
//
// Picking a database applies it and closes the popup immediately (like
// the accent-color swatches) rather than needing a separate confirm step,
// since there's nothing else to configure on the way in.
// ---------------------------------------------------------
function openDbPickerModal() {
  const wrap = document.createElement('div');

  // Open on whichever tab already contains the active database, so the
  // person sees their current choice (checkmarked) the instant the popup
  // appears instead of always landing on the first tab.
  let currentGroup = (DB_SOURCES[state.activeDbSource] || {}).group || DB_GROUP_ORDER[0];

  // role="group", not "tablist": every other seg-toggle in this app (song
  // view, chord style, etc.) uses aria-pressed toggle-button semantics
  // rather than tab semantics (aria-selected) — matching that here keeps
  // one consistent pattern for screen readers across the whole app.
  const tabs = document.createElement('div');
  tabs.className = 'seg-toggle db-picker-tabs';
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', t('dbPickerTitle'));
  const thumb = document.createElement('div');
  thumb.className = 'seg-toggle-thumb';
  tabs.appendChild(thumb);

  const listWrap = document.createElement('div');
  listWrap.className = 'db-picker-list-wrap';
  const list = document.createElement('ul');
  list.className = 'checklist';
  listWrap.appendChild(list);

  const renderList = ({ animate = false } = {}) => {
    const startHeight = listWrap.getBoundingClientRect().height;
    list.innerHTML = '';
    Object.keys(DB_SOURCES).filter(key => DB_SOURCES[key].group === currentGroup).forEach(key => {
      const isActive = key === state.activeDbSource;
      const li = document.createElement('li');
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'checklist-item';
      item.setAttribute('aria-pressed', String(isActive));
      item.innerHTML = `
        <span style="flex:1">${escapeHtml(dbSourceLabel(key))}</span>
        <span class="checklist-check"><svg data-icon="check" viewBox="0 0 24 24"></svg></span>
      `;
      item.addEventListener('click', () => {
        if (key !== state.activeDbSource) {
          applyDbSource(key);
          localStorage.setItem('sb-db', key);
          showToast(t('toastDbSaved'));
        }
        closeModal();
      });
      li.appendChild(item);
      list.appendChild(li);
    });
    initIcons(list);

    // Switching tabs (All/SDA) swaps the whole checklist in one go rather
    // than diffing individual rows (unlike renderSongList's per-row diff),
    // since a database group only has a handful of entries and a plain
    // crossfade + height-settle reads just as smoothly for a list this
    // short. The initial render (opening the modal) skips this — nothing's
    // on screen yet to fade from, so animating there would just delay the
    // popup's first paint for no visible benefit.
    if (animate && !prefersReducedMotion()) {
      animateWrapHeightTo(listWrap, listWrap.scrollHeight, startHeight);
      list.classList.remove('db-picker-list-enter');
      void list.offsetWidth; // restart the animation if a previous tab switch is still mid-flight
      list.classList.add('db-picker-list-enter');
    }
  };

  DB_GROUP_ORDER.forEach(group => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'seg-toggle-btn';
    btn.dataset.dbGroup = group;
    btn.setAttribute('aria-pressed', String(group === currentGroup));
    btn.textContent = t(DB_GROUP_LABELS[group] || group);
    btn.addEventListener('click', () => {
      if (group === currentGroup) return;
      currentGroup = group;
      tabs.querySelectorAll('.seg-toggle-btn').forEach(b => {
        b.setAttribute('aria-pressed', String(b === btn));
      });
      positionSegToggleThumb(tabs);
      renderList({ animate: true });
    });
    tabs.appendChild(btn);
  });

  wrap.appendChild(tabs);
  wrap.appendChild(listWrap);
  renderList();

  openModal(t('dbPickerTitle'), wrap);
  // The tabs only just became visible (openModal clears the overlay's
  // `hidden`), so measuring them any earlier would find offsetParent
  // still null — see positionSegToggleThumb()'s guard. instant:true
  // because this is the tab snapping to the already-active database's
  // group, not a tap that should visibly slide.
  positionSegToggleThumb(tabs, { instant: true });
}

// ---------------------------------------------------------
// Labels UI — a reusable "chips you can remove + a text input with live
// suggestions" picker, shared by the song-view "Edit labels" modal
// (openEditLabelsModal) and the Song Editor's inline Labels field (see
// bindSongEditor). The two differ only in WHEN a change actually takes
// effect — the modal writes straight through to personal storage the
// instant a chip is tapped (like "Add to playlist"); the editor holds a
// local draft until Save, like every other field on that page — which is
// exactly what these three callbacks abstract away.
// ---------------------------------------------------------
function buildLabelEditor({ getLabels, addLabel, removeLabel, suggestionSourceKey }) {
  const wrap = document.createElement('div');
  wrap.className = 'label-editor';

  // chipsWrap clips and height-animates around chipsEl (see
  // animateWrapHeightTo) — same approach as .add-songs-list-wrap, so the
  // editor/modal resizes smoothly as chips are added, removed, or wrap
  // onto a new line instead of snapping straight to the new size.
  const chipsWrap = document.createElement('div');
  chipsWrap.className = 'label-editor-chips-wrap';
  const chipsEl = document.createElement('div');
  chipsEl.className = 'label-editor-chips';
  chipsWrap.appendChild(chipsEl);

  const inputWrap = document.createElement('div');
  inputWrap.className = 'label-editor-input-wrap';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'modal-text-input label-editor-input';
  input.maxLength = 30;
  input.autocomplete = 'off';
  input.placeholder = t('labelInputPlaceholder');
  inputWrap.appendChild(input);

  const suggestionsEl = document.createElement('div');
  suggestionsEl.className = 'label-editor-suggestions';

  wrap.appendChild(chipsWrap);
  wrap.appendChild(inputWrap);
  wrap.appendChild(suggestionsEl);

  const buildChip = (label) => {
    const chip = document.createElement('span');
    chip.className = 'label-editor-chip';
    chip.dataset.label = label;
    chip.innerHTML = `
      <span>${escapeHtml(labelDisplayText(label))}</span>
      <button type="button" aria-label="${escapeHtml(t('removeLabelAria'))}"><svg data-icon="close" viewBox="0 0 24 24"></svg></button>
    `;
    chip.querySelector('button').addEventListener('click', () => {
      removeLabel(label);
      renderChips();
      renderSuggestions();
    });
    return chip;
  };

  // Plain build for the very first render (opening the modal/editor
  // shouldn't animate its own initial chips in) and for reduced-motion —
  // same firstRender/prefersReducedMotion split as openAddSongsModal's
  // renderItems. Every render after that is diffed: chips already shown
  // are reused as-is, only the ones actually entering or leaving get a
  // pop/fade, and the wrap's height animates from what it was a moment
  // ago to what it is now instead of snapping.
  let firstRender = true;
  function renderChips() {
    const labels = getLabels();

    if (firstRender || prefersReducedMotion()) {
      firstRender = false;
      chipsEl.innerHTML = '';
      if (!labels.length) {
        chipsEl.innerHTML = `<p class="label-editor-empty">${escapeHtml(t('labelsNoneYet'))}</p>`;
      } else {
        labels.forEach(label => chipsEl.appendChild(buildChip(label)));
      }
      initIcons(chipsEl);
      return;
    }

    const startHeight = chipsWrap.getBoundingClientRect().height;
    const existingChips = new Map();
    Array.from(chipsEl.children).forEach(chip => {
      if (chip.dataset.label) existingChips.set(chip.dataset.label, chip);
    });

    if (!labels.length) {
      existingChips.forEach(chip => chip.remove());
      chipsEl.innerHTML = `<p class="label-editor-empty">${escapeHtml(t('labelsNoneYet'))}</p>`;
      chipsWrap.style.height = 'auto';
      animateWrapHeightTo(chipsWrap, chipsWrap.scrollHeight, startHeight);
      return;
    }

    chipsEl.querySelector('.label-editor-empty')?.remove();
    const fragment = document.createDocumentFragment();
    const keptLabels = new Set();
    labels.forEach(label => {
      keptLabels.add(label);
      let chip = existingChips.get(label);
      if (chip) {
        if (chip.dataset.state === 'exiting') {
          delete chip.dataset.state;
          chip.classList.remove('label-chip-exit');
          if (chip._exitCleanup) {
            chip.removeEventListener('animationend', chip._exitCleanup);
            chip._exitCleanup = null;
          }
        }
      } else {
        chip = buildChip(label);
        chip.classList.add('label-chip-enter');
        chip.addEventListener('animationend', function onEnd() {
          chip.classList.remove('label-chip-enter');
          chip.removeEventListener('animationend', onEnd);
        }, { once: true });
        initIcons(chip);
      }
      fragment.appendChild(chip);
    });

    existingChips.forEach((chip, label) => {
      if (keptLabels.has(label) || chip.dataset.state === 'exiting') return;
      chip.dataset.state = 'exiting';
      chip.classList.add('label-chip-exit');
      const cleanup = () => {
        chip.removeEventListener('animationend', cleanup);
        chip._exitCleanup = null;
        const startH = chipsWrap.getBoundingClientRect().height;
        chip.remove();
        chipsWrap.style.height = 'auto';
        animateWrapHeightTo(chipsWrap, chipsWrap.scrollHeight, startH);
      };
      chip._exitCleanup = cleanup;
      chip.addEventListener('animationend', cleanup);
    });

    chipsEl.appendChild(fragment);
    chipsWrap.style.height = 'auto';
    animateWrapHeightTo(chipsWrap, chipsWrap.scrollHeight, startHeight);
  }

  // Presets not already assigned, plus previously-used custom labels
  // (scoped to suggestionSourceKey, or every source if that's omitted —
  // see buildLabelEditor's call sites) not already assigned, filtered by
  // whatever's currently typed — plus, if what's typed doesn't exactly
  // match anything offered, an "Add '<text>'" row to create it fresh.
  function renderSuggestions() {
    const query = input.value.trim();
    const currentLower = getLabels().map(l => l.toLowerCase());
    const candidates = [];
    LABEL_PRESETS.forEach(p => {
      if (!currentLower.includes(p.toLowerCase())) candidates.push({ value: p, display: labelDisplayText(p) });
    });
    const usedElsewhere = suggestionSourceKey ? labelsInUse(suggestionSourceKey) : Array.from(allPersonalLabelValues());
    usedElsewhere.forEach(value => {
      if (LABEL_PRESETS.includes(value)) return; // already covered above
      if (currentLower.includes(value.toLowerCase())) return;
      if (candidates.some(c => c.value === value)) return;
      candidates.push({ value, display: value });
    });

    let matches = candidates;
    if (query) {
      const q = query.toLowerCase();
      matches = candidates.filter(c => c.display.toLowerCase().includes(q));
    }
    matches = matches.slice(0, 6);

    suggestionsEl.innerHTML = '';
    matches.forEach(c => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'label-suggestion-chip';
      btn.textContent = c.display;
      btn.addEventListener('click', () => commit(c.value));
      suggestionsEl.appendChild(btn);
    });
    const exactMatch = query && candidates.some(c => c.display.toLowerCase() === query.toLowerCase());
    if (query && !exactMatch) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'label-suggestion-chip label-suggestion-new';
      btn.textContent = t('labelAddCustomOption', query);
      btn.addEventListener('click', () => commit(query));
      suggestionsEl.appendChild(btn);
    }
    suggestionsEl.hidden = !suggestionsEl.children.length;
  }

  function commit(value) {
    if (!value.trim()) return;
    addLabel(value);
    input.value = '';
    renderChips();
    renderSuggestions();
    input.focus();
  }

  input.addEventListener('input', renderSuggestions);
  input.addEventListener('focus', renderSuggestions);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (input.value.trim()) commit(input.value);
  });

  renderChips();
  renderSuggestions();
  return wrap;
}

// Renders (or re-renders) the label chips + "Edit labels" affix on the
// song-view page — called from openSong() initially, and again from
// openEditLabelsModal()'s callbacks so a change made in that modal shows
// up on the page underneath immediately, before the modal even closes.
function renderSongViewLabels(sourceKey, song) {
  const labelsEl = document.getElementById('sv-labels');
  if (!labelsEl) return;
  const labels = effectiveLabels(sourceKey, song.id, song);
  // Editing now happens from the "…" menu's "Edit labels" entry (see
  // openSongViewMenu()) instead of a "+ Edit labels" chip inline here —
  // this row is just a read-only display of whatever's currently
  // assigned, so it's hidden entirely rather than showing an empty,
  // actionless row when a song has no labels yet.
  labelsEl.hidden = !labels.length;
  labelsEl.innerHTML = labels.map(l => `<span class="sv-label-chip">${escapeHtml(labelDisplayText(l))}</span>`).join('');
}

// Applies to ANY song — official or user — since labels are entirely a
// personal, on-device layer (see the "Labels" data-layer section) that
// never needs write access to the read-only official databases. Changes
// commit immediately per tap, same as "Add to playlist".
function openEditLabelsModal(sourceKey, songId) {
  const song = findSongByRef(sourceKey, songId);
  const wrap = buildLabelEditor({
    getLabels: () => effectiveLabels(sourceKey, songId, song),
    addLabel: (label) => {
      addPersonalLabel(sourceKey, songId, label);
      renderSongViewLabels(sourceKey, song);
    },
    removeLabel: (label) => {
      removePersonalLabel(sourceKey, songId, label);
      renderSongViewLabels(sourceKey, song);
    },
    suggestionSourceKey: sourceKey,
  });
  openModal(t('labelsEditTitle'), wrap);
}

// ---------------------------------------------------------
// "Add songs" modal — opened from inside a playlist. Lets the person
// search the official song list and toggle songs in or out of the
// current playlist.
// ---------------------------------------------------------
// Smoothly animates el's height from its current value to targetHeight
// (a FLIP-style height transition), instead of letting a content change
// snap the box to its new size instantly — used by openAddSongsModal's
// search results, where the result count (and so the popup's height)
// changes on every keystroke. fromHeight lets a caller pass an
// already-known starting height instead of re-measuring (useful right
// before the DOM is mutated, since measuring after would read the new
// size instead of the old one).
// Re-triggering this while a previous call is still mid-flight (e.g. two
// keystrokes in quick succession) cleanly takes over from wherever the
// box currently is, the same remove/reflow/re-add approach used for the
// page-slide and heart-pop animations elsewhere in this file.
function animateWrapHeightTo(el, targetHeight, fromHeight) {
  if (prefersReducedMotion()) { el.style.height = ''; return; }
  if (el._heightTransitionCleanup) {
    el.removeEventListener('transitionend', el._heightTransitionCleanup);
    el._heightTransitionCleanup = null;
  }
  const start = fromHeight != null ? fromHeight : el.getBoundingClientRect().height;
  el.style.transition = 'none';
  el.style.height = start + 'px';
  void el.offsetHeight; // force the browser to register the start height before animating away from it
  el.style.transition = 'height .28s cubic-bezier(.2, .8, .2, 1)';
  requestAnimationFrame(() => { el.style.height = targetHeight + 'px'; });
  const cleanup = (e) => {
    if (e && e.propertyName !== 'height') return;
    el.style.height = '';
    el.style.transition = '';
    el.removeEventListener('transitionend', cleanup);
    el._heightTransitionCleanup = null;
  };
  el._heightTransitionCleanup = cleanup;
  el.addEventListener('transitionend', cleanup);
}

function openAddSongsModal(playlistId) {
  const wrap = document.createElement('div');
  const searchWrap = document.createElement('div');
  searchWrap.className = 'search-bar modal-search';
  searchWrap.innerHTML = `
    <svg class="search-icon" data-icon="search" viewBox="0 0 24 24" aria-hidden="true"></svg>
    <input type="search" id="add-songs-search" class="search-field" inputmode="search" autocomplete="off">
  `;
  // listWrap clips and height-animates around the list (see
  // animateWrapHeightTo) — the list itself is left free to just hold rows,
  // same as every other checklist/song list in the app.
  const listWrap = document.createElement('div');
  listWrap.className = 'add-songs-list-wrap';
  const list = document.createElement('ul');
  list.className = 'checklist';
  listWrap.appendChild(list);
  wrap.appendChild(searchWrap);
  wrap.appendChild(listWrap);

  const input = searchWrap.querySelector('#add-songs-search');
  input.placeholder = t('searchPlaceholder');

  const buildChecklistItem = (song, sourceKey, hasNumbers) => {
    const li = document.createElement('li');
    li.dataset.songKey = `${sourceKey}:${song.id}`;
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'checklist-item';
    item.setAttribute('aria-pressed', String(isSongInPlaylist(playlistId, sourceKey, song.id)));
    const subtitle = getSongListSubtitle(song);
    item.innerHTML = `
      ${hasNumbers ? `<span class="checklist-badge">${song.number}</span>` : ''}
      <span style="flex:1">
        ${escapeHtml(song.title)}
        ${subtitle ? `<div class="checklist-item-sub">${escapeHtml(subtitle)}</div>` : ''}
      </span>
      <span class="checklist-check"><svg data-icon="check" viewBox="0 0 24 24"></svg></span>
    `;
    item.addEventListener('click', () => {
      const nowIn = toggleSongInPlaylist(playlistId, sourceKey, song.id);
      item.setAttribute('aria-pressed', String(nowIn));
      if (state.activeSong && state.activeSong.id === song.id) updateFavoriteButtonUI();
      renderPlaylistView({ animate: true });
      document.getElementById('pv-count').textContent = t('playlistSongCount', getPlaylist(playlistId).songs.length);
    });
    li.appendChild(item);
    return li;
  };

  let firstRender = true;
  const renderItems = () => {
    const q = input.value.trim().toLowerCase();
    const sourceKey = state.activeDbSource;
    const songs = sortSongs(state.sources[sourceKey].songs.filter(s => matchesQuery(s, q, sourceKey)), q, sourceKey);
    const hasNumbers = (DB_SOURCES[sourceKey] || {}).hasNumbers !== false;

    if (firstRender || prefersReducedMotion()) {
      // Plain build for the very first render (opening the modal shouldn't
      // animate its own initial contents in) and for reduced-motion.
      firstRender = false;
      list.innerHTML = '';
      songs.forEach(song => list.appendChild(buildChecklistItem(song, sourceKey, hasNumbers)));
      initIcons(list);
      return;
    }

    // Diffed render, same approach as renderSongList's search results:
    // only rows actually entering or leaving the filtered results fade —
    // a row present both before and after this keystroke is reused as-is
    // instead of being torn down and rebuilt, so it never flickers.
    const existingItems = new Map();
    Array.from(list.children).forEach(li => {
      if (li.dataset.songKey) existingItems.set(li.dataset.songKey, li);
    });

    const startHeight = listWrap.getBoundingClientRect().height;
    const fragment = document.createDocumentFragment();
    const keptKeys = new Set();

    songs.forEach(song => {
      const key = `${sourceKey}:${song.id}`;
      keptKeys.add(key);
      let li = existingItems.get(key);
      if (li) {
        if (li.dataset.state === 'exiting') {
          delete li.dataset.state;
          li.classList.remove('song-row-exit');
          if (li._exitCleanup) {
            li.removeEventListener('animationend', li._exitCleanup);
            li._exitCleanup = null;
          }
        }
        li.firstElementChild.setAttribute('aria-pressed', String(isSongInPlaylist(playlistId, sourceKey, song.id)));
      } else {
        li = buildChecklistItem(song, sourceKey, hasNumbers);
        li.classList.add('song-row-enter');
        li.addEventListener('animationend', function onEnd() {
          li.classList.remove('song-row-enter');
          li.removeEventListener('animationend', onEnd);
        }, { once: true });
      }
      fragment.appendChild(li);
    });

    // Whatever's left fell out of the results — fade it out and shrink the
    // popup the rest of the way down once it's actually gone, instead of
    // cutting it (and the space it took up) instantly.
    existingItems.forEach((li, key) => {
      if (keptKeys.has(key) || li.dataset.state === 'exiting') return;
      li.dataset.state = 'exiting';
      li.classList.add('song-row-exit');
      const cleanup = () => {
        li.removeEventListener('animationend', cleanup);
        li._exitCleanup = null;
        const startH = listWrap.getBoundingClientRect().height;
        li.remove();
        listWrap.style.height = 'auto'; // momentarily un-clip so scrollHeight below reads the true post-removal size, not a still-mid-transition inline height
        animateWrapHeightTo(listWrap, listWrap.scrollHeight, startH);
      };
      li._exitCleanup = cleanup;
      li.addEventListener('animationend', cleanup);
    });

    list.insertBefore(fragment, list.firstChild);
    initIcons(list);

    // FLIP the popup's height from what it was a moment ago to what the
    // list actually occupies now (rows still fading out are still in the
    // DOM, so they still count) — smooths over the "popup changes shape
    // drastically" jump a plain height snap would otherwise cause.
    listWrap.style.height = 'auto'; // see the exit cleanup's comment above on why this precedes the scrollHeight read
    animateWrapHeightTo(listWrap, listWrap.scrollHeight, startHeight);
  };
  input.addEventListener('input', coalesceToNextFrame(renderItems));
  renderItems();

  openModal(t('addSongsTitle'), wrap);
  focusModalInput(input);
}


async function copyContactEmail(opts = {}) {
  const { silent = false } = opts;
  const email = (window.SONGBOOK_APP_CONFIG && window.SONGBOOK_APP_CONFIG.contactEmail) || '';
  if (!email) return;
  try {
    await navigator.clipboard.writeText(email);
    if (!silent) showToast(t('toastEmailCopied'));
  } catch (err) {
    console.error('Songbook: clipboard copy failed —', err);
    if (!silent) showToast(t('toastEmailCopyFailed'));
  }
}

// Puts the contact button/email-fallback back to its starting state: button
// visible, fallback hidden. Called on language refresh and every time the
// Settings page is (re)opened, so the button reliably comes back after
// switching pages, reloading, or reopening the app — even though within a
// single visit to Settings it disappears the moment it's clicked.
function resetContactUI() {
  const contactBtn = document.getElementById('about-contact-btn');
  const contactFallback = document.getElementById('about-contact-fallback');
  if (!contactBtn || !contactFallback) return;
  const email = (window.SONGBOOK_APP_CONFIG && window.SONGBOOK_APP_CONFIG.contactEmail) || '';
  if (!email) {
    contactBtn.hidden = true;
    contactFallback.hidden = true;
    return;
  }
  contactBtn.href = `mailto:${email}`;
  contactBtn.hidden = false;
  contactFallback.hidden = true;
}

function bindAboutPage() {
  document.getElementById('about-back-btn').addEventListener('click', () => history.back());
}

function bindSettings() {
  document.getElementById('about-nav-row').addEventListener('click', () => {
    showPage('about', { pushHistory: true, resetScroll: true });
  });

  document.getElementById('trash-nav-row').addEventListener('click', () => {
    showPage('trash', { pushHistory: true, resetScroll: true });
  });

  document.getElementById('reload-songs-btn').addEventListener('click', reloadSongLibrary);
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
      if (style === state.chordStyle) return;
      state.chordStyle = style;
      applyChordStyle();
      localStorage.setItem('sb-chord-style', state.chordStyle);
    });
  });

  const hideChordsToggle = document.getElementById('hide-chords-toggle');
  hideChordsToggle.addEventListener('click', () => {
    state.hideChords = !state.hideChords;
    applyHideChords();
    localStorage.setItem('sb-hide-chords', String(state.hideChords));
  });

  const landscapeModeToggle = document.getElementById('landscape-mode-toggle');
  landscapeModeToggle.addEventListener('click', () => {
    state.landscapeMode = !state.landscapeMode;
    applyLandscapeMode();
    localStorage.setItem('sb-landscape-mode', String(state.landscapeMode));
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

// `action`, if provided, is { label, onAction } — shows an inline button
// (e.g. "Undo") inside the toast. Its handler fires once, then the toast
// is dismissed immediately. Duration defaults to 2200ms but callers that
// offer an undo action pass a longer window so it's actually usable.
function showToast(msg, action, duration = 2200) {
  const el = document.getElementById('toast');
  const msgEl = document.getElementById('toast-msg');
  const actionEl = document.getElementById('toast-action');
  msgEl.textContent = msg;

  // Any pending undo from a previous toast must resolve *now* (i.e. the
  // removal it was guarding becomes permanent) before we repurpose the
  // shared toast element for a new message.
  if (showToast._pendingCommit) {
    const commit = showToast._pendingCommit;
    showToast._pendingCommit = null;
    commit();
  }
  // A previous toast's exit animation may still be mid-flight (e.g. this
  // one was triggered right as the last one was fading out) — cancel it
  // and restart the pop-in fresh rather than letting the two animations
  // fight or leaving the new toast stuck at a mid-exit opacity/scale.
  el.classList.remove('is-leaving');
  el.style.animation = 'none';
  void el.offsetWidth; // force the browser to register the removal before re-adding, so the pop-in restarts even if the toast was already visible
  el.style.animation = '';

  if (action) {
    actionEl.textContent = action.label;
    actionEl.hidden = false;
    actionEl.disabled = false;
    actionEl.onclick = () => {
      // Guard against spam-clicks/double-taps firing this twice — once the
      // action has run once it's done, even if the button is still visible
      // for the duration of the hide transition.
      if (actionEl.disabled) return;
      actionEl.disabled = true;
      clearTimeout(showToast._t);
      showToast._pendingCommit = null;
      actionEl.onclick = null;
      el.hidden = true;
      action.onAction();
    };
    showToast._pendingCommit = action.onCommit || null;
  } else {
    actionEl.hidden = true;
    actionEl.onclick = null;
  }

  el.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => {
    // Play the spring-out before actually hiding, instead of cutting
    // straight to `hidden` — mirrors the modal's slide-down-then-hide
    // pattern (see closeModal). Reduced-motion users skip straight to
    // hidden, same as everywhere else in the app.
    const finish = () => {
      el.hidden = true;
      el.classList.remove('is-leaving');
      if (showToast._pendingCommit) {
        const commit = showToast._pendingCommit;
        showToast._pendingCommit = null;
        commit();
      }
    };
    if (prefersReducedMotion()) { finish(); return; }
    el.classList.add('is-leaving');
    const cleanup = (e) => {
      if (e && e.animationName !== 'toast-pop-out') return;
      el.removeEventListener('animationend', cleanup);
      el._toastHideCleanup = null;
      finish();
    };
    if (el._toastHideCleanup) el.removeEventListener('animationend', el._toastHideCleanup);
    el._toastHideCleanup = cleanup;
    el.addEventListener('animationend', cleanup);
  }, duration);
}

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
  wakeLockWanted = state.currentPage === 'song-view';
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
  // 2. reloadApp() (the "Reload app" button) unregisters the old worker,
  //    wipes caches, and calls location.reload() itself to force a fully
  //    fresh load — but the fresh load then registers a brand new worker,
  //    which activates and claims this same page, firing controllerchange
  //    all over again and triggering a SECOND, redundant reload right on
  //    top of the one the button already did. skipNextAutoReload (written
  //    to sessionStorage by reloadApp() just before it reloads, so it
  //    survives the reload) tells this run "the reload already happened
  //    on purpose — sit this one cycle out."
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
}

// ---------------------------------------------------------
// Easter egg #1: a tiny mascot that gently bobs on Saturdays (the
// Sabbath), top-right of the Songbook page, with a speech bubble to its
// left. The hand stays still — no waving. Markup lives in index.html
// (#sabbath-mascot); look/animation in css/style.css (.sabbath-mascot).
// ---------------------------------------------------------
function isSabbathToday() {
  // Sabbath runs Friday 7:00 PM through Saturday 8:00 PM, per the device's
  // own local clock/timezone — there's no one global "Friday evening", so
  // this deliberately goes with whatever time it is wherever the person
  // actually is. (Previously just "is it Saturday" all day; narrowed to
  // this window to better match when Sabbath is actually observed.)
  //
  // Testing hook: open the app with ?previewSabbath=1 in the URL (e.g.
  // index.html?previewSabbath=1) to force the mascot on regardless of
  // what day/time it actually is — no need to change the device's clock
  // just to preview it. Harmless to leave in; nobody stumbles into it by
  // accident since it takes a deliberate query param.
  if (new URLSearchParams(location.search).get('previewSabbath') === '1') return true;
  // Developer options → "Force Sabbath mascot on": force this on
  // regardless of the actual day/time. Off by default and does NOT
  // change the date logic below when off — see state.devSabbathForced.
  if (state.devSabbathForced) return true;
  const now = new Date();
  const day = now.getDay(); // Sunday=0 ... Friday=5, Saturday=6
  const minutesOfDay = now.getHours() * 60 + now.getMinutes();
  const FRIDAY_START = 19 * 60;     // 7:00 PM
  const SATURDAY_END = 20 * 60;     // 8:00 PM
  if (day === 5) return minutesOfDay >= FRIDAY_START;
  if (day === 6) return minutesOfDay < SATURDAY_END;
  return false;
}

function updateSabbathMascotText() {
  const bubble = document.getElementById('sabbath-bubble');
  if (bubble) bubble.textContent = t('sabbathGreeting');
}

function initSabbathMascot() {
  const el = document.getElementById('sabbath-mascot');
  if (!el) return;

  const refresh = () => {
    const show = isSabbathToday();
    el.hidden = !show;
    if (show) updateSabbathMascotText();
  };
  refresh();

  // Covers the rare case of the app being left open across midnight —
  // cheap enough to just poll rather than schedule a precise timeout.
  setInterval(refresh, 5 * 60 * 1000);
}

// ---------------------------------------------------------
// Easter egg #1b: light snow falling along the top of the screen during
// Christmas week (Dec 15 – Jan 1 inclusive, device's own local clock).
// Fixed to the viewport, not any one .page, so it's visible everywhere
// and isn't rebuilt on every page transition. Deliberately confined to a
// short strip along the top (see .christmas-snow's fixed height in
// style.css) rather than the whole screen, and kept sparse/low-opacity —
// this is meant to be a quiet seasonal touch sitting above the content,
// not something that competes with it for attention.
// ---------------------------------------------------------
function isChristmasWeek() {
  // Testing hook: ?previewChristmas=1 forces it on regardless of the
  // actual date — same idea as ?previewSabbath=1 above.
  if (new URLSearchParams(location.search).get('previewChristmas') === '1') return true;
  // Developer options → "Force Christmas snow on": same idea as
  // isSabbathToday()'s own override above — see state.devChristmasForced.
  if (state.devChristmasForced) return true;
  const now = new Date();
  const month = now.getMonth(); // 0-indexed: 11 = December, 0 = January
  const date = now.getDate();
  return (month === 11 && date >= 15) || (month === 0 && date === 1);
}

function initChristmasSnow() {
  const el = document.getElementById('christmas-snow');
  if (!el) return;

  // Poll like the Sabbath mascot below — covers the app being left open
  // across the moment Christmas week actually ends (or, for previewing,
  // across a manual system-clock change), so the fade-out is something a
  // person could actually see happen rather than only ever applying
  // silently on next load.
  const CHECK_INTERVAL = 5 * 60 * 1000;
  let fadeOutTimer = null;

  const buildFlakes = () => {
    if (el.childElementCount) return; // already built for this session
    // Built once as plain positioned/animated <span>s (no canvas/JS-driven
    // rAF loop needed for something this simple) — each flake gets a
    // randomized horizontal position, size, fall speed, start delay, drift,
    // and opacity so the field doesn't look mechanically uniform.
    const COUNT = 20;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < COUNT; i++) {
      const flake = document.createElement('span');
      flake.className = 'snowflake';
      const size = 3 + Math.random() * 4; // 3–7px
      const duration = 7 + Math.random() * 6; // 7–13s to fall through the strip
      const delay = Math.random() * duration; // stagger start so they don't fall in sync
      const drift = (Math.random() * 30 - 15).toFixed(1); // -15..15px sideways over the fall
      flake.style.left = `${(Math.random() * 100).toFixed(1)}%`;
      flake.style.width = `${size}px`;
      flake.style.height = `${size}px`;
      flake.style.opacity = (0.3 + Math.random() * 0.45).toFixed(2);
      flake.style.animationDuration = `${duration.toFixed(1)}s`;
      flake.style.animationDelay = `-${delay.toFixed(1)}s`; // negative delay = starts mid-fall, so the strip isn't empty on first render
      flake.style.setProperty('--drift', `${drift}px`);
      frag.appendChild(flake);
    }
    el.appendChild(frag);
  };

  const refresh = () => {
    const show = isChristmasWeek();

    if (show) {
      // Coming back on (e.g. the clock rolled back during a preview, or
      // this is the very first check) — cancel any fade-out in progress
      // and show immediately; only the ending needs to be gentle.
      if (fadeOutTimer) { clearTimeout(fadeOutTimer); fadeOutTimer = null; }
      el.hidden = false;
      el.classList.remove('christmas-snow-hiding');
      buildFlakes();
      return;
    }

    if (el.hidden) return; // already fully hidden, nothing to fade
    if (fadeOutTimer) return; // fade already in progress

    // Start the fade (CSS transition on .christmas-snow-hiding, see
    // style.css) rather than snapping straight to [hidden] — that's the
    // instant cut this replaces. Only actually hide + clear the flakes
    // once the transition has had time to finish.
    el.classList.add('christmas-snow-hiding');
    fadeOutTimer = setTimeout(() => {
      el.hidden = true;
      el.classList.remove('christmas-snow-hiding');
      el.innerHTML = '';
      fadeOutTimer = null;
    }, 2500); // slightly longer than style.css's 2.4s transition
  };

  refresh();
  setInterval(refresh, CHECK_INTERVAL);
  // Exposed so Developer options' Easter eggs switch (see
  // applyDevOptions()) can trigger an immediate re-check instead of
  // waiting up to CHECK_INTERVAL for the toggle's effect to show.
  window.__ngwRefreshChristmasSnow = refresh;
}

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
};

function hexToHsl(hex) {
  const n = hex.replace('#', '');
  const r = parseInt(n.substring(0, 2), 16) / 255;
  const g = parseInt(n.substring(2, 4), 16) / 255;
  const b = parseInt(n.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s;
  const l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4;
    }
    h *= 60;
  }
  return { h, s, l };
}

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60)       { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

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
const DISCO_PERIOD_SECONDS = 48; // one full hue rotation every 48s — slow, not fast

function startDiscoMode() {
  if (discoModeActive) return;
  discoModeActive = true;

  const currentAccent = document.documentElement.getAttribute('data-accent') || 'aqua';
  const currentTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const base = (ACCENT_PALETTE[currentAccent] || ACCENT_PALETTE.aqua)[currentTheme];
  const baseHsl = base.map(hexToHsl);

  discoHue = 0;
  const root = document.documentElement;
  const step = () => {
    discoHue = (discoHue + (360 * DISCO_TICK_MS / 1000) / DISCO_PERIOD_SECONDS) % 360;
    root.style.setProperty('--accent', hslToHex(baseHsl[0].h + discoHue, baseHsl[0].s, baseHsl[0].l));
    root.style.setProperty('--accent-strong', hslToHex(baseHsl[1].h + discoHue, baseHsl[1].s, baseHsl[1].l));
    root.style.setProperty('--accent-tint', hslToHex(baseHsl[2].h + discoHue, baseHsl[2].s, baseHsl[2].l));
  };
  step();
  discoInterval = setInterval(step, DISCO_TICK_MS);
}

function stopDiscoMode() {
  discoModeActive = false;
  if (discoInterval) clearInterval(discoInterval);
  discoInterval = null;
  // Drop the inline overrides — the transition already registered on
  // :root (see css/style.css) fades this back to the real selected
  // accent smoothly instead of snapping.
  const root = document.documentElement;
  root.style.removeProperty('--accent');
  root.style.removeProperty('--accent-strong');
  root.style.removeProperty('--accent-tint');
}

function bindAccentDiscoEasterEgg() {
  const title = document.getElementById('t-accentTitle');
  if (!title) return;
  let clickTimes = [];
  title.addEventListener('click', () => {
    const now = Date.now();
    clickTimes = clickTimes.filter(ts => now - ts < 800).concat(now);
    if (clickTimes.length >= 3) {
      clickTimes = [];
      // A manual tap always takes ownership of whatever state disco mode
      // ends up in — if the dev switch had forced it on, tapping now
      // stops it (the person's own 3-tap should always be able to turn it
      // off); starting it manually also clears the forced flag so a later
      // dev-switch-off doesn't retroactively kill this session.
      discoForcedByDevToggle = false;
      discoModeActive ? stopDiscoMode() : startDiscoMode();
    }
  });
}
