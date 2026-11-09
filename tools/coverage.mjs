#!/usr/bin/env node
// Where each national imagery source covers, as masks the page clips its tiles with (site/ortho.js):
// the services answer outside their country with white tiles (France, the Netherlands) or with older
// imagery of the neighbours (Switzerland), and MapLibre cuts a source only to a rectangle. So each
// country's outline is cut into zoom-12 tiles once, and published as plain files at
// geodata.earthplotter.org/{RELEASE}/{id}/ (site/ortho.js RELEASE; docs/development.md: the data host):
//
//   index.json             { z, extent, buffer, source, relations, inside: rows, edge: rows, sea: rows }:
//                          the zoom-12 tiles wholly inside the country and those its border crosses;
//                          rows: [[y, x0, x1, …]], runs of x from x0 to x1 inclusive. A tile in neither
//                          is outside. sea: those with some of the country's sea in them (for a service
//                          that paints white where it has no imagery: the page clears white there only,
//                          so snow and white roofs inland are never touched). relations: each OSM
//                          relation read, with its version and timestamp (what was built from).
//   12/{x}/{y}.bin         a border tile's mask: rings, filled even-odd, in tile units (extent,
//                          plus buffer around), as u32 ring count, then per ring u32 n and n pairs
//                          of u16 (x + buffer, y + buffer), little-endian
//
//   node tools/coverage.mjs download DIR   the outlines into DIR/src
//   node tools/coverage.mjs build DIR      DIR/tiles/{RELEASE}/{id}/ (site/ortho.js RELEASE)
//
// The outlines are OpenStreetMap's national boundaries (© OpenStreetMap contributors, ODbL: the
// masks are published under it): catalog.js ORTHO osm, read from the OSM API's relation/{id}/full,
// once per build. They include the territorial sea: the land borders are exact, and at sea each
// service's own "no imagery" decides (transparent, a 404, or white, which the page clears), so
// harbours keep their imagery. A ring that does not close fails the build, as does a country with
// no tile inside: an outline lost quietly would leave its imagery undrawn.
// Simplified to about a metre at zoom 12 (geojson-vt's tolerance), which is what the page draws.
// The sea of a white country is where its outline is and no country's land is: its own land as its
// administrative outline gives it (LAND), its neighbours' as Natural Earth's countries do (where two
// countries' outlines disagree, as on Mont Blanc's summit, that is land, not sea), cell by cell.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import geojsonvt from 'geojson-vt';
import { ORTHO } from '../site/catalog.js';
import { RELEASE } from '../site/ortho.js';
import { tileXY, clamp } from '../site/geo.js';

