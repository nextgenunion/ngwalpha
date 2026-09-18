// Songbook service worker — offline-first app shell + data cache.
// Copyright (c) 2026 Next Gen Union. All rights reserved.
// Proprietary and confidential. No unauthorized copying, modification,
// or redistribution, in whole or in part, without prior written
// permission from Next Gen Union. See LICENSE for full terms.
//
// Service workers can't use <script> tags, so importScripts() is the
// standard way to pull in shared code — this runs version.js in this
// worker's global scope, which sets self.SONGBOOK_CACHE_VERSION etc.
// The actual version number lives in ONE place, version.js — bump it
// there, not here.
importScripts('./version.js');
const CACHE_VERSION = self.SONGBOOK_CACHE_VERSION;

// Separate, fixed-name cache just for the app's own last-resort offline
// page. Keeping it outside CACHE_VERSION means ordinary app version rotation
// does not delete it while a new shell is being activated. It cannot survive
// an explicit browser/site-data clear (no web app can), but as long as the
// service worker itself still exists, navigation below will prefer the full
// cached app shell and use offline.html only if that shell is unavailable.
const OFFLINE_CACHE = 'songbook-offline-fallback';

// Song data lives in a stable cache so an app-shell version bump does not
// erase databases that were already used offline. Runtime loading is lazy:
// only the selected/needed database is requested by app.js. database.json is
// a cache-first bootstrap snapshot; manifest.json + individual song files are
// network-first because those individual files are the authoritative/latest
// source after the fast bootstrap is already visible.
const SONGDATA_CACHE = 'songbook-data';

function isSongDataRequest(url) {
  return url.pathname.includes('/data/');
}

function isSongManifestRequest(url) {
  return isSongDataRequest(url) && url.pathname.endsWith('/manifest.json');
}

function isSongBundleRequest(url) {
  return isSongDataRequest(url) && url.pathname.endsWith('/database.json');
}

// The core shell: without any one of these the app can't run at all, so
// these are cached atomically — if even one fails, the whole install fails
// and the OLD service worker (and its cache) stays in control until a
// retry succeeds. This is intentional for the core shell.
const CORE_SHELL = [
  './',
  './index.html',
  './offline.html',
  './manifest.json',
  './version.js',
  './css/style.css',
  './js/app.js',
  './config.js',
  './lang/config.js',
  './lang/eng.js',
  './lang/mn.js',
  './lang/mn2.js', // always loaded now — see index.html's script tag comment
  './lang/kr.js',
];

// Icons and other assets: cached best-effort, one at a time. A single
// missing or renamed file here (e.g. after swapping in a custom icon)
// must NEVER be able to fail the whole install — that would leave every
// visitor stuck on an old cached version indefinitely, with no way to
// pick up a fix short of manually clearing site data.
const BEST_EFFORT_ASSETS = [
  // The font stylesheet itself (now fetched with crossorigin — see
  // index.html — so this is a real, cacheable CORS response rather than
  // an opaque one). Precaching it here means the browser can resolve
  // where each font file (including IBM Plex Mono, used only for chords
  // in the song view) lives without a network round trip on a fresh
  // launch. The actual font files are cached the ordinary way, by the
  // ./ fetch handler below, once js/app.js's scheduleFontWarmup() (or a
  // real song open) asks for them.
  'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Inter:wght@400;500;600;700&family=Noto+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap',
  './icons/app-icon.png',
  './icons/app-icon-maskable.png',
  './icons/splash-logo.png',

  './icons/svg/brand-music-note.svg',
  './icons/svg/search.svg',
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
  './icons/svg/presentation.svg',
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

  // Settings page row icons (Appearance/Songs/App/About — see
  // js/app.js's ICON_FILES and index.html's #page-settings). These were
  // missing from precache, so they only ever loaded from the network and
  // silently failed offline via injectIcon()'s catch block.
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

async function cacheBestEffort(cache, urls) {
  // Small bounded batches keep optional icon caching out of the critical path.
  const CACHE_BATCH_SIZE = 8;
  const results = [];
  for (let i = 0; i < urls.length; i += CACHE_BATCH_SIZE) {
    const settled = await Promise.allSettled(
      urls.slice(i, i + CACHE_BATCH_SIZE).map((url) =>
        cache.add(url).catch((err) => {
          console.warn('Songbook SW: could not precache', url, '—', err);
        })
      )
    );
    results.push(...settled);
  }
  return results;
}

self.addEventListener('install', (event) => {
  // Deliberately minimal and fast: only the small core shell is required
  // for the install to succeed. A slow or interrupted install is exactly
  // the kind of thing aggressive mobile battery/task managers cut short —
  // keeping this fast is what makes the install itself reliable.
  //
  // offline.html goes into its own OFFLINE_CACHE bucket (see the comment
  // by its declaration above), cached alongside the core shell but kept
  // as a fully separate step — if it fails for some reason, the core
  // shell install (the one thing that's required to succeed) isn't put
  // at risk by it.
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(CORE_SHELL))
      .then(async () => {
        // Keep a second copy outside the versioned shell cache. The core copy
        // above is already guaranteed; failure of this redundant copy must
        // not strand an otherwise valid worker install.
        try {
          const offlineCache = await caches.open(OFFLINE_CACHE);
          await offlineCache.add('./offline.html');
        } catch (err) {
          console.warn('Songbook SW: redundant offline fallback cache failed —', err);
        }
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  // Optional UI assets are small and each failure is already swallowed by
  // cacheBestEffort(), so keeping this inside waitUntil makes their offline
  // availability reliable without turning one missing icon into an update
  // failure. Song databases are deliberately NOT precached here.
  event.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(keys
          .filter((k) => k !== CACHE_VERSION && k !== OFFLINE_CACHE && k !== SONGDATA_CACHE)
          .map((k) => caches.delete(k)))
      ),
      caches.open(CACHE_VERSION).then((cache) => cacheBestEffort(cache, BEST_EFFORT_ASSETS)),
    ]).then(() => self.clients.claim())
  );
});

