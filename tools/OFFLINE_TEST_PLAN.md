# NGWorship Offline Test Plan

Use this after any release that changes `index.html`, `service-worker.js`, app modules,
icons, language files, song-source loading, or developer/WIP features.

## Automated tests

Run from the project root:

```bash
node tools/test_offline_contract.js
node tools/test_offline_first_load_cache.js
node tools/test_offline_service_worker.js
```

These cover shell completeness, first-uncontrolled-page Cache Storage persistence,
service-worker install/activate behavior, cached navigation, UI assets, selected song
database bootstrap, Sheet Music, and the self-contained fallback document.

## Device/browser manual matrix

### 1. First successful visit -> hard offline
1. Clear site data / uninstall the PWA.
2. Load the app online once.
3. Wait until the selected song list is visible and usable.
4. Enable airplane mode or DevTools Offline.
5. Force-close the PWA/tab, then reopen it.
6. Expected: full app shell, CSS, icons, Settings, chord tools, selected database,
   and any locally packaged enabled feature assets are present. It must not degrade
   to raw text or a half-styled document.

### 2. Very slow connection -> offline
1. Throttle to approximately 128 kbps or slower.
2. Open the app and wait until the UI is usable.
3. While the network is still slow, verify the worker reaches Activated/Controlling.
4. Switch to Offline, reload/reopen.
5. Expected: same result as test 1. Optional fonts/install artwork must not hold the
   worker in Activating.

### 3. Returning cached install -> offline
1. Use the app normally online.
2. Close it.
3. Disable all networking.
4. Reopen from the installed-app icon.
5. Expected: cached shell opens directly; custom `offline.html` should not appear
   unless the shell cache itself has been removed/corrupted.

### 4. Database coverage
For each database that must be available offline:
1. Open that database once while connected and wait for its list to load.
2. Go offline.
3. Switch away and back / restart the app.
4. Expected: its saved bootstrap loads offline.

A database that has never been opened online is not downloaded automatically. When
offline, it should show the explicit "not saved offline yet" message instead of a
generic/broken load error.

### 5. Sheet Music WIP
1. Enable the separate Sheet Music developer option.
2. Open English (SDA) and Amazing Grace #108 while online once.
3. Go fully offline and restart.
4. Expected: Sheet Music tab, catalog, song button, and the packaged score page all work.

### 6. Core feature smoke test while offline
- Songs list/search/sort
- Open a song
- Transpose and text controls
- Guitar chord viewer + alternate voicings
- Piano chord viewer + display
- Playlists/Favorites stored locally
- User Songs stored locally
- Settings + language switching
- Chord Finder
- Developer-gated Sheet Music (when enabled)

### 7. Update test
1. Install/use version N online.
2. Deploy version N+1.
3. Open online once so the new worker installs.
4. Confirm the new version is shown.
5. Go offline and restart.
6. Expected: N+1 shell opens; stable song-data cache survives the shell-cache rotation.
