// NGWorship — Navigation, lists, editor, playlists, dialogs, effects and page interactions.
// Classic deferred script; functions share app.js state and existing helpers.
// Definitions only: app.js keeps initialization order and event registration.
// @begin/@end comments let source-based tests read the current implementations.

/* @begin:loadIconFile */
function loadIconFile(path) {
  if (!iconFileCache.has(path)) {
    iconFileCache.set(path, fetch(path).then((res) => {
      if (!res.ok) throw new Error(`${path} responded ${res.status}`);
      return res.text();
    }));
  }
  return iconFileCache.get(path);
}
/* @end:loadIconFile */

/* @begin:injectIcon */
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
/* @end:injectIcon */

/* @begin:initIcons */
function initIcons(root = document) {
  return Promise.all(Array.from(root.querySelectorAll('[data-icon]')).map(injectIcon));
}
/* @end:initIcons */

/* @begin:renderSocialLinks */
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
/* @end:renderSocialLinks */

/* @begin:renderCredits */


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
/* @end:renderCredits */

/* @begin:updateDbRowSub */


// Keeps the Settings → Song database row's subtitle showing the *current*
// database's name (rather than a static instructional line) so the active
// choice is visible at a glance without opening the picker — see
// openDbPickerModal(). Called from applyDbSource() (selection changed) and
// applyLanguage() (the 'english' source's name is language-dependent).
function updateDbRowSub() {
  const el = document.getElementById('t-dbSub');
  const label = state.selectedDbSources.map(dbSourceLabel).join(' + ');
  if (el) el.textContent = label;
  const quickBtn = document.getElementById('song-db-btn');
  if (quickBtn) {
    const action = t('dbPickerTitle');
    quickBtn.setAttribute('aria-label', `${action}: ${label}`);
    quickBtn.title = `${action}: ${label}`;
  }
}
/* @end:updateDbRowSub */

/* @begin:scheduleSongbookRender */
function scheduleSongbookRender() {
  const list = document.getElementById('song-list');
  if (list) list.dataset.renderSelection = '__stale__';
  if (songbookRenderFrame) return;
  songbookRenderFrame = requestAnimationFrame(() => {
    songbookRenderFrame = 0;
    if (state.currentPage === 'songs') renderSongList();
  });
}
/* @end:scheduleSongbookRender */

/* @begin:appendSongbookLoadErrors */
function appendSongbookLoadErrors(list, source) {
  (source.failedSources || []).forEach(key => {
    const li = document.createElement('li');
    li.className = 'load-error';
    li.textContent = `${dbSourceLabel(key)}: ${t(navigator.onLine ? 'songLoadError' : 'songLoadOfflineError')}`;
    list.appendChild(li);
  });
}
/* @end:appendSongbookLoadErrors */

/* @begin:setSongSyncProgress */
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
/* @end:setSongSyncProgress */

/* @begin:finishSongSyncProgress */
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
/* @end:finishSongSyncProgress */

/* @begin:resetSongSyncProgress */
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
/* @end:resetSongSyncProgress */

/* @begin:bindTrashPage */
 // id of the row whose "…" menu is currently open, if any

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
/* @end:bindTrashPage */

/* @begin:renderTrashList */
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
/* @end:renderTrashList */

/* @begin:daysRemaining */
function daysRemaining(deletedAt) {
  const msLeft = (deletedAt + TRASH_RETENTION_MS) - Date.now();
  return Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
}
/* @end:daysRemaining */

/* @begin:buildTrashRow */
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
/* @end:buildTrashRow */

/* @begin:toggleTrashSelected */
function toggleTrashSelected(id) {
  if (trashSelectedIds.has(id)) trashSelectedIds.delete(id);
  else trashSelectedIds.add(id);
  updateTrashSelectionUI();
}
/* @end:toggleTrashSelected */

/* @begin:toggleTrashSelectAll */
function toggleTrashSelectAll() {
  const allIds = state.trashSongs.map(s => s.id);
  const allSelected = allIds.length > 0 && allIds.every(id => trashSelectedIds.has(id));
  trashSelectedIds = allSelected ? new Set() : new Set(allIds);
  updateTrashSelectionUI();
}
/* @end:toggleTrashSelectAll */

/* @begin:updateTrashSelectionUI */


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
/* @end:updateTrashSelectionUI */

/* @begin:setTrashSelectMode */
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
/* @end:setTrashSelectMode */

/* @begin:toggleTrashRowMenu */


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
/* @end:toggleTrashRowMenu */

/* @begin:closeTrashRowMenu */
function closeTrashRowMenu() {
  const wrap = document.getElementById('trash-kebab-dropdown');
  trashKebabOpenId = null;
  if (!wrap) return;
  if (prefersReducedMotion()) { wrap.remove(); return; }
  wrap.removeAttribute('id');
  wrap.classList.add('kebab-dropdown-exit');
  wrap.addEventListener('animationend', () => wrap.remove(), { once: true });
}
/* @end:closeTrashRowMenu */

/* @begin:confirmPermanentlyDeleteTrashSongs */


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
/* @end:confirmPermanentlyDeleteTrashSongs */

/* @begin:reloadSongLibrary */


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

  const selected = [...state.selectedDbSources];
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
    for (const sourceKey of selected) {
      if (!isSelectedDbSource(sourceKey)) continue;
      const source = state.sources[sourceKey];
      source.syncAttempted = false;
      await syncSongDataFromIndividuals(sourceKey, { forceRefresh: true, manual: true });
      searchCacheWarmSources.delete(sourceKey);
      scheduleSearchCacheWarmup(sourceKey);
    }
    scheduleSongbookRender();
    showToast(navigator.onLine ? t('toastLibraryReloaded') : t('toastLibraryOffline'));
  } catch (err) {
    console.error('Songbook: manual song database refresh failed —', err);
    showToast(t('toastLibraryReloadFailed'));
  } finally {
    btn.disabled = false;
    btn.textContent = t('reloadBtn');
  }
}
/* @end:reloadSongLibrary */

/* @begin:reloadApp */


// Check for an update while retaining the complete installed app. A failed
// download must never delete the worker/cache that can still launch offline.
async function reloadApp() {
  const btn = document.getElementById('reload-app-btn');
  btn.disabled = true;
  btn.textContent = t('reloadAppBtnBusy');
  try {
    if (!navigator.onLine) showToast(t('toastReloadAppOffline'));
    else if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.update();
    }
  } catch (err) {
    console.warn('Songbook: update unavailable; keeping installed app —', err);
  } finally {
    try { localStorage.setItem('ngw_seen_version', APP_VERSION); } catch (_) {}
    window.location.reload();
  }
}
/* @end:reloadApp */

/* @begin:pushNavState */
function pushNavState(data) {
  navSeq += 1;
  currentNavSeq = navSeq;
  currentNavIndex += 1;
  history.pushState({ ...data, seq: navSeq, index: currentNavIndex }, '', location.href);
}
/* @end:pushNavState */

/* @begin:initHistoryNav */
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
  history.replaceState({ page: 'songs', seq: 0, index: 0 }, '', location.href);
  currentNavIndex = 0;
  navSeq = 0;
  currentNavSeq = 0;

  window.addEventListener('popstate', (e) => {
    const st = e.state;
    if (editorHistoryRecovery) { editorHistoryRecovery = false; return; }
    if (state.currentPage === 'song-editor' && editorHasChanges()) {
      if (!window.confirm(t('discardEditorChanges'))) {
        // Sequence IDs are monotonic, not history distances after branching.
        const delta = st && Number.isInteger(st.index) ? currentNavIndex - st.index
          : (st && st.seq > currentNavSeq ? -1 : 1);
        editorHistoryRecovery = true;
        history.go(delta || 1);
        return;
      }
      editorBaseline = null;
    }
    if (st && Number.isInteger(st.index)) currentNavIndex = st.index;
    closeModal({ immediate: true });
    // Figure out which way we just moved before anything below touches
    // currentNavSeq, so showPage() can read pendingNavDirection once it
    // runs (see the direction comment near pendingNavDirection).
    if (st) {
      const newSeq = typeof st.seq === 'number' ? st.seq : 0;
      pendingNavDirection = newSeq < currentNavSeq ? 'back' : 'forward';
      currentNavSeq = newSeq;
    }
    // Back out of Presentation mode: close the overlay and stay on the song
    // that is still rendered underneath (no re-open, so scroll is untouched).
    if (window.SongPresentation && window.SongPresentation.isOpen()) {
      window.SongPresentation.close();
      if (st && st.page === 'song-view' && state.activeSong && st.songId === state.activeSong.id && !st.presentation) {
        pendingNavDirection = 'forward';
        return;
      }
    }
    if (st && st.page) {
      if (st.page === 'song-view' && st.songId) {
        const sourceKey = st.sourceKey || DEFAULT_DB_SOURCE;
        const source = state.sources[sourceKey];
        const song = source && source.songs.find(s => s.id === st.songId);
        if (song) {
          openSong(song, { pushHistory: false, sourceKey, transpose: st.transpose, scrollTop: st.scrollTop });
          if (st.chordViewer && window.SongChordViewer) window.SongChordViewer.open(st.chordViewer);
          return;
        }
      }
      if (st.page === 'chord-finder' && st.chordViewer) {
        showPage('chord-finder', { pushHistory: false });
        if (window.ChordFinder) window.ChordFinder.openChord(st.chordViewer.symbol, st.chordViewer);
        return;
      }
      if (st.page === 'sheet-view' && st.sheetMusicId) {
        openSheetMusicEntry(st.sheetMusicId, { pushHistory: false });
        return;
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
/* @end:initHistoryNav */

/* @begin:initSplash */


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
      setTimeout(() => { splash.remove(); renderAnnouncements(); }, FADE_MS);
    }, wait);
  };
  if (document.readyState === 'complete') {
    hide();
  } else {
    window.addEventListener('load', hide);
  }
}
/* @end:initSplash */

/* @begin:positionSegToggleThumb */


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
/* @end:positionSegToggleThumb */

/* @begin:updateAllSegToggleThumbs */
function updateAllSegToggleThumbs(opts = {}) {
  document.querySelectorAll('.seg-toggle').forEach(el => positionSegToggleThumb(el, opts));
}
/* @end:updateAllSegToggleThumbs */

/* @begin:renderSongLoadingState */


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
// shows it alphabetically so the Songs page never gets stuck showing a
// sort control for a field that doesn't exist; switching to a numbered
// source later restores the person's sortPref (number order unless they
// chose A–Z while on a numbered library).
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
/* @end:renderSongLoadingState */

/* @begin:ensureSheetMusicCatalog */
async function ensureSheetMusicCatalog() {
  if (!window.SheetMusicCatalog) throw new Error('Sheet Music catalog module is unavailable');
  return window.SheetMusicCatalog.load();
}
/* @end:ensureSheetMusicCatalog */

/* @begin:updateSongSheetMusicButton */
async function updateSongSheetMusicButton(sourceKey = state.activeSourceKey, songId = state.activeSong && state.activeSong.id) {
  const btn = document.getElementById('sv-sheet-music-btn');
  if (!btn) return;
  btn.hidden = true;
  btn.dataset.sheetMusicId = '';
  btn.setAttribute('aria-label', t('sheetMusicOpen'));
  if (!songId || !isSheetMusicFeatureEnabled()) return;

  try {
    await ensureSheetMusicCatalog();
  } catch (err) {
    console.warn('Songbook: could not check Sheet Music for song —', err);
    return;
  }

  // Catalog loading is asynchronous. Do not expose a button for a song that
  // is no longer the one on screen if the person navigated meanwhile.
  if (!state.activeSong || state.activeSong.id !== songId || state.activeSourceKey !== sourceKey) return;
  const entry = window.SheetMusicCatalog.getForSong(sourceKey, songId);
  if (!entry) return;
  btn.dataset.sheetMusicId = entry.id;
  btn.hidden = false;
}
/* @end:updateSongSheetMusicButton */

