// NGWorship — Song loading/sync, personal storage, imports/exports and collection operations.
// Classic deferred script; functions share app.js state and existing helpers.
// Definitions only: app.js keeps initialization order and event registration.
// @begin/@end comments let source-based tests read the current implementations.

/* @begin:dbSourceLabel */


// ---------------------------------------------------------
// Song databases.
//
// The shipped-database metadata now lives in js/song-sources.js. That one
// registry owns each source's data folder, number behavior, picker group,
// display label, and IndexedDB store. Runtime source state is generated from
// the same registry at startup, so adding a database no longer requires
// parallel edits to state.sources and SONGDB_STORES.
//
// To add a shipped database: add its data/ folder + manifest/song files and
// one entry in js/song-sources.js. If the entry introduces a new IndexedDB
// store, increment indexedDbVersion there as part of the same schema change.
// The database picker reads the registry dynamically; the service worker
// handles /data/ requests generically.
// ---------------------------------------------------------
// The display name for a DB_SOURCES entry — its fixed `label`, or t() of
// its `labelKey` when the name itself should follow the interface
// language (see 'english' in DB_SOURCES above).
function dbSourceLabel(sourceKey) {
  const src = DB_SOURCES[sourceKey];
  if (!src) return '';
  return src.labelKey ? t(src.labelKey) : (src.label || sourceKey);
}
/* @end:dbSourceLabel */

/* @begin:isSelectedDbSource */
function isSelectedDbSource(sourceKey) {
  return state.selectedDbSources.includes(sourceKey);
}
/* @end:isSelectedDbSource */

/* @begin:songbookSelectionKey */
function songbookSelectionKey() {
  return state.selectedDbSources.join('\u001f');
}
/* @end:songbookSelectionKey */

/* @begin:songSourceKey */
function songSourceKey(song, fallback) {
  return fallback === SONGBOOK_SOURCE ? songbookSongSources.get(song) : fallback;
}
/* @end:songSourceKey */

/* @begin:songHasVisibleNumber */
function songHasVisibleNumber(song, sourceKey, hasNumbers) {
  return hasNumbers && sourceHasSongNumbers(songSourceKey(song, sourceKey))
    && song.number != null && String(song.number).trim() !== '' && Number.isFinite(Number(song.number));
}
/* @end:songHasVisibleNumber */

/* @begin:getSongbookSource */
function getSongbookSource() {
  const sources = state.selectedDbSources.map(key => state.sources[key]);
  const songs = [];
  state.selectedDbSources.forEach(key => {
    const source = state.sources[key];
    if (!source || source.loadFailed) return;
    source.songs.forEach(song => {
      songbookSongSources.set(song, key);
      songs.push(song);
    });
  });
  return {
    songs,
    loaded: sources.every(source => source && source.loaded),
    loadFailed: sources.every(source => !source || source.loadFailed),
    failedSources: state.selectedDbSources.filter(key => state.sources[key].loadFailed),
  };
}
/* @end:getSongbookSource */

/* @begin:loadSelectedSongDatabases */
function loadSelectedSongDatabases() {
  return Promise.all(state.selectedDbSources.map(key => loadSongDataFor(key)));
}
/* @end:loadSelectedSongDatabases */

/* @begin:songDataBaseUrl */


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
/* @end:songDataBaseUrl */

/* @begin:fetchSongBundleSnapshot */
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
  return songs.map(song => ({ ...song, _songbookOrigin: 'snapshot' }));
}
/* @end:fetchSongBundleSnapshot */

/* @begin:fetchIndividualSongData */
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
            return { file, song: { ...song, _songbookOrigin: 'individual' } };
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
/* @end:fetchIndividualSongData */

/* @begin:mergePartialSongUpdate */


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
/* @end:mergePartialSongUpdate */

/* @begin:openSongDb */
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
/* @end:openSongDb */

/* @begin:saveSongsToIndexedDb */
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
/* @end:saveSongsToIndexedDb */

/* @begin:loadSongsFromIndexedDb */
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
/* @end:loadSongsFromIndexedDb */

/* @begin:isAbortError */
function isAbortError(err) {
  return !!(err && err.name === 'AbortError');
}
/* @end:isAbortError */

/* @begin:syncSongDataFromIndividuals */


