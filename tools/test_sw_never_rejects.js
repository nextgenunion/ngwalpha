/* Service worker hardening (v5.0.46): runs the real service-worker.js in a fake
   worker environment and checks that
   - a navigation is ALWAYS answered (a rejection would show Chrome's own error page),
   - a missing cache is rebuilt once when there is a connection,
   - the installed copy is still preferred when it exists,
   - broken Cache Storage falls back to the network instead of failing. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const code = fs.readFileSync(path.join(__dirname, '..', 'service-worker.js'), 'utf8');
const BASE = 'https://example.test/ngworship/';

function makeWorker({ cacheEntries = {}, cacheOpenFails = false, online = true }) {
  const handlers = {};
  const added = [];
  const store = new Map(Object.entries(cacheEntries));
  const cache = {
    match: async (req) => {
      const key = typeof req === 'string' ? req : req.url;
      for (const [k, v] of store) if (new URL(k, BASE).href === new URL(key, BASE).href) return v;
      return undefined;
    },
    addAll: async (reqs) => { added.push(reqs.length); },
    put: async () => {},
  };
  const fetchCalls = [];
  const sandbox = {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    location: { href: BASE + 'service-worker.js' },
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
    caches: {
      open: async () => { if (cacheOpenFails) throw new Error('Cache Storage broken'); return cache; },
      keys: async () => [],
      delete: async () => true,
    },
    fetch: async (req) => {
      fetchCalls.push(req.url || String(req));
      if (!online) throw new TypeError('Failed to fetch');
      return new Response('<html>live</html>', { status: 200 });
    },
    Request, Response, Headers, URL, Promise, console,
  };
  sandbox.self = sandbox;                                   // like a real worker: self === global
  let context;
  sandbox.importScripts = (...urls) => {
    for (const url of urls) {
      const file = path.resolve(__dirname, '..', url.replace(/^\.\//, ''));
      vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: file });
    }
  };
  context = vm.createContext(sandbox);
  vm.runInContext(code, context);
  const send = (request) => {
    let responded, waited = [];
    const event = {
      request,
      respondWith: (p) => { responded = p; },
      waitUntil: (p) => { waited.push(p); },
    };
    handlers.fetch(event);
    return { responded, waited };
  };
  const navigation = () => send({ method: 'GET', mode: 'navigate', destination: 'document', url: BASE, headers: new Headers() });
  const asset = (u) => send({ method: 'GET', mode: 'cors', destination: 'script', url: BASE + u, headers: new Headers() });
  return { navigation, asset, added, fetchCalls };
}

const html = (body) => new Response(body, { status: 200 });

(async () => {
  // 1. Installed copy exists: served from the cache, no network, no repair.
  {
    const w = makeWorker({ cacheEntries: { './index.html': html('installed app') } });
    const { responded } = w.navigation();
    assert.strictEqual(await (await responded).text(), 'installed app');
    assert.strictEqual(w.fetchCalls.length, 0, 'an installed app must not touch the network');
    assert.strictEqual(w.added.length, 0, 'no repair when nothing is missing');
  }

  // 2. Cache wiped but online: serve the live app AND rebuild the cache once.
  {
    const w = makeWorker({ cacheEntries: {} });
    const a = w.navigation(), b = w.navigation();     // two quick launches
    assert.strictEqual(await (await a.responded).text(), '<html>live</html>', 'must serve the live app, not a bare "Offline" page');
    assert.strictEqual(await (await b.responded).text(), '<html>live</html>');
    await Promise.all([...a.waited, ...b.waited]);
    assert.strictEqual(w.added.length, 1, 'concurrent launches must start only one repair');
    assert.ok(w.added[0] >= 80, `repair must download the whole offline list (got ${w.added[0]})`);
  }

  // 3. Cache wiped and offline: a real page (not a rejection), bilingual.
  {
    const w = makeWorker({ cacheEntries: {}, online: false });
    const res = await w.navigation().responded;
    assert.strictEqual(res.status, 503);
    assert.match(res.headers.get('Content-Type'), /text\/html/);
    const body = await res.text();
    assert.ok(body.includes('Офлайн') && body.includes('Offline'), 'last-resort page must be bilingual');
  }

  // 4. Offline with only offline.html saved: that page is served.
  {
    const w = makeWorker({ cacheEntries: { './offline.html': html('offline page') }, online: false });
    assert.strictEqual(await (await w.navigation().responded).text(), 'offline page');
  }

  // 5. Cache Storage itself throws: navigation still answers, never rejects.
  {
    const w = makeWorker({ cacheOpenFails: true, online: false });
    const res = await w.navigation().responded;           // would throw if it rejected
    assert.strictEqual(res.status, 503);
    const wOnline = makeWorker({ cacheOpenFails: true, online: true });
    assert.ok((await (await wOnline.asset('js/app.js')).responded) !== undefined);
    assert.strictEqual(await (await wOnline.asset('js/app.js').responded).text(), '<html>live</html>', 'broken storage falls back to the network for assets');
  }

  // 6. Sub-resources: cached copy wins, ignoring ?query strings.
  {
    const w = makeWorker({ cacheEntries: { './js/app.js': html('cached script') } });
    assert.strictEqual(await (await w.asset('js/app.js').responded).text(), 'cached script');
  }

  console.log('service worker never rejects / self-repairs: PASS');
})().catch((e) => { console.error(e); process.exit(1); });