/* @begin:applySheetMusicFeatureUI */
function applySheetMusicFeatureUI() {
  const enabled = isSheetMusicFeatureEnabled();
  const production = isSheetMusicProductionEnabled();
  const navBtn = document.getElementById('sheet-music-nav-btn');
  if (navBtn) navBtn.hidden = !enabled;

  const toggle = document.getElementById('dev-sheet-music-toggle');
  if (toggle) {
    // This switch represents only the separate developer preview toggle.
    // Unlocking Developer Options never enables Sheet Music by itself.
    toggle.setAttribute('aria-checked', String(state.devSheetMusic));
    toggle.disabled = production;
  }

  const wipBadge = document.getElementById('sheet-music-wip-badge');
  if (wipBadge) wipBadge.hidden = production;
  if (enabled) {
    ensureSheetMusicCatalog().catch((err) => console.warn('Songbook: sheet music catalog load failed —', err));
  } else if (state.currentPage === 'sheet-music' || state.currentPage === 'sheet-view') {
    showPage('songs', { replaceHistory: true, resetScroll: false });
  }
  updateSongSheetMusicButton();
}
/* @end:applySheetMusicFeatureUI */

/* @begin:bindSheetMusicPage */
function bindSheetMusicPage() {
  const search = document.getElementById('sheet-music-search-input');
  if (search) {
    search.addEventListener('input', () => {
      state.sheetMusicQuery = search.value;
      renderSheetMusicLibrary();
    });
  }

  const back = document.getElementById('sheet-view-back-btn');
  if (back) back.addEventListener('click', () => history.back());

  const prev = document.getElementById('sheet-view-prev');
  const next = document.getElementById('sheet-view-next');
  if (prev) prev.addEventListener('click', () => goToSheetMusicPage(state.sheetMusicPageIndex - 1));
  if (next) next.addEventListener('click', () => goToSheetMusicPage(state.sheetMusicPageIndex + 1));

  const pages = document.getElementById('sheet-view-pages');
  if (pages) {
    let raf = 0;
    pages.addEventListener('scroll', () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        syncSheetMusicPageFromScroll();
      });
    }, { passive: true });
  }
}
/* @end:bindSheetMusicPage */

/* @begin:renderSheetMusicLibrary */
async function renderSheetMusicLibrary() {
  if (!isSheetMusicFeatureEnabled()) return;
  const sourceKey = state.activeDbSource;
  const searchInput = document.getElementById('sheet-music-search-input');
  if (searchInput && searchInput.value !== state.sheetMusicQuery) searchInput.value = state.sheetMusicQuery;
  const list = document.getElementById('sheet-music-list');
  const empty = document.getElementById('sheet-music-empty-state');
  const count = document.getElementById('sheet-music-results-count');
  if (!list || !empty || !count) return;

  list.innerHTML = '';
  empty.hidden = true;
  count.textContent = '';

  try {
    await Promise.all([ensureSheetMusicCatalog(), loadSongDataFor(sourceKey)]);
  } catch (err) {
    console.warn('Songbook: could not render Sheet Music library —', err);
    empty.textContent = t('sheetMusicLoadError');
    empty.hidden = false;
    return;
  }
  if (state.activeDbSource !== sourceKey || !isSheetMusicFeatureEnabled()) return;

  const q = normalizeSearchText(state.sheetMusicQuery || '');
  const all = window.SheetMusicCatalog.list(sourceKey)
    .map((entry) => ({ entry, song: findSongByRef(sourceKey, entry.songId) }))
    .filter((item) => !!item.song)
    .sort((a, b) => {
      const an = Number(a.song.number), bn = Number(b.song.number);
      if (Number.isFinite(an) && Number.isFinite(bn) && an !== bn) return an - bn;
      return String(a.song.title || '').localeCompare(String(b.song.title || ''), undefined, { sensitivity: 'base' });
    });

  const filtered = q ? all.filter(({ song }) => {
    const haystack = normalizeSearchText(`${song.number || ''} ${song.title || ''} ${song.artist || ''}`);
    return haystack.includes(q);
  }) : all;

  filtered.forEach(({ entry, song }) => {
    const li = document.createElement('li');
    li.dataset.sheetMusicId = entry.id;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'song-row sheet-music-row';
    row.innerHTML = `
      ${song.number !== undefined && song.number !== null ? `<span class="song-badge">${escapeHtml(String(song.number))}</span>` : ''}
      <span class="song-row-text">
        <span class="song-row-title">${highlight(song.title || entry.songId, state.sheetMusicQuery || '')}</span>
        <span class="song-row-sub">${escapeHtml(t('sheetMusicPages', entry.pages.length))}${entry.demo ? ` · ${escapeHtml(t('sheetMusicSampleBadge'))}` : ''}</span>
      </span>`;
    row.addEventListener('click', () => tapSongRowThenOpen(row, () => openSheetMusicEntry(entry.id)));
    li.appendChild(row);
    list.appendChild(li);
  });

  count.textContent = t('sheetMusicResults', filtered.length);
  empty.textContent = all.length === 0 ? t('sheetMusicEmpty') : t('sheetMusicNoResults');
  empty.hidden = filtered.length !== 0;
}
/* @end:renderSheetMusicLibrary */

/* @begin:openSheetMusicEntry */
async function openSheetMusicEntry(entryOrId, opts = {}) {
  const { pushHistory = true } = opts;
  if (!isSheetMusicFeatureEnabled()) return;
  try {
    await ensureSheetMusicCatalog();
  } catch (err) {
    console.warn('Songbook: sheet music catalog unavailable —', err);
    showToast(t('sheetMusicLoadError'));
    return;
  }
  const entry = typeof entryOrId === 'string'
    ? window.SheetMusicCatalog.getById(entryOrId)
    : entryOrId;
  if (!entry) {
    showToast(t('sheetMusicUnavailable'));
    return;
  }
  await loadSongDataFor(entry.sourceKey);
  const song = findSongByRef(entry.sourceKey, entry.songId);
  if (!song) {
    showToast(t('sheetMusicUnavailable'));
    return;
  }

  state.activeSheetMusicId = entry.id;
  state.sheetMusicPageIndex = 0;
  renderSheetMusicViewer(entry, song);
  showPage('sheet-view', { resetScroll: true });
  if (pushHistory) pushNavState({ page: 'sheet-view', sheetMusicId: entry.id });
}
/* @end:openSheetMusicEntry */

/* @begin:renderSheetMusicViewer */
function renderSheetMusicViewer(entry, song) {
  const number = document.getElementById('sheet-view-number');
  const title = document.getElementById('sheet-view-title');
  const sub = document.getElementById('sheet-view-sub');
  const pagesEl = document.getElementById('sheet-view-pages');
  const attribution = document.getElementById('sheet-view-attribution');
  if (!number || !title || !sub || !pagesEl || !attribution) return;

  number.textContent = song.number !== undefined && song.number !== null ? String(song.number) : '';
  number.hidden = !number.textContent;
  title.textContent = song.title || entry.songId;
  sub.textContent = dbSourceLabel(entry.sourceKey);

  pagesEl.innerHTML = '';
  entry.pages.forEach((page, index) => {
    const figure = document.createElement('figure');
    figure.className = 'sheet-view-page';
    figure.dataset.pageIndex = String(index);
    const status = document.createElement('div');
    status.className = 'sheet-page-status';
    status.textContent = t('sheetMusicLoadingPage');
    const img = document.createElement('img');
    img.className = 'sheet-page-image';
    img.alt = `${song.title || entry.songId} — ${t('sheetMusicPagePosition', index + 1, entry.pages.length)}`;
    img.loading = index === 0 ? 'eager' : 'lazy';
    img.decoding = 'async';
    img.addEventListener('load', () => { status.hidden = true; });
    img.addEventListener('error', () => {
      figure.classList.add('is-error');
      status.hidden = false;
      status.textContent = t('sheetMusicPageError');
    });
    // Bind load/error before assigning src: a score already in HTTP/Cache
    // Storage can resolve extremely quickly on a later offline visit.
    img.src = page.src;
    figure.append(status, img);
    pagesEl.appendChild(figure);
  });
  pagesEl.scrollLeft = 0;

  attribution.innerHTML = '';
  if (entry.attributions && entry.attributions.length) {
    const heading = document.createElement('h3');
    heading.textContent = t('sheetMusicSources');
    attribution.appendChild(heading);
    entry.attributions.forEach((credit) => {
      const row = document.createElement('div');
      row.className = 'sheet-source-row';
      const sourceUrl = safeExternalHttpUrl(credit.url);
      const licenseUrl = safeExternalHttpUrl(credit.licenseUrl);
      const source = sourceUrl
        ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(credit.label)}</a>`
        : `<span>${escapeHtml(credit.label)}</span>`;
      const license = credit.license
        ? (licenseUrl
          ? `<a class="sheet-license" href="${escapeHtml(licenseUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(credit.license)}</a>`
          : `<span class="sheet-license">${escapeHtml(credit.license)}</span>`)
        : '';
      row.innerHTML = `${source}${license}`;
      attribution.appendChild(row);
    });
  }

  updateSheetMusicPageUI();
}
/* @end:renderSheetMusicViewer */

/* @begin:getActiveSheetMusicEntry */
function getActiveSheetMusicEntry() {
  return window.SheetMusicCatalog && state.activeSheetMusicId
    ? window.SheetMusicCatalog.getById(state.activeSheetMusicId)
    : null;
}
/* @end:getActiveSheetMusicEntry */

/* @begin:syncSheetMusicPageFromScroll */
function syncSheetMusicPageFromScroll() {
  const pagesEl = document.getElementById('sheet-view-pages');
  const entry = getActiveSheetMusicEntry();
  if (!pagesEl || !entry || !pagesEl.children.length) return;
  const children = Array.from(pagesEl.children);
  let bestIndex = 0;
  let bestDistance = Infinity;
  children.forEach((child, index) => {
    const distance = Math.abs(child.offsetLeft - pagesEl.scrollLeft);
    if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }
  });
  if (bestIndex !== state.sheetMusicPageIndex) {
    state.sheetMusicPageIndex = bestIndex;
    updateSheetMusicPageUI();
  }
}
/* @end:syncSheetMusicPageFromScroll */

