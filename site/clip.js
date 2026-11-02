// Elevation tiles cut to the OSM coastline before the map sees them.
//
// The sea's depths come from GEBCO (gebco.js, at every zoom), the land's heights from the
// Terrarium DEM. Each has its own coastline, which does not match OSM's: depth tint and
// isobaths stopped short of the shore or ran onto land, and relief shading smeared into the
// sea. Each tile is therefore masked with the OSM sea polygons (OpenMapTiles `water`, class
// ocean/dock) that the basemap itself draws, so the two coastlines agree by construction:
//   sea  tiles: land → +1 m (no tint, outside every isobath); sea the grid calls
//               ≥ 0 m → −1 m (unknown depth is shown as the shallowest class);
//               inland water at sea level (limans, lagoons, harbour basins) → −1 m
//               flat (no depth, no isobaths); lakes above it → NO_DEPTH_M (grey)
//   land tiles: sea → 0 m (no relief or contours in the water)
// The depths are drawn as GEBCO has them: no filter; the spline that samples its cells smooths
// nothing larger than a cell (gebco.js).

import { NO_DEPTH_M, OMT_MAX, ISOBATH_STEPS, ISOBATH_TRACE } from './catalog.js';
import { traceLines, clipLines, encodeLines, EXTENT } from './isobaths.js';
import { HOSTS } from './hosts.js';
import { gebcoTile } from './gebco.js';
import { latOf, tileBounds, TILE } from './geo.js';
import { fetchOk, fetchBytes, tileUrl, lru } from './net.js';

// Every tile is cut, at every zoom: each shortcut tried (deep ocean, low zooms) left a hole
// somewhere (islands under the tint, isobaths across the Jordan valley, seabed relief over
// satellite imagery).

// Water bodies whose surface is not at sea level but which OSM maps with a coastline
// (so they arrive as `ocean`). Depths inside them are measured from that surface.
// [name, [west, south, east, north], surface elevation m] (GEBCO gives the Caspian's bed relative
// to sea level: −36 m in the north, −630 m in the south)
export const DATUMS = [
  ['Caspian Sea', [46.5, 36.5, 55.2, 47.4], -28],
];
const SEA_CLASSES = new Set(['ocean', 'dock']);
// Inland water (OSM lagoons, limans, harbour basins, lakes) is classified once per water
// body, from the elevation along its shoreline (its polygon's vertices, relative to any DATUMS
// surface there), and remembered by OSM id so every tile agrees (each clipper its own memory: the
// sea's from GEBCO, the land's from the DEM). It is at sea level when the
// shore both dips to within this of sea level somewhere (lower quartile ≤ +8 m: a raised lake's
// does not) and rises to within it somewhere (upper quartile ≥ −8 m: the Dead Sea's, Galilee's,
// Salton Sea's do not). Shore values are noisy by several metres and OSM splits one liman
// into several polygons, so the margin sits above that noise (Odesa limans: 0–7 m).
const SEA_LEVEL_WATER_M = 8;
// what a water body shows (also the values of the water mask, 0 being land): DEPTH real depths
// (the sea, or a DATUMS water body), FLAT inland water at sea level, LAKE no depth source
const DEPTH = 1, FLAT = 2, LAKE = 3;
// land value in the shaded sea tiles: pulls the tint edge back to the
// water pixels, so it never covers the shore line; the sliver it leaves shows the water fill,
// which app.js colours like the shallowest band while depth shading is on
const LAND_SHADE_M = 500;
const SIZE = TILE;

