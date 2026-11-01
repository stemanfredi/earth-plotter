// Rules (docs/drawing-ui.md §6): Distribute along and Connect, two tools that make ordinary points and
// lines and keep their settings, to be edited again or brought up to date (Update), kept in doc.rules
// ({ kind: 'distribute' | 'connect', ... }). They follow nothing by themselves. What a
// rule makes is in a group of its own: Distribute along's, "Distribute along X", holds a subgroup
// "Copies" and Connect's subgroup "Connection" (its lines, hubs and new roots); Connect alone makes
// its "Connection" in the points' group. Pure: no map, no DOM.
//   Distribute along: copies along a line, or round a circle (the whole of it from its bearing, or a
//     sector's arc from one end to the other, clockwise): points (each with its shapes) every
//     `spacing` (or `count` of them) between the margins, offset to one side or alternating, each a
//     copy facing away from the line (on an arc, left is outwards). Update places them again along the
//     line or the circle as it is now.
//   Connect: points joined to roots. The points in order (a distribution's along its line, otherwise
//     as given) are cut into groups of consecutive points, at most `groupSize` each ('auto': any
//     size), each joined to one root: the cut and the roots chosen together as the cheapest (plan:
//     the sum of the groups' lengths, each divided by its root's weight; a root with a weight of 2
//     wins groups as if it were half as far). A root that wins no group is reported unused. Tree: a
//     hub per group (the geometric median of its points and its root, kept at least `minBranch` from
//     each of them), a line from the root to it, lines from it to each point; chain: a line from the
//     root to the group's nearer end point, then point to point.
//     Each line is attached to the points it joins (so it follows them); Update plans it again.
// The lines are straight: they are the real object (positions, lengths).

import { inverse, destination, localFrame, lengthOf } from '../geodesy.js';
import { norm360 } from '../geo.js';
import { lineTrace, pointsAlong } from './lines.js';
import { addPoint, addDot, addLine, addGroup, elements, newId, idsOf, label, remove, setLink, carry, emptyDoc } from './document.js';
import { BUILT_IN, build, placeCopy, presetProperty } from './place.js';
import { alone } from './clipboard.js';

// a drawing's rules of each kind
export const distributions = (doc) => doc.rules.filter((r) => r.kind === 'distribute');
export const connections = (doc) => doc.rules.filter((r) => r.kind === 'connect');

// ---- placing points along a line ---------------------------------------------------------------------

// What points go along: a line as drawn (a closed one round its ring, from its first place); a
// circle, clockwise: its whole round from its bearing, closed, or a sector's arc from one end to the
// other, sampled every half degree. { coords, length, closed }
export function alongTrace(doc, el) {
  if (!el.position) { const tr = lineTrace(doc, el); return { coords: tr.coords, length: tr.length, closed: el.closed }; }
  const ap = el.aperture ?? 360, from = el.aperture ? el.bearing - ap / 2 : el.bearing, n = Math.max(8, Math.ceil(ap * 2));
  const coords = Array.from({ length: n + 1 }, (_, i) => destination(el.position, from + (ap * i) / n, el.radius));
  return { coords, length: lengthOf(coords), closed: !el.aperture };
}
// the element points go along (a line or a circle), or null
export const alongOf = (doc, id) => doc.lines.find((s) => s.id === id) ?? doc.circles.find((c) => c.id === id) ?? null;

