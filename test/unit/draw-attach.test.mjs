import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addShape, lineFrom, placeIn, addRing, labelOn, near } from './helpers.mjs';

const { emptyDoc, addPoint, addDot, addCircle, centroid, remove, setLink, carry } = await import('../../site/draw/document.js');
const { targetPosition, resolve, refreshAttached, reattach, insertVertex, deleteVertex, splitLine, attachAt, attachable, partName, refNear } = await import('../../site/draw/attach.js');
const { outlinePoints } = await import('../../site/draw/outlines.js');
const { snapAt, stepped, neighbours } = await import('../../site/draw/snap.js');
const { parse, serialise } = await import('../../site/draw/file.js');
const { settleGeometry } = await import('../../site/draw/store.js');
const { inverse, destination } = await import('../../site/geodesy.js');
const { lineTrace } = await import('../../site/draw/lines.js');

// place i of line s (-1 its end) as a target with its position: { position, element… } (free: { position })
const ref = (doc, s, i = -1) => ({ position: placeIn(doc, s, i).position, ...placeIn(doc, s, i).to });
// two positions within m metres of each other (the shared near: two numbers)
const nearM = (a, b, m = 0.01) => assert.ok(inverse(a, b).s < m, `${a} is ${inverse(a, b).s} m from ${b}`);
// a flat screen: 10 000 px a degree about 10° E, 40° N (y down)
const view = { project: ([lon, lat]) => [(lon - 10) * 1e4, -(lat - 40) * 1e4], unproject: ([x, y]) => [10 + x / 1e4, 40 - y / 1e4] };
const px = (p) => view.project(p);

function drawing() {
  const doc = emptyDoc(0);
  const p = addPoint(doc, [10, 40], { id: 'p' });
  const { point: shp, shapes: [sh] } = addShape(doc, [10.02, 40]); // a rectangle: a closed line its point holds
  sh.id = 'sh';
  sh.points = sh.points.map((q) => q.map((v) => +v.toFixed(7))); // as the file writes them
  const a = addRing(doc, [[10, 40.02], [10.02, 40.02], [10.02, 40.04]], { id: 'a' });
  const l = lineFrom(doc, [10.05, 40], [[10.06, 40.01]], [10.07, 40], { id: 'l' });
  return { doc, p, sh, shp, a, l };
}

test('where a reference is: a centre, a vertex, a place along an edge or a leg; nothing for what is not there', () => {
  const { doc, sh, a, l } = drawing();
  assert.deepEqual(targetPosition(doc, { element: 'p' }), [10, 40]);
  assert.deepEqual(targetPosition(doc, { element: 'a' }), centroid(a.points)); // a closed line's centre: its centroid
  assert.deepEqual(targetPosition(doc, { element: 'a', vertex: 1 }), [10.02, 40.02]);
  nearM(targetPosition(doc, { element: 'a', edge: 0, at: 0.5 }), [10.01, 40.02], 1);
  // a line's places: 0 its start, then its vertices, the last its end
  assert.deepEqual([0, 1, 2].map((k) => targetPosition(doc, { element: 'l', vertex: k })), [[10.05, 40], [10.06, 40.01], [10.07, 40]]);
  const tr = lineTrace(doc, l), mid = resolve(doc, { element: 'l' }); // a line's centre: its middle along it
  assert.ok(Math.abs(mid.along - tr.length / 2) < 1e-6 && mid.length === tr.length);
  const leg = resolve(doc, { element: 'l', edge: 1, at: 0.5 }); // half way along its second leg
  near(leg.along, (tr.at[1] + tr.legs[1] / 2), 1e-6, '');
  near(leg.edge.length, tr.legs[1], 1e-6, '');
  nearM(leg.position, [10.065, 40.005], 2);
  assert.deepEqual(targetPosition(doc, { element: 'sh', vertex: 0 }), sh.points[0]); // a shape's corner: its place
  const c = addCircle(doc, [10.1, 40], { id: 'c' });
  assert.deepEqual(targetPosition(doc, { element: 'c' }), c.position); // a circle: its centre
  for (const bad of [{ element: 'x' }, { element: 'a', vertex: 3 }, { element: 'a', edge: 3, at: 0 }, { element: 'l', vertex: 3 }, { element: 'l', edge: 2, at: 0 }, { element: 'p', vertex: 0 }, { element: 'c', edge: 0, at: 0 }]) {
    assert.equal(targetPosition(doc, bad), null, JSON.stringify(bad));
  }
  assert.deepEqual([partName({ vertex: 0 }), partName({ edge: 0 }), partName({})], ['vertex 1', 'leg 1', '']); // as the tables number them
});

