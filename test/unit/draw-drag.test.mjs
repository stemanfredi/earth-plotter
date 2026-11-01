import { test } from 'node:test';
import assert from 'node:assert/strict';
import { near, lineFrom } from './helpers.mjs';

const { radiusTo, bearingTo, sectorEdgeTo } = await import('../../site/draw/drag.js');
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
