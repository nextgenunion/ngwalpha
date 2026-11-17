# Splash restoration — compact original artwork

This update restores the **v4.1.1 splash appearance and motion** in all maintained NGWorship releases, using the user-provided 960×540 transparent WebP source (about 32 KB, versus the old 1920×1080 PNG at about 236 KB).

- Original 120px logo-image footprint, with the same transparent padding as the old image; not the enlarged, tightly cropped 561×317 asset.
- 1-second gentle pop-in (`scale(.92)` to 1) and 1.1-second fade + slight shrink on exit.
- 900ms minimum on-screen duration for the older versions, unchanged; v5 now also begins hiding after window load rather than waiting unnecessarily for every database to load, with its existing 3.5-second fail-safe still present.
- Black backdrop retained so the white NGU artwork remains legible even in light mode. The old `var(--paper)` color could make the white logo vanish against a white background.
- New URL `icons/splash-logo.webp` is precached by each version's worker. The old PNG is no longer referenced or packaged.
- Existing app icons, song data, announcements, and personal-data storage were not changed.

## Check after deployment

With a working installed PWA, publish the entire new release to the same host/scope. Then close and reopen the app after the service-worker update completes. The first launch may use the still-active previous worker; avoid clearing browser storage or reinstalling merely to refresh the splash, since that could erase local user data.

These are source-level updates, not proof of a completed device-level launch animation test. Android/iOS may show a separate OS-level splash before this in-app one.