// the most copies one distribution makes: more would hang the page (each is a point, drawn and followed)
export const MAX_COPIES = 2000;
// The points' places along el (a line, or a circle's arc): { points: [{ position, facing, t, left }],
// length, capped (more than MAX_COPIES asked for: the first of them) }. facing: the azimuth away from
// the line on the side the point is offset to (a sector's bearing); t: where along it (0 to 1). count
// (instead of spacing): that many points, evenly from one margin to the other. A ring (a whole
// circle, a closed line) has no ends: no margins, the points evenly round it (count), or every
// spacing from its start (a circle's bearing).
export function distribute(doc, el, { spacing, count = null, startMargin = 0, endMargin = 0, offset = 0, side = 'left' }) {
  const tr = alongTrace(doc, el);
  const L = tr.length, ds = [], n = Math.min(count ?? 0, MAX_COPIES);
  if (tr.closed) {
    if (n > 0) for (let i = 0; i < n; i++) ds.push((L * i) / n);
    else if (spacing > 0) for (let d = 0; d < L - 1e-6 && ds.length < MAX_COPIES; d += spacing) ds.push(d);
  } else {
    const room = L - startMargin - endMargin;
    if (n > 0 && room >= 0) for (let i = 0; i < n; i++) ds.push(startMargin + (n > 1 ? (room * i) / (n - 1) : room / 2));
    else if (spacing > 0) for (let d = startMargin; d <= L - endMargin + 1e-6 && ds.length < MAX_COPIES; d += spacing) ds.push(d);
  }
  const capped = count > MAX_COPIES || (!(count > 0) && spacing > 0 && ds.length >= MAX_COPIES);
  const points = pointsAlong(tr.coords, ds).map(({ position, azi }, k) => {
    const left = side === 'left' || (side === 'alternate' && k % 2 === 0);
    const facing = facingOf(el, position, azi, left);
    return { position: offset ? destination(position, facing, offset) : position, facing, t: L ? ds[k] / L : 0, left };
  });
  return { points, length: L, capped };
}
const away = (azi, left) => norm360(azi + (left ? -90 : 90));
// the azimuth away from what the points go along, at position (azi: the way along it there): on an
// arc, exactly from its centre (left, outwards) or towards it
const facingOf = (el, position, azi, left) => (el.position ? away(inverse(el.position, position).azi + 90, left) : away(azi, left));

// ---- planning a connection ----------------------------------------------------------------------------

// The geometric median of planar points (Weiszfeld), weights all 1; tol: the step (m) at which it
// has settled.
function weiszfeld(pts, iterations = 500, tol = 1e-6) {
  let m = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
  for (let it = 0; it < iterations; it++) {
    let wx = 0, wy = 0, w = 0;
    for (const p of pts) {
      const d = Math.hypot(p[0] - m[0], p[1] - m[1]);
      if (d < 1e-9) return p.slice(); // on a point: it is the median (where the weight is not outweighed)
      wx += p[0] / d; wy += p[1] / d; w += 1 / d;
    }
    const next = [wx / w, wy / w];
    if (Math.hypot(next[0] - m[0], next[1] - m[1]) < tol) return next;
    m = next;
  }
  return m;
}
const hubOf = (positions) => { const f = localFrame(positions[0]); return f.from(weiszfeld(positions.map(f.to))); };
// A tree's hub: the geometric median of its nodes and its root (on a node when that is the median: a
// branch of 0 m). With a shortest branch (minBranch, m), the hub is kept that far from every node and
// from the root: pushed straight away from each it is too near, in turn, until none is. On one of them
// (within a metre: the median settles beside a node), it goes towards the root (from the root: towards
// the nodes).
export function hubFor(nodes, root, minBranch = 0) {
  let h = hubOf([...nodes, root]);
  if (!(minBranch > 0)) return h;
  const all = [...nodes, root];
  for (let it = 0; it < 100; it++) {
    const q = all.find((p) => inverse(p, h).s < minBranch - 1e-6);
    if (!q) break;
    const d = inverse(q, h);
    const away = q === root ? inverse(root, hubOf(nodes)) : inverse(q, root);
    const azi = d.s > 1 ? d.azi : away.s > 1e-9 ? away.azi : 0; // nowhere to head (the root on the node): north
    h = destination(q, azi, minBranch);
  }
  return h;
}
// How a group joins a root, and its length (straight lines). 'tree': root → hub → each node; 'chain':
// root → the nearer end node → the next … → the other end (reversed: from the last node).
function route(nodes, root, pattern, minBranch = 0) {
  if (pattern === 'chain') {
    const along = lengthOf(nodes), a = inverse(root, nodes[0]).s, z = inverse(root, nodes.at(-1)).s;
    return { reversed: z < a, cost: Math.min(a, z) + along };
  }
  const b = hubFor(nodes, root, minBranch);
  return { hub: b, cost: inverse(root, b).s + nodes.reduce((a, n) => a + inverse(b, n).s, 0) };
}
// the largest tree, Auto's or a Group size's: each candidate group costs a hub, and every run of
// this many points is a candidate (the search grows with its square: 400 points in trees of any
// size took 11 s). Chains cost nothing to size: any
export const MAX_TREE = 32;
// a group size as the planner takes it: a whole number (a tree's at most MAX_TREE), else 'auto'
export const groupSizeOf = (v, pattern) => (Number.isInteger(v) && v > 0 ? (pattern === 'chain' ? v : Math.min(v, MAX_TREE)) : 'auto');
let lastPlan = null; // the last plan, by its inputs: the form previews it, then Connect makes it

