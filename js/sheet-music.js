// ============================================================================
// Sheet Music catalog — data-only registry for the WIP/future sheet-music
// feature. UI lives in app.js; adding songs/pages later only requires editing
// data/sheet-music/catalog.js and adding/referencing page image assets.
// ============================================================================
(function () {
  'use strict';

  const SUPPORTED_SCHEMA_VERSION = 1;
  let catalog = null;

  function asText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function validatePage(page, entryId, index) {
    if (!page || typeof page !== 'object') {
      throw new Error(`Sheet Music: ${entryId} page ${index + 1} is invalid`);
    }
    const src = asText(page.src);
    if (!src) throw new Error(`Sheet Music: ${entryId} page ${index + 1} has no src`);
    // Data is app-owned, but still reject executable/unknown URL schemes so a
    // future catalog typo cannot silently turn an image field into arbitrary
    // navigation/content. Relative assets plus http(s) are all the viewer needs.
    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(src);
    if (src.startsWith('//') || (hasScheme && !/^https?:/i.test(src))) {
      throw new Error(`Sheet Music: ${entryId} page ${index + 1} has unsupported src scheme`);
    }
    return Object.freeze({
      src,
      type: asText(page.type) || 'image',
      label: asText(page.label),
    });
  }

  function validateAttribution(item, entryId, index) {
    if (!item || typeof item !== 'object') {
      throw new Error(`Sheet Music: ${entryId} attribution ${index + 1} is invalid`);
    }
    const label = asText(item.label);
    const url = asText(item.url);
    if (!label || !url) {
      throw new Error(`Sheet Music: ${entryId} attribution ${index + 1} needs label + url`);
    }
    return Object.freeze({
      label,
      url,
      license: asText(item.license),
      licenseUrl: asText(item.licenseUrl),
    });
  }

  function normalizeManifest(raw) {
    if (!raw || raw.schemaVersion !== SUPPORTED_SCHEMA_VERSION || !Array.isArray(raw.entries)) {
      throw new Error(`Sheet Music: unsupported or malformed catalog schema`);
    }
    const ids = new Set();
    const songRefs = new Set();
    const entries = raw.entries.map((entry, index) => {
      if (!entry || typeof entry !== 'object') throw new Error(`Sheet Music: entry ${index + 1} is invalid`);
      const id = asText(entry.id);
      const sourceKey = asText(entry.sourceKey);
      const songId = asText(entry.songId);
      if (!id || !sourceKey || !songId) throw new Error(`Sheet Music: entry ${index + 1} needs id/sourceKey/songId`);
      if (ids.has(id)) throw new Error(`Sheet Music: duplicate entry id ${id}`);
      ids.add(id);
      const ref = `${sourceKey}:${songId}`;
      if (songRefs.has(ref)) throw new Error(`Sheet Music: duplicate song reference ${ref}`);
      songRefs.add(ref);
      if (!Array.isArray(entry.pages) || entry.pages.length === 0) {
        throw new Error(`Sheet Music: ${id} has no pages`);
      }
      return Object.freeze({
        id,
        sourceKey,
        songId,
        demo: entry.demo === true,
        pages: Object.freeze(entry.pages.map((page, i) => validatePage(page, id, i))),
        attributions: Object.freeze(Array.isArray(entry.attributions)
          ? entry.attributions.map((item, i) => validateAttribution(item, id, i))
          : []),
      });
    });
    return Object.freeze({ schemaVersion: raw.schemaVersion, entries: Object.freeze(entries) });
  }

  async function load() {
    if (catalog) return catalog;
    const raw = window.NGW_SHEET_MUSIC_CATALOG;
    if (!raw) throw new Error('Sheet Music: catalog data is unavailable');
    catalog = normalizeManifest(raw);
    return catalog;
  }

  function list(sourceKey) {
    return catalog ? catalog.entries.filter((entry) => entry.sourceKey === sourceKey) : [];
  }

  function getForSong(sourceKey, songId) {
    if (!catalog) return null;
    return catalog.entries.find((entry) => entry.sourceKey === sourceKey && entry.songId === songId) || null;
  }

  function getById(id) {
    if (!catalog) return null;
    return catalog.entries.find((entry) => entry.id === id) || null;
  }

  window.SheetMusicCatalog = Object.freeze({
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    load,
    list,
    getForSong,
    getById,
    isLoaded: () => !!catalog,
  });
})();
