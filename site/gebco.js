// GEBCO 2026 for the map: its grids of 15″ cells, published as multiscale Zarr stores (tools/gebco.mjs
// builds them, catalog.js says where), sampled at a tile's pixel centres. Each zoom reads the
// coarsest level whose cells are no larger than its pixels (level 0, GEBCO's own cells, from zoom 8
// up). Chunks (512 × 512 cells, about 2° at level 0) are shared by many neighbouring tiles: the
// latest are kept.
//   gebcoTile   the sea's depths for the elevation tiles (clip.js): a cubic B-spline over 4 × 4 cells,
//               in floating point, so no precision is lost however far the map zooms in, and
//               isobaths curve through GEBCO's whole metres instead of breaking at its cells (a
//               straight-line interpolation left a wave one cell long on flat shelves); the
//               spline barely moves anything smaller than a cell, below what the data resolves.
//               Two blends from the one pass: raw, over every cell, what inland water is classified
//               from; sea, over the water cells only, the sea's drawn depths: a land cell beside the
//               shore (tens of metres up) no longer pulls the water next to it shallower over a
//               cell's width. Where water holds less than WATER_FULL of the weights (the OSM sea
//               beyond GEBCO's coast: a harbour basin it calls land), its depth is divided by
//               WATER_FULL instead, so it fades to the shore over about a cell: divided by its own
//               weight, a single water cell at the window's edge drew its whole depth at once, and
//               every isobath down to it on one line (the port of La Spezia: 0 to 33 m in 50 m)
//   tidTile     where the depths come from (the type identifier grid): each cell's own code,
//               coloured by its group (catalog.js DEPTH_SOURCES), a MapLibre tile handler
//   tidAt       the code of the cell at a point (the depth on a click)
import { openStore } from './zarr.js';
import { latOf, tileBounds, TILE } from './geo.js';
import { fetchBytes, lru } from './net.js';
import { GEBCO, GEBCO_TID, DEPTH_SOURCES, EMODNET, EMODNET_SOURCE, EMODNET_AREA } from './catalog.js';
import { rgbOf } from './format.js';

const SIZE = TILE, CELL = 15 / 3600, KEEP = 96, WATER_FULL = 0.5; // KEEP: chunks kept of each store (512 kB each at most): a zoomed-out view's, and its neighbours'


const stores = lru(Infinity);
// a store, the map's and the GIS export's (values.js): every chunk of it is written (tools/gebco.mjs),
// so one the host has not got is a failure (a broken upload), never the fill value read as the deepest sea
export const gebcoStore = (url) => stores(url, () => openStore(url, async (u) => { const b = await fetchBytes(u); if (!b) throw new Error(`Depths: ${new URL(u).pathname.slice(1)} is missing`); return b; })); // named with its store: GEBCO's or EMODnet's

// a store's grid, as its level 0 says: cell size, its north-west corner, levels, whether it goes round
// the world (GEBCO's store says none of it: 15″ cells from 90° N, 180° W)
const grids = new Map();
function gridOf(s, url, variable) {
  if (!grids.has(url)) {
    const a = s.meta(`0/${variable}`).attrs, cell = a.cell_size_degrees ?? CELL;
    let levels = 0;
    while (s.meta(`${levels}/${variable}`)) levels++;
    grids.set(url, { cell, north: a.north ?? 90, west: a.west ?? -180, levels, global: Math.abs(s.meta(`0/${variable}`).shape[1] * cell - 360) < cell });
  }
  return grids.get(url);
}
// the level for tiles of zoom z: the coarsest whose cells are no larger than the tile's pixels
const levelFor = (z, g) => Math.max(0, Math.min(g.levels - 1, Math.floor(Math.log2(360 / (SIZE * 2 ** z) / g.cell))));

