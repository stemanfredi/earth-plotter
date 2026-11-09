#!/usr/bin/env node
// Where each national imagery source covers, as masks the page clips its tiles with (site/ortho.js):
// the services answer outside their country with white tiles (France, the Netherlands) or with older
// imagery of the neighbours (Switzerland), and MapLibre cuts a source only to a rectangle. So each
// country's outline is cut into zoom-12 tiles once, and published as plain files at
// geodata.earthplotter.org/coverage-2026/{id}/ (docs/development.md: the data host):
//
//   index.json             { z, extent, buffer, inside: rows, edge: rows }: the zoom-12 tiles wholly
//                          inside the country and those its border crosses; rows: [[y, x0, x1, …]],
//                          runs of x from x0 to x1 inclusive. A tile in neither is outside.
//   12/{x}/{y}.bin         a border tile's mask: rings, filled even-odd, in tile units (extent,
//                          plus buffer around), as u32 ring count, then per ring u32 n and n pairs
//                          of u16 (x + buffer, y + buffer), little-endian
//
//   node tools/coverage.mjs download DIR   the outlines into DIR/src
//   node tools/coverage.mjs build DIR      DIR/tiles/coverage-2026/{id}/
//
// The outlines are OpenStreetMap's national boundaries (© OpenStreetMap contributors, ODbL: the
// masks are published under it), read from the OSM API's relation/{id}/full, once per build. They
// include the territorial sea: the land borders are exact, and at sea each service's own "no imagery"
// decides (transparent, a 404, or white, which the page clears), so harbours keep their imagery.
// Simplified to about a metre at zoom 12 (geojson-vt's tolerance), which is what the page draws.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import geojsonvt from 'geojson-vt';

export const RELEASE = 'coverage-2026';
export const Z = 12, EXTENT = 8192, BUFFER = 64;
// each country's OSM relations: France as metropolitan France and its five overseas departments (the
// whole of France, with every territory, is too large for one request); the European Netherlands
const OSM_API = 'https://api.openstreetmap.org/api/0.6/relation';
export const SOURCES = {
  fr: [1403916, 1401835, 1891495, 1260551, 1785276, 1259885],
  nl: [47796],
  ch: [51701],
  it: [365331],
};
const CREDIT = '© OpenStreetMap contributors, ODbL';

