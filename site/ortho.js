// National aerial imagery (catalog.js ORTHO), each country's drawn only inside the country: its
// service answers beyond the border with white tiles or with older imagery, and MapLibre cuts a source
// only to a rectangle. So each tile goes through the ortho:// handler, which reads the country's
// coverage (tools/coverage.mjs, on the data host): a tile wholly outside asks nobody; one wholly
// inside is the service's tile as it is; one the border crosses is cut to the country's outline.
import { ORTHO } from './catalog.js';
import { HOSTS } from './hosts.js';
import { fetchOk, fetchBytes, tileUrl, lru } from './net.js';
import { tileBounds } from './geo.js';

export const COVERAGE = `${HOSTS.geodata}/coverage-2026`;
const byId = Object.fromEntries(ORTHO.map((o) => [o.id, o]));

// a country's coverage: its index's rows ([y, x0, x1, …]) as y → runs of x
const runs = (rows) => new Map(rows.map(([y, ...xs]) => [y, xs]));
export const within = (m, x, y) => { const xs = m.get(y); if (!xs) return false; for (let i = 0; i < xs.length; i += 2) if (x >= xs[i] && x <= xs[i + 1]) return true; return false; };
export const readIndex = (ix) => ({ ...ix, inside: runs(ix.inside), edge: runs(ix.edge) });
const indexes = lru(ORTHO.length);
// a country whose coverage is not on the data host (a 404: not published yet) is drawn nowhere, quietly;
// one that cannot be read (no connection, a server's error) fails its tiles, which the layer shows
const NONE = { z: 12, extent: 8192, buffer: 64, inside: [], edge: [] };
const coverage = (id) => indexes(id, () => fetchBytes(`${COVERAGE}/${id}/index.json`)
  .then((b) => readIndex(b ? JSON.parse(new TextDecoder().decode(b)) : NONE)));
// where tile z/x/y is for a coverage: 'inside', 'edge' (the border crosses it), or null (outside);
// at and above the coverage's zoom, by the coverage tile holding it
export function where(cov, z, x, y) {
  if (z < cov.z) return null;
  const s = 2 ** (z - cov.z), kx = Math.floor(x / s), ky = Math.floor(y / s);
  return within(cov.inside, kx, ky) ? 'inside' : within(cov.edge, kx, ky) ? 'edge' : null;
}
// The white a service paints where it has no imagery, cleared in a tile's pixels (RGBA): what is
// near white and joined to the tile's edge through near white (a flood fill), so that a white roof
// or a wave's foam inside the imagery stays. The country's outline includes its territorial sea,
// so at sea and along the coast this, not the mask, is what leaves only the imagery.
export function clearWhite(px, w, h, near = 246) {
  const seen = new Uint8Array(w * h), stack = [];
  const push = (x, y) => {
    const k = y * w + x, i = 4 * k;
    if (!seen[k] && px[i] >= near && px[i + 1] >= near && px[i + 2] >= near) { seen[k] = 1; stack.push(k); }
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  const cleared = [];
  while (stack.length) {
    const k = stack.pop(), x = k % w, y = (k - x) / w;
    px[4 * k + 3] = 0;
    cleared.push(k);
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }
  // one pixel more where the white's edge is light: the halo a JPEG leaves around it
  const halo = near - 30;
  for (const k of cleared) {
    const x = k % w, y = (k - x) / w;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, i = 4 * (ny * w + nx);
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && px[i + 3] && px[i] >= halo && px[i + 1] >= halo && px[i + 2] >= halo) px[i + 3] = 0;
    }
  }
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
// an image with its service's white cleared (clearWhite), as a canvas to draw from
function withoutWhite(im) {
  const c = new OffscreenCanvas(PX, PX), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(im, 0, 0, PX, PX);
  const d = g.getImageData(0, 0, PX, PX);
  clearWhite(d.data, PX, PX);
  g.putImageData(d, 0, 0);
  return c;
}
// nothing to draw here: a transparent pixel (a canvas gives its image only once it has a context)
const blank = () => { const c = new OffscreenCanvas(1, 1); c.getContext('2d'); return c.transferToImageBitmap(); };
// a part's answer that only says there is no imagery here (the sea, beyond a flight): not a failure
const nothingHere = (e) => /^HTTP 4\d\d$/.test(e?.message);

// the parts with imagery where tile z/x/y is (a part beyond its bounds answers an error: not asked)
export function partsAt(o, z, x, y) {
  if (!o.partBounds) return o.parts;
  const [w, s, e, n] = tileBounds(z, x, y);
  return o.parts.filter((_, i) => { const [bw, bs, be, bn] = o.partBounds[i]; return bw < e && be > w && bs < n && bn > s; });
}
// MapLibre's raster tiles ortho://{id}/{z}/{x}/{y}
export async function orthoTile({ url }, abortController) {
  const [, id, z, x, y] = /^ortho:\/\/(\w+)\/(\d+)\/(\d+)\/(\d+)$/.exec(url).map((v, i) => (i > 1 ? +v : v));
  const o = byId[id], cov = await coverage(id), here = where(cov, z, x, y);
  if (!here) return { data: blank() };
  const signal = abortController?.signal;
  const s = 2 ** (z - cov.z);
  const [rings, settled] = await Promise.all([
    here === 'edge' ? mask(id, cov, Math.floor(x / s), Math.floor(y / s)) : null,
    Promise.allSettled(partsAt(o, z, x, y).map(async (p) => createImageBitmap(await (await fetchOk(tileUrl(p, z, x, y), { signal })).blob()))),
  ]);
  const images = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  try {
    const failed = settled.find((r) => r.status === 'rejected' && !nothingHere(r.reason));
    if (!images.length) { if (failed) throw failed.reason; return { data: blank() }; }
    const c = new OffscreenCanvas(PX, PX), g = c.getContext('2d');
    if (rings) { maskPath(g, rings, cov, z, x, y, PX); g.clip('evenodd'); }
    for (const im of images) g.drawImage(o.white ? withoutWhite(im) : im, 0, 0, PX, PX);
    return { data: c.transferToImageBitmap() };
  } finally {
    for (const im of images) im.close();
  }
}
