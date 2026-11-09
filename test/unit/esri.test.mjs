import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// this browser's storage, as the page has it (dom.js store reads localStorage at each call)
const kept = new Map();
globalThis.localStorage = { getItem: (k) => (kept.has(k) ? kept.get(k) : null), setItem: (k, v) => kept.set(k, String(v)), removeItem: (k) => kept.delete(k) };
const esri = await import('../../site/esri.js');
const { HOSTS } = await import('../../site/hosts.js');

const KEY = 'FAKE-KEY-0123456789';
// Esri's answers, as they come: a style for an accepted key; an error object for a refused one
// (sent with HTTP 200 as often as with 498); something else when the service is in trouble
const answer = (status, body) => async (url, init) => { answer.last = { url, init }; return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }); };
const STYLE = { version: 8, sources: {}, layers: [] };
const INVALID = { error: { code: 498, message: 'Token Invalid.', details: [] } };
beforeEach(() => kept.clear());

test('the check: a style is an accepted key; an error, with HTTP 200 or 498, a refused one', async () => {
  assert.equal(await esri.ask(KEY, answer(200, STYLE)), 'ok');
  assert.equal(await esri.ask(KEY, answer(200, INVALID)), 'refused');
  assert.equal(await esri.ask(KEY, answer(498, INVALID)), 'refused');
  assert.equal(await esri.ask(KEY, answer(403, 'Forbidden')), 'refused');
  await assert.rejects(esri.ask(KEY, answer(503, 'Service Unavailable')), /HTTP 503/, 'a service in trouble is no answer');
  await assert.rejects(esri.ask(KEY, async () => { throw new TypeError('Failed to fetch'); }), /Failed to fetch/);
});

test('the check asks the Basemap Styles service, with the page\'s origin as referrer and no cookies', async () => {
  await esri.ask(KEY, answer(200, STYLE));
  const { url, init } = answer.last;
  assert.ok(url.startsWith(`${HOSTS.esriStyles}/arcgis/rest/services/styles/v2/styles/arcgis/imagery?token=`));
  assert.ok(url.endsWith(encodeURIComponent(KEY)));
  assert.equal(init.referrerPolicy, 'strict-origin');
  assert.equal(init.credentials, 'omit');
});

test('a key is kept with its answer; one that could not be asked is not kept; forget removes it', async () => {
  assert.equal(esri.held(), null);
  await assert.rejects(esri.use(KEY, answer(503, 'down')));
  assert.equal(esri.held(), null, 'no answer, nothing kept');
  assert.equal(await esri.use(KEY, answer(200, INVALID)), 'refused');
  assert.equal(esri.held().state, 'refused');
  assert.equal(esri.usable(), false);
  assert.equal(await esri.use(KEY, answer(200, STYLE)), 'ok');
  assert.equal(esri.usable(), true);
  assert.equal(esri.held().key, KEY);
  esri.forget();
  assert.equal(esri.held(), null);
});

test('asked again: a key that expired stops being used; Esri out of reach keeps the last answer', async () => {
  await esri.use(KEY, answer(200, STYLE));
  assert.equal(await esri.recheck(async () => { throw new TypeError('offline'); }), 'ok');
  assert.equal(esri.usable(), true);
  assert.equal(await esri.recheck(answer(200, INVALID)), 'refused');
  assert.equal(esri.usable(), false);
  esri.forget();
  assert.equal(await esri.recheck(answer(200, STYLE)), null, 'no key, nothing asked');
});

test('the map\'s requests: Esri\'s tiles carry the key only once accepted, and the origin as referrer; the rest neither', async () => {
  const tile = esri.ESRI_TILES.replace('{z}/{y}/{x}', '17/49225/70723');
  const other = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/3/2/4.jpg';
  assert.deepEqual(esri.request(tile), { url: tile, referrerPolicy: 'strict-origin' }, 'no key: no token');
  await esri.use(KEY, answer(200, INVALID));
  assert.equal(esri.request(tile).url, tile, 'a refused key is never sent');
  await esri.use(KEY, answer(200, STYLE));
  assert.deepEqual(esri.request(tile), { url: `${tile}?token=${encodeURIComponent(KEY)}`, referrerPolicy: 'strict-origin' });
  assert.deepEqual(esri.request(other), { url: other, referrerPolicy: 'no-referrer' }, 'other hosts: no key, no referrer');
  assert.deepEqual(esri.request(`${HOSTS.esriStyles}/x`), { url: `${HOSTS.esriStyles}/x`, referrerPolicy: 'no-referrer' }, 'only the tiles go through the map');
  assert.equal(esri.request('https://ibasemaps-api.arcgis.com.example.org/x').url.includes('token'), false, 'a look-alike host gets nothing');
});

test('Esri\'s credit: the service\'s own text, escaped, asked with the key; none without one', async () => {
  assert.equal(await esri.credit(answer(200, { copyrightText: 'x' })), null);
  await esri.use(KEY, answer(200, STYLE));
  assert.equal(await esri.credit(answer(200, { copyrightText: 'Source: Esri & <b>Vantor</b>' })), 'Powered by <a href="https://www.esri.com">Esri</a> · Source: Esri &#38; &#60;b&#62;Vantor&#60;/b&#62;');
  assert.ok(answer.last.url.startsWith(`${HOSTS.esriTiles}/arcgis/rest/services/World_Imagery/MapServer?f=json&token=`));
  assert.equal(answer.last.init.referrerPolicy, 'strict-origin');
  assert.equal(await esri.credit(answer(200, {})), null);
  assert.equal(await esri.credit(async () => { throw new Error('down'); }), null);
});