test('labels follow what they point at: a shape turned with its point, an area\'s corner moved, a vertex moved; gone, free where they were', () => {
  const { doc, sh, shp, a, l } = drawing();
  const s1 = labelOn(doc, { element: 'sh', vertex: 0 });
  const s2 = labelOn(doc, { element: 'a', edge: 1, at: 0.25 });
  const s3 = labelOn(doc, { element: 'l', vertex: 1 });
  refreshAttached(doc);
  nearM(ref(doc, s1).position, sh.points[0]);
  carry(doc, shp, shp.position, 90);
  a.points[2] = [10.03, 40.05];
  l.points[1] = [10.06, 40.02];
  refreshAttached(doc);
  nearM(ref(doc, s1).position, sh.points[0]);
  nearM(ref(doc, s1).position, outlinePoints([10.02, 40], 90, 100, 50)[0]); // turned
  nearM(ref(doc, s2).position, targetPosition(doc, { element: 'a', edge: 1, at: 0.25 }));
  assert.deepEqual(ref(doc, s3).position, [10.06, 40.02]);
  assert.deepEqual([ref(doc, s1).vertex, ref(doc, s2).edge, ref(doc, s2).at, ref(doc, s3).vertex], [0, 1, 0.25, 1]);
  const was = [...ref(doc, s1).position];
  remove(doc, ['sh']);
  refreshAttached(doc); // after every change
  assert.deepEqual(ref(doc, s1), { position: was });
  addCircle(doc, [10.02, 40], { id: 'sh' }); // a circle: no vertex to point at there
  setLink(doc, s1.id, 0, { element: 'sh', vertex: 0 });
  refreshAttached(doc);
  assert.deepEqual([ref(doc, s1), doc.links.length], [{ position: was }, 2]);
});

test('vertices added, taken away, a line split: labels on its vertices stay on the same ones; one whose vertex goes, on the nearest left', () => {
  const doc = emptyDoc(0);
  const l = lineFrom(doc, [10, 40], [[10.01, 40], [10.02, 40], [10.03, 40]], [10.04, 40], { id: 'l' });
  const on = (v) => labelOn(doc, { element: 'l', vertex: v }); // places: 0 its start
  const [a, b, c] = [on(1), on(2), on(3)];
  insertVertex(doc, 'l', 2, [10.015, 40]);
  assert.deepEqual([ref(doc, a).vertex, ref(doc, b).vertex, ref(doc, c).vertex], [1, 3, 4]);
  deleteVertex(doc, 'l', 3); // b's: to the nearest vertex left (10.015)
  assert.deepEqual([ref(doc, a).vertex, ref(doc, b).element, ref(doc, b).vertex, ref(doc, c).vertex], [1, 'l', 2, 3]);
  settleGeometry(doc);
  assert.deepEqual(ref(doc, b).position, [10.015, 40]);
  const p = splitLine(doc, 'l', 1); // a's vertex becomes a point; b's and c's go to the rest
  const rest = doc.lines.find((s) => placeIn(doc, s, 0).to?.element === p.id && s.id !== 'l');
  assert.deepEqual(ref(doc, a), { position: [10.01, 40], element: p.id });
  assert.deepEqual(l.points.length, 2);
  assert.deepEqual([ref(doc, b).element, ref(doc, b).vertex, ref(doc, c).element, ref(doc, c).vertex], [rest.id, 1, rest.id, 2]);
  assert.deepEqual(rest.points[2], [10.03, 40]);
  settleGeometry(doc);
  assert.deepEqual([ref(doc, b).position, ref(doc, c).position], [[10.015, 40], [10.03, 40]]);
});

test('a line split at a vertex keeps the vertex\'s name: the dot made takes it, else the first half\'s end', () => {
  const doc = emptyDoc(0);
  const l = lineFrom(doc, [10, 40], [[10.01, 40], [10.02, 40]], [10.03, 40], { id: 'l' });
  l.names = ['', 'Free', 'Held', ''];
  const p = addPoint(doc, [10.02, 40]);
  setLink(doc, 'l', 2, { element: p.id });
  splitLine(doc, 'l', 2);
  assert.equal(l.names.at(-1), 'Held', 'on a point already: the half keeps it');
  const dot = splitLine(doc, 'l', 1);
  assert.equal(dot.name, 'Free');
  assert.equal(l.names.at(-1), '');
});

