import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeShared, cut, rowsOf, encodeMask, ringsOfRelation, Z, EXTENT, BUFFER, cells, seaTiles, ringsOfGeoJSON, landOfCut } from '../../tools/coverage.mjs';
import { readIndex, where, within, covers, decodeMask, maskPath, clearWhite, partsAt, atSea } from '../../site/ortho.js';
import { ORTHO } from '../../site/catalog.js';
import { HOSTS } from '../../site/hosts.js';
import { tileXY } from '../../site/geo.js';

// a square of lon/lat, closed, counter-clockwise
const box = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
// the tile [x, y] of zoom z holding lon/lat
const tileOf = (lon, lat, z = Z) => { const t = tileXY(lon, lat, z); return [Math.floor(t.x), Math.floor(t.y)]; };

test('regions that share a border merge into one outline (the shared edges dropped, either way round)', () => {
  const west = box(0, 0, 1, 1), east = [[2, 1], [2, 0], [1, 0], [1, 1], [2, 1]]; // the other way round
  const merged = mergeShared([west, east]);
  assert.equal(merged.length, 1);
  const xs = merged[0].map((p) => p[0]), ys = merged[0].map((p) => p[1]);
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [0, 2, 0, 1]);
  assert.ok(!merged[0].some(([x, y]) => x === 1 && y > 0 && y < 1), 'no vertex left on the shared border but its ends');
  assert.equal(mergeShared([box(0, 0, 1, 1), box(5, 5, 6, 6)]).length, 2, 'apart: two rings');
  assert.throws(() => mergeShared([[[0, 0], [1, 0], [1, 1]]]), /open outline/, 'a ring that does not close: the build fails');
});

test('an OSM relation\'s outer and inner ways chained into rings; its other members left out', () => {
  const full = { elements: [
    ...[[1, 0, 0], [2, 1, 0], [3, 1, 1], [4, 0, 1], [5, 0.2, 0.2], [6, 0.4, 0.2], [7, 0.4, 0.4], [9, 5, 5]].map(([id, lon, lat]) => ({ type: 'node', id, lon, lat })),
    { type: 'way', id: 10, nodes: [1, 2, 3] }, { type: 'way', id: 11, nodes: [1, 4, 3] }, // the outer ring in two ways, both from node 1
    { type: 'way', id: 12, nodes: [5, 6, 7, 5] }, // an inner ring
    { type: 'relation', id: 99, members: [{ type: 'way', ref: 10, role: 'outer' }, { type: 'way', ref: 11, role: 'outer' }, { type: 'way', ref: 12, role: 'inner' }, { type: 'node', ref: 9, role: 'admin_centre' }] }] };
  const rings = ringsOfRelation(full, 99);
  assert.equal(rings.length, 2);
  assert.deepEqual(rings.map((r) => r.length).sort(), [4, 5], 'the inner ring (3 points, closed) and the outer one (4, closed)');
  assert.ok(rings.every((r) => r[0] === r.at(-1)), 'closed');
  const twice = { elements: full.elements.map((e) => (e.type === 'relation' ? { ...e, members: [...e.members, { type: 'way', ref: 12, role: 'inner' }] } : e)) };
  assert.throws(() => ringsOfRelation(twice, 99), /way 12 listed twice/, 'a way listed twice (its edges would cancel): the build fails');
});

test('zoom-12 tiles sorted: inside, on the border, outside; a hole\'s tiles are outside', () => {
  // a square of 0.5°, with a hole of 0.2° in its middle: tiles wholly inside, wholly in the hole, and between
  const rings = [box(10, 45, 10.5, 45.5), box(10.15, 45.15, 10.35, 45.35)];
  const { inside, edge } = cut(rings);
  const has = (list, lon, lat) => { const [x, y] = tileOf(lon, lat); return list.some((t) => t.x === x && t.y === y); };
  assert.ok(has(inside, 10.07, 45.25), 'between the outline and the hole: inside');
  assert.ok(!has(inside, 10.25, 45.25) && !has(edge, 10.25, 45.25), 'in the hole: outside');
  assert.ok(has(edge, 10.5, 45.25) && has(edge, 10.15, 45.25), 'on the outline and on the hole\'s edge: the border');
  assert.ok(!has(inside, 11, 45.25) && !has(edge, 11, 45.25), 'beyond: outside');
});

test('the index rows, and a tile found by its coverage tile at any deeper zoom', () => {
  const rows = rowsOf([{ x: 5, y: 2 }, { x: 6, y: 2 }, { x: 7, y: 2 }, { x: 9, y: 2 }, { x: 4, y: 1 }]);
  assert.deepEqual(rows, [[1, 4, 4], [2, 5, 7, 9, 9]], 'runs of x along each row');
  const cov = readIndex({ z: 12, extent: EXTENT, buffer: BUFFER, inside: rows, edge: [[3, 5, 5]] });
  assert.ok(within(cov.inside, 6, 2) && !within(cov.inside, 8, 2));
  assert.equal(where(cov, 12, 6, 2), 'inside');
  assert.equal(where(cov, 14, 6 * 4 + 3, 2 * 4 + 1), 'inside', 'a zoom-14 tile inside a zoom-12 one');
  assert.equal(where(cov, 13, 10, 6), 'edge');
  assert.equal(where(cov, 12, 8, 2), null);
  assert.equal(where(cov, 11, 3, 1), null, 'below the coverage\'s zoom: not drawn');
});