/* @begin:goToSheetMusicPage */
function goToSheetMusicPage(index) {
  const pagesEl = document.getElementById('sheet-view-pages');
  const entry = getActiveSheetMusicEntry();
  if (!pagesEl || !entry) return;
  const clamped = Math.max(0, Math.min(entry.pages.length - 1, index));
  const target = pagesEl.children[clamped];
  if (!target) return;
  state.sheetMusicPageIndex = clamped;
  pagesEl.scrollTo({ left: target.offsetLeft, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  updateSheetMusicPageUI();
}
/* @end:goToSheetMusicPage */

/* @begin:updateSheetMusicPageUI */
function updateSheetMusicPageUI() {
  const entry = getActiveSheetMusicEntry();
  if (!entry) return;
  const total = entry.pages.length;
  const current = Math.max(0, Math.min(total - 1, state.sheetMusicPageIndex));
  const count = document.getElementById('sheet-view-page-count');
  const prev = document.getElementById('sheet-view-prev');
  const next = document.getElementById('sheet-view-next');
  if (count) count.textContent = t('sheetMusicPagePosition', current + 1, total);
  if (prev) {
    prev.disabled = current === 0;
    prev.setAttribute('aria-label', t('sheetMusicPreviousPage'));
  }
  if (next) {
    next.disabled = current === total - 1;
    next.setAttribute('aria-label', t('sheetMusicNextPage'));
  }
  const back = document.getElementById('sheet-view-back-btn');
  if (back) back.setAttribute('aria-label', t('sheetMusicBackAria'));
}
/* @end:updateSheetMusicPageUI */

/* @begin:bindNav */


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
/* @end:bindNav */

/* @begin:showPage */
function showPage(name, opts = {}) {
  const { pushHistory = false, replaceHistory = false, resetScroll = false } = opts;
  const page = PAGES[name];
  if (page && state.currentPage === 'song-editor' && name !== 'song-editor' && editorHasChanges()) {
    if (!window.confirm(t('discardEditorChanges'))) return;
    editorBaseline = null;
  }
  if (!page) {
    console.error(`Songbook: showPage() called with unknown page "${name}"`);
    return;
  }

  // Sheet Music is intentionally WIP/dev-gated for now. The exact same
  // pages can later be released by flipping config.features.sheetMusic;
  // stale browser history cannot bypass the gate while it is disabled.
  if ((name === 'sheet-music' || name === 'sheet-view') && !isSheetMusicFeatureEnabled()) {
    name = 'songs';
  }
  const gatedPage = PAGES[name];
  if (gatedPage !== page) {
    return showPage(name, opts);
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

  // Same idea for the Chord Finder's display mode: its only way out is
  // a small kebab, so never let it reopen stuck in it after navigating away.
  if (!isSamePage && state.currentPage === 'chord-finder' && window.ChordFinder) {
    window.ChordFinder.exitDisplay();
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

  // Bottom-nav spacing belongs to the page that is actually being shown,
  // not to the whole document. During push/pop transitions two pages are
  // deliberately visible at once; changing a body-wide padding rule here
  // used to shrink the Settings page underneath a no-nav subpage. If
  // Settings was scrolled near the bottom (About/Developer options), that
  // reduced its scrollHeight and the browser clamped scrollTop mid-slide,
  // producing the visible background-page jump/flick. Keep each page's
  // geometry stable instead.
  targetEl.classList.toggle('page-no-bottom-nav', !!page.hideNav);

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
  renderAnnouncements();
  updateWakeLock();

  if (pushHistory) {
    pushNavState({ page: name });
  } else if (replaceHistory) {
    history.replaceState({ page: name, seq: currentNavSeq, index: currentNavIndex }, '', location.href);
  }
}
/* @end:showPage */

/* @begin:prefersReducedMotion */


// Whether the person has asked the OS/browser to minimize motion — the
// slide transition below is skipped entirely for them (falls back to the
// original instant cut) rather than trying to offer a "reduced" version.
function prefersReducedMotion() {
  return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}
/* @end:prefersReducedMotion */

/* @begin:cancelRowExit */



// Shared list-row animation bookkeeping used by search results, playlists,
// and the Add Songs picker.
function cancelRowExit(el) {
  if (!el || el.dataset.state !== 'exiting') return;
  delete el.dataset.state;
  el.classList.remove('song-row-exit');
  if (el._exitCleanup) {
    el.removeEventListener('animationend', el._exitCleanup);
    el._exitCleanup = null;
  }
}
/* @end:cancelRowExit */

/* @begin:animateRowEnter */
function animateRowEnter(el) {
  if (!el) return;
  el.classList.add('song-row-enter');
  el.addEventListener('animationend', function onEnd() {
    el.classList.remove('song-row-enter');
  }, { once: true });
}
/* @end:animateRowEnter */

/* @begin:animateRowExit */
function animateRowExit(el, onRemove) {
  if (!el || el.dataset.state === 'exiting') return;
  el.dataset.state = 'exiting';
  el.classList.add('song-row-exit');
  const cleanup = () => {
    el._exitCleanup = null;
    if (onRemove) onRemove(el);
    else el.remove();
  };
  el._exitCleanup = cleanup;
  el.addEventListener('animationend', cleanup, { once: true });
}
/* @end:animateRowExit */

/* @begin:tapSongRowThenOpen */


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
/* @end:tapSongRowThenOpen */

/* @begin:runPageSlideTransition */


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
/* @end:runPageSlideTransition */

/* @begin:runTabFadeTransition */


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
/* @end:runTabFadeTransition */

/* @begin:coalesceToNextFrame */


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
/* @end:coalesceToNextFrame */

/* @begin:bindSongsPage */


// ---------------------------------------------------------
// Songs page: search + sort + list rendering
// ---------------------------------------------------------
function bindSongsPage() {
  const input = document.getElementById('search-input');
  input.addEventListener('input', coalesceToNextFrame(() => {
    state.query = input.value.trim().toLowerCase();
    renderSongList({ animate: true });
  }));

  const searchToolsBtn = document.getElementById('song-search-tools-btn');
  if (searchToolsBtn) searchToolsBtn.addEventListener('click', openSongSearchToolsModal);
  const dbBtn = document.getElementById('song-db-btn');
  if (dbBtn) dbBtn.addEventListener('click', openDbPickerModal);
  updateSongToolbarButtons();

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
      // Only a choice made on a numbered library is a real preference about
      // number order; on a library without numbers the only visible option is
      // A–Z, so tapping it must not be remembered as "never sort by number".
      if (sourceHasSongNumbers(SONGBOOK_SOURCE)) state.sortPref = btn.dataset.sortBy;
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
/* @end:bindSongsPage */

/* @begin:bindUserSongsPage */


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
/* @end:bindUserSongsPage */

/* @begin:renderUserSongList */
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
/* @end:renderUserSongList */

/* @begin:escapeHtml */
function escapeHtml(str) {
  return str.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
/* @end:escapeHtml */

/* @begin:visibleSongRowKeys */


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
/* @end:visibleSongRowKeys */

/* @begin:renderSongList */
function renderSongList(opts = {}) {
  const {
    sourceKey = SONGBOOK_SOURCE,
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

  const source = sourceKey === SONGBOOK_SOURCE ? getSongbookSource() : state.sources[sourceKey];
  const listEl = document.getElementById(listElId);
  const emptyEl = document.getElementById(emptyElId);
  const countEl = document.getElementById(countElId);

  if (listEl) {
    listEl.dataset.renderSourceKey = sourceKey;
    listEl.dataset.renderQuery = query || '';
    if (listElId === 'song-list') {
      listEl.dataset.renderLabelFilter = state.songLabelFilters.slice().sort().join('\u001f');
      listEl.dataset.sortBy = state.sortBy;
      listEl.dataset.sortOrder = state.sortOrder;
      listEl.dataset.renderSelection = songbookSelectionKey();
    }
  }

  if (source && (sourceKey === SONGBOOK_SOURCE || DB_SOURCES[sourceKey]) && !source.loaded) {
    listEl.innerHTML = '';
    emptyEl.hidden = true;
    countEl.textContent = '';
    if (listElId === 'song-list') {
      setSongSyncProgress(state.activeDbSource, 0, 0, { indeterminate: true });
      updateSongScrollIndex([], false, '');
    }
    return;
  }

  if (!source || source.loadFailed) {
    const loadErrorKey = (source && (sourceKey === SONGBOOK_SOURCE || DB_SOURCES[sourceKey]) && !navigator.onLine)
      ? 'songLoadOfflineError'
      : 'songLoadError';
    listEl.innerHTML = `<li class="load-error">${escapeHtml(t(loadErrorKey))}</li>`;
    emptyEl.hidden = true;
    countEl.textContent = '';
    if (animate) animateListRefresh(listEl, emptyEl, countEl);
    if (listElId === 'song-list') updateSongScrollIndex([], false, '');
    return;
  }

  const filtered = filterAndSortSongs(
    source.songs,
    query,
    sourceKey,
    listElId === 'song-list' ? (song => matchesSongLabelFilter(song, songSourceKey(song, sourceKey))) : null
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
  const hasNumbers = sourceHasSongNumbers(sourceKey);

  const q = query;

  if (!animate || prefersReducedMotion()) {
    // Plain rebuild for non-search-driven renders (tab visits, db switch,
    // language change, reduced-motion) — nothing is animating, so there's
    // no reason to pay for the diff below.
    listEl.innerHTML = '';
    filtered.forEach(song => listEl.appendChild(buildSongRow(song, songHasVisibleNumber(song, sourceKey, hasNumbers), q, songSourceKey(song, sourceKey))));
    // The fast-scroll rail (see updateSongScrollIndex()) only exists on
    // the Songbook list — User Songs and playlist song-pickers reuse this
    // same function against their own listElId with no rail in their
    // markup, so this is a no-op for those.
    appendSongbookLoadErrors(listEl, source);
    if (listElId === 'song-list') updateSongScrollIndex(filtered, hasNumbers, q || (state.songLabelFilters.length ? '__label_filter__' : ''));
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
    const key = `${songSourceKey(song, sourceKey)}:${song.id}`;
    keptKeys.add(key);
    let li = existingRows.get(key);
    if (li) {
      // Already on screen — bring back from a leave-animation if this
      // song reappeared mid-fade (e.g. one character got backspaced),
      // and refresh its highlighted title text for the new query.
      cancelRowExit(li);
      updateSongRowContent(li, song, songHasVisibleNumber(song, sourceKey, hasNumbers), q);
    } else {
      li = buildSongRow(song, songHasVisibleNumber(song, sourceKey, hasNumbers), q, songSourceKey(song, sourceKey));
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
    animateRowExit(li);
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
      animateRowEnter(li);
    });
  }

  listEl.querySelectorAll('.load-error').forEach(row => row.remove());
  appendSongbookLoadErrors(listEl, source);
  if (listElId === 'song-list') updateSongScrollIndex(filtered, hasNumbers, q || (state.songLabelFilters.length ? '__label_filter__' : ''));
}
/* @end:renderSongList */

/* @begin:onSongsPageEnter */


// Returning to Songs should not rebuild thousands of rows just because the
// page became visible again. The rows themselves are already current; the
// fast-scroll rail needs its thumb synced to the visible page again.
function onSongsPageEnter() {
  const source = getSongbookSource();
  const listEl = document.getElementById('song-list');

  if (!source || !source.loaded) {
    renderSongLoadingState();
    if (source) {
      loadSelectedSongDatabases().then(() => {
        if (state.currentPage === 'songs') renderSongList();
      });
    }
    return;
  }

  const renderMatchesCurrentState = listEl
    && listEl.dataset.renderSourceKey === SONGBOOK_SOURCE
    && listEl.dataset.renderSelection === songbookSelectionKey()
    && listEl.dataset.sortOrder === state.sortOrder
    && listEl.dataset.renderQuery === (state.query || '')
    && listEl.dataset.renderLabelFilter === state.songLabelFilters.slice().sort().join('\u001f')
    && listEl.dataset.sortBy === state.sortBy;

  if (!renderMatchesCurrentState) {
    renderSongList();
    return;
  }

  // Favorites may have changed in song view, a playlist, or an import while
  // this list was hidden and its existing rows were retained.
  refreshSongbookFavoriteMarkers();
  refreshSongScrollIndexMeasurements();
}
/* @end:onSongsPageEnter */

/* @begin:refreshSongScrollIndexMeasurements */
function refreshSongScrollIndexMeasurements() {
  if (!scrollIndexEntries.length) return;
  scrollIndexEntries = measureScrollIndexEntries(scrollIndexEntries);
  updateScrollThumbPosition();
}
/* @end:refreshSongScrollIndexMeasurements */

/* @begin:scrollIndexLetter */


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

// Keep the title's actual script. Cyrillic Н is not Latin H, even when
// their glyphs look alike. Numeric titles share the conventional # label.
function scrollIndexLetter(title) {
  const raw = Array.from(String(title || '').trim())[0];
  return !raw || /[0-9]/.test(raw) ? '#' : raw.toUpperCase();
}
/* @end:scrollIndexLetter */

/* @begin:computeScrollIndexEntries */


// One entry per actual song, in the current sorted order. Never infer a
// number from its array index or round it: future books can start anywhere,
// have gaps, or sort in reverse, and their printed numbers must survive.
function computeScrollIndexEntries(sortedSongs, sortBy, hasNumbers) {
  return sortedSongs.map((song, index) => ({
    id: song.id,
    sourceKey: songbookSongSources.get(song),
    index,
    label: sortBy === 'num' && hasNumbers && song.number != null
      && String(song.number).trim() !== '' && Number.isFinite(Number(song.number))
      && (!songbookSongSources.has(song) || sourceHasSongNumbers(songbookSongSources.get(song)))
      ? String(song.number) : scrollIndexLetter(song.title),
  }));
}
/* @end:computeScrollIndexEntries */

/* @begin:measureScrollIndexEntries */


// Retain row references, not pixel offsets. content-visibility:auto changes
// off-screen placeholder heights as songs are laid out; resizing and font
// loading also change geometry. Read current bounds only when scrubbing.
function measureScrollIndexEntries(entries) {
  const listEl = document.getElementById('song-list');
  if (!listEl) return entries;
  const rows = new Map(Array.from(listEl.children, li => [li.dataset.rowKey, li]));
  const sourceKey = listEl.dataset.renderSourceKey;
  entries.forEach(entry => { entry.row = rows.get(`${entry.sourceKey || sourceKey}:${entry.id}`); });
  return entries;
}
/* @end:measureScrollIndexEntries */

/* @begin:updateSongScrollIndex */


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

  // Fewer than two songs needs no scrollbar assist.
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
/* @end:updateSongScrollIndex */

/* @begin:labelForScrollTop */


// Follow a point inside the visible viewport, from its top at the start to
// its bottom at the end. This includes the final screenful gradually rather
// than abruptly substituting the book's last number at the bottom. Every
// reported song is on screen. Binary search reads live row bounds in O(log n)
// without forcing layout of every off-screen song's contents.
function labelForScrollTop(scrollTop, maxScroll) {
  const entries = scrollIndexEntries;
  const pageEl = document.getElementById('page-songs');
  if (!entries.length || !pageEl || !pageEl.clientHeight) return '';
  const limit = maxScroll == null ? pageEl.scrollHeight - pageEl.clientHeight : maxScroll;
  const ratio = limit > 0 ? Math.min(1, Math.max(0, scrollTop / limit)) : 0;
  const targetY = pageEl.getBoundingClientRect().top + ratio * pageEl.clientHeight;
  const topAt = i => entries[i].row.getBoundingClientRect().top;
  if (!entries[0].row || !entries[0].row.isConnected) return '';
  if (targetY < topAt(0)) return SCROLL_INDEX_SEARCH_LABEL;

  let lo = 0, hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (topAt(mid) <= targetY) lo = mid + 1;
    else hi = mid;
  }
  const end = Math.max(0, lo - 1);
  const rowTop = topAt(end);
  let start = end;
  while (start > 0 && Math.abs(topAt(start - 1) - rowTop) < 1) start--;
  // Tiles/landscape put multiple songs in a row. Traverse those songs in
  // reading order as the reference point moves through that row's height.
  const nextTop = end + 1 < entries.length
    ? topAt(end + 1) : entries[end].row.getBoundingClientRect().bottom;
  const fraction = Math.min(0.999999, Math.max(0, (targetY - rowTop) / Math.max(1, nextTop - rowTop)));
  return entries[start + Math.floor(fraction * (end - start + 1))].label;
}
/* @end:labelForScrollTop */

/* @begin:renderThumbTransform */
       // clamp so a hard flick can't look broken

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
/* @end:renderThumbTransform */

/* @begin:stepThumbSquish */


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
/* @end:stepThumbSquish */

/* @begin:nudgeThumbSquish */


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
/* @end:nudgeThumbSquish */

/* @begin:updateScrollThumbPosition */


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
/* @end:updateScrollThumbPosition */

/* @begin:setScrollIndexActive */


// Brings the indicator to full opacity (see .scroll-index.is-active in
// css/style.css) and cancels any pending fade — used both by an ordinary
// list scroll and by grabbing the thumb itself.
function setScrollIndexActive(active) {
  const track = document.getElementById('song-scroll-index');
  if (track) track.classList.toggle('is-active', active);
}
/* @end:setScrollIndexActive */

/* @begin:scheduleScrollIndexFade */


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
/* @end:scheduleScrollIndexFade */

/* @begin:bindScrollIndexInteraction */


// Pointer Events share the same handle drag for mouse and touch.
function bindScrollIndexInteraction() {
  const track = document.getElementById('song-scroll-index');
  const thumb = document.getElementById('song-scroll-thumb');
  const bubble = document.getElementById('song-scroll-index-bubble');
  const pageEl = document.getElementById('page-songs');
  if (!track || !thumb || !pageEl) return;

  // Ordinary swipe-scrolling of the list: brings the thumb to full opacity
  // and keeps it tracking the scroll position in real time, but never shows
  // the popup bubble — that's reserved for actually grabbing the handle.
  pageEl.addEventListener('scroll', () => {
    if (track.hidden) return;
    updateScrollThumbPosition();
    if (scrollIndexDragging && dragPointerY != null) updateDragBubble(dragPointerY);
    setScrollIndexActive(true);
    scheduleScrollIndexFade();
  }, { passive: true });

  let lastDragY = null;
  let lastDragTime = null;
  let dragGrabOffsetY = 0;
  let dragPointerY = null;

  function updateDragBubble(clientY, maxScroll) {
    if (!bubble) return;
    dragPointerY = clientY;
    const label = labelForScrollTop(pageEl.scrollTop, maxScroll);
    const isSearch = label === SCROLL_INDEX_SEARCH_LABEL;
    const labelEl = document.getElementById('song-scroll-index-bubble-label');
    const labelText = isSearch ? '' : label;
    if (labelEl && labelEl.textContent !== labelText) {
      labelEl.textContent = labelText;
      bubble.style.width = 'auto';
      const naturalWidth = bubble.offsetWidth;
      bubble.style.width = naturalWidth + 'px';
      bubble.classList.remove('is-ticking');
      void bubble.offsetWidth;
      bubble.classList.add('is-ticking');
    }
    bubble.classList.toggle('is-search', isSearch);
    bubble.classList.toggle('is-numeric', !isSearch && scrollIndexIsNumeric);
    const margin = 4;
    const desiredTop = clientY - bubble.offsetHeight / 2;
    const maxTop = window.innerHeight - bubble.offsetHeight - margin;
    const clampedTop = Math.max(margin, Math.min(maxTop, desiredTop));
    bubble.style.top = `${Math.round(clampedTop)}px`;
  }

  // True thumb dragging: the grab point stays under the pointer. Unlike the
  // previous implementation, the pointer's Y is NOT interpreted as an
  // absolute position on the whole rail, so grabbing the handle never makes
  // the list jump before the person actually moves it.
  function applyDrag(clientY) {
    const rect = track.getBoundingClientRect();
    const thumbHeight = thumb.offsetHeight;
    const travel = Math.max(0, rect.height - thumbHeight);
    const thumbTop = Math.min(travel, Math.max(0, clientY - rect.top - dragGrabOffsetY));
    const ratio = travel > 0 ? thumbTop / travel : 0;
    const maxScroll = Math.max(1, pageEl.scrollHeight - pageEl.clientHeight);
    pageEl.scrollTop = ratio * maxScroll;
    updateScrollThumbPosition();

    const now = performance.now();
    if (lastDragY !== null) {
      const dt = Math.max(1, now - lastDragTime);
      const speed = Math.abs(clientY - lastDragY) / dt;
      if (speed > 0) nudgeThumbSquish(Math.min(2.6, speed * 3.2));
    }
    lastDragY = clientY;
    lastDragTime = now;
    updateDragBubble(clientY, maxScroll);
  }

  track.addEventListener('pointerdown', (e) => {
    if (track.hidden) return;

    // Empty rail space is intentionally inert. Give the very thin visual
    // thumb a little vertical hit slop so it is still easy to grab on touch,
    // but never treat a click elsewhere on the rail as a jump command.
    const thumbRect = thumb.getBoundingClientRect();
    const hitSlopY = 7;
    if (e.clientY < thumbRect.top - hitSlopY || e.clientY > thumbRect.bottom + hitSlopY) return;

    scrollIndexDragging = true;
    lastDragY = null;
    lastDragTime = null;
    dragGrabOffsetY = Math.min(thumb.offsetHeight, Math.max(0, e.clientY - track.getBoundingClientRect().top - thumbTranslateY));
    if (track.setPointerCapture) track.setPointerCapture(e.pointerId);
    setScrollIndexActive(true);
    track.classList.add('is-dragging');
    nudgeThumbSquish(-4.2);

    const maxScroll = Math.max(1, pageEl.scrollHeight - pageEl.clientHeight);
    if (bubble) {
      bubble.classList.add('is-visible');
      bubble.style.width = bubble.offsetWidth + 'px';
      updateDragBubble(e.clientY, maxScroll);
    }
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

  let geometryRAF = null;
  const refreshGeometry = () => {
    if (geometryRAF != null) return;
    geometryRAF = requestAnimationFrame(() => {
      geometryRAF = null;
      updateScrollThumbPosition();
      if (scrollIndexDragging && dragPointerY != null) updateDragBubble(dragPointerY);
    });
  };
  window.addEventListener('resize', refreshGeometry);
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(refreshGeometry);
    observer.observe(pageEl);
    observer.observe(document.getElementById('song-list'));
  }
  if (document.fonts) document.fonts.ready.then(refreshGeometry);
}
/* @end:bindScrollIndexInteraction */

/* @begin:getSongListSubtitle */


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
/* @end:getSongListSubtitle */

/* @begin:buildSongRow */
function buildSongRow(song, hasNumbers, q, sourceKey) {
  const li = document.createElement('li');
  li.dataset.rowKey = `${sourceKey}:${song.id}`;
  li.dataset.sourceKey = sourceKey;
  li.dataset.songId = song.id;
  const row = document.createElement('button');
  row.className = 'song-row';
  row.addEventListener('click', () => tapSongRowThenOpen(row, () => openSong(song, { sourceKey })));
  li.appendChild(row);
  updateSongRowContent(li, song, hasNumbers, q);
  return li;
}
/* @end:buildSongRow */

/* @begin:updateSongRowContent */
function updateSongRowContent(li, song, hasNumbers, q) {
  const row = li.firstElementChild;
  // Read by the #song-list[data-view="tiles"] CSS (see style.css) to fall
  // back to showing the title when a source has no song numbers to put
  // in a tile (see DB_SOURCES' hasNumbers) — harmless in list/compact,
  // where nothing selects on this class.
  row.classList.toggle('has-badge', hasNumbers);
  const subtitle = getSongListSubtitle(song);
  // New rows have no parent until after this call. Only #song-list displays it.
  const favoriteBadge = hasNumbers && isSongInPlaylist('favorites', li.dataset.sourceKey, song.id)
    ? FAVORITE_BADGE_HEART
    : '';
  row.innerHTML = `
    ${hasNumbers ? `<span class="song-badge">${escapeHtml(String(song.number))}${favoriteBadge}</span>` : ''}
    <span class="song-row-text">
      <span class="song-row-title">${highlight(song.title, q)}</span>
      ${subtitle ? `<span class="song-row-sub">${highlight(subtitle, q)}</span>` : ''}
    </span>
  `;
}
/* @end:updateSongRowContent */

/* @begin:refreshSongbookFavoriteMarkers */
function refreshSongbookFavoriteMarkers() {
  const list = document.getElementById('song-list');
  if (!list) return;
  const favorites = new Set((getPlaylist('favorites')?.songs || [])
    .map(ref => songRefKey(ref.sourceKey, ref.songId)));
  list.querySelectorAll('li[data-row-key] .song-badge').forEach(badge => {
    const li = badge.closest('li');
    const wanted = favorites.has(songRefKey(li.dataset.sourceKey, li.dataset.songId));
    const existing = badge.querySelector('.song-badge-heart');
    if (wanted && !existing) {
      badge.insertAdjacentHTML('beforeend', FAVORITE_BADGE_HEART);
    } else if (!wanted && existing) existing.remove();
  });
}
/* @end:refreshSongbookFavoriteMarkers */

/* @begin:animateListRefresh */


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
/* @end:animateListRefresh */

/* @begin:bindSongView */


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

  document.getElementById('sv-sheet-music-btn').addEventListener('click', () => {
    const btn = document.getElementById('sv-sheet-music-btn');
    const entryId = btn.dataset.sheetMusicId;
    if (entryId) openSheetMusicEntry(entryId);
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
/* @end:bindSongView */

/* @begin:updateSongViewMenuUI */


// The "…" menu itself has no reason to hide anymore — "Add to playlist"
// applies to every song, official or user-authored — so this is now just
// a safety net that closes any open dropdown when the active song or
// language changes out from under it (called from openSong() and again
// from applyLanguage()).
function updateSongViewMenuUI() {
  closeSongViewMenu();
}
/* @end:updateSongViewMenuUI */

/* @begin:toggleSongViewMenu */
function toggleSongViewMenu() {
  songViewMenuOpen ? closeSongViewMenu() : openSongViewMenu();
}
/* @end:toggleSongViewMenu */

/* @begin:openSongViewMenu */
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
    <button type="button" id="sv-kebab-display"><svg data-icon="view-list" viewBox="0 0 24 24"></svg>${escapeHtml(t('displaySettingsTitle'))}</button>
    ${isUserSong ? `
    <button type="button" id="sv-kebab-edit"><svg data-icon="pencil" viewBox="0 0 24 24"></svg>${escapeHtml(t('editBtn'))}</button>
    <button type="button" id="sv-kebab-delete" class="is-danger"><svg data-icon="trash" viewBox="0 0 24 24"></svg>${escapeHtml(t('menuDelete'))}</button>
    ` : ''}
    <button type="button" id="sv-kebab-display-mode" aria-pressed="${String(state.displayMode)}"><svg data-icon="reading-mode" viewBox="0 0 24 24"></svg>${escapeHtml(state.displayMode ? t('exitDisplayModeBtn') : t('displayModeBtn'))}</button>
    <button type="button" id="sv-kebab-presentation"><svg data-icon="presentation" viewBox="0 0 24 24"></svg>${escapeHtml(t('presentationModeBtn'))}</button>
    ${state.devUnlocked ? `
    <button type="button" id="sv-kebab-info"><svg data-icon="info-outline" viewBox="0 0 24 24"></svg>${escapeHtml(t('infoBtn'))}</button>
    ` : ''}
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
  wrap.querySelector('#sv-kebab-display').addEventListener('click', (e) => {
    e.stopPropagation();
    closeSongViewMenu();
    showPage('song-display', { pushHistory: true, resetScroll: true });
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
  wrap.querySelector('#sv-kebab-display-mode').addEventListener('click', (e) => {
    e.stopPropagation();
    closeSongViewMenu();
    toggleDisplayMode();
  });
  wrap.querySelector('#sv-kebab-presentation').addEventListener('click', (e) => {
    e.stopPropagation();
    closeSongViewMenu();
    openPresentationMode();
  });
  const infoBtn = wrap.querySelector('#sv-kebab-info');
  if (infoBtn) infoBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeSongViewMenu();
    openSongInfoModal(state.activeSourceKey, song);
  });
  wrap.addEventListener('click', (e) => e.stopPropagation());
}
/* @end:openSongViewMenu */

/* @begin:closeSongViewMenu */
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
/* @end:closeSongViewMenu */

/* @begin:toggleDisplayMode */


// Display mode: hides everything on the song view except the lyrics
// themselves — back button, favorite, transpose, text size, links, audio
// — for reading off a screen while projecting without any of the app's
// own chrome competing for attention. The "…" menu is the one thing that
// stays, since it's the only way back out of this mode; applyDisplayMode()
// (via #page-song-view.display-mode in style.css) shrinks it down to
// a low-profile dot instead of hiding it outright.
function toggleDisplayMode() {
  state.displayMode = !state.displayMode;
  applyDisplayMode();
}
/* @end:toggleDisplayMode */

/* @begin:applyDisplayMode */
function applyDisplayMode() {
  document.getElementById('page-song-view').classList.toggle('display-mode', state.displayMode);
}
/* @end:applyDisplayMode */

/* @begin:openPresentationMode */
// Presentation mode: full-screen lyric slides (js/presentation.js). It gets
// its own history entry so the hardware/browser Back button closes it and
// returns to the song instead of leaving the song view underneath.
function openPresentationMode() {
  const song = state.activeSong;
  if (!song || !window.SongPresentation || window.SongPresentation.isOpen()) return;
  const playlist = history.state?.playlistId && getPlaylist(history.state.playlistId);
  const queue = playlist ? playlist.songs.map(ref => findSongByRef(ref.sourceKey, ref.songId)).filter(Boolean) : [];
  closeModal({ immediate: true });
  pushNavState({ page: 'song-view', songId: song.id, sourceKey: state.activeSourceKey, presentation: true });
  window.SongPresentation.open({
    queue,
    song,
    titleInfo: { number: song.number, title: song.title, artist: song.artist },
    t,
    onRequestClose: closePresentationMode,
  });
}
/* @end:openPresentationMode */

/* @begin:closePresentationMode */
function closePresentationMode() {
  if (!window.SongPresentation || !window.SongPresentation.isOpen()) return;
  // Leave through history when our entry is on top, so Back/Forward stay in step.
  if (history.state && history.state.presentation) history.back();
  else window.SongPresentation.close();
}
/* @end:closePresentationMode */

/* @begin:updateFavoriteButtonUI */
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
/* @end:updateFavoriteButtonUI */

/* @begin:fixNativeAudioControlsPaint */


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
/* @end:fixNativeAudioControlsPaint */

/* @begin:openSong */
function openSong(song, opts = {}) {
  const { pushHistory = true, sourceKey = state.activeDbSource } = opts;
  state.activeSong = song;
  state.activeSourceKey = sourceKey;
  state.transpose = Number.isInteger(opts.transpose) ? Math.max(-TRANSPOSE_LIMIT, Math.min(TRANSPOSE_LIMIT, opts.transpose)) : 0;

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
    // Show the alternate titles without a label prefix.
    altEl.textContent = altTitles.join(' • ');
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
  const safeLinks = Array.isArray(song.links) ? song.links.map(l => {
    const rawUrl = typeof l === 'string' ? l : (l && l.url);
    const url = safeExternalHttpUrl(rawUrl);
    if (!url) return null;
    const label = (l && typeof l === 'object' && l.label) ? l.label : t('listenLink');
    return { url, label };
  }).filter(Boolean) : [];
  if (safeLinks.length) {
    linksEl.hidden = false;
    linksEl.innerHTML = safeLinks.map(({ url, label }) =>
      `<a class="sv-link-btn" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
    ).join('');
  } else {
    linksEl.hidden = true;
    linksEl.innerHTML = '';
  }

  updateTransposeUI();
  updateFavoriteButtonUI();
  updateSongViewMenuUI();
  updateSongSheetMusicButton(sourceKey, song.id);
  showPage('song-view', { resetScroll: true });
  if (Number.isFinite(opts.scrollTop)) {
    const page = document.getElementById('page-song-view');
    page.scrollTop = Math.max(0, opts.scrollTop);
  }
  if (pushHistory) {
    pushNavState({ page: 'song-view', songId: song.id, sourceKey, playlistId: opts.playlistId });
  }
}
/* @end:openSong */

/* @begin:updateTransposeUI */
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
/* @end:updateTransposeUI */

/* @begin:rememberSongChordViewer */


// ---------------------------------------------------------
// Chord viewer popup.
//
// Interaction lives in js/chord-viewer.js. app.js only injects the modal,
// translation, and Chord Finder voicing renderer so this feature stays independent of
// the main application state while still reusing the exact Display SVG.
// ---------------------------------------------------------
function rememberSongChordViewer(snapshot) {
  const entry = history.state;
  if (state.currentPage !== 'song-view' || !state.activeSong || !entry
      || entry.page !== 'song-view' || entry.songId !== state.activeSong.id
      || entry.sourceKey !== state.activeSourceKey) return;
  const data = { ...entry, transpose: state.transpose,
    scrollTop: document.getElementById('page-song-view').scrollTop };
  if (snapshot) data.chordViewer = { ...snapshot };
  else delete data.chordViewer;
  history.replaceState(data, '', location.href);
}
/* @end:rememberSongChordViewer */

/* @begin:openChordFinderFromSong */
function openChordFinderFromSong(snapshot) {
  if (state.currentPage !== 'song-view' || !state.activeSong || !window.ChordFinder) return;
  // Keep the return popup on the song's entry, then push exactly one tool entry.
  rememberSongChordViewer(snapshot);
  showPage('chord-finder', { resetScroll: true });
  pushNavState({ page: 'chord-finder', chordViewer: { ...snapshot } });
  closeModal({ immediate: true });
  window.ChordFinder.openChord(snapshot.symbol, snapshot);
}
/* @end:openChordFinderFromSong */

/* @begin:bindChordViewer */
function bindChordViewer() {
  if (!window.SongChordViewer || !window.ChordFinder) return;
  window.SongChordViewer.bind({
    rootId: 'lyrics-container',
    openModal,
    renderVoicings: (symbol, instrument) => instrument === 'piano'
      ? window.ChordFinder.getPianoChordVoicings(symbol, 4)
      : window.ChordFinder.getChordVoicings(symbol, 5),
    unavailableText: () => t('chordViewerUnavailable'),
    previousVoicingText: () => t('cfPreviousVoicing'),
    nextVoicingText: () => t('cfNextVoicing'),
    guitarText: () => t('cfGuitar'),
    pianoText: () => t('cfPiano'),
    instrumentText: () => t('cfInstrument'),
    openFinder: openChordFinderFromSong,
    onStateChange: rememberSongChordViewer,
    onClose: () => rememberSongChordViewer(null),
    isActive: () => state.currentPage === 'song-view',
    finderText: () => t('chordViewerOpenFinder'),
  });
}
/* @end:bindChordViewer */

/* @begin:bindLyricsCopy */
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
/* @end:bindLyricsCopy */

/* @begin:bindSongEditor */


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
  window.addEventListener('beforeunload', e => {
    if (state.currentPage !== 'song-editor' || !editorHasChanges()) return;
    e.preventDefault();
    e.returnValue = '';
  });
  document.getElementById('editor-back-btn').addEventListener('click', () => history.back());
  document.getElementById('editor-save-btn').addEventListener('click', saveSongFromEditor);
  document.getElementById('editor-format-help-btn').addEventListener('click', openEditorFormattingHelp);
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
/* @end:bindSongEditor */

/* @begin:openSongEditor */


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
  editorBaseline = editorSnapshot();
  showPage('song-editor', { resetScroll: true });
  if (pushHistory) {
    pushNavState({ page: 'song-editor', editorSongId: state.editorSongId });
  }
}
/* @end:openSongEditor */

/* @begin:renderEditorPreview */


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
/* @end:renderEditorPreview */

/* @begin:openEditorFormattingHelp */
function openEditorFormattingHelp() {
  const wrap = document.createElement('div');
  wrap.className = 'editor-format-help';

  const intro = document.createElement('p');
  intro.className = 'editor-format-help-intro';
  intro.textContent = t('editorFormatHelpIntro');
  wrap.appendChild(intro);

  const rules = document.createElement('div');
  rules.className = 'editor-format-rules';
  [
    ['editorFormatHelpChordTitle', 'editorFormatHelpChordBody'],
    ['editorFormatHelpSectionsTitle', 'editorFormatHelpSectionsBody'],
    ['editorFormatHelpLabelTitle', 'editorFormatHelpLabelBody'],
  ].forEach(([titleKey, bodyKey], index) => {
    const row = document.createElement('div');
    row.className = 'editor-format-rule';

    const step = document.createElement('span');
    step.className = 'editor-format-step';
    step.textContent = String(index + 1);

    const copy = document.createElement('div');
    copy.className = 'editor-format-rule-copy';
    const title = document.createElement('strong');
    title.textContent = t(titleKey);
    const body = document.createElement('p');
    body.textContent = t(bodyKey);
    copy.append(title, body);

    row.append(step, copy);
    rules.appendChild(row);
  });
  wrap.appendChild(rules);

  const source = t('editorFormatHelpExampleSource');
  const example = document.createElement('div');
  example.className = 'editor-format-example';

  const typeLabel = document.createElement('span');
  typeLabel.className = 'editor-format-example-label';
  typeLabel.textContent = t('editorFormatHelpTypeLabel');
  const sourceBox = document.createElement('pre');
  sourceBox.className = 'editor-format-source';
  sourceBox.textContent = source;

  const previewLabel = document.createElement('span');
  previewLabel.className = 'editor-format-example-label editor-format-preview-label';
  previewLabel.textContent = t('editorFormatHelpPreviewLabel');
  const preview = document.createElement('div');
  preview.id = 'editor-format-help-preview';
  preview.className = 'lyrics-container editor-format-preview';

  example.append(typeLabel, sourceBox, previewLabel, preview);
  wrap.appendChild(example);

  openModal(t('editorFormatHelpTitle'), wrap);
  renderLyrics({
    containerId: 'editor-format-help-preview',
    song: { lyrics: source.split('\n') },
    transpose: 0,
  });
}
/* @end:openEditorFormattingHelp */

/* @begin:saveSongFromEditor */
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
    // The editor does not expose alternate titles. Keep imported aliases
    // when a person edits the visible title, lyrics, or chords.
    ...(existing && existing.alternateTitles ? { alternateTitles: existing.alternateTitles } : {}),
  };

  saveUserSong(song).then(() => {
    editorBaseline = null;
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
/* @end:saveSongFromEditor */

/* @begin:confirmDeleteUserSong */
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
      editorBaseline = null;
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
/* @end:confirmDeleteUserSong */

/* @begin:updateSongToolbarButtons */
function updateSongToolbarButtons() {
  const toolsBtn = document.getElementById('song-search-tools-btn');
  const filterCount = document.getElementById('song-label-filter-count');
  if (!toolsBtn) return;

  const count = state.songLabelFilters.length;
  toolsBtn.setAttribute('aria-pressed', String(count > 0));
  toolsBtn.setAttribute('aria-label', t('searchOptionsTitle'));
  toolsBtn.title = t('searchOptionsTitle');
  if (filterCount) {
    filterCount.hidden = count === 0;
    filterCount.textContent = count > 9 ? '9+' : String(count);
  }
}
/* @end:updateSongToolbarButtons */

/* @begin:openSongSearchToolsModal */


// One search-field action owns both of the quick Songbook controls: view
// layout and label filtering. Keeping them in one modal mirrors the single
// tune/filter button inside the search bar and avoids two separate controls
// competing with the field itself.
function openSongSearchToolsModal() {
  const wrap = document.createElement('div');

  const viewSection = document.createElement('section');
  viewSection.className = 'song-search-tools-section';
  const viewHeading = document.createElement('p');
  viewHeading.className = 'song-search-tools-heading';
  viewHeading.textContent = t('songViewGroup');
  viewSection.appendChild(viewHeading);

  const viewList = document.createElement('ul');
  viewList.className = 'checklist';
  viewSection.appendChild(viewList);
  wrap.appendChild(viewSection);

  const viewItems = new Map();
  const viewOptions = [
    ['list', 'songViewList'],
    ['compact', 'songViewCompact'],
    ['tiles', 'songViewTiles'],
  ];
  viewOptions.forEach(([value, labelKey]) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'checklist-item';
    item.setAttribute('aria-pressed', String(state.songListView === value));
    item.innerHTML = `
      <span class="checklist-check"><svg data-icon="check" viewBox="0 0 24 24"></svg></span>
      <span>${escapeHtml(t(labelKey))}</span>
    `;
    item.addEventListener('click', () => {
      if (state.songListView === value) return;
      state.songListView = value;
      localStorage.setItem('sb-song-view', state.songListView);
      applySongListView();
      viewItems.forEach((button, option) => {
        button.setAttribute('aria-pressed', String(option === state.songListView));
      });
    });
    viewItems.set(value, item);
    viewList.appendChild(item);
  });

  const labelSection = document.createElement('section');
  labelSection.className = 'song-search-tools-section';
  const labelHeading = document.createElement('p');
  labelHeading.className = 'song-search-tools-heading';
  labelHeading.textContent = t('filterLabelsTitle');
  labelSection.appendChild(labelHeading);
  wrap.appendChild(labelSection);

  const available = Array.from(new Set(state.selectedDbSources.flatMap(labelsInUse)))
    .sort((a, b) => labelDisplayText(a).localeCompare(labelDisplayText(b)));

  // A label that vanished from the selected database should not remain as a
  // hidden active filter after opening the tools sheet.
  const availableSet = new Set(available);
  state.songLabelFilters = state.songLabelFilters.filter(label => availableSet.has(label));
  updateSongToolbarButtons();

  if (!available.length) {
    const empty = document.createElement('p');
    empty.className = 'modal-hint';
    empty.textContent = t('filterLabelsEmpty');
    labelSection.appendChild(empty);
  } else {
    const clearRow = document.createElement('div');
    clearRow.className = 'modal-actions label-filter-actions';
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn-secondary';
    clearBtn.textContent = t('filterLabelsClear');
    clearBtn.disabled = state.songLabelFilters.length === 0;
    clearRow.appendChild(clearBtn);
    labelSection.appendChild(clearRow);

    const list = document.createElement('ul');
    list.className = 'checklist';
    labelSection.appendChild(list);

    const renderLabels = () => {
      list.innerHTML = '';
      available.forEach(label => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'checklist-item';
        item.setAttribute('aria-pressed', String(state.songLabelFilters.includes(label)));
        item.innerHTML = `
          <span class="checklist-check"><svg data-icon="check" viewBox="0 0 24 24"></svg></span>
          <span>${escapeHtml(labelDisplayText(label))}</span>
        `;
        item.addEventListener('click', () => {
          const selected = state.songLabelFilters.includes(label);
          state.songLabelFilters = selected
            ? state.songLabelFilters.filter(value => value !== label)
            : [...state.songLabelFilters, label];
          item.setAttribute('aria-pressed', String(!selected));
          clearBtn.disabled = state.songLabelFilters.length === 0;
          updateSongToolbarButtons();
          renderSongList({ animate: true });
        });
        list.appendChild(item);
      });
      initIcons(list);
    };

    clearBtn.addEventListener('click', () => {
      if (!state.songLabelFilters.length) return;
      state.songLabelFilters = [];
      clearBtn.disabled = true;
      renderLabels();
      updateSongToolbarButtons();
      renderSongList({ animate: true });
    });

    renderLabels();
  }

  initIcons(wrap);
  openModal(t('searchOptionsTitle'), wrap);
}
/* @end:openSongSearchToolsModal */

/* @begin:labelsInUse */


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
/* @end:labelsInUse */

/* @begin:bindPlaylistsPage */


// ---------------------------------------------------------
// Playlists page: list of playlists (Favorites pinned first)
// ---------------------------------------------------------
function bindPlaylistsPage() {
  document.getElementById('new-playlist-btn').addEventListener('click', () => {
    promptCreatePlaylist((id) => openPlaylist(id));
  });
}
/* @end:bindPlaylistsPage */

/* @begin:buildPlaylistRow */


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
      <span class="playlist-row-sub">${t('playlistSongCount', playlistSongCount(pl))}</span>
    </span>
  `;
  row.addEventListener('click', () => openPlaylist(id));
  li.appendChild(row);
  initIcons(li);
  return li;
}
/* @end:buildPlaylistRow */

/* @begin:updatePlaylistRowContent */


// Refreshes an existing row's text in place (name/song-count can change —
// e.g. a rename, or a song added elsewhere) without touching its icon or
// click handler. isFavorites never changes for a given id, so the icon
// never needs to be re-picked here.
function updatePlaylistRowContent(li, pl) {
  const row = li.firstElementChild;
  row.querySelector('.playlist-row-title').textContent = playlistDisplayName(pl);
  row.querySelector('.playlist-row-sub').textContent = t('playlistSongCount', playlistSongCount(pl));
}
/* @end:updatePlaylistRowContent */

/* @begin:renderPlaylistsList */


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
      cancelRowExit(li);
      updatePlaylistRowContent(li, pl);
    } else {
      li = buildPlaylistRow(id, pl);
      animateRowEnter(li);
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
    animateRowExit(li);
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
/* @end:renderPlaylistsList */

/* @begin:bindPlaylistView */


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
/* @end:bindPlaylistView */

/* @begin:togglePlaylistMenu */
function togglePlaylistMenu() {
  playlistMenuOpen ? closePlaylistMenu() : openPlaylistMenu();
}
/* @end:togglePlaylistMenu */

/* @begin:openPlaylistMenu */
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
/* @end:openPlaylistMenu */

/* @begin:closePlaylistMenu */
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
/* @end:closePlaylistMenu */

/* @begin:setPlaylistEditMode */
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
/* @end:setPlaylistEditMode */

/* @begin:showOrHidePillDone */


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
/* @end:showOrHidePillDone */

/* @begin:renderPlaylistTitle */


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
/* @end:renderPlaylistTitle */

/* @begin:commitPlaylistTitleEdit */
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
/* @end:commitPlaylistTitleEdit */

/* @begin:openPlaylist */
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
/* @end:openPlaylist */

/* @begin:renderPlaylistView */


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

  document.getElementById('pv-count').textContent = t('playlistSongCount', playlistSongCount(pl));
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
    const hasNumbers = sourceHasSongNumbers(ref.sourceKey);
    const subtitle = getSongListSubtitle(song);
    row.innerHTML = `
      ${hasNumbers ? `<span class="song-badge">${song.number}</span>` : ''}
      <span class="song-row-text">
        <span class="song-row-title">${escapeHtml(song.title)}</span>
        ${subtitle ? `<span class="song-row-sub">${escapeHtml(subtitle)}</span>` : ''}
      </span>
    `;
    row.addEventListener('click', () => { if (!playlistEditMode) tapSongRowThenOpen(row, () => openSong(song, { sourceKey: ref.sourceKey, playlistId: pl.id })); });

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
      animateRowEnter(li);
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
/* @end:renderPlaylistView */

/* @begin:onPlaylistDragStart */
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
/* @end:onPlaylistDragStart */

/* @begin:flipReorderedSiblings */


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
/* @end:flipReorderedSiblings */

/* @begin:onPlaylistDragMove */
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
/* @end:onPlaylistDragMove */

/* @begin:onPlaylistDragEnd */
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
/* @end:onPlaylistDragEnd */

/* @begin:commitPlaylistOrderFromDom */
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
/* @end:commitPlaylistOrderFromDom */

/* @begin:openModal */


// ---------------------------------------------------------
// Shared modal shell
// ---------------------------------------------------------
// This one overlay/card pair is reused for every modal in the app (Add
// Songs, rename/create playlist, etc.) — see bindModalShell() below.
function openModal(title, bodyEl, options = {}) {
  const overlay = document.getElementById('modal-overlay');
  if (!overlay.contains(document.activeElement)) overlay._returnFocus = document.activeElement;
  document.getElementById('modal-title').textContent = title;
  const body = document.getElementById('modal-body');
  body.innerHTML = '';
  body.appendChild(bodyEl);
  body.scrollTop = 0;
  if (typeof overlay._onClose === 'function') overlay._onClose();
  overlay._onClose = typeof options.onClose === 'function' ? options.onClose : null;
  const card = overlay.querySelector('.modal-card');
  // Modal variants keep feature-specific sizing/presentation in CSS without
  // creating a second modal implementation. Every open resets the variant so
  // a compact chord viewer can never leak its dimensions into the next modal.
  if (card) {
    const variant = options && typeof options.variant === 'string' ? options.variant.trim() : '';
    if (variant) card.dataset.modalVariant = variant;
    else delete card.dataset.modalVariant;
  }

  // A previous modal's close animation may still be in flight (e.g. this
  // one was opened immediately after closing another) — cancel it rather
  // than letting its transitionend fire later and hide the modal we're
  // opening right now out from under the person.
  if (overlay._closeCleanup) {
    overlay.removeEventListener('transitionend', overlay._closeCleanup);
    overlay._closeCleanup = null;
  }
  if (overlay._closeTimer) {
    clearTimeout(overlay._closeTimer);
    overlay._closeTimer = null;
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
    requestAnimationFrame(() => {
      if (!overlay.hidden && !overlay.classList.contains('modal-overlay-closing')) overlay.style.opacity = '';
    });
  }
  initIcons(overlay);
  if (card) card.focus({ preventScroll: true });
}
/* @end:openModal */

/* @begin:restoreModalFocus */
function restoreModalFocus(overlay) {
  const target = overlay._returnFocus;
  overlay._returnFocus = null;
  if (!target || !target.isConnected || target.closest('[hidden]')) return;
  const ownerPage = target.closest('.page');
  // Navigation can close a song popup after moving to the tool. Do not
  // send focus back into the previous page during its slide-out animation.
  if (ownerPage && ownerPage.dataset.page !== state.currentPage) return;
  target.focus({ preventScroll: true });
}
/* @end:restoreModalFocus */

/* @begin:closeModal */
function closeModal({ immediate = false } = {}) {
  const overlay = document.getElementById('modal-overlay');
  if (overlay.hidden) return;
  if (typeof overlay._onClose === 'function') {
    const callback = overlay._onClose;
    overlay._onClose = null;
    callback();
  }
  if (immediate) {
    if (overlay._closeCleanup) overlay.removeEventListener('transitionend', overlay._closeCleanup);
    if (overlay._closeTimer) clearTimeout(overlay._closeTimer);
    overlay._closeCleanup = null;
    overlay._closeTimer = null;
    overlay.classList.remove('modal-overlay-closing');
    overlay.style.opacity = '';
    overlay.hidden = true;
    document.getElementById('modal-body').innerHTML = '';
    restoreModalFocus(overlay);
    return;
  }
  if (overlay._closeCleanup) return;

  if (prefersReducedMotion()) {
    overlay.hidden = true;
    document.getElementById('modal-body').innerHTML = '';
    restoreModalFocus(overlay);
    return;
  }

  // .modal-overlay-closing plays the card's compact retreat (see style.css)
  // alongside this opacity fade instead of the whole popup disappearing
  // the instant this function runs.
  overlay.classList.add('modal-overlay-closing');
  overlay.style.opacity = '0';
  const cleanup = (e) => {
    if (e && e.propertyName !== 'opacity') return;
    if (overlay._closeCleanup !== cleanup) return;
    overlay.removeEventListener('transitionend', cleanup);
    overlay._closeCleanup = null;
    if (overlay._closeTimer) clearTimeout(overlay._closeTimer);
    overlay._closeTimer = null;
    overlay.hidden = true;
    overlay.classList.remove('modal-overlay-closing');
    overlay.style.opacity = '';
    document.getElementById('modal-body').innerHTML = '';
    restoreModalFocus(overlay);
  };
  overlay._closeCleanup = cleanup;
  overlay.addEventListener('transitionend', cleanup);
  // A transitionend event is not guaranteed when the browser suppresses
  // animations or the element loses its rendering surface mid-transition.
  overlay._closeTimer = setTimeout(() => cleanup(), 320);
}
/* @end:closeModal */

/* @begin:bindModalShell */
function bindModalShell() {
  document.getElementById('modal-close-btn').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeModal();
  });
  document.addEventListener('keydown', event => {
    const overlay = document.getElementById('modal-overlay');
    if (overlay.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
    } else if (event.key === 'Tab') {
      const targets = Array.from(overlay.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'))
        .filter(el => !el.closest('[hidden]') && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
      const first = targets[0];
      const last = targets[targets.length - 1];
      const active = document.activeElement;
      if (!first) {
        event.preventDefault();
      } else if (event.shiftKey && (active === first || !targets.includes(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !targets.includes(active))) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  initViewportSync();
}
/* @end:bindModalShell */

/* @begin:initViewportSync */


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
//
// Keyboard-open state: the overlay centers its card, so shrinking the
// overlay to the area above the keyboard used to re-center the card and make
// it jump upward. When the keyboard opens we now measure where the card
// already is (before the new height is applied) and pin it there with
// --kb-card-top, moving it only as far as needed to stay fully visible. The
// same state also sets html.keyboard-open, which the stylesheet uses to tuck
// the bottom nav away while typing.
function initViewportSync() {
  if (!window.visualViewport) return;
  const root = document.documentElement;
  const KEYBOARD_MIN_PX = 120;   // smaller gaps are browser toolbars, not a keyboard
  let keyboardOpen = false;
  let frame = 0;

  const sync = () => {
    frame = 0;
    const vv = window.visualViewport;
    // Pinch-zoom also shrinks the visual viewport; it is not a keyboard.
    const open = vv.scale <= 1.01 && (window.innerHeight - vv.height) > KEYBOARD_MIN_PX;

    const overlay = document.getElementById('modal-overlay');
    const card = overlay && !overlay.hidden ? overlay.querySelector('.modal-card') : null;

    if (open && card) {
      // Measure BEFORE --vvh changes, so the first reading is the
      // pre-keyboard (centered) position; later readings are already pinned.
      const overlayTop = overlay.getBoundingClientRect().top;
      const rect = card.getBoundingClientRect();
      const margin = 12;
      const wanted = rect.top - overlayTop;
      const maxTop = Math.max(margin, vv.height - rect.height - margin);
      root.style.setProperty('--kb-card-top', `${Math.round(Math.min(Math.max(wanted, margin), maxTop))}px`);
    }
    if (open !== keyboardOpen) {
      keyboardOpen = open;
      root.classList.toggle('keyboard-open', open);
      if (!open) root.style.removeProperty('--kb-card-top');
    }

    root.style.setProperty('--vvh', `${vv.height}px`);
    root.style.setProperty('--vv-top', `${vv.offsetTop}px`);
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };

  sync();
  window.visualViewport.addEventListener('resize', schedule);
  window.visualViewport.addEventListener('scroll', schedule);
}
/* @end:initViewportSync */

/* @begin:focusModalInput */


// Focuses `input` only after any in-flight modal-open animation has
// settled, then — once the keyboard has actually finished animating in —
// scrolls the input into view within the modal body. Opening the
// keyboard the instant the sheet starts sliding up was the other half
// of the "jumps/only shows part of itself" behavior; giving the sheet
// a moment to land first avoids the two animations fighting each other.
function focusModalInput(input, delay = 260) {
  if (!input) return;
  setTimeout(() => {
    // preventScroll: the browser's own "scroll the focused field into view"
    // was a third, separate movement on top of the sheet and the keyboard.
    input.focus({ preventScroll: true });
    // Only nudge if the keyboard actually left the field covered.
    setTimeout(() => {
      const vv = window.visualViewport;
      const bottomEdge = vv ? vv.height : window.innerHeight;
      const rect = input.getBoundingClientRect();
      if (rect.bottom > bottomEdge - 8 || rect.top < 0) {
        input.scrollIntoView({ block: 'nearest' });
      }
    }, 300);
  }, delay);
}
/* @end:focusModalInput */

/* @begin:playlistNameForm */


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
/* @end:playlistNameForm */

/* @begin:promptCreatePlaylist */
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
/* @end:promptCreatePlaylist */

/* @begin:confirmDeletePlaylist */
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
/* @end:confirmDeletePlaylist */

/* @begin:openAddToPlaylistModal */


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
/* @end:openAddToPlaylistModal */

/* @begin:openDbPickerModal */


// ---------------------------------------------------------
// Database picker (Settings → Song database) — a popup rather than a
// plain <select>, specifically so it scales as more databases get added:
// a top seg-toggle tab per DB_GROUP_ORDER entry (currently "All"/"SDA"),
// and under the active tab a single-select checklist of just that group's
// DB_SOURCES entries. Both are driven straight off DB_SOURCES/
// DB_GROUP_ORDER — a new database or a new group needs no changes here,
// see the comment above DB_SOURCES.
//
// Single selection applies and closes immediately. The check toggle keeps
// this picker open for multiple independent choices across its groups.
// ---------------------------------------------------------
function openDbPickerModal() {
  const wrap = document.createElement('div');
  let currentGroup = (DB_SOURCES[state.activeDbSource] || {}).group || DB_GROUP_ORDER[0];
  const toolbar = document.createElement('div');
  toolbar.className = 'db-picker-toolbar';
  const tabs = document.createElement('div');
  tabs.className = 'seg-toggle db-picker-tabs';
  tabs.setAttribute('role', 'group');
  tabs.setAttribute('aria-label', t('dbPickerTitle'));
  const thumb = document.createElement('div');
  thumb.className = 'seg-toggle-thumb';
  tabs.appendChild(thumb);

  const multi = document.createElement('button');
  multi.type = 'button';
  multi.className = 'db-picker-multi icon-btn';
  multi.setAttribute('aria-label', t('dbSelectMultiple'));
  multi.title = t('dbSelectMultiple');
  multi.innerHTML = '<svg data-icon="check" viewBox="0 0 24 24" aria-hidden="true"></svg>';
  toolbar.append(tabs, multi);

  const listWrap = document.createElement('div');
  listWrap.className = 'db-picker-list-wrap';
  const list = document.createElement('ul');
  list.className = 'checklist';
  listWrap.appendChild(list);

  const syncSelectionUI = () => {
    multi.setAttribute('aria-pressed', String(state.multiDbSelect));
    list.classList.toggle('is-multi', state.multiDbSelect);
    list.querySelectorAll('[data-db-source]').forEach(item => {
      const selected = isSelectedDbSource(item.dataset.dbSource);
      item.setAttribute('aria-pressed', String(selected));
      // A library always remains selected; rapid taps cannot create an empty state.
      item.disabled = state.multiDbSelect && selected && state.selectedDbSources.length === 1;
    });
  };

  const renderList = ({ animate = false } = {}) => {
    const startHeight = listWrap.getBoundingClientRect().height;
    list.innerHTML = '';
    Object.keys(DB_SOURCES).filter(key => DB_SOURCES[key].group === currentGroup).forEach(key => {
      const li = document.createElement('li');
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'checklist-item db-picker-item';
      item.dataset.dbSource = key;
      item.innerHTML = `
        <span style="flex:1">${escapeHtml(dbSourceLabel(key))}</span>
        <span class="checklist-check"><svg data-icon="check" viewBox="0 0 24 24"></svg></span>
      `;
      item.addEventListener('click', () => {
        if (state.multiDbSelect) {
          const selected = isSelectedDbSource(key);
          if (selected && state.selectedDbSources.length === 1) return;
          const keys = selected ? state.selectedDbSources.filter(value => value !== key)
            : [...state.selectedDbSources, key];
          applyDbSelection(keys, { primary: selected ? undefined : key });
          syncSelectionUI();
          return;
        }
        applyDbSource(key);
        showToast(t('toastDbSaved'));
        closeModal();
      });
      li.appendChild(item);
      list.appendChild(li);
    });
    syncSelectionUI();
    initIcons(list);
    if (animate && !prefersReducedMotion()) {
      animateWrapHeightTo(listWrap, listWrap.scrollHeight, startHeight);
      list.classList.remove('db-picker-list-enter');
      void list.offsetWidth;
      list.classList.add('db-picker-list-enter');
    }
  };

  multi.addEventListener('click', () => {
    state.multiDbSelect = !state.multiDbSelect;
    applyDbSelection(state.multiDbSelect ? state.selectedDbSources : [state.activeDbSource]);
    syncSelectionUI();
  });

  // Groups come from the registry, including any new groups in later books.
  const groups = [...new Set([...DB_GROUP_ORDER, ...Object.values(DB_SOURCES).map(source => source.group)])];
  groups.forEach(group => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'seg-toggle-btn';
    btn.dataset.dbGroup = group;
    btn.setAttribute('aria-pressed', String(group === currentGroup));
    btn.textContent = t(DB_GROUP_LABELS[group] || group);
    btn.addEventListener('click', () => {
      if (group === currentGroup) return;
      currentGroup = group;
      tabs.querySelectorAll('.seg-toggle-btn').forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
      positionSegToggleThumb(tabs);
      renderList({ animate: true });
    });
    tabs.appendChild(btn);
  });
  wrap.append(toolbar, listWrap);
  renderList();
  openModal(t('dbPickerTitle'), wrap);
  positionSegToggleThumb(tabs, { instant: true });
}
/* @end:openDbPickerModal */

/* @begin:buildLabelEditor */


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
        chipsEl.innerHTML = '';
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
      chipsEl.innerHTML = '';
      chipsWrap.style.height = 'auto';
      animateWrapHeightTo(chipsWrap, chipsWrap.scrollHeight, startHeight);
      return;
    }

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
/* @end:buildLabelEditor */

/* @begin:renderSongViewLabels */


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
/* @end:renderSongViewLabels */

/* @begin:openEditLabelsModal */


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
/* @end:openEditLabelsModal */

/* @begin:songSourceFilePath */


// ---------------------------------------------------------
// Song info modal — Developer options only (see state.devUnlocked /
// openSongViewMenu()'s "sv-kebab-info" button). Not something an ordinary
// visitor needs, but handy while working on song data: which exact source
// file the open song's content came from, so a data fix can be pointed at
// the right JSON file straight away instead of guessing from the title.
// ---------------------------------------------------------

// The on-disk path a given song's JSON lives at — same base URL
// songDataBaseUrl()/fetchSongBundleSnapshot() use for their own fetches,
// plus the per-song `<id>.json` filename. Returns null for a User Song
// ('user' isn't a DB_SOURCES entry — those live in IndexedDB, not a
// static file, so songDataBaseUrl() throws for it).
function songSourceFilePath(sourceKey, song) {
  if (!song) return null;
  try {
    return `${songDataBaseUrl(sourceKey)}/${song.id}.json`;
  } catch {
    return null;
  }
}
/* @end:songSourceFilePath */

/* @begin:buildInfoRow */
function buildInfoRow(label, value) {
  const row = document.createElement('div');
  row.className = 'info-row';
  row.innerHTML = `
    <span class="info-row-label">${escapeHtml(label)}</span>
    <span class="info-row-value"></span>
  `;
  // Set via textContent (not the innerHTML template above) so a value
  // containing e.g. "<" from a song title can never be read as markup.
  row.querySelector('.info-row-value').textContent = value;
  return row;
}
/* @end:buildInfoRow */

/* @begin:openSongInfoModal */
function openSongInfoModal(sourceKey, song) {
  if (!song) return;
  const isUserSong = sourceKey === 'user';
  // Resolve the current entry: a background sync may have replaced the song
  // object since this view opened. Older IndexedDB copies lack origin metadata.
  const currentSong = findSongByRef(sourceKey, song.id) || song;
  const filePath = songSourceFilePath(sourceKey, currentSong);
  const origin = isUserSong ? t('infoOriginUser')
    : currentSong._songbookOrigin === 'individual' ? t('infoOriginIndividual')
    : currentSong._songbookOrigin === 'snapshot' ? t('infoOriginSnapshot')
    : t('infoOriginUnknown');
  const wrap = document.createElement('div');
  wrap.className = 'info-list';
  wrap.appendChild(buildInfoRow(t('infoSourceLabel'), isUserSong ? t('infoUserSongSource') : dbSourceLabel(sourceKey)));
  wrap.appendChild(buildInfoRow(t('infoOriginLabel'), origin));
  wrap.appendChild(buildInfoRow(t('infoFileLabel'), isUserSong ? t('infoUserSongFile') : filePath));
  wrap.appendChild(buildInfoRow(t('infoIdLabel'), String(song.id)));
  if (song.number != null) {
    wrap.appendChild(buildInfoRow(t('infoNumberLabel'), `#${song.number}`));
  }
  openModal(t('infoModalTitle'), wrap);
}
/* @end:openSongInfoModal */

/* @begin:animateWrapHeightTo */


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
/* @end:animateWrapHeightTo */

/* @begin:openAddSongsModal */
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
    item.setAttribute('aria-pressed', String(isSongInPlaylist(playlistId, songSourceKey(song, sourceKey), song.id)));
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
      document.getElementById('pv-count').textContent = t('playlistSongCount', playlistSongCount(getPlaylist(playlistId)));
    });
    li.appendChild(item);
    return li;
  };

  let firstRender = true;
  const renderItems = () => {
    const q = input.value.trim().toLowerCase();
    const sourceKey = SONGBOOK_SOURCE;
    const songs = filterAndSortSongs(getSongbookSource().songs, q, sourceKey);
    const hasNumbers = sourceHasSongNumbers(sourceKey);

    if (firstRender || prefersReducedMotion()) {
      // Plain build for the very first render (opening the modal shouldn't
      // animate its own initial contents in) and for reduced-motion.
      firstRender = false;
      list.innerHTML = '';
      songs.forEach(song => list.appendChild(buildChecklistItem(song, songSourceKey(song, sourceKey), songHasVisibleNumber(song, sourceKey, hasNumbers))));
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
      const key = `${songSourceKey(song, sourceKey)}:${song.id}`;
      keptKeys.add(key);
      let li = existingItems.get(key);
      if (li) {
        cancelRowExit(li);
        li.firstElementChild.setAttribute('aria-pressed', String(isSongInPlaylist(playlistId, songSourceKey(song, sourceKey), song.id)));
      } else {
        li = buildChecklistItem(song, songSourceKey(song, sourceKey), songHasVisibleNumber(song, sourceKey, hasNumbers));
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
      animateRowExit(li, (row) => {
        const startH = listWrap.getBoundingClientRect().height;
        row.remove();
        listWrap.style.height = 'auto'; // un-clip so scrollHeight reads the true post-removal size
        animateWrapHeightTo(listWrap, listWrap.scrollHeight, startH);
      });
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
/* @end:openAddSongsModal */

/* @begin:copyDiagnostics */



// Everything a bug report needs about offline problems in one paste: version,
// whether this is the installed app, worker + cache state, storage protection
// and the last recorded errors.
async function copyDiagnostics() {
  const lines = [
    `Version: ${APP_VERSION}`,
    `Time: ${new Date().toISOString()}`,
    `Address: ${location.href}`,
    `Opened as: ${window.matchMedia('(display-mode: standalone)').matches ? 'installed app' : 'browser tab'}`,
    `Online: ${navigator.onLine}`,
    `Browser: ${navigator.userAgent}`,
  ];
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    lines.push(`Service worker: ${reg ? (reg.active ? reg.active.state : 'registered, not active') : 'not registered'}; controlling this page: ${!!navigator.serviceWorker.controller}`);
  } catch (_) { lines.push('Service worker: unavailable'); }
  try {
    const parts = [];
    for (const key of await caches.keys()) parts.push(`${key} = ${(await (await caches.open(key)).keys()).length} files`);
    lines.push(`Offline cache: ${parts.join('; ') || 'none'}`);
  } catch (_) { lines.push('Offline cache: unavailable'); }
  try { lines.push(`Storage protected from cleanup: ${await navigator.storage.persisted()}`); } catch (_) { lines.push('Storage protected from cleanup: unknown'); }
  try {
    const est = await navigator.storage.estimate();
    lines.push(`Storage used: ${Math.round(est.usage / 1e6)} MB of ${Math.round(est.quota / 1e6)} MB`);
  } catch (_) { /* not available in this browser */ }
  let log = [];
  try { log = JSON.parse(localStorage.getItem(ERROR_LOG_KEY) || '[]'); } catch (_) { /* ignore */ }
  lines.push(log.length ? 'Recent errors:' : 'Recent errors: none');
  log.forEach(e => lines.push(`- ${e.t} v${e.v} ${e.kind}: ${String(e.msg).split('\n')[0]}`));
  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    showToast(t('toastDiagCopied'));
  } catch (err) {
    console.error('Songbook: clipboard copy failed —', err);
    showToast(t('toastDiagCopyFailed'));
  }
}
/* @end:copyDiagnostics */

/* @begin:copyContactEmail */
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
/* @end:copyContactEmail */

/* @begin:resetContactUI */


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
/* @end:resetContactUI */

/* @begin:bindAboutPage */
function bindAboutPage() {
  document.getElementById('about-back-btn').addEventListener('click', () => history.back());
}
/* @end:bindAboutPage */

/* @begin:bindChordFinderPage */
function bindChordFinderPage() {
  document.getElementById('presentation-settings-nav-row').addEventListener('click', () => showPage('presentation-settings', { pushHistory: true, resetScroll: true }));
  document.getElementById('presentation-settings-back-btn').addEventListener('click', () => history.back());
  document.getElementById('chord-finder-back-btn').addEventListener('click', () => history.back());
  document.getElementById('chord-finder-nav-row').addEventListener('click', () => {
    showPage('chord-finder', { pushHistory: true, resetScroll: true });
  });
}
/* @end:bindChordFinderPage */

/* @begin:showToast */


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
/* @end:showToast */

/* @begin:isSabbathToday */


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
/* @end:isSabbathToday */

/* @begin:updateSabbathMascotText */
function updateSabbathMascotText() {
  const bubble = document.getElementById('sabbath-bubble');
  if (bubble) bubble.textContent = t('sabbathGreeting');
}
/* @end:updateSabbathMascotText */

/* @begin:initSabbathMascot */
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
/* @end:initSabbathMascot */

/* @begin:isChristmasWeek */


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
/* @end:isChristmasWeek */

/* @begin:initChristmasSnow */
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
/* @end:initChristmasSnow */

/* @begin:hexToHsl */
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
/* @end:hexToHsl */

/* @begin:hslToHex */
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
/* @end:hslToHex */

/* @begin:startDiscoMode */
 // one full hue rotation every 48s — slow, not fast

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
/* @end:startDiscoMode */

/* @begin:stopDiscoMode */
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
/* @end:stopDiscoMode */

/* @begin:bindAccentDiscoEasterEgg */
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
/* @end:bindAccentDiscoEasterEgg */


/* @begin:editorSnapshot */
function editorSnapshot() {
  return JSON.stringify({
    fields: ['title', 'artist', 'key', 'lyrics', 'link'].map(name => document.getElementById('editor-' + name).value),
    labels: [...state.editorLabelsDraft].sort(),
  });
}
/* @end:editorSnapshot */

/* @begin:editorHasChanges */
function editorHasChanges() {
  return editorBaseline !== null && editorSnapshot() !== editorBaseline;
}
/* @end:editorHasChanges */

/* @begin:renderAnnouncements */
function renderAnnouncements() {
  const container = document.getElementById('app-announcements');
  const nav = document.getElementById('bottom-nav');
  if (!container || !nav || PAGES[state.currentPage].hideNav) return;
  container.replaceChildren();
  container.setAttribute('aria-label', t('announcementsLabel'));
  let seen = [];
  try {
    const saved = JSON.parse(localStorage.getItem('ngw_seen_announcements') || '[]');
    if (Array.isArray(saved)) seen = saved.filter(id => typeof id === 'string');
  } catch (_) {}
  const preview = state.devAnnouncementBanner;
  const items = preview ? [{ id: "__dev-preview-banner", mode: "every-open", display: "banner", title: t("devPreviewTitle"), text: t("devPreviewBannerText") }] : announcements;
  const ids = new Set(), now = Date.now(), messages = [];
  const remember = item => {
    if (preview) return;
    shownAnnouncements.add(item.id);
    if (item.mode === 'once' && !seen.includes(item.id)) {
      seen.push(item.id);
      try { localStorage.setItem('ngw_seen_announcements', JSON.stringify(seen)); } catch (_) {}
    }
  };
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || !item.id.trim() || typeof item.text !== 'string' || !item.text.trim()) continue;
    if (!['once', 'every-open'].includes(item.mode) || ids.has(item.id)) continue;
    if (item.display && !['dialog', 'banner'].includes(item.display)) continue;
    ids.add(item.id);
    if (!preview && dismissedAnnouncements.has(item.id)) continue;
    if (item.startsAt && (!Number.isFinite(Date.parse(item.startsAt)) || now < Date.parse(item.startsAt))) continue;
    if (item.endsAt && (!Number.isFinite(Date.parse(item.endsAt)) || now >= Date.parse(item.endsAt))) continue;
    if (item.mode === 'once' && seen.includes(item.id) && !shownAnnouncements.has(item.id)) continue;
    if (item.display !== 'banner') { messages.push(item); continue; }
    const card = document.createElement('article'); card.className = 'announcement';
    const dismiss = document.createElement('button');
    dismiss.type = 'button'; dismiss.className = 'announcement-dismiss';
    dismiss.textContent = '×'; dismiss.setAttribute('aria-label', t('dismissAnnouncement'));
    dismiss.addEventListener('click', () => {
      if (preview) {
        state.devAnnouncementBanner = false;
        container.replaceChildren(); container.hidden = true;
        nav.classList.remove('has-announcement');
        document.documentElement.style.setProperty('--announcement-space', '0px');
      } else { dismissedAnnouncements.add(item.id); renderAnnouncements(); }
      const activeTab = nav.querySelector('.nav-btn.is-active'); if (activeTab) activeTab.focus({ preventScroll: true });
    });
    card.append(buildAnnouncementContent(item), dismiss); container.appendChild(card); remember(item);
  }
  container.hidden = container.childElementCount === 0;
  nav.classList.toggle('has-announcement', !container.hidden);
  document.documentElement.style.setProperty('--announcement-space', container.hidden ? '0px' : (Math.ceil(container.getBoundingClientRect().height) + 1) + 'px');
  // Ordinary notices reuse the existing dialog. Never cover a song, another
  // dialog, or the launch splash. Several messages share one Done button.
  const overlay = document.getElementById('modal-overlay');
  if (!messages.length || state.currentPage !== 'songs' || document.getElementById('splash-screen') || !overlay.hidden) return;
  messages.forEach(remember);
  openAnnouncementDialog(messages, { onClose: () => {
    messages.forEach(item => dismissedAnnouncements.add(item.id));
  } });
}
/* @end:renderAnnouncements */

/* @begin:buildAnnouncementContent */
function buildAnnouncementContent(item) {
  const content = document.createElement('div');
  if (typeof item.title === 'string' && item.title.trim()) {
    const title = document.createElement('h2'); title.textContent = item.title; content.appendChild(title);
  }
  const text = document.createElement('p'); text.textContent = item.text; content.appendChild(text);
  return content;
}
/* @end:buildAnnouncementContent */

/* @begin:openAnnouncementDialog */
function openAnnouncementDialog(items, options = {}) {
  const body = document.createElement('div'); body.className = 'announcement-messages';
  items.forEach(item => body.appendChild(buildAnnouncementContent(item)));
  const actions = document.createElement('div'); actions.className = 'modal-actions';
  const done = document.createElement('button'); done.type = 'button'; done.className = 'btn-primary';
  done.textContent = t('doneBtn'); done.addEventListener('click', () => closeModal());
  actions.appendChild(done); body.appendChild(actions);
  openModal(options.title || t('announcementsLabel'), body, { onClose: options.onClose });
}
/* @end:openAnnouncementDialog */

/* @begin:previewAnnouncement */
function previewAnnouncement(display) {
  if (!state.devUnlocked) return;
  // Sample previews are session-only and never use real notice IDs or seen state.
  if (display === 'dialog') {
    openAnnouncementDialog([{ text: t('devPreviewDialogText') }], { title: t('devPreviewTitle') });
  } else if (display === 'banner') {
    state.devAnnouncementBanner = true;
    showPage('songs', { pushHistory: true, resetScroll: true });
  }
}
/* @end:previewAnnouncement */
