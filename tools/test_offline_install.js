/* Execute the real service-worker.js inside a small CacheStorage/fetch simulation.
   This is not a browser DOM test; it validates install/activate/fetch behavior with
   the network physically disabled after a successful install. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');
const ORIGIN = 'https://offline-test.invalid';
const SCOPE = `${ORIGIN}/app/`;
let networkOnline = true;
let blockOptionalNetwork = false;
let failPath = '';
let skipped = false;

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
  if (failPath && u.pathname.endsWith(failPath)) return new Response('failed', {status:503});
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
contextObject.skipWaiting = async () => { skipped = true; };
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


(async()=>{
 const expected=new Map();
 // Resolve every existing database's actual loader format, not a fixed song count.
 for(const folder of fs.readdirSync(path.join(ROOT,'data'))){
  const manifest=path.join(ROOT,'data',folder,'manifest.json');if(!fs.existsSync(manifest))continue;
  const files=JSON.parse(fs.readFileSync(manifest));const bundle=path.join(ROOT,'data',folder,'database.json');
  if(fs.existsSync(bundle))expected.set(`data/${folder}/database.json`,fs.readFileSync(bundle));
  else for(const file of ['manifest.json',...files])expected.set(`data/${folder}/${file}`,fs.readFileSync(path.join(ROOT,'data',folder,file)));
 }
 const prior='songbook-previous-working';const previous=await caches.open(prior);await previous.put('index.html',new Response('previous working app'));
 // Failed new install must reject before skipWaiting and leave old cache intact.
 failPath=[...expected.keys()].at(-1);const bad=eventWithWait();listeners.install(bad.event);
 await assert.rejects(bad.wait());assert(!skipped);assert.equal(await (await previous.match('index.html')).text(),'previous working app');
 failPath='';blockOptionalNetwork=true;
 const good=eventWithWait();listeners.install(good.event);await good.wait();assert(skipped);
 const version=vm.runInContext('CACHE_VERSION',context);assert(version!==prior);
 const activate=eventWithWait();listeners.activate(activate.event);await activate.wait();assert(context.__claimed);assert(!cacheBuckets.has(prior));
 networkOnline=false;
 for(const [file,bytes] of expected){const r=await dispatchFetch(makeRequest(file+'?v=test'));assert(r.ok,file);assert.equal(await r.text(),bytes.toString(),file+' changed/missing offline');}
 for(const file of ['index.html','offline.html','js/app.js','css/style.css','icons/app-icon-192.png','icons/app-icon-maskable.png','icons/svg/search.svg'])assert.equal((await dispatchFetch(makeRequest(file))).status,200,file);
 const nav=await dispatchFetch(makeRequest('arbitrary?offline=1',{mode:'navigate',destination:'document'}));assert((await nav.text()).includes('<html'));
 const audio=fs.readdirSync(path.join(ROOT,'audio')).find(f=>f.endsWith('.mp3'));
 const part=await dispatchFetch(makeRequest('audio/'+audio,{headers:{Range:'bytes=10-19'}}));assert.equal(part.status,206);assert.equal((await part.arrayBuffer()).byteLength,10);
 const suffix=await dispatchFetch(makeRequest('audio/'+audio,{headers:{Range:'bytes=-12'}}));assert.equal(suffix.status,206);assert.equal((await suffix.arrayBuffer()).byteLength,12);
 const invalid=await dispatchFetch(makeRequest('audio/'+audio,{headers:{Range:'bytes=999999999-'}}));assert.equal(invalid.status,416);
 const refresh=await dispatchFetch(makeRequest([...expected.keys()][0],{headers:{'X-Force-Refresh':'1'}}));assert(refresh.ok,'offline explicit refresh loses installed data');
 const cache=await caches.open(version);await cache.delete('./');await cache.delete('./index.html');
 assert((await (await dispatchFetch(makeRequest('fallback',{mode:'navigate'}))).text()).includes("You're offline"));
 assert(!/\.unregister\(|caches\.delete\(/.test(fs.readFileSync(path.join(ROOT,'js/app.js'),'utf8')),'page update path destroys offline install');
 console.log(path.basename(ROOT)+': failed download retains old install; complete install then immediate offline; '+expected.size+' database files byte-exact; cached audio ranges; fallback; non-destructive page updates PASS');
})().catch(e=>{console.error(e);process.exit(1)});
