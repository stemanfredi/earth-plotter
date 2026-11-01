// Direct manipulation (docs/drawing-ui.md §5): the geometry of each drag, as the new values of the
// fields the inspector already edits. Pure: no map, no DOM. Positions [lon, lat], distances metres,
// angles degrees true.

import { inverse, destination } from '../geodesy.js';
import { norm360 } from '../geo.js';

// a radius: the pointer's distance from the centre
export const radiusTo = (centre, p) => inverse(centre, p).s;
// a bearing: the pointer's azimuth from the centre; snap (degrees) rounds it
export function bearingTo(centre, p, snap = 0) {
  const a = norm360(inverse(centre, p).azi);
  return snap ? norm360(Math.round(a / snap) * snap) : a;
}
// A sector with one end of its arc dragged to the pointer, the other end kept: { bearing, aperture }.
// edge −0.5: the end anticlockwise of the bearing (where the arc starts, clockwise); 0.5: the other.
// The arc runs clockwise from start to end, 1–359° (past the kept end it wraps round); snap (degrees)
// rounds the dragged end's bearing.
export function sectorEdgeTo(centre, bearing, aperture, edge, p, snap = 0) {
  const at = bearingTo(centre, p, snap);
  const start = edge < 0 ? at : bearing - aperture / 2, end = edge < 0 ? bearing + aperture / 2 : at;
  const ap = Math.round(Math.min(359, Math.max(1, norm360(end - start))) * 10) / 10;
  return { bearing: +norm360((edge < 0 ? end - ap : start) + ap / 2).toFixed(4), aperture: ap };
}
// A shape held by a point is rigid: a place dragged resizes it, its form kept, the place farthest from
// it staying put (a rectangle's opposite corner). Place i of points dragged to p, about centre (the
// point) facing bearing: every place's offsets from the kept one, along and across the bearing, by
// the factors that take the dragged place's to the pointer's (an offset under a metre keeps its axis'
// factor 1; 0.05 at least, so that a shape never flips); even (Shift): one factor, the distances'
// ratio. Returns { points, centre }: the centre moved with them, so that the point stays the shape's.
export function scaledPlaces(centre, bearing, points, i, p, even = false) {
  const local = (q) => { const g = inverse(centre, q), a = (g.azi - bearing) * Math.PI / 180; return [g.s * Math.cos(a), g.s * Math.sin(a)]; };
  const ps = points.map(local), from = ps[i];
  const kept = ps.reduce((best, q) => (Math.hypot(q[0] - from[0], q[1] - from[1]) > Math.hypot(best[0] - from[0], best[1] - from[1]) ? q : best), from);
  const was = [from[0] - kept[0], from[1] - kept[1]], now = local(p).map((v, k) => v - kept[k]);
  const f = (k) => (Math.abs(was[k]) < 1 ? 1 : Math.max(0.05, now[k] / was[k]));
  const fa = even ? Math.max(0.05, Math.hypot(...now) / Math.max(1, Math.hypot(...was))) : f(0), fx = even ? fa : f(1);
  const back = ([a, x]) => { const s = Math.hypot(a, x); return s ? destination(centre, bearing + Math.atan2(x, a) * 180 / Math.PI, s) : [...centre]; };
  const scaled = ([a, x]) => back([kept[0] + (a - kept[0]) * fa, kept[1] + (x - kept[1]) * fx]);
  return { points: ps.map(scaled), centre: scaled([0, 0]) };
}
