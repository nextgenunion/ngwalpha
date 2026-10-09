// Sheet Music catalog data. Data only; UI/validation live in js/sheet-music.js.
// Future scores are added here without changing routing/viewer code.
// Proof-of-concept entries deliberately use packaged local assets so the
// feature can be exercised reliably online and offline.
window.NGW_SHEET_MUSIC_CATALOG = {
  "schemaVersion": 1,
  "entries": [
    {
      "id": "sda-h108",
      "sourceKey": "sda",
      "songId": "h108",
      "demo": true,
      "pages": [
        {
          "src": "data/sheet-music/assets/sda/h108-amazing-grace.svg",
          "type": "image/svg+xml",
          "label": "Score"
        }
      ],
      "attributions": [
        {
          "label": "Amazing Grace — transcription based on Brian Ammon's CC0 score, Wikimedia Commons",
          "url": "https://commons.wikimedia.org/wiki/File:AmazingGrace.svg",
          "license": "CC0 1.0",
          "licenseUrl": "https://creativecommons.org/publicdomain/zero/1.0/"
        }
      ]
    }
  ]
};
