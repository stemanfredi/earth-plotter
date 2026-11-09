// National aerial imagery (catalog.js ORTHO), each country's drawn only inside the country: its
// service answers beyond the border with white tiles or with older imagery, and MapLibre cuts a source
// only to a rectangle. So each tile goes through the ortho:// handler, which reads the country's
// coverage (tools/coverage.mjs, on the data host): a tile wholly outside asks nobody; one wholly
// inside is the service's tile as it is; one the border crosses is cut to the country's outline.
import { ORTHO } from './catalog.js';
import { HOSTS } from './hosts.js';
import { fetchOk, fetchBytes, tileUrl, lru } from './net.js';
import { tileBounds, tileXY, boxesMeet, MAX_LAT } from './geo.js';

export const RELEASE = 'coverage-2026'; // the coverage's folder on the data host (tools/coverage.mjs writes it)
export const COVERAGE = `${HOSTS.geodata}/${RELEASE}`;
const byId = Object.fromEntries(ORTHO.map((o) => [o.id, o]));

// a country's coverage: its index's rows ([y, x0, x1, …]) as y → runs of x
const runs = (rows) => new Map(rows.map(([y, ...xs]) => [y, xs]));
export const within = (m, x, y) => { const xs = m.get(y); if (!xs) return false; for (let i = 0; i < xs.length; i += 2) if (x >= xs[i] && x <= xs[i + 1]) return true; return false; };
export const readIndex = (ix) => ({ ...ix, inside: runs(ix.inside), edge: runs(ix.edge) });
const indexes = lru(ORTHO.length), read = {}; // read: id → its coverage once read (covers)
// a country whose coverage is not on the data host (a 404: not published yet) is null, drawn nowhere,
// quietly; one that cannot be read (no connection, a server's error) fails its tiles, which the layer shows
const coverage = (id) => indexes(id, () => fetchBytes(`${COVERAGE}/${id}/index.json`)
  .then((b) => (read[id] = b && readIndex(JSON.parse(new TextDecoder().decode(b))))));
// where tile z/x/y is for a coverage: 'inside', 'edge' (the border crosses it), or null (outside);
// at and above the coverage's zoom, by the coverage tile holding it
export function where(cov, z, x, y) {
  if (z < cov.z) return null;
  const s = 2 ** (z - cov.z), kx = Math.floor(x / s), ky = Math.floor(y / s);
  return within(cov.inside, kx, ky) ? 'inside' : within(cov.edge, kx, ky) ? 'edge' : null;
}
// whether the box [w, s, e, n] meets country id's coverage (and its bounds), once its coverage has
// been read (by its first tiles): its credit is due
export function covers(id, box, cov = read[id]) {
  const b = byId[id]?.bounds;
  if (!cov || (b && !boxesMeet(b, box))) return false;
  const nw = tileXY(Math.max(box[0], -180), Math.min(box[3], MAX_LAT), cov.z), se = tileXY(Math.min(box[2], 179.9999), Math.max(box[1], -MAX_LAT), cov.z);
  const x0 = Math.floor(nw.x), x1 = Math.floor(se.x);
  for (let y = Math.floor(nw.y); y <= Math.floor(se.y); y++) {
    for (const xs of [cov.inside.get(y), cov.edge.get(y)]) if (xs) for (let i = 0; i < xs.length; i += 2) if (xs[i] <= x1 && xs[i + 1] >= x0) return true;
  }
  return false;
}
// The white a service paints where it has no imagery, cleared in a tile's pixels (RGBA): starting
// from runs of pure white (255, what the services paint) along the tile's edges, what is near white
// and joined to them (a flood fill), so that snow, a white roof or a wave's foam inside the imagery
// stays, even where it touches the edge. The country's outline includes its territorial sea, so at
// sea and along the coast this, not the mask, is what leaves only the imagery. The pixels cleared,
// counted (all of them: nothing to draw).
export function clearWhite(px, w, h, near = 246, run = 16) {
  const seen = new Uint8Array(w * h), stack = new Int32Array(w * h);
  const light = (k, v) => px[4 * k] >= v && px[4 * k + 1] >= v && px[4 * k + 2] >= v;
  let top = 0, n = 0;
  const push = (k) => { if (!seen[k] && light(k, near)) { seen[k] = 1; stack[top++] = k; } };
  // the edge of length len from pixel k0, by step: its runs of pure white of at least run pixels
  const seeds = (k0, step, len) => {
    for (let i = 0, r = 0; i <= len; i++) {
      if (i < len && light(k0 + i * step, 255)) r++;
      else { if (r >= run) for (let j = i - r; j < i; j++) push(k0 + j * step); r = 0; }
    }
  };
  seeds(0, 1, w); seeds((h - 1) * w, 1, w); seeds(0, w, h); seeds(w - 1, w, h);
  while (top) {
    const k = stack[--top], x = k % w;
    px[4 * k + 3] = 0;
    n++;
    if (x > 0) push(k - 1);
    if (x < w - 1) push(k + 1);
    if (k >= w) push(k - w);
    if (k < w * (h - 1)) push(k + w);
  }
  if (!n) return 0;
  // one pixel more where the white's edge is light: the halo a JPEG leaves around it
  const halo = near - 30, fade = (k) => { if (!seen[k] && px[4 * k + 3] && light(k, halo)) px[4 * k + 3] = 0; };
  for (let k = 0; k < w * h; k++) {
    if (!seen[k]) continue;
    const x = k % w;
    if (x > 0) fade(k - 1);
    if (x < w - 1) fade(k + 1);
    if (k >= w) fade(k - w);
    if (k < w * (h - 1)) fade(k + w);
  }
  return n;
}
// a border tile's mask (tools/coverage.mjs encodeMask): rings as flat [x, y, x, y …] in tile units
export function decodeMask(bytes, buffer) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), rings = [];
  let o = 4;
  for (let r = v.getUint32(0, true); r > 0; r--) {
    const n = v.getUint32(o, true), ring = new Array(2 * n);
    o += 4;
    for (let i = 0; i < 2 * n; i++, o += 2) ring[i] = v.getUint16(o, true) - buffer;
    rings.push(ring);
  }
  return rings;
}
const masks = lru(64);
const mask = (id, cov, kx, ky) => masks(`${id}/${kx}/${ky}`, () => fetchBytes(`${COVERAGE}/${id}/${cov.z}/${kx}/${ky}.bin`).then((b) => (b ? decodeMask(b, cov.buffer) : [])));
// the mask's path on a tile of size px at z/x/y (its coverage tile's rings scaled into it)
export function maskPath(g, rings, cov, z, x, y, px) {
  const s = 2 ** (z - cov.z), ox = x - Math.floor(x / s) * s, oy = y - Math.floor(y / s) * s, k = (s / cov.extent) * px;
  g.beginPath();
  for (const r of rings) {
    g.moveTo(r[0] * k - ox * px, r[1] * k - oy * px);
    for (let i = 2; i < r.length; i += 2) g.lineTo(r[i] * k - ox * px, r[i + 1] * k - oy * px);
    g.closePath();
  }
}

