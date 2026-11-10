import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { near } from './helpers.mjs';
import { mergeBlock, Q, SURVEYED, INTERPOLATED, FROM_GEBCO } from '../../tools/emodnet.mjs';
import { gridTile, inside } from '../../site/gebco.js';
import { gridValues } from '../../site/values.js';
import { tileXY } from '../../site/geo.js';

// One block of EMODnet's grid as the store holds it (tools/emodnet.mjs), from a made-up EMODnet chunk and GEBCO grid
test('mergeBlock: EMODnet\'s water whole, surveyed or interpolated; land beside it; GEBCO\'s only where EMODnet has no water in reach', () => {
  const EC = 1000, e = new Float32Array(EC * EC), f = new Float32Array(EC * EC);
  for (let r = 0; r < EC; r++) {
    for (let c = 0; c < EC; c++) {
      const k = r * EC + c;
      if (c < 500) { e[k] = -20; f[k] = r < 500 ? 0 : NaN; } // surveyed: flag 0, or no flag at all
      else if (c < 600) { e[k] = -3; f[k] = 1; } // interpolated: its own all the same
      else { e[k] = NaN; f[k] = NaN; } // no value
      if (c >= 700 && c < 720 && r >= 100 && r < 120) { e[k] = 0; f[k] = 1; } // a guess of 0 m: no water
    }
  }
  // GEBCO: 100 m deep, land (50 m) from its column 46045 (the block's columns from about 940)
  const { values, source, stats } = mergeBlock(27, 45, e, f, (r, c) => (c >= 46045 ? 50 : -100));
  const at = (i, j) => [values[i * EC + j] / Q, source[i * EC + j]];
  assert.deepEqual(at(100, 100), [-20, SURVEYED], 'no flag: surveyed'); // rows from the north: EMODnet's from the south
  assert.deepEqual(at(900, 100), [-20, SURVEYED], 'flag 0: surveyed');
  assert.deepEqual(at(500, 550), [-3, INTERPOLATED], 'interpolated: EMODnet\'s too, and said so');
  assert.deepEqual(at(500, 602), [100, 0], 'no value, EMODnet\'s water in reach: land (the page fades the water beside it)');
  assert.deepEqual(at(500, 700), [-100, FROM_GEBCO], 'no value and no water of its in reach: GEBCO\'s, and said so');
  assert.deepEqual(at(890, 710), [-100, FROM_GEBCO], 'a guess of 0 m far from its water: GEBCO\'s sea'); // its rows 100–119 from the south
  assert.deepEqual(at(500, 990), [100, 0], 'GEBCO\'s land: land, one value');
  assert.equal(stats.surveyed, 500 * EC); assert.equal(stats.interpolated, 100 * EC);
});

