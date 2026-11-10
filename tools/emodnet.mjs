#!/usr/bin/env node
// EMODnet's depths as one store for Earth Plotter, over EMODnet's area: the page reads it there
// (site/gebco.js), at every zoom, and GEBCO's own store elsewhere. Published as plain files at
// geodata.earthplotter.org/emodnet-2024/, beside gebco-2026/ (tools/gebco.mjs).
//
//   node tools/emodnet.mjs download DIR                  EMODnet's DTM 2024 chunks into DIR/dtm (resumable)
//   node tools/emodnet.mjs build DIR GEBCO_DIR           DIR/zarr/emodnet-2024/{elevation,source}.zarr
//          [--workers N]
//   node tools/emodnet.mjs source-levels DIR GEBCO_DIR   the source grid's levels above 0 alone, from a build already made
//   node tools/emodnet.mjs verify DIR GEBCO_DIR          the store against its sources: every chunk there, and
//          [--rows N]                                    N rows of blocks (8) and chunks of each level made again, the same
//
// The grid is EMODnet's: 1/16′ cells (about 115 m), 36° W–43° E, 15°–90° N, north up. A cell is
// EMODnet's depth wherever EMODnet has water, its surveys and its interpolations alike (its flag 1:
// filled from its neighbours, no soundings; 0 and no flag at all are its surveys): one grid, whole,
// with no seam of ours inside it. GEBCO 2026 mixes its sources cell by cell (in the Aegean, cells
// read from satellite images at 14 m beside cells at 55 m, where charts and EMODnet have a plain
// slope), and a merge of the two grids cell by cell, tried before, drew seams of its own. Where
// EMODnet has no water the cell is land, and the page fades the water beside it to OSM's shore; but
// where it has none within 5 cells either (a sea it does not cover, a lagoon or a port it calls
// land), GEBCO's water, from its water cells alone, as the page draws it. EMODnet's depths are from
// lowest astronomical tide; so are GEBCO's in Europe's surveyed waters, which it took from EMODnet.
//
// elevation.zarr  int16, quarter metres (scale_factor 0.25: down to −8191 m), negative below the sea;
//                 land one value, 100 m (the page needs only to know it is land: its heights come
//                 from the DEM, the inland water's from GEBCO's store). Levels 0–6 (1/16′ to 4′),
//                 level k+1 the mean of the water among 2 × 2 cells of level k, rounded, a half
//                 upwards; land where none is (so a coast does not move as the levels coarsen). Chunks of 500 × 500, each one Blosc block (byte shuffle, zlib), as
//                 GEBCO's; every chunk is written, all land too (a few hundred bytes), so that one
//                 missing is a broken upload, and a saved offline area holds every chunk it reads
// source.zarr     int8, the same levels: 1 where the cell is EMODnet's survey, 2 its interpolation,
//                 3 GEBCO's water, 0 land (fill 0); level k+1 the most common among 2 × 2
//                 (interpolated on a tie with surveyed). The depth on a click says which, and the Depth sources layer draws it
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { decode, openStore } from '../site/zarr.js';
import { lru } from '../site/net.js';
import { bloscEncode } from './gebco.mjs';

const RELEASE = 'emodnet-2024';
const DTM = 'https://s3.waw3-1.cloudferro.com/emodnet/emodnet_bathymetry/14157/bathymetry_dtm_2024.zarr';
const VARS = ['elevation', 'interpolation_flag'];
// EMODnet's grid: rows × columns of 1/960°, from 90° N and 36° W; its chunks 1000 × 1000 (from the south)
export const H = 72000, W = 75840, EC = 1000, CELL = 1 / 960, WEST = -36, NORTH = 90;
export const CHUNK = 500, LEVELS = 7, Q = 4, FILL = 400; // quarter metres; 100 m
const GEBCO_CELL = 15 / 3600, GEBCO_CHUNK = 512;
const ER = H / EC, ECOLS = Math.ceil(W / EC); // EMODnet's chunk rows and columns: 72 × 76