test('an area\'s corners added and taken away, an outline changed: labels on corners and edges stay where they were', () => {
  const doc = emptyDoc(0);
  const a = addRing(doc, [[10, 40], [10.02, 40], [10.02, 40.02], [10, 40.02]], { id: 'a' });
  const c2 = labelOn(doc, { element: 'a', vertex: 2 });
  const e3 = labelOn(doc, { element: 'a', edge: 3, at: 0.5 });
  refreshAttached(doc);
  const at = [...ref(doc, e3).position];
  insertVertex(doc, 'a', 1, [10.01, 39.99]);
  assert.equal(ref(doc, c2).vertex, 3);
  assert.equal(ref(doc, e3).edge, 4);
  refreshAttached(doc);
  nearM(ref(doc, e3).position, at, 1);
  deleteVertex(doc, 'a', 3); // c2's: to the nearest one left
  refreshAttached(doc);
  assert.ok(ref(doc, c2).element === 'a' && ref(doc, c2).vertex != null);
  deleteVertex(doc, 'a', 0);
  deleteVertex(doc, 'a', 0); // three left: no more
  assert.equal(a.points.length, 3);
  const { shapes: [sh] } = addShape(doc, [11, 40]);
  const s = labelOn(doc, { element: sh.id, vertex: 1 });
  refreshAttached(doc);
  const before = [...ref(doc, s).position];
  sh.points = outlinePoints([11, 40], 0, 100, 50, 'surface-vehicle'); // its places another outline's
  sh.names = sh.points.map(() => '');
  reattach(doc, sh.id);
  refreshAttached(doc);
  assert.ok(ref(doc, s).element === sh.id && ref(doc, s).vertex != null);
  assert.ok(inverse(ref(doc, s).position, before).s < 30, 'the nearest corner of the new outline');
});

test('a closed line: any place attached, following; its closing leg a target; split, opened at that place', () => {
  const doc = emptyDoc(0);
  const p = addPoint(doc, [10, 40], { id: 'p' });
  const g = addRing(doc, [[10.01, 40], [10.02, 40], [10.02, 40.01], [10.01, 40.01]], { id: 'g', names: ['a', 'b', 'c', 'd'] });
  setLink(doc, 'g', 2, { element: 'p' }); // a place of a ring linked, as a line's
  const t = labelOn(doc, { element: 'g', edge: 3, at: 0.5 }); // on its closing leg
  refreshAttached(doc);
  assert.deepEqual(g.points[2], [10, 40]);
  nearM(ref(doc, t).position, [10.01, 40.005], 1);
  p.position = [10.03, 40.02]; // the point moves: the ring's place follows
  refreshAttached(doc);
  assert.deepEqual(g.points[2], [10.03, 40.02]);
  assert.equal(snapAt(doc, px([10.02, 40]), view).to.end, undefined); // a ring has no free ends: its places are vertices
  assert.deepEqual(snapAt(doc, px([10.02, 40]), view).to, { element: 'g', vertex: 1 });
  const at = [...ref(doc, t).position];
  assert.equal(splitLine(doc, 'g', 2), null); // nothing made: the ring opened at place 2
  assert.deepEqual([g.closed, g.points.length, g.names], [false, 5, ['c', 'd', 'a', 'b', '']]);
  assert.deepEqual([g.points[0], g.points[4]], [[10.03, 40.02], [10.03, 40.02]]); // its start and its end there
  assert.deepEqual(placeIn(doc, g, 0).to, { element: 'p' }); // the link from place 2, now its start
  assert.deepEqual([ref(doc, t).element, ref(doc, t).edge], ['g', 1]); // the old closing leg, now leg 1
  refreshAttached(doc);
  nearM(ref(doc, t).position, at, 1);
  assert.equal(doc.lines.length, 1);
});