// ---- minimal Mapbox Vector Tile reader: just the `water` polygons ----------------
function reader(buf) {
  let p = 0;
  const r = {
    get done() { return p >= buf.length; },
    varint() { let v = 0, s = 0, b; do { b = buf[p++]; v += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return v; },
    bytes() { const n = r.varint(); const out = buf.subarray(p, p + n); p += n; return out; },
    skip(wire) { if (wire === 0) r.varint(); else if (wire === 1) p += 8; else if (wire === 2) p += r.varint(); else if (wire === 5) p += 4; else throw new Error(`bad wire type ${wire}`); },
  };
  return r;
}
const text = new TextDecoder();
const zigzag = (n) => (n >>> 1) ^ -(n & 1);
function packed(bytes) { const r = reader(bytes), out = []; while (!r.done) out.push(r.varint()); return out; }

// → { extent, features: [{ cls, rings: [[x, y, x, y …], …] }] } for the `water` layer
function waterLayer(buf) {
  const t = reader(buf);
  while (!t.done) {
    const key = t.varint();
    if (key >> 3 !== 3 || (key & 7) !== 2) { t.skip(key & 7); continue; }
    const l = reader(t.bytes());
    let name = '', extent = 4096;
    const feats = [], keys = [], values = [];
    while (!l.done) {
      const k = l.varint(), f = k >> 3;
      if (f === 1) name = text.decode(l.bytes());
      else if (f === 2) feats.push(l.bytes());
      else if (f === 3) keys.push(text.decode(l.bytes()));
      else if (f === 4) {
        const v = reader(l.bytes());
        let s = null;
        while (!v.done) { const vk = v.varint(); if (vk >> 3 === 1 && (vk & 7) === 2) s = text.decode(v.bytes()); else v.skip(vk & 7); }
        values.push(s);
      } else if (f === 5) extent = l.varint();
      else l.skip(k & 7);
    }
    if (name !== 'water') continue;
    const classKey = keys.indexOf('class');
    const features = [];
    for (const fb of feats) {
      const fr = reader(fb);
      let tags = [], type = 0, geom = [], id = 0;
      while (!fr.done) {
        const k = fr.varint(), f = k >> 3;
        if (f === 1) id = fr.varint();
        else if (f === 2) tags = packed(fr.bytes());
        else if (f === 3) type = fr.varint();
        else if (f === 4) geom = packed(fr.bytes());
        else fr.skip(k & 7);
      }
      if (type !== 3) continue;
      let cls = null;
      for (let i = 0; i < tags.length; i += 2) if (tags[i] === classKey) cls = values[tags[i + 1]];
      const rings = [];
      let x = 0, y = 0, ring = null;
      for (let i = 0; i < geom.length;) {
        const cmd = geom[i++], id = cmd & 7, n = cmd >> 3;
        if (id === 7) { if (ring) rings.push(ring); ring = null; continue; }
        for (let j = 0; j < n && i + 1 < geom.length; j++) { // never past the data, whatever the count says
          x += zigzag(geom[i++]); y += zigzag(geom[i++]);
          if (id === 1) { if (ring) rings.push(ring); ring = [x, y]; } else ring.push(x, y);
        }
      }
      if (ring) rings.push(ring);
      features.push({ cls, id, rings });
    }
    return { extent, features };
  }
  return { extent: 4096, features: [] };
}

const omtCache = lru(48); // promises of tiles (net.js lru): shared by neighbouring requests

// the `water` layer of OpenMapTiles tile oz/ox/oy (cached); a tile empty (204) or not there: none
function omtLayer(omtTemplate, oz, ox, oy) {
  return omtCache(`${oz}/${ox}/${oy}`, async () => waterLayer((await fetchBytes(tileUrl(await omtTemplate(), oz, ox, oy))) ?? new Uint8Array(0)));
}

// surface of the DATUMS water body at lon/lat, or 0 (sea level)
export const datumAt = (lon, lat) => {
  for (const [, b, h0] of DATUMS) if (lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]) return h0;
  return 0;
};