// The plan: the points (positions, in order) cut into groups of consecutive points, each joined to one
// of the roots ([{ position, weight }]), the cut and the roots chosen together as the cheapest: the sum
// over the groups of their length divided by its root's weight (dynamic programming over the order:
// the best plan for the first i points ends with one group of up to groupSize points to one root). A
// tie (points evenly along a line: every cut costs the same) goes to the plan whose largest group is
// smallest. groupSize: a number, or 'auto' (a chain of any length; a tree of up to MAX_TREE).
// minBranch: a tree's shortest branch (m).
// The candidates are costed in one local planar frame (metres about the middle point: the choice
// only needs their lengths against each other); the groups chosen are then routed on the ellipsoid.
// { groups: [{ nodes (indices), root (index), hub | reversed, cost (m) }], unused: [root indices],
//   total (m, the real length), groupSize (the largest group's, for 'auto') }
export function plan(points, roots, groupSize = 'auto', pattern = 'tree', minBranch = 0) {
  const n = points.length, R = roots.length;
  if (!n || !R) return { groups: [], unused: roots.map((_, i) => i), total: 0, groupSize };
  const key = JSON.stringify([points, roots.map((r) => [r.position, r.weight]), groupSize, pattern, minBranch]); // the form's preview and Connect ask alike (the weights as connectSettings gives them)
  if (lastPlan?.key === key) return structuredClone(lastPlan.value);
  const value = planNow(points, roots, groupSizeOf(groupSize, pattern), pattern, minBranch);
  lastPlan = { key, value: structuredClone(value) };
  return value;
}
function planNow(points, roots, groupSize, pattern, minBranch) {
  const n = points.length, R = roots.length;
  const chain = pattern === 'chain';
  const k = Math.min(n, groupSize === 'auto' ? (chain ? n : MAX_TREE) : groupSize);
  const weight = (r) => roots[r].weight;
  const f = localFrame(points[n >> 1]), P = points.map(f.to), Q = roots.map((r) => f.to(r.position));
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const along = [0]; // along[i]: the chain from the first point to point i
  for (let i = 1; i < n; i++) along[i] = along[i - 1] + dist(P[i - 1], P[i]);
  // a group's cost from root r, planar: a chain from its nearer end; a tree through its hub, the
  // median pushed off what it is nearer than minBranch (as hubFor)
  const cost = (j, i, r) => {
    if (chain) return Math.min(dist(Q[r], P[j]), dist(Q[r], P[i - 1])) + along[i - 1] - along[j];
    const nodes = P.slice(j, i), all = [...nodes, Q[r]];
    let h = weiszfeld(all, 30, 0.1); // a candidate's cost: within a metre is plenty (the groups chosen are routed exactly)
    for (let it = 0; minBranch > 0 && it < 100; it++) {
      const q = all.find((p) => dist(p, h) < minBranch - 1e-6);
      if (!q) break;
      const d = dist(q, h), to = d > 1 ? h : q === Q[r] ? weiszfeld(nodes, 100, 0.01) : Q[r], l = dist(q, to);
      h = l > 1e-9 ? [q[0] + ((to[0] - q[0]) / l) * minBranch, q[1] + ((to[1] - q[1]) / l) * minBranch] : [q[0], q[1] + minBranch]; // nowhere to head (the root on the node): north
    }
    return dist(Q[r], h) + nodes.reduce((a, p) => a + dist(h, p), 0);
  };
  const best = [{ score: 0, mx: 0 }]; // best[i]: the cheapest plan for the first i points (its largest group mx), and its last group
  for (let i = 1; i <= n; i++) {
    let b = null;
    for (let j = Math.max(0, i - k); j < i; j++) {
      for (let r = 0; r < R; r++) {
        const score = best[j].score + cost(j, i, r) / weight(r), mx = Math.max(best[j].mx, i - j);
        const eps = 1e-9 * (score + b?.score); // a tie: within rounding (totals reach 10⁷ m)
        if (!b || score < b.score - eps || (score <= b.score + eps && mx < b.mx)) b = { score, mx, j, r };
      }
    }
    best[i] = b;
  }
  const groups = [];
  for (let i = n; i > 0; i = best[i].j) {
    const { j, r } = best[i], nodes = Array.from({ length: i - j }, (_, x) => j + x);
    const rt = route(nodes.map((x) => points[x]), roots[r].position, pattern, minBranch);
    groups.unshift({ nodes, root: r, hub: rt.hub, reversed: rt.reversed, cost: rt.cost });
  }
  const used = new Set(groups.map((g) => g.root));
  return { groups, unused: roots.map((_, i) => i).filter((i) => !used.has(i)), total: groups.reduce((a, g) => a + g.cost, 0),
    groupSize: groupSize === 'auto' ? Math.max(...groups.map((g) => g.nodes.length)) : groupSize };
}

