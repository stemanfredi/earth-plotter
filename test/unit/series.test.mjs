import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RECORDS } from '../../site/catalog.js';
import { recordPart, cellAt, plan, readSeries } from '../../site/series.js';

// a store as zarr.js openStore gives it: one variable, time × 4 × 4 cells, chunks of 3 times × 2 × 2,
// int16 scaled by 0.01; the raw value of a cell is 100 × (t + row + col / 10), −32767 missing
function fakeStore({ scale = 0.01, offset = 0 } = {}) {
  const meta = { shape: [7, 4, 4], chunks: [3, 2, 2], dtype: '<i2', fill_value: null, attrs: { scale_factor: scale, add_offset: offset, missing_value: -32767 } };
  const asked = [];
  const chunk = async (name, [t, by, bx]) => {
    asked.push([t, by, bx].join('.'));
    const out = new Int16Array(12);
    for (let i = 0; i < 3; i++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      const ti = t * 3 + i, row = by * 2 + y, col = bx * 2 + x;
      out[(i * 2 + y) * 2 + x] = row === 3 && col === 3 ? -32767 : Math.round(100 * (ti + row + col / 10));
    }
    return out;
  };
  return { store: { meta: () => meta, chunk }, asked };
}

test('recordPart: the Mediterranean hindcast in the Mediterranean, the global elsewhere', () => {
  assert.match(recordPart(RECORDS.waves, [9.5, 43.9]), /^MEDSEA_/);
  assert.match(recordPart(RECORDS.waves, [-30, 40]), /^GLOBAL_/);
  assert.match(recordPart(RECORDS.waves, [-3, 47]), /^GLOBAL_/); // Biscay: in the Mediterranean product's box, not its area
});

test('cellAt: nearest cell; a global grid wrapped, a regional one bounded', () => {
  const lat = [10, 11, 12], lonG = Array.from({ length: 360 }, (_, i) => -180 + i), lonR = [0, 1, 2];
  assert.deepEqual(cellAt({ lat, lon: lonG }, [179.8, 11.2]), { row: 1, col: 0 });
  assert.deepEqual(cellAt({ lat, lon: lonR }, [1.4, 12]), { row: 2, col: 1 });
  assert.equal(cellAt({ lat, lon: lonR }, [5, 12]), null);
});

test('plan: chunks by block and time, whatever the cells in a block', () => {
  const { store } = fakeStore();
  const p = plan(store, ['v'], [{ row: 0, col: 0 }, { row: 1, col: 1 }, { row: 2, col: 0 }], [2, 4]);
  assert.deepEqual(p.keys.v, [[0, 0, 0], [0, 1, 0], [1, 0, 0], [1, 1, 0]]);
  assert.equal(p.chunks, 4);
  assert.equal(p.raw, 4 * 12 * 2);
});

test('readSeries: a cell across time chunks, scaled; only the chunks it needs', async () => {
  const { store, asked } = fakeStore();
  const v = await readSeries(store, 'v', [{ row: 1, col: 2 }], [1, 4]);
  assert.deepEqual([...v].map((x) => +x.toFixed(2)), [2.2, 3.2, 4.2, 5.2]);
  assert.deepEqual(asked.sort(), ['0.0.1', '1.0.1']);
});

test('readSeries: the weighted mean, the max, and a missing cell left out', async () => {
  const { store } = fakeStore();
  const cells = [{ row: 0, col: 0, weight: 3 }, { row: 2, col: 2, weight: 1 }, { row: 3, col: 3 }];
  const mean = await readSeries(store, 'v', cells, [0, 0]);
  assert.ok(Math.abs(mean[0] - (3 * 0 + 2.2) / 4) < 1e-6);
  const max = await readSeries(store, 'v', cells, [0, 0], { reduce: 'max' });
  assert.ok(Math.abs(max[0] - 2.2) < 1e-6);
  const none = await readSeries(store, 'v', [{ row: 3, col: 3 }], [0, 1]);
  assert.ok(none.every(Number.isNaN));
});

test('readSeries: directions averaged as angles, across north', async () => {
  // scale 1, offset 355: cell (0, 0) reads 355°, cell (0, 1) 365°, that is 5°
  const { store } = fakeStore({ scale: 1, offset: 355 });
  const d = await readSeries(store, 'v', [{ row: 0, col: 0 }, { row: 0, col: 1 }], [0, 0], { reduce: 'angle' });
  assert.ok(Math.min(d[0], 360 - d[0]) < 1e-3, `${d[0]}`);
});

test('readSeries: progress, and a cancel stops it', async () => {
  const { store } = fakeStore();
  const seen = [];
  await readSeries(store, 'v', [{ row: 0, col: 0 }], [0, 6], { onChunk: (d, n) => seen.push(`${d}/${n}`) });
  assert.deepEqual(seen, ['1/3', '2/3', '3/3']);
  const c = new AbortController();
  c.abort();
  await assert.rejects(readSeries(store, 'v', [{ row: 0, col: 0 }], [0, 6], { signal: c.signal }), { name: 'AbortError' });
});
