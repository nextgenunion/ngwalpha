# Wrapping NGWorship as a native app

NGWorship is a plain static site (no build step). The same files run as a
website, as an installed PWA, and inside a native wrapper such as Capacitor.
`js/platform.js` is the only place that knows which one it is running in, so
the three behave the same except where a wrapper genuinely needs something
different.

**Status:** the code side is done and tested in a desktop browser with
simulated wrappers (`tools/verify_platform_browser.cjs`). It has **not** been
run on a real phone inside a wrapper yet — use the checklist at the bottom.

## What the app does in each mode

| | Website | Installed PWA | Native wrapper |
|---|---|---|---|
| `<html data-platform>` | `web` | `pwa` | `native` |
| Backup export (songs, playlists) | download link | download link | share sheet (Capacitor Filesystem + Share, or your bridge) |
| Links that open a new tab | new tab | new tab | system browser (Capacitor Browser, or your bridge) |
| "Install app" row in Settings | shown | hidden | hidden |
| Long-press text selection on UI text | normal | normal | off (inputs, textareas and the feedback email stay selectable) |
| "Discard unsaved changes?" | the app's own dialog | the same | the same |

If a native plugin is missing or fails, backup export falls back to the
download link, so a backup is never silently lost.

## Using Capacitor (no bundler needed)

1. `npm init -y`, then
   `npm i @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios @capacitor/app @capacitor/filesystem @capacitor/share @capacitor/browser @capacitor/status-bar`
2. `npx cap init` (choose your own app id), with `webDir` set to a `www/` folder.
3. Copy the contents of this project into `www/` (there is nothing to build).
4. In `capacitor.config.json` set `"server": { "androidScheme": "https" }` so
   localStorage and IndexedDB keep one stable origin on Android.
5. `npx cap add android`, `npx cap add ios`, then `npx cap sync` after every copy.

Capacitor injects `window.Capacitor` before the app scripts run, and
`platform.js` finds the Filesystem, Share and Browser plugins through
`Capacitor.Plugins`. No app code needs to change.

## Using another wrapper

Define `window.NGWorshipNative` before the app scripts load:

```js
window.NGWorshipNative = {
  saveFile: async ({ filename, text, mime }) => { /* write + share the file */ },
  openExternal: (url) => { /* open in the system browser */ },
};
```

Either function may be left out; the app falls back to web behaviour for it.
Throw an error containing "cancel" if the person closes the save/share sheet,
so no "exported" toast is shown.

## Not handled by app code (set in the wrapper)

- Status bar and safe areas: the app already uses `viewport-fit=cover` and
  `env(safe-area-inset-*)`; make the status bar overlay the web view.
- Native splash screen colours: match `#F3F3F1` (light) and `#1F2A44` (dark).
- Service worker: harmless but unnecessary when the files are bundled.
  It may not register on iOS (custom scheme); the app guards against that.
- Language and Presentation colour pickers use the app's dialogs. File
  selection uses the operating system's picker.

## Real-device checklist

- [ ] Export songs and playlists: share sheet appears, file can be saved, cancelling shows no toast.
- [ ] Import backups from the Files app.
- [ ] Social, credit and song links open in the system browser; "Send feedback" opens the mail app.
- [ ] Android Back button and iOS edge-swipe go back through pages, and out of the song editor ask before discarding.
- [ ] Keyboard does not cover the editor fields; no zoom when focusing a field.
- [ ] Rotate to landscape: text size stays as designed.
- [ ] Dark mode, safe areas and notch look right.
- [ ] Settings has no "Install app" row.
- [ ] Offline start with airplane mode on.
