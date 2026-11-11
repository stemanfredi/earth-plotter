import { test } from 'node:test';
import assert from 'node:assert/strict';

const { spread, GAP, STEP } = await import('../../site/draw/spread.js');
const { drawParts } = await import('../../site/draw/features.js');
const { connect } = await import('../../site/draw/generator.js');
const { emptyDoc, addPoint, linkFrom } = await import('../../site/draw/document.js');
const { mercator, metresPerPixel } = await import('../../site/geo.js');

const ZOOM = 10, mpp = metresPerPixel(ZOOM);
const px = (p) => mercator(p).map((v) => v / mpp);
// points every step° east from [10, 40], connected in trees of `size` to a root at `root`
function row(n, size, root, step = 0.02) {
  const doc = emptyDoc(0), ps = Array.from({ length: n }, (_, i) => addPoint(doc, [10 + i * step, 40]));
  const o = addPoint(doc, root), c = connect(doc, { pointIds: ps.map((p) => p.id), roots: [{ id: o.id, weight: 1 }], pattern: 'tree', groupSize: size, minBranch: 20 }).connection;
  const hubs = doc.points.filter((p) => c.created.includes(p.id)), trunkOf = (h) => doc.lines.find((l) => [0, 1].map((i) => linkFrom(doc, l.id, i).to.element).join() === `${o.id},${h.id}`);
  return { doc, ps, o, hubs, trunkOf };
}

test('spread: a hub on the row of its points is shown GAP px to the side of the root, at its place along it', () => {
  const { doc, hubs, trunkOf } = row(6, 3, [10.05, 40.3]); // the root north of the row
  const { at, via } = spread(doc, mpp);
  assert.equal(at.size, hubs.length);
  for (const h of hubs) {
    const real = px(h.position), shown = px(at.get(h.id));
    assert.ok(Math.abs(shown[0] - real[0]) < 0.5, 'the same place along the row');
    assert.ok(Math.abs(shown[1] - px([10, 40])[1] - GAP) < 0.5, 'GAP px north of the row');
  }
  assert.ok(hubs.every((h) => !via.has(trunkOf(h).id)), 'a root off the row: its lines straight');
});

test('spread: a root on the row: each line past other hubs beside the row at its own distance, 45° from the root and onto its hub', () => {
  const { doc, o: root, hubs, trunkOf } = row(9, 3, [9.9, 40]); // the root west of the row, on its line
  const { at, via } = spread(doc, mpp), [x0, y0] = px(root.position);
  const byReach = [...hubs].sort((a, b) => a.position[0] - b.position[0]);
  byReach.forEach((h, k) => {
    const H = px(at.get(h.id)), way = (via.get(trunkOf(h).id) ?? []).map(px), o = GAP + k * STEP;
    assert.ok(Math.abs(H[1] - y0 - GAP) < 0.5, 'the hub to the left of the row');
    if (!k) { assert.equal(way.length, 0, 'the nearest passes none: straight'); return; }
    for (const p of way) assert.ok(Math.abs(p[1] - y0 - o) < 0.5, `${k} steps beyond the hubs`);
    assert.ok(Math.abs(way[0][0] - x0 - o) < 0.5, 'reached at 45° from the root: where the others reach theirs');
    assert.ok(Math.abs(H[0] - way.at(-1)[0] - k * STEP) < 0.5, 'left at 45° for its hub');
  });
});

test('spread: a hub seen off its row stays; no rule, nothing', () => {
  const { doc, hubs } = row(6, 3, [10.05, 40.3]);
  hubs[0].position = [hubs[0].position[0], 40.05]; // far from the row at this zoom
  assert.equal(spread(doc, mpp).at.has(hubs[0].id), false);
  assert.equal(spread(emptyDoc(0), mpp).at.size, 0);
});

test('spread: drawn so only when asked; the document as it was', () => {
  const { doc, hubs, trunkOf } = row(9, 3, [9.9, 40]), before = JSON.stringify(doc);
  const lineOf = (parts, id) => parts.zoom.find((f) => f.properties.id === id && f.properties.kind === 'path').geometry.coordinates;
  const far = [...hubs].sort((a, b) => b.position[0] - a.position[0])[0], id = trunkOf(far).id;
  assert.equal(lineOf(drawParts(doc, new Set(), null, { zoom: ZOOM }), id).length, 2);
  const on = drawParts(doc, new Set(), null, { zoom: ZOOM, spread: true });
  assert.equal(lineOf(on, id).length, 5); // out, as far as the last hub passed, in
  assert.deepEqual(on.base.find((f) => f.properties.id === far.id).geometry.coordinates, spread(doc, mpp).at.get(far.id));
  assert.equal(JSON.stringify(doc), before);
});