// Shore samples of water body `id` from the nearest lower-zoom OpenMapTiles tile that contains
// its shoreline: a tile that shows only the inside of a large lagoon has none of its own.
// OpenMapTiles keeps a water body's id across zooms. Heights come from the elevation tile that
// matches that zoom. Returns { vals, datum } or null.
async function ancestorShore(ctx, id, oz, ox, oy) {
  for (let k = 2; k <= 8; k += 2) {
    const az = oz - k;
    if (az < 0) break;
    const ax = ox >> k, ay = oy >> k;
    const layer = await omtLayer(ctx.omtTemplate, az, ax, ay);
    const f = layer.features.find((g) => g.id === id);
    if (!f) continue;
    const dz = az + 1, n = 2 ** dz; // a 512 px OMT tile at az ≈ 256 px elevation tile at az + 1
    const all = f.rings.flatMap((r) => { const pts = []; for (let i = 0; i < r.length; i += 2) pts.push([r[i], r[i + 1]]); return pts; })
      .filter(([vx, vy]) => vx > 0 && vy > 0 && vx < layer.extent && vy < layer.extent); // tile-edge clip points are not shore
    if (all.length < 10) continue;
    const stride = Math.max(1, Math.floor(all.length / 300)), vals = [];
    let datum = 0;
    for (let i = 0; i < all.length; i += stride) {
      const X = (ax + all[i][0] / layer.extent) / 2 ** az, Y = (ay + all[i][1] / layer.extent) / 2 ** az; // 0..1 web mercator
      const lon = X * 360 - 180, lat = latOf(Y);
      const tx = Math.min(n - 1, Math.floor(X * n)), ty = Math.min(n - 1, Math.floor(Y * n));
      const t = await ctx.raw(dz, tx, ty);
      const px = Math.min(SIZE - 1, Math.floor((X * n - tx) * SIZE)), py = Math.min(SIZE - 1, Math.floor((Y * n - ty) * SIZE));
      const h0 = datumAt(lon, lat);
      vals.push(t[py * SIZE + px] - h0);
      if (h0) datum++;
    }
    return { vals, datum };
  }
  return null;
}

// The water bodies of the OpenMapTiles tile under elevation tile z/x/y, each DEPTH, FLAT or LAKE:
// { layer, classes (feature → kind), at(scale) } where at(scale) gives { k, sx, sy } to put the
// layer's coordinates into the tile's at scale units across it (r * k − sx).
// It must use the OpenMapTiles tile the basemap shows at the same map zoom, or the two
// coastlines differ where OSM is generalised: 256 px raster-dem tiles at z show at map
// zoom z−1 (with roundZoom off, see app.js) → OMT z−1 (omtOffset 1); 512 px contour tiles
// at z show at map zoom z → OMT z (omtOffset 0). levelAt(px, py) is the elevation above the
// local surface (sea level, or a DATUMS surface) at a place of the SIZE × SIZE tile; inDatum(px, py)
// says whether that is a datum.
async function waterClasses(ctx, z, x, y, levelAt, inDatum, omtOffset) {
  const oz = Math.max(0, Math.min(z - omtOffset, OMT_MAX)), d = z - oz;
  const ox = x >> d, oy = y >> d;
  const layer = await omtLayer(ctx.omtTemplate, oz, ox, oy);
  const at = (scale) => ({ k: (scale * 2 ** d) / layer.extent, sx: (x - (ox << d)) * scale, sy: (y - (oy << d)) * scale });
  const { k, sx, sy } = at(SIZE);
  const classify = async (f) => {
    if (f.id && ctx.waterLevel.has(f.id)) return ctx.waterLevel.get(f.id); // decided once: every tile agrees
    let vals = [];
    let datum = 0;
    for (const r of f.rings) {
      for (let i = 0; i < r.length && vals.length < 300; i += 2) {
        const px = r[i] * k - sx, py = r[i + 1] * k - sy;
        if (px >= 0 && py >= 0 && px < SIZE && py < SIZE) { vals.push(levelAt(px, py)); if (inDatum(px, py)) datum++; }
      }
    }
    if (vals.length < 10 && f.id) { // little or no shore in this tile: read it at a lower zoom (a read
      // that fails fails the tile, which is asked again later, rather than a lake until the tile is dropped)
      const a = await ancestorShore(ctx, f.id, oz, ox, oy);
      if (a) ({ vals, datum } = a);
    }
    if (vals.length < 10) return LAKE; // still undecided (no shore here nor in any ancestor): a lake, not remembered
    vals.sort((a, b) => a - b);
    const atSea = vals[vals.length >> 2] <= SEA_LEVEL_WATER_M && vals[(3 * vals.length) >> 2] >= -SEA_LEVEL_WATER_M;
    // inland water at a DATUMS surface is that water body (OSM tiles carry the Caspian as
    // `lake` at some zooms): real depths from its surface, not the flat lagoon class
    const v = !atSea ? LAKE : datum * 2 > vals.length ? DEPTH : FLAT;
    if (f.id) ctx.waterLevel.set(f.id, v);
    return v;
  };
  const classes = new Map();
  for (const f of layer.features) if (f.cls !== 'swimming_pool') classes.set(f, SEA_CLASSES.has(f.cls) ? DEPTH : await classify(f));
  return { layer, classes, at };
}