// Where EMODnet's grid is read (catalog.js EMODNET_AREA). inside: how far inside the area a point is,
// in degrees (the deepest it is in any one box; 0 or less outside). Within EDGE of the area's edge the
// two grids are blended, from GEBCO's at the edge to EMODnet's, so that no line breaks there
const EDGE = 0.25;
export const inside = (lon, lat) => Math.max(...EMODNET_AREA.map(([w, s, e, n]) => Math.min(lon - w, e - lon, lat - s, n - lat)));
// a tile against the area: 0 beyond it, 1 EDGE inside it or more all over, else 0.5 (to ask per pixel)
function tileIn(z, x, y) {
  const [w, s, e, n] = tileBounds(z, x, y);
  if (EMODNET_AREA.some(([bw, bs, be, bn]) => w >= bw + EDGE && e <= be - EDGE && s >= bs + EDGE && n <= bn - EDGE)) return 1;
  return EMODNET_AREA.some(([bw, bs, be, bn]) => w < be && e > bw && s < bn && n > bs) ? 0.5 : 0;
}
// each pixel of a tile on the area's edge: (i, j) → how far inside, in EDGEs (1 or more: EMODnet's alone)
function pixelIn(z, x, y) {
  const N = 2 ** z, lats = Float64Array.from({ length: SIZE }, (_, j) => latOf((y + (j + 0.5) / SIZE) / N));
  return (i, j) => inside(((x + (i + 0.5) / SIZE) / N) * 360 - 180, lats[j]) / EDGE;
}
// `store level/row.col` → promise of the chunk's cells, kept store by store: a view in European seas
// reads two grids, and one's chunks would push the other's out within the view
const kept = new Map();
const chunks = (key, make) => { const url = key.slice(0, key.indexOf(' ')); if (!kept.has(url)) kept.set(url, lru(KEEP)); return kept.get(url)(key, make); };

// a grid's values at the pixel centres of 256 px Web Mercator tile z/x/y, row-major, north up:
// each pixel its cell's own value (nearest: codes), or smoothly interpolated (a cubic B-spline), as
// { raw, sea }: over every cell, and over the cells below sea level alone where any is (exported
// for the unit tests)
export async function gridTile(url, variable, z, x, y, nearest) {
  const s = await gebcoStore(url), g = gridOf(s, url, variable), k = levelFor(z, g), name = `${k}/${variable}`, meta = s.meta(name);
  const [H, W] = meta.shape, [CH, CW] = meta.chunks, cs = g.cell * 2 ** k, n = 2 ** z, scale = meta.attrs.scale_factor ?? 1;
  // each pixel centre's place in the grid, in cells (0.5 off a cell's corner is its centre)
  const col = Float64Array.from({ length: SIZE }, (_, i) => (((x + (i + 0.5) / SIZE) / n) * 360 - 180 - g.west) / cs - 0.5);
  const row = Float64Array.from({ length: SIZE }, (_, j) => (g.north - latOf((y + (j + 0.5) / SIZE) / n)) / cs - 0.5);
  const r0 = Math.floor(row[0]) - 1, r1 = Math.floor(row[SIZE - 1]) + 2;
  const c0 = Math.floor(col[0]) - 1, c1 = Math.floor(col[SIZE - 1]) + 2;
  // a cell's place: wrapped across the antimeridian and clamped at the poles (the world's grid), or
  // −1 beyond a regional one
  const colAt = (c) => (g.global ? ((c % W) + W) % W : c >= 0 && c < W ? c : -1);
  const rowAt = (r) => (g.global ? Math.min(H - 1, Math.max(0, r)) : r >= 0 && r < H ? r : -1);
  // the chunks those cells are in, fetched together
  const need = new Map(), chunkCols = new Set(), chunkRows = new Set();
  for (let c = c0; c <= c1; c++) if (colAt(c) >= 0) chunkCols.add(Math.floor(colAt(c) / CW)); // a tile spans a few hundred cells at most
  for (let r = r0; r <= r1; r++) if (rowAt(r) >= 0) chunkRows.add(Math.floor(rowAt(r) / CH));
  for (const cr of chunkRows) for (const cc of chunkCols) { const key = `${url} ${k}/${cr}.${cc}`; need.set(key, chunks(key, () => s.chunk(name, [cr, cc]))); }
  const got = new Map(await Promise.all([...need].map(async ([key, p]) => [key, await p])));
  // the cells around the tile as one block (rows r0…r1, columns c0…c1), copied from their chunks
  // once, so that sampling below is plain indexing; NaN beyond a regional grid
  const ww = c1 - c0 + 1, wh = r1 - r0 + 1, win = new Float32Array(ww * wh).fill(NaN);
  const colChunk = new Int32Array(ww), colOff = new Int32Array(ww);
  for (let x = 0; x < ww; x++) { const c = colAt(c0 + x); colChunk[x] = c < 0 ? -1 : Math.floor(c / CW); colOff[x] = c % CW; }
  for (let y = 0; y < wh; y++) {
    const r = rowAt(r0 + y);
    if (r < 0) continue;
    const cr = Math.floor(r / CH), ro = (r % CH) * CW;
    let cc = -1, block = null;
    for (let x = 0; x < ww; x++) {
      if (colChunk[x] < 0) continue;
      if (colChunk[x] !== cc) { cc = colChunk[x]; block = got.get(`${url} ${k}/${cr}.${cc}`); } // a new chunk: a few times a row
      win[y * ww + x] = block[ro + colOff[x]] * scale;
    }
  }
  const at = (r, c) => win[(r - r0) * ww + (c - c0)];
  const out = new Float32Array(SIZE * SIZE);
  if (nearest) {
    for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) out[j * SIZE + i] = at(Math.round(row[j]), Math.round(col[i]));
    return out;
  }
  const seaOut = new Float32Array(SIZE * SIZE);
  // cubic B-spline weights of the four cells around t ∈ [0, 1): the columns' once for the tile
  const bs = (t, w, o) => { const t2 = t * t, t3 = t2 * t; w[o] = (1 - t) ** 3 / 6; w[o + 1] = (3 * t3 - 6 * t2 + 4) / 6; w[o + 2] = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6; w[o + 3] = t3 / 6; };
  const wc = new Float64Array(SIZE * 4), cx = new Int32Array(SIZE), wr = new Float64Array(4);
  for (let i = 0; i < SIZE; i++) { const ca = Math.floor(col[i]); cx[i] = ca - 1 - c0; bs(col[i] - ca, wc, i * 4); }
  for (let j = 0; j < SIZE; j++) {
    const ra = Math.floor(row[j]);
    bs(row[j] - ra, wr, 0);
    const rows4 = [0, 1, 2, 3].map((a) => (ra - 1 + a - r0) * ww);
    for (let i = 0; i < SIZE; i++) {
      const x = cx[i], o = i * 4;
      let sum = 0, sea = 0, ws = 0;
      for (let a = 0; a < 4; a++) {
        const b = rows4[a] + x;
        for (let k = 0; k < 4; k++) {
          const v = win[b + k], w = wr[a] * wc[o + k];
          sum += w * v;
          if (v < 0) { sea += w * v; ws += w; }
        }
      }
      out[j * SIZE + i] = sum;
      seaOut[j * SIZE + i] = ws > 0 ? sea / Math.max(ws, WATER_FULL) : sum;
    }
  }
  return { raw: out, sea: seaOut };
}

