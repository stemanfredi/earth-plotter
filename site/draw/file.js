// The drawing's file: a GeoJSON FeatureCollection (RFC 7946; docs/drawing-format.md). Any GIS
// reads it as it is, and this app reads any GeoJSON (what is not its own becomes plain points and
// lines, a polygon a closed line). Each element is a Feature with its real geometry; the user's
// properties and the common style names (stroke, fill…) are its properties; what is the app's own is
// under one key, "earthplotter"; the drawing's view, look, groups, rules and links are a member "earthplotter"
// of the collection.
// Legs are geodesics, or a smooth curve through the vertices (other tools draw them straight in
// longitude and latitude: the geometry holds the vertices, "smooth" is the app's). Drawings of another format version are not read. Pure: no map, no DOM.

import { FORMAT, VERSION, KINDS, KIND, SYMBOLS, LEADERS, LABEL_OFFSET, META_D, MAX_RADIUS, MAX_LABEL_OFFSET,
  emptyDoc, newId, columnsOf, find, targetOf, elements, canHold, holderOf, positionsIn, adopt, framed, reading } from './document.js';
import { ID, isObj, fin, oneOf, Skip, time, text, properties, flag, position, angle, look, aperture, readView, VIEW_D, VIEW_DATA_D } from './check.js';
import { targetPosition, refreshAttached, placeAt, lineTarget } from './attach.js';
import { settings, connectSettings, DISTRIBUTE_D, CONNECT_D } from './generator.js';
import { norm180, norm360, samePosition, lonLatArea2 } from '../geo.js';

const MAX_POSITIONS = 100000; // positions in one line: more would stall the page at every change
const MAX_FEATURES = 20000; // elements and groups in one file: the rest are skipped (as many points stall the list)
const MAX_DEPTH = 32; // groups inside groups: a deeper one goes to the top (each level costs every change)
const MAX_TOTAL_POSITIONS = 1000000; // positions in a file's lines together: more is refused, as soon as read
class Refused extends Error {}
// the properties a feature's own are written beside: a user's key that is one of these gets a p_
const FILE_PROPERTIES = ['name', 'stroke', 'stroke-width', 'stroke-opacity', 'fill', 'fill-opacity', 'earthplotter'];
const GEOMETRIES = ['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon', 'GeometryCollection'];

// ---- reading ---------------------------------------------------------------------------------

// A file's text → { doc, view, report }. doc is null when the file is refused (report.refused says why);
// view: the map's view the file was made in (page state, not the document's), or null;
// otherwise every element that could be read, completed with defaults, and the report lists what was
// skipped (and why) and what was repaired. known: what the app offers, to check the view's layers:
// { layers: { id: { variants, periods } }, data: { id: [variants] }, depths: [metres] }. now: the time
// to give a file without one.
export function parse(text, known = null, now = Date.now()) {
  const report = { refused: null, skipped: [], warnings: [] };
  const refuse = (why) => { report.refused = why; return { doc: null, view: null, report }; };
  let raw;
  try { raw = JSON.parse(text); } catch { return refuse('This is not a drawing file: it is not JSON.'); }
  if (!isObj(raw)) return refuse('This is not a drawing file: it holds no document.');
  if (raw.type !== 'FeatureCollection' && raw.type !== 'Feature' && !GEOMETRIES.includes(raw.type)) return refuse('This is neither a drawing file nor GeoJSON.');
  const app = isObj(unpack(raw.earthplotter)) ? unpack(raw.earthplotter) : null; // as text: a GIS may write it so
  if (app && app.version !== undefined && app.version !== VERSION) return refuse(`This drawing is of format version ${String(app.version).slice(0, 20)}; this app reads version ${VERSION}.`); // missing: this one
  const { doc, view } = read(raw, app, known, now, report);
  return report.refused ? { doc: null, view: null, report } : { doc, view, report };
}

