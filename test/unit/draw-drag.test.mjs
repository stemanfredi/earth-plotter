import { test } from 'node:test';
import assert from 'node:assert/strict';
import { near, lineFrom } from './helpers.mjs';

const drag = await import('../../site/draw/drag.js');
const { radiusTo, bearingTo, sectorEdgeTo } = drag;
const { destination, inverse, moveAbout } = await import('../../site/geodesy.js');
const { emptyDoc, addPoint, addCircle, moveElements } = await import('../../site/draw/document.js');

const C = [12, 40];

test('radius, bearing, aperture from the pointer; across north', () => {
  near(radiusTo(C, destination(C, 70, 1234)), 1234, 1e-6, 'radius');
  near(bearingTo(C, destination(C, 70, 1234)), 70, 1e-6, 'bearing');
  assert.equal(bearingTo(C, destination(C, 52, 500), 15), 45);
  assert.equal(bearingTo(C, destination(C, 353, 500), 15), 0);
});

test('an end of a sector\'s arc dragged: the other end stays; across north; at least 1°; wrapping past the kept end', () => {
  // 90° about 0: from 315 to 45, clockwise
  const end = sectorEdgeTo(C, 0, 90, 0.5, destination(C, 90, 500)); // the end to 90: 315 → 90
  near(end.aperture, 135, 1e-6, 'aperture'); near(end.bearing, 22.5, 1e-6, 'bearing');
  const start = sectorEdgeTo(C, 0, 90, -0.5, destination(C, 345, 500)); // the start to 345: 345 → 45
  near(start.aperture, 60, 1e-6, 'aperture across north'); near(start.bearing, 15, 1e-6, 'bearing');
  const thin = sectorEdgeTo(C, 0, 90, 0.5, destination(C, 315.5, 500)); // the end just past the start
  near(thin.aperture, 1, 1e-9, 'at least 1'); near(thin.bearing, 315.5, 1e-6, 'from the kept start');
  const wide = sectorEdgeTo(C, 0, 90, 0.5, destination(C, 300, 500)); // past the start: nearly all round
  near(wide.aperture, 345, 1e-6, 'wrapped'); near(wide.bearing, 127.5, 1e-6, 'bearing');
  assert.equal(sectorEdgeTo(C, 0, 90, 0.5, destination(C, 97, 500), 15).aperture, 135, 'Shift: the end on 15° steps');
});

test('one rigid move on the ellipsoid: distance and bearing from the anchor kept (turned), the anchor where it goes', () => {
  const a = [12, 0], b = [12, 60], q = destination(a, 30, 5000), mv = moveAbout(a, b, 15);
  assert.deepEqual(mv(a), b);
  const g = inverse(b, mv(q));
  near(g.s, 5000, 1e-6, 'distance'); near(g.azi, 45, 1e-9, 'bearing, turned');
  // not in the projection: a 100 m east-west reach at the equator is 100 m at 60°N, not 50
  near(inverse(moveAbout(a, b)(a), moveAbout(a, b)(destination(a, 90, 100))).s, 100, 1e-6, 'its size kept');
});

test('a selection moved: a point moved through a selected line\'s linked place carries its shapes once, a selected one too', () => {
  const doc = emptyDoc(0), p = addPoint(doc, [12, 40]), c = addCircle(doc, [12, 40], { groupId: p.id });
  const l = lineFrom(doc, [11.9, 40], [], p.id);
  moveElements(doc, [c.id, l.id], [12, 40], [12.1, 40.05]); // the circle before the line: met before its point is known to move
  near(inverse(p.position, [12.1, 40.05]).s, 0, 1e-6, 'the point moved with the line\'s place on it');
  near(inverse(p.position, c.position).s, 0, 1e-6, 'its circle carried once: still on it');
});

test('a point moved: the points its own lines are linked to stay where they are', () => {
  const doc = emptyDoc(0), p = addPoint(doc, [12, 40]), q = addPoint(doc, [12.2, 40]);
  const l = lineFrom(doc, [12, 40.01], [], q.id, { groupId: p.id }); // a shape of p, its end on q
  moveElements(doc, [p.id], [12, 40], [12.1, 40.05]);
  assert.deepEqual(q.position, [12.2, 40], 'q not dragged along');
  near(inverse(p.position, [12.1, 40.05]).s, 0, 1e-6, 'the point moved');
  near(inverse(p.position, l.points[0]).s, inverse([12, 40], [12, 40.01]).s, 1e-6, 'its line carried');
});

