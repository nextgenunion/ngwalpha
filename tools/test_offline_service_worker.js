/* Execute the real service-worker.js inside a small CacheStorage/fetch simulation.
   This is not a browser DOM test; it validates install/activate/fetch behavior with
   the network physically disabled after a successful install. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const ORIGIN = 'https://offline-test.invalid';
const SCOPE = `${ORIGIN}/app/`;
let networkOnline = true;
let blockOptionalNetwork = false;

function absolute(input) {
  if (typeof input === 'string') return new URL(input, SCOPE).href;
  if (input instanceof URL) return input.href;
  if (input && input.url) return new URL(input.url, SCOPE).href;
  throw new Error(`Cannot normalize request: ${String(input)}`);
}
function withoutSearch(url) {
  const u = new URL(url); u.search = ''; return u.href;
}
function localFileFor(url) {
  const u = new URL(url);
  if (u.origin !== ORIGIN) return null;
  if (!u.pathname.startsWith('/app/')) return null;
  let rel = decodeURIComponent(u.pathname.slice('/app/'.length));
  if (!rel) rel = 'index.html';
  const p = path.resolve(ROOT, rel);
  if (!p.startsWith(ROOT + path.sep) && p !== ROOT) return null;
  return p;
}

class FakeCache {
  constructor(fetcher) { this.map = new Map(); this.fetcher = fetcher; }
  async put(request, response) { this.map.set(absolute(request), response.clone()); }
  async match(request, opts = {}) {
    const key = absolute(request);
    if (!opts.ignoreSearch) {
      const r = this.map.get(key); return r ? r.clone() : undefined;
    }
    const target = withoutSearch(key);
    for (const [k, r] of this.map) if (withoutSearch(k) === target) return r.clone();
    return undefined;
  }
  async delete(request) { return this.map.delete(absolute(request)); }
  async add(request) {
    const response = await this.fetcher(request);
    if (!response || !response.ok) throw new Error(`cache.add failed for ${absolute(request)}`);
    await this.put(request, response);
  }
  async addAll(requests) {
    // Fetch all before mutating to approximate the atomic success contract that
    // matters to this test: failed core fetches fail installation.
    const fetched = await Promise.all(requests.map(async (r) => [r, await this.fetcher(r)]));
    for (const [r, response] of fetched) {
      if (!response || !response.ok) throw new Error(`cache.addAll failed for ${absolute(r)}`);
    }
    for (const [r, response] of fetched) await this.put(r, response);
  }
}

const cacheBuckets = new Map();
const caches = {
  async open(name) {
    if (!cacheBuckets.has(name)) cacheBuckets.set(name, new FakeCache(networkFetch));
    return cacheBuckets.get(name);
  },
  async keys() { return [...cacheBuckets.keys()]; },
  async delete(name) { return cacheBuckets.delete(name); },
  async match(request, opts) {
    for (const c of cacheBuckets.values()) {
      const r = await c.match(request, opts);
      if (r) return r;
    }
    return undefined;
  },
};

async function networkFetch(request) {
  const url = absolute(request);
  const u = new URL(url);
  if (!networkOnline) throw new TypeError(`offline: ${url}`);
  if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') {
    if (blockOptionalNetwork) return new Promise(() => {}); // intentionally never settles
    return new Response('/* optional font css */', { status: 200, headers: { 'content-type': 'text/css' } });
  }
  const local = localFileFor(url);
  if (!local || !fs.existsSync(local) || !fs.statSync(local).isFile()) {
    return new Response('not found', { status: 404 });
  }
  return new Response(fs.readFileSync(local), { status: 200 });
}

