NGWorship — UI and language maintenance release

This maintenance pass addresses: cross-version language wording, removal of blanket
copyright claims over third-party songs, a less intrusive keyboard/modal interaction,
installed-app row visibility (v3 and v4), and relevant song-page improvements.

Slider decision (updated per request):
- v3: original A-/A+ controls ONLY. No slider or slider-dot option.
- v4: text-size sliders ON by default; 10 selectable positions;
  optional faint step markers only from Developer Options.
- v5: existing text-size sliders ON by default; 10 selectable positions;
  optional faint step markers only from Developer Options.
- v2: original text-size controls unchanged.

v5 also restores the earlier splash animation with the current NGU logo,
keeps song-opening animation, improves label editing and chord alternatives,
uses a consistent language row, and hides song labels in Reading Mode.

The source changes were checked for JavaScript syntax. Existing v5 unit/regression
tests passed. Full browser/device testing is still required before public release.
