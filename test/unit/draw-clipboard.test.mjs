import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineFrom, placeIn, addRing, addShape, near } from './helpers.mjs';

const { emptyDoc, addPoint, addLabel, addCircle, addLine, makeGroup } = await import('../../site/draw/document.js');
const { outlinePoints } = await import('../../site/draw/outlines.js');
const { clipOf, paste, centreOf } = await import('../../site/draw/clipboard.js');
const { refreshAttached } = await import('../../site/draw/attach.js');
const { loadPresets, savePresets, presetOf, presetsFile, readPresets } = await import('../../site/draw/presets.js');
const { boundsOf } = await import('../../site/draw/features.js');
const { inverse, moveAbout } = await import('../../site/geodesy.js');

const shift = (q) => [q[0] + 1, q[1]];

test('a copy pasted: new IDs and numbered names, moved, its group kept; attachments between the copied kept, others freed', () => {
  const doc = emptyDoc(0);
  addPoint(doc, [10, 40], { id: 'a', name: 'Point 1' });
  const b = addPoint(doc, [10.1, 40], { id: 'b', name: 'Mark' });
  const g = makeGroup(doc, ['a']);
  lineFrom(doc, 'a', [[10.05, 40.05]], 'b', { id: 'l', name: 'Line 1' });
  const lab = addLabel(doc, [10.1, 40], { element: 'b' });
  const clip = clipOf(doc, [g.id, 'l', lab.id]); // the group: its member
  assert.deepEqual(clip.items.map((x) => x.el.id), ['a', 'l', lab.id]);
  assert.deepEqual(centreOf(clip), [10.05, 40.025]);
  const made = paste(doc, clip, shift);
  const [a2, l2, lab2] = made.map((x) => x.el);
  assert.ok(![a2.id, l2.id, lab2.id].some((id) => ['a', 'l', lab.id].includes(id)));
  assert.deepEqual([a2.name, l2.name], ['Point 2', 'Line 2']);
  assert.deepEqual(a2.position, [11, 40]);
  assert.equal(a2.groupId, g.id);
  assert.deepEqual(placeIn(doc, l2, 0), { position: [11, 40], to: { element: a2.id } }); // linked to the copy
  assert.deepEqual(placeIn(doc, l2, -1), { position: [11.1, 40], to: null }); // b was not copied: free
  assert.deepEqual(l2.points[1], [11.05, 40.05]);
  assert.equal(placeIn(doc, lab2).to.element, 'b'); // b is in the drawing: still pointing at it
  refreshAttached(doc);
  assert.deepEqual(placeIn(doc, lab2), { position: [10.1, 40], to: { element: 'b' } }); // where b is
  assert.equal(b.name, 'Mark');
  // into another drawing: the group and what was left behind are not there
  const other = emptyDoc(0);
  const [a3, , lab3] = paste(other, clip, shift).map((x) => x.el);
  assert.deepEqual([a3.groupId, a3.name], [null, 'Point 1']);
  assert.deepEqual(placeIn(other, lab3), { position: [11.1, 40], to: null }); // free, where it pointed (moved with the copy)
  assert.deepEqual(other.links, [{ from: [other.lines[0].id, 0], to: { element: a3.id } }]); // only the one between the copied
  const twice = paste(doc, clipOf(doc, ['b']), shift)[0].el;
  assert.equal(twice.name, 'Mark 2');
});

test('a point copied with its shapes: they are its copy\'s; a shape copied alone is free', () => {
  const doc = emptyDoc(0), g = makeGroup(doc, []);
  const p = addPoint(doc, [10, 40], { groupId: g.id });
  const c = addCircle(doc, [10, 40], { groupId: p.id, aperture: 45 }), r = addLine(doc, outlinePoints([10, 40], 0, 100, 50), { groupId: p.id, closed: true });
  const clip = clipOf(doc, [p.id]);
  assert.deepEqual(clip.items.map((x) => x.el.id), [p.id, c.id, r.id]); // a point: with its shapes
  const [p2, c2, r2] = paste(doc, clip, shift).map((x) => x.el);
  assert.deepEqual([p2.groupId, c2.groupId, r2.groupId, c2.aperture, c2.position, r2.points[0]], [g.id, p2.id, p2.id, 45, [11, 40], shift(r.points[0])]);
  assert.notEqual(c2.id, c.id);
  const [c3] = paste(doc, clipOf(doc, [c.id]), shift).map((x) => x.el);
  assert.equal(c3.groupId, null); // its point not copied: free
});

