# Application files

The first extraction uses four classic JavaScript files plus `app.js`. There
is no framework or build step. Existing chord/sheet-music modules stay separate.

| File | Responsibility |
|---|---|
| `song-engine.js` | Lyric syntax, search/cache/matching, sorting, transposition and lyric rendering |
| `data.js` | Official database loading/sync, personal data operations and import/export |
| `settings.js` | Preference loading/application, language and settings controls |
| `ui.js` | Page navigation, lists, editor, playlists, dialogs, scrolling, animation and seasonal effects |
| `app.js` | Shared state/constants/storage objects, startup, top-level listeners and PWA lifecycle |

`presentation.js` is a separate self-contained module (like `chord-viewer.js`) exposing `window.SongPresentation`. It builds lyric slides and owns the full-screen overlay; `ui.js` (`openPresentationMode` / `closePresentationMode`) owns the history entry and Back handling.

## Why shared state remains

This is a mechanical extraction. Function bodies and their original shared
references are unchanged. The four files define functions and run before
`app.js`; initialization and top-level event registration stay in their
original order in `app.js`. Deferred classic scripts share the same global
environment, just as the original file did. Do not wrap these files in an IIFE,
add `type="module"`, or introduce top-level calls without reviewing dependencies.

This makes the code easier to find without also redesigning behavior. It is
not full encapsulation: data functions still call existing UI callbacks and
engine functions still read some shared preferences. Narrow APIs and injected
dependencies can be introduced one operation at a time in later releases.

`ui.js` is deliberately the largest file. Fewer files means broader ownership;
keep it together unless it becomes uncomfortable to maintain.

## Editing and verification

- Edit a function in its owning file, not in an extraction placeholder.
- `/* @extracted:file:name */` in `app.js` records the original location.
  Matching `@begin:name` / `@end:name` comments surround the actual function.
  Keep those markers when editing. They allow existing source-based tests to
  inspect the current implementations in their original logical order.
- When renaming or moving a function, update its marker and callers together.
  `tools/read_application.cjs` is test-only; the browser does not use it.
- Shared constants/storage objects remain in `app.js`. Search there as well
  when changing a feature's state or persistence.
- Keep all four files before `app.js` in HTML and in the service worker's
  REQUIRED_OFFLINE list. Missing runtime code must fail offline installation.
- Run `tools/test_*.js`, affected browser suites, and an installed-version
  upgrade/offline check. The 5.0.53 extraction was compared against 5.0.52.
- Avoid changing persistence keys, database/store names or song IDs as part
  of a structural move. Backup coverage gaps described in MAINTENANCE.md
  remain separate planned work.

## Announcements and editor changes in 5.0.54

The editor compares fields and labels with its opening snapshot. Dirty forms use the standard discard confirmation; history entries now carry an index so cancelled multi-entry navigation returns to the exact draft. Successful saves/deletes clear the draft baseline. No autosave or storage schema change is introduced.

Optional announcement content is loaded once by data.js. ui.js renders ordinary notices through the shared dialog and rare explicit banners within bottom navigation. The optional JSON is network-only and never required for offline installation. See ANNOUNCEMENTS.md for the file format.