// Water mask for elevation tile z/x/y: 0 land, else DEPTH, FLAT or LAKE (waterClasses, painted)
async function seaMask(ctx, z, x, y, levelAt, inDatum, omtOffset) {
  const { classes, at } = await waterClasses(ctx, z, x, y, levelAt, inDatum, omtOffset);
  const { k, sx, sy } = at(SIZE);
  const c = new OffscreenCanvas(SIZE, SIZE), g = c.getContext('2d');
  // painted as colour channels: LAKE blue, FLAT green, DEPTH red, each over the ones before
  for (const kind of [LAKE, FLAT, DEPTH]) {
    g.fillStyle = { [DEPTH]: '#f00', [FLAT]: '#0f0', [LAKE]: '#00f' }[kind];
    for (const [f, c] of classes) {
      if (c !== kind) continue;
      g.beginPath(); // one path per feature, so overlapping water features add up instead of cancelling
      for (const r of f.rings) {
        g.moveTo(r[0] * k - sx, r[1] * k - sy);
        for (let i = 2; i < r.length; i += 2) g.lineTo(r[i] * k - sx, r[i + 1] * k - sy);
        g.closePath();
      }
      g.fill('nonzero');
    }
  }
  const px = g.getImageData(0, 0, SIZE, SIZE).data, mask = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4] > 127 ? DEPTH : px[i * 4 + 1] > 127 ? FLAT : px[i * 4 + 2] > 127 ? LAKE : 0;
  return mask;
}

// a Terrarium tile decoded to metres (row-major SIZE × SIZE)
async function demMetres(url) {
  const img = await createImageBitmap(await (await fetchOk(url)).blob());
  if (img.width !== SIZE || img.height !== SIZE) throw new Error(`expected ${SIZE} px DEM tiles`);
  const g = new OffscreenCanvas(SIZE, SIZE).getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, SIZE, SIZE).data, e = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < e.length; i++) e[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
  return e;
}

// The DEM's seam between its land and sea sources makes false peaks on the land side: at Elba, zoom 10 has
// a dozen pixels up to 211 m above every neighbour, all within 3 px of the sea (none at zooms 11–12).
// A land pixel that near the OSM sea, standing more than SPIKE_M beyond all its land neighbours,
// takes the nearest of their values. Only land neighbours count, so an islet is never flattened
// against the sea, and inland terrain (summits included) is never touched.
const SPIKE_MAXZOOM = 10, SPIKE_M = 40, SPIKE_REACH = 3;
export function clampCoastalSpikes(e, sea, w, h) {
  const src = e.slice();
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      if (sea[p]) continue;
      let lo = Infinity, hi = -Infinity, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const q = p + dy * w + dx;
          if ((dx || dy) && !sea[q]) { lo = Math.min(lo, src[q]); hi = Math.max(hi, src[q]); n++; }
        }
      }
      if (n < 3 || (src[p] <= hi + SPIKE_M && src[p] >= lo - SPIKE_M)) continue;
      let coastal = false;
      for (let dy = -SPIKE_REACH; dy <= SPIKE_REACH && !coastal; dy++) {
        for (let dx = -SPIKE_REACH; dx <= SPIKE_REACH; dx++) {
          const yy = y + dy, xx = x + dx;
          if (yy >= 0 && xx >= 0 && yy < h && xx < w && sea[yy * w + xx]) { coastal = true; break; }
        }
      }
      if (coastal) e[p] = src[p] > hi ? hi : lo;
    }
  }
  return e;
}