// metres at the pixel centres of tile z/x/y, { raw, sea } as above; rejects if the store cannot be
// read (the tile fails, as any tile does: the map reports it)
export const gebcoTile = (z, x, y) => gridTile(GEBCO, 'elevation', z, x, y, false);
// the same, the sea's depths EMODnet's over its area (tools/emodnet.mjs: its grid whole, 1/16′ cells);
// raw, the heights inland water is classified from, always GEBCO's. On the area's edge the two are
// blended (above); a pixel whose cells reach beyond EMODnet's grid is GEBCO's
export async function seaTile(z, x, y) {
  const where = tileIn(z, x, y);
  if (!where) return gebcoTile(z, x, y);
  // EMODnet's store not to be opened at all (the network's own failure, not the host's answer) where
  // GEBCO's tile is read, from the same host: an offline area saved before EMODnet's grid was read,
  // which keeps GEBCO's alone. (A chunk of a store that opened failing is a tile failed, asked again.) Drawn from those, rather than nothing; a click there names no grid (app.js)
  const [m, g] = await Promise.all([gebcoStore(EMODNET).then(() => gridTile(EMODNET, 'elevation', z, x, y, false), (e) => { if (e instanceof TypeError) return null; throw e; }), gebcoTile(z, x, y)]);
  if (!m) return g;
  const t = where < 1 ? pixelIn(z, x, y) : null;
  for (let j = 0, p = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++, p++) {
      if (Number.isNaN(m.raw[p])) { m.sea[p] = g.sea[p]; continue; }
      if (!t) continue;
      const k = Math.max(0, t(i, j));
      if (k < 1 && m.sea[p] < 0 && g.sea[p] < 0) m.sea[p] = k * m.sea[p] + (1 - k) * g.sea[p];
      else if (k === 0) m.sea[p] = g.sea[p];
    }
  }
  return { raw: g.raw, sea: m.sea };
}