export const Z = 12, EXTENT = 8192, BUFFER = 64;
const OSM_API = 'https://api.openstreetmap.org/api/0.6/relation';
const CREDIT = '© OpenStreetMap contributors, ODbL';
// each white country's land (catalog.js ORTHO white): France's regions (IGN ADMIN EXPRESS COG 2025,
// Licence Ouverte 2.0, merged), the Netherlands' land and inland water (the National Georegister via
// geoBoundaries, CC0); used only to tell the country's sea, not published
export const LAND = {
  fr: { a3: 'FRA', url: 'https://data.geopf.fr/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=ADMINEXPRESS-COG.2025:region&OUTPUTFORMAT=application/json&SRSNAME=EPSG:4326&COUNT=100', merge: true },
  nl: { a3: 'NLD', url: 'https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/NLD/ADM0/geoBoundaries-NLD-ADM0.geojson' },
};
// the other countries' land: Natural Earth 1:10m countries (public domain), every one but the own
export const NEIGHBOURS = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_10m_admin_0_countries.geojson';
// every ring of a GeoJSON's polygons, as [[lon, lat], …], whatever their orientation (filled even-odd)
export function ringsOfGeoJSON(geojson) {
  const out = [], add = (g) => {
    if (g?.type === 'Polygon') out.push(...g.coordinates);
    else if (g?.type === 'MultiPolygon') for (const p of g.coordinates) out.push(...p);
  };
  for (const f of geojson.features ?? [geojson]) add(f.geometry ?? f);
  return out;
}
// which of a tile's n × n cells (centres) its rings cover, filled even-odd (a scanline per row)
export function cells(rings, n = 32, extent = EXTENT) {
  const out = new Uint8Array(n * n);
  for (let row = 0; row < n; row++) {
    const y = ((row + 0.5) * extent) / n, xs = [];
    for (const r of rings) {
      for (let i = 0; i + 1 < r.length; i++) {
        const [x0, y0] = r[i], [x1, y1] = r[i + 1];
        if ((y0 <= y) !== (y1 <= y)) xs.push(x0 + ((y - y0) * (x1 - x0)) / (y1 - y0));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const c0 = Math.max(0, Math.ceil((xs[i] * n) / extent - 0.5)), c1 = Math.min(n - 1, Math.floor((xs[i + 1] * n) / extent - 0.5));
      for (let c = c0; c <= c1; c++) out[row * n + c] = 1;
    }
  }
  return out;
}
// land sources for seaTiles, each (x, y) → the cells of zoom-12 tile x/y that are land (all of them:
// true), or null: from cut()'s tiles (the country's own land), or from a geojson-vt index (its neighbours)
export function landOfCut({ inside, edge }, n = 32) {
  const key = (x, y) => `${x}/${y}`, all = new Set(inside.map((t) => key(t.x, t.y))), part = new Map(edge.map((t) => [key(t.x, t.y), t.rings]));
  return (x, y) => (all.has(key(x, y)) ? true : part.has(key(x, y)) ? cells(part.get(key(x, y)), n) : null);
}
export function landOfIndex(index, n = 32) {
  return (x, y) => { const t = index.getTile(Z, x, y); return t?.features.length ? cells(t.features.flatMap((f) => f.geometry), n) : null; };
}
// the country's tiles with some of its sea: cells of its outline that no land source holds, a few at
// least (two outlines differ by metres along a border: a sliver, not cells)
export function seaTiles(country, lands, { n = 32, least = 3 } = {}) {
  const full = cells([[[0, 0], [EXTENT, 0], [EXTENT, EXTENT], [0, EXTENT], [0, 0]]], n), out = [];
  for (const t of [...country.inside, ...country.edge]) {
    const own = lands[0](t.x, t.y);
    if (own === true) continue;
    const ls = [own, ...lands.slice(1).map((l) => l(t.x, t.y))].filter(Boolean);
    if (ls.includes(true)) continue;
    const c = t.rings ? cells(t.rings, n) : full;
    let k = 0;
    for (let i = 0; i < n * n; i++) if (c[i] && !ls.some((l) => l[i])) k++;
    if (k >= least) out.push({ x: t.x, y: t.y });
  }
  return out;
}

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
        if (!on) throw new Error(`an open outline at ${next}: a way missing, or listed twice`);
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
  const tile = (lon, lat) => { const t = tileXY(lon, lat, Z); return [clamp(Math.floor(t.x), 0, n - 1), clamp(Math.floor(t.y), 0, n - 1)]; };
  for (const r of rings) {
    let w = Infinity, s = Infinity, e = -Infinity, nn = -Infinity;
    for (const [lon, lat] of r) { w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); nn = Math.max(nn, lat); }
    const [x0, y0] = tile(w, nn), [x1, y1] = tile(e, s);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.add(x * n + y);
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
  const members = relation.members.filter((m) => m.type === 'way' && (m.role === 'outer' || m.role === 'inner')).map((m) => m.ref);
  const twice = members.find((ref, i) => members.indexOf(ref) !== i);
  if (twice) throw new Error(`relation ${rel}: way ${twice} listed twice`);
  const lines = members.map((ref) => ways.get(ref)?.map((n) => nodes.get(n))).filter((l) => l?.length > 1 && l.every(Boolean));
  return mergeShared(lines);
}

