// A record as a series in time (catalog.js RECORDS): the values of one variable at a point, or over
// an area reduced to one value per time, read from its dataset's 'geoChunked' Zarr store, whose
// chunks are years of a small block of cells (Mediterranean waves: 49,968 hours of 4 × 4 cells). The
// cost is by chunk, not by cell: plan() counts them before reading, so the page can say it and
// keep to a budget. The statistics of the series: stats.js.
import { regionOf, partIn } from './cmems.js';
import { storeOf } from './values.js';
import { nearest } from './zarr.js';

// the dataset of a record for the place [lon, lat]: the regional one where its area holds it, else
// the global one (the first)
export function recordPart(record, [lon, lat]) {
  return record.parts.find((p) => regionOf(p) && partIn(p, [lon, lat, lon, lat])) || record.parts[0];
}
// a record's dataset, opened: { store, times (ms), lat, lon } (values.js storeOf)
export const openRecord = (part) => storeOf(part, 'geoChunked');

// the cell of the store's grid nearest to [lon, lat], as { row, col }; null outside a regional grid
export function cellAt({ lat, lon }, [x, y]) {
  const row = nearest(lat, y, Math.abs(lat[1] - lat[0])), dlon = lon[1] - lon[0];
  const global = Math.abs(dlon * lon.length - 360) < Math.abs(dlon);
  const col = global ? ((Math.round((x - lon[0]) / dlon) % lon.length) + lon.length) % lon.length : nearest(lon, x, Math.abs(dlon));
  return row < 0 || col < 0 ? null : { row, col };
}

// the chunks that reading `names` over cells ([{ row, col }]) and the time indices [i0, i1] takes:
// { keys (per name, the chunk indices [t, y, x]), chunks (all names), raw (their bytes decoded) }
export function plan(store, names, cells, [i0, i1]) {
  const keys = {};
  let chunks = 0, raw = 0;
  for (const name of names) {
    const m = store.meta(name), [ct, cy, cx] = m.chunks, size = ct * cy * cx * (m.dtype === '<f8' ? 8 : m.dtype === '<i2' ? 2 : 4);
    const blocks = [...new Set(cells.map(({ row, col }) => `${Math.floor(row / cy)}.${Math.floor(col / cx)}`))].map((b) => b.split('.').map(Number));
    keys[name] = [];
    for (let t = Math.floor(i0 / ct); t <= Math.floor(i1 / ct); t++) for (const [by, bx] of blocks) keys[name].push([t, by, bx]);
    chunks += keys[name].length;
    raw += keys[name].length * size;
  }
  return { keys, chunks, raw };
}

// tasks (functions → promise) run at most `limit` at a time; their results in order
async function pool(tasks, limit) {
  const out = new Array(tasks.length);
  let next = 0;
  const worker = async () => { while (next < tasks.length) { const i = next++; out[i] = await tasks[i](); } };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return out;
}

// The series of `name` over cells ([{ row, col, weight }], weight 1 if not given) for the time
// indices [i0, i1] of the store's times: Float32Array, one value per time, NaN where no cell has one.
// reduce: 'mean' (weighted, over the cells with a value), 'max', or 'angle' (directions in degrees:
// the direction of the weighted sum of unit vectors). The chunks are read a few at a time, their
// cells taken from each as it comes: onChunk(done, total) after each. signal: an AbortSignal, which
// stops before the next chunk.
export async function readSeries(store, name, cells, [i0, i1], { reduce = 'mean', signal = null, onChunk = null } = {}) {
  const m = store.meta(name), [ct, cy, cx] = m.chunks, n = i1 - i0 + 1;
  const scale = m.attrs.scale_factor ?? 1, offset = m.attrs.add_offset ?? 0;
  const fill = m.fill_value == null ? NaN : m.dtype === '<f4' ? Math.fround(m.fill_value) : m.fill_value;
  const missing = m.attrs.missing_value ?? fill;
  const a = new Float64Array(n), b = new Float64Array(n), w = new Float64Array(n);
  if (reduce === 'max') a.fill(-Infinity);
  const { keys } = plan(store, [name], cells, [i0, i1]);
  let done = 0;
  await pool(keys[name].map(([t, by, bx]) => async () => {
    signal?.throwIfAborted();
    const data = await store.chunk(name, [t, by, bx]);
    const from = Math.max(i0, t * ct), to = Math.min(i1, t * ct + ct - 1);
    for (const { row, col, weight = 1 } of cells) {
      if (Math.floor(row / cy) !== by || Math.floor(col / cx) !== bx) continue;
      const cell = (row % cy) * cx + (col % cx);
      for (let i = from; i <= to; i++) {
        const raw = data[(i - t * ct) * cy * cx + cell];
        if (raw === fill || raw === missing || Number.isNaN(raw)) continue;
        const v = raw * scale + offset, k = i - i0;
        if (reduce === 'max') { if (v > a[k]) a[k] = v; w[k] = 1; continue; }
        if (reduce === 'angle') { a[k] += weight * Math.sin((v * Math.PI) / 180); b[k] += weight * Math.cos((v * Math.PI) / 180); } else a[k] += weight * v;
        w[k] += weight;
      }
    }
    onChunk?.(++done, keys[name].length);
  }), 6);
  signal?.throwIfAborted();
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    out[k] = !w[k] ? NaN : reduce === 'max' ? a[k] : reduce === 'angle' ? ((Math.atan2(a[k], b[k]) * 180) / Math.PI + 360) % 360 : a[k] / w[k];
  }
  return out;
}