// MapLibre tile handler for gebco-tid://grid/z/x/y: each cell coloured by the group of its code; land and
// no data transparent. Over EMODnet's area the depths drawn are EMODnet's (seaTile), so the cell is
// EMODnet's own account of it: its survey, or its interpolation (drawn as estimated); GEBCO's code
// where the depth is GEBCO's, and nothing where EMODnet has land under OSM's sea. Grid 'gebco': GEBCO's
// codes everywhere, as the depths then are
const RGBA = new Uint8ClampedArray(128 * 4); // code × 4 → r, g, b, 255 of its group (alpha 0: not drawn)
for (const { ranges, colour } of DEPTH_SOURCES) for (const [lo, hi] of ranges) for (let c = lo; c <= hi; c++) RGBA.set([...rgbOf(colour), 255], c * 4);
const OWN_CODE = [0, DEPTH_SOURCES.find((g) => g.emodnet === 'surveyed').ranges[0][0], DEPTH_SOURCES.find((g) => g.emodnet === 'interpolated').ranges[0][0]]; // EMODnet's kind → a code of the group it is drawn as
export async function tidTile({ url }) {
  const [grid, ...zxy] = /^gebco-tid:\/\/(\w+)\/(\d+)\/(\d+)\/(\d+)$/.exec(url).slice(1), [z, x, y] = zxy.map(Number);
  const where = grid === 'gebco' ? 0 : tileIn(z, x, y), t = where && where < 1 ? pixelIn(z, x, y) : null; // on the area's edge: EMODnet's account where its depth weighs more
  const [codes, own] = await Promise.all([gridTile(GEBCO_TID, 'tid', z, x, y, true), where ? gridTile(EMODNET_SOURCE, 'source', z, x, y, true) : null]), img = new ImageData(SIZE, SIZE);
  const d = img.data; // 65k cells a tile, on the page's thread: bytes written in place, nothing allocated per cell
  for (let p = 0, q = 0; p < codes.length; p++, q += 4) {
    const o = own && (!t || t(p % SIZE, Math.floor(p / SIZE)) >= 0.5) ? own[p] : 3, k = (o === 1 || o === 2 ? OWN_CODE[o] : o === 0 ? 0 : codes[p]) * 4; // own: NaN beyond EMODnet's grid, 3 GEBCO's depth there: GEBCO's code; 0 land to EMODnet, no depth of its own: not drawn
    if (RGBA[k + 3]) { d[q] = RGBA[k]; d[q + 1] = RGBA[k + 1]; d[q + 2] = RGBA[k + 2]; d[q + 3] = 255; }
  }
  return { data: await createImageBitmap(img) };
}

// what EMODnet's cell holding lon/lat is (tools/emodnet.mjs): 1 surveyed, 2 interpolated from its
// neighbours (no soundings there), 0 land to EMODnet (sea to OSM: the water beside it, faded to the
// shore); 3 GEBCO's depth: where EMODnet has no water near, and beyond its area
export async function emodnetAt(lon, lat) {
  if (inside(lon, lat) < EDGE / 2) return 3; // beyond the area, or on its edge where GEBCO's depth weighs more
  const s = await gebcoStore(EMODNET_SOURCE), name = '0/source', meta = s.meta(name), [CH, CW] = meta.chunks, cs = meta.attrs.cell_size_degrees;
  const r = Math.floor((meta.attrs.north - lat) / cs), c = Math.floor((lon - meta.attrs.west) / cs), cr = Math.floor(r / CH), cc = Math.floor(c / CW);
  return (await chunks(`${EMODNET_SOURCE} 0/${cr}.${cc}`, () => s.chunk(name, [cr, cc])))[(r % CH) * CW + (c % CW)];
}

// GEBCO's type identifier code of the 15″ cell holding lon/lat: how its depth was obtained
export async function tidAt(lon, lat) {
  const s = await gebcoStore(GEBCO_TID), name = '0/tid', meta = s.meta(name), [H, W] = meta.shape, [CH, CW] = meta.chunks;
  const r = Math.min(H - 1, Math.max(0, Math.floor((90 - lat) / CELL))), c = ((Math.floor((lon + 180) / CELL) % W) + W) % W;
  const cells = await chunks(`${GEBCO_TID} 0/${Math.floor(r / CH)}.${Math.floor(c / CW)}`, () => s.chunk(name, [Math.floor(r / CH), Math.floor(c / CW)]));
  return cells[(r % CH) * CW + (c % CW)];
}
