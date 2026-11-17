# NGWorship v5.1.0 — interaction repair and QA

## Scope

Built from v5.0.99. This patch does not change the NGU splash, uploaded angel icons, 12-stop size sliders, song data, the announcement schema, or offline installation.

## Song opening

- Restores the exact v4.1.1/v4.2.55 `page-slide-in`/`page-slide-out` keyframes and the 320/260 ms timings.
- **Includes `song-view` in `SLIDE_PAGES` again.** Without this, restoring the functions does nothing.
- Removes the substitute v5 web/PWA mini-fade and the Android-only triple-frame delayed slide, so the same CSS transition is used throughout.
- Ignores bubbled child `animationend` events and cancels stale interrupted transitions so the page cannot be hidden prematurely.
- Respects reduced-motion settings. Retains history, scroll restoration, and audio-control repaint after opening.

## Dialogs and keyboard

- Opening a text-entry dialog freezes its original overlay geometry and its vertical origin.
- The layout no longer switches flex alignment/padding when the keyboard rises; it uses one eased CSS `translate`, and moves only as far as needed to fit above the keyboard.
- Tall label dialogs can shrink and scroll internally without re-centering the entire card.
- The input receives focus after the popup's opening animation ends; automatic `scrollIntoView` has been removed.
- Keyboard state is detected from the dialog's pre-keyboard viewport height, including browsers that resize `innerHeight` and `visualViewport` together.
- Dialog geometry is reset when the dialog closes; reduced motion disables this movement animation.

## Additional default setting correction

- `devHideDescriptions: true` is now applied during startup via `applyDevOptions()`, instead of only after the user toggled a Developer Option.

## Testing completed

- 35 `tools/test_*.js` scripts: pass.
- JS parse/syntax checks: pass.
- Isolated Chromium DOM/CSS tests: the v4-style slide visibly opens and closes; both short playlist and taller label dialogs ease upward while the overlay stays stationary.
- ZIP archive integrity checks: pass.

## Manual device QA still required

Actual Android Chrome/PWA and native WebView keyboard behavior was **not** measured here. Before deploying, test:

1. Open a song from Songbook and Playlist; confirm full v4 right-to-left slide (not subtle fade).
2. Back to the list; confirm full reverse slide and original list scroll position.
3. Quickly open/back/open a song; confirm no stale layers or stuck pages.
4. Open Create Playlist and Edit Labels, focus the text field, dismiss and reopen the keyboard; confirm the dialog does not jump or recenter.
5. Repeat on installed PWA and browser (and Android wrapper if available).
6. Check reduced-motion, small screens, and a tall label list.

**Not a claim that every item of the prior 17-request batch has passed device-level QA.** This release targets the two reported interaction regressions plus the confirmed startup-description bug.