// The straight lines a plan makes, as [from, to] positions (the preview, before anything is made).
export function lines(points, roots, p, pattern = 'tree') {
  const out = [];
  for (const g of p.groups) {
    const o = roots[g.root].position, pts = g.nodes.map((i) => points[i]);
    if (pattern === 'chain') {
      const seq = g.reversed ? pts.slice().reverse() : pts;
      [o, ...seq].forEach((q, i, all) => { if (i) out.push([all[i - 1], q]); });
    } else {
      out.push([o, g.hub]);
      for (const q of pts) out.push([g.hub, q]);
    }
  }
  return out;
}

// points in the order a connection cuts them: all in one distribution, its order along its line;
// otherwise as given
function ordered(doc, nodes) {
  const dist = distributions(doc).find((a) => nodes.every((n) => a.pointIds.includes(n.id)));
  if (dist) { const k = new Map(dist.pointIds.map((id, i) => [id, i])); return [...nodes].sort((a, b) => k.get(a.id) - k.get(b.id)); }
  return nodes;
}

// A connection's plan before it is made (the form's preview): { nodes (points), roots ([{ position,
// weight }]), plan }. params: pointIds, roots ([{ id, weight }]), newRoots (positions, weight 1),
// pattern, groupSize, minBranch.
export function planConnection(doc, { pointIds, roots = [], newRoots = [], pattern = 'tree', groupSize = 'auto', minBranch = 0 }) {
  const byId = new Map(doc.points.map((n) => [n.id, n]));
  const nodes = ordered(doc, pointIds.map((id) => byId.get(id)).filter(Boolean));
  const rs = [...roots.filter((r) => byId.has(r.id)).map((r) => ({ position: byId.get(r.id).position, weight: r.weight })), ...newRoots.map((position) => ({ position, weight: 1 }))];
  return { nodes, roots: rs, plan: nodes.length && rs.length ? plan(nodes.map((n) => n.position), rs, groupSize, pattern, minBranch) : null };
}

// ---- making ----------------------------------------------------------------------------------------