// a regional store, as tools/emodnet.mjs writes it: 10 × 10 cells of 1° from 10° N, 0° E, in quarter
// metres (−10 m), chunks of 5 × 5, uncompressed; the south-east chunk land (100 m)
test('gridTile: a regional grid as its store describes it; NaN beyond it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'merged-')), store = join(dir, 'm.zarr');
  mkdirSync(join(store, '0', 'elevation'), { recursive: true });
  const meta = { '0/elevation/.zarray': { zarr_format: 2, shape: [10, 10], chunks: [5, 5], dtype: '<i2', compressor: null, fill_value: 400, order: 'C', filters: null },
    '0/elevation/.zattrs': { scale_factor: 0.25, cell_size_degrees: 1, north: 10, west: 0 } };
  writeFileSync(join(store, '.zmetadata'), JSON.stringify({ zarr_consolidated_format: 1, metadata: meta }));
  for (const name of ['0.0', '0.1', '1.0']) writeFileSync(join(store, '0', 'elevation', name), new Uint8Array(new Int16Array(25).fill(-40).buffer));
  writeFileSync(join(store, '0', 'elevation', '1.1'), new Uint8Array(new Int16Array(25).fill(400).buffer));
  const server = createServer((req, res) => { try { res.end(readFileSync(join(dir, new URL(req.url, 'http://x').pathname))); } catch { res.statusCode = 404; res.end(); } });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const url = `http://127.0.0.1:${server.address().port}/m.zarr`, z = 3, { x, y } = tileXY(0, 10, z);
    const { raw, sea } = await gridTile(url, 'elevation', z, Math.floor(x), Math.floor(y), false); // 0°–45° E, 0°–41° N
    const px = (lon, lat) => { const t = tileXY(lon, lat, z); return Math.floor((t.y % 1) * 256) * 256 + Math.floor((t.x % 1) * 256); };
    near(raw[px(3, 7)], -10, 1e-3, 'inside, the store\'s scale applied');
    assert.ok(Number.isNaN(raw[px(20, 7)]) && Number.isNaN(raw[px(3, 30)]), 'beyond the grid: NaN');
    near(raw[px(7.5, 2.5)], 100, 1e-3, 'the land chunk');
    near(sea[px(3, 7)], -10, 1e-3);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

// where the page reads EMODnet's grid (catalog.js EMODNET_AREA): European seas, not its grid's southern end
test('inside: EMODnet\'s area is the Mediterranean and north, and the Canaries; no edge where its boxes meet', () => {
  assert.ok(inside(23.38, 37.96) > 1, 'west of Salamis');
  assert.ok(inside(-16.5, 28.2) > 1, 'Tenerife');
  assert.ok(inside(-17, 20) < 0, 'the Banc d\'Arguin: GEBCO\'s');
  assert.ok(inside(38, 22) < 0, 'the Red Sea: GEBCO\'s');
  assert.ok(inside(34.9, 29.5) < 0, 'the Gulf of Aqaba: GEBCO\'s');
  assert.ok(inside(-15, 30) >= 1, 'where the two boxes meet, in the Atlantic: well inside, no blend');
  near(inside(-15, 27.1), 0.1, 1e-9, 'near the southern edge off the Sahara');
  near(inside(10, 30.2), 0.2, 1e-9, 'the Gulf of Sirte\'s end, near the edge');
});

// the GIS export's values from a regional store of two levels: 40 × 40 cells of 0.25° from 10° N, 0° E
// (64 chunks of 5 × 5), and 20 × 20 of 0.5° above it (16 chunks)
test('gridValues: a regional store\'s own cells for a small view, a coarser level for a wide one, placed by what the store says', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'values-')), store = join(dir, 'v.zarr'), meta = {};
  for (const [k, n, cell] of [[0, 40, 0.25], [1, 20, 0.5]]) {
    mkdirSync(join(store, String(k), 'elevation'), { recursive: true });
    meta[`${k}/elevation/.zarray`] = { zarr_format: 2, shape: [n, n], chunks: [5, 5], dtype: '<i2', compressor: null, fill_value: 400, order: 'C', filters: null };
    meta[`${k}/elevation/.zattrs`] = { scale_factor: 0.25, cell_size_degrees: cell, north: 10, west: 0 };
    for (let r = 0; r < n / 5; r++) for (let c = 0; c < n / 5; c++) writeFileSync(join(store, String(k), 'elevation', `${r}.${c}`), new Uint8Array(new Int16Array(25).fill(-40).buffer));
  }
  writeFileSync(join(store, '.zmetadata'), JSON.stringify({ zarr_consolidated_format: 1, metadata: meta }));
  const asked = [];
  const server = createServer((req, res) => { asked.push(req.url); try { res.end(readFileSync(join(dir, new URL(req.url, 'http://x').pathname))); } catch { res.statusCode = 404; res.end(); } });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  try {
    const g = { url: `http://127.0.0.1:${server.address().port}/v.zarr`, variable: 'elevation', key: 'raster/x', title: 'X', unit: 'm', band: 'elevation', cell: '15′', source: 'A store', what: (grid) => `depths, ${grid}` };
    // 1°–2° E, 6°–7° N: its own cells, the 4 × 4 in the box and one more all round (the box covered to its
    // edge), their corner at 0.75° E, 7.25° N
    const [small] = await gridValues(g, [1, 6, 2, 7]);
    assert.deepEqual([small.w, small.h, small.transform], [6, 6, [0.25, 0, 0.75, 0, -0.25, 7.25]]);
    assert.match(small.description, /its own grid \(15′ cells\)/);
    assert.ok(asked.every((u) => !u.includes('/1/elevation/')), 'the level above not read');
    // the whole of it: 64 chunks at its own cells, more than an export reads: the level above, its 16
    asked.length = 0;
    const [wide] = await gridValues(g, [0, 0, 10, 10]);
    assert.deepEqual([wide.w, wide.h, wide.transform], [20, 20, [0.5, 0, 0, 0, -0.5, 10]]);
    assert.match(wide.description, /level 1 of its grid \(means of 2 × 2 of its 15′ cells\)/);
    assert.equal(asked.filter((u) => u.includes('/1/elevation/')).length, 16);
    assert.ok(asked.every((u) => !u.includes('/0/elevation/')), 'no chunk of its own cells read for the wide view');
    // beyond the store: nothing
    assert.deepEqual(await gridValues(g, [20, 0, 30, 10]), []);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