test('a line\'s place attached where it snapped: a point; a point\'s shape\'s corner or edge; on another line\'s place or leg, a point shared there; never a guide or a circle', () => {
  const { doc, sh, a, l } = drawing();
  const at = (to, position) => attachAt(doc, { to, position });
  assert.deepEqual(at({ element: 'p' }, [10, 40]), { element: 'p' });
  assert.equal(at(null, [0, 0]), null);
  // another line's place: a dot there, that place attached to it too
  const v = at({ element: 'l', vertex: 1 }, [10.06, 40.01]), dot = doc.points.find((x) => x.id === v.element);
  assert.deepEqual([dot.symbol, dot.position, placeIn(doc, l, 1).to], ['dot', [10.06, 40.01], v]);
  assert.deepEqual(at({ element: 'l', vertex: 1 }, [10.06, 40.01]), v, 'the same place again: the same point');
  // a free end: the same
  const e = at({ end: ['l', 0] }, [10.05, 40]);
  assert.deepEqual(placeIn(doc, l, 0), { position: [10.05, 40], to: e });
  // a leg: a place put in the line there, one line still; an area stays closed
  const mid = targetPosition(doc, { element: 'a', edge: 0, at: 0.5 }), k = at({ element: 'a', edge: 0, at: 0.5 }, mid);
  assert.deepEqual([a.points.length, a.closed, a.points[1], placeIn(doc, a, 1).to], [4, true, mid, k]);
  assert.equal(doc.lines.length, 3, 'nothing split');
  // a point's shape: on its corner, or along its edge, as it is (nothing put in it)
  assert.deepEqual(at({ element: 'sh', vertex: 2 }, sh.points[2]), { element: 'sh', vertex: 2 });
  assert.deepEqual(at({ element: 'sh', edge: 1, at: 0.5, d: 1 }, [0, 0]), { element: 'sh', edge: 1, at: 0.5 });
  assert.equal(sh.points.length, 4);
  // nothing to attach to: a guide, a circle's centre, a point's shape as a whole
  addCircle(doc, [10.1, 40], { id: 'c' });
  doc.lines.find((x) => x.id === 'l').guide = true;
  for (const to of [{ element: 'l', edge: 0, at: 0.5 }, { element: 'c' }, { element: 'sh' }]) {
    assert.equal(attachable(doc, to), false, JSON.stringify(to));
    assert.equal(at(to, [10, 40]), null);
  }
});

test('a leg met twice (a line\'s two ends on one leg): the second found where the first put its place', () => {
  const doc = emptyDoc(0);
  const h = lineFrom(doc, [10, 40], [], [10.04, 40], { id: 'h' });
  const q1 = targetPosition(doc, { element: 'h', edge: 0, at: 0.25 }), q3 = targetPosition(doc, { element: 'h', edge: 0, at: 0.75 });
  const a = attachAt(doc, { to: { element: 'h', edge: 0, at: 0.25 }, position: q1 });
  const b = attachAt(doc, { to: { element: 'h', edge: 0, at: 0.75 }, position: q3 }); // its leg is leg 1 now
  assert.deepEqual(h.points, [[10, 40], q1, q3, [10.04, 40]]);
  assert.deepEqual([placeIn(doc, h, 1).to, placeIn(doc, h, 2).to], [a, b]);
});

test('the file keeps the links: a line\'s places on points and on points\' shapes, a label\'s on any target; a line\'s place on anything else, or a shape\'s place, is dropped', () => {
  const { doc, l, a } = drawing();
  lineFrom(doc, 'p', [[10.03, 40.03]], 'p', { id: 'y' }); // a middle place too
  setLink(doc, 'y', 1, { element: 'p' });
  lineFrom(doc, { element: 'sh', vertex: 3, position: [0, 0] }, [], { element: 'sh', edge: 1, at: 0.25, position: [0, 0] }, { id: 'z' }); // on a point's shape
  const t1 = labelOn(doc, { element: 'a', edge: 2, at: 0.3 }), t2 = labelOn(doc, { element: 'l', vertex: 1 }), t3 = labelOn(doc, { element: 'a' });
  settleGeometry(doc);
  const text = serialise(doc), back = parse(text);
  assert.deepEqual(back.report.warnings, []);
  const bare = (ls) => ls.map(({ frame, ...x }) => x), frameOf = (ls) => ls.map((x) => x.frame?.places.flat() ?? []); // a frame comes back as the file rounds it
  assert.deepEqual([bare(back.doc.lines), back.doc.labels, back.doc.links], [bare(doc.lines), doc.labels, doc.links]);
  frameOf(back.doc.lines).forEach((f, i) => f.forEach((v, k) => near(v, frameOf(doc.lines)[i][k], 1e-3, '')));
  const raw = JSON.parse(text), linked = (id, i) => raw.earthplotter.links.find((k) => k.from[0] === id && k.from[1] === i)?.to;
  assert.deepEqual([linked('y', 0), linked('y', 1), linked('z', 0), linked('z', 1), linked(t1.id, 0), linked(t2.id, 0), linked(t3.id, 0)],
    [{ element: 'p' }, { element: 'p' }, { element: 'sh', vertex: 3 }, { element: 'sh', edge: 1, at: 0.25 }, { element: 'a', edge: 2, at: 0.3 }, { element: 'l', vertex: 1 }, { element: 'a' }]);
  assert.ok(raw.features.every((f) => !['start', 'end', 'anchor'].some((k) => k in f.properties.earthplotter)), 'links only in the table');
  raw.earthplotter.links.push({ from: ['l', 0], to: { element: 'a', vertex: 1 } }, { from: ['l', 2], to: 'a' }, { from: ['sh', 0], to: 'p' });
  const r = parse(JSON.stringify(raw));
  assert.deepEqual([placeIn(r.doc, l, 0).to, placeIn(r.doc, l, -1).to], [null, null]);
  assert.equal(r.report.warnings.filter((w) => /line's place to a, which is neither a point nor a point's shape: dropped/.test(w)).length, 2);
  assert.ok(r.report.warnings.some((w) => /link from sh 0, which is not a line's or a label's place here/.test(w)), 'a shape\'s place: never tied');
  assert.equal(a.points.length, 3);
});

