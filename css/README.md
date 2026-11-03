# Editing NGWorship CSS

The app still loads css/style.css. It imports these files in their existing cascade order; there is no build step. The split preserves every selector, declaration, media query and rule order from 5.0.51. Some features have later shared overrides, so search all CSS files for a selector before changing it.

| File | What to edit |
|---|---|
| 00-foundation.css | Fonts, design tokens, light/dark themes, accent palettes. |
| 01-shell.css | Splash, global resets, page layout/transitions, seasonal decorations. |
| 02-songbook.css | Song search/list/sort, list layouts, empty states, fast scroll. |
| 03-song-view.css | Song header, immersive display, transpose/font/shared segmented controls. |
| 04-lyrics.css | Lyric lines, chord placement, reading preferences. |
| 05-settings.css | Settings cards, About, shared form controls and editor. |
| 06-navigation-feedback.css | Navigation, rare announcement strip/dialog, landscape mode, toast, focus/motion and press feedback. |
| 07-playlists-menus.css | Playlists, shared header actions and dropdown menus. |
| 08-trash-modals.css | Trash, shared dialogs/pickers, touch hit areas. |
| 09-chord-finder.css | Interactive guitar finder and its display mode. |
| 10-chord-dialogs.css | Chord popup, finder options/search and voicing navigation. |
| 11-piano.css | Piano keyboard/diagrams, instrument switch, shared dark pill overrides. |
| 12-sheet-music.css | Sheet music library and viewer. |
| 13-final-overrides.css | Late touch, note-label and empty-label overrides. Keep these last. |
| 14-presentation.css | Presentation mode overlay (always dark; scoped to `.pres-*`, so it does not depend on cascade order). |

## Safe changes

1. Find the relevant feature file using this table and search its selectors across css/.
2. Keep the numeric file order. Later rules can deliberately override earlier ones. Do not sort selectors or remove repeated declarations without checking both themes and responsive layouts.
3. Put shared colors, spacing and font tokens in 00-foundation.css. Font URLs stay relative to css/, so all feature files remain directly in this directory.
4. Add any new file to style.css and REQUIRED_OFFLINE in service-worker.js. A missing imported stylesheet must fail installation instead of producing a partly styled offline app.
5. Bump version.js for a shipped change. Run tools/test_*.js, then check the affected screens online and offline.

## Comments

Keep comments that explain why a rule exists, which JavaScript state controls it, browser quirks, accessibility, and intentional overrides. Prefer current behavior over change history. This cleanup deliberately keeps those notes and leaves unused-looking rules alone until their behavior is verified.
