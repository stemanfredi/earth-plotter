// Trees spread (docs/drawing-ui.md §6): a connection's trees drawn as a diagram, by the screen.
// Display only: every position and length stays as it is.
//  - A hub nearer than GAP px to the row of its points (the line through the first and the last of
//    them) is shown GAP px to its side, at the same place along it: the root's side, or the row's
//    left when the root is on the row too.
//  - A line along a row runs beside it at a distance of its own, and joins what it leaves and what it
//    comes onto at 45°: the lines of one end lie on one another there, and are apart where they are
//    parallel. Such are a hub's lines to its points, between the row and the hub (the further the
//    point, the nearer the hub's distance); and the line of a root beside the row that would pass
//    other hubs shown aside nearer than GAP px, beyond them (the longer line a step further out), as
//    far as the last of them, then on to its own. A root further from the row than its line would
//    run comes from the side: its line is straight.
import { mercator, unmercator } from '../geo.js';
import { linkFrom } from './document.js';

export const GAP = 16, STEP = 5; // px
// where 45° from p reaches o px beside a row ({ on(s, o), along(p), off(p) }, px), going d (±1) along it
const leg = (row, p, o, d) => row.on(row.along(p) + d * Math.abs(o - row.off(p)), o);

// The trees of doc at mpp (Mercator metres a pixel): { at: Map(hub ID → the position it is shown at),
// via: Map(line ID → the positions its way goes by, in the line's own direction) }
export function spread(doc, mpp) {
  const at = new Map(), via = new Map(), trunks = [], aside = new Map(); // aside: hub ID → { at (px), and by its row: on(s, o), along(p), off(p) }
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
      const along = (p) => (p[0] - A[0]) * u[0] + (p[1] - A[1]) * u[1], off = (p) => (p[0] - A[0]) * left[0] + (p[1] - A[1]) * left[1];
      const H = px(points.get(id)), R = px(t.root);
      if (Math.abs(off(H)) >= GAP) continue; // seen as it is
      const n = off(R) <= -GAP ? [-left[0], -left[1]] : left;
      // the row: s along it and o px to its side; a place along it, and off it
      const row = { on: (s, o) => [A[0] + u[0] * s + n[0] * o, A[1] + u[1] * s + n[1] * o], along, off: (p) => (p[0] - A[0]) * n[0] + (p[1] - A[1]) * n[1] };
      const shown = row.on(along(H), GAP);
      at.set(id, place(shown));
      aside.set(id, { at: shown, ...row });
      // its lines to its points, each side of it (one too near along the row: straight)
      for (const d of [-1, 1]) {
        const side = own.filter((p) => p.line.points.length === 2 && (along(px(points.get(p.id))) - along(H)) * d > GAP + 1)
          .sort((p, q) => (along(px(points.get(p.id))) - along(px(points.get(q.id)))) * d);
        side.forEach((p, j) => {
          const o = (GAP * (j + 1)) / (side.length + 1), way = [leg(row, shown, o, d), leg(row, px(points.get(p.id)), o, -d)].map(place);
          via.set(p.line.id, p.turned ? way : way.reverse());
        });
      }
    }
  }
  // the lines from the roots, the shorter first: the hubs each would pass, in their order along it;
  // its distance a step beyond every shorter line of its root that passes one of them
  const ways = trunks.filter((t) => t.line.points.length === 2).map((t) => {
    const R = px(t.root), H = aside.get(t.hub)?.at ?? px(points.get(t.hub)), v = [H[0] - R[0], H[1] - R[1]], l = Math.hypot(...v) || 1;
    const round = [...aside].filter(([id]) => id !== t.hub).map(([id, q]) => {
      const k = ((q.at[0] - R[0]) * v[0] + (q.at[1] - R[1]) * v[1]) / (l * l);
      return { id, q, k, far: Math.hypot(q.at[0] - R[0] - k * v[0], q.at[1] - R[1] - k * v[1]) };
    }).filter((x) => x.k > 0 && x.k < 1 && x.far < GAP).sort((a, b) => a.k - b.k);
    return { ...t, R, H, l, round };
  }).sort((a, b) => a.l - b.l);
  for (const [i, t] of ways.entries()) {
    if (!t.round.length) continue;
    const ids = new Set(t.round.map((x) => x.id));
    const out = 1 + Math.max(0, ...ways.slice(0, i).filter((s) => s.out && s.root === t.root && s.round.some((x) => ids.has(x.id))).map((s) => s.out));
    // beside the row of the hubs passed, from where 45° from the root reaches its distance to the last
    // of them; a root further from that row than the line would run: straight, as it comes from the side
    const f = t.round[0].q, o = GAP + out * STEP, d = Math.sign(f.along(f.at) - f.along(t.R)) || 1, last = f.along(t.round.at(-1).q.at);
    if (f.off(t.R) >= o) continue;
    t.out = out;
    const out45 = leg(f, t.R, o, d), start = f.along(out45);
    if ((f.along(t.H) - start) * d < o - GAP + 1) continue; // no room: straight
    const way = [out45, ...((last - start) * d > 0 ? [f.on(last, o)] : [])];
    // onto its own hub at 45°, by its row
    const own = aside.get(t.hub);
    if (own) { const prev = own.along(way.at(-1)), e = Math.sign(own.along(t.H) - prev) || 1, in45 = leg(own, t.H, o, -e); if ((own.along(in45) - prev) * e > 0) way.push(in45); }
    via.set(t.line.id, (t.turned ? way.reverse() : way).map(place));
  }
  return { at, via };
}
