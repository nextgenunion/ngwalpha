# Announcements

Edit `announcements.json` in the project root. The shipped file contains `[]`,
so nothing appears. An absent file also shows nothing. Deploy the file to the
same folder as index.html. It is fetched at launch, every five minutes while
the app is visible, and on returning when the last check is at least five
minutes old. Reconnecting to the internet triggers a new check.

## Easy way (no coding)

Open `announcement-maker.html` (double-click it; it works offline). Pick an
example or write a title and message, choose Pop-up or Strip, choose One time or
Every open, and press **Add**. Optional dates and other languages are tucked
away. Press **Download file** and upload the new `announcements.json` next to
`index.html`, replacing the old one. Use "I already have an announcements.json"
to keep earlier notices. The page makes the IDs and date formats for you. It
only builds the file; publishing still means uploading it (there is no server).
The page is not part of the app and is not cached for offline use; it is safe to
leave out of the live site.

Ordinary announcements use the app's existing small dialog. Several messages
share one dialog and one Done button. It waits until the launch splash is gone
and Songbook is visible, and does not replace another open dialog.

Only exceptional notices should use `"display": "banner"`. This is a quiet,
dismissible strip integrated above the bottom navigation buttons. It stays on
main tabs and hides wherever the navigation hides: songs, editor, Chord Finder,
and other full-screen views. Page padding reserves space for it; it does not
cover list rows or navigation buttons. Keep banner text short.

There is no admin screen, push notification or extra announcement page.
Periodic network checks never block the Songbook, and each request is cancelled
after five seconds if the network does not respond.
Returning between pages does not repeat a dismissed notice.

```json
[
  {
    "id": "new-feature-2026-12",
    "mode": "once",
    "title": "What's new",
    "text": "You can now choose how note names appear in Chord Finder."
  },
  {
    "id": "maintenance-2026-12-10",
    "mode": "every-open",
    "display": "banner",
    "title": "Scheduled maintenance",
    "text": "Online updates will be unavailable on December 10, 20:00–21:00. Your downloaded songbook will still work offline.",
    "startsAt": "2026-12-09T00:00:00+08:00",
    "endsAt": "2026-12-10T21:00:00+08:00"
  }
]
```

The dates and messages above are examples, not active scheduled maintenance.

- `id` and `mode` are required. Provide either plain `text` or a `translations` object with at least one nonempty translated `text`. Give every notice a unique, stable ID.
- `display` is optional: omitted or `"dialog"` is an ordinary announcement.
  Use `"banner"` only for a genuinely important notice. Presentation and
  repetition are independent: either presentation supports either mode.
- `once`: remembered as seen when displayed. It remains until dismissed during
  that launch, but does not show on later launches.
  Use a new ID when you want to announce a new version of a message.
- `every-open`: shown once per fresh launch/reload, even if previously dismissed
  on a previous launch. It does not repeat every five minutes. Dismissal
  lasts for that launch; switching pages does not reset it.
- `title` is optional. Both title and text are plain text, not HTML.
  Use `translations` for language-specific content as described below.
- `startsAt` and `endsAt` are optional ISO timestamps with a timezone. Omit them
  for an immediate notice without an expiry. Invalid dates hide that entry.
  Dates use the device clock and are checked when a notice is rendered.
- Set the file to `[]` or remove it to hide current banners on the next successful
  refresh. A dialog already being read stays open until the user dismisses it.

## Offline behavior

Announcements are optional online content. They are not cached by the service
worker or required for installation. Offline, missing, or malformed content
shows no dialog or banner. This prevents an old maintenance notice surviving after the
file is removed. All normal offline songbook features remain independent.

One-time memory uses localStorage on that browser/device. Clearing app storage
can make a once notice appear again. If storage is unavailable it still works
for the current launch, but cannot remember a notice across launches.

## Song editor

The editor compares its current fields and labels with the values when it was
opened. Back/Close and in-app navigation ask before discarding actual changes.
Cancel keeps the edits and the current history entry. Untouched forms and forms
whose edits were reverted do not prompt. Successful saves and confirmed deletes
leave normally. Reload/closing uses the browser's standard unsaved-change warning
where supported. There is no autosave or claim to recover work after an OS kill.

## Developer previews

Unlock Developer options by tapping the app icon on the About page three times.
Open Settings → Developer options → Announcement previews.

- Preview dialog opens a sample in the real announcement dialog. Close it with
  Done, the close button, or Escape. You can repeat it as often as needed.
- Preview banner takes you to Songbook with a sample strip in navigation. It
  follows the same layout/hiding rules as a real banner. Close the strip to end
  the preview. It also ends automatically on reload.

Both work offline and when announcements.json is missing. Samples are clearly
labelled Preview and never publish content, overwrite the JSON, reset real seen
IDs, or dismiss real notices. Real notice display is temporarily suspended while
previewing the banner. Normal notices resume on subsequent navigation/reload.

## Language-specific announcements

Each announcement may contain `translations` using the same language keys as
NGWorship's interface: `mn` (Mongolian Cyrillic), `en` (English), `kr`
(Korean), and `mn2` (Traditional Mongolian, experimental).

```json
[
  {
    "id": "feature-2026-11",
    "mode": "once",
    "display": "dialog",
    "translations": {
      "en": { "title": "What's new", "text": "The songbook has been updated." },
      "mn": { "title": "Шинэ зүйл", "text": "Дууны ном шинэчлэгдлээ." },
      "kr": { "title": "새 소식", "text": "찬송가 앱이 업데이트되었습니다." }
    }
  }
]
```

Language choice follows the current **app interface language**, not the
phone's language. If that translation is missing, NGWorship uses `en` if
available; otherwise an existing plain `text`/`title` entry; otherwise the
only (or first available) translation. Both translated and older single-
language announcement entries can coexist in the same `announcements.json`.

You can also publish an announcement in only one language:

```json
[
  {
    "id": "mongolian-only",
    "mode": "once",
    "translations": { "mn": { "title": "Мэдээлэл", "text": "Шинэ мэдэгдэл." } }
  }
]
```

Every user will see the available Mongolian text in that example, even if
their app is set to English. Changing languages updates a visible banner
without fetching the JSON again. Each announcement's `id` is shared across
all languages: a `once` notice is remembered as one notice regardless of
which translation the user saw. To publish a *new* notice, give it a new ID.

These are optional online messages. Announcements still refresh every five
minutes while visible and never block, install with, or cache alongside the
offline songbook.