const listeners = {};
const contextObject = {
  URL, Response, Request, Headers, Promise, Map, Set, console,
  caches,
  location: new URL(SCOPE),
  fetch: networkFetch,
  setTimeout, clearTimeout,
};
contextObject.self = contextObject;
contextObject.addEventListener = (type, fn) => { listeners[type] = fn; };
contextObject.skipWaiting = async () => {};
contextObject.clients = { claim: async () => { contextObject.__claimed = true; } };
let context;
contextObject.importScripts = (...urls) => {
  for (const url of urls) {
    const p = path.resolve(ROOT, url.replace(/^\.\//, ''));
    vm.runInContext(fs.readFileSync(p, 'utf8'), context, { filename: p });
  }
};
context = vm.createContext(contextObject);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'service-worker.js'), 'utf8'), context, { filename: 'service-worker.js' });

function eventWithWait() {
  let promise = Promise.resolve();
  return {
    event: { waitUntil(p) { promise = Promise.resolve(p); } },
    wait: () => promise,
  };
}
function makeRequest(rel, { mode = 'cors', destination = '', headers = {} } = {}) {
  const h = new Headers(headers);
  return { url: absolute(rel), method: 'GET', mode, destination, headers: h };
}
async function dispatchFetch(request) {
  let responsePromise;
  listeners.fetch({ request, respondWith(value) { responsePromise = Promise.resolve(value); } });
  assert.ok(responsePromise, `No respondWith for ${request.url}`);
  return await responsePromise;
}
function text(response) { assert.ok(response, 'missing response'); return response.clone().text(); }

(async () => {
  assert.ok(listeners.install && listeners.activate && listeners.fetch, 'SW listeners did not register');

  // Successful online install must atomically cache the whole application,
  // including ALL shipped database snapshots. No database is opened first.
  const ins = eventWithWait();
  listeners.install(ins.event);
  await ins.wait();
  const version = context.SONGBOOK_CACHE_VERSION;
  assert.ok(cacheBuckets.has(version), 'Versioned atomic cache missing after install');

  const act = eventWithWait();
  listeners.activate(act.event);
  await act.wait();
  assert.strictEqual(context.__claimed, true, 'worker did not claim clients');

  // Cut the network completely immediately after install.
  networkOnline = false;

  const nav = await dispatchFetch(makeRequest('./', { mode: 'navigate', destination: 'document' }));
  assert.ok((await text(nav)).includes('<title>NGWorship Alpha / Дууны ном</title>'), 'offline navigation did not return installed app');

  for (const asset of ['css/style.css','js/app.js','js/piano-chords.js','lang/mn.js','icons/svg/search.svg']) {
    const r = await dispatchFetch(makeRequest(asset));
    assert.strictEqual(r.status, 200, `offline required asset failed: ${asset}`);
  }

  // Every shipped database must work offline even though none was requested
  // before the network was cut. Query-string versions must resolve too.
  for (const db of [
    'data/english/database.json',
    'data/hymn/database.json',
    'data/mongolian/database.json',
    'data/mongolian2/database.json',
  ]) {
    const r = await dispatchFetch(makeRequest(`${db}?v=9.9.9`));
    assert.strictEqual(r.status, 200, `offline database failed: ${db}`);
    const payload = JSON.parse(await text(r));
    assert.ok(Array.isArray(payload.songs || payload), `offline database malformed: ${db}`);
  }

  const sheet = await dispatchFetch(makeRequest('data/sheet-music/assets/sda/h108-amazing-grace.svg'));
  assert.strictEqual(sheet.status, 200, 'offline Sheet Music proof page failed');
  assert.ok((await text(sheet)).includes('<svg'), 'Sheet Music proof page is not SVG');

  // Rare failure path: if index entries disappear but offline.html survives,
  // navigation must return the custom fallback rather than broken app markup.
  const cache = await caches.open(version);
  await cache.delete('./index.html');
  await cache.delete('./');
  const fallback = await dispatchFetch(makeRequest('./anything', { mode: 'navigate', destination: 'document' }));
  assert.ok((await text(fallback)).includes("You're offline"), 'custom offline fallback was not served');

  console.log('Offline SW simulation passed: atomic install -> immediate hard offline -> full shell + all 4 databases + Sheet Music -> offline.html fallback.');
})().catch((err) => { console.error(err); process.exit(1); });