test('a country credited where its coverage is in view, not where only its rectangle would be', () => {
  // the coverage: one zoom-12 tile inside at Amsterdam, one on the border east of it
  const [ax, ay] = tileOf(4.893, 52.373);
  const cov = readIndex({ z: 12, extent: EXTENT, buffer: BUFFER, inside: [[ay, ax, ax]], edge: [[ay, ax + 1, ax + 1]] });
  assert.ok(covers('nl', [4.88, 52.36, 4.9, 52.38], cov), 'Amsterdam in view');
  assert.ok(covers('nl', [4.0, 52.0, 6.0, 53.0], cov), 'a wider view holding it');
  assert.ok(!covers('nl', [4.33, 50.83, 4.37, 50.87], cov), 'Brussels: within the old rectangle, not the coverage');
  assert.ok(!covers('nl', [4.88, 52.36, 4.9, 52.38]), 'not read yet: no credit');
  const bonaire = tileOf(-68.27, 12.15), far = readIndex({ z: 12, extent: EXTENT, buffer: BUFFER, inside: [[bonaire[1], bonaire[0], bonaire[0]]], edge: [] });
  assert.ok(!covers('nl', [-68.3, 12.1, -68.2, 12.2], far), 'beyond the source\'s bounds (the Caribbean islands): none');
});

test('a border tile\'s mask: written by the build, read by the page, placed on deeper tiles', () => {
  const rings = [[[-BUFFER, -BUFFER], [EXTENT / 2, -BUFFER], [EXTENT / 2, EXTENT + BUFFER], [-BUFFER, EXTENT + BUFFER], [-BUFFER, -BUFFER]], [[100, 100], [200, 100], [200, 200], [100, 100]]];
  const b = encodeMask(rings);
  const back = decodeMask(new Uint8Array(b.buffer, b.byteOffset, b.byteLength), BUFFER);
  assert.deepEqual(back, rings.map((r) => r.flat()));
  // its path on the zoom-13 tile at the coverage tile's top right: the left half of the mask is the
  // whole of the zoom-12 tile's left half, so on this tile it ends at its left edge (x = 0)
  const ops = [];
  const g = { beginPath: () => ops.push(['b']), moveTo: (x, y) => ops.push(['m', x, y]), lineTo: (x, y) => ops.push(['l', x, y]), closePath: () => ops.push(['c']) };
  const cov = { z: 12, extent: EXTENT };
  maskPath(g, back, cov, 13, 2 * 7 + 1, 2 * 3, 256);
  assert.deepEqual(ops[1], ['m', (-BUFFER / EXTENT) * 2 * 256 - 256, (-BUFFER / EXTENT) * 2 * 256]);
  assert.deepEqual(ops[2], ['l', 0, (-BUFFER / EXTENT) * 2 * 256], 'the half-way line at the tile\'s left edge');
});

test('the national sources: on hosts the page knows, each with a credit, its ⓘ and its boundaries', () => {
  const hosts = Object.values(HOSTS);
  for (const o of ORTHO) {
    assert.ok(o.parts.length && o.parts.every((p) => hosts.some((h) => p.startsWith(`${h}/`)) && /\{z\}/.test(p) && /\{x\}/.test(p) && /\{y\}/.test(p)), `${o.id}: parts`);
    assert.ok(o.credit && o.src && o.lic && o.osm.length && o.osm.every(Number.isInteger), `${o.id}: credit, ⓘ and OSM relations`);
  }
  assert.deepEqual(ORTHO.find((o) => o.id === 'it').parts.map((p) => /AgEA_(\d+)/.exec(p)[1]), ['2022', '2023', '2024'], 'Italy\'s flights oldest first, the newest drawn on top');
});

// a w × h tile of RGBA pixels, each colour(x, y)
const pixels = (w, h, colour) => {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px.set([...colour(x, y), 255], 4 * (y * w + x));
  return px;
};
const DARK = [60, 90, 70], WHITE = [255, 255, 255], SNOW = [252, 253, 250];
test('a service\'s white cleared from the tile\'s edge, with the near white it joins; white of the imagery kept', () => {
  // 32 × 20: the service's pure white on the left two columns (no imagery), near white in the
  // JPEG's way joined to it on the third; imagery with a white roof at (20, 10)
  const w = 32, h = 20;
  const px = pixels(w, h, (x, y) => (x < 2 ? WHITE : x === 2 ? SNOW : x === 20 && y === 10 ? WHITE : DARK));
  assert.equal(clearWhite(px, w, h), 3 * h, 'the pixels cleared, counted');
  const alpha = (x, y) => px[4 * (y * w + x) + 3];
  assert.ok([0, 1, 2].every((x) => alpha(x, 5) === 0), 'the edge\'s white and the near white joined to it: transparent');
  assert.equal(alpha(20, 10), 255, 'a white roof inside the imagery: kept');
  assert.equal(alpha(3, 1), 255, 'the imagery: kept');
  // a light pixel next to the cleared white (a JPEG's halo) goes with it; a dark one stays
  const h2 = pixels(18, 1, (x) => (x < 16 ? WHITE : x === 16 ? [230, 232, 228] : DARK));
  clearWhite(h2, 18, 1);
  assert.deepEqual([h2[3], h2[4 * 16 + 3], h2[4 * 17 + 3]], [0, 0, 255]);
});