// Cache routing. The full app shell gets a dedicated navigation path so an
// installed PWA launch never depends on the exact URL string ("./", index.html,
// query params, etc.) being present in Cache Storage. If the current shell is
// cached, serve index.html directly. If it is not, try the network, then our
// own offline.html. Chrome's generated PWA offline page should therefore only
// be reachable when Chrome has no controlling service worker at all.
function targetCacheFor(request) {
  return isSongDataRequest(new URL(request.url)) ? SONGDATA_CACHE : CACHE_VERSION;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      await cache.put(request, response.clone());
      return response;
    }
    const cached = await cache.match(request);
    return cached || response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request, cacheName, { ignoreSearchFallback = false } = {}) {
  const cache = await caches.open(cacheName);
  let cached = await cache.match(request);
  // database.json is only a bootstrap snapshot, so when offline an older
  // version-query copy is still far better than no library at all.
  if (!cached && ignoreSearchFallback) {
    cached = await cache.match(request, { ignoreSearch: true });
  }
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) await cache.put(request, response.clone());
  return response;
}

async function appNavigationResponse(request) {
  const shellCache = await caches.open(CACHE_VERSION);
  // Always converge installed-PWA/root/query navigations onto the known-good
  // cached app shell rather than requiring an exact request-URL cache match.
  const cachedShell = await shellCache.match('./index.html')
    || await shellCache.match('./');
  if (cachedShell) return cachedShell;

  try {
    const response = await fetch(request);
    if (response && response.ok) {
      // Seed the canonical shell key too, so the next offline launch is not
      // tied to whichever start/query URL happened to reach us first.
      await shellCache.put('./index.html', response.clone());
      return response;
    }
  } catch (err) {
    // Fall through to the custom offline page below.
  }

  const offlineCache = await caches.open(OFFLINE_CACHE);
  const offline = await offlineCache.match('./offline.html')
    || await shellCache.match('./offline.html');
  if (offline) return offline;

  // Last attempt while the worker still exists. Usually unreachable because
  // install caches offline.html, but returning fetch here is preferable to an
  // undefined Response if a browser/storage edge case removed that entry.
  return fetch('./offline.html');
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const isNavigation = event.request.mode === 'navigate'
    || event.request.destination === 'document';

  if (isNavigation) {
    event.respondWith(appNavigationResponse(event.request));
    return;
  }

  if (event.request.headers.get('X-Force-Refresh') === '1') {
    event.respondWith(networkFirst(event.request, targetCacheFor(event.request)));
    return;
  }

  // database.json is deliberately allowed to be a somewhat older snapshot:
  // app.js uses it only to get a library on screen quickly, then individual
  // files update the visible/local database in the background.
  if (isSongBundleRequest(url)) {
    event.respondWith(cacheFirst(event.request, SONGDATA_CACHE, { ignoreSearchFallback: true }));
    return;
  }

  // Manifest and individual song JSON are the authoritative/latest layer.
  // Network-first means a one-song correction can arrive without rebuilding
  // database.json; cached copies still keep the same selected DB usable offline.
  if (isSongManifestRequest(url) || isSongDataRequest(url)) {
    event.respondWith(networkFirst(event.request, SONGDATA_CACHE));
    return;
  }

  // Small app-shell/icon requests stay cache-first-ish: return the cached
  // response immediately and refresh it in the background. Core versioned
  // updates are still handled atomically by install/activate above.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.ok) {
            caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, response.clone()));
          }
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