// Clipped elevation for one tile, in metres (row-major 256 × 256).
// Shared by the map's raster-dem layers (protocol) and maplibre-contour (getTile +
// decodeImage), so each tile is computed once and never round-trips through PNG.
// mode 'sea': GEBCO's depths; 'land': the Terrarium tiles at `template`
// the OpenMapTiles tile URL, fetched once for both clippers; a failure is retried on the next tile.
// The TileJSON says where its tiles are: taken only from the host the page names (hosts.js), since
// a worker is outside the page's Content-Security-Policy
const tileJsons = lru(Infinity);
const omtTemplateOf = (omtTileJson) => tileJsons(omtTileJson, () => fetchOk(omtTileJson).then((r) => r.json()).then((tj) => {
  const t = tj?.tiles?.[0];
  if (typeof t !== 'string' || new URL(t).origin !== new URL(HOSTS.openfreemap).origin) throw new Error('the base map\'s TileJSON names tiles elsewhere');
  return t;
}));
// what a water mask throws when it would need heights (cut: the land's tile all open sea)
const HEIGHTS = new Error('heights needed');
const NEEDS_HEIGHTS = () => { throw HEIGHTS; };
// remember false: each tile classifies its water bodies itself, none remembered (offline.js: an area
// saved must hold what any tile asked first would read)
export function clipper({ template, mode, omtTileJson, remember = true }) {
  const omtTemplate = () => omtTemplateOf(omtTileJson);
  // 64 tiles each: a view and its surroundings (raw 256 kB, the sea's 512 kB: as read and as drawn; cut 320 kB: two clippers, two cuts of a sea tile)
  const rawCache = lru(64), cache = lru(64), waterLevel = remember ? new Map() : { has: () => false, get: () => undefined, set() {} }; // waterLevel: OSM id → DEPTH, FLAT or LAKE
  // a tile's elevation in metres, { raw, drawn }: raw as the data has it (no mask), also what inland
  // water is classified from, at lower zooms too; drawn the sea's depths blended from water cells
  // alone (gebco.js), so the shore's land cells do not pull them shallower; the land's its DEM, as it
  // is, for both
  const tile = (z, x, y) => rawCache(`${z}/${x}/${y}`, () => (mode === 'sea' ? gebcoTile(z, x, y).then(({ raw, sea }) => ({ raw, drawn: sea }))
    : demMetres(tileUrl(template, z, x, y)).then((m) => ({ raw: m, drawn: m }))));
  const raw = (z, x, y) => tile(z, x, y).then((t) => t.raw);
  const drawn = (z, x, y) => tile(z, x, y).then((t) => t.drawn);
  // Shared by several requesters (the shading and the contours ask for the same tile): the work goes on
  // while any of them still waits, and stops between its steps once every one has given up (MapLibre
  // aborts the tiles a quick zoom leaves behind), so the tiles now wanted are not queued behind them.
  // Work given up is forgotten at once: a request for the tile meanwhile starts it afresh, rather
  // than joining work bound to fail
  const waiting = new Map(); // key → { n: requesters still waiting, ac: aborts the work }: work still running
  const elevation = (z, x, y, omtOffset = 1, signal = null) => {
    const key = `${z}/${x}/${y}/${omtOffset}`;
    const p = cache(key, () => {
      const w = { n: 0, ac: new AbortController() };
      waiting.set(key, w);
      return cut(z, x, y, omtOffset, w.ac.signal).finally(() => { if (waiting.get(key) === w) waiting.delete(key); });
    });
    const w = waiting.get(key); // none: the tile is cut
    if (w) {
      w.n++; // a requester with no signal (metres) waits to the end
      signal?.addEventListener('abort', () => {
        if (--w.n) return;
        w.ac.abort();
        if (waiting.get(key) === w) { waiting.delete(key); cache.drop(key); }
      }, { once: true });
    }
    return p;
  };
  // the surface per pixel of tile z/x/y, (i, j) → 0, or a DATUMS surface for pixels inside its box
  const surfaceOf = (z, x, y) => {
    const [tw, ts, te, tn] = tileBounds(z, x, y);
    const datums = mode === 'sea' ? DATUMS.filter(([, b]) => b[0] < te && b[2] > tw && b[1] < tn && b[3] > ts) : [];
    if (!datums.length) return () => 0;
    const lonAt = (i) => tw + ((i + 0.5) / SIZE) * (te - tw);
    const latAt = (j) => latOf((y + (j + 0.5) / SIZE) / 2 ** z);
    return (i, j) => {
      for (const [, b, h0] of datums) { const lo = lonAt(i), la = latAt(j); if (lo >= b[0] && lo <= b[2] && la >= b[1] && la <= b[3]) return h0; }
      return 0;
    };
  };
  // ---- isobaths (isobaths.js): traced from the depths uncut at ISOBATH_TRACE, where the data has
  // its last detail, and cut in vector space against the sea polygons of the base map's tile at the
  // tile's own zoom, so that a line ends on the shore as the map draws it, at any zoom -----
  const stepFor = (z) => { let s = 0; for (const [k, [v]] of Object.entries(ISOBATH_STEPS)) if (+k <= z) s = v; return s; }; // every step m from zoom k
  // the depths as traced: from the surface (a DATUMS water body's), half a metre shallower (GEBCO is
  // in whole metres, so on a flat shelf whole groups of cells read exactly −20, and the 20 m line
  // traced their edges cell by cell; a whole metre stands for ±0.5 m, and with the half added no flat
  // lies on a line, which crosses the slope between values instead, towards shallower: the shallow
  // side a line encloses is never smaller); what the data calls dry 0, so that no line is traced on
  // land (the 0 line is left out) and the shallow lines run to the data's own shore
  const tracedMetres = async (z, x, y) => {
    const v = await drawn(z, x, y), surface = surfaceOf(z, x, y), out = new Float32Array(v.length);
    for (let j = 0; j < SIZE; j++) for (let i = 0; i < SIZE; i++) { const k = j * SIZE + i, h = v[k] - surface(i, j); out[k] = h < 0 ? h + 0.5 : 0; }
    return out;
  };
  const traced = lru(64); // `zt/x/y/step` → [{ value, lines }]: a tile's lines traced, with its neighbours' for seamless lines
  const tracedLines = (zt, tx, ty, step) => traced(`${zt}/${tx}/${ty}/${step}`, async () => {
    const max = 2 ** zt, nb = [];
    for (let j = ty - 1; j <= ty + 1; j++) for (let i = tx - 1; i <= tx + 1; i++) nb.push(j < 0 || j >= max ? undefined : tracedMetres(zt, (i + max) % max, j));
    const lines = traceLines(await Promise.all(nb), SIZE, step);
    return Object.entries(lines).filter(([lv]) => +lv < 0).map(([lv, ls]) => ({ value: +lv, lines: ls }));
  });
  const BUFFER = 128; // beyond the tile, as MapLibre keeps (its default buffer), so that a line's end is not cut at the tile's edge
  const isobaths = async (z, x, y, signal) => {
    const step = stepFor(z);
    if (!step) return encodeLines('contours', 'ele', []);
    const zt = Math.min(z, ISOBATH_TRACE), d = z - zt, tx = x >> d, ty = y >> d, f = 2 ** d;
    const oz = Math.min(z, OMT_MAX), layer = await omtLayer(omtTemplate, oz, x >> (z - oz), y >> (z - oz));
    if (!layer.features.some((q) => SEA_CLASSES.has(q.cls) || (q.cls !== 'swimming_pool' && waterLevel.get(q.id) !== LAKE))) return encodeLines('contours', 'ele', []); // no sea here: no line
    const lines = await tracedLines(zt, tx, ty, step);
    if (signal?.aborted) throw new Error('aborted');
    // the water bodies to classify (a lagoon flat, a lake none) read their heights at the traced zoom
    const needs = layer.features.some((q) => q.cls !== 'swimming_pool' && !SEA_CLASSES.has(q.cls) && !(q.id && waterLevel.has(q.id)));
    const src = needs ? await raw(zt, tx, ty) : null, surface = surfaceOf(zt, tx, ty);
    const there = (px, py) => [Math.min(SIZE - 1, Math.floor((px + (x - (tx << d)) * SIZE) / f)), Math.min(SIZE - 1, Math.floor((py + (y - (ty << d)) * SIZE) / f))];
    const levelAt = (px, py) => { const [i, j] = there(px, py); return src[j * SIZE + i] - surface(i, j); }, inDatum = (px, py) => surface(...there(px, py)) !== 0;
    const { classes, at } = await waterClasses({ omtTemplate, raw, waterLevel }, z, x, y, levelAt, inDatum, 0);
    if (signal?.aborted) throw new Error('aborted');
    const { k, sx, sy } = at(EXTENT), rings = [];
    for (const [q, c] of classes) if (c === DEPTH) for (const r of q.rings) rings.push(r.map((v, i) => v * k - (i % 2 ? sy : sx)));
    const ox = (x - (tx << d)) * EXTENT, oy = (y - (ty << d)) * EXTENT; // this tile's share of the traced tile
    const place = (ls) => ls.map((l) => l.map((v, i) => v * f - (i % 2 ? oy : ox)));
    const box = [[-BUFFER, -BUFFER, EXTENT + BUFFER, -BUFFER, EXTENT + BUFFER, EXTENT + BUFFER, -BUFFER, EXTENT + BUFFER]];
    return encodeLines('contours', 'ele', lines.map(({ value, lines: ls }) => ({ value, lines: clipLines(clipLines(place(ls), box), rings) })));
  };
  const cut = async (z, x, y, omtOffset, signal) => {
    // The land's tile all open sea needs no heights: its water mask from the base map alone says so,
    // and the tile is what the cut would make of it (0 m, all sea), its elevation never read (at sea
    // the land's tiles were half of what a view or a saved area fetched). A mask that would need
    // heights (inland water to classify, a shore read at a lower zoom) stops it: the cut as ever
    let sea = null; // the land's mask made without heights: the mask itself, when it needed none
    if (mode === 'land') {
      sea = await seaMask({ omtTemplate, raw: NEEDS_HEIGHTS, waterLevel }, z, x, y, NEEDS_HEIGHTS, () => false, omtOffset)
        .catch((e) => { if (e === HEIGHTS) return null; throw e; });
      if (sea?.every((m) => m === DEPTH)) return { h: new Float32Array(SIZE * SIZE), mask: sea };
      if (signal.aborted) throw new Error('aborted');
    }
    const src = await raw(z, x, y), val = await drawn(z, x, y);
    if (signal.aborted) throw new Error('aborted'); // nobody waits: not cut (the lru forgets a make that fails: asked again, it is)
    const surface = surfaceOf(z, x, y);
    const mask = sea ?? await seaMask({ omtTemplate, raw, waterLevel }, z, x, y, // px, py: a shore vertex's place, fractional
      (px, py) => src[Math.floor(py) * SIZE + Math.floor(px)] - surface(px, py), (px, py) => surface(px, py) !== 0, omtOffset);
    if (signal.aborted) throw new Error('aborted');
    const out = new Float32Array(SIZE * SIZE);
    for (let j = 0; j < SIZE; j++) {
      for (let i = 0; i < SIZE; i++) {
        const k = j * SIZE + i, m = mask[k];
        let h = val[k];
        if (mode === 'sea') h = m === 0 ? 1 : m === DEPTH ? Math.min(h - surface(i, j), -1) : m === FLAT ? -1 : NO_DEPTH_M;
        else if (m === DEPTH) h = 0;
        out[k] = h;
      }
    }
    if (mode === 'land' && z <= SPIKE_MAXZOOM) clampCoastalSpikes(out, mask.map((m) => m === DEPTH), SIZE, SIZE);
    return { h: out, mask };
  };
  return {
    // Terrarium-encoded ImageBitmap for a raster-dem source
    async bitmap(z, x, y, signal) {
      const { h: e } = await elevation(z, x, y, 1, signal);
      const img = new ImageData(SIZE, SIZE), o = img.data;
      for (let k = 0; k < e.length; k++) {
        // The GPU interpolates between pixels, and the tint edge falls where the value
        // crosses 0. With land at +1 it lands mid-way and bleeds onto land, half-hiding the
        // shore line; a higher land value pulls it back toward the water.
        const t = (mode === 'sea' && e[k] === 1 ? LAND_SHADE_M : e[k]) + 32768, q = k * 4;
        o[q] = Math.floor(t / 256); o[q + 1] = Math.floor(t) % 256; o[q + 2] = Math.floor((t - Math.floor(t)) * 256); o[q + 3] = 255;
      }
      return createImageBitmap(img, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    },
    // metres for maplibre-contour (the land's 512 px contour tiles: cut with the coastline of the same
    // zoom); always a new array: the worker transfers it, which would empty the cached tile
    async contourElevation(z, x, y, signal) {
      const { h: e } = await elevation(z, x, y, 0, signal);
      return e.slice();
    },
    // the isobaths' vector tile z/x/y (above), as bytes
    isobaths,
    // metres as the raster-dem tile draws them, NaN where it shows no value of its own: for the sea
    // land, lakes and inland water at sea level (flat, depth unknown); for the land the sea (ZIP export)
    async metres(z, x, y) {
      const { h, mask } = await elevation(z, x, y);
      return h.map((v, k) => ((mode === 'sea' ? mask[k] === DEPTH : mask[k] !== DEPTH) ? v : NaN));
    },
  };
}

// ---- main thread: the same clipper running in a Web Worker (clip-worker.js) -------------
// The cutting is the page's heaviest work (seconds of main-thread time while panning); in a
// worker the map stays responsive. Tiles come back transferred, not copied.
const zxy = (url) => url.match(/(\d+)\/(\d+)\/(\d+)(?:\.png)?$/).slice(1).map(Number);
// A clipping worker started with its clippers' inits: ask(msg, signal) → promise of its answer (the
// signal's abort cancels the tile there too; an error keeps its name); stop() ends it, and fails what
// waits on it. Dying (out of memory, a script error) fails what waits and what is asked later,
// died(message) said once (a dead worker may report twice). stored(bytes, url): a file it put in an
// area's cache (an init's keep). The page's own (below), and offline.js's for saving an area
export function startClipWorker(inits, { died = () => {}, stored = () => {} } = {}) {
  const w = new Worker(new URL('./clip-worker.js', import.meta.url), { type: 'module' }), replies = new Map();
  let seq = 0, dead = null;
  for (const init of inits) w.postMessage({ init });
  const end = (err) => { dead = err; w.terminate(); for (const r of replies.values()) r.reject(err); replies.clear(); };
  w.onmessage = ({ data }) => {
    if (data.stored) { stored(data.stored, data.url); return; }
    const r = replies.get(data.seq);
    replies.delete(data.seq);
    if (r) data.error ? r.reject(Object.assign(new Error(data.error), { name: data.name || 'Error' })) : r.resolve(data.value);
  };
  w.onerror = (e) => { if (!dead) { end(new Error(`clip worker: ${e.message}`)); died(e.message); } };
  return {
    init: (init) => w.postMessage({ init }),
    ask: (msg, signal) => new Promise((resolve, reject) => {
      if (dead) { reject(dead); return; }
      const n = ++seq;
      replies.set(n, { resolve, reject });
      signal?.addEventListener('abort', () => { replies.delete(n); reject(new Error('aborted')); if (!dead) w.postMessage({ cancel: n }); }, { once: true });
      w.postMessage({ ...msg, seq: n });
    }),
    stop: () => end(new Error('aborted')),
  };
}
let worker = null, diedAt = 0;
const inits = []; // each clipper's init, sent again to a worker started anew
const RETRY_MS = 5000; // after the worker died: no new one before this, or a script that fails to load is fetched at every tile
// the page's worker; one that died: every tile waiting on it has failed, and a later ask starts a new one
function clipWorker() {
  if (worker) return worker;
  if (Date.now() - diedAt < RETRY_MS) throw new Error('clip worker: not running');
  return (worker = startClipWorker(inits, { died: (message) => { console.error('clip worker:', message); worker = null; diedAt = Date.now(); } }));
}
const ask = async (msg, signal) => clipWorker().ask(msg, signal); // throws while it is not to be started: this tile fails

// MapLibre protocol handler and maplibre-contour hooks for one clipper (mode 'sea' or 'land')
export function workerClipper({ template, mode, omtTileJson }) {
  inits.push({ template, mode, omtTileJson });
  if (worker) worker.init(inits.at(-1)); // else the next start sends every init once
  else clipWorker();
  return {
    protocol: async (params, abortController) => {
      if (abortController?.signal.aborted) throw new Error('aborted');
      return { data: await ask({ mode, op: 'bitmap', zxy: zxy(params.url) }, abortController?.signal) };
    },
    getTile: async (url, ac) => ({ data: { elevation: await ask({ mode, op: 'contourElevation', zxy: zxy(url) }, ac?.signal) } }),
    isobaths: async (params, abortController) => ({ data: (await ask({ mode, op: 'isobaths', zxy: zxy(params.url) }, abortController?.signal)).buffer }),
    decodeImage: async (data) => ({ width: SIZE, height: SIZE, data: data.elevation }),
    metres: (z, x, y) => ask({ mode, op: 'metres', zxy: [z, x, y] }),
  };
}
