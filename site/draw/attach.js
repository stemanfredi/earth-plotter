// Links (docs/drawing-ui.md §2.2): a line's vertex, or a label's anchor, attached to something, following it. The
// drawing's links are [{ from: [id, index], to }]. A line's vertex is attached to a point ({ element }: its
// position) or to a point's shape (a corner, a spot along an edge); where it meets another line, a
// point is shared: a vertex of both (attachAt). A label points at any target: to, a target, is { element, vertex? | edge and at? }: element alone, its centre (a
// point's position, a circle's centre, a closed line's centroid, an open line's middle); vertex k, a
// line's vertex k; edge k and at, its leg k (a closed line's last: back to its first), at (0–1) along
// it. Every vertex and anchor keeps its position: refreshAttached moves the linked ones where their targets are,
// after each change; a link whose vertex or target is gone goes, the vertex free where it was. Pure:
// no map, no DOM.

import { inverse, destination } from '../geodesy.js';
import { mercator, samePosition } from '../geo.js';
import { find, addDot, centroid, positionsIn, targetOf, setLink, linkFrom, takenIds, newId, nextName, fewestPlaces, holderOf } from './document.js';
import { lineTrace, pointsAlong, nearestAlong } from './lines.js';

// the position f (0–1) along the geodesic a → b
export const along = (a, b, f) => { const d = inverse(a, b); return destination(a, d.azi, d.s * f); };

// Where a target is, and what about it: { position, element ({ kind, el }), length (of its line),
// along (from its line's start, on a line), edge ({ length, bearing } of the side or leg it is on) },
// or null when what it names is gone.
export function resolve(doc, ref) {
  const x = find(doc, ref.element);
  if (!x || x.kind === 'group' || x.kind === 'label') return null;
  if (x.kind !== 'line') return ref.vertex == null && ref.edge == null ? { position: x.el.position, element: x } : null; // a point, a circle: its centre
  const tr = lineTrace(doc, x.el), line = { length: tr.length }, vs = x.el.points;
  const at = (d) => ({ ...line, along: d, position: pointsAlong(tr.coords, [d])[0].position });
  if (ref.vertex == null && ref.edge == null) return x.el.closed ? { ...line, position: centroid(vs), element: x } : { ...at(tr.length / 2), element: x };
  if (ref.vertex != null) return ref.vertex < vs.length ? { position: vs[ref.vertex], element: x, ...line, along: tr.at[ref.vertex] } : null;
  if (ref.edge >= tr.legs.length) return null;
  const edge = { length: tr.legs[ref.edge], bearing: inverse(vs[ref.edge], vs[(ref.edge + 1) % vs.length]).azi };
  return { ...at(tr.at[ref.edge] + (ref.at ?? 0) * tr.legs[ref.edge]), element: x, edge };
}
export const targetPosition = (doc, ref) => resolve(doc, ref)?.position ?? null;
// the [object, key] of the vertex or anchor [id, index] (positionsIn), or null when it is not there
const slotOf = (doc, [id, index]) => { const x = find(doc, id); return (x && positionsIn(x.kind, x.el)[index]) ?? null; };
// where the vertex or anchor [id, index] is, or null
export const placeAt = (doc, from) => { const s = slotOf(doc, from); return s ? s[0][s[1]] : null; };

// Each linked vertex or anchor where its target is now; a link whose vertex or target is gone, or that the model
// no longer allows (a line's vertex held by a point now, or on what has become an area, a guide),
// goes: the vertex free where it was. Whatever made it so (Attach to…, Detach, a paste), this is the
// one place the rule is kept. The lines' vertices first (on points, which follow nothing), then the labels
// (which may point at those vertices): one pass.
export function refreshAttached(doc) {
  const labels = new Set(doc.labels.map((a) => a.id));
  for (const l of [...doc.links].sort((a, b) => labels.has(a.from[0]) - labels.has(b.from[0]))) {
    const s = slotOf(doc, l.from), p = s && allowed(doc, l) && targetPosition(doc, l.to);
    if (!p) { doc.links.splice(doc.links.indexOf(l), 1); continue; }
    const [o, k] = s;
    if (o[k][0] !== p[0] || o[k][1] !== p[1]) o[k] = [...p];
  }
}