// the rules' fields when nothing says otherwise (the file leaves these out: file.js); radius in m
export const DISTRIBUTE_D = { groupId: null, copiesId: null, spacing: null, count: null, startMargin: 0, endMargin: 0, offset: 0, side: 'left', radius: 500, aperture: null, preset: null, pointIds: [] };
export const CONNECT_D = { groupId: null, pattern: 'tree', groupSize: 'auto', minBranch: 0, roots: [], pointIds: [], created: [] };
export const patternOf = (v) => (v === 'chain' ? 'chain' : 'tree');
const DISTRIBUTE_KEYS = Object.keys(DISTRIBUTE_D).filter((k) => !['groupId', 'copiesId', 'pointIds'].includes(k)); // its settings: what the form sets
const D = DISTRIBUTE_D, SIDES = ['left', 'right', 'alternate'];
// A distribution's settings as taken, from the form or a file: each value of its kind and range,
// else its default (a count: the spacing goes).
export function settings(p) {
  const fin = Number.isFinite, count = Number.isInteger(p.count) && p.count > 0 ? p.count : D.count, m = (k) => (fin(p[k]) && p[k] >= 0 ? p[k] : D[k]);
  return { spacing: !count && fin(p.spacing) && p.spacing > 0 ? p.spacing : D.spacing, count, startMargin: m('startMargin'), endMargin: m('endMargin'), offset: m('offset'),
    side: SIDES.includes(p.side) ? p.side : D.side, radius: fin(p.radius) && p.radius > 0 ? p.radius : D.radius,
    aperture: fin(p.aperture) && p.aperture > 0 && p.aperture < 360 ? p.aperture : D.aperture,
    preset: typeof p.preset === 'string' ? p.preset : D.preset };
}
// A connection's settings as taken, from the form or a file: its pattern, its group size, a tree's
// shortest branch (a chain has none), each of its kind and range, else its default; its roots (as
// given) each with a weight above 0, else 1. The planner takes these as they are.
export function connectSettings(p) {
  const pattern = patternOf(p.pattern), fin = Number.isFinite;
  return { pattern, groupSize: groupSizeOf(p.groupSize, pattern), minBranch: pattern === 'tree' && fin(p.minBranch) && p.minBranch > 0 ? p.minBranch : CONNECT_D.minBranch,
    roots: (p.roots || []).map((r) => ({ id: r.id, weight: fin(r.weight) && r.weight > 0 ? r.weight : 1 })) };
}
// What a distribution's copies are: a drawing whose first point (with its shapes) each copies. copy:
// one of the user's presets, as chosen (its drawing: the point named after it in the property
// preset, as one placed by hand); else its preset, a built-in kind (null: 'circle', a sector with
// its aperture) its largest shape reaching its radius, no property
function templateOf(a, copy = null) {
  if (copy) { const doc = alone(copy, copy.points[0].id); presetProperty(doc.points[0], a.preset.slice(7)); return doc; }
  const doc = emptyDoc(0), kind = BUILT_IN.includes(a.preset) ? a.preset : 'circle';
  build(doc, [0, 0], kind === 'circle' && a.aperture ? 'sector' : kind, a.radius, { aperture: a.aperture });
  return doc;
}
// the distribution's copies of tpl made at places, into its Copies group (or the group given): each
// facing away from what it follows; pointIds, in their order along it
function place(doc, a, points, tpl, groupId = a.copiesId) {
  a.pointIds = points.map((pt) => placeCopy(doc, tpl, pt.position, +pt.facing.toFixed(4), groupId).id);
}

// Distribute along: copies along a line or round a circle (doc is changed: one undo step for the
// caller). params: along ({ element }: the line or the circle), spacing or count, startMargin,
// endMargin, offset, side ('left', 'right', 'alternate'), radius (the copies', apart from the
// spacing), aperture (the circle's as a sector, facing away from what it follows; null: circles),
// preset and copy (templateOf; copy is not kept), groupId (the group its own group goes in; null: at
// the top).
// Returns { distribution (its rule), group (its own: "Distribute along X", with "Copies" in it) }.
export function makeDistribution(doc, params) {
  const along = alongOf(doc, params.along.element);
  const set = settings(params);
  const { points } = distribute(doc, along, set);
  const parent = doc.groups.some((g) => g.id === params.groupId) ? params.groupId : null;
  const group = addGroup(doc, `Distribute along ${label(along.position ? 'circle' : 'line', along)}`, parent);
  const copies = addGroup(doc, 'Copies', group.id);
  const distribution = { id: newId(doc), kind: 'distribute', groupId: group.id, copiesId: copies.id, along: { element: along.id }, ...set, pointIds: [] };
  doc.rules.push(distribution);
  place(doc, distribution, points, templateOf(set, params.copy));
  return { distribution, group };
}