async function download(dir) {
  mkdirSync(join(dir, 'src'), { recursive: true });
  for (const [name, url] of [...Object.entries(LAND).map(([id, l]) => [`land-${id}`, l.url]), ['neighbours', NEIGHBOURS]]) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    writeFileSync(join(dir, 'src', `${name}.geojson`), Buffer.from(await r.arrayBuffer()));
    console.log(name, 'downloaded');
  }
  for (const { osm } of ORTHO) {
    for (const rel of osm) {
      const r = await fetch(`${OSM_API}/${rel}/full.json`, { headers: { 'User-Agent': 'earthplotter-build (https://github.com/stemanfredi/earth-plotter)' } });
      if (!r.ok) throw new Error(`relation ${rel}: HTTP ${r.status}`);
      writeFileSync(join(dir, 'src', `${rel}.json`), Buffer.from(await r.arrayBuffer()));
      console.log('relation', rel, 'downloaded');
    }
  }
}
function build(dir) {
  for (const { id, osm: rels, white } of ORTHO) {
    const relations = [], rings = rels.flatMap((rel) => {
      const file = join(dir, 'src', `${rel}.json`);
      if (!existsSync(file)) throw new Error(`${file}: run download first`);
      const full = JSON.parse(readFileSync(file, 'utf8')), r = full.elements.find((e) => e.type === 'relation' && e.id === rel);
      relations.push({ id: rel, version: r?.version, timestamp: r?.timestamp }); // the boundaries' edition this build read
      return ringsOfRelation(full, rel);
    });
    console.log(id, `${rings.length} rings from ${rels.length} relation${rels.length > 1 ? 's' : ''}`);
    const { inside, edge } = cut(rings);
    if (!inside.length) throw new Error(`${id}: no tile inside: its outlines are not closed areas`);
    let sea = [];
    if (white) { // where white may be the service's "no imagery": its sea
      if (!LAND[id]) throw new Error(`${id}: paints white, but has no LAND to tell its sea by`);
      const file = join(dir, 'src', `land-${id}.geojson`);
      if (!existsSync(file)) throw new Error(`${file}: run download first`);
      let land = ringsOfGeoJSON(JSON.parse(readFileSync(file, 'utf8')));
      if (LAND[id].merge) land = mergeShared(land);
      const world = JSON.parse(readFileSync(join(dir, 'src', 'neighbours.geojson'), 'utf8'));
      const others = { type: 'FeatureCollection', features: world.features.filter((f) => f.properties.ADM0_A3 !== LAND[id].a3) };
      sea = seaTiles({ inside, edge }, [landOfCut(cut(land)), landOfIndex(geojsonvt(others, { maxZoom: Z, indexMaxZoom: 6, indexMaxPoints: 0, extent: EXTENT, buffer: BUFFER, tolerance: 1 }))]);
    }
    const out = join(dir, 'tiles', RELEASE, id);
    for (const t of edge) {
      mkdirSync(join(out, String(Z), String(t.x)), { recursive: true });
      writeFileSync(join(out, String(Z), String(t.x), `${t.y}.bin`), encodeMask(t.rings));
    }
    writeFileSync(join(out, 'index.json'), JSON.stringify({ z: Z, extent: EXTENT, buffer: BUFFER, source: CREDIT, relations, inside: rowsOf(inside), edge: rowsOf(edge), sea: rowsOf(sea) }));
    console.log(id, `${inside.length} tiles inside, ${edge.length} on the border${white ? `, ${sea.length} with sea` : ''}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, dir] = process.argv.slice(2);
  if (!dir || !['download', 'build'].includes(cmd)) { console.error('usage: node tools/coverage.mjs download|build DIR'); process.exit(1); }
  await (cmd === 'download' ? download(dir) : build(dir));
}
