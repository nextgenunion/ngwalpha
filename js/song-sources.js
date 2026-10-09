// ============================================================================
// Song source registry — one source of truth for shipped song databases and
// their IndexedDB backing stores.
//
// Keep source metadata here instead of repeating it in app state + database
// picker + IndexedDB config. app.js derives runtime state and storage names
// from this registry.
// ============================================================================
(function () {
  'use strict';

  const databases = Object.freeze({
    official: Object.freeze({
      folder: 'mongolian',
      hasNumbers: true,
      group: 'sda',
      label: 'Монгол (ДАС)',
      store: 'songs',
    }),
    english: Object.freeze({
      folder: 'english',
      hasNumbers: false,
      group: 'all',
      labelKey: 'dbOptionEnglish',
      store: 'english-songs',
      // All imported English songs ship in one offline-ready snapshot.
      bundlePrimary: true,
    }),
    sda: Object.freeze({
      folder: 'hymn',
      hasNumbers: true,
      group: 'sda',
      label: 'English (SDA)',
      store: 'sda-songs',
    }),
    mongolian2: Object.freeze({
      folder: 'mongolian2',
      hasNumbers: false,
      group: 'all',
      label: 'Монгол',
      store: 'mongolian2-songs',
    }),
  });

  const localSources = Object.freeze({
    user: Object.freeze({
      hasNumbers: false,
      store: 'user-songs',
    }),
  });

  const auxiliaryStores = Object.freeze({
    trash: 'user-songs-trash',
  });

  const groupOrder = Object.freeze(['sda', 'all']);
  const groupLabels = Object.freeze({
    sda: 'dbGroupSda',
    all: 'dbGroupAll',
  });

  // IndexedDB schema version. Adding a source whose `store` is new requires
  // incrementing this value, but the store name itself still lives only in
  // this registry.
  const indexedDbVersion = 6;
  const defaultSource = 'official';

  function makeRemoteRuntimeState() {
    return {
      songs: [],
      loadFailed: false,
      loaded: false,
      loadPromise: null,
      syncPromise: null,
      syncAttempted: false,
      syncController: null,
    };
  }

  function makeLocalRuntimeState() {
    return {
      songs: [],
      loadFailed: false,
      loaded: false,
    };
  }

  function createRuntimeSources() {
    const sources = {};
    Object.keys(databases).forEach((key) => {
      sources[key] = makeRemoteRuntimeState();
    });
    Object.keys(localSources).forEach((key) => {
      sources[key] = makeLocalRuntimeState();
    });
    return sources;
  }

  function createStoreMap() {
    const stores = {};
    Object.entries(databases).forEach(([key, source]) => {
      stores[key] = source.store;
    });
    Object.entries(localSources).forEach(([key, source]) => {
      stores[key] = source.store;
    });
    Object.assign(stores, auxiliaryStores);
    return Object.freeze(stores);
  }

  const stores = createStoreMap();

  window.SongSourceRegistry = Object.freeze({
    databases,
    localSources,
    stores,
    groupOrder,
    groupLabels,
    indexedDbVersion,
    defaultSource,
    createRuntimeSources,
  });
})();
