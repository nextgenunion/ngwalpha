# NGWorship maintenance guide

## What changed in 5.0.52

CSS now lives in 14 feature files, imported in order by `css/style.css`.
There is no build step. See `css/README.md` to find the right file to edit.
Selectors, declaration order, media queries, and cascade order are preserved.
Every imported file is required by the service worker's atomic offline install.
Existing source-inspection tests now follow those imports instead of reading
only the entry file. `tools/read_stylesheet.cjs` is test tooling, not app code.

Comments explaining browser quirks, accessibility, state attributes, and
intentional overrides remain. A few stale/historical comments were shortened
or corrected. The only `app.js` edit in this release is a comment about the
now-self-hosted chord fonts. Storage and backup behavior were not changed.

## Personal data: current protection and gaps

The current app already requests persistent storage, uses transactional writes
for User Songs, and moves songs between User Songs and Trash transactionally.
Playlists and personal labels use IndexedDB with a localStorage mirror. These
are useful protections; two copies inside browser storage are not an external
backup against clearing the site's data.

Current exports have different scopes:

| Export | Included | Important omissions |
|---|---|---|
| User Songs | Custom song records, stable song IDs, personal labels on those custom songs | Playlists/Favorites; personal labels on built-in songs; preferences; Trash |
| Playlists | Playlist names/order, Favorites, source/song ID references | Actual custom song records; personal labels; preferences; Trash |

Until there is a full backup, keep both exports together. Restore User Songs
first, then Playlists. Existing imports replace their respective collections;
they do not merge. Restoring only Playlists can leave references to custom
songs that are absent on the receiving device.

`tools/verify_backup_roundtrip_browser.cjs` uses synthetic data in isolated
browser contexts. It exercises the real export functions, imports into an empty
context, reloads, and checks custom content, IDs, Favorites, playlist references
and user-song labels. It also documents the built-in-label coverage gap and
checks that invalid duplicate-ID song imports leave existing songs intact.

### Recommended next data changes

1. Make failed saves explicit. `createMirroredKeyValueStorage().save()` currently
   catches failures of each backend and returns without rejecting, even if both
   fail. Return a confirmed outcome or reject when neither write succeeds;
   callers should not claim a durable save in that case. Verify with injected
   quota/transaction failures before shipping this change.
2. Add one versioned **Export all my data** format containing User Songs,
   Playlists/Favorites, all personal labels, and saved preferences. Decide
   explicitly whether to include Trash. Export recoverable source data, not
   derived search caches or bundled official song databases.
3. Add restore preview and make replacement explicit. Validate the whole backup
   before writing, show its date/counts, and keep existing export formats
   importable. Today the data spans several IndexedDB databases; a transaction
   in one cannot make a multi-database restore atomic. A complete restore needs
   a tested recovery/staging strategy, or a separately planned migration into
   one database. Do not simply clear all stores and write sequentially.
4. Show storage-persistence status in plain language and make backup available
   nearby. A persistence request may be declined and cannot prevent deliberate
   site-data deletion. Do not present an exported download as proof the user
   retained a safe copy. Occasional reminders can be considered separately.

Browser references:
- https://web.dev/articles/persistent-storage
- https://webkit.org/blog/14403/updates-to-storage-policy/

## Application extraction in 5.0.53

Four files now hold the extracted functions: song-engine.js, data.js, settings.js and ui.js. app.js retains shared state/constants, storage objects, startup and top-level listeners. This is a behavior-preserving first extraction using the existing classic script approach. Function bodies are unchanged; shared globals and cross-feature calls remain. See js/README.md for ownership and editing instructions.

Future changes should narrow interfaces a feature at a time. For example, search can eventually accept explicit song/query/options inputs instead of reading global state. Do not combine that behavioral change with a storage migration or framework conversion. Backup hardening remains the higher-priority functional change.

## Checks when shipping an extraction

- Preserve stored IDs, database names, keys and supported backup formats.
- Add new runtime files to the HTML loading order and `REQUIRED_OFFLINE`.
- Run existing `tools/test_*.js` scripts with Node.
- Run affected browser suites with Playwright and `CHROMIUM_EXECUTABLE` set.
- Check the whole affected journey: save, reload, offline launch, export/restore,
  and an update from an already-installed previous release.
- Use real device Safari/iOS and Android checks before claiming cross-browser
  coverage. Desktop Chrome verification alone does not establish that.