test('presets: a point and its shapes kept under a name, as they are; stored; a file of them read back, what is not one left out', () => {
  const doc = emptyDoc(0);
  const p = addPoint(doc, [10, 40], { bearing: 30, look: { stroke: { color: '#1f5f86' } } });
  addCircle(doc, [10, 40], { groupId: p.id, radius: 2000, aperture: 45, name: 'wide', look: { fill: { opacity: 0 } } });
  addLine(doc, outlinePoints([10, 40], 30, 80, 100, 'triangle'), { groupId: p.id, closed: true });
  addPoint(doc, [11, 40]); // not its
  const pre = presetOf(doc, p.id, 'Mine');
  assert.deepEqual([pre.name, pre.doc.points.length, pre.doc.circles.length, pre.doc.lines.length], ['Mine', 1, 1, 1]);
  assert.deepEqual([pre.doc.points[0].look, pre.doc.points[0].bearing, pre.doc.circles[0].look, pre.doc.circles[0].groupId], [p.look, 30, { fill: { opacity: 0 } }, pre.doc.points[0].id]);
  assert.notEqual(pre.doc.circles[0], doc.circles[0], 'a copy');
  const kept = JSON.parse(presetsFile([pre])).presets[0];
  const back = readPresets(JSON.stringify({ format: 'earthplotter-presets', presets: [kept, { name: '' }, { name: 'x' }, { name: 'none', drawing: { type: 'FeatureCollection', features: [] } }, kept] }));
  assert.deepEqual(back.map((x) => x.name), ['Mine']); // each name once, and holding a point
  assert.deepEqual([back[0].doc.circles[0].aperture, back[0].doc.lines[0].points.length, back[0].doc.circles[0].groupId], [45, 3, back[0].doc.points[0].id]);
  // read as a file is: what is not valid left out
  const odd = readPresets(JSON.stringify({ format: 'earthplotter-presets', presets: [{ name: 'Odd', drawing: { type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { earthplotter: { kind: 'point', symbol: 'star' } } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { earthplotter: { kind: 'circle', radius: -5 } } }] } }] }));
  assert.deepEqual([odd[0].doc.points[0].symbol, odd[0].doc.circles], ['none', []]);
  assert.equal(readPresets('{"format":"earthplotter-drawing"}'), null);
  assert.equal(readPresets('nope'), null);
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.deepEqual(loadPresets(), []);
  savePresets([pre]);
  assert.deepEqual(loadPresets().map((x) => [x.name, x.doc.circles.length]), [['Mine', 1]]);
  delete globalThis.localStorage;
});

test('a large import: Zoom to, Duplicate and Paste take hundreds of thousands of positions', () => {
  const doc = emptyDoc(0);
  const pts = Array.from({ length: 300000 }, (_, i) => [10 + (i % 1000) / 1000, 40 + i / 1e6]);
  const g = addRing(doc, pts);
  assert.deepEqual(boundsOf(doc, new Set([g.id])).map((v) => +v.toFixed(4)), [10, 40, 10.999, 40.3]); // its closing leg's geodesic a little north of its ends
  assert.deepEqual(centreOf(clipOf(doc, [g.id])).map((v) => +v.toFixed(7)), [10.4995, 40.1499995]);
});

// the clipboard pasted into doc with its middle moved to `to`, as the drawing's Paste moves it (along
// the ellipsoid: geodesy.js moveAbout): what is made
const pasteAt = (doc, clip, to) => paste(doc, clip, moveAbout(centreOf(clip), to));

