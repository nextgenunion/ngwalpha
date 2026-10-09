// NGWorship service worker — one atomic offline application.
//
// Contract:
//   1. A version is not considered installed until every REQUIRED_OFFLINE file
//      has been cached successfully.
//   2. Once installed, the normal app (including every shipped database.json)
//      runs from that cache with no separate "offline mode" or download step.
//   3. If the cached application shell is somehow unavailable, navigation falls
//      back to the self-contained offline.html page.
//
// Keep this deliberately boring. Offline reliability comes from one complete
// cache, not from several overlapping runtime caching strategies.

importScripts('./version.js');
const CACHE_VERSION = self.SONGBOOK_CACHE_VERSION;

const REQUIRED_OFFLINE = [
  './',
  './index.html',
  './offline.html',
  './manifest.json',
  './version.js',
  './config.js',
  './css/style.css',

  './js/app.js',
  './js/song-sources.js',
  './js/chord-core.js',
  './js/guitar-voicings.js',
  './js/piano-chords.js',
  './js/chord-finder.js',
  './js/chord-viewer.js',
  './js/sheet-music.js',

  // Self-hosted fonts (see the @font-face block at the top of css/style.css).
  './fonts/noto-sans_cyrillic-wght-normal.woff2',
  './fonts/noto-sans_cyrillic-ext-wght-normal.woff2',
  './fonts/inter_cyrillic-wght-normal.woff2',
  './fonts/fraunces_latin-wght-normal.woff2',

  './lang/config.js',
  './lang/eng.js',
  './lang/mn.js',
  './lang/mn2.js',
  './lang/kr.js',

  // Complete shipped song-library snapshots. These are the offline source of
  // truth for an installed build. Individual per-song files may still refresh
  // the visible database while online, but the app never depends on them to
  // start or to work offline.
  './data/english/database.json',
  './data/hymn/database.json',
  './data/mongolian/database.json',
  './data/mongolian2/database.json',

  './data/sheet-music/catalog.js',
  './data/sheet-music/assets/sda/h108-amazing-grace.svg',

  './icons/splash-logo.png',
  './icons/app-icon-192.png',
  './icons/app-icon-512.png',

  // Runtime-injected UI icons. Missing one of these creates a visibly broken
  // installed app, so they are part of the same atomic requirement.
  './icons/svg/brand-music-note.svg',
  './icons/svg/search.svg',
  './icons/svg/filter-tune.svg',
  './icons/svg/back-arrow.svg',
  './icons/svg/mail-contact.svg',
  './icons/svg/copy.svg',
  './icons/svg/nav-songs-bookmark.svg',
  './icons/svg/nav-user-songs.svg',
  './icons/svg/nav-settings-gear.svg',
  './icons/svg/nav-playlist.svg',
  './icons/svg/heart-outline.svg',
  './icons/svg/heart-filled.svg',
  './icons/svg/menu-kebab.svg',
  './icons/svg/display.svg',
  './icons/svg/chord-finder.svg',
  './icons/svg/tag.svg',
  './icons/svg/plus.svg',
  './icons/svg/trash.svg',
  './icons/svg/pencil.svg',
  './icons/svg/close.svg',
  './icons/svg/check.svg',
  './icons/svg/download.svg',
  './icons/svg/upload.svg',
  './icons/svg/social-facebook.svg',
  './icons/svg/social-youtube.svg',
  './icons/svg/social-instagram.svg',
  './icons/svg/social-website.svg',
  './icons/svg/mascot-sabbath.svg',
  './icons/svg/dark-mode.svg',
  './icons/svg/palette.svg',
  './icons/svg/library-music.svg',
  './icons/svg/refresh.svg',
  './icons/svg/view-list.svg',
  './icons/svg/music-note.svg',
  './icons/svg/visibility-off.svg',
  './icons/svg/format-bold.svg',
  './icons/svg/line-spacing.svg',
  './icons/svg/translate.svg',
  './icons/svg/install-mobile.svg',
  './icons/svg/restart-alt.svg',
  './icons/svg/info-outline.svg',
];

self.addEventListener('install', (event) => {
  // addAll() rejects if any required response fails. Do not swallow that
  // rejection: a half-cached release must never replace a working release.
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(REQUIRED_OFFLINE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key.startsWith('songbook-') && key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

function isDatabaseBundle(url) {
  return url.origin === self.location.origin && /\/data\/[^/]+\/database\.json$/.test(url.pathname);
}

async function installedNavigation() {
  const cache = await caches.open(CACHE_VERSION);
  const app = await cache.match('./index.html') || await cache.match('./');
  if (app) return app;

  // This should only happen after unusual storage loss/corruption. Keep the
  // fallback self-contained so it has no CSS/JS/image dependency of its own.
  const offline = await cache.match('./offline.html');
  if (offline) return offline;

  return new Response('Offline', {
    status: 503,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

async function installedAssetOrNetwork(request) {
  const cache = await caches.open(CACHE_VERSION);

  // Required files are stored without version query strings. database.json is
  // intentionally requested with ?v=... by app.js, so ignoreSearch lets that
  // request resolve to the atomically installed snapshot.
  const cached = await cache.match(request, { ignoreSearch: true });
  if (cached) return cached;

  // Non-required resources (for example online authoritative per-song refresh
  // files or Google Fonts) remain ordinary network requests. Their failure can
  // never make the installed application itself incomplete.
  return fetch(request);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isNavigation = request.mode === 'navigate' || request.destination === 'document';

  if (isNavigation) {
    event.respondWith(installedNavigation());
    return;
  }

  // The database bundle is deliberately cache-first even while online. A new
  // app release installs a new versioned cache containing its matching bundle;
  // online per-song refresh remains a separate, non-blocking enhancement.
  if (isDatabaseBundle(url)) {
    event.respondWith(installedAssetOrNetwork(request));
    return;
  }

  // For all other GETs, use the installed copy when this request corresponds
  // to a required app asset; otherwise just use the network.
  event.respondWith(installedAssetOrNetwork(request));
});