// Lines chained into rings at the points they share (a relation's ways), and rings that share their
// borders point for point merged into one outline: every edge drawn twice (by the two areas it
// divides) is dropped. Edges are undirected: lines and rings may run either way.
export function mergeShared(rings) {
  const key = (p) => `${p[0]},${p[1]}`;
  const edgeKey = (a, b) => { const ka = key(a), kb = key(b); return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`; };
  const count = new Map();
  for (const r of rings) for (let i = 0; i + 1 < r.length; i++) { const k = edgeKey(r[i], r[i + 1]); count.set(k, (count.get(k) || 0) + 1); }
  const at = new Map(); // vertex → the outline's edges leaving it: [other end, edge key]
  const point = new Map();
  for (const r of rings) {
    for (let i = 0; i + 1 < r.length; i++) {
      const k = edgeKey(r[i], r[i + 1]);
      if (count.get(k) % 2 === 0) continue; // shared: inside the merged outline
      for (const [a, b] of [[r[i], r[i + 1]], [r[i + 1], r[i]]]) {
        point.set(key(a), a);
        (at.get(key(a)) || at.set(key(a), []).get(key(a))).push([key(b), k]);
      }
    }
  }
  const used = new Set(), out = [];
  for (const [start, edges] of at) {
    for (const [, k0] of edges) {
      if (used.has(k0)) continue;
      const ring = [point.get(start)];
      let here = start, k = k0;
      for (;;) {
        used.add(k);
        const next = at.get(here).find(([, kk]) => kk === k)[0];
        ring.push(point.get(next));
        if (next === start) break;
        const on = at.get(next).find(([, kk]) => !used.has(kk));
        if (!on) break; // an open chain: the data was not closed there
        here = next; k = on[1];
      }
      if (ring.length > 3 && ring.at(-1) === ring[0]) out.push(ring);
    }
  }
  return out;
}

// The zoom-12 tiles of the rings, sorted inside, border or outside, and each border tile's rings.
// A tile wholly covered comes from geojson-vt as its buffered square: an odd number of those, and
// no other ring, is inside; an even number (inside a hole) is outside.
export function cut(rings, { extent = EXTENT, buffer = BUFFER, tolerance = 1 } = {}) {
  const fc = { type: 'FeatureCollection', features: rings.map((r) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [r] } })) };
  const index = geojsonvt(fc, { maxZoom: Z, indexMaxZoom: 6, indexMaxPoints: 0, extent, buffer, tolerance });
  const lo = -buffer, hi = extent + buffer;
  const square = (ring) => ring.length <= 5 && ring.every(([x, y]) => (x === lo || x === hi) && (y === lo || y === hi));
  const n = 2 ** Z, tiles = new Set(), inside = [], edge = [];
  for (const r of rings) {
    let w = Infinity, s = Infinity, e = -Infinity, nn = -Infinity;
    for (const [lon, lat] of r) { w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); nn = Math.max(nn, lat); }
    const tx = (lon) => Math.min(n - 1, Math.max(0, Math.floor((lon + 180) / 360 * n)));
    const ty = (lat) => Math.min(n - 1, Math.max(0, Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n)));
    for (let x = tx(w); x <= tx(e); x++) for (let y = ty(nn); y <= ty(s); y++) tiles.add(x * n + y);
  }
  for (const k of [...tiles].sort((a, b) => a - b)) {
    const x = Math.floor(k / n), y = k % n, t = index.getTile(Z, x, y);
    if (!t) continue;
    const rs = t.features.flatMap((f) => f.geometry);
    const full = rs.filter(square).length, partial = rs.filter((r) => !square(r));
    if (partial.length) edge.push({ x, y, rings: rs });
    else if (full % 2) inside.push({ x, y });
  }
  return { inside, edge };
}

// [[y, x0, x1, …]]: the tiles as runs along each row
export function rowsOf(tiles) {
  const byY = new Map();
  for (const { x, y } of tiles) (byY.get(y) || byY.set(y, []).get(y)).push(x);
  return [...byY].sort((a, b) => a[0] - b[0]).map(([y, xs]) => {
    xs.sort((a, b) => a - b);
    const row = [y];
    for (const x of xs) { if (row.length > 1 && row.at(-1) === x - 1) row[row.length - 1] = x; else row.push(x, x); }
    return row;
  });
}
// a border tile's rings as bytes (the format at the top)
export function encodeMask(rings, buffer = BUFFER) {
  const pts = rings.reduce((a, r) => a + r.length, 0);
  const b = Buffer.alloc(4 + rings.length * 4 + pts * 4);
  let o = b.writeUInt32LE(rings.length, 0);
  for (const r of rings) { o = b.writeUInt32LE(r.length, o); for (const [x, y] of r) { o = b.writeUInt16LE(x + buffer, o); o = b.writeUInt16LE(y + buffer, o); } }
  return b;
}

// an OSM relation (relation/{id}/full, as JSON) as rings: its outer and inner ways, chained
export function ringsOfRelation(full, rel) {
  const nodes = new Map(), ways = new Map();
  let relation = null;
  for (const e of full.elements) {
    if (e.type === 'node') nodes.set(e.id, [e.lon, e.lat]);
    else if (e.type === 'way') ways.set(e.id, e.nodes);
    else if (e.type === 'relation' && e.id === rel) relation = e;
  }
  if (!relation) throw new Error(`relation ${rel} not in its own answer`);
  const lines = relation.members.filter((m) => m.type === 'way' && (m.role === 'outer' || m.role === 'inner'))
    .map((m) => ways.get(m.ref)?.map((n) => nodes.get(n))).filter((l) => l?.length > 1 && l.every(Boolean));
  return mergeShared(lines);
}

async function download(dir) {
  mkdirSync(join(dir, 'src'), { recursive: true });
  for (const rels of Object.values(SOURCES)) {
    for (const rel of rels) {
      const r = await fetch(`${OSM_API}/${rel}/full.json`, { headers: { 'User-Agent': 'earthplotter-build (https://github.com/stemanfredi/earth-plotter)' } });
      if (!r.ok) throw new Error(`relation ${rel}: HTTP ${r.status}`);
      writeFileSync(join(dir, 'src', `${rel}.json`), Buffer.from(await r.arrayBuffer()));
      console.log('relation', rel, 'downloaded');
    }
  }
}
function build(dir) {
  for (const [id, rels] of Object.entries(SOURCES)) {
    const rings = rels.flatMap((rel) => {
      const file = join(dir, 'src', `${rel}.json`);
      if (!existsSync(file)) throw new Error(`${file}: run download first`);
      return ringsOfRelation(JSON.parse(readFileSync(file, 'utf8')), rel);
    });
    console.log(id, `${rings.length} rings from ${rels.length} relation${rels.length > 1 ? 's' : ''}`);
    const { inside, edge } = cut(rings);
    const out = join(dir, 'tiles', RELEASE, id);
    for (const t of edge) {
      mkdirSync(join(out, String(Z), String(t.x)), { recursive: true });
      writeFileSync(join(out, String(Z), String(t.x), `${t.y}.bin`), encodeMask(t.rings));
    }
    writeFileSync(join(out, 'index.json'), JSON.stringify({ z: Z, extent: EXTENT, buffer: BUFFER, source: CREDIT, relations: rels, inside: rowsOf(inside), edge: rowsOf(edge) }));
    console.log(id, `${inside.length} tiles inside, ${edge.length} on the border`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, dir] = process.argv.slice(2);
  if (!dir || !['download', 'build'].includes(cmd)) { console.error('usage: node tools/coverage.mjs download|build DIR'); process.exit(1); }
  await (cmd === 'download' ? download(dir) : build(dir));
}