test('snow and a white roof at the tile\'s edge kept; an all-white tile (the sea) cleared whole', () => {
  // a glacier across the left edge, near white but not the service's pure white
  const w = 32, h = 32;
  const snow = pixels(w, h, (x) => (x < 12 ? SNOW : DARK));
  assert.equal(clearWhite(snow, w, h), 0, 'snow: kept');
  // a white roof of pure white touching the top edge, shorter than a run of the service's white
  const roof = pixels(w, h, (x, y) => (x >= 4 && x < 14 && y < 6 ? WHITE : DARK));
  assert.equal(clearWhite(roof, w, h), 0, 'a roof at the edge: kept');
  const sea = pixels(w, h, () => WHITE);
  assert.equal(clearWhite(sea, w, h), w * h, 'the sea, all white: every pixel');
});

test('a part is not asked beyond its bounds (Italy\'s flights)', () => {
  const it = ORTHO.find((o) => o.id === 'it');
  assert.equal(it.partBounds.length, it.parts.length);
  const at = (lat, lon, z = 14) => partsAt(it, z, ...tileOf(lon, lat, z)).map((p) => /AgEA_(\d+)/.exec(p)[1]);
  assert.deepEqual(at(45.464, 9.19), ['2023', '2024'], 'Milan: beyond the 2022 flight\'s extent');
  assert.deepEqual(at(37.5, 15.0), ['2022'], 'Catania: the 2022 flight\'s only');
  assert.equal(partsAt(ORTHO.find((o) => o.id === 'fr'), 14, 8000, 6000).length, 1, 'no bounds: every part');
});

test('a tile\'s cells covered by its rings, even-odd', () => {
  const E = 8192, west = [[0, 0], [E / 2, 0], [E / 2, E], [0, E], [0, 0]], hole = [[0, 0], [E / 4, 0], [E / 4, E], [0, E], [0, 0]];
  const c = cells([west], 4);
  assert.deepEqual([...c.slice(0, 4)], [1, 1, 0, 0], 'the west half');
  assert.deepEqual([...cells([west, hole], 4).slice(0, 4)], [0, 1, 0, 0], 'with a hole in it');
});

test('a white country\'s sea tiles: its outline where its land is not; a land border\'s sliver is not sea', () => {
  const E = 8192, sq = [[-64, -64], [E + 64, -64], [E + 64, E + 64], [-64, E + 64], [-64, -64]];
  const half = [[-64, -64], [E / 2, -64], [E / 2, E + 64], [-64, E + 64], [-64, -64]];
  const sliver = [[-64, -64], [E - 20, -64], [E - 20, E + 64], [-64, E + 64], [-64, -64]]; // land to 20 units (a few metres) short
  const country = { inside: [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 4, y: 1 }], edge: [{ x: 3, y: 1, rings: [sq] }] };
  const land = { inside: [{ x: 1, y: 1 }], edge: [{ x: 2, y: 1, rings: [half] }, { x: 3, y: 1, rings: [sliver] }] }; // x 4: no land at all
  assert.deepEqual(seaTiles(country, [landOfCut(land)]).map((t) => t.x), [2, 4], 'half land: sea; all land: not; a sliver short: not; no land: sea');
  // a neighbour's land where the country's own outline stops (a border the two disagree on): not sea
  const neighbour = (x) => (x === 2 ? cells([[[E / 2, -64], [E + 64, -64], [E + 64, E + 64], [E / 2, E + 64], [E / 2, -64]]], 32) : null);
  assert.deepEqual(seaTiles(country, [landOfCut(land), neighbour]).map((t) => t.x), [4], 'the other half a neighbour\'s land: not sea');
  const cov = readIndex({ z: 12, extent: E, buffer: 64, inside: [], edge: [], sea: rowsOf([{ x: 2, y: 1 }]) });
  assert.ok(atSea(cov, 12, 2, 1) && atSea(cov, 14, 2 * 4 + 3, 1 * 4) && !atSea(cov, 12, 1, 1), 'found by its coverage tile at any deeper zoom');
  assert.equal(atSea(readIndex({ z: 12, extent: E, buffer: 64, inside: [], edge: [] }), 12, 2, 1), false, 'an index without sea: none');
});

test('every ring of a GeoJSON\'s polygons', () => {
  const box = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];
  const g = { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Polygon', coordinates: [box(0, 0, 3, 3), box(1, 1, 2, 2)] } },
    { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[box(5, 5, 6, 6)]] } }] };
  assert.equal(ringsOfGeoJSON(g).length, 3);
});