// the vertex of vs nearest to p (in the projection)
function nearestVertex(vs, p) {
  const P = mercator(p);
  let k = 0, best = Infinity;
  vs.forEach((c, i) => { const C = mercator(c), d = Math.hypot(C[0] - P[0], C[1] - P[1]); if (d < best) { best = d; k = i; } });
  return { vertex: k, d: best };
}
// A target on element x at p, with its position and its distance d from p: on a line's leg nearest p
// (along its legs as drawn, curves included), or (vertex) on its vertex nearest p. null: x is no line.
export function refNear(doc, x, p, vertex = false) {
  if (x.kind !== 'line') return null;
  const vs = x.el.points;
  if (vertex) { const v = nearestVertex(vs, p); return { position: [...vs[v.vertex]], element: x.el.id, vertex: v.vertex, d: v.d }; }
  const r = lineRef(doc, x.el, nearestAlong(lineTrace(doc, x.el).coords, p)), P = mercator(p), Q = mercator(r.position);
  return { ...r, d: Math.hypot(Q[0] - P[0], Q[1] - P[1]) };
}
// the target d metres along a line from its start (with its position): on the leg there
export function lineRef(doc, line, d) {
  const tr = lineTrace(doc, line), dd = Math.max(0, Math.min(tr.length, d));
  let k = tr.legs.length - 1;
  while (k > 0 && tr.at[k] > dd) k--;
  const at = tr.legs[k] ? (dd - tr.at[k]) / tr.legs[k] : 0;
  return { position: pointsAlong(tr.coords, [dd])[0].position, element: line.id, edge: k, at: +Math.min(1, Math.max(0, at)).toFixed(6) };
}

// The links to the vertices and edges of element id placed again where their places are: after its
// vertices changed in number (one added or removed, closed or opened), each goes to the nearest vertex,
// or the nearest spot along an edge. One with nothing left to point at goes.
export function reattach(doc, id) {
  const x = find(doc, id);
  doc.links = doc.links.flatMap((l) => {
    if (l.to.element !== id || (l.to.vertex == null && l.to.edge == null)) return [l];
    const p = placeAt(doc, l.from), n = x && p && refNear(doc, x, p, l.to.vertex != null);
    return n ? [{ from: l.from, to: targetOf(n) }] : [];
  });
}
// A vertex added to a line at index (before the one there), one taken away (while it keeps its fewest
// vertices): the links from its vertices numbered again (the one from a vertex taken away goes),
// those to its vertices and edges where they were (reattach).
export function insertVertex(doc, id, index, position) {
  const el = find(doc, id).el;
  el.points.splice(index, 0, [...position]);
  el.names.splice(index, 0, '');
  renumber(doc, id, index, 1);
}
export function deleteVertex(doc, id, index) {
  const el = find(doc, id).el;
  if (el.points.length <= fewestPlaces(el)) return;
  el.points.splice(index, 1);
  el.names.splice(index, 1);
  renumber(doc, id, index, -1);
}
function renumber(doc, id, index, n) {
  doc.links = doc.links.filter((l) => n > 0 || l.from[0] !== id || l.from[1] !== index);
  for (const l of doc.links) if (l.from[0] === id && l.from[1] >= index) l.from = [id, l.from[1] + n];
  reattach(doc, id);
}
// Split a line at its vertex index (not an end): what the vertex is on (a point, a shape's corner),
// else a point made there (a dot, named as the vertex); the line ending there and a new one carrying
// on from it with the rest, both attached to it. The links from the rest's vertices go with it; those
// to its vertices and edges, to what is there when on that vertex, else to the half where they now
// are. Returns what both are attached to. A closed line is opened there instead: one line from that
// vertex round to it again (its start and its end there, both attached where the vertex was), nothing
// made; the links numbered from its new start.
export function splitLine(doc, lineId, index) {
  const s = find(doc, lineId).el, n = s.points.length;
  if (s.closed) {
    s.points = [...s.points.slice(index), ...s.points.slice(0, index + 1)].map((q) => [...q]);
    s.names = [...s.names.slice(index), ...s.names.slice(0, index), ''];
    s.closed = false;
    doc.links = doc.links.map((l) => (l.from[0] === lineId ? { ...l, from: [lineId, (l.from[1] - index + n) % n] } : l)); // a new list: linkFrom's index made again
    const on = linkFrom(doc, lineId, 0)?.to;
    if (on) setLink(doc, lineId, n, targetOf(on)); // its end where its start is: on what the vertex was on
    reattach(doc, lineId);
    return null;
  }
  // what the vertex is on already (a point, a shape's corner), else a dot made there: both halves on it
  const taken = takenIds(doc), on = linkFrom(doc, lineId, index)?.to, at = on ? targetOf(on) : { element: addDot(doc, s.points[index], s.names[index], taken).id };
  const rest = { ...structuredClone(s), id: newId(doc, taken), name: nextName(doc, 'line'), points: s.points.slice(index), names: ['', ...s.names.slice(index + 1)] };
  s.points = s.points.slice(0, index + 1);
  s.names = [...s.names.slice(0, index), on ? s.names[index] : '']; // the vertex's name: the dot made takes it, else the first half's end keeps it
  doc.lines.splice(doc.lines.indexOf(s) + 1, 0, rest);
  setLink(doc, lineId, index, at);
  doc.links = doc.links.map((l) => (l.from[0] === lineId && l.from[1] > index ? { ...l, from: [rest.id, l.from[1] - index] } : l)); // a new list, as above
  setLink(doc, rest.id, 0, at);
  const halves = [s, rest].map((el) => ({ kind: 'line', el }));
  for (const l of doc.links) {
    const t = l.to;
    if (t.element !== lineId || (t.vertex == null && t.edge == null)) continue;
    if (t.vertex === index) { l.to = at; continue; }
    const q = placeAt(doc, l.from);
    l.to = targetOf(halves.map((x) => refNear(doc, x, q, t.vertex != null)).reduce((a, b) => (b.d < a.d ? b : a)));
  }
  return find(doc, at.element)?.el ?? null;
}