// a value a GIS may have written back as text (a nested value): read again
// an ID as the file has it: text, or a number read as text (spec §2)
const idIn = (v) => (fin(v) ? String(v) : v);
const unpack = (v) => { if (typeof v !== 'string' || !/^\s*[[{]/.test(v)) return v; try { return JSON.parse(v); } catch { return v; } };

function read(raw, app, known, now, report) {
  const doc = emptyDoc(now);
  let view = null, over = 0;
  const taken = new Set();
  const ctx = (kind, id) => ({
    warn: (t) => report.warnings.push(`${kind}${id ? ` ${id}` : ''}: ${t}`),
    skip: (reason) => { throw new Skip(reason); },
  });
  const attempt = (kind, id, fn) => {
    try { return fn(ctx(kind, id)); } catch (e) {
      if (!(e instanceof Skip)) throw e;
      report.skipped.push({ kind, id, reason: e.message });
      return null;
    }
  };
  // an element's ID: its own, if valid and not used yet; else a new one (warned when it had one)
  const idOf = (v, c) => {
    const id = idIn(v);
    if (typeof id === 'string' && ID.test(id) && !taken.has(id)) { taken.add(id); return id; }
    if (id != null) c.warn(id && taken.has(id) ? 'ID already used; a new one given' : 'malformed ID; a new one given');
    return newId(doc, taken);
  };

  // the drawing's own: times, meta, view, groups
  if (app) {
    doc.created = time(app.created) || doc.created;
    doc.modified = time(app.modified) || doc.modified;
    if (app.meta !== undefined) {
      const c = ctx('meta'), m = isObj(app.meta) ? app.meta : (c.warn('not an object, ignored'), {});
      doc.meta = { title: text(m.title, c, 'title'), description: text(m.description, c, 'description'), author: text(m.author, c, 'author') };
    }
    if (app.view != null) view = readView(app.view, known, ctx('view'));
    doc.look = look(app.look, ctx('look'), 'drawing');
    for (const x of Array.isArray(app.groups) ? app.groups : []) {
      const g = attempt('group', x?.id, (c) => {
        if (!isObj(x)) c.skip('not an object');
        const id = idIn(x.id), up = idIn(x.groupId);
        if (typeof id !== 'string' || !ID.test(id) || taken.has(id)) c.skip('no valid ID');
        taken.add(id);
        return { ...commonOf(x, c), id, groupId: typeof up === 'string' ? up : null }; // a group has no look: its members' own
      });
      if (g && doc.groups.length >= MAX_FEATURES) over++;
      else if (g) doc.groups.push(g);
    }
    // each group's parent: one of the drawing's, never itself nor a group inside it, at most MAX_DEPTH
    // groups deep. Each group's depth is found once: the walk up stops at a group already placed
    const byId = new Map(doc.groups.map((g) => [g.id, g])), depth = new Map();
    const top = (g, why) => { ctx('group', g.id).warn(`${why}; now at the top`); g.groupId = null; };
    for (const g of doc.groups) {
      const path = [], on = new Set();
      let up = g;
      while (up && !depth.has(up) && !on.has(up)) {
        on.add(up); path.push(up);
        const next = up.groupId == null ? null : byId.get(up.groupId);
        if (up.groupId != null && !next) top(up, `group ${String(up.groupId).slice(0, 64)} not found`);
        up = next;
      }
      if (up && on.has(up)) top(path.at(-1), 'in a group inside itself'); // the loop cut where it closes
      for (let i = path.length - 1; i >= 0; i--) {
        const x = path[i], d = x.groupId == null ? 0 : depth.get(byId.get(x.groupId)) + 1;
        if (d > MAX_DEPTH) top(x, `more than ${MAX_DEPTH} groups deep`);
        depth.set(x, d > MAX_DEPTH ? 0 : d);
      }
    }
  }

  // the features, each part of a Multi geometry an element of its own
  const features = raw.type === 'FeatureCollection' ? (Array.isArray(raw.features) ? raw.features : (report.warnings.push('features: not a list, ignored'), []))
    : raw.type === 'Feature' ? [raw] : [{ type: 'Feature', properties: {}, geometry: raw }];
  let positions = 0;
  const rawFrames = new Map(); // a shape's frame as the file has it, checked once its point is known
  try { features.forEach((f, i) => {
    const fid = isObj(f) && (typeof f.id === 'string' || typeof f.id === 'number') ? String(f.id) : null;
    const skip = (reason) => report.skipped.push({ kind: 'feature', id: fid ?? String(i + 1), reason }); // a feature without an ID: its place in the list
    if (!isObj(f) || f.type !== 'Feature') { skip('not a Feature'); return; }
    const g = f.geometry;
    if (!isObj(g)) { skip('no geometry'); return; }
    const props = isObj(f.properties) ? f.properties : {};
    const own = unpack(props.earthplotter);
    const mine = isObj(own) ? own : null;
    if (typeof g.type !== 'string') { skip('geometry type: not text'); return; }
    const parts = g.type === 'GeometryCollection' ? null : g.type.startsWith('Multi')
      ? (Array.isArray(g.coordinates) ? g.coordinates.map((coordinates) => ({ type: g.type.slice(5), coordinates })) : [])
      : [g];
    if (!parts) { skip('a geometry collection: not read'); return; }
    parts.forEach((part, k) => {
      if (doc.groups.length + doc.points.length + doc.circles.length + doc.lines.length + doc.labels.length >= MAX_FEATURES) { over++; return; } // a Multi geometry: each part an element
      const kind = (mine?.kind === 'label' || mine?.kind === 'circle') && part.type === 'Point' ? mine.kind : { Point: 'point', LineString: 'line', Polygon: 'line' }[part.type];
      if (!kind) { skip(`geometry ${String(part.type).slice(0, 20)}: not read`); return; }
      const el = attempt(kind, fid, (c) => {
        const id = idOf(k ? null : f.id, c);
        const x = { ...commonOf({ ...propertiesFrom(props, mine, c), visible: mine?.visible }, c), id, groupId: typeof idIn(mine?.group) === 'string' ? idIn(mine.group) : null }; // checked once all are read
        x.look = look(mine?.look, c, kind, kind === 'label' ? null : styleFrom(props)); // its colours, opacities and width: the common style names, checked and filtered with its look
        if (kind !== 'label') x.guide = flag(mine?.guide, c, 'guide');
        if (kind !== 'label' && flag(mine?.measure, c, 'measure')) Object.assign(x, { guide: true, measure: true }); // a measurement: a guide of its own
        return READ[kind](part.coordinates, mine || {}, x, c, { foreign: !mine, closed: part.type === 'Polygon' });
      });
      if (el && mine?.frame !== undefined) rawFrames.set(el.id, unpack(mine.frame));
      positions += el?.points?.length ?? 0; // a line's
      if (positions > MAX_TOTAL_POSITIONS) throw new Refused(`This file holds more than ${MAX_TOTAL_POSITIONS.toLocaleString('en')} positions in its lines: it would stall the page at every change.`);
      if (el) doc[KIND[kind].list].push(el);
    });
  }); } catch (e) { if (!(e instanceof Refused)) throw e; report.refused = e.message; return { doc: null, view: null }; }

  if (over) report.warnings.push(`${over} past the first ${MAX_FEATURES} elements and groups: skipped`);
  // the elements all in: indexed while what holds each, then the frames and the links, are read (none
  // is added or taken away; reading() looks each up by ID, not along every list)
  reading(doc, () => {
    // what holds each: one of the drawing's groups, or (a shape: a circle, a line) one of its points
    for (const { kind, el } of elements(doc)) {
      if (kind === 'group' || el.groupId == null || canHold(doc, el.groupId, el.id)) continue;
      report.warnings.push(`${kind} ${el.id}: group ${el.groupId.slice(0, 64)} not found; now standalone`);
      el.groupId = null;
    }
  });
  reading(doc, () => { // indexed again: a group cleared above is not in the index any more
    // a point's shapes: where their frames about it say (a frame wins, as a link does: a position more than
    // 10⁻⁶° from it goes there, counted); one without a valid frame gets one from where it is
    let reframed = 0;
    for (const kind of ['circle', 'line']) {
      for (const el of doc[KIND[kind].list]) {
        const p = holderOf(doc, el), raw = rawFrames.get(el.id), n = positionsIn(kind, el).length;
        if (!p) { if (raw !== undefined) report.warnings.push(`${kind} ${el.id}: a frame, but no point holds it; ignored`); continue; }
        const ok = isObj(raw) && Array.isArray(raw.places) && raw.places.length === n && raw.places.every((q) => Array.isArray(q) && fin(q[0]) && fin(q[1]) && q[1] >= 0)
          && (kind === 'line' || fin(raw.turn));
        if (!ok) { if (raw !== undefined) report.warnings.push(`${kind} ${el.id}: frame not read; made from where it is`); adopt(p, kind, el); continue; }
        const in180 = (a) => (a >= -180 && a < 180 ? a : norm180(a)), in360 = (a) => (a >= 0 && a < 360 ? a : norm360(a)); // as written, unless out of range
        el.frame = { places: raw.places.map((q) => [in180(q[0]), q[1]]), ...(kind === 'circle' ? { turn: in360(raw.turn) } : {}) };
        const f = framed(p, el);
        positionsIn(kind, el).forEach(([o, k], i) => { if (!samePosition(o[k], f.places[i])) { o[k] = f.places[i]; reframed++; } });
        if (kind === 'circle' && Math.abs(norm180(el.bearing - f.bearing)) > 1e-3) { el.bearing = f.bearing; reframed++; }
      }
    }
    if (reframed) report.warnings.push(`${reframed} place${reframed > 1 ? 's' : ''} of shapes moved to where ${reframed > 1 ? 'their points hold them' : 'its point holds it'} (the file was edited elsewhere)`);

    // links, once every element is in: the link wins, its vertex goes where its target is. One from a
    // vertex that is not here, or to what is not (or to its own element), or a line's vertex to what is
    // neither a point nor a point's shape, or a vertex of a point's shape, is dropped: the vertex stays
    // free where the geometry says
    const was = [];
    const linked = new Set(); // the places linked so far (one link a place)
    for (const v of Array.isArray(app?.links) ? app.links : []) {
      const f = isObj(v) && Array.isArray(v.from) ? [idIn(v.from[0]), v.from[1]] : [], to = refIn(unpack(v?.to)), x = typeof f[0] === 'string' && find(doc, f[0]);
      const place = x && ((x.kind === 'line' && !holderOf(doc, x.el)) || x.kind === 'label') && Number.isInteger(f[1]) && placeAt(doc, f);

      const what = !place ? `from ${String(f[0]).slice(0, 64)} ${String(f[1]).slice(0, 8)}, which is not a line's or a label's place here`
        : !to ? 'to nothing it can point at' : to.element === f[0] ? 'to its own element' : linked.has(`${f[0]} ${f[1]}`) ? 'from a place already linked'
          : !targetPosition(doc, to) ? `to ${String(to.element).slice(0, 64)}, which is not here (or has no such vertex or edge)`
            : x.kind === 'line' && !lineTarget(doc, to) && `from a line's place to ${String(to.element).slice(0, 64)}, which is neither a point nor a point's shape`;
      if (what) { report.warnings.push(`link ${what}: dropped`); continue; }
      doc.links.push({ from: [f[0], f[1]], to });
      linked.add(`${f[0]} ${f[1]}`);
      was.push([f, [...place]]);
    }
    refreshAttached(doc);
    const moved = was.filter(([f, p]) => !samePosition(p, placeAt(doc, f))).length; // more than the file's rounding
    if (moved) report.warnings.push(`${moved} place${moved > 1 ? 's' : ''} moved to what ${moved > 1 ? 'they are' : 'it is'} linked to (the file was edited elsewhere)`);
  });

  // rules: what Distribute along and Connect keep linked, checked loosely (a reference gone is dropped at
  // the next change)
  const idList = (v) => (Array.isArray(v) ? v.filter((y) => typeof y === 'string' && ID.test(y)) : []);
  const ref = (v) => (typeof v === 'string' && ID.test(v) ? v : null);
  for (const x of Array.isArray(app?.rules) ? app.rules : []) {
    const r = attempt('rule', x?.id, (c) => {
      if (!isObj(x) || !ref(x.id) || taken.has(x.id)) c.skip('no valid ID');
      if (x.kind !== 'distribute' && x.kind !== 'connect') c.skip(`unknown kind "${String(x.kind).slice(0, 20)}"`);
      if (x.kind === 'distribute') {
        const along = isObj(x.along) ? ref(x.along.element) : null;
        if (!along) c.skip('nothing it is along');
        taken.add(x.id);
        return { id: x.id, kind: 'distribute', groupId: ref(x.groupId), copiesId: ref(x.copiesId), along: { element: along }, ...settings(x), pointIds: idList(x.pointIds) };
      }
      taken.add(x.id);
      return { id: x.id, kind: 'connect', groupId: ref(x.groupId), ...connectSettings({ ...x, roots: Array.isArray(x.roots) ? x.roots.filter((r) => isObj(r) && ref(r.id)) : [] }), pointIds: idList(x.pointIds),
        created: idList(x.created) };
    });
    if (r) doc.rules.push(r);
  }
  return { doc, view };
}

// a feature's name and the user's properties (a description, a category: properties like any other):
// the app's own list when it wrote one (keys a GIS column could not hold), else the feature's other
// properties, as text. A feature from elsewhere (no `earthplotter` of the app's) may say its name as Name or
// title; the app's own features only as name (a user's property "title" stays one)
function propertiesFrom(props, mine, c) {
  const pick = (...keys) => keys.map((k) => props[k]).find((v) => v != null);
  const asText = (v) => (typeof v === 'string' ? v : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const aliases = mine ? [] : ['Name', 'title'];
  const list = Array.isArray(unpack(mine?.properties)) ? unpack(mine.properties)
    : Object.entries(props).filter(([k]) => !FILE_PROPERTIES.includes(k) && !aliases.includes(k)).map(([key, value]) => ({ key, value: asText(value) }));
  return { name: text(pick('name', ...aliases) ?? '', c, 'name'), properties: list };
}
// name, properties, visible, as elements and groups have them
function commonOf(x, c) {
  if (x.visible !== undefined && typeof x.visible !== 'boolean') c.warn('visible is not true or false; true used');
  return { name: text(x.name, c, 'name'), properties: properties(x.properties, c), visible: x.visible !== false };
}
// an element's own colours, opacities and stroke width from the common style names, as look parts
// (unchecked: check.js look checks them with its look), or null
function styleFrom(props) {
  const s = {};
  const put = (part, field, v) => { if (v !== undefined) (s[part] ??= {})[field] = v; };
  put('stroke', 'color', props.stroke); put('stroke', 'width', props['stroke-width']); put('stroke', 'opacity', props['stroke-opacity']);
  put('fill', 'color', props.fill); put('fill', 'opacity', props['fill-opacity']);
  return Object.keys(s).length ? s : null;
}
const coord = (p, c, what) => position(Array.isArray(p) ? p.slice(0, 2) : p, c, what);

// a link's target as the file says it ({ element, vertex | edge and at }; a bare ID: an element's
// centre), or null
function refIn(v) {
  if (typeof idIn(v) === 'string') return { element: idIn(v) };
  if (!isObj(v) || typeof idIn(v.element) !== 'string') return null;
  v = { ...v, element: idIn(v.element) };
  const n = (k) => (Number.isInteger(v[k]) && v[k] >= 0 ? v[k] : undefined);
  return n('vertex') === undefined && n('edge') === undefined ? { element: v.element }
    : targetOf({ element: v.element, vertex: n('vertex'), edge: n('edge'), at: fin(v.at) ? Math.min(1, Math.max(0, v.at)) : 0 });
}
// each kind's reader: (coordinates, the app's own, the element so far, ctx, state) → element
const READ = {
  point(coords, mine, x, c, { foreign }) {
    const p = { ...x, position: coord(coords, c, 'position'), bearing: angle(mine.bearing, c, 'bearing') };
    const dflt = foreign ? 'diamond' : 'none'; // a point from another tool: a diamond, to be seen
    p.symbol = oneOf(mine.symbol, SYMBOLS, dflt, c, 'symbol');
    return p;
  },
  // a circle (a sector with an aperture): its radius above 0 and below 10 000 km, or it is skipped
  circle(coords, mine, x, c) {
    if (!fin(mine.radius) || mine.radius <= 0 || mine.radius >= MAX_RADIUS) c.skip('radius not between 0 and 10 000 km');
    const a = aperture(mine.aperture, c);
    return { ...x, position: coord(coords, c, 'position'), radius: mine.radius, aperture: a, bearing: angle(mine.bearing, c, 'bearing') };
  },
  // a LineString, or a Polygon's outer ring (closed): its first vertex not repeated at its end
  line(coords, mine, x, c, { closed }) {
    if (closed) {
      if (!Array.isArray(coords) || !Array.isArray(coords[0])) c.skip('no ring');
      if (coords.length > 1) c.warn('holes are not read; the outer ring only');
      coords = coords[0];
    }
    const few = closed ? 'a ring needs three positions' : 'a line needs two positions';
    if (!Array.isArray(coords)) c.skip(few);
    if (coords.length > MAX_POSITIONS) c.skip(`more than ${MAX_POSITIONS} positions`);
    let points = coords.map((q, k) => coord(q, c, `position ${k + 1}`));
    if (closed && points.length > 1 && samePosition(points[0], points.at(-1))) points = points.slice(0, -1);
    if (points.length < (closed ? 3 : 2)) c.skip(few);
    if (closed && mine.reversed === true) points.reverse();
    const names = Array.isArray(mine.names) ? mine.names : [];
    return { ...x, points, names: points.map((_, k) => text(names[k], c, `place ${k + 1} name`)), smooth: flag(mine.smooth, c, 'smooth'), closed };
  },
  label(coords, mine, x, c) {
    const o = mine.offset;
    const offset = Array.isArray(o) && o.length >= 2 && fin(o[0]) && fin(o[1]) ? [Math.max(-MAX_LABEL_OFFSET, Math.min(MAX_LABEL_OFFSET, o[0])), Math.max(-MAX_LABEL_OFFSET, Math.min(MAX_LABEL_OFFSET, o[1]))]
      : (o !== undefined && c.warn('offset: not [x, y] pixels, the default used'), [...LABEL_OFFSET]);
    // a label has no name: it goes by its text (one in the file is dropped, as its guide is)
    return { ...x, name: '', text: text(mine.text, c, 'text'), position: coord(coords, c, 'position'), offset, leader: oneOf(mine.leader, LEADERS, 'arrow', c, 'leader') };
  },
};

// ---- writing ---------------------------------------------------------------------------------

const r7 = (v) => +v.toFixed(7), r3 = (v) => +v.toFixed(3), r4 = (v) => +v.toFixed(4), r2 = (v) => +v.toFixed(2), r1 = (v) => +v.toFixed(1);
// a link's target as the file has it: an edge's at only when it is not 0 (the default), to 6 decimals
const refOut = ({ at, ...to }) => { const a = at && +at.toFixed(6); return a ? { ...to, at: a } : to; };
const pos = (p) => [r7(norm180(p[0])), r7(p[1])]; // a click past ±180° is kept as the map has it, written in range (§2)
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// o without the fields equal to their defaults d; an object field against an object default field by
// field, left out when nothing in it differs
function lean(o, d) {
  const out = {};
  for (const [k, v] of Object.entries(o)) {
    if (!(k in d)) out[k] = v;
    else if (isObj(v) && isObj(d[k])) { const sub = lean(v, d[k]); if (Object.keys(sub).length) out[k] = sub; } else if (!sameJson(v, d[k])) out[k] = v;
  }
  return out;
}
// the user's properties as GIS columns (features.js), their keys checked against the file's own
const columns = (list) => columnsOf(list, FILE_PROPERTIES);
// A look as the file has it: what it sets, numbers rounded. simple: an element's, whose colours,
// opacities and stroke width are the common style names (styleNames), not here.
function lookOut(l, simple = false) {
  const out = {};
  for (const part of ['fill', 'stroke']) {
    const v = Object.fromEntries(Object.entries(l[part] ?? {}).filter(([k]) => !simple || k === 'dash').map(([k, x]) => [k, typeof x === 'number' ? r3(x) : x]));
    if (Object.keys(v).length) out[part] = v;
  }
  if (l.text && Object.keys(l.text).length) out.text = { ...l.text };
  if (l.offset != null) out.offset = r3(l.offset);
  if (l.scale != null) out.scale = r3(l.scale);
  return out;
}
// an element's own colours, opacities and stroke width as the common style names
function styleNames(st) {
  const o = {};
  if (st.stroke?.color) o.stroke = st.stroke.color;
  if (st.stroke?.width !== undefined) o['stroke-width'] = r3(st.stroke.width);
  if (st.stroke?.opacity !== undefined) o['stroke-opacity'] = r3(st.stroke.opacity);
  if (st.fill?.color) o.fill = st.fill.color;
  if (st.fill?.opacity !== undefined) o['fill-opacity'] = r3(st.fill.opacity);
  return o;
}

// A point's shape's frame as the file has it: about its point as the file writes the point (its
// position to 7 decimals, its bearing to 4), so that the file read gives the shape where it is
// written, however far from its point; degrees to 7 decimals, metres to 4
function frameOut(kind, el, p) {
  const x = { ...el };
  adopt({ position: pos(p.position), bearing: r4(p.bearing) }, kind, x);
  return { places: x.frame.places.map(([a, d]) => [r7(a), r4(d)]), ...(x.frame.turn != null ? { turn: r4(x.frame.turn) } : {}) };
}
// one element as a Feature
function feature(kind, el, doc) {
  const { out: cols, changed } = columns(el.properties);
  const props = Object.assign(Object.create(null), kind === 'label' ? {} : lean({ name: el.name }, { name: '' })); // no prototype: a column named __proto__ is set, not the prototype; a label has no name
  Object.assign(props, cols, kind === 'label' ? {} : styleNames(el.look));
  const mine = { kind, ...(changed ? { properties: el.properties.map((p) => ({ ...p })) } : {}),
    ...lean({ group: el.groupId, visible: el.visible, guide: el.guide ?? false, measure: !!el.measure, look: lookOut(el.look, kind !== 'label') }, { group: null, visible: true, guide: false, measure: false, look: {} }) };
  if (el.frame) mine.frame = frameOut(kind, el, holderOf(doc, el)); // a point's shape: in its frame (§7.2)
  let geometry;
  if (kind === 'point') {
    geometry = { type: 'Point', coordinates: pos(el.position) };
    Object.assign(mine, lean({ symbol: el.symbol, bearing: r4(el.bearing) }, { symbol: 'none', bearing: 0 }));
  } else if (kind === 'circle') {
    geometry = { type: 'Point', coordinates: pos(el.position) };
    Object.assign(mine, { radius: Math.min(r3(el.radius), MAX_RADIUS - 0.001) }, lean({ aperture: el.aperture && Math.min(r4(el.aperture), 359.9999), bearing: r4(el.bearing) }, { aperture: null, bearing: 0 }));
  } else if (kind === 'line') {
    // closed: a Polygon, counter-clockwise as RFC 7946 asks; a ring stored clockwise is written
    // reversed, and says so (its names stay in its own order)
    const cw = el.closed && lonLatArea2(el.points) < 0, pts = cw ? el.points.slice().reverse() : el.points;
    geometry = el.closed ? { type: 'Polygon', coordinates: [[...pts, pts[0]].map(pos)] } : { type: 'LineString', coordinates: pts.map(pos) };
    Object.assign(mine, lean({ smooth: el.smooth, reversed: cw }, { smooth: false, reversed: false }));
    if (el.names.some(Boolean)) mine.names = [...el.names];
  } else {
    geometry = { type: 'Point', coordinates: pos(el.position) };
    Object.assign(mine, lean({ text: el.text, offset: [r3(el.offset[0]), r3(el.offset[1])], leader: el.leader }, { text: '', offset: LABEL_OFFSET, leader: 'arrow' }));
  }
  return { type: 'Feature', id: el.id, geometry, properties: { ...props, earthplotter: mine } };
}

// The document as the file's object (with the view it is in: the map's, page state the file carries):
// a FeatureCollection, what differs from the defaults, rounded as the format says.
export function toFile(doc, v = null) {
  const app = lean({
    format: FORMAT, version: VERSION, created: doc.created, modified: doc.modified,
    meta: lean(doc.meta, META_D),
    view: v ? lean({ center: v.center && pos(v.center), zoom: v.zoom === null ? null : r2(v.zoom), bearing: r1(v.bearing), layers: v.layers && v.layers.map((l) => ({ ...l })), // zoom and bearing as the address keeps them, which applies a file's view
      // data always written ({} when nothing is chosen), so a reader gets an object and the app clears its data layers
      data: v.data ? lean({ colour: v.data.colour && { ...v.data.colour }, arrows: v.data.arrows && { ...v.data.arrows }, time: v.data.time, depth: v.data.depth }, VIEW_DATA_D) : {},
      units: v.units, bearings: v.bearings === true }, VIEW_D) : null,
    look: lookOut(doc.look),
    groups: doc.groups.map((g) => lean({ id: g.id, groupId: g.groupId, name: g.name, properties: g.properties.map((p) => ({ ...p })), visible: g.visible },
      { groupId: null, name: '', properties: [], visible: true })),
    rules: doc.rules.map((a) => (a.kind === 'distribute'
      ? lean({ ...a, along: { element: a.along.element }, spacing: a.spacing == null ? null : r3(a.spacing), radius: a.radius == null ? null : r3(a.radius),
        aperture: a.aperture == null ? null : Math.min(r4(a.aperture), 359.9999), startMargin: r3(a.startMargin), endMargin: r3(a.endMargin), offset: r3(a.offset), pointIds: [...a.pointIds] }, DISTRIBUTE_D)
      : lean({ ...a, roots: a.roots.map((r) => (r.weight === 1 ? { id: r.id } : { id: r.id, weight: +r.weight.toPrecision(6) })), pointIds: [...a.pointIds], created: [...a.created] }, CONNECT_D))),
    links: doc.links.map((l) => ({ from: [...l.from], to: refOut(l.to) })),
  }, { meta: {}, view: null, look: {}, groups: [], rules: [], links: [] });
  return { type: 'FeatureCollection', earthplotter: app, features: KINDS.filter((k) => k !== 'group').flatMap((k) => doc[KIND[k].list].map((el) => feature(k, el, doc))) };
}
// The file's text: indented JSON, with each pair of numbers (a position) on one line. Only
// the indentation's line breaks are matched: a string never holds one (JSON writes it \n).
export function serialise(doc, view = null) {
  return `${JSON.stringify(toFile(doc, view), null, 2).replace(/\[\n\s*(-?[\d.e+-]+),\n\s*(-?[\d.e+-]+)\n\s*\]/g, '[$1, $2]')}\n`;
}