// A distribution with new settings (none: Update, along what it follows as it is now). The same copy
// (preset, radius, aperture) and number of them: they move (one moved by hand too), as they are; else
// they are made anew (another copy: from it; another number: as the first copy left is), and each
// connection built on them is made again with its settings. Returns { distribution, remade }, or null
// (the rule or what it follows gone).
export function editDistribution(doc, id, params) {
  const a = doc.rules.find((x) => x.id === id), along = a && alongOf(doc, a.along.element);
  if (!along) return null;
  const was = JSON.stringify([a.preset, a.radius, a.aperture]);
  Object.assign(a, settings({ ...Object.fromEntries(DISTRIBUTE_KEYS.map((k) => [k, a[k]])), ...params }));
  const same = was === JSON.stringify([a.preset, a.radius, a.aperture]);
  const { points } = distribute(doc, along, a);
  const byId = new Map(doc.points.map((n) => [n.id, n]));
  if (same && points.length === a.pointIds.length && a.pointIds.every((id) => byId.has(id))) {
    a.pointIds.forEach((id, k) => carry(doc, byId.get(id), points[k].position, +points[k].facing.toFixed(4)));
    return { distribution: a, remade: false };
  }
  const first = byId.get(a.pointIds.find((id) => byId.has(id)));
  const tpl = same && first ? alone(doc, first.id) : templateOf(a, params.copy);
  const old = new Set(a.pointIds);
  const built = connections(doc).filter((c) => c.pointIds.some((n) => old.has(n))).map((c) => unconnect(doc, c.id, true));
  // its Copies deleted: the new copies go where the old ones were
  const at = a.copiesId ?? byId.get([...old].find((n) => byId.has(n)))?.groupId ?? null;
  remove(doc, [...old].filter((n) => byId.has(n)));
  place(doc, a, points, tpl, at);
  const made = a.pointIds;
  for (const c of built) connect(doc, { ...c, pointIds: [...c.pointIds.filter((n) => !old.has(n)), ...made] });
  return { distribution: a, remade: true };
}
// Connect points to roots (doc is changed: one undo step for the caller). params: pointIds, roots
// ([{ id (a point), weight }]), newRoots (positions where a root point is made: square, weight 1),
// pattern ('tree' or 'chain'), groupSize (a number, or 'auto'), minBranch (a tree's shortest branch,
// m), id (the connection made again: its own), groupId (made again: its group, kept). Returns
// { connection, groups, groupSize, lines, unused (root IDs), total (m) }, or null (no point or no root).
export function connect(doc, params) {
  const byId = new Map(doc.points.map((n) => [n.id, n]));
  const first = params.pointIds.map((id) => byId.get(id)).find(Boolean);
  if (!first) return null;
  const { pattern, groupSize, minBranch, roots: given } = connectSettings({ ...params, roots: (params.roots || []).filter((r) => byId.has(r.id)) });
  if (!planConnection(doc, { ...params, pattern, groupSize, minBranch }).plan) return null;
  // its group: the one it had, else a new "Connection" in the points' group (a distribution's copies:
  // beside their Copies, in its own group)
  const around = distributions(doc).find((a) => a.copiesId && a.copiesId === first.groupId)?.groupId ?? first.groupId ?? null;
  const groupId = doc.groups.some((g) => g.id === params.groupId) ? params.groupId
    : addGroup(doc, 'Connection', around).id;
  const inGroup = (el) => { el.groupId = groupId; return el; };
  const before = idsOf(doc);
  const made = (params.newRoots || []).map((pos) => inGroup(addPoint(doc, pos, { symbol: 'square' })));
  const roots = [...given, ...made.map((n) => ({ id: n.id, weight: 1 }))];
  const { nodes, plan: p } = planConnection(doc, { pointIds: params.pointIds, roots, pattern, groupSize, minBranch });
  const rootPoints = roots.map((r) => doc.points.find((n) => n.id === r.id));
  // a straight line from a to b, its ends linked to both (what it is, a trunk or a branch: lines.js madeLines)
  const line = (a, b) => { const s = inGroup(addLine(doc, [a.position, b.position])); setLink(doc, s.id, 0, { element: a.id }); setLink(doc, s.id, 1, { element: b.id }); };
  for (const g of p.groups) {
    const o = rootPoints[g.root], ns = g.nodes.map((i) => nodes[i]);
    if (pattern === 'chain') {
      const seq = [o, ...(g.reversed ? ns.slice().reverse() : ns)];
      seq.slice(1).forEach((n, i) => line(seq[i], n));
      continue;
    }
    // a hub of its own, always: on one of the points (the median often is), a branch of 0 m to it
    const b = inGroup(addDot(doc, g.hub));
    line(o, b);
    for (const n of ns) line(b, n);
  }
  const keep = new Set(roots.map((r) => r.id));
  const created = [...doc.points, ...doc.lines].map((x) => x.id).filter((id) => !before.has(id) && !keep.has(id));
  const connection = { id: params.id || newId(doc), kind: 'connect', groupId, pattern, groupSize, minBranch, roots, pointIds: nodes.map((n) => n.id), created };
  doc.rules.push(connection);
  return { connection, groups: p.groups.length, groupSize: p.groupSize, lines: doc.lines.filter((x) => created.includes(x.id)).length,
    unused: p.unused.map((i) => roots[i].id), total: p.total };
}

