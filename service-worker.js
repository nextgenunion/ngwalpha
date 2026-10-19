// Complete offline installation. The active worker/cache remain usable
// until every required asset and the complete shipped songbooks are saved.
// No optional network/font warmup is allowed to hold activation open.
importScripts('./version.js');
const CACHE_VERSION = self.SONGBOOK_CACHE_VERSION;

const REQUIRED_OFFLINE = [
  './',
  './index.html',
  './offline.html',
  './manifest.json',
  './config.js',
  './css/style.css',
  './version.js',
  './js/app.js',
  './js/chord-core.js',
  './js/chord-finder.js',
  './js/chord-viewer.js',
  './js/guitar-voicings.js',
  './js/piano-chords.js',
  './js/sheet-music.js',
  './js/song-sources.js',
  './lang/config.js',
  './lang/eng.js',
  './lang/kr.js',
  './lang/mn.js',
  './lang/mn2.js',
  './icons/app-icon-192.png',
  './icons/app-icon-512.png',
  './icons/app-icon-maskable.png',
  './icons/app-icon.png',
  './icons/splash-logo.png',
  './icons/svg/back-arrow.svg',
  './icons/svg/brand-music-note.svg',
  './icons/svg/check.svg',
  './icons/svg/chord-finder.svg',
  './icons/svg/close.svg',
  './icons/svg/copy.svg',
  './icons/svg/dark-mode.svg',
  './icons/svg/display.svg',
  './icons/svg/download.svg',
  './icons/svg/filter-tune.svg',
  './icons/svg/format-bold.svg',
  './icons/svg/heart-filled.svg',
  './icons/svg/heart-outline.svg',
  './icons/svg/info-outline.svg',
  './icons/svg/install-mobile.svg',
  './icons/svg/library-music.svg',
  './icons/svg/line-spacing.svg',
  './icons/svg/mail-contact.svg',
  './icons/svg/mascot-sabbath.svg',
  './icons/svg/menu-kebab.svg',
  './icons/svg/music-note.svg',
  './icons/svg/music.svg',
  './icons/svg/nav-playlist.svg',
  './icons/svg/nav-settings-gear.svg',
  './icons/svg/nav-songs-bookmark.svg',
  './icons/svg/nav-user-songs.svg',
  './icons/svg/palette.svg',
  './icons/svg/pencil.svg',
  './icons/svg/plus.svg',
  './icons/svg/refresh.svg',
  './icons/svg/restart-alt.svg',
  './icons/svg/search.svg',
  './icons/svg/social-facebook.svg',
  './icons/svg/social-instagram.svg',
  './icons/svg/social-website.svg',
  './icons/svg/social-youtube.svg',
  './icons/svg/tag.svg',
  './icons/svg/translate.svg',
  './icons/svg/trash.svg',
  './icons/svg/upload.svg',
  './icons/svg/view-list.svg',
  './icons/svg/visibility-off.svg',
  './fonts/fraunces_latin-wght-normal.woff2',
  './fonts/inter_cyrillic-wght-normal.woff2',
  './fonts/noto-sans_cyrillic-ext-wght-normal.woff2',
  './fonts/noto-sans_cyrillic-wght-normal.woff2',
  './audio/001-esus-ta-mongold-aldarshaach.mp3',
  './data/english/manifest.json',
  './data/english/database.json',
  './data/hymn/manifest.json',
  './data/hymn/database.json',
  './data/mongolian/manifest.json',
  './data/mongolian/database.json',
  './data/mongolian2/manifest.json',
  './data/mongolian2/database.json',
  './data/sheet-music/catalog.js',
  './data/sheet-music/assets/sda/h108-amazing-grace.svg',
];

const SONG_DB_FOLDERS = [];

// Bypass the HTTP cache during installation: a new cache version must not
// accidentally receive an older HTML/JS response with a long max-age.
const freshRequest = path => new Request(new URL(path, self.location.href), { cache: 'reload' });

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(REQUIRED_OFFLINE.map(freshRequest));
    // V1–V3 keep their original individual-file loaders. Their manifests
    // define the full offline library; no database conversion is necessary.
    for (const folder of SONG_DB_FOLDERS) {
      const manifest = await cache.match(`./data/${folder}/manifest.json`);
      const files = await manifest.json();
      if (!Array.isArray(files) || files.some(file => typeof file !== 'string' || !/^[^/\\]+\.json$/.test(file) || file.includes('..'))) {
        throw new Error(`Invalid song manifest: ${folder}`);
      }
      await cache.addAll(files.map(file => freshRequest(`./data/${folder}/${file}`)));
    }
    // Any failed asset rejects installation. Never catch and activate an
    // incomplete release; the previous worker still owns its complete cache.
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('songbook-') && key !== CACHE_VERSION)
      .map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

async function installedNavigation() {
  const cache = await caches.open(CACHE_VERSION);
  return await cache.match('./index.html') || await cache.match('./')
    || await cache.match('./offline.html')
    || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

// Bundled audio must support seeking while offline, including suffix ranges.
async function cachedResponse(request, cached) {
  const range = request.headers.get('Range');
  if (!range) return cached;
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2])) return cached;
  const bytes = await cached.arrayBuffer(), size = bytes.byteLength;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Math.min(size - 1, Number(match[2])) : size - 1) : size - 1;
  if (start >= size || end < start || !size) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  const headers = new Headers(cached.headers);
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));
  return new Response(bytes.slice(start, end + 1), { status: 206, headers });
}

async function installedAssetOrNetwork(request) {
  const cache = await caches.open(CACHE_VERSION);
  const cached = await cache.match(request, { ignoreSearch: true });
  const url = new URL(request.url);
  // Keep the existing explicit song-refresh button functional. Network
  // failure retains the installed copy; ordinary app startup is cache-first.
  if (url.origin === self.location.origin && url.pathname.includes('/data/') && request.headers.get('X-Force-Refresh') === '1') {
    try {
      const response = await fetch(request);
      if (response.ok) {
        const key = new URL(request.url); key.search = '';
        await cache.put(key.href, response.clone());
        return response;
      }
    } catch (_) { /* Continue with the installed response below. */ }
  }
  if (cached) return cachedResponse(request, cached);
  return fetch(request);
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const navigation = event.request.mode === 'navigate' || event.request.destination === 'document';
  event.respondWith(navigation ? installedNavigation() : installedAssetOrNetwork(event.request));
});
