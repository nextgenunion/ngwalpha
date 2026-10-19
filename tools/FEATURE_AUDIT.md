# v5.0.38-alpha feature audit

Completed 12 October 2026 against the v5.0.37-alpha delivered archive.

The review covered registry-driven database selection and numbering, source-qualified
song identities, shared asynchronous loads and retries, pending chord gestures,
history restoration, modal lifecycle/focus, and responsive popup and list geometry.
The additional interaction tests reproduced bugs before their fixes; the final
browser suites passed against the corrected app.

| Validation | Final result |
| --- | --- |
| Node regression scripts, `tools/test_*.js` | 26 / 26 passed |
| `verify_multidb_chords_browser.cjs` | 1,603 assertions passed |
| `verify_multidb_adversarial.cjs` | 175 assertions passed; zero failures |
| Uncaught browser errors across both suites | Zero |
| App and chord-viewer JavaScript syntax checks | Passed |
| Original database files compared byte for byte | All 5,641 unchanged |

## Reproduced issues and corrections

1. A deferred chord tap could open over a later menu or lyric action. A different
   pointer target, keyboard action, wheel input or touch-scroll gesture now cancels
   it. Incidental focus/layout scroll events leave a legitimate tap intact.
2. A failed database stayed failed after deselection/reselection. Deliberate
   reselection now retries bootstrap; unrelated checkbox changes do not repeatedly
   retry a retained failure, and in-flight loads remain shared.
3. A native second click delivered after the single-tap timer could dismiss the
   first popup or activate its controls. Native double-click intent is recognized
   at the timer boundary and at the original click position after the popup opens.
4. The compact chord popup clipped instrument/voicing controls in short landscape
   viewports. It now uses the available viewport height and supports body scrolling.
5. Keyboard focus could stay behind an open modal. Opening focuses the card, Tab
   stays inside, Escape closes it, and closing restores an appropriate opener
   without scrolling or focusing a page that navigation has left.
6. Focusing an unseen song row could shrink its estimated height between
   pointerdown and pointerup, making the click miss. Interactive rows now retain
   their actual layout size; obsolete intrinsic-size estimates were removed.
7. Flex styling overrode the chord navigation's hidden state. Unavailable or
   single-voicing charts now hide their unused arrows.

## Browser coverage

- All 15 nonempty combinations of the four shipped databases on phone and desktop,
  in List, Compact and Tiles, with ascending and descending sorting. Number display
  and numeric sorting follow the count of selected numbered registry entries.
- Actual picker mouse/touch input, cross-group choices, last-choice protection,
  selection persistence, 403 immediate synthetic toggles and 50 actual touch toggles.
- Future numbered/unnumbered sources, sparse numbers, a new picker group, and three
  databases sharing the same song ID; label and Favorites/playlist identities remain
  source-qualified. The future fixture also checks a direct far-down short-row click.
- Immediate far-down song activation in a combined 5,631-song list, in all three
  views with both mouse and touch. The final run loaded/rendered that selection in
  about 1.4–1.6 seconds after the last source input on this runner, including the
  bundle request and storage. Timing depends on the device; rows are fully laid out
  to keep hit targets stable.
- Temporary HTTP failures and recovery, retained partial results, blocked IndexedDB,
  delayed/out-of-order responses, and actual navigation/selection changes while an
  English bundle response is held.
- Single tap, double tap/click, interrupted gestures, repeated gestures, keyboard
  activation, and native double-click delays of 30, 150, 280, 350 and 450 ms.
- Song → Chord Finder → Back/Forward, displayed chord names, guitar/piano and chosen
  voicings. A real SDA English song containing Am7 is transposed to Bm7; returning
  preserves its song, source, transposition, exact scroll position and Bm7 popup.
- Light/dark screenshots at 320×568, 390×844, 844×390 and 1440×900. Geometry checks
  verify toolbar alignment, overflow, popup bounds and individual instrument/voicing
  controls. Representative screenshots were also inspected visually.
- Real service-worker caching, unopened databases, combined selections and reload,
  then chord navigation and popup restoration with the browser offline.

Tests ran in Google Chrome for Testing 155.0.8059.39 (Linux headless shell), using
real browser mouse events and touch/mobile emulation. Physical iOS/Android devices
and other browser engines were not exercised.

## Reproduce

Run from the app root with Node and Playwright available. The browser scripts start
their own local HTTP servers (ports 8876 and 8877). Set `CHROMIUM_EXECUTABLE` if the
default Playwright Chromium is unavailable; `QA_DIR` can point outside the app tree
for screenshots and audit results.

```sh
for test in tools/test_*.js; do
  node "$test" || exit 1
done
node --check js/app.js
node --check js/chord-viewer.js
node tools/verify_multidb_chords_browser.cjs
node tools/verify_multidb_adversarial.cjs
```

Targeted runs support `ONLY_FUTURE=1` or `ONLY_LAYOUT=1` on the first browser script,
and `AUDIT_CASE=interrupt|retry|storage|picker|keyboard|rows|loading|timing|empty|visual`
(one value at a time) on the adversarial script. `TRACE_FUTURE=1` captures pointer
targets and row geometry for diagnosing the formerly missed click.