// A connection undone: what it made that still exists goes (its points and roots stay), and its
// record; its group too when nothing is left in it, unless kept (to be made again). Returns the record,
// or null.
export function unconnect(doc, id, keepGroup = false) {
  const c = connections(doc).find((x) => x.id === id);
  if (!c) return null;
  const keep = new Set([...c.roots.map((r) => r.id), ...c.pointIds]);
  const live = new Set([...doc.points, ...doc.lines].map((x) => x.id));
  remove(doc, c.created.filter((x) => !keep.has(x) && live.has(x)));
  doc.rules = doc.rules.filter((x) => x !== c);
  if (!keepGroup) removeEmptyGroup(doc, c.groupId);
  return c;
}

// Connect again: a connection made anew, in its group, with its settings and changes ({ pattern,
// groupSize, minBranch, roots, newRoots }). Lines edited by hand are replaced. Returns as connect.
export function reconnect(doc, id, changes = {}) {
  const c = unconnect(doc, id, true);
  return c && connect(doc, { pointIds: c.pointIds, roots: c.roots, pattern: c.pattern, groupSize: c.groupSize, minBranch: c.minBranch, groupId: c.groupId, ...changes, id: c.id });
}

// The rule an element was made by or is part of: a distribution's copy, its group or Copies; a
// connection's line, hub or group; else null.
export function ruleOf(doc, id) {
  for (const r of doc.rules) {
    if (r.kind === 'distribute' && (r.groupId === id || r.copiesId === id || r.pointIds.includes(id))) return r;
    if (r.kind === 'connect' && (r.groupId === id || r.created.includes(id))) return r;
  }
  return null;
}

// Update: a rule brought up to date with what it was made from, its settings kept: a distribution's
// copies placed again along its line or circle as it is now; a connection planned again from its points
// and roots. One undo step for the caller. Returns what editDistribution or reconnect returns.
export function updateRule(doc, id) {
  const r = doc.rules.find((x) => x.id === id);
  return !r ? null : r.kind === 'distribute' ? editDistribution(doc, id, {}) : reconnect(doc, id);
}

// ---- after any change ----------------------------------------------------------------------------

// A rule's lists keep only what is still there; a rule whose line or circle is gone, or all of whose
// copies are (a connection: its points, or its roots), is dropped, with the groups it made left empty;
// what it made stays, plain elements. A rule's group deleted (its members kept) is no longer its: what
// it makes again goes where its own were. Nothing moves: a rule follows nothing until Update.
export function pruneRules(doc) {
  if (!doc.rules.length) return;
  const groups = new Set(doc.groups.map((g) => g.id)), pts = new Set(doc.points.map((n) => n.id));
  for (const r of doc.rules) for (const k of ['groupId', 'copiesId']) if (r[k] && !groups.has(r[k])) r[k] = null;
  const was = doc.rules;
  doc.rules = doc.rules.filter((r) => {
    r.pointIds = r.pointIds.filter((id) => pts.has(id));
    if (r.kind === 'distribute') return !!alongOf(doc, r.along.element) && r.pointIds.length > 0;
    r.roots = r.roots.filter((o) => pts.has(o.id));
    return r.roots.length > 0 && r.pointIds.length > 0;
  });
  // a rule gone takes the groups it made, where they are left empty
  const kept = new Set(doc.rules);
  for (const r of was) if (!kept.has(r)) for (const id of [r.copiesId, r.groupId]) if (id) removeEmptyGroup(doc, id);
}
function removeEmptyGroup(doc, id) {
  if (elements(doc).some(({ el }) => el.groupId === id)) return; // a member, or a subgroup
  doc.groups = doc.groups.filter((g) => g.id !== id);
}