test('snapping: a vertex before a crossing before an edge; within the radius; never what is excluded', () => {
  const doc = emptyDoc(0);
  addPoint(doc, [10, 40], { id: 'p' });
  lineFrom(doc, [10.01, 40.01], [], [10.03, 40.01], { id: 'h' });
  lineFrom(doc, [10.02, 40], [], [10.02, 40.02], { id: 'v' });
  const at = (q) => snapAt(doc, px(q), view);
  const v = at([10.0003, 40.0003]);
  assert.deepEqual([v.kind, v.to, v.position], ['vertex', { element: 'p' }, [10, 40]]);
  const x = at([10.0201, 40.0102]);
  assert.equal(x.kind, 'crossing');
  nearM(x.position, [10.02, 40.01], 0.5);
  assert.equal(x.to, null);
  const e = at([10.025, 40.0105]);
  assert.equal(e.kind, 'edge');
  assert.deepEqual([e.to.element, e.to.edge], ['h', 0]);
  near(e.to.at, 0.75, 0.01, '');
  nearM(targetPosition(doc, e.to), e.position, 0.5);
  nearM(e.position, [10.025, 40.01], 2);
  assert.equal(at([10.03, 40.03]), null);
  assert.equal(snapAt(doc, px([10.0003, 40.0003]), view, { exclude: new Set(['p']) }), null);
  // ids: the elements whose edges are looked at (the map's hits); vertices are looked at in all
  assert.equal(snapAt(doc, px([10.0201, 40.005]), view, { ids: new Set(['h']) }), null);
  assert.equal(snapAt(doc, px([10.0201, 40.005]), view, { ids: new Set(['v']) }).to.element, 'v');
  assert.equal(snapAt(doc, px([10.0003, 40.0003]), view, { ids: new Set() }).kind, 'vertex');
  const end = at([10.0301, 40.0101]); // a line's free end
  assert.deepEqual(end.to, { end: ['h', 1] });
});

test('snapping to corners and edges of shapes and areas, to a line\'s vertices, to a circle\'s centre (a point\'s first)', () => {
  const { doc, sh } = drawing();
  const s = snapAt(doc, px(sh.points[3]), view);
  assert.deepEqual([s.kind, s.to], ['vertex', { element: 'sh', vertex: 3 }]); // a shape's corner: a line's place
  assert.deepEqual(snapAt(doc, px([10.0201, 40.0001]), view).to, { element: doc.points[1].id }); // its point at its centre
  addCircle(doc, [10.1, 40], { id: 'c' });
  assert.deepEqual(snapAt(doc, px([10.1001, 40]), view).to, { element: 'c' });
  const mid = [10.01, 40.0201];
  const e = snapAt(doc, px(mid), view);
  assert.deepEqual([e.kind, e.to.element, e.to.edge], ['edge', 'a', 0]);
  near(e.to.at, 0.5, 0.01, '');
  const v = snapAt(doc, px([10.0601, 40.0101]), view);
  assert.deepEqual(v.to, { element: 'l', vertex: 1 }); // its place 1 (0 its start)
  doc.lines.find((x) => x.id === 'l').visible = false;
  assert.equal(snapAt(doc, px([10.0601, 40.0101]), view), null, 'a hidden line is not snapped to');
});