test('pasted along the ellipsoid: a 100 m rectangle from the equator to 60°N is still 100 m', () => {
  const doc = emptyDoc(0), r = addRing(doc, outlinePoints([12, 0], 0, 100, 100));
  const [{ el }] = pasteAt(doc, clipOf(doc, [r.id]), [12, 60]), q = el.points;
  for (let i = 0; i < 4; i++) near(inverse(q[i], q[(i + 1) % 4]).s, 100, 1e-3, `side ${i}`);
  near(centreOf(clipOf(doc, [el.id]))[1], 60, 1e-6, 'its middle there');
});

test('pasted, a point and its shapes: the copy of the point holds the copies of its shapes', () => {
  const doc = emptyDoc(0), { point } = addShape(doc, [12, 40], 'rings'), q = addPoint(doc, [12.1, 40]);
  const made = pasteAt(doc, clipOf(doc, [point.id, q.id]), [13, 40]);
  const pts = made.filter((x) => x.kind === 'point'), circles = made.filter((x) => x.kind === 'circle');
  assert.deepEqual([doc.circles.length, pts.length, circles.length], [6, 2, 3]);
  assert.ok(circles.every((c) => c.el.groupId === pts[0].el.id && c.el.groupId !== point.id), 'held by the new point, not the old');
});

test('the Library\'s folders and order', async () => {
  const { folderOf, byName } = await import('../../site/draw/presets.js');
  assert.deepEqual(['Kit / A-10', 'A / B / C', 'Loose', 'EO/IR / X'].map(folderOf), ['Kit', 'A / B', '', 'EO/IR']);
  assert.deepEqual(['x 100 kHz', 'x 70 kHz', 'X 400 kHz'].sort(byName), ['x 70 kHz', 'x 100 kHz', 'X 400 kHz']);
});

test('a line, an area or a label as a preset: kept alone, its look and properties given to one drawn with it', async () => {
  const { presetKind, hasShapes } = await import('../../site/draw/presets.js');
  const { styleLike } = await import('../../site/draw/place.js');
  const doc = emptyDoc(0), p = addPoint(doc, [5, 50]);
  addCircle(doc, [5, 50], { groupId: p.id, radius: 10 });
  const l = addLine(doc, [[5, 50], [5.1, 50]], { name: 'Route', guide: true, look: { stroke: { color: '#e03131', dash: 'dashed' } }, properties: [{ key: 'kind', value: 'b' }] });
  const a = addLine(doc, [[5, 50], [5.1, 50], [5.1, 50.1]], { closed: true, name: 'Zone' });
  const t = addLabel(doc, [5, 50]); t.text = 'Here'; t.look = { text: { color: '#2b8a3e' } };
  const [pp, lp, ap, tp] = [[p.id, 'P'], [l.id, 'Kit / Route'], [a.id, 'Z'], [t.id, 'T']].map(([id, n]) => presetOf(doc, id, n));
  assert.deepEqual([pp, lp, ap, tp].map(presetKind), ['point', 'line', 'area', 'label']);
  assert.deepEqual([pp, lp, ap, tp].map(hasShapes), [true, false, false, false], 'Distribute along repeats a point holding shapes, only');
  assert.deepEqual([lp.doc.lines.length, lp.doc.lines[0].name, lp.doc.points.length], [1, 'Route', 0], 'the line alone, its name kept');
  const back = readPresets(presetsFile([pp, lp, ap, tp]));
  assert.deepEqual(back.map((x) => x.name), ['P', 'Kit / Route', 'Z', 'T'], 'every kind read back from its file');
  const d = emptyDoc(0), m = addLine(d, [[1, 1], [2, 2]]), n = addLabel(d, [1, 1]);
  styleLike(d, m, 'line', lp); styleLike(d, n, 'label', tp);
  assert.deepEqual([m.name, m.guide, m.look.stroke, m.properties], ['Route 1', true, { color: '#e03131', dash: 'dashed' }, [{ key: 'kind', value: 'b' }, { key: 'preset', value: 'Kit / Route' }]]);
  assert.deepEqual([n.text, n.look.text.color], ['Here', '#2b8a3e']);
});
