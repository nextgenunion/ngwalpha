> **NOTICE (humans + AI): bump the version.** Shipping any changed file in
> this repo — including this README — means incrementing the PATCH digit
> of `SONGBOOK_VERSION_NUMBER` in `version.js` as part of the same edit.
> Format is plain `MAJOR.MINOR.PATCH` (e.g. `3.0.4` → `3.0.5`) — never a
> `beta.1` / `beta.2` / `beta.00000` counter. See "Versioning scheme" below
> for the full policy. This is not optional and not a "just this once."

# Next Gen Worship — Worship Song App (v5.0.16-alpha)

An offline-first worship songbook PWA. Static HTML/CSS/JS, no build step, no
backend — built to run on GitHub Pages and install like a native app.

This is the **Version 4.2** line of the planning doc's roadmap, building on
Version 3's User Songs and Song Editor with backup/import and Trash Bin
work while retaining Version 2's Playlists/Favorites and Version 1's core
songbook, settings, theme, search, and transpose features.

## v5.0.16-alpha

- **Conservative simplicity pass:** removed one confirmed-dead search helper, five unused translation keys from every language pack, and an unused Chord Finder `.sr-only` rule. No feature behavior was intentionally changed.
- **Storage duplication reduced:** Playlists and personal Labels now share one small IndexedDB + localStorage mirror helper instead of maintaining two nearly identical storage implementations. Their database names, keys, fallback behavior, and public `load()`/`save()` call sites remain unchanged.
- **List animation duplication reduced:** Songs, Playlists, and Add Songs now share the same enter/exit/cancel bookkeeping helpers instead of each carrying a copy of the same `animationend` state cleanup.
- This pass deliberately did **not** replace the chord engine, service worker, or modal system with a framework/library. Those areas were reviewed against established open-source alternatives first; the current implementations remain where replacement would add more migration risk or dependency weight than practical benefit.

## v5.0.15-alpha

- **Shared popup/modal presentation is now centered on mobile** instead of becoming a bottom sheet. Song database, add-to-playlist, playlist dialogs, label/info pickers and other shared popups use a compact rounded card with breathing room around it and an internal scroll area when content is long; full app pages are unchanged.
- **Song chord viewer is centered consistently on mobile** and no longer inherits bottom-sheet spacing from the generic modal shell.
- **Guitar ↔ Piano and alternate-voicing changes now transition smoothly**: the current diagram fades/settles out, the new instrument/voicing fades in, and the diagram container animates between the guitar and piano heights so the popup does not abruptly jump size. Reduced-motion preferences still disable the transition.

## v5.0.14-alpha

- The **song chord popup now switches between Guitar and Piano** with a thin two-option segmented control that follows the app's existing selector design language without taking the height of the full database selector. Guitar remains the initial default; the musician's choice is remembered for later chord taps during the current app session.
- Piano popup diagrams reuse the **same two-octave Presentation renderer and `PianoChords` voicing engine** already used by Chord Finder, so no duplicate chord-image library or second piano rendering system was introduced. The existing little ‹ › voicing arrows now cycle guitar positions or piano inversions depending on the selected instrument.
- Added a pure `ChordFinder.getPianoChordVoicings()` popup API and extended the chord-viewer regression tests to cover instrument switching, voicing-counter reset, piano inversion navigation, and the shared Presentation-style SVG output.

## v5.0.13-alpha

- Added **Piano** to Settings → Tools → Chord Finder. A new Guitar | Piano switch at the top of the tool swaps the fretboard for a two-octave keyboard (C3–B4). Tap keys and the chord is named from the pressed notes; the lowest key is the bass, so inversions are named as slash chords (E-G-C reads `C/E`). The result card shows the same note pills (root/3rd/5th…) and "Also:" alternatives as guitar. The chosen instrument is remembered.
- **Chord Search works for piano too.** With Piano selected, searching `Am7`, `C/E`, `Cmaj7` etc. presses the chord on the keyboard in root position, and the ‹ › arrows cycle its inversions (slash chords lead with the requested bass note lowest; large extended chords stay single instead of becoming clusters). Extensions (9/11/13) are voiced an octave up.
- **Presentation Mode** shows a clean keyboard diagram for piano (pressed keys highlighted, optional note names) in place of the guitar chart.
- The kebab menu adapts: for piano it offers only the Note | Hide marker choice (no fret range or finger numbers). Unpressed C keys carry a faint C3/C4 marker for orientation.
- New `js/piano-chords.js` holds the pure keyboard model, detection and voicing logic on top of `ChordCore` (no DOM), mirroring `guitar-voicings.js`; it is part of the precached core shell. Added strings for all four language packs and `tools/test_piano_chords.js` (geometry, detection incl. inversions, 192-chord voicing/round-trip check, slash bass, search wiring, presentation SVG).
- Guitar behavior, the song-view chord popup and all existing tests are unchanged.

## v5.0.12-alpha

- Added **alternate guitar voicings** to the song chord popup. When a chord has more than one useful playable position, small left/right arrows cycle up to five distinct shapes while reusing the same shared Presentation SVG renderer. The familiar curated shape stays first when one exists.
- Added a compact **Chord Search** to Settings → Tools → Chord Finder. Enter a symbol such as `Am7`, `F#m7/C#`, or `Cadd9`; the preferred voicing is loaded directly into the interactive fretboard and small arrows cycle other playable neck positions. Higher-position results automatically bring the relevant seven-fret window into view.
- Extended the existing voicing generator to retain the best candidate from different neck positions instead of only one global winner. Exact duplicate grips are removed, generated results are cached per canonical chord symbol, and curated first-choice shapes remain the primary result.
- Added localized search/voicing-navigation strings to all four interface language packs and a regression test validating multiple distinct, musically correct voicings for common/open/barre/slash/extended chord examples.

## v5.0.11-alpha

- Moved the Chord Finder **visible fret range** and **selected-note marker** controls out of the main fretboard panel and into the existing kebab menu, keeping the normal tool visually focused on the neck itself.
- Changed the default selected-note marker mode from **Note** to **Hide**. Existing installs that only inherited the old default `Note` value migrate once to `Hide`; explicit `Finger`/`Hide` choices are preserved.
- Fret-range and marker changes still apply immediately while the kebab remains open, and all previous range/barre/chord behavior is unchanged.

## v5.0.10-alpha

- **Barre re-expansion regression fixed:** an explicitly selected barre now remembers its original intended string span separately from the temporarily drawable span. If an endpoint is removed while editing, the visible barre may shrink, but restoring that endpoint expands the same barre again instead of permanently losing part (or all) of the F/Bm-style barre in the finder and Presentation Mode.
- The previous ghost-barre fix remains intact: once no note is physically held by the barre at its fret, the active barre is removed and no stale background capsule is rendered.
- Added a dedicated regression test covering full F-barre shaping, temporary endpoint removal/restoration from both sides, Presentation Mode full-span rendering, and final ghost-state cleanup.

## v5.0.9-alpha