test('a line on a point\'s shape: on its corner or along its edge, following it as its point moves and turns; kept in the file; at its real corner whatever its Scale', () => {
  const doc = emptyDoc(0);
  const { point: p, shapes: [sh] } = addShape(doc, [10.02, 40], 'rectangle', 2000);
  sh.id = 'sh';
  const hit = snapAt(doc, px(sh.points[1]), view);
  assert.deepEqual(hit.to, { element: 'sh', vertex: 1 });
  const corner = lineFrom(doc, [10, 39.9], [], { ...attachAt(doc, hit), position: hit.position });
  const side = lineFrom(doc, [10.04, 39.9], [], { element: 'sh', edge: 2, at: 0.5, position: [0, 0] });
  refreshAttached(doc);
  nearM(ref(doc, corner).position, sh.points[1]);
  const q = refNear(doc, { kind: 'line', el: sh }, targetPosition(doc, { element: 'sh', edge: 1, at: 0.3 }));
  assert.deepEqual([q.edge, +q.at.toFixed(3)], [1, 0.3]);
  carry(doc, p, destination(p.position, 90, 500), 45); // the point moved and turned: its shape with it, the lines' ends on it
  settleGeometry(doc);
  nearM(ref(doc, corner).position, sh.points[1]);
  nearM(ref(doc, side).position, targetPosition(doc, { element: 'sh', edge: 2, at: 0.5 }));
  sh.look.scale = 3; // drawn larger: the line still on its real corner
  settleGeometry(doc);
  nearM(ref(doc, corner).position, sh.points[1]);
  const read = parse(serialise(doc), null, 0).doc, back = ref(read, read.lines.find((x) => x.id === corner.id));
  assert.deepEqual([back.element, back.vertex], ['sh', 1]);
  nearM(back.position, ref(doc, corner).position);
});

test('a point\'s shape scaled (display only): snapped and boxed where it is drawn, not at its real places', () => {
  const doc = emptyDoc(0), c = [10.02, 40];
  const { shapes: [sh] } = addShape(doc, c, 'rectangle', 2000);
  sh.look.scale = 2;
  const g = inverse(c, sh.points[0]), drawn = destination(c, g.azi, g.s * 2);
  const hit = snapAt(doc, px(drawn), view);
  assert.deepEqual([hit.kind, hit.to], ['vertex', { element: sh.id, vertex: 0 }]);
  nearM(hit.position, drawn, 0.01);
  assert.notEqual(snapAt(doc, px(sh.points[0]), view)?.kind, 'vertex', 'not at its real corner');
});

test('Shift: 15° steps from north, or from the leg before; the length kept', () => {
  const from = [10, 40];
  const q = stepped(from, [10.01, 40.012]); // about 33° from north
  near(inverse(from, q).azi, 30, 1e-6, '');
  near(inverse(from, q).s, inverse(from, [10.01, 40.012]).s, 1e-6, '');
  const r = stepped(from, [10.012, 40.002], [9.99, 39.99]); // the leg before heads about 37°
  const base = inverse([9.99, 39.99], from).azi, d = inverse(from, r).azi - base;
  near(d / 15, Math.round(d / 15), 1e-6, '');
  assert.deepEqual(stepped(from, from), from);
  assert.deepEqual(neighbours([[0, 0], [1, 1], [2, 2]], 2), { from: [1, 1], prev: [0, 0] });
  assert.deepEqual(neighbours([[0, 0], [1, 1], [2, 2]], 0), { from: [1, 1], prev: [2, 2] });
});

test('a point moved: places attached to it follow, an end or a middle one; a label on a line\'s place follows that place, in one pass', () => {
  const doc = emptyDoc(0);
  const p = addDot(doc, [10, 40]), q = addDot(doc, [10.02, 40.02]);
  const l = lineFrom(doc, p.id, [[10.01, 40.01]], [10.02, 40], { id: 'l' });
  setLink(doc, 'l', 1, { element: q.id });
  const t = labelOn(doc, { element: 'l', vertex: 1 });
  doc.links.unshift(doc.links.pop()); // the label's link listed first
  p.position = [10, 40.005];
  q.position = [10.03, 40.025];
  settleGeometry(doc);
  assert.deepEqual([placeIn(doc, l, 0).position, placeIn(doc, l, 1).position, placeIn(doc, l, 2)], [[10, 40.005], [10.03, 40.025], { position: [10.02, 40], to: null }]);
  assert.deepEqual(t.position, [10.03, 40.025]);
});

