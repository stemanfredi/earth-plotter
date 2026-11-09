import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// this browser's storage, as the page has it (dom.js store reads localStorage at each call)
const kept = new Map();
let full = false; // storage that refuses to keep anything (private mode, blocked)
globalThis.localStorage = { getItem: (k) => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => { if (full) throw new Error('QuotaExceededError'); kept.set(k, String(v)); }, removeItem: (k) => kept.delete(k) };
const esri = await import('../../site/esri.js');
const { HOSTS } = await import('../../site/hosts.js');

const KEY = 'FAKE-KEY-0123456789', OTHER = 'FAKE-KEY-OTHER';
// Esri's answers, as they come: a style for an accepted key; an error object for a refused one
// (sent with HTTP 200 as often as with 498); something else when the service is in trouble
const answer = (status, body) => async (url, init) => { answer.last = { url, init }; return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }); };
const STYLE = { version: 8, sources: {}, layers: [] };
const INVALID = { error: { code: 498, message: 'Token Invalid.', details: [] } };
beforeEach(() => { kept.clear(); full = false; });

test('the check: a style is an accepted key; a key error, with HTTP 200 or 498, a refused one; a fault is no answer', async () => {
  assert.equal(await esri.ask(KEY, answer(200, STYLE)), 'ok');
  assert.equal(await esri.ask(KEY, answer(200, INVALID)), 'refused');
  assert.equal(await esri.ask(KEY, answer(498, INVALID)), 'refused');
  assert.equal(await esri.ask(KEY, answer(403, { error: { code: 403, message: 'You do not have permissions to access this resource or perform this operation.' } })), 'refused', 'Esri\'s own 403: no basemaps privilege');
  await assert.rejects(esri.ask(KEY, answer(403, '<html>Forbidden</html>')), 'a bare 403 (a portal, a proxy): no answer, the key kept');
  await assert.rejects(esri.ask(KEY, answer(401, 'Unauthorized')), 'a bare 401: no answer');
  await assert.rejects(esri.ask(KEY, answer(503, 'Service Unavailable')), /HTTP 503/, 'a service in trouble is no answer');
  await assert.rejects(esri.ask(KEY, answer(200, { error: { code: 500, message: 'Error' } })), /error 500/, 'a fault of Esri\'s, with HTTP 200, is no answer either');
  await assert.rejects(esri.ask(KEY, async () => { throw new TypeError('Failed to fetch'); }), /Failed to fetch/);
});

test('the check asks the Basemap Styles service, with the page\'s origin as referrer, no cookies, and a time limit', async () => {
  await esri.ask(KEY, answer(200, STYLE));
  const { url, init } = answer.last;
  assert.ok(url.startsWith(`${HOSTS.esriStyles}/arcgis/rest/services/styles/v2/styles/arcgis/imagery?token=`));
  assert.ok(url.endsWith(encodeURIComponent(KEY)));
  assert.equal(init.referrerPolicy, 'strict-origin');
  assert.equal(init.credentials, 'omit');
  assert.ok(init.signal instanceof AbortSignal);
});

test('only an accepted key is kept; a refused one, or one that could not be asked, is not; forget removes it', async () => {
  assert.equal(esri.held(), null);
  await assert.rejects(esri.use(KEY, answer(503, 'down')));
  assert.equal(esri.held(), null, 'no answer, nothing kept');
  assert.equal(await esri.use(KEY, answer(200, INVALID)), 'refused');
  assert.equal(esri.held(), null, 'refused, nothing kept');
  assert.equal(esri.usable(), false);
  assert.equal(await esri.use(KEY, answer(200, STYLE)), 'ok');
  assert.equal(esri.usable(), true);
  assert.equal(esri.held().key, KEY);
  esri.forget();
  assert.equal(esri.held(), null);
});

test('a browser that keeps nothing: an accepted key is said not to be kept', async () => {
  full = true;
  await assert.rejects(esri.use(KEY, answer(200, STYLE)), /keeps nothing/);
  assert.equal(esri.held(), null);
});

test('asked again: a key that expired is forgotten; Esri out of reach, or a key kept meanwhile, changes nothing', async () => {
  await esri.use(KEY, answer(200, STYLE));
  assert.equal(await esri.recheck(async () => { throw new TypeError('offline'); }), null);
  assert.equal(esri.usable(), true);
  assert.equal(await esri.recheck(answer(200, INVALID)), 'refused');
  assert.equal(esri.held(), null);
  assert.equal(await esri.recheck(answer(200, STYLE)), null, 'no key, nothing asked');
  // the answer for the key held comes after another was kept: the other stays
  await esri.use(KEY, answer(200, STYLE));
  const late = async () => { await esri.use(OTHER, answer(200, STYLE)); return new Response(JSON.stringify(INVALID), { status: 200 }); };
  assert.equal(await esri.recheck(late), null);
  assert.equal(esri.held().key, OTHER);
});

test('the map\'s requests: Esri\'s tiles carry the key and the origin only once one is accepted; other hosts are not Esri\'s to answer', async () => {
  const tile = esri.ESRI_TILES.replace('{z}/{y}/{x}', '17/49225/70723');
  assert.deepEqual(esri.request(tile), { url: tile, referrerPolicy: 'no-referrer' }, 'no key: no token, no referrer');
  await esri.use(KEY, answer(200, INVALID));
  assert.equal(esri.request(tile).url, tile, 'a refused key is never sent');
  await esri.use(KEY, answer(200, STYLE));
  assert.deepEqual(esri.request(tile), { url: `${tile}?token=${encodeURIComponent(KEY)}`, referrerPolicy: 'strict-origin' });
  assert.equal(esri.request('https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/3/2/4.jpg'), null);
  assert.equal(esri.request(`${HOSTS.esriStyles}/x`), null, 'only the tiles go through the map');
  assert.equal(esri.request('https://ibasemaps-api.arcgis.com.example.org/x'), null, 'a look-alike host gets nothing');
});
