import { test } from 'node:test';
import assert from 'node:assert/strict';
import { datumAt, DATUMS, clampCoastalSpikes, clipper } from '../../site/clip.js';
import { HOSTS } from '../../site/hosts.js';
import { DEPTH_LEVELS } from '../../site/catalog.js';

test('Caspian surface applies inside its box only (per point, not per tile)', () => {
  assert.equal(DATUMS[0][0], 'Caspian Sea');
  assert.equal(datumAt(50.5, 45.3), -28); // northern Caspian
  assert.equal(datumAt(46.0, 46.0), 0);   // Kalmyk steppe lakes, west of the box
  assert.equal(datumAt(14, 37.5), 0);     // Mediterranean
  assert.equal(datumAt(55.3, 40), 0);     // just east of the box
});

test('clampCoastalSpikes: false peaks beside the sea go; inland summits and islets stay', () => {
  const w = 20, at = (x, y) => y * w + x;
  // land 100 m in columns 0–9, sea in columns 10–19
  const e = new Float32Array(w * w), sea = new Uint8Array(w * w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) { e[at(x, y)] = x < 10 ? 100 : 0; sea[at(x, y)] = x >= 10 ? 1 : 0; }
  e[at(8, 5)] = 311;  // the Elba spike: 2 px from the sea
  e[at(8, 9)] = -100; // a false pit beside the sea
  e[at(2, 14)] = 400; // a summit 7 px inland
  e[at(15, 15)] = 60; sea[at(15, 15)] = 0; // a one-pixel islet
  clampCoastalSpikes(e, sea, w, w);
  assert.equal(e[at(8, 5)], 100);
  assert.equal(e[at(8, 9)], 100);
  assert.equal(e[at(2, 14)], 400);
  assert.equal(e[at(15, 15)], 60);
});

test('DEPTH_LEVELS: the depths nautical charts use, none the model cannot place', () => {
  assert.deepEqual(DEPTH_LEVELS.slice(0, 13), [5, 10, 20, 30, 50, 100, 200, 300, 500, 1000, 1500, 2000, 2500]);
  assert.ok(!DEPTH_LEVELS.includes(75) && !DEPTH_LEVELS.includes(150), 'none where the model cannot place them');
});

test('clipper: work every requester gave up is forgotten, so the tile asked again meanwhile is cut afresh', async () => {
  const tileJson = `${HOSTS.openfreemap}/shared-work-test.json`, omt = `${HOSTS.openfreemap}/shared-work-test/`;
  let release, dems = 0;
  const dem = new Promise((r) => { release = r; }); // the DEM tile held back until both have asked
  const was = { fetch: globalThis.fetch, OffscreenCanvas: globalThis.OffscreenCanvas, createImageBitmap: globalThis.createImageBitmap };
  globalThis.fetch = async (url) => (url === tileJson ? Response.json({ tiles: [`${omt}{z}/{x}/{y}.pbf`] })
    : url.startsWith(omt) ? new Response(null, { status: 404 }) // no base map tile: no water, all land
      : (dems++, dem.then(() => new Response(new Uint8Array(1)))));
  globalThis.createImageBitmap = async () => ({ width: 256, height: 256 });
  globalThis.OffscreenCanvas = class { getContext() { return { drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(256 * 256 * 4) }) }; } };
  try {
    const c = clipper({ template: 'https://dem.test/{z}/{x}/{y}.png', mode: 'land', omtTileJson: tileJson });
    const ac = new AbortController();
    const first = c.contourElevation(12, 1, 2, ac.signal);
    for (let i = 0; i < 100 && !dems; i++) await new Promise((r) => setImmediate(r));
    ac.abort(); // its only requester gone: the work stops at its next step
    const again = c.contourElevation(12, 1, 2); // asked before it has
    release();
    await assert.rejects(first, /aborted/);
    assert.equal((await again).length, 256 * 256, 'cut afresh, not failed with the work given up');
    assert.equal(dems, 1, 'the DEM tile read once');
  } finally { Object.assign(globalThis, was); }
});