- **Barre cleanup fixed:** editing or muting notes now shrinks a barre to its remaining contiguous held span and removes it completely when no valid barre remains. The normal fretboard's accent capsule is resynced on every edit, eliminating the stale/ghost barre background.
- **Canonical chord core:** added `js/chord-core.js`, an instrument-neutral parser/model and naming engine shared by the guitar system. It normalizes common aliases/accidentals, distinguishes a final slash bass from qualities such as `6/9`, and rejects malformed multi-chord/non-chord tokens instead of guessing.
- **Chord naming priority refined:** the actual bass note, root-position reading, formula completeness, and common chord complexity now determine the primary result. The main chord remains visually dominant while alternatives are fewer and more subdued.
- **Compact song chord viewer:** tapping a chord still reuses the shared Presentation SVG, but the shared modal now supports a chord-viewer variant so this helper opens as a small, focused card rather than a large sheet. Other modals automatically reset to their normal dimensions.
- **Curated guitar voicings:** added `js/guitar-voicings.js` with 60 familiar major/minor/7/maj7/m7 shapes. Common chords use these predictable human shapes first; slash chords and everything outside the small library continue through the existing algorithmic generator.
- **Partial barres:** the chord diagram model now carries explicit barre spans (`fret`, `fromString`, `toString`, `finger`) instead of assuming one full-neck barre. Presentation/song diagrams render five-string and smaller barres correctly, while the interactive finder can shrink a full barre as strings are edited.
- Added regression scripts under `tools/` for parser normalization, chord naming, curated-shape validity, barre cleanup/partial rendering, and full song-database chord coverage.

## v5.0.8-alpha

- **Architecture cleanup without feature changes:** shipped song-database metadata now lives in `js/song-sources.js`, which is the single source of truth for data folders, number behavior, picker groups/labels, runtime source creation, IndexedDB store names, and the song DB schema version.
- **Main app modularity:** the song-page chord popup interaction moved out of `js/app.js` into `js/chord-viewer.js`. `app.js` only injects the modal, translation, and shared chord renderer, keeping the feature isolated from app state.
- **Pure chord-diagram API:** `ChordFinder.renderDiagram()` now renders from supplied voicing data without mutating the interactive Chord Finder state. `diagramForChord()` uses that pure renderer, and the old private/debug globals are no longer exported.
- **PWA consistency:** the two new JS modules are part of the core app shell, and `icons/svg/chord-finder.svg` is explicitly included in best-effort precaching so the Settings tool icon is available offline on a fresh install.

## v5.0.7-alpha

- Fixed open-chord bass detection: untouched unmuted strings now count as open, so normal `x02210` identifies as `Am` instead of `Am/E`.
- Added tappable chord diagrams in the song view. Tapping a rendered chord opens a popup generated with the Chord Finder Presentation renderer; no chord-image library is stored.
- Added local chord-to-voicing generation for common major/minor/sus/6/7/9/11/13/altered chord symbols and slash basses.
- Fixed native/mobile lyric copy spacing by keeping real word-boundary spaces in the rendered DOM while retaining the existing visual word-gap layout.

## v5.0.6-alpha

- Chord Finder now opens with **frets 1–7** as the default visible range; the
  existing range controls still allow any start/end within frets 1–12.
- Presentation mode now renders a selected barre as **one continuous rounded
  index-finger bar** across the covered strings instead of six separate dots.
  Fretted notes above the barre remain individual markers.
- Higher-position presentation diagrams now reserve dedicated space for a
  stronger **starting-fret label** (for example `7fr`), so movable shapes are
  never mistaken for first-position chords.
- Presentation markers use finger numbers for individual placements, matching
  familiar chord-chart conventions; the barre itself is marked with `1`.
- Removed the normal-view “Tap a fret number for a barre” description; the fret
  numbers remain directly clickable.

## v5.0.5-alpha

- Presentation mode now keeps the detected chord name in a stable title slot
  above the diagram.

## v5.0.4-alpha

- **Chord Finder normal view refined to behave like an actual guitar neck** — the
  default 1–12 fret range now always fits the available width with no horizontal
  scrollbar, standard inlay dots appear at frets 3/5/7/9 with a double marker at
  12, and selected notes use larger circles in the app's current accent color.
- Selected-note circles show **note names by default**, with a compact Marker
  control for **Note / Finger / Hide**. The finger mode estimates 1–4 fingering
  labels while keeping the same selected-note positions.
- Added editable **visible fret range** controls (start/end within the 12-fret
  finder). Selections outside a newly chosen range are cleared so hidden notes
  never keep affecting the displayed chord.
- **Tap any fret number below the neck to create/remove a full barre** at that
  fret. A subtle accent bar is drawn behind the strings and the fret number gets
  an active state; individual notes can then be changed normally.
- The detected chord card now sits **below the fretboard** and keeps a stable
  minimum height, so identifying a chord no longer pushes the fretboard around.
  The card shows the main chord, practical voicing text, interval-role note pills,
  and alternative names in the existing app design language.
- Chord detection is substantially broader: it now starts at **two selected
  notes**, supports common omitted-5th guitar voicings, and recognizes many more
  6/add/7/9/11/13, suspended, altered, diminished and augmented chord types.
  Normal identification now analyzes **only the notes actually selected** instead
  of silently treating every untouched string as open, which fixes many false
  unknown/incorrect readings.
- **Presentation mode source and styles are unchanged.** All of these changes are
  confined to the normal Settings → Tools → Chord Finder experience.

## v5.0.3-alpha

- **Chord Finder interactive fretboard redesigned horizontally** — Settings →
  Tools → Chord Finder now reads like a real guitar neck: E/B/G/D/A/E strings
  run left-to-right, the nut is at the left, 12 vertical fret wires are shown,
  fret numbers sit underneath, and selected notes are simple circles centered
  directly on the strings. Narrow screens can scroll the neck horizontally
  instead of crushing the fret spacing.
- The existing mute behavior is retained without a separate control row: tap a
  tuning label at the left to mute/unmute that string. Chord detection itself
  is unchanged.
- **Presentation mode was not redesigned or restyled**; its existing printed
  chord diagram remains separate and unchanged.

## v5.0.2-alpha

