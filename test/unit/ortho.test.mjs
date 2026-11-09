import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeShared, cut, rowsOf, encodeMask, ringsOfRelation, Z, EXTENT, BUFFER } from '../../tools/coverage.mjs';
import { readIndex, where, within, decodeMask, maskPath, clearWhite, partsAt } from '../../site/ortho.js';
import { ORTHO, ORTHO_MIN } from '../../site/catalog.js';
import { HOSTS } from '../../site/hosts.js';

// a square of lon/lat, closed, counter-clockwise
const box = (w, s, e, n) => [[w, s], [e, s], [e, n], [w, n], [w, s]];

test('regions that share a border merge into one outline (the shared edges dropped, either way round)', () => {
  const west = box(0, 0, 1, 1), east = [[2, 1], [2, 0], [1, 0], [1, 1], [2, 1]]; // the other way round
  const merged = mergeShared([west, east]);
  assert.equal(merged.length, 1);
  const xs = merged[0].map((p) => p[0]), ys = merged[0].map((p) => p[1]);
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [0, 2, 0, 1]);
  assert.ok(!merged[0].some(([x, y]) => x === 1 && y > 0 && y < 1), 'no vertex left on the shared border but its ends');
  assert.equal(mergeShared([box(0, 0, 1, 1), box(5, 5, 6, 6)]).length, 2, 'apart: two rings');
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
});

test('zoom-12 tiles sorted: inside, on the border, outside; a hole\'s tiles are outside', () => {
  // a square of 0.5°, with a hole of 0.2° in its middle: tiles wholly inside, wholly in the hole, and between
  const rings = [box(10, 45, 10.5, 45.5), box(10.15, 45.15, 10.35, 45.35)];
  const { inside, edge } = cut(rings);
  const n = 2 ** Z, tx = (lon) => Math.floor((lon + 180) / 360 * n), ty = (lat) => Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n);
  const has = (list, lon, lat) => list.some((t) => t.x === tx(lon) && t.y === ty(lat));
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

test('the national sources: on hosts the page knows, from zoom 12, each with a credit and where it is due', () => {
  const hosts = Object.values(HOSTS);
  assert.equal(ORTHO_MIN, 12);
  for (const o of ORTHO) {
    assert.ok(o.parts.length && o.parts.every((p) => hosts.some((h) => p.startsWith(`${h}/`)) && /\{z\}/.test(p) && /\{x\}/.test(p) && /\{y\}/.test(p)), `${o.id}: parts`);
    assert.ok(o.credit && o.areas.length && o.areas.every(([w, s, e, n]) => w < e && s < n), `${o.id}: credit and areas`);
    assert.ok(o.maxzoom >= 18);
  }
  assert.deepEqual(ORTHO.find((o) => o.id === 'it').parts.map((p) => /AgEA_(\d+)/.exec(p)[1]), ['2022', '2023', '2024'], 'Italy\'s flights oldest first, the newest drawn on top');
});

test('a service\'s white cleared where it joins the tile\'s edge; white inside the imagery kept', () => {
  // 6 × 4: white on the left two columns (no imagery), imagery with one white pixel at (4, 2)
  const w = 6, h = 4, px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = 4 * (y * w + x), white = x < 2 || (x === 4 && y === 2);
    px.set(white ? [252, 255, 250, 255] : [60, 90, 70, 255], i);
  }
  clearWhite(px, w, h);
  const alpha = (x, y) => px[4 * (y * w + x) + 3];
  assert.ok([0, 1].every((x) => [0, 1, 2, 3].every((y) => alpha(x, y) === 0)), 'the edge\'s white: transparent');
  assert.equal(alpha(4, 2), 255, 'a white roof inside the imagery: kept');
  assert.equal(alpha(3, 1), 255, 'the imagery: kept');
  // a light pixel next to the cleared white (a JPEG's halo) goes with it; a dark one stays
  const h2 = new Uint8ClampedArray(3 * 1 * 4);
  h2.set([255, 255, 255, 255, 230, 232, 228, 255, 60, 90, 70, 255]);
  clearWhite(h2, 3, 1);
  assert.deepEqual([h2[3], h2[7], h2[11]], [0, 0, 255]);
});

test('a part is not asked beyond its bounds (Italy\'s flights)', () => {
  const it = ORTHO.find((o) => o.id === 'it');
  assert.equal(it.partBounds.length, it.parts.length);
  const at = (lat, lon, z = 14) => { const n = 2 ** z; return partsAt(it, z, Math.floor((lon + 180) / 360 * n), Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n)).map((p) => /AgEA_(\d+)/.exec(p)[1]); };
  assert.deepEqual(at(45.464, 9.19), ['2023', '2024'], 'Milan: beyond the 2022 flight\'s extent');
  assert.deepEqual(at(37.5, 15.0), ['2022'], 'Catania: the 2022 flight\'s only');
  assert.equal(partsAt(ORTHO.find((o) => o.id === 'fr'), 14, 8000, 6000).length, 1, 'no bounds: every part');
});