const PX = 256; // the services' tiles
// an image with its service's white cleared (clearWhite), as a canvas to draw from; null if all of it was
function withoutWhite(im) {
  const c = new OffscreenCanvas(PX, PX), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(im, 0, 0, PX, PX);
  const d = g.getImageData(0, 0, PX, PX);
  if (clearWhite(d.data, PX, PX) === PX * PX) return null;
  g.putImageData(d, 0, 0);
  return c;
}
// nothing to draw here: no bytes (MapLibre draws a transparent tile)
const empty = () => ({ data: new ArrayBuffer(0) });
// a part's answer that only says there is no imagery here (AGEA beyond a flight: 400; IGN at sea:
// 404): not a failure. Any other (a quota's 429, a 403) fails the tile, to be asked again
const nothingHere = (e) => /^HTTP 40[04]$/.test(e?.message);

// the parts with imagery where tile z/x/y is (a part beyond its bounds answers an error: not asked)
export function partsAt(o, z, x, y) {
  if (!o.partBounds) return o.parts;
  const box = tileBounds(z, x, y);
  return o.parts.filter((_, i) => boxesMeet(o.partBounds[i], box));
}
// MapLibre's raster tiles ortho://{id}/{z}/{x}/{y}
export async function orthoTile({ url }, abortController) {
  const [, id, z, x, y] = /^ortho:\/\/(\w+)\/(\d+)\/(\d+)\/(\d+)$/.exec(url).map((v, i) => (i > 1 ? +v : v));
  const o = byId[id], cov = await coverage(id), here = cov && where(cov, z, x, y);
  if (!here) return empty();
  const signal = abortController?.signal, parts = partsAt(o, z, x, y);
  const get = async (p) => (await fetchOk(tileUrl(p, z, x, y), { signal })).blob();
  if (here === 'inside' && parts.length === 1 && !o.white) { // nothing to cut or clear: the service's tile as it is
    try { return { data: await (await get(parts[0])).arrayBuffer() }; } catch (e) { if (nothingHere(e)) return empty(); throw e; }
  }
  const s = 2 ** (z - cov.z);
  const rings = here === 'edge' ? mask(id, cov, Math.floor(x / s), Math.floor(y / s)) : null;
  rings?.catch(() => {}); // awaited below, once the images are in hand (closed whatever happens)
  const settled = await Promise.allSettled(parts.map(async (p) => createImageBitmap(await get(p))));
  const images = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  try {
    const failed = settled.find((r) => r.status === 'rejected' && !nothingHere(r.reason));
    if (!images.length) { if (failed) throw failed.reason; return empty(); }
    const draw = o.white ? images.map(withoutWhite).filter(Boolean) : images;
    if (!draw.length) return empty();
    const c = new OffscreenCanvas(PX, PX), g = c.getContext('2d');
    if (rings) { maskPath(g, await rings, cov, z, x, y, PX); g.clip('evenodd'); }
    for (const im of draw) g.drawImage(im, 0, 0, PX, PX);
    return { data: c.transferToImageBitmap() };
  } finally {
    for (const im of images) im.close();
  }
}