- **Chord Finder now has a ⋮ menu with Presentation mode** — the button sits
  at the top right of the Chord Finder page (same look as the song view's ⋮).
  Presentation mode swaps the interactive board for a plain printed-style
  chord diagram to show other people: six strings, **five fret rows**, and
  each held note marked with **only its fret number** (no note names, string
  names, mute buttons, alternatives or Clear button). `×` above a string =
  muted, `○` = open. A thick nut is drawn when the chord fits in frets 1–5;
  a chord higher up the neck slides the five-fret window to start at its
  lowest fretted note and labels it (e.g. `5fr`), never running past fret 12.
- To leave presentation mode, tap the small faint ⋮ in the corner (same
  low-profile dot the song view uses) and choose "Exit presentation mode".
  Leaving the page also exits it, so the tool never reopens stuck in it.
- The screen stays awake while presenting (same wake-lock the song view uses).
- Logic: `Presentation` and `Menu` modules in `js/chord-finder.js`; styles in
  the "Chord Finder — kebab menu + Presentation mode" block at the end of
  `css/style.css`; one new translation key (`cfMutedWord`) in all four
  `lang/*.js` files. The menu reuses the existing "Presentation mode" /
  "Exit presentation mode" strings.

## v5.0.1-alpha

- **Chord Finder is now portrait** — the neck runs vertically (one column per
  string, low E on the left, nut at the top), so it fits a phone screen with
  no sideways scrolling.
- **Open strings no longer need to be tapped** — strings you leave alone count
  as open (shown as a soft dashed ring), so Em is just two taps. Use the ×
  above a string to mute it; tap the top row to mark a string open explicitly.
- **Am no longer reads as Am/E** — untouched strings lower than the lowest
  fretted one are also tried as "not played", and a root-position name beats
  a slash chord. See `analyze()` in `js/chord-finder.js`.

## v5.0.0-alpha

- **New built-in tool: Chord Finder** — Settings → Tools → Chord Finder opens a
  six-string guitar fretboard (open + 12 frets). Tap frets to hold a chord and
  the app names it (with up to three alternative names and the note list); tap
  the × on a string to mute it, or "Clear all" to reset. Works fully offline.
  Ported from the standalone Chord Finder `index.html` into the app: logic in
  the new `js/chord-finder.js` (precached by the service worker), markup in
  `#page-chord-finder`, styles in the "Chord Finder" block at the end of
  `css/style.css` (uses the app's own light/dark theme and accent tokens).
  It's registered like About in `PAGES`/`SLIDE_PAGES` in `js/app.js` and
  translated in all four `lang/*.js` files (`mn2.js` uses Cyrillic
  placeholders for now, like its other untransliterated strings).
- Major version bump to **5** for this release.

## v4.2.48-alpha

- Songbook sync progress now has a quieter translucent frosted track and slower motion.
- Favorite heart badges are slightly smaller and sit closer to the number circle.
- Display settings now controls the visibility of the song page text-size buttons.
- Song info reports whether the current content came from the preload snapshot, an individual file, or an older saved copy whose origin is unknown.

## v4.2.47-alpha

- **New Developer option: song info** — the song-view "⋮" menu gets an
  "Song info" row once Developer options is unlocked, showing which exact
  source database and file (`data/<folder>/<id>.json`) the open song's
  content came from, plus its song ID and number. User Songs report
  "stored locally, no source file" instead, since they live in IndexedDB
  rather than a static JSON file. See `songSourceFilePath()` /
  `openSongInfoModal()` in app.js
- **Text size now also available from Settings → Display settings** — a
  new "Text size" row reuses the exact same Lyrics/Chords A−/A+ controls
  (and the same size state) already in the song view's own font-controls
  bar, so it can be adjusted from either place
- **English sort labels shortened** — "Ascending"/"Descending" are now
  "Ascend"/"Descent" in the English language file only; mn/kr/mn2 are
  unaffected, they already have their own independent strings
- **Songbook list favorite-heart badge nudged into alignment** — its
  top/right offsets were off by 1px from each other, which read as
  slightly uneven on the circular number badge; now equal on both axes,
  in comfortable and compact list views

## v4.2.44-alpha feature merge

- Restores the Songbook database picker inside the search field and the song
  view's Display settings shortcut from the v4.2.39 feature build.
- Restores inline `*italic*`, `**bold**`, and `***bold italic***` lyric
  rendering, including through chord markers and in the editor preview.
- Loads roman and italic variable Noto Sans with the same font stylesheet
  URL in the page and offline cache. The v4.2.43 fixes below remain present.

## v4.2.43-alpha fixes

- User Song backups now include the separate personal-label layer. The new
  export is a versioned JSON object with `songs` and `personalLabels`; import
  still accepts older plain-array song backups, which could not contain
  personal labels. Import replaces the current User Songs and their personal
  labels, while keeping labels assigned to official songs.
- Editing an imported User Song preserves its alternate titles.
- Modal close cleanup has a timeout fallback if the browser skips the CSS
  transition event; reopening promptly cancels the pending close.
- Offline font precaching requests the same variable Noto Sans stylesheet as
  the page itself.

## What's new in v4.2.26-alpha

- User Song delete-to-Trash and Trash recovery are now cross-store IndexedDB
  transactions, preventing a failed move from leaving a song in neither place
- User Song full-replacement imports now clear and repopulate in one atomic
  transaction and validate/normalize backup structure before committing
- Playlist imports now normalize required structure, references, ordering, and
  Favorites before replacing live state
- External song links are limited to HTTP(S) before rendering as clickable URLs
- Removed confirmed dead translation/CSS/state code and an unused music icon;
  corrected stale source-folder/config comments

## What's new in v4.2.5-alpha

- **New Developer option: "Hide verse numbers"** (Settings → Developer
  options → Display) — hides the small gray "1, 2, 3…" sequence badge
  `renderLyrics()` adds above each verse/chorus when a song has more
  than one part. Off by default
- Deliberately does **not** touch the same-looking badge when a section
  opens with an explicit label instead of a number — "Bridge:", "Гүүр:",
  "Дахилт:", etc. still render either way. The two cases were previously
  the same CSS class (`.lyric-section-number`); they're now split into
  `.lyric-section-index` (the plain number, hideable) and
  `.lyric-section-label` (an explicit label, never hidden), so the two
  can be targeted independently
- Same attribute-driven pattern as Landscape mode: toggling it sets
  `data-hide-verse-numbers` on `<html>` and a CSS rule does the hiding,
  so an already-open song updates instantly with no re-render needed

## What's new in v4.2.4-alpha

- **Alphabetical sort now groups by script** — Cyrillic-titled songs
  first, then anything starting with another letter (Latin, traditional
  Mongolian script, etc.), then titles starting with a digit/`#`/symbol
  last. Previously a plain `localeCompare()` interleaved these by raw
  character code, which especially scattered digit/symbol-led titles
  throughout the list instead of collecting them at one end
- Only the grouping is new (`titleScriptRank()`); within a group it's
  still ordinary `localeCompare()`. **Descending** mirrors this exactly
  (symbols/digits first, Cyrillic last) rather than only reversing
  within a fixed group order, so it's a true flip of Ascending
- The fast-scroll rail (Songbook page's edge scrollbar) needed no
  changes — it already just buckets by consecutive first-letter changes
  in whatever order `sortSongs()` hands it, so it follows the new
  grouping automatically
- Search itself (`matchesQuery()`/relevance ranking) is untouched — this
  only changes the order of the *Sort by A–Z* list, not what search
  finds or how it ranks results

## What's new in v4.2.3-alpha

- **Fixed search lag/freezing on backspace with large song databases** —
  `matchesQuery()`/`relevanceRank()` were rebuilding and re-lowercasing
  each song's *entire* searchable text (title, alt titles, artist, and
  the full lyrics with chords stripped out via regex) from scratch on
  every single keystroke, for every song in the active database. Fine
  for a handful of songs; on a database with hundreds of songs it's real
  work repeated on every character typed or deleted, which is what was
  showing up as a freeze on mobile
- That's now computed once per song and cached on the song object itself
  (`getSearchCache()`), so every search after a song's first match is a
  cheap property read instead of a rebuild. Safe to cache indefinitely —
  User Song edits always install a fresh object rather than mutating an
  existing one in place, so an edited song naturally starts uncached
- Also added `coalesceToNextFrame()`, which folds several `input` events
  landing faster than the browser can paint (e.g. holding backspace,
  which can auto-repeat faster than one re-render takes) into a single
  update on the next animation frame — applied to the Songs search, User
  Songs search, and the playlist "add songs" picker's search, the three
  places that filter against a full song list per keystroke

## What's new in v4.2.2-alpha

- **New song database: `mongolian2` ("Монгол")** — a second, separate
  Mongolian-language songbook alongside the existing "Монгол (ДАС)"
  database, selectable from Settings → Song database. Currently seeded
  with 7 songs (`m002`–`m008`); more can be added the normal way (new
  `mNNN.json` + a manifest.json line — see "Multiple song databases")
- **Alternate titles moved to the bottom of the song view** — `#sv-alt-title`
  now renders below the lyrics (with a translated "Also known as:" /
  `altTitlesPrefix` label) instead of under the title, and picked up a
  divider to set it apart as reference info rather than part of the
  song's identity. Search/ranking behavior (`matchesQuery()`/
  `relevanceRank()`) is unchanged — see the new "Alternate titles" section
  below for the full system
- `SONGDB_STORES`/`SONGDB_VERSION` bumped 5 → 6 for `mongolian2`'s own
  IndexedDB offline-backup store, and `service-worker.js`'s
  `SONG_DB_FOLDERS` updated so it's precached for offline use

## What's new in this version

- **Trash Bin for User Songs** — deleting a User Song (from the song-view
  ⋮ menu or the Song Editor) now moves it to a Trash Bin instead of
  erasing it outright. Reached from **Settings → Songs → Trash bin**, the
  page lists everything currently trashed (newest-deleted-first) with a
  "N days left" label per song
- Each trashed row has its own **⋮ menu** with **Recover** (restores it
  back into User Songs) and **Delete** (permanent, with a confirmation
  step) — the same per-row kebab pattern the song-view and Playlists
  pages already use
- **Select mode** — tapping "Select" in the header swaps every row's
  checkmark in and shows a bottom action bar with **Select all** /
  **Deselect all**, plus batch **Recover** and **Delete** for however
  many songs are checked. Mirrors Playlists' existing edit-mode pattern
  (`playlistEditMode`) rather than inventing a new one
- **Automatic 30-day purge** — a trashed song that's been sitting for
  more than `TRASH_RETENTION_DAYS` (30) is hard-deleted the next time the
  app opens (`purgeExpiredTrash()`, run once at startup alongside the
  rest of `init()`'s data loads). There's no background process in a
  PWA, so "once per app open" is the only reliable cadence — a song that
  ages out while the app isn't running is simply swept the next time it is
- Storage-wise, trash is its own IndexedDB object store
  (`user-songs-trash`, added in `SONGDB_STORES.trash`, bumping
  `SONGDB_VERSION` 4 → 5) with the same one-key-per-song shape as
  `user-songs` itself, plus a `deletedAt` timestamp `TrashStorage` reads
  back to decide what's aged out. A trashed song is simply absent from
  `user-songs` — not a flag on the song — so every existing
  `UserSongStorage`/`loadUserSongs()` caller needed no changes
- Every new interface string ships translated in all four language files
  (`mn`, `eng`, `kr`, `mn2`)

## What's new in v4.1.19-alpha (User Songs, Song Editor)

- **User Songs** — a new "User Songs" tab in the bottom navigation, between
  Songs and Playlists. Its own list, its own search box, and its own **+**
  button to write a new song from scratch — kept as a fully separate
  section from the official Songs list rather than a filter on it, per the
  plan ("Sorting systems are not required because Official Songs and User
  Songs are separate sections"). Falls back to a plain alphabetical sort —
  user songs have no song number, so the number badge and "Sort by number"
  control both stay hidden for this source, the same way they already do
  for the numberless English database
- **Song Editor** — a single form (Title, Artist/band, Key, an optional
  audio link, and a Lyrics & chords textarea) with a **live preview**
  underneath that renders exactly how the song will actually look once
  saved. The textarea uses the same `[Am]`-before-syllable chord notation
  official song data already uses (see "Editing the song list" below) —
  there's no separate chord-entry UI, and the preview is built by running
  the textarea's current, unsaved content through the real chord/lyric
  rendering engine (`renderLyrics()`, now parameterized to accept a
  container/song/transpose override) rather than a second implementation
  that could drift out of sync with it
- Opening a User Song from the list works exactly like opening an official
  song — same song-view page, same transpose, same "add to playlist," same
  favorite-heart. The one addition is a **⋮ menu** in the song-view header,
  shown only for User Songs, with **Edit** (reopens the Song Editor
  pre-filled) and **Delete** (with a confirmation step)
- User Songs are saved on-device only (IndexedDB) — there's no server, so
  this storage *is* the song, not a cache of one. It reuses the same
  `songbook-db` database and the `user-songs` object store that's been
  reserved for this since v1 (see "Built for what's next" in the v2 notes),
  bumped from a fetch-backup role to primary per-song storage — each song
  is its own key rather than one combined blob, so creating, editing, or
  deleting one song is a single small write
- Deleting a User Song that's referenced in a playlist or Favorites doesn't
  need any special cleanup — playlists already store song references
  (`{sourceKey, songId}`), never copies of the song data, and already
  tolerate a reference that no longer resolves (the same handling that
  covers an official song disappearing from a manifest)
- Every new interface string ships translated in all four language files
  (`mn`, `eng`, `kr`, `mn2`) — `mn2` (traditional Mongolian script) follows
  the same Cyrillic-fallback convention already used there for Playlists
- **English (SDA) song database** — a third database, `data/hymn/`, seeded
  with 695 hymns (with chord charts and song numbers, like the Mongolian
  database) converted from an existing SDA hymnal JSON export. The
  Mongolian database's display name in Settings → Song database changed
  from "Монгол (Official)" to "Монгол (ДАС)"
- **`db-select`'s values are now real `DB_SOURCES` keys** (`official`,
  `english`, `sda`) instead of the old two-value `mn`/`en` shorthand.
  Adding the third option exposed that the dropdown's restore-on-startup
  and change-handler logic were still hardcoded to that binary choice
  (despite DB_SOURCES itself already being a generic registry) — a third
  option would have silently resolved to the Mongolian database instead
  of actually switching. Fixed by having both read/write the selected
  source's key directly; a device with `mn`/`en` already saved from
  before this change still resolves correctly
- Adding a database now also needs one `SONGDB_STORES` entry (its
  IndexedDB backup) and a `SONGDB_VERSION` bump (3 → 4, to create that
  store on already-installed devices) — previously undocumented steps
  that the sda database's `SONGDB_STORES.sda = 'sda-songs'` entry is the
  worked example for. See the comment above `DB_SOURCES` in `js/app.js`
  for the full, corrected list of what adding a database touches
- **Songbook list view** (Settings → Appearance, right under Accent
  color) — a three-way segmented control (List/Compact/Tiles) for how
  the Songbook's own list displays. **List** is the existing full row,
  unchanged. **Compact** shrinks the row/badge and drops the artist line
  so more songs fit on screen at once. **Tiles** turns the list into a
  four-per-row grid of plain song numbers, each still using the exact
  same circular badge — color, font, shape — as the list view rather
  than a separate look. For the numberless English database, where
  there's no number to show, a tile falls back to a small centered title
  instead of sitting empty. Scoped to `#song-list` specifically (not the shared `.song-list` class), so User Songs and
  playlist song-pickers keep their existing look no matter which view is
  chosen here

## What's new in v2.4.0-beta (Playlists, Favorites, Chord Visibility, Hide Chords, Developer Options, English Song Database)

- **Playlists** — a new "Playlists" tab in the bottom navigation, between
  Songs and Settings
- A permanent **Favorites** playlist — tap the heart icon on any song to
  add/remove it; it can't be renamed or deleted
- Create a playlist from Settings-free, one-tap **+** on the Playlists page,
  or directly from inside a song (**+** next to the heart) — creating one
  there adds the current song to it in the same step
- Add more songs to an existing playlist from inside that playlist (its own
  **+** button opens a searchable song picker)
- **Rename** or **delete** any user-created playlist via the three-dot (⋮)
  menu in the top-right of that playlist's page (not shown for Favorites)
- Playlists are saved on-device (IndexedDB, with a localStorage fallback)
  behind a small, swappable storage layer (`PlaylistStorage` in
  `js/app.js`) — see "Playlists storage", below, for what this does and
  doesn't cover
- **Export / Import playlists** (Settings → App) — downloads/loads a
  `ngworship-playlists.json` file, the supported way to carry playlists to
  a different browser on the same phone (see below for why this is a
  manual step, not automatic)
- **Hide chords** (Settings → Appearance, right under Chord style) — a
  switch for a lyrics-only view; song data and the Chips/Text choice
  underneath are untouched, chords just stop rendering until switched
  back on
- Fixed the Chord style segmented control (Chips/Text) rendering with
  washed-out, low-contrast colors on its active segment in dark mode
- Eased the lyrics card's horizontal padding back up slightly — a
  previous pass had tightened it more than intended chasing width for
  long lyric lines
- Fixed Hide chords leaving lines that originally had chords looking
  cramped — they now pick up the same comfortable line spacing that
  chordless lines already used
- Consolidated the app icon files: `app-icon-192.png`, `app-icon-512.png`,
  `app-icon-maskable-192.png`, `app-icon-maskable-512.png`, and
  `about-logo.png` were five byte-identical copies of the same image (none
  actually sized for their filename) — now just `app-icon.png` (`any`
  purpose, reused by the About page too) and `app-icon-maskable.png`
  (`maskable` purpose). See "Replacing an icon" below for what the
  `maskable` file still needs (safe-zone padding) before it's fully correct
- **Developer options** — its own dedicated page (reached via a hidden
  row in Settings → About, below Contact us), unlocked by tapping the
  About page's app icon 3 times in a row within 0.8s. Not persisted —
  hidden again on every fresh load, same as the existing accent-color
  disco easter egg's own tap state. Contains:
  - **Playlists backup** (Export/Import) — moved here from its previous
    always-visible spot in Settings → App
  - **Three separate "Force ... on" switches** — one each for the Sabbath
    mascot, Christmas snow, and party mode/accent disco — for previewing
    any one of them individually without waiting for the right date or
    finding its own trigger. Turning one off does **not** disable that
    egg — it falls straight back to its own original secret method
    exactly as before this feature existed (Sabbath/Christmas by date,
    party mode by 3 taps on "Accent color" in Settings), and the other
    two switches are unaffected. A party-mode session started manually
    via that 3-tap is never interrupted by its switch turning off, and
    vice versa — whichever one started a session is the only one that
    can stop it
  - **Traditional Mongolian script** — reveals the vertical traditional
    Mongolian-script language option (`lang/mn2.js`, still being
    finished) in the language picker. The script file now always loads
    (previously commented out in `index.html`) so its data is ready
    instantly when this is switched on; it's filtered back out of the
    picker when switched off, falling back to the default language if it
    was the active choice
  - **Show credits** — shows the About page's Credits section at runtime
    without editing `config.js`'s `creditsEnabled` flag directly; either
    one being on is enough to show it
- Removed the (previously hidden/disabled) per-track audio download link
  on song pages — it wasn't planned to ship as-is; the `<audio>` player
  controls remain
- Lyrics now render at font-weight 450 (previously 400) — a touch heavier
  for readability, short of full Medium (500)
- **English song database** — off by default; enable it from Settings →
  Song database (the option was previously present but disabled). Seeded
  with 6 public-domain English hymns (Amazing Grace, Blessed Assurance, It
  Is Well with My Soul, Standing on the Promises, When We All Get to
  Heaven, Nearer My God to Thee) with full chord charts. Unlike the
  Mongolian database, English songs have no song number — the number
  badge and "Sort by number" are hidden automatically whenever this
  source is active, falling back to alphabetical sort
- **Song data is now organized per-database**: each database is its own
  folder under `data/` (`data/mongolian/`, `data/english/`) with its own
  `manifest.json`, registered in one place (`DB_SOURCES` in `app.js`).
  Adding a future third database is: new folder + manifest + one
  `DB_SOURCES` entry + one `<option>` in `index.html` — nothing else
  needs to change. The Mongolian database's folder was renamed from
  `data/songs/` to `data/mongolian/` as part of this — the manifest and
  every song file inside it are otherwise untouched

## What's in this version (carried over from v1)

- Official songs library with search (title, song number, artist, and lyric
  phrases — try searching "God awesome")
- Sort: A–Z, Z–A, number low–high, number high–low
- Song view with chords rendered above lyrics
- Chord transpose (up/down by semitone, resets to original key)
- Independent lyric and chord font size controls
- Light / dark mode (saved on-device)
- **Interface language: Mongolian (default) and English**, switchable in
  Settings (Playlists strings are also localized for Korean; the
  traditional-script Mongolian variant currently falls back to modern
  Cyrillic for the new Playlists strings only, pending a proper
  translation pass)
- Settings page with a song-database selector and an **Install App** button
- Full PWA support: manifest, service worker, offline caching
- Bottom navigation: Songs, Playlists, Settings — User Songs and Sheet
  Music are not yet in the nav; they'll be added back in when their
  versions land

## Playlists storage — what "local file, not browser-specific" means here

Playlists are saved **on the device**, not in the cloud — there's no
backend and nothing is uploaded anywhere. In practice that means IndexedDB
as the primary store, with a localStorage mirror as a fallback for
contexts where IndexedDB isn't available. Both of those are genuinely
**per-browser** storage: a real limitation of the web platform is that a
website has no way to share storage between two different browsers (say,
Chrome and Safari) on the same phone, or to write to an arbitrary file
the way a native app could, without the person's explicit, per-file
permission each time.

So: playlists **do** persist across visits, tab closes, and reopening the
installed app, and **do** survive on the same browser you created them in.
If you switch to a different browser on the same phone, use **Settings →
Export** to save a `ngworship-playlists.json` file, then **Import** it in
the other browser — that's the supported way to carry playlists across
browsers on this device today.

The storage code itself (`PlaylistStorage` in `js/app.js`) is deliberately
isolated behind two functions — `load()` and `save()` — so this can be
upgraded later (e.g. to the File System Access API, writing to a real file
the person picks once) without touching any of the playlist logic that
calls it.

## Project structure

```
index.html          App shell — every page lives here, toggled by JS
offline.html         Self-contained offline fallback page (see "Offline screen" below)
css/style.css        Design tokens + styles (light & dark themes)
js/app.js            Main application orchestration and feature logic
js/song-sources.js   Single registry for shipped song sources + IndexedDB stores
js/chord-core.js     Instrument-neutral chord parser/model + naming engine
js/guitar-voicings.js Curated familiar guitar shapes (generator fallback stays in finder)
js/chord-finder.js   Guitar fretboard, voicing generator, and shared diagram renderer
js/chord-viewer.js   Song-page tappable-chord popup adapter
data/                One folder per song database: editable per-song JSON +
                     manifest.json, plus optional generated database.json bootstrap snapshot
                     (see js/song-sources.js for the registry)
lang/*.js         Interface text — one file per language (config.js + eng.js/mn.js/kr.js)
manifest.json         PWA manifest
service-worker.js     Offline caching (lazy song DB cache + offline app shell)
icons/                App icons, logos, and icons/svg/ — one SVG file per UI icon
```

`index.html` loads the small registry/feature modules before `js/app.js`.
Keep source-specific metadata in `js/song-sources.js`; keep instrument-neutral chord
meaning in `js/chord-core.js`, guitar-specific shapes/rendering in the guitar modules,
and app orchestration in `js/app.js`.

## Multiple song databases

Each song database is its own folder under `data/`: `data/mongolian/`
("Монгол (ДАС)", the default), `data/mongolian2/` ("Монгол", a second,
separate Mongolian-language songbook — see below), `data/english/`
("English", 6 generic public-domain hymns), and `data/hymn/` ("English
(SDA)", 695 hymns from an SDA hymnal). Every database has the same
shape: one JSON file per song plus that folder's own `manifest.json`
listing them. A generated `database.json` is a fast bootstrap snapshot, not
the authoritative latest copy. On a first load it can put the whole library
on screen in one request; the app then checks the manifest + individual song
files in the background and saves the merged latest result to IndexedDB.
Ordinary one-song edits therefore do **not** require rebuilding `database.json`;
run `python tools/build_song_bundles.py` whenever you want to refresh the
bootstrap snapshot itself (for example before a larger release).

The folders are registered in one place, `databases` in
`js/song-sources.js`. Each entry carries its data folder, song-number behavior,
database-picker group/label, and IndexedDB store name. `js/app.js` derives both
its runtime source state and `SONGDB_STORES` from this registry rather than
repeating the same source list in multiple places.

`data/mongolian2/` currently contains 1,433 songs in this build. Add or
edit songs through the individual JSON files + `manifest.json`; those files
are the latest/authoritative layer. Rebuild `database.json` only when you want
to refresh the fast bootstrap snapshot.

Adding a database (a next-gen version of this app, a different language,
a different congregation's songbook) is: create the folder + its
`manifest.json` + song files, optionally run `python tools/build_song_bundles.py`
to create its bootstrap snapshot, then add one entry to `databases` in
`js/song-sources.js`. The picker is generated from that registry automatically.
If the new entry introduces a new IndexedDB store, increment
`indexedDbVersion` in the same registry file. The service worker handles
`/data/` generically, so there is no second per-database registry there.

`hasNumbers: false` (as set for the English database) means that
database's songs have no `number` field at all — the app hides the
number badge next to each song and the "Sort by number" button whenever
that database is the active one, falling back to alphabetical sort
instead. Set it to `true` for a database whose songs do have numbers.

**User Songs are deliberately not in the shipped `databases` registry.** Every entry there is a
`fetch()`-loaded, read-only database shipped with the app; User Songs are
the opposite — locally authored/imported and read-write, with no
`manifest.json` or folder of their own (see "What's new in this version"
above for how they're actually stored). `renderSongList()`/`sortSongs()`
treat the `'user'` source key as `hasNumbers: false` directly, the same
outcome as the English database's setting above, without it needing an
entry in this registry at all.

## Why song data moved to one JSON file per song

Each song is its own file under its database's folder (e.g.
`data/mongolian/s001.json`), listed in that folder's own `manifest.json`.
This makes adding, editing, or handing off a single song trivial — no
more scrolling a 2,000-line file to find one song, and version-control
diffs stay small and readable.

**Trade-off:** this loads the data with `fetch()`, which browsers block when
a page is opened directly from disk (`file://…/index.html`) — the exact
problem an earlier draft of this app avoided by using a single `.js` file
with a global variable instead. That workaround is gone now. **The app must
be served over `http://` or `https://`** — even `http://localhost` is
enough — for the song list to load at all. This same requirement already
applied to installability and offline support, so it isn't a new category of
limitation, just a stricter version of one that was already there.

## Replacing an icon

Every icon the app uses lives as its own file under `icons/svg/` (search,
back arrow, contact envelope, social icons, etc — names are descriptive, e.g.
`nav-songs-bookmark.svg`). To swap one out, just replace that file's content
with a different SVG — the app fetches and injects each icon at runtime, so
no code changes are needed, and a replacement with a different `viewBox`
still renders correctly.

The splash-screen logo (`icons/splash-logo.png`) is a separate PNG and can be
swapped the same simple way — it's shown at its own aspect ratio, never
stretched, whatever size image you give it.

### App icon: `app-icon.png` vs `app-icon-maskable.png`

The install manifest now includes explicit **192×192** and **512×512**
`purpose: "any"` icons (`icons/app-icon-192.png` and
`icons/app-icon-512.png`). These are the standard PWA install sizes used by
Chromium/desktop installability checks. The original large `app-icon.png` is
kept as an additional full-resolution source and is still reused by the
About page, browser favicon, and Apple touch-icon link.

The files have these roles, per the
[W3C manifest icon spec](https://www.w3.org/TR/appmanifest/#purpose-member):

- **`icons/app-icon-192.png`** — explicit 192×192 `purpose: "any"` PWA icon.
- **`icons/app-icon-512.png`** — explicit 512×512 `purpose: "any"` PWA icon.
- **`icons/app-icon.png`** — large `purpose: "any"` source/fallback. Safe to
  use full-bleed artwork that runs to every edge.
- **`icons/app-icon-maskable.png`** — `purpose: "maskable"`. On Android and
  some desktop launchers, the OS itself crops this into a circle, squircle,
  or rounded square — it does **not** render as a plain square the way `any`
  does. Anything sitting outside the center ~80% "safe zone" (roughly the
  outer 10% margin on every side) can get clipped by that crop, including
  corner content like a ribbon.

**Current state:** both files are the same placeholder image today —
`app-icon-maskable.png` has *not* been given real safe-zone padding, so the
BETA ribbon and the edges of the book icon may get cropped on Android
launchers that mask it. That's a known, accepted tradeoff for now, not a
bug — a properly-padded maskable version is expected to replace it later
(see export settings below).

**To export a new `app-icon-maskable.png` (e.g. from Photoshop):**

1. Design on a **960×958 canvas** (matches the current source's exact
   pixel size — any square-ish size works, but keep the same aspect ratio
   `app-icon.png` uses so neither file looks stretched relative to the
   other).
2. Have the **background fill the entire canvas edge-to-edge** — no
   transparency and no hard-edged border, since the OS crops this file's
   *edges* away and a transparent or mismatched edge will show as a colored
   ring or gap once cropped.
3. Keep the **logo content (book, cross, note glyph, ribbon, or whatever
   else you keep) inside the center ~80%** of the canvas — leave roughly a
   10% margin on all four sides empty (or background-only). That margin is
   what gets cropped away on circular/squircle masks; anything you want to
   survive the crop needs to sit inside it.
4. Export as **PNG, RGB or RGBA, no compression artifacts** (Photoshop:
   File → Export → Export As → PNG; "Smaller File (8-bit)" is fine since
   this source has no fine gradients that need 24-bit, but 24-bit PNG also
   works and is a safe default if unsure).
5. Save it as `icons/app-icon-maskable.png`, replacing the placeholder —
   same filename, so nothing else in the app needs to change.

`icons/app-icon.png` (the `any`-purpose file) can stay full-bleed, ribbon
and all — it's never cropped, so there's no safe-zone constraint on it.

## Editing the song list

To add a song: create `data/<folder>/sNNN.json` (copy an existing one as a
template) and add its filename to that folder's own `manifest.json`. To edit a
song, edit its individual JSON file. Those individual files are authoritative,
so ordinary song changes do not require a `database.json` rebuild. Run
`python tools/build_song_bundles.py` only when you want the one-request
bootstrap snapshot refreshed. Nothing in `js/app.js` needs to change for
ordinary song edits.

Chords are written inline in the lyric line using square brackets right
before the syllable they land on:

```js
"lyrics": [
  "[Am]Oh Holy [G]Amazing God we pray"
]
```

renders as "Am" above "Oh" and "G" above "Amazing". A `""` empty string in
the `lyrics` array creates a blank line (verse/chorus break).

Fields match the planning doc's data structure: `id`, `number`, `title`,
`alternateTitles`, `artist`, `key`, `lyrics`, `labels`, `metadata`, `audio`,
`sheetMusic`. `audio` and `sheetMusic` are wired into the data model now so
later versions can light them up without a schema change. `number` is
optional — a database registered with `hasNumbers: false` (see "Multiple
song databases" above) can omit it entirely; the app hides the number
badge and "Sort by number" automatically for that database rather than
expecting every song everywhere to have one.

This section covers hand-editing the official databases' JSON files
directly (a developer/content workflow). A person using the app itself
doesn't touch any of this — as of v3, **User Songs** (the "User Songs" tab
→ **+**) is an in-app Song Editor using this exact same `[Am]` notation in
a plain textarea, with a live preview, that saves straight to on-device
storage — see "What's new in this version" above.

## Alternate titles — how the system works (read this before adding any)

Every song can carry an `alternateTitles` array — other names people
search for it by: an English original a translation is based on, a
common nickname, an older/alternate transliteration, etc. It's a plain
array of strings on the song object, right next to `title`:

```json
{
  "id": "m002",
  "title": "Үй түмэн шалтгаан",
  "alternateTitles": ["10,000 Reasons", "10000 шалтгаан"],
  "artist": "Джонас Мырин, Матт Редман",
  ...
}
```

It's read in exactly three places in `js/app.js`, and nowhere else —
there's no separate index or lookup table to keep in sync:

- **`matchesQuery()`** folds `alternateTitles` into the same searchable
  text as the title, artist, and lyrics, so typing an alt name in the
  search box finds the song.
- **`relevanceRank()`** ranks an exact/partial alt-title match above a
  lyrics match but below an actual title match, so searching an alt
  name surfaces the right song near the top without letting it outrank
  a real title hit on a *different* song.
- **`openSong()`** renders the list (joined with `" • "`, prefixed with
  the translated `altTitlesPrefix` string — see `lang/*.js`) into
  `#sv-alt-title`, which sits at the **bottom of the song view**, below
  the lyrics — deliberately not under the title, since it's reference
  info for someone who already knows the song rather than something
  needed to identify which song this is.

An empty array, or the field left off entirely, is fine — both
`matchesQuery()` and `openSong()` already guard for that
(`song.alternateTitles || []`), so it's not required on every song.

**Guidance for whoever (human or AI) is filling these in:** only add an
alternate title you're actually confident is correct — a name stated
directly, or a well-known original that a song's own `artist` credit
makes unambiguous (e.g. crediting Lenny LeBlanc & Paul Baloche is
enough to know a song is "Above All"). Don't guess at a probable
English original from lyrics/theme alone; a wrong alt title actively
misleads search and shows up as reference info in the song view itself,
so leaving it blank is safer than a confident-looking wrong guess. Each
array entry is one full name, not a fragment — put a Mongolian
transliteration and an English original as two separate entries (as
above), not concatenated into one string.

## Interface language (Mongolian / English)

`lang/` holds one file per interface language (config.js sets the default and order). The app defaults to
**Mongolian** — set by `window.SONGBOOK_DEFAULT_LANG = "mn"` at the bottom of
that file. Change that line to `"en"` if you want English as the default;
either way, people can switch languages themselves from **Settings → App
language**, and their choice is remembered on their device.

This is the *interface* language (menus, buttons, labels) — separate from
the song database selector, which controls which songbook's content you're
viewing, matching the plan's note that these are independent settings.

To add a new language: copy `lang/eng.js`, translate every value, set its key, add a <script> line in index.html
each value, add it under a new key (e.g. `ko`), and add an `<option>` for it
in the `#ui-lang-select` dropdown in `index.html`.

## Running locally

Any static file server works, e.g.:

```bash
python3 -m http.server 8080
# then open http://localhost:8080
```

Opening `index.html` directly via `file://` now works for browsing and
searching songs too (see above), but **the service worker and the Install
button require HTTPS or `localhost`** — that's a browser security rule, not
something this app can opt out of. Use a local server (or GitHub Pages) to
test those two specifically. When the page isn't on a secure origin, the
Install row in Settings explains this instead of showing a dead button.

## Deploying to GitHub Pages

1. Create a new GitHub repository and push this folder's contents to it
   (this folder should be the repo root, or the root of the branch/folder
   you configure Pages to serve).
2. In the repo: **Settings → Pages → Build and deployment → Source** = "Deploy
   from a branch", pick `main` and `/ (root)`.
3. Wait for the Pages build to finish, then visit the URL GitHub gives you
   (`https://<username>.github.io/<repo-name>/`).
4. All paths in this project are relative (`./`, `css/…`, `data/…`), so it
   works whether it's served from a root domain or a `/repo-name/`
   subpath — no path edits needed.
5. GitHub Pages serves everything over HTTPS automatically, which is exactly
   what the service worker and Install button need to work.

### Versioning scheme

Version numbers follow **major.significant.minor** (three numbers,
dot-separated — e.g. `2.0.23`), with an optional pre-release tag appended
after a hyphen when the build isn't a stable release — e.g. `2.0.23-beta`.
Put together, the full on-screen version reads **v2.0.23-beta**.

- **major** — a rewrite-level change: the app's core architecture, data
  model, or shape changes enough that it's really a new generation of the
  app rather than an update to the current one. Bumped rarely.
- **significant** — a real feature lands: something a user would notice
  and describe as "the app can now do X" (Playlists and Favorites, for
  instance, were what bumped this app to `2.0`). Resets `minor` to `0`.
- **minor** — everything else that ships: bug fixes, polish, small
  behavior changes, copy/wording tweaks — the number that moves on
  ordinary day-to-day updates. This is what `SONGBOOK_VERSION_NUMBER`'s
  comment means by "every release that ships changed files."
- **pre-release tag** (optional, after the hyphen) — where the build sits
  on the way to a stable release, oldest to newest:
  - `alpha` — early, unstable, still actively taking shape; expect things
    to be missing or broken.
  - `beta` — feature-complete for that version and generally stable, but
    still being tested and polished before it's considered done.
  - `rc` (release candidate) — believed ready; final verification pass
    before dropping the tag entirely for a stable release. If nothing
    turns up, this exact build ships as the stable release.
  - *(no tag)* — stable. This is what a version number with nothing after
    it means: not "untested," but "past all of the above."

Set via `SONGBOOK_VERSION_PRERELEASE` in `version.js` (e.g. `'beta'`, `'rc'`,
or `''` for stable) — just the stage name, with **no trailing build
number**. Earlier versions of this app used a `beta.1` / `beta.2` / `beta.3`
… counter so a re-cut of the same pre-release stage could still change
`CACHE_VERSION` (and so still reach devices) without moving
`SONGBOOK_VERSION_NUMBER` itself. That's no longer how this works: **every**
release that ships changed files bumps `SONGBOOK_VERSION_NUMBER`'s patch
digit, including what would previously have just been a same-stage re-cut —
`3.0.3-beta` is followed by `3.0.4-beta`, then `3.0.5-beta`, and so on, never
by `3.0.3-beta.2`. This keeps the on-screen version and the cache tag
identical (previously the label hid the build number, e.g. both `beta.1`
and `beta.2` displayed as just `-beta`), so the number a user can see and
report is always the exact build they're running.

### Updating the app later

Bump `SONGBOOK_VERSION_NUMBER` at the top of `version.js` whenever you ship
changed files. That's the **only** place a version number needs to be
edited — everything else derives from it automatically. This now includes
what used to be "just a beta re-cut": there's no more `beta.1` → `beta.2`
counter to bump instead, so even a same-stage re-release moves the patch
digit (`3.0.3-beta` → `3.0.4-beta`). Update `SONGBOOK_VERSION_PRERELEASE`
in the same file too (e.g. `'beta'`, or `''` for a stable release) only
when the pre-release *stage* itself changes.

#### Why the version number matters — and why it's a single source of truth

This app is offline-first: the service worker caches the app shell
aggressively so it keeps working with no connection. That means an
installed device will happily keep serving old, stale files **forever**
unless something tells it a new version exists.

Two things depend on the version number, for different reasons:

- **`CACHE_VERSION`** (used in `service-worker.js`) is the cache-busting
  signal — changing its string is literally what causes
  `caches.open(CACHE_VERSION)` to open a *new* cache bucket, which makes
  the old one eligible for deletion and forces the browser to re-fetch
  every file. Ship changed files without bumping this and users can be
  stuck on the old version indefinitely, even after a hard refresh.
- **`APP_VERSION`** (used in `js/app.js`) is what's shown to the user on
  the About/Settings page (across every language file, via
  `versionSub(v)`), and it also drives the hard-update backstop — the code
  that detects a version mismatch on load and force-wipes the service
  worker + cache as a last resort, in case the normal `CACHE_VERSION`
  update path doesn't fire for some reason.

Historically these lived as separate hardcoded literals in `README.md`,
`js/app.js`, and `service-worker.js`, which meant they could quietly drift
out of sync with each other — the number shown on a user's screen wasn't
necessarily the version of code/cache they were actually running, which
makes bug reports hard to trust.

That's what `version.js` fixes: it's the one file with an actual number in
it (`SONGBOOK_VERSION_NUMBER`), and everything else is derived from that:

- `js/app.js` reads `window.SONGBOOK_APP_VERSION` (`APP_VERSION` is just
  set to that on load) instead of hardcoding its own string.
- `service-worker.js` can't use `<script>` tags — it's a worker, not a
  page — so it pulls in the same file with
  `importScripts('./version.js')`, and reads
  `self.SONGBOOK_CACHE_VERSION` from it.
- The title heading at the top of this README is the one thing that isn't
  wired up automatically (a static Markdown file can't run JS), so update
  it by hand to match `version.js` when you bump the version — it's just
  documentation, not something any code reads.

Because `version.js` is itself listed in `CORE_SHELL` in
`service-worker.js`, it's cached and available offline like the rest of
the app shell.

## Installing the app (PWA)

- **Android / Desktop Chrome, Edge:** open the site (over HTTPS), go to
  **Settings → Install app**, or use the browser's own install icon in the
  address bar. The button only appears once the browser decides the site is
  installable — that can take a moment after the page first loads.
- **iOS Safari:** Safari doesn't support the automatic install prompt, so the
  Install button opens a hint instead — tap the **Share** icon, then
  **Add to Home Screen**.
- Once installed, the Settings page shows an "Installed" badge instead of
  the button.
- **If Install still doesn't appear on a real HTTPS deployment:** check the
  browser console for a service worker registration error, and confirm
  `manifest.json` and both icon files are reachable at their exact paths —
  those are the two most common installability blockers.

## Offline screen

`offline.html` is a small, self-contained fallback page (no dependency on
`css/style.css`, fonts, or `js/app.js` — deliberately, since it exists for
the case where something else failed to load) that the service worker shows
instead of the browser's own generic "no internet" page whenever a page
navigation fails with nothing cached to fall back to — the thing that used
to make an installed, offline PWA suddenly look like a broken website. It
reads the same `sb-theme` / `sb-accent` / `sb-ui-lang` values from
`localStorage` that the main app saves, so it matches light/dark mode,
accent color, and language without needing its own settings. It's part of
`CORE_SHELL` in `service-worker.js`, so it's always cached alongside the
rest of the required app shell.

Settings → **Reload app** also checks `navigator.onLine` before doing
anything: while offline, it skips clearing the cache/service worker (there's
nothing to safely replace them with without a connection) and just reloads
normally instead, so the still-cached app keeps working rather than
reloading into a blank/broken page.

## Built for what's next

Versions 1 and 2 only ever showed official songs and playlists, but the
underlying code was deliberately generalized ahead of time so User Songs
(v3, now built) could be added without reworking existing code — and the
same is true again now, for Sheet Music next:

- **Song data (`state.sources`)** — songs live under `state.sources.official`,
  `state.sources.english`, and now `state.sources.user`, not a single flat
  list. `renderSongList()`, `matchesQuery()`, `sortSongs()`, and
  `openSong()` all take a source key as a parameter rather than assuming
  `official` is the only source — User Songs added a fourth source without
  changing any of their signatures.
- **Pages (`PAGES` registry in `js/app.js`)** — `showPage()` and `bindNav()`
  read every page's element id, which nav button lights up for it, and
  whether it hides the bottom bar from one `PAGES` object, instead of
  hardcoded if/else branches. Adding `user-songs` and `song-editor` meant
  adding two `PAGES` entries, two `<main id="…">` blocks, and one
  `<button data-nav="…">` — not touching the routing logic itself.
- **Offline backup (`SONGDB_STORES` in `js/app.js`)** — the IndexedDB backup
  had a `user-songs` object store reserved since v1 specifically for this;
  User Songs writes to it directly (see "What's new in this version"
  above), so turning it on needed no IndexedDB version bump/migration.
- **Bottom nav (`.bottom-nav-inner` in `css/style.css`)** — the nav buttons
  are laid out with `flex: 1 1 0` + `space-evenly` inside a width-capped
  inner wrapper, so it distributed cleanly with the new 4th (User Songs)
  button — no gap/width retuning needed, and there's still room for a 5th
  once Sheet Music arrives.
- **Chord/lyric rendering (`renderLyrics()` in `js/app.js`)** — takes a
  `containerId`/`song`/`transpose` override (defaulting to the real
  song-view page/`state.activeSong`/`state.transpose`), so the Song
  Editor's live preview renders draft, unsaved lyrics through the exact
  same engine a saved song uses, into its own container, instead of a
  second implementation.

A few things this does *not* pre-build, on purpose (per the plan's "avoid
unnecessary complexity early"): the Song Editor has no dedicated chord-entry
UI (chip picker, fretboard, etc.) — it's a plain textarea using the same
`[Am]` notation the song data itself uses, since that's also exactly what
someone would need to already know to read "Editing the song list," below.
The editor still has no Sheet Music attachment control. User Songs do support
manual import/export and editable labels; see the current backup format above.
