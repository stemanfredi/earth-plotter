// How the page asks other servers for data: no cookies, and no referrer. Workers do not inherit
// the page's <meta name="referrer" content="no-referrer">, so every fetch says it.
const FETCH = { credentials: 'omit', referrerPolicy: 'no-referrer' };

// Saving an offline area (offline.js): a file fetched into the area's cache, by whoever reads it (the
// page, its clipping worker). The copy there first (the page's base tiles, read again by the cut),
// else the network's, put there when it is a file (2xx; one with no body too: OpenFreeMap's answer for a
// tile with nothing in it, which the cut of the land over it reads; a 204 is no tile), stored(bytes,
// url) said of it; the browser's storage full throws (a QuotaExceededError). area: { cache (a Cache,
// or its promise), reload: the addresses asked of the providers themselves (cache 'reload', which
// the service worker takes from no saved area: an area saved again), stored }
export async function fetchInto(area, url, init = {}) {
  const cache = await area.cache, had = await cache.match(url);
  if (had) return had;
  const r = await fetch(url, { ...FETCH, ...init, ...(area.reload.some((h) => url.startsWith(h)) && { cache: 'reload' }) });
  if (!r.ok || r.status === 204) return r;
  const body = await r.blob();
  await cache.put(url, new Response(body, r));
  area.stored(body.size, url);
  return new Response(body, r);
}
// the area every fetch below goes into: set in a clipping worker saving one (clip-worker.js)
let area = null;
export const fetchAllInto = (a) => { area = a; };
// A request that does not end within a minute is given up (an error, so that an lru forgets it and
// the next ask tries again): a provider that hangs, rather than failing, would otherwise hold every
// tile of its layer, the time line's range and an export until the browser gives up, minutes later.
// A minute: a few MB (a Zarr chunk) on a slow connection still arrive. The caller's signal kept.
export const TIMEOUT_MS = 60e3;
export const timed = (init) => (typeof AbortSignal.any === 'function' && typeof AbortSignal.timeout === 'function'
  ? { ...init, signal: AbortSignal.any([init.signal, AbortSignal.timeout(TIMEOUT_MS)].filter(Boolean)) } : init); // an older browser: as before
const get = (url, init = {}) => (area ? fetchInto(area, url, timed(init)) : fetch(url, { ...FETCH, ...timed(init) }));

// a fetch that throws on any status but 2xx (init: on top of FETCH: a signal)
export async function fetchOk(url, init = {}) {
  const r = await get(url, init);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
}
// the bytes at url, or null where there are none (403 and 404: a chunk not stored, a tile not there)
export async function fetchBytes(url) {
  const r = await get(url);
  if (r.status === 403 || r.status === 404) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}
// a tile's address: its template ({z}/{x}/{y}) filled
export const tileUrl = (template, z, x, y) => template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
// A cache of promises (max Infinity: every one kept), the least recently used forgotten past max: get(key, make) gives the
// one kept or makes it (forgotten if it fails, so the next ask tries again); peek(key) the one kept,
// if any, without counting as a use; drop(key) forgets it. maxAge (ms): one older is made again (what a
// service offers that grows, its dates: a page left open, or resumed the next day, asks again); if that
// fails, the one kept stays, asked again an hour later (offline, a service down: the last known)
export function lru(max, maxAge = Infinity) {
  const m = new Map(), born = new Map();
  const get = (key, make) => {
    if (m.has(key) && Date.now() - born.get(key) < maxAge) { const v = m.get(key); m.delete(key); m.set(key, v); return v; }
    if (m.has(key)) { // too old: made again, the one kept if that fails
      const old = m.get(key);
      born.set(key, Date.now());
      const v = make().catch(() => { born.set(key, Date.now() - maxAge + 36e5); return old; });
      m.delete(key); m.set(key, v);
      return v;
    }
    born.set(key, Date.now());
    // forgotten only while it is the one kept: dropped, its key may hold a newer one by the time it fails
    const v = make().catch((e) => { if (m.get(key) === v) { m.delete(key); born.delete(key); } throw e; });
    m.set(key, v);
    if (m.size > max) { const old = m.keys().next().value; m.delete(old); born.delete(old); }
    return v;
  };
  get.peek = (key) => m.get(key);
  get.drop = (key) => { born.delete(key); return m.delete(key); };
  return get;
}