// where on a line it is attached, as its table numbers it: its point or leg
export const partName = (r) => (r.vertex != null ? `vertex ${r.vertex + 1}` : r.edge != null ? `leg ${r.edge + 1}` : '');

// Whether a line's vertex snapped onto `to` (a snap target, snap.js) can be attached there: a point; a
// corner of a point's shape or a spot along its edge (it goes with its point: nothing else moves
// it); or another line's vertex or leg (a point is shared there). Not a guide, nor a circle's centre.
export function attachable(doc, to) {
  const x = to && find(doc, to.end ? to.end[0] : to.element);
  return !!x && !x.el.guide && (x.kind === 'point' || (x.kind === 'line' && (!holderOf(doc, x.el) || to.vertex != null || to.edge != null)));
}
// whether a line's vertex may be linked to `to` (a target): a point's position, or a corner or an edge
// of a point's shape; never a guide
export const lineTarget = (doc, to) => {
  const x = to && find(doc, to.element);
  return !!x && !x.el.guide && (to.vertex == null && to.edge == null ? x.kind === 'point' : x.kind === 'line' && !!holderOf(doc, x.el));
};
// whether the model allows link l: a label's, any; a line's vertex, only of a line no point holds, and
// only to a point or a point's shape (lineTarget)
function allowed(doc, l) {
  const x = find(doc, l.from[0]);
  return x?.kind !== 'line' || (!holderOf(doc, x.el) && lineTarget(doc, l.to));
}
// What a line's vertex snapped at r ({ position, to }: snap.js) is attached to: a point ({ element }), a
// point's shape's corner or a spot along its edge (that target, at its real vertices whatever its
// Scale), or null (free where it snapped). On another line's vertex, a dot made there and that vertex
// attached to it too (or the point it is attached to already); on its leg, a vertex put in it there first (the
// line through the dot: one line still, an area still closed). doc is changed.
export function attachAt(doc, r) {
  if (!attachable(doc, r?.to)) return null;
  const x = find(doc, r.to.end ? r.to.end[0] : r.to.element);
  if (x.kind === 'point') return { element: x.el.id };
  if (holderOf(doc, x.el)) return targetOf(r.to); // a point's shape: on it, following it
  const line = x.el;
  let k = line.points.findIndex((q) => samePosition(q, r.position)); // found by position: an earlier attachment may have numbered the vertices again
  if (k < 0) { k = refNear(doc, x, r.position).edge + 1; insertVertex(doc, line.id, k, r.position); }
  const on = linkFrom(doc, line.id, k)?.to;
  if (on) return targetOf(on); // attached already (a point, a shape's corner): there too
  const p = addDot(doc, line.points[k], line.names[k]);
  setLink(doc, line.id, k, { element: p.id });
  return { element: p.id };
}