test('a point moved only through a selected line\'s place: its own lines, selected too, pull nothing', () => {
  const doc = emptyDoc(0), p = addPoint(doc, [12, 40]), q = addPoint(doc, [12.2, 40]);
  const ring = lineFrom(doc, [12, 40.01], [[12.01, 40]], q.id, { groupId: p.id, closed: true }); // a shape of p, a corner on q
  const l = lineFrom(doc, [11.9, 40], [], p.id); // a free line, its end on p
  moveElements(doc, [ring.id, l.id], [12, 40], [12.1, 40.05]); // the ring before the line: met before p is known to move
  near(inverse(p.position, [12.1, 40.05]).s, 0, 1e-6, 'p moved with the line\'s place on it');
  assert.deepEqual(q.position, [12.2, 40], 'q not dragged along by p\'s ring');
});

test('a held shape\'s place dragged resizes it, the farthest place kept, the centre moving; Shift the proportions too; never past the kept place', () => {
  const { scaledPlaces } = drag;
  // a 100 × 50 rectangle facing 30°: corners 50 along, 25 across; the back left corner (−50, −25) is the farthest from the front right (50, 25)
  const B = 30, at = (a, x) => destination(C, B + Math.atan2(x, a) * 180 / Math.PI, Math.hypot(a, x));
  const rect = [at(50, -25), at(50, 25), at(-50, 25), at(-50, -25)];
  const local = (q) => { const g = inverse(C, q), r = (g.azi - B) * Math.PI / 180; return [g.s * Math.cos(r), g.s * Math.sin(r)]; };
  const r = scaledPlaces(C, B, rect, 1, at(150, 75)); // the front right corner to (150, 75): 200 × 100, the back left kept
  const out = r.points.map(local);
  [[150, -25], [150, 75], [-50, 75], [-50, -25]].forEach(([a, x], i) => { near(out[i][0], a, 1e-3, `along ${i}`); near(out[i][1], x, 1e-3, `across ${i}`); });
  near(local(r.centre)[0], 50, 1e-3, 'the centre along'); near(local(r.centre)[1], 25, 1e-3, 'the centre across');
  const even = scaledPlaces(C, B, rect, 1, at(150, 75), true).points.map(local); // one factor: the distances' ratio from the kept corner
  const f = Math.hypot(200, 100) / Math.hypot(100, 50);
  near(even[1][0], -50 + 100 * f, 1e-3, 'even along'); near(even[1][1], -25 + 50 * f, 1e-3, 'even across');
  const past = scaledPlaces(C, B, rect, 1, at(-60, 25)).points.map(local); // dragged past the kept corner: 5 % at least along, no flip
  near(past[1][0], -50 + 100 * 0.05, 1e-3, 'at least 5 %'); near(past[1][1], 25, 1e-3, 'across as dragged');
});

test('a point\'s shape selected alone and moved: its point moves instead, every shape with it', () => {
  const doc = emptyDoc(0), p = addPoint(doc, [12, 40]), c = addCircle(doc, [12, 40], { groupId: p.id, radius: 500 });
  const ring = lineFrom(doc, [12, 40.01], [[12.01, 40]], [11.99, 40], { groupId: p.id, closed: true });
  const before = ring.points.map((q) => inverse([12, 40], q));
  moveElements(doc, new Set([c.id]), [12, 40.003], [12.1, 40.053]); // grabbed on the circle's rim; a Set, as the selection is
  near(inverse(p.position, c.position).s, 0, 1e-6, 'the circle still on its point');
  ring.points.forEach((q, i) => near(inverse(p.position, q).s, before[i].s, 1e-6, `the ring's place ${i} as far from the point`));
  near(inverse([12, 40], p.position).s, inverse([12, 40.003], [12.1, 40.053]).s, 50, 'the point moved as the pointer');
});