test('spread: a line to a hub shown aside keeps its shape: no bend along it', () => {
  const { doc, hubs, trunkOf } = row(6, 3, [10.05, 42]); // a root far enough for its lines to be traced with points between
  const c = drawParts(doc, new Set(), null, { zoom: ZOOM, spread: true }).zoom.find((f) => f.properties.id === trunkOf(hubs[0]).id && f.properties.kind === 'path').geometry.coordinates.map(px);
  assert.ok(c.length > 2);
  const off = (p) => Math.abs((c.at(-1)[0] - c[0][0]) * (c[0][1] - p[1]) - (c[0][0] - p[0]) * (c.at(-1)[1] - c[0][1])) / Math.hypot(c.at(-1)[0] - c[0][0], c.at(-1)[1] - c[0][1]);
  assert.ok(Math.max(...c.map(off)) < 2, 'within 2 px of the straight way between its ends');
});

test('spread: a root\'s line to another row past the hubs on its way: beside their row beyond every line there, to the last of them', () => {
  const { doc, o, hubs } = row(9, 3, [9.9, 40]);
  const more = [[10.3, 40.004], [10.32, 40.005], [10.34, 40.006]].map((p) => addPoint(doc, p)); // a row turned a little from the first, beyond its end
  const c = connect(doc, { pointIds: more.map((p) => p.id), roots: [{ id: o.id, weight: 1 }], pattern: 'tree', groupSize: 3, minBranch: 20 }).connection;
  const line = doc.lines.find((l) => c.created.includes(l.id) && linkFrom(doc, l.id, 0).to.element === o.id);
  const { at, via } = spread(doc, mpp), way = via.get(line.id).map(px), y0 = px([10, 40])[1], far = GAP + hubs.length * STEP;
  for (const p of way.slice(0, 2)) assert.ok(Math.abs(p[1] - y0 - far) < 0.5, 'a step beyond the row\'s own lines');
  assert.ok(Math.abs(way[1][0] - Math.max(...hubs.map((h) => px(at.get(h.id))[0]))) < 0.5, 'as far as the last hub of that row');
  const own = px(at.get(linkFrom(doc, line.id, 1).to.element));
  assert.ok(Math.abs(Math.hypot(way.at(-1)[0] - own[0], way.at(-1)[1] - own[1]) - (far - GAP) * Math.SQRT2) < 1, 'then onto its own hub at 45°, by its row');
});

test('spread: a root to the side, further from the row than its lines would run: they are straight, zoomed out too', () => {
  const { doc, hubs, trunkOf } = row(9, 3, [10.08, 40.3]);
  for (const z of [6, 7, 8, 10, 12, 13]) { const { via } = spread(doc, metresPerPixel(z)); assert.ok(hubs.every((h) => !via.has(trunkOf(h).id)), `zoom ${z}`); }
});

test('spread: a hub\'s lines to its points beside the row, between it and the hub: the further the point, the further from the row', () => {
  const { doc, ps, hubs } = row(5, 5, [10.04, 40.3]); // one hub, at the middle point: two points each side
  const { via } = spread(doc, mpp), y0 = px([10, 40])[1], h = hubs[0];
  const lineTo = (p) => doc.lines.find((l) => [0, 1].map((i) => linkFrom(doc, l.id, i).to.element).join() === `${h.id},${p.id}`);
  const far = via.get(lineTo(ps[0]).id).map(px), nearer = via.get(lineTo(ps[1]).id).map(px);
  assert.deepEqual([far.length, nearer.length], [2, 2]);
  for (const p of nearer) assert.ok(Math.abs(p[1] - y0 - GAP / 3) < 0.5);
  for (const p of far) assert.ok(Math.abs(p[1] - y0 - (2 * GAP) / 3) < 0.5);
  assert.equal(via.has(lineTo(ps[2]).id), false, 'the point under the hub: straight');
});