test('an end snapped onto another line\'s leg: a point shared there, a place put in that line; both follow the point', () => {
  const doc = emptyDoc(0);
  const h = lineFrom(doc, [10, 40], [[10.02, 40]], [10.04, 40], { id: 'h' });
  const hit = snapAt(doc, px([10.03, 40.0001]), view);
  assert.deepEqual([hit.kind, hit.to.element, hit.to.edge], ['edge', 'h', 1]);
  const to = attachAt(doc, hit), m = lineFrom(doc, [10.03, 40.02], [], { ...to, position: hit.position });
  assert.equal(h.points.length, 4, 'a place put in it');
  assert.deepEqual([placeIn(doc, h, 2).to, placeIn(doc, m, -1).to], [to, to]);
  nearM(h.points[2], [10.03, 40], 1);
  const dot = doc.points.find((x) => x.id === to.element);
  dot.position = [10.03, 40.01]; // the point moved: both lines with it
  settleGeometry(doc);
  assert.deepEqual([h.points[2], m.points[1]], [[10.03, 40.01], [10.03, 40.01]]);
});

test('the model kept in one place: a shape given to a point drops its own attachments; a line on a shape detached comes free; a guide is no target', async () => {
  const { setGroup, canHold } = await import('../../site/draw/document.js');
  const doc = emptyDoc(0);
  const a = addPoint(doc, [10, 40], { id: 'A' }), b = addPoint(doc, [10.02, 40.02], { id: 'B' });
  const poly = addRing(doc, [[10.01, 40], [10.02, 40], [10.02, 40.01]], { id: 'poly' });
  setLink(doc, 'poly', 1, { element: 'B' }); // an area's corner on B (an attachment its own)
  settleGeometry(doc);
  assert.deepEqual(poly.points[1], b.position);
  setGroup(doc, 'poly', 'A'); // given to A: rigid now, its corner free
  settleGeometry(doc);
  assert.equal(placeIn(doc, poly, 1).to, null, 'its own attachment dropped');
  const frame = structuredClone(poly.frame);
  carry(doc, a, [10.05, 40.05], 30);
  settleGeometry(doc);
  assert.deepEqual(poly.frame, frame, 'moved as one piece, not torn');
  // a line on its corner; the shape detached: an area now, the line's end free where it was
  const l = lineFrom(doc, [9.9, 39.9], [], { element: 'poly', vertex: 0, position: [0, 0] });
  settleGeometry(doc);
  assert.deepEqual(placeIn(doc, l, -1).to, { element: 'poly', vertex: 0 });
  setGroup(doc, 'poly', null);
  settleGeometry(doc);
  assert.equal(placeIn(doc, l, -1).to, null);
  // a guide: no target for a line
  b.guide = true;
  assert.equal(attachable(doc, { element: 'B' }), false);
  setLink(doc, l.id, 0, { element: 'B' });
  settleGeometry(doc);
  assert.equal(placeIn(doc, l, 0).to, null);
  // a point holds circles and closed lines only
  assert.equal(canHold(doc, 'A', l.id), false, 'an open line');
  assert.equal(canHold(doc, 'A', 'poly'), true);
});

test('an end snapped onto a vertex that is on a shape\'s corner: on that corner too (not dropped)', () => {
  const doc = emptyDoc(0);
  const { shapes: [sh] } = addShape(doc, [10.02, 40], 'rectangle', 2000);
  const l = lineFrom(doc, [10, 39.9], [], { element: sh.id, vertex: 2, position: [0, 0] });
  settleGeometry(doc);
  const to = attachAt(doc, { to: { end: [l.id, 1] }, position: l.points[1] });
  assert.deepEqual(to, { element: sh.id, vertex: 2 });
  const m = lineFrom(doc, [10.1, 39.9], [], { ...to, position: l.points[1] });
  settleGeometry(doc);
  assert.deepEqual(placeIn(doc, m, -1).to, { element: sh.id, vertex: 2 }, 'kept after a change');
});