// Fetch the latest individual files for the selected database without
// blocking its already-visible bootstrap/local copy. One sync attempt per
// source per session is enough; deselection aborts unwanted work while
// updates for other selected libraries can continue independently.
async function syncSongDataFromIndividuals(sourceKey, { forceRefresh = false, manual = false } = {}) {
  const source = state.sources[sourceKey];
  if (!source || !DB_SOURCES[sourceKey]) return Promise.resolve(null);
  if (DB_SOURCES[sourceKey].bundlePrimary) {
    // No per-song sweep for the 3,143-song English library. Manual refresh
    // reads the same complete database.json bundle with cache revalidation.
    if (!manual) return source.songs;
    const songs = await fetchSongBundleSnapshot(sourceKey, { forceRefresh });
    source.songs = songs;
    source.loaded = true;
    source.loadFailed = false;
    try { await saveSongsToIndexedDb(sourceKey, songs); }
    catch (err) { console.warn('Songbook: English cache write skipped —', err); }
    searchCacheWarmSources.delete(sourceKey);
    if (isSelectedDbSource(sourceKey) && state.currentPage === 'songs') {
      renderSongList();
      scheduleSearchCacheWarmup(sourceKey);
    } else if (isSelectedDbSource(sourceKey)) {
      const list = document.getElementById('song-list');
      if (list) list.dataset.renderSourceKey = '';
    }
    return songs;
  }
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
    // Several rapid re-selections can await the same aborted sweep. Only
    // the first waiter restarts it; later waiters join that new sweep.
    if (source.syncPromise) return source.syncPromise;
  }
  if (!manual && !isSelectedDbSource(sourceKey)) return source.songs;
  if (!navigator.onLine && !manual) return source.songs;

  // Stop work only for databases that are no longer selected.
  Object.entries(state.sources).forEach(([key, other]) => {
    if (key !== sourceKey && !isSelectedDbSource(key) && other && other.syncController) {
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
      if (isSelectedDbSource(sourceKey) && state.currentPage === 'songs') {
        renderSongList();
        scheduleSearchCacheWarmup(sourceKey);
      } else if (isSelectedDbSource(sourceKey)) {
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
/* @end:syncSongDataFromIndividuals */

/* @begin:scheduleSongDataSync */
function scheduleSongDataSync(sourceKey) {
  const start = () => {
    if (!isSelectedDbSource(sourceKey)) return;
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
/* @end:scheduleSongDataSync */

/* @begin:loadSongDataFor */
async function loadSongDataFor(sourceKey, { syncLatest } = {}) {
  const source = state.sources[sourceKey];
  if (!source || !DB_SOURCES[sourceKey]) throw new Error(`unknown song source "${sourceKey}"`);
  const bundlePrimary = !!DB_SOURCES[sourceKey].bundlePrimary;
  const shouldSync = !bundlePrimary && (syncLatest !== undefined ? syncLatest : isSelectedDbSource(sourceKey));

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
    if (bundlePrimary) {
      // Prefer the installed version's full English database over any older
      // six-song IndexedDB snapshot left on existing devices.
      try {
        const snapshot = await fetchSongBundleSnapshot(sourceKey);
        source.songs = snapshot;
        source.loadFailed = false;
        source.loaded = true;
        source.syncAttempted = true;
        // Optional persistence must not prevent a valid bundled database
        // from loading if quota or private mode blocks IndexedDB writes.
        try { await saveSongsToIndexedDb(sourceKey, snapshot); }
        catch (err) { console.warn('Songbook: English cache write skipped —', err); }
        return source.songs;
      } catch (err) {
        console.warn('Songbook: English bundle unavailable; trying saved songs —', err);
      }
    }
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
/* @end:loadSongDataFor */

/* @begin:genUserSongId */
function genUserSongId() {
  // IDs are the permanent identity playlists/Favorites use. Keep them
  // independent of the song title and explicitly avoid both live User Songs
  // and Trash so deleting/recreating a same-named song can never inherit an
  // old playlist reference through an id collision.
  const used = new Set([
    ...state.sources.user.songs.map(song => String(song.id)),
    ...state.trashSongs.map(song => String(song.id)),
  ]);
  let id = '';
  do {
    const randomPart = (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function')
      ? globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    id = 'u_' + randomPart;
  } while (used.has(id));
  return id;
}
/* @end:genUserSongId */

/* @begin:sanitizeUserSongRecord */


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
/* @end:sanitizeUserSongRecord */

/* @begin:isPlainObject */
function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
/* @end:isPlainObject */

/* @begin:safeExternalHttpUrl */


// Song links are opened in a new browser tab, so imported/user-authored data
// must not be able to turn href into a javascript:, data:, or other executable
// scheme. Official song links are HTTP(S) too, so the same allowlist can be
// applied at render time without a source-specific branch.
function safeExternalHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const parsed = new URL(value.trim());
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') ? parsed.href : '';
  } catch (_) {
    return '';
  }
}
/* @end:safeExternalHttpUrl */

/* @begin:normalizeImportedUserSongs */
function normalizeImportedUserSongs(data) {
  if (!Array.isArray(data)) throw new Error('not a user songs export file');

  const seenIds = new Set();
  return data.map((raw, index) => {
    if (!isPlainObject(raw)) throw new Error(`invalid User Song at index ${index}`);

    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    if (!id || !title) throw new Error(`User Song ${index + 1} is missing id/title`);
    if (seenIds.has(id)) throw new Error(`duplicate User Song id: ${id}`);
    seenIds.add(id);

    // Older/hand-edited backups may omit optional arrays. Normalize those to
    // the shape current rendering expects instead of rejecting a recoverable
    // backup. A present lyrics field, however, must still be an array of text.
    const lyrics = raw.lyrics == null ? [] : raw.lyrics;
    if (!Array.isArray(lyrics) || lyrics.some(line => typeof line !== 'string')) {
      throw new Error(`User Song ${index + 1} has invalid lyrics`);
    }

    const links = Array.isArray(raw.links) ? raw.links.reduce((out, link) => {
      const candidate = typeof link === 'string' ? link : (isPlainObject(link) ? link.url : '');
      const url = safeExternalHttpUrl(candidate);
      if (!url) return out;
      if (typeof link === 'string') out.push(url);
      else out.push({ ...link, url, label: typeof link.label === 'string' ? link.label : undefined });
      return out;
    }, []) : [];

    const clean = {
      ...raw,
      id,
      title,
      lyrics: [...lyrics],
      links,
      labels: Array.isArray(raw.labels) ? raw.labels.filter(label => typeof label === 'string') : [],
      sheetMusic: Array.isArray(raw.sheetMusic) ? raw.sheetMusic : [],
    };
    if (raw.alternateTitles != null) {
      const titles = Array.isArray(raw.alternateTitles) ? raw.alternateTitles : [raw.alternateTitles];
      clean.alternateTitles = titles.filter(value => typeof value === 'string' && value.trim()).map(value => value.trim());
    }
    if (raw.artist != null && typeof raw.artist !== 'string') delete clean.artist;
    if (raw.key != null && typeof raw.key !== 'string') delete clean.key;
    return sanitizeUserSongRecord(clean);
  });
}
/* @end:normalizeImportedUserSongs */

/* @begin:loadUserSongs */


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
/* @end:loadUserSongs */

/* @begin:saveUserSong */


// Inserts or updates one song (id decides which — an id already present in
// state.sources.user.songs is an update, otherwise it's an insert) in both
// IndexedDB and the in-memory list, keeping them in lockstep.
async function saveUserSong(song) {
  sanitizeUserSongRecord(song);
  // Persist first. If IndexedDB rejects the write, the in-memory UI stays
  // aligned with what will still be present after a reload.
  await UserSongStorage.put(song);
  const list = state.sources.user.songs;
  const idx = list.findIndex(s => s.id === song.id);
  if (idx === -1) list.push(song);
  else list[idx] = song;
}
/* @end:saveUserSong */

/* @begin:deleteUserSong */


// Moves a User Song to the trash instead of wiping it outright — see the
// "User Songs trash bin" section below for TrashStorage/purgeExpiredTrash/
// restoreTrashedSong, which is where the rest of the trash lifecycle lives.
// Kept as its own function so every existing call site (song-view kebab,
// editor, confirmDeleteUserSong)
// keeps working unchanged — "delete" now means "move to trash" everywhere
// in the app; a separate, explicit action inside the trash bin itself is
// what actually removes a song for good (see permanentlyDeleteTrashSongs).
async function deleteUserSong(id) {
  const song = state.sources.user.songs.find(s => s.id === id);
  if (!song) return;

  // A deleted User Song must immediately stop counting as a playlist song.
  // Remember its memberships inside the Trash entry first so Recover can put
  // it back exactly where it belonged, then remove the live references after
  // the User Song -> Trash transaction succeeds.
  const trashPlaylistIds = getUserSongPlaylistMemberships(id);
  const entry = { ...song, deletedAt: Date.now(), trashPlaylistIds };

  // Commit both song stores before changing either in-memory mirror. A failed
  // transaction therefore leaves the visible state and persisted state as
  // they were, instead of making the song disappear from only one side.
  await UserSongStorage.moveToTrash(song, entry);
  state.sources.user.songs = state.sources.user.songs.filter(s => s.id !== id);
  state.trashSongs = state.trashSongs.filter(s => s.id !== id);
  state.trashSongs.push(entry);
  removeUserSongFromAllPlaylists(id);
}
/* @end:deleteUserSong */

/* @begin:loadTrash */


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
/* @end:loadTrash */

/* @begin:restoreTrashedSong */


// Restores one trashed song back into User Songs. The two IndexedDB writes
// happen atomically (see UserSongStorage.restoreFromTrash), and the in-memory
// mirrors are only updated after that transaction commits successfully.
async function restoreTrashedSong(id) {
  const entry = state.trashSongs.find(s => s.id === id);
  if (!entry) return;
  const { deletedAt, trashPlaylistIds = [], ...song } = entry;
  sanitizeUserSongRecord(song);

  await UserSongStorage.restoreFromTrash(song, id);
  state.trashSongs = state.trashSongs.filter(s => s.id !== id);
  state.sources.user.songs = state.sources.user.songs.filter(s => s.id !== song.id);
  state.sources.user.songs.push(song);
  restoreUserSongPlaylistMemberships(song.id, trashPlaylistIds);
}
/* @end:restoreTrashedSong */

/* @begin:restoreTrashedSongs */


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
/* @end:restoreTrashedSongs */

/* @begin:permanentlyDeleteTrashSongs */


// Removes one or more trashed songs for good — the trash bin's own
// "Delete" action (permanent, unlike deleteUserSong() above which only
// moves a song here in the first place) and the multi-select bulk
// equivalent. No confirmation lives inside this function itself — see
// confirmPermanentlyDeleteTrashSongs() in the "Trash Bin page" section,
// which is what every call site actually goes through.
async function permanentlyDeleteTrashSongs(ids) {
  await TrashStorage.removeMany(ids);
  const idSet = new Set(ids);
  state.trashSongs = state.trashSongs.filter(s => !idSet.has(s.id));
}
/* @end:permanentlyDeleteTrashSongs */

/* @begin:purgeExpiredTrash */


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
/* @end:purgeExpiredTrash */

/* @begin:exportUserSongs */


// Manual export/import: mirrors exportPlaylists/importPlaylistsFromFile
// (see the "Playlists" section below) for exactly the same reason — User
// Songs live in IndexedDB, which is scoped to one browser on the device,
// so this is the honest way to carry hand-authored songs to a different
// browser on the same phone (or as a manual backup) without a server.
function exportUserSongs() {
  const exportSongs = state.sources.user.songs.map(song => sanitizeUserSongRecord({ ...song }));
  const personalLabels = {};
  exportSongs.forEach(song => {
    const labels = state.personalLabels.bySongRef[songRefKey('user', song.id)];
    if (Array.isArray(labels) && labels.length) personalLabels[song.id] = [...labels];
  });
  // Versioned wrapper keeps the separate, editable personal-label layer in
  // the same backup without changing the meaning of each song's own labels.
  const backup = { format: 'ngworship-user-songs', version: 2, songs: exportSongs, personalLabels };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
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
/* @end:exportUserSongs */

/* @begin:importUserSongsFromFile */
async function importUserSongsFromFile(file) {
  try {
    const text = await file.text();
    const backup = JSON.parse(text);
    const wrapped = isPlainObject(backup) && backup.format === 'ngworship-user-songs' && backup.version === 2;
    if (!Array.isArray(backup) && !wrapped) throw new Error('unsupported User Songs backup');
    const cleanData = normalizeImportedUserSongs(wrapped ? backup.songs : backup);
    const importedLabels = {};
    if (wrapped) {
      if (!isPlainObject(backup.personalLabels)) throw new Error('invalid personal labels in backup');
      cleanData.forEach(song => {
        const labels = backup.personalLabels[song.id];
        if (labels == null) return;
        if (!Array.isArray(labels) || labels.some(label => typeof label !== 'string')) {
          throw new Error(`invalid personal labels for ${song.id}`);
        }
        importedLabels[songRefKey('user', song.id)] = [...labels];
      });
    }

    // Full replacement is intentional for backup/device transfer, but the
    // clear + all puts now share one transaction. A failed import therefore
    // leaves the previous User Songs library untouched.
    await UserSongStorage.replaceAll(cleanData);
    state.sources.user.songs = cleanData;
    state.sources.user.loaded = true;
    // Remove stale User Song overrides on the receiving browser, then
    // restore the separate layer from a v2 backup. Legacy array backups
    // did not contain this layer, so they cannot restore personal labels.
    const bySongRef = { ...state.personalLabels.bySongRef };
    Object.keys(bySongRef).forEach(key => {
      if (key.startsWith('user:')) delete bySongRef[key];
    });
    Object.assign(bySongRef, importedLabels);
    state.personalLabels = { ...state.personalLabels, bySongRef };
    const labelsSaved = await LabelStorage.save(state.personalLabels);
    if (state.currentPage === 'user-songs') renderUserSongList();
    if (state.currentPage === 'playlists') renderPlaylistsList();
    if (state.currentPage === 'playlist-view') renderPlaylistView();
    if (state.activeSong) updateFavoriteButtonUI();
    if (labelsSaved) showToast(t('toastUserSongsImported'));
    else reportSaveResult(false);
  } catch (err) {
    console.error('Songbook: user songs import failed —', err);
    showToast(t('toastUserSongsImportFailed'));
  }
}
/* @end:importUserSongsFromFile */

/* @begin:applyDbSource */
function applyDbSource(sourceKey) {
  applyDbSelection([sourceKey], { primary: sourceKey });
}
/* @end:applyDbSource */

/* @begin:applyDbSelection */
function applyDbSelection(keys, { primary } = {}) {
  const selected = SOURCE_REGISTRY.normalizeSelection(keys);
  const previousSelection = new Set(state.selectedDbSources);
  const changed = selected.join('\u001f') !== songbookSelectionKey();
  const revision = ++dbSelectionRevision;
  state.selectedDbSources = selected;
  state.activeDbSource = selected.includes(primary) ? primary
    : (selected.includes(state.activeDbSource) ? state.activeDbSource : selected[0]);

  // A deliberate re-selection retries a failed bootstrap. Retained failed
  // sources do not retry on every unrelated checkbox tap, and a still-running
  // request remains shared rather than being restarted.
  selected.forEach(key => {
    const source = state.sources[key];
    if (source.loadFailed && !source.loadPromise && (!previousSelection.has(key) || !state.multiDbSelect)) {
      source.loaded = false;
      source.loadFailed = false;
      source.syncAttempted = false;
    }
  });

  Object.entries(state.sources).forEach(([key, source]) => {
    if (!selected.includes(key) && source.syncController) {
      source.syncController.abort();
      source.syncAttempted = false;
    }
  });
  try {
    localStorage.setItem('sb-dbs', JSON.stringify(selected));
    localStorage.setItem('sb-db', state.activeDbSource);
    localStorage.setItem('sb-db-multi', String(state.multiDbSelect));
  } catch (_) {}
  updateDbRowSub();
  resetSongSyncProgress(state.activeDbSource);
  if (changed) {
    state.query = '';
    state.songLabelFilters = [];
    const search = document.getElementById('search-input');
    if (search) search.value = '';
    const page = document.getElementById('page-songs');
    if (page) page.scrollTop = 0;
    scrollMemory.songs = 0;
  }
  updateSongToolbarButtons();
  const hasNumbers = sourceHasSongNumbers(SONGBOOK_SOURCE);
  const numBtn = document.querySelector('.sort-btn[data-sort-by="num"]');
  const alphaBtn = document.querySelector('.sort-btn[data-sort-by="alpha"]');
  if (numBtn) numBtn.hidden = !hasNumbers;
  state.sortBy = hasNumbers ? state.sortPref : 'alpha';
  if (numBtn) numBtn.setAttribute('aria-pressed', String(state.sortBy === 'num'));
  if (alphaBtn) alphaBtn.setAttribute('aria-pressed', String(state.sortBy === 'alpha'));

  scheduleSongbookRender();
  loadSelectedSongDatabases().then(() => {
    if (revision !== dbSelectionRevision) return;
    scheduleSongbookRender();
    selected.forEach(scheduleSearchCacheWarmup);
    if (!state.sources[state.activeDbSource].syncController) finishSongSyncProgress(state.activeDbSource);
    if (state.currentPage === 'sheet-music' && isSheetMusicFeatureEnabled()) renderSheetMusicLibrary();
  }).catch(err => console.warn('Songbook: selected libraries could not load —', err));
}
/* @end:applyDbSelection */

/* @begin:createMirroredKeyValueStorage */


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
function createMirroredKeyValueStorage({ dbName, dbVersion = 1, storeName = 'kv', key, localStorageKey, logName }) {
  function openDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) { reject(new Error('IndexedDB unavailable')); return; }
      const req = indexedDB.open(dbName, dbVersion);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(storeName)) req.result.createObjectStore(storeName);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  return {
    async load() {
      try {
        const db = await openDb();
        try {
          const data = await new Promise((resolve, reject) => {
            const req = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
            req.onsuccess = () => resolve(req.result ?? null);
            req.onerror = () => reject(req.error);
          });
          if (data != null) return data;
        } finally {
          db.close();
        }
      } catch (err) {
        console.warn(`Songbook: ${logName} IndexedDB load failed, trying localStorage —`, err);
      }
      try {
        const raw = localStorage.getItem(localStorageKey);
        return raw ? JSON.parse(raw) : null;
      } catch (err) {
        console.warn(`Songbook: ${logName} localStorage load failed —`, err);
        return null;
      }
    },

    // Resolves true if at least one copy (localStorage or IndexedDB) was
    // written, false if both failed (full storage, private mode, storage
    // blocked). It never throws, so callers decide what to tell the person.
    async save(data) {
      let saved = false;
      try {
        localStorage.setItem(localStorageKey, JSON.stringify(data));
        saved = true;
      } catch (err) {
        console.warn(`Songbook: ${logName} localStorage save failed —`, err);
      }
      try {
        const db = await openDb();
        try {
          await new Promise((resolve, reject) => {
            const tx = db.transaction(storeName, 'readwrite');
            tx.objectStore(storeName).put(data, key);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
          });
          saved = true;
        } finally {
          db.close();
        }
      } catch (err) {
        console.warn(`Songbook: ${logName} IndexedDB save failed${saved ? ' (localStorage mirror still saved)' : ''} —`, err);
      }
      return saved;
    },
  };
}
/* @end:createMirroredKeyValueStorage */

/* @begin:genPlaylistId */
function genPlaylistId() {
  return 'pl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
/* @end:genPlaylistId */

/* @begin:normalizePlaylistData */
function normalizePlaylistData(data) {
  if (!isPlainObject(data) || !isPlainObject(data.byId) || !isPlainObject(data.byId.favorites)) {
    throw new Error('not a playlists export file');
  }

  const byId = {};
  for (const [key, raw] of Object.entries(data.byId)) {
    if (!isPlainObject(raw)) continue;
    // Avoid special object-property names when rebuilding byId from imported
    // JSON. Normal app-generated ids are "favorites" or "pl_...".
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue;

    const id = (typeof raw.id === 'string' && raw.id.trim()) ? raw.id.trim() : key;
    if (!id || id === '__proto__' || id === 'prototype' || id === 'constructor') continue;

    const refs = Array.isArray(raw.songs) ? raw.songs : [];
    const seenRefs = new Set();
    const songs = [];
    refs.forEach(ref => {
      if (!isPlainObject(ref) || typeof ref.sourceKey !== 'string' || !ref.sourceKey.trim()) return;
      if (typeof ref.songId !== 'string' && typeof ref.songId !== 'number') return;
      const sourceKey = ref.sourceKey.trim();
      const songId = String(ref.songId);
      if (!songId) return;
      const refKey = `${sourceKey}:${songId}`;
      if (seenRefs.has(refKey)) return;
      seenRefs.add(refKey);
      songs.push({ sourceKey, songId });
    });

    const isFavorites = key === 'favorites';
    if (!isFavorites && id === 'favorites') continue;
    byId[isFavorites ? 'favorites' : id] = {
      ...raw,
      id: isFavorites ? 'favorites' : id,
      name: isFavorites ? '' : (typeof raw.name === 'string' ? raw.name : ''),
      isFavorites,
      songs,
    };
  }

  if (!byId.favorites) {
    throw new Error('playlists export is missing Favorites');
  }

  // Keep the exported order when valid, then append any otherwise-valid
  // playlists that were omitted from it so they cannot become orphaned.
  const order = ['favorites'];
  const seenIds = new Set(order);
  if (Array.isArray(data.order)) {
    data.order.forEach(rawId => {
      const id = String(rawId);
      if (id !== 'favorites' && byId[id] && !seenIds.has(id)) {
        order.push(id);
        seenIds.add(id);
      }
    });
  }
  Object.keys(byId).forEach(id => {
    if (!seenIds.has(id)) {
      order.push(id);
      seenIds.add(id);
    }
  });

  return { ...data, order, byId };
}
/* @end:normalizePlaylistData */

/* @begin:loadPlaylists */
async function loadPlaylists() {
  const saved = await PlaylistStorage.load();
  if (saved) {
    try {
      state.playlists = normalizePlaylistData(saved);
      return;
    } catch (err) {
      console.warn('Songbook: saved playlists were invalid; using a clean Favorites list —', err);
    }
  }
  state.playlists = {
    order: ['favorites'],
    byId: { favorites: { id: 'favorites', name: '', isFavorites: true, songs: [] } },
  };
}
/* @end:loadPlaylists */

/* @begin:reportSaveResult */
// Playlists and labels live only on this device. If neither storage accepted
// a save, say so instead of letting the change look saved and vanish later.
// Shown at most once every 8 s so a burst of edits doesn't stack messages.
function reportSaveResult(saved) {
  if (saved) return true;
  const now = Date.now();
  if (!reportSaveResult._last || now - reportSaveResult._last > 8000) {
    reportSaveResult._last = now;
    showToast(t('toastSaveFailed'), null, 4500);
  }
  return false;
}
/* @end:reportSaveResult */

/* @begin:persistPlaylists */
function persistPlaylists() {
  PlaylistStorage.save(state.playlists).then(reportSaveResult); // the UI never waits on this
}
/* @end:persistPlaylists */

/* @begin:exportPlaylists */


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
/* @end:exportPlaylists */

/* @begin:importPlaylistsFromFile */
async function importPlaylistsFromFile(file) {
  try {
    const text = await file.text();
    const cleanData = normalizePlaylistData(JSON.parse(text));
    state.playlists = cleanData;
    const saved = await PlaylistStorage.save(cleanData);
    if (state.currentPage === 'playlists') renderPlaylistsList();
    if (state.currentPage === 'playlist-view') renderPlaylistView();
    if (state.activeSong) updateFavoriteButtonUI();
    // Imported and usable now, but not saved: say that instead of "imported".
    if (saved) showToast(t('toastPlaylistsImported'));
    else reportSaveResult(false);
  } catch (err) {
    console.error('Songbook: playlist import failed —', err);
    showToast(t('toastPlaylistsImportFailed'));
  }
}
/* @end:importPlaylistsFromFile */

/* @begin:getPlaylist */
function getPlaylist(id) {
  return state.playlists.byId[id] || null;
}
/* @end:getPlaylist */

/* @begin:playlistDisplayName */
function playlistDisplayName(pl) {
  return pl.isFavorites ? t('favoritesName') : pl.name;
}
/* @end:playlistDisplayName */

/* @begin:findSongByRef */
function findSongByRef(sourceKey, songId) {
  const source = state.sources[sourceKey];
  if (!source) return null;
  return source.songs.find(s => s.id === songId) || null;
}
/* @end:findSongByRef */

/* @begin:sourceHasSongNumbers */
function sourceHasSongNumbers(sourceKey) {
  // User Songs never have songbook numbers. DB_SOURCES only contains the
  // packaged databases, so falling back to {} used to make `user` look like
  // a numbered source and rendered a literal "undefined" badge in playlists.
  if (sourceKey === SONGBOOK_SOURCE) return SOURCE_REGISTRY.selectionHasNumbers(state.selectedDbSources);
  return !!(DB_SOURCES[sourceKey] && DB_SOURCES[sourceKey].hasNumbers === true);
}
/* @end:sourceHasSongNumbers */

/* @begin:getUserSongPlaylistMemberships */
function getUserSongPlaylistMemberships(songId) {
  const ids = [];
  Object.values(state.playlists.byId || {}).forEach(pl => {
    if (!pl || !Array.isArray(pl.songs)) return;
    if (pl.songs.some(ref => ref.sourceKey === 'user' && ref.songId === songId)) ids.push(pl.id);
  });
  return ids;
}
/* @end:getUserSongPlaylistMemberships */

/* @begin:removeUserSongFromAllPlaylists */
function removeUserSongFromAllPlaylists(songId) {
  let changed = false;
  Object.values(state.playlists.byId || {}).forEach(pl => {
    if (!pl || !Array.isArray(pl.songs)) return;
    const next = pl.songs.filter(ref => !(ref.sourceKey === 'user' && ref.songId === songId));
    if (next.length !== pl.songs.length) {
      pl.songs = next;
      changed = true;
    }
  });
  if (changed) persistPlaylists();
  return changed;
}
/* @end:removeUserSongFromAllPlaylists */

/* @begin:restoreUserSongPlaylistMemberships */
function restoreUserSongPlaylistMemberships(songId, playlistIds) {
  if (!Array.isArray(playlistIds) || !playlistIds.length) return false;
  let changed = false;
  playlistIds.forEach(playlistId => {
    const pl = getPlaylist(playlistId);
    if (!pl || isSongInPlaylist(playlistId, 'user', songId)) return;
    pl.songs.push({ sourceKey: 'user', songId });
    changed = true;
  });
  if (changed) persistPlaylists();
  return changed;
}
/* @end:restoreUserSongPlaylistMemberships */

/* @begin:repairTrashedUserSongPlaylistRefs */


// v4.2.41 intentionally kept playlist references while a User Song sat in
// Trash. v4.2.42 changes that contract: deleted songs no longer count or
// appear as members, while Recover restores the previous memberships. This
// one-time-safe repair migrates already-deleted songs by recording those
// old memberships on each Trash entry before removing the dangling refs.
async function repairTrashedUserSongPlaylistRefs() {
  const trashById = new Map(state.trashSongs.map(entry => [entry.id, entry]));
  if (!trashById.size) return;

  const changedEntries = new Map();
  let playlistsChanged = false;

  Object.values(state.playlists.byId || {}).forEach(pl => {
    if (!pl || !Array.isArray(pl.songs)) return;
    const kept = [];
    pl.songs.forEach(ref => {
      if (ref.sourceKey !== 'user' || !trashById.has(ref.songId)) {
        kept.push(ref);
        return;
      }

      const entry = trashById.get(ref.songId);
      const membership = Array.isArray(entry.trashPlaylistIds) ? [...entry.trashPlaylistIds] : [];
      if (!membership.includes(pl.id)) membership.push(pl.id);
      entry.trashPlaylistIds = membership;
      changedEntries.set(entry.id, entry);
      playlistsChanged = true;
      // Deliberately do not keep this live playlist ref: a song in Trash is
      // no longer a member until it is recovered.
    });
    if (kept.length !== pl.songs.length) pl.songs = kept;
  });

  if (changedEntries.size) {
    try {
      await TrashStorage.putMany(Array.from(changedEntries.values()));
    } catch (err) {
      // The count/membership bug is worse than losing the optional restore
      // convenience, so still clean the live playlist refs this session.
      console.warn('Songbook: failed to persist Trash playlist-membership repair —', err);
    }
  }
  if (playlistsChanged) persistPlaylists();
}
/* @end:repairTrashedUserSongPlaylistRefs */

/* @begin:playlistSongCount */
function playlistSongCount(pl) {
  if (!pl || !Array.isArray(pl.songs)) return 0;
  const trashedIds = new Set(state.trashSongs.map(song => song.id));
  return pl.songs.reduce((count, ref) => {
    // Defensive display-layer guard for installs upgrading from an older
    // build before its repair write has completed. Official/lazy sources
    // still count normally even if their database is not loaded yet.
    if (ref.sourceKey === 'user' && trashedIds.has(ref.songId)) return count;
    return count + 1;
  }, 0);
}
/* @end:playlistSongCount */

/* @begin:isSongInPlaylist */
function isSongInPlaylist(playlistId, sourceKey, songId) {
  const pl = getPlaylist(playlistId);
  if (!pl) return false;
  return pl.songs.some(ref => ref.sourceKey === sourceKey && ref.songId === songId);
}
/* @end:isSongInPlaylist */

/* @begin:addSongToPlaylist */
function addSongToPlaylist(playlistId, sourceKey, songId) {
  const pl = getPlaylist(playlistId);
  if (!pl || isSongInPlaylist(playlistId, sourceKey, songId)) return;
  pl.songs.push({ sourceKey, songId });
  persistPlaylists();
}
/* @end:addSongToPlaylist */

/* @begin:removeSongFromPlaylist */
function removeSongFromPlaylist(playlistId, sourceKey, songId) {
  const pl = getPlaylist(playlistId);
  if (!pl) return;
  pl.songs = pl.songs.filter(ref => !(ref.sourceKey === sourceKey && ref.songId === songId));
  persistPlaylists();
}
/* @end:removeSongFromPlaylist */

/* @begin:toggleSongInPlaylist */
function toggleSongInPlaylist(playlistId, sourceKey, songId) {
  const nowIn = !isSongInPlaylist(playlistId, sourceKey, songId);
  if (nowIn) addSongToPlaylist(playlistId, sourceKey, songId);
  else removeSongFromPlaylist(playlistId, sourceKey, songId);
  return nowIn;
}
/* @end:toggleSongInPlaylist */

/* @begin:toggleFavorite */
function toggleFavorite(sourceKey, songId) {
  const nowFav = toggleSongInPlaylist('favorites', sourceKey, songId);
  return nowFav;
}
/* @end:toggleFavorite */

/* @begin:createPlaylist */
function createPlaylist(name) {
  const id = genPlaylistId();
  state.playlists.byId[id] = { id, name, isFavorites: false, songs: [], createdAt: Date.now() };
  state.playlists.order.push(id);
  persistPlaylists();
  return id;
}
/* @end:createPlaylist */

/* @begin:renamePlaylist */
function renamePlaylist(id, name) {
  const pl = getPlaylist(id);
  if (!pl || pl.isFavorites) return;
  pl.name = name;
  persistPlaylists();
}
/* @end:renamePlaylist */

/* @begin:deletePlaylist */
function deletePlaylist(id) {
  const pl = getPlaylist(id);
  if (!pl || pl.isFavorites) return;
  delete state.playlists.byId[id];
  state.playlists.order = state.playlists.order.filter(pid => pid !== id);
  persistPlaylists();
}
/* @end:deletePlaylist */

/* @begin:loadPersonalLabels */
async function loadPersonalLabels() {
  const saved = await LabelStorage.load();
  state.personalLabels = (saved && saved.bySongRef) ? saved : { bySongRef: {} };
}
/* @end:loadPersonalLabels */

/* @begin:persistPersonalLabels */


// Fire-and-forget, like persistPlaylists() — every call site already
// updates state.personalLabels synchronously first, so the UI never
// waits on this.
function persistPersonalLabels() {
  LabelStorage.save(state.personalLabels).then(reportSaveResult);
}
/* @end:persistPersonalLabels */

/* @begin:songRefKey */
function songRefKey(sourceKey, songId) {
  return `${sourceKey}:${songId}`;
}
/* @end:songRefKey */

/* @begin:labelDisplayText */

// Display text for a label value — a preset's stable key gets translated;
// anything else is a person's own free-typed text, shown exactly as they
// wrote it (translating that would be putting words in their mouth).
function labelDisplayText(label) {
  const key = LABEL_PRESET_TRANSLATION_KEYS[label];
  return key ? t(key) : label;
}
/* @end:labelDisplayText */

/* @begin:effectiveLabels */


// The label chips actually shown for a song: whatever's personally
// assigned, plus anything already baked into the song's own (currently
// always-empty) `labels` field — see this section's intro comment.
function effectiveLabels(sourceKey, songId, song) {
  const personal = state.personalLabels.bySongRef[songRefKey(sourceKey, songId)] || [];
  const builtIn = (song && song.labels) || [];
  return Array.from(new Set([...builtIn, ...personal]));
}
/* @end:effectiveLabels */

/* @begin:markSongListLabelsStale */


// Label edits can happen while the Songbook page is hidden behind a song
// view. Mark its DOM snapshot stale so returning to the list re-evaluates an
// active label filter instead of reusing rows whose label membership changed.
function markSongListLabelsStale(sourceKey) {
  if (!isSelectedDbSource(sourceKey)) return;
  const listEl = document.getElementById('song-list');
  if (listEl) listEl.dataset.renderLabelFilter = '__stale__';
}
/* @end:markSongListLabelsStale */

/* @begin:addPersonalLabel */


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
  markSongListLabelsStale(sourceKey);
}
/* @end:addPersonalLabel */

/* @begin:removePersonalLabel */
function removePersonalLabel(sourceKey, songId, label) {
  const key = songRefKey(sourceKey, songId);
  const current = state.personalLabels.bySongRef[key];
  if (!current) return;
  const next = current.filter(l => l !== label);
  if (next.length) state.personalLabels.bySongRef[key] = next;
  else delete state.personalLabels.bySongRef[key];
  persistPersonalLabels();
  markSongListLabelsStale(sourceKey);
}
/* @end:removePersonalLabel */

/* @begin:setPersonalLabels */

// Replaces a song's whole personal-label set in one go — used by the Song
// Editor (see openSongEditor/saveSongFromEditor), which holds label edits
// as a local draft like every other field on that page and only commits
// them here once Save actually succeeds.
function setPersonalLabels(sourceKey, songId, labels) {
  const key = songRefKey(sourceKey, songId);
  if (labels && labels.length) state.personalLabels.bySongRef[key] = [...labels];
  else delete state.personalLabels.bySongRef[key];
  persistPersonalLabels();
  markSongListLabelsStale(sourceKey);
}
/* @end:setPersonalLabels */

/* @begin:allPersonalLabelValues */


// Every label personally assigned to ANY song, official or user — feeds
// the label picker's "previously used" suggestions so a person's own
// custom tags stay reusable/consistent instead of retyping "Youth
// Service" slightly differently each time.
function allPersonalLabelValues() {
  const set = new Set();
  Object.values(state.personalLabels.bySongRef).forEach(arr => arr.forEach(l => set.add(l)));
  return set;
}
/* @end:allPersonalLabelValues */

/* @begin:matchesSongLabelFilter */


// Main Songbook label filter. A song passes when no filter is active or
// when it carries at least one selected label (OR semantics). Search text is
// evaluated separately in renderSongList(), so using both naturally narrows
// to songs that satisfy the search AND one of the chosen labels.
function matchesSongLabelFilter(song, sourceKey) {
  if (!state.songLabelFilters.length) return true;
  const labels = effectiveLabels(sourceKey, song.id, song);
  return state.songLabelFilters.some(selected => labels.includes(selected));
}
/* @end:matchesSongLabelFilter */


/* @begin:loadAnnouncements */
async function loadAnnouncements() {
  // Optional online-only content. No polling, startup wait, or offline dependency.
  try {
    const response = await fetch('announcements.json', { cache: 'no-store' });
    const items = response.ok ? await response.json() : [];
    announcements = Array.isArray(items) ? items : [];
  } catch (_) { announcements = []; }
  renderAnnouncements();
}
/* @end:loadAnnouncements */