// ---- download --------------------------------------------------------------------------------

// every chunk of the two variables, into DIR/dtm/<var>/<row>.<col> as EMODnet names them, and its
// metadata; a chunk already there is not asked again. One EMODnet does not store (its host answers 403
// or 404: all no value) is kept as an empty file, and asked again at every run: an answer of a bad
// moment would otherwise be read as land ever after
export async function download(dir, { log = console.log, parallel = 16 } = {}) {
  const base = join(dir, 'dtm');
  for (const v of VARS) mkdirSync(join(base, v), { recursive: true });
  if (!existsSync(join(base, '.zmetadata'))) writeFileSync(join(base, '.zmetadata'), Buffer.from(await (await fetch(`${DTM}/.zmetadata`)).arrayBuffer()));
  const todo = [];
  for (const v of VARS) for (let r = 0; r < ER; r++) for (let c = 0; c < ECOLS; c++) { const p = join(base, v, `${r}.${c}`); if (!existsSync(p) || !statSync(p).size) todo.push([v, `${r}.${c}`]); }
  log(`${todo.length} chunks to fetch`);
  let next = 0, done = 0, bytes = 0, failed = 0;
  const t0 = Date.now();
  const worker = async () => {
    while (next < todo.length) {
      const [v, name] = todo[next++], path = join(base, v, name);
      let ok = false;
      for (let attempt = 1; attempt <= 5 && !ok; attempt++) {
        const res = await fetch(`${DTM}/${v}/${name}`).catch((e) => e);
        if (res.status === 403 || res.status === 404) { writeFileSync(path, ''); ok = true; break; } // not stored: all no value
        if (!res.ok) { await new Promise((r) => setTimeout(r, 1000 * attempt)); continue; }
        const b = Buffer.from(await res.arrayBuffer());
        writeFileSync(`${path}.part`, b); renameSync(`${path}.part`, path); // never a half file under its name
        bytes += b.length; ok = true;
      }
      if (!ok) { failed++; log(`FAILED ${v}/${name}`); }
      if (++done % 200 === 0) log(`${done} of ${todo.length}, ${(bytes / 1e9).toFixed(2)} GB, ${((Date.now() - t0) / 60e3).toFixed(1)} min`);
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  log(`done: ${(bytes / 1e9).toFixed(2)} GB${failed ? `, ${failed} FAILED: run again` : ''}`);
  return !failed;
}

// ---- the merge ---------------------------------------------------------------------------------

// cubic B-spline weights of the four cells around t ∈ [0, 1) (site/gebco.js)
const bspline = (t) => { const t2 = t * t, t3 = t2 * t; return [(1 - t) ** 3 / 6, (3 * t3 - 6 * t2 + 4) / 6, (-3 * t3 + 3 * t2 + 3 * t + 1) / 6, t3 / 6]; };

// One 1000 × 1000 block of the grid (block row jr from the north, column jc): EMODnet's chunk there
// and GEBCO's cells around it → { values: Int16Array (quarter metres), source: Int8Array, stats }.
// e, f: EMODnet's elevation and flag over the block and a margin of `halo` cells round it (N × N,
// rows from the south; the margin from the neighbouring chunks, so that the rule below reads across
// the block's edges as within it: HALO cells are enough); gebco(r, c): GEBCO's metres at its level-0
// cell (row from the north, column from 180° W)
export const HALO = 5, SURVEYED = 1, INTERPOLATED = 2, FROM_GEBCO = 3; // source's values (0: land, no depth of its own)
export function mergeBlock(jr, jc, e, f, gebco, halo = 0) {
  const N = EC + 2 * halo, m = new Float32Array(N * N), src = new Int8Array(N * N);
  const stats = { surveyed: 0, interpolated: 0, gebco: 0, land: 0 };
  // GEBCO's cells around the block, once: rows and columns in its grid
  const R0 = jr * EC - halo, C0 = jc * EC - halo;
  const gRow = (r) => (r + 0.5) * (CELL / GEBCO_CELL) - 0.5, gCol = (c) => ((WEST + 180) + (c + 0.5) * CELL) / GEBCO_CELL - 0.5;
  const gr0 = Math.floor(gRow(R0)) - 1, gc0 = Math.floor(gCol(C0)) - 1, gh = Math.floor(gRow(R0 + N - 1)) + 3 - gr0, gw = Math.floor(gCol(C0 + N - 1)) + 3 - gc0;
  const win = new Float32Array(gh * gw);
  for (let r = 0; r < gh; r++) for (let c = 0; c < gw; c++) win[r * gw + c] = gebco(gr0 + r, gc0 + c);
  const wc = [], xc = new Int32Array(N);
  for (let j = 0; j < N; j++) { const x = gCol(C0 + j), a = Math.floor(x); xc[j] = a - 1 - gc0; wc.push(bspline(x - a)); }
  // EMODnet's water is EMODnet's, surveyed or interpolated alike (its flag says which: the depth on a
  // click): one grid, whole, with no seam of ours inside it. Where EMODnet has no water (no value, or
  // 0 m and up) the cell is land, and the page fades the water beside it to OSM's shore; but where no
  // water of EMODnet's is within REACH cells either (a sea it does not cover, a lagoon or a port it
  // calls land), GEBCO's water as the page drew it: from its water cells alone
  const REACH = HALO, S = N + 1, waterN = new Int32Array(S * S); // a summed-area table of EMODnet's water
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) { const o = (i + 1) * S + j + 1; waterN[o] = (e[(N - 1 - i) * N + j] < 0) + waterN[o - 1] + waterN[o - S] - waterN[o - S - 1]; }
  const near = (i, j) => { const a = Math.max(0, i - REACH), b = Math.min(N, i + REACH + 1), c = Math.max(0, j - REACH), d = Math.min(N, j + REACH + 1); return waterN[b * S + d] - waterN[a * S + d] - waterN[b * S + c] + waterN[a * S + c]; };
  for (let i = 0; i < N; i++) {
    const y = gRow(R0 + i), a = Math.floor(y), wr = bspline(y - a), y0 = a - 1 - gr0, er = N - 1 - i; // EMODnet's row (from the south)
    for (let j = 0; j < N; j++) {
      const k = i * N + j, v = e[er * N + j];
      if (C0 + j < 0 || C0 + j >= W || R0 + i < 0 || R0 + i >= H) { m[k] = NaN; continue; } // beyond the grid
      if (v < 0) { m[k] = v; src[k] = f[er * N + j] === 1 ? INTERPOLATED : SURVEYED; continue; }
      m[k] = 1; // land
      if (near(i, j)) continue;
      let sea = 0, ws = 0;
      for (let p = 0; p < 4; p++) for (let q = 0; q < 4; q++) { const g = win[(y0 + p) * gw + xc[j] + q], w = wr[p] * wc[j][q]; if (g < 0) { sea += w * g; ws += w; } }
      if (ws > 0) { m[k] = sea / Math.max(ws, 0.5); src[k] = FROM_GEBCO; } // faded to its own shore, as the page fades it (site/gebco.js WATER_FULL)
    }
  }
  // what the block's cells are, counted (the build's log)
  for (let i = halo; i < halo + EC; i++) {
    for (let j = halo; j < halo + EC; j++) {
      const k = i * N + j;
      if (src[k] === SURVEYED) stats.surveyed++; else if (src[k] === INTERPOLATED) stats.interpolated++; else if (src[k]) stats.gebco++; else stats.land++;
    }
  }
  // the block itself, without its margin
  const values = new Int16Array(EC * EC), source = new Int8Array(EC * EC);
  for (let i = 0; i < EC; i++) {
    for (let j = 0; j < EC; j++) {
      const k = (i + halo) * N + j + halo, v = m[k];
      values[i * EC + j] = !(v < 0) ? FILL : Math.min(-1, Math.max(-32767, Math.round(v * Q))); // land, as the fill: the page needs only to know it is; water never rounds to 0
      source[i * EC + j] = src[k];
    }
  }
  return { values, source, stats };
}

// a block's quarter of an h × w array as one chunk (CHUNK × CHUNK, padded with fill)
function part(a, w, r0, c0, fill, T) {
  const out = new T(CHUNK * CHUNK).fill(fill);
  for (let r = 0; r < CHUNK; r++) out.set(a.subarray((r0 + r) * w + c0, (r0 + r) * w + c0 + CHUNK), r * CHUNK);
  return out;
}

// ---- building, in worker threads --------------------------------------------------------------

const decoders = new Map();
async function emodnetChunk(dir, v, name) {
  if (!decoders.has(v)) decoders.set(v, JSON.parse(readFileSync(join(dir, 'dtm', '.zmetadata'))).metadata[`${v}/.zarray`]);
  const b = readFileSync(join(dir, 'dtm', v, name));
  return decode(decoders.get(v), b.length ? new Uint8Array(b.buffer, b.byteOffset, b.length) : null);
}
let gebcoStore = null;
const gebcoChunks = lru(24);
async function gebcoWindow(gdir) {
  gebcoStore ||= await openStore(join(gdir, 'zarr', 'gebco-2026', 'elevation.zarr'), async (p) => { try { const b = readFileSync(p); return new Uint8Array(b.buffer, b.byteOffset, b.length); } catch { return null; } });
  return gebcoStore;
}

// a chunk made: written, or (verify) held against the one in the store: 1 if that is missing or not the same bytes
const put = (path, d, verify) => { if (!verify) { writeFileSync(path, d); return 0; } return existsSync(path) && Buffer.from(d.buffer, d.byteOffset, d.length).equals(readFileSync(path)) ? 0 : 1; };
// one row of blocks, west to east: each with a margin of HALO cells from the chunks around it (the
// row's three chunk rows read once each, as the row goes east)
async function rowJob({ dir, gdir, out, jr, verify = false }) {
  const N = EC + 2 * HALO, held = new Map(), results = [];
  const chunkAt = (cr, cc) => { // EMODnet's chunk (row from the south), or null beyond its grid
    if (cr < 0 || cr >= ER || cc < 0 || cc >= ECOLS) return null;
    const key = `${cr}.${cc}`;
    if (!held.has(key)) held.set(key, Promise.all(VARS.map((v) => emodnetChunk(dir, v, key))));
    return held.get(key);
  };
  const s = await gebcoWindow(gdir);
  for (let jc = 0; jc < ECOLS; jc++) {
    for (const key of held.keys()) if (+key.split('.')[1] < jc - 1) held.delete(key); // west of the margin: let go
    const e = new Float32Array(N * N).fill(NaN), f = new Float32Array(N * N).fill(NaN), R0 = jr * EC - HALO, C0 = jc * EC - HALO;
    const parts = new Map();
    for (const cr of [ER - jr, ER - 1 - jr, ER - 2 - jr]) for (const cc of [jc - 1, jc, jc + 1]) { const p = chunkAt(cr, cc); if (p) parts.set(`${cr}.${cc}`, await p); }
    for (let i = 0; i < N; i++) {
      const mr = R0 + i; // the grid's row, from the north
      if (mr < 0 || mr >= H) continue;
      const gsr = H - 1 - mr, cr = Math.floor(gsr / EC), rr = gsr % EC, er = N - 1 - i;
      for (let j = 0; j < N; j++) {
        const mc = C0 + j, cc = Math.floor(mc / EC), got = mc >= 0 && parts.get(`${cr}.${cc}`);
        if (!got) continue;
        e[er * N + j] = got[0][rr * EC + (mc % EC)]; f[er * N + j] = got[1][rr * EC + (mc % EC)];
      }
    }
    // the GEBCO chunks the block and its margin read (rows jr·250 ± 4, columns from 34560 + jc·250 ± 4)
    const need = new Map(), gr0 = jr * 250 - 4, gc0 = 34560 + jc * 250 - 4;
    for (let cr = Math.floor(Math.max(0, gr0) / GEBCO_CHUNK); cr <= Math.floor((gr0 + 260) / GEBCO_CHUNK); cr++) {
      for (let cc = Math.floor(gc0 / GEBCO_CHUNK); cc <= Math.floor((gc0 + 260) / GEBCO_CHUNK); cc++) need.set(`${cr}.${cc}`, await gebcoChunks(`${cr}.${cc}`, () => s.chunk('0/elevation', [cr, cc])));
    }
    const gebco = (r, c) => { r = Math.max(0, r); return need.get(`${Math.floor(r / GEBCO_CHUNK)}.${Math.floor(c / GEBCO_CHUNK)}`)[(r % GEBCO_CHUNK) * GEBCO_CHUNK + (c % GEBCO_CHUNK)]; };
    const { values, source, stats } = mergeBlock(jr, jc, e, f, gebco, HALO);
    stats.block = [jr, jc];
    let size = 0, differ = 0;
    for (let a = 0; a < 2; a++) {
      for (let b = 0; b < 2; b++) {
        const R = 2 * jr + a, C = 2 * jc + b;
        if (C * CHUNK >= W) continue;
        const v = part(values, EC, a * CHUNK, b * CHUNK, FILL, Int16Array);
        const d = bloscEncode(new Uint8Array(v.buffer), 2);
        differ += put(join(out, 'elevation.zarr', '0', 'elevation', `${R}.${C}`), d, verify);
        const sc = bloscEncode(new Uint8Array(part(source, EC, a * CHUNK, b * CHUNK, 0, Int8Array).buffer), 1);
        differ += put(join(out, 'source.zarr', '0', 'source', `${R}.${C}`), sc, verify);
        size += d.length + sc.length;
      }
    }
    results.push({ size, stats, differ });
  }
  return results;
}

// level k chunk (R, C) from level k − 1's four below it. Elevation: 2 × 2 means, a half upwards.
// Source: GEBCO's where most of the 2 × 2 with a depth are, else the more common of EMODnet's two
// kinds (interpolated on a tie: the less certain); 0 where none has a depth
const META_ELEV = { chunks: [CHUNK, CHUNK], dtype: '<i2', fill_value: FILL, compressor: { id: 'blosc' }, filters: null };
const META_SRC = { chunks: [CHUNK, CHUNK], dtype: '|i1', fill_value: 0, compressor: { id: 'blosc' }, filters: null };
async function levelJob({ out, k, R, C, source = false, verify = false }) {
  const [store, name, metaOf, T] = source ? ['source.zarr', 'source', META_SRC, Int8Array] : ['elevation.zarr', 'elevation', META_ELEV, Int16Array];
  const dirBelow = join(out, store, String(k - 1), name), below = new T(4 * CHUNK * CHUNK).fill(metaOf.fill_value);
  for (let a = 0; a < 2; a++) {
    for (let b = 0; b < 2; b++) {
      const p = join(dirBelow, `${2 * R + a}.${2 * C + b}`), raw = existsSync(p) ? readFileSync(p) : null; // none: beyond the grid
      const v = await decode(metaOf, raw && new Uint8Array(raw.buffer, raw.byteOffset, raw.length));
      for (let r = 0; r < CHUNK; r++) below.set(v.subarray(r * CHUNK, (r + 1) * CHUNK), (a * CHUNK + r) * 2 * CHUNK + b * CHUNK);
    }
  }
  const v = new T(CHUNK * CHUNK), w2 = 2 * CHUNK;
  for (let r = 0; r < CHUNK; r++) {
    for (let c = 0; c < CHUNK; c++) {
      const i = 2 * r * w2 + 2 * c, four = [below[i], below[i + 1], below[i + w2], below[i + w2 + 1]];
      if (source) { let s1 = 0, s2 = 0, s3 = 0; for (const x of four) { if (x === SURVEYED) s1++; else if (x === INTERPOLATED) s2++; else if (x === FROM_GEBCO) s3++; } v[r * CHUNK + c] = s1 + s2 + s3 === 0 ? 0 : s3 > s1 + s2 ? FROM_GEBCO : s1 > s2 ? SURVEYED : INTERPOLATED; continue; }
      let sum = 0, n = 0;
      for (const x of four) if (x < 0) { sum += x; n++; }
      v[r * CHUNK + c] = n ? Math.floor((sum + n / 2) / n) : FILL; // the water's mean, a half upwards; land where none is
    }
  }
  const d = bloscEncode(new Uint8Array(v.buffer), source ? 1 : 2);
  return { size: d.length, differ: put(join(out, store, String(k), name, `${R}.${C}`), d, verify) };
}

if (!isMainThread && workerData?.emodnet) parentPort.on('message', async (j) => parentPort.postMessage(await (j.k ? levelJob(j) : rowJob(j))));

const zarray = (shape, chunks, dtype, fill, typesize) => ({ zarr_format: 2, shape, chunks, dtype, compressor: { id: 'blosc', cname: 'zlib', clevel: 9, shuffle: typesize > 1 ? 1 : 0, blocksize: 0 }, fill_value: fill, order: 'C', filters: null });

// work(run) with a pool of workers: run(jobs, each) gives each job to a free one, each(result) as they end
async function withPool(workers, work) {
  const pool = Array.from({ length: workers }, () => new Worker(fileURLToPath(import.meta.url), { workerData: { emodnet: true } }));
  const run = (jobs, each) => new Promise((resolve, reject) => {
    let next = 0, done = 0;
    if (!jobs.length) { resolve(); return; }
    const give = (w) => { if (next < jobs.length) w.postMessage(jobs[next++]); };
    for (const w of pool) {
      w.removeAllListeners('message').removeAllListeners('error');
      w.on('message', (r) => { each(r); if (++done === jobs.length) resolve(); else give(w); });
      w.on('error', reject);
      give(w);
    }
  });
  try { return await work(run); } finally { await Promise.all(pool.map((p) => p.terminate())); }
}
// the chunks of level k of a store: [R, C] each
const chunksOf = (k) => { const out = []; for (let R = 0; R < Math.ceil(H / 2 ** k / CHUNK); R++) for (let C = 0; C < Math.ceil(W / 2 ** k / CHUNK); C++) out.push([R, C]); return out; };

// sourceOnly: the source grid's levels above 0 alone, from a level 0 already built
export async function build(dir, gdir, { out = join(dir, 'zarr', RELEASE), workers = cpus().length, levels = LEVELS, rows = null, sourceOnly = false, log = console.log } = {}) {
  const t0 = Date.now();
  if (!sourceOnly) rmSync(out, { recursive: true, force: true });
  for (let k = 0; k < levels; k++) mkdirSync(join(out, 'elevation.zarr', String(k), 'elevation'), { recursive: true });
  for (let k = 0; k < levels; k++) mkdirSync(join(out, 'source.zarr', String(k), 'source'), { recursive: true });
  let size = 0;
  const totals = { surveyed: 0, interpolated: 0, gebco: 0, land: 0 };
  await withPool(workers, async (run) => {
    const jobs = [];
    for (let jr = 0; jr < (sourceOnly ? 0 : ER); jr++) if (!rows || rows.includes(jr)) jobs.push({ dir, gdir, out, jr });
    let n = 0;
    await run(jobs, (row) => {
      for (const { size: sz, stats } of row) {
        size += sz;
        for (const key of Object.keys(totals)) totals[key] += stats[key];
      }
      if (++n % 8 === 0) log(`level 0: ${n} of ${jobs.length} block rows, ${(size / 1e9).toFixed(2)} GB, ${((Date.now() - t0) / 60e3).toFixed(1)} min`);
    });
    log(`level 0: ${(size / 1e9).toFixed(2)} GB, ${((Date.now() - t0) / 60e3).toFixed(1)} min`);
    for (let k = 1; k < levels; k++) {
      const lj = [];
      for (const [R, C] of chunksOf(k)) { if (!sourceOnly) lj.push({ out, k, R, C }); lj.push({ out, k, R, C, source: true }); }
      await run(lj, ({ size: s }) => { size += s; });
      log(`level ${k}: ${(size / 1e9).toFixed(2)} GB in all, ${((Date.now() - t0) / 60e3).toFixed(1)} min`);
    }
  });
  // metadata (coordinates per level, as GEBCO's store has them)
  const meta = { '.zgroup': { zarr_format: 2 } }, smeta = { '.zgroup': { zarr_format: 2 } };
  for (let k = 0; k < levels; k++) {
    const h = H / 2 ** k, w = W / 2 ** k, cs = CELL * 2 ** k;
    for (const [coord, n, at, units] of [['latitude', h, (i) => NORTH - (i + 0.5) * cs, 'degrees_north'], ['longitude', w, (i) => WEST + (i + 0.5) * cs, 'degrees_east']]) {
      mkdirSync(join(out, 'elevation.zarr', String(k), coord), { recursive: true });
      writeFileSync(join(out, 'elevation.zarr', String(k), coord, '0'), new Uint8Array(Float64Array.from({ length: n }, (_, i) => at(i)).buffer));
      meta[`${k}/${coord}/.zarray`] = { zarr_format: 2, shape: [n], chunks: [n], dtype: '<f8', compressor: null, fill_value: null, order: 'C', filters: null };
      meta[`${k}/${coord}/.zattrs`] = { _ARRAY_DIMENSIONS: [coord], units, standard_name: coord };
    }
    meta[`${k}/elevation/.zarray`] = zarray([h, w], [CHUNK, CHUNK], '<i2', FILL, 2);
    meta[`${k}/elevation/.zattrs`] = { _ARRAY_DIMENSIONS: ['latitude', 'longitude'], units: 'm', scale_factor: 1 / Q, long_name: 'Elevation (negative below the sea): EMODnet\'s depths; GEBCO\'s where EMODnet has no water near', cell_size_degrees: cs, north: NORTH, west: WEST };
    meta[`${k}/.zgroup`] = { zarr_format: 2 };
    meta[`${k}/.zattrs`] = { cell_size_degrees: cs };
  }
  const credit = 'EMODnet Bathymetry Consortium (2024): EMODnet Digital Bathymetry (DTM 2024), doi:10.12770/cf51df64-56f9-4a99-b1aa-36b8d7b743a1, CC BY 4.0; GEBCO Compilation Group (2026) GEBCO 2026 Grid, https://www.gebco.net';
  meta['.zattrs'] = { title: 'EMODnet DTM 2024 over its area, as a multiscale Zarr store', source: credit,
    history: 'Level 0: EMODnet\'s water cells, surveyed and interpolated; land elsewhere, but GEBCO 2026 resampled (cubic B-spline over its water cells) where EMODnet has no water within 5 cells; quarter metres; land one value, 100 m. Level k+1: mean of the water among 2 x 2 cells of level k, land where none is. Built for Earth Plotter (tools/emodnet.mjs).' };
  for (let k = 0; k < levels; k++) {
    smeta[`${k}/.zgroup`] = { zarr_format: 2 };
    smeta[`${k}/source/.zarray`] = zarray([H / 2 ** k, W / 2 ** k], [CHUNK, CHUNK], '|i1', 0, 1);
    smeta[`${k}/source/.zattrs`] = { _ARRAY_DIMENSIONS: ['latitude', 'longitude'], flag_values: [0, 1, 2, 3], flag_meanings: 'land emodnet_surveyed emodnet_interpolated gebco', cell_size_degrees: CELL * 2 ** k, north: NORTH, west: WEST };
  }
  smeta['.zattrs'] = { title: 'Where each cell of the depths comes from', source: credit };
  for (const [store, m] of [['elevation.zarr', meta], ['source.zarr', smeta]]) {
    for (const [key, v] of Object.entries(m)) writeFileSync(join(out, store, key), JSON.stringify(v));
    writeFileSync(join(out, store, '.zmetadata'), JSON.stringify({ zarr_consolidated_format: 1, metadata: m }));
  }
  if (sourceOnly) log(`done: the source grid's levels, ${((Date.now() - t0) / 60e3).toFixed(1)} min`);
  else log(`done: ${(size / 1e9).toFixed(2)} GB in ${((Date.now() - t0) / 60e3).toFixed(1)} min; water cells: EMODnet surveyed ${totals.surveyed}, interpolated ${totals.interpolated}, GEBCO ${totals.gebco}`);
  return { out, size, totals };
}

// ---- verify: the store against its sources -------------------------------------------------------
// Every chunk of every level there (one missing is a broken build or upload: the page fails on it);
// then `rows` rows of blocks, spread from north to south, made again from EMODnet's chunks and
// GEBCO's store, and as many chunks of each level above made again from the level below: each the
// same bytes as the store's. Nothing written. Resolves to whether all is as it should be.
export async function verify(dir, gdir, { out = join(dir, 'zarr', RELEASE), workers = cpus().length, levels = LEVELS, rows = 8, log = console.log } = {}) {
  const t0 = Date.now(), spread = (list, n) => Array.from({ length: Math.min(n, list.length) }, (_, i) => list[Math.floor(((i + 0.5) * list.length) / Math.min(n, list.length))]);
  let missing = 0, differ = 0, made = 0;
  for (const [store, name] of [['elevation.zarr', 'elevation'], ['source.zarr', 'source']]) {
    if (!existsSync(join(out, store, '.zmetadata'))) { missing++; log(`MISSING ${store}/.zmetadata`); }
    for (let k = 0; k < levels; k++) for (const [R, C] of chunksOf(k)) if (!existsSync(join(out, store, String(k), name, `${R}.${C}`))) { if (missing++ < 20) log(`MISSING ${store}/${k}/${name}/${R}.${C}`); }
  }
  log(missing ? `${missing} files missing` : 'every chunk is there');
  await withPool(workers, async (run) => {
    await run(spread(Array.from({ length: ER }, (_, jr) => jr), rows).map((jr) => ({ dir, gdir, out, jr, verify: true })), (row) => { for (const b of row) { made += 4; differ += b.differ; if (b.differ) log(`DIFFERS level 0, block ${b.stats.block.join('.')}`); } });
    log(`level 0: ${rows} rows of blocks made again, ${differ} chunks differ, ${((Date.now() - t0) / 60e3).toFixed(1)} min`);
    for (let k = 1; k < levels; k++) {
      const jobs = spread(chunksOf(k), rows * 8).flatMap(([R, C]) => [{ out, k, R, C, verify: true }, { out, k, R, C, source: true, verify: true }]);
      let d = 0;
      await run(jobs, (r) => { made++; d += r.differ; });
      differ += d;
      log(`level ${k}: ${jobs.length} chunks made again, ${d} differ`);
    }
  });
  log(`${missing || differ ? 'FAILED' : 'ok'}: ${made} chunks made again, ${differ} differ, ${missing} missing, ${((Date.now() - t0) / 60e3).toFixed(1)} min`);
  return !missing && !differ;
}

if (isMainThread && process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, dir, gdir] = process.argv.slice(2), opt = (k) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
  if (!dir || (cmd !== 'download' && !gdir)) { console.error('usage: node tools/emodnet.mjs download DIR | build DIR GEBCO_DIR [--workers N] | source-levels DIR GEBCO_DIR | verify DIR GEBCO_DIR [--rows N]'); process.exit(2); }
  if (cmd === 'download') process.exit((await download(dir)) ? 0 : 1);
  else if (cmd === 'build') await build(dir, gdir, { workers: Number(opt('workers')) || undefined });
  else if (cmd === 'source-levels') await build(dir, gdir, { workers: Number(opt('workers')) || undefined, sourceOnly: true });
  else if (cmd === 'verify') process.exit((await verify(dir, gdir, { workers: Number(opt('workers')) || undefined, rows: Number(opt('rows')) || undefined })) ? 0 : 1);
  else { console.error(`unknown command ${cmd}`); process.exit(2); }
}
