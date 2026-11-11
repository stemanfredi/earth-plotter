// Trees spread (docs/drawing-ui.md §6): a connection's trees drawn as a diagram, by the screen.
// Display only: every position and length stays as it is.
//  - A hub nearer than GAP px to the row of its points (the line through the first and the last of
//    them) is shown GAP px to its side, at the same place along it: the root's side, or the row's
//    left when the root is on the row too.
//  - Its lines to its points run beside the row too, between it and the hub, the further the point
//    the nearer the hub's distance, each then onto its point.
//  - A line from a root that would then run through other hubs of that root (the root on the row
//    too, or nearly; another connection's hubs passed on the way) runs beside their row instead,
//    beyond the hubs, the longer the further out: onto its own hub, or past the last of them and
//    straight on.
import { mercator, unmercator } from '../geo.js';
import { linkFrom } from './document.js';

export const GAP = 16, STEP = 5; // px

// The trees of doc at mpp (Mercator metres a pixel): { at: Map(hub ID → the position it is shown at),
// via: Map(line ID → the positions its way goes by, in the line's own direction) }
export function spread(doc, mpp) {
  const at = new Map(), via = new Map(), trunks = [], rides = [];
  const points = new Map(doc.points.map((n) => [n.id, n])), px = (n) => mercator(n.position).map((v) => v / mpp);
  const place = ([x, y]) => unmercator([x * mpp, y * mpp]);
  for (const c of doc.rules) {
    if (c.kind !== 'connect') continue;
    const made = new Set(c.created), roots = new Set(c.roots.map((r) => r.id)), order = new Map(c.pointIds.map((id, i) => [id, i]));
    // its lines by what their ends are attached to: root to hub, hub to point (turned: its first end the hub)
    const trunk = new Map(), ends = new Map(); // hub ID → its line from the root; hub ID → its lines to its points
    for (const sg of doc.lines) {
      if (!made.has(sg.id)) continue;
      const [a, b] = [0, sg.points.length - 1].map((i) => linkFrom(doc, sg.id, i)?.to.element);
      for (const [x, y, turned] of [[a, b, false], [b, a, true]]) {
        if (!points.has(x) || !made.has(y) || !points.has(y)) continue; // y: a hub
        if (roots.has(x)) trunk.set(y, { line: sg, root: points.get(x), hub: y, turned });
        else if (order.has(x)) ends.set(y, [...(ends.get(y) ?? []), { line: sg, id: x, turned }]);
      }
    }
    for (const [id, t] of trunk) {
      trunks.push(t);
      const own = (ends.get(id) ?? []).sort((p, q) => order.get(p.id) - order.get(q.id));
      if (own.length < 2) continue;
      const A = px(points.get(own[0].id)), B = px(points.get(own.at(-1).id)), l = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (l < 1) continue;
      const u = [(B[0] - A[0]) / l, (B[1] - A[1]) / l], left = [-u[1], u[0]];
      const along = (p) => (p[0] - A[0]) * u[0] + (p[1] - A[1]) * u[1], aside = (p) => (p[0] - A[0]) * left[0] + (p[1] - A[1]) * left[1];
      const H = px(points.get(id)), R = px(t.root);
      if (Math.abs(aside(H)) >= GAP) continue; // seen as it is
      const onRow = Math.abs(aside(R)) < GAP, n = !onRow && aside(R) < 0 ? [-left[0], -left[1]] : left;
      const on = (s, o) => [A[0] + u[0] * s + n[0] * o, A[1] + u[1] * s + n[1] * o]; // s along the row, o px to its side
      at.set(id, place(on(along(H), GAP)));
      Object.assign(t, { frame: { u, n, on, from: along(R), to: along(H) }, onRow, off: (q) => Math.abs(aside(q)) });
      // its lines to its points, each side of it (one too near along the row: straight)
      for (const d of [-1, 1]) {
        const side = own.filter((p) => p.line.points.length === 2 && (along(px(points.get(p.id))) - along(H)) * d > GAP + 1)
          .sort((p, q) => (along(px(points.get(p.id))) - along(px(points.get(q.id)))) * d);
        side.forEach((p, j) => {
          const o = (GAP * (j + 1)) / (side.length + 1), way = [on(along(H) + d * (GAP - o), o), on(along(px(points.get(p.id))) - d * o, o)].map(place);
          via.set(p.line.id, p.turned ? way : way.reverse());
        });
      }
    }
  }
  // the rides of one root along one row, one way, on one side
  const dir = (q) => Math.sign(q.to - q.from) || 1;
  const same = (q, r) => q.root === r.root && (q.u[0] * r.u[0] + q.u[1] * r.u[1]) * dir(q) * dir(r) > 0.99 && q.n[0] * r.n[0] + q.n[1] * r.n[1] > 0;
  // the hubs shown aside a root's line would pass by, going straight: nearer than 2 GAP
  const shown = (id) => (at.has(id) ? mercator(at.get(id)).map((v) => v / mpp) : px(points.get(id)));
  const near = (p, a, b) => { const vx = b[0] - a[0], vy = b[1] - a[1], k = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / (vx * vx + vy * vy || 1))); return Math.hypot(p[0] - a[0] - k * vx, p[1] - a[1] - k * vy) < 2 * GAP; };
  const passed = (t) => trunks.filter((q) => q !== t && q.root === t.root && q.frame && near(shown(q.hub), px(t.root), shown(t.hub)));
  const straight = trunks.filter((t) => t.line.points.length === 2).map((t) => [t, passed(t)]);
  // onto its own hub, along its row: the root on it, or hubs of that row passed (the rows one way, each hub by the other's)
  for (const [t, by] of straight) if (t.frame && (t.onRow || by.some((q) => Math.abs(q.frame.u[0] * t.frame.u[0] + q.frame.u[1] * t.frame.u[1]) > 0.99 && t.off(shown(q.hub)) < 2 * GAP && q.off(shown(t.hub)) < 2 * GAP))) rides.push({ ...t, ...t.frame, reach: Math.abs(t.frame.to - t.frame.from) });
  // past the hubs of another row: with their lines, beyond them all, as far as the last of them
  const own = [...rides];
  for (const [t, by] of straight) {
    const with_ = own.filter((r) => by.some((q) => q.hub === r.hub));
    if (own.some((r) => r.line === t.line) || !with_.length) continue;
    const r = with_.reduce((p, q) => (q.reach > p.reach ? q : p)), last = Math.max(...own.filter((q) => same(q, r)).map((q) => q.reach));
    rides.push({ ...t, u: r.u, n: r.n, on: r.on, from: r.from, to: r.from + dir(r) * last, reach: last + Math.hypot(...px(t.root).map((v, k) => v - shown(t.hub)[k])), past: true });
  }
  for (const r of rides) {
    const d = dir(r), o = GAP + rides.filter((q) => q !== r && same(q, r) && q.reach < r.reach).length * STEP;
    if (Math.abs(r.to - r.from) < 2 * o - GAP + 1) continue; // no room: straight
    const way = [r.on(r.from + d * o, o), ...(r.past ? [r.on(r.to, o)] : o > GAP ? [r.on(r.to - d * (o - GAP), o)] : [])].map(place);
    via.set(r.line.id, r.turned ? way.reverse() : way);
  }
  return { at, via };
}
