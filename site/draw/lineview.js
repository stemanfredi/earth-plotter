// A line in Properties (drawing-ui.md §5): its table of vertices (legs typed, a page at a time), its
// elevation profile, the line inspector. Built by panel.js with the inspector's parts (kit).

import { h, svg } from '../dom.js';
import { find, linkFrom, fewestPlaces, holderOf } from './document.js';
import { insertVertex, deleteVertex, reattach, splitLine, along } from './attach.js';
import { lineTrace, nearestAlong } from './lines.js';
import { profileCsv } from './profile.js';
import { inverse, destination } from '../geodesy.js';
import { norm360 } from '../geo.js';
import { choice, check } from '../fields.js';
import { MOD } from '../keys.js';
import { listGrid, setCurrent } from './grid.js';
import { fmtArea, fmtDist, fmtElevation, distText, UNIT_TEXT, inUnit } from '../format.js';

export function createLineView(kit) {
  const { drawing, map, ctx, F, field, row, funit, fvalue, valued, distValue, link, now, set, item, foldHead, section, actionsRow, act, copyBtn, paged, PAGE, pageAt,
    attachBtn, detach, commonTop, commonBottom, lookBlock, ruleActs, libraryBtn, openDistribution, inspector, render: renderInspector } = kit;
  // Legs typed (the line's table of vertices): the straight leg arriving at a vertex from the one before
  // (a closed line's first: from its last), its length and its bearing. A value typed moves that
  // vertex alone (the leg after it changes with it); a vertex attached is where it is attached, its leg not
  // typed.
  const legOf = (ps, k) => { const g = inverse(ps.at(k - 1), ps[k]); return { s: g.s, azi: norm360(g.azi) }; };
  const legTo = (ps, k, { s: len, azi }) => { const g = legOf(ps, k); return destination(ps.at(k - 1), azi ?? g.azi, len ?? g.s); };
  const setLeg = (id, k, v) => set(id, (x) => { x.points[k] = legTo(x.points, k, v); });
  // a line's vertices, read once per rendering of the inspector (each row's leg reads them)
  const placesRead = new Map();
  const placesNow = (id) => { if (!placesRead.has(id)) placesRead.set(id, now(id).points); return placesRead.get(id); };
  // a leg's two fields in a table: the length in the column's unit (a number to the metre), the bearing to a tenth
  const legFields = (id, k, what, unit) => [
    F.dist(() => legOf(placesNow(id), k).s, (m) => setLeg(id, k, { s: m }), `${what} ${k + 1} leg length`, { in: unit }),
    F.angle(() => legOf(placesNow(id), k).azi, (a) => setLeg(id, k, { azi: a }), `${what} ${k + 1} leg bearing (degrees true)`, { fixed: 1 })];
  // a vertex of a line added halfway to the next (a closed line's last: to its first), one taken away
  // (attach.js: while it keeps enough)
  const insertAfter = (id, k) => drawing.change((doc) => { const ps = find(doc, id).el.points; insertVertex(doc, id, k + 1, along(ps[k], ps[(k + 1) % ps.length], 0.5)); });
  const removeAt = (id, k) => drawing.change((doc) => deleteVertex(doc, id, k));
  // a table of vertices' first columns; with its leg and bearing 304 px, inside Properties' 320
  // with a scroll bar: degrees in 6 decimals, distances to the metre (up to 999 km), bearings to a tenth
  const PLACE_COLUMNS = [{ head: '#', width: 28, cls: 'num' }, { head: 'Lat', width: 80, cls: 'n' }, { head: 'Lon', width: 88, cls: 'n' }];
  // A line's table of vertices, a page of them shown: #, Lat, Lon, the leg from the vertex before and its
  // bearing, in unit; rowAt(k): vertex k's cells; actions(k), insert(k), remove(k); copy: every row
  // (copyBtn). Its row current is ringed on the map.
  function placesTable(id, total, { unit, copy, rowAt, actions, insert, remove }) {
    const pg = paged(`${id}:points`, total), abs = (r) => pg.rows[r];
    const table = listGrid({ name: pg.name,
      columns: [...PLACE_COLUMNS, { head: `Leg ${UNIT_TEXT[unit]}`, width: 56, cls: 'n', title: 'From the vertex before' }, { head: 'Brg °T', width: 52, cls: 'n', title: 'Its bearing' }],
      rows: pg.rows.map(rowAt), actions: (r) => actions(abs(r)), keys: { insert: (r) => insert(abs(r)), remove: (r) => remove(abs(r)) },
      current: (r) => drawing.setPlace(r == null ? null : { id, index: abs(r) }) });
    return section('Vertices', `Vertices (${total})`, { extras: [copyBtn(copy)], tip: 'A row clicked is ringed on the map' }, table, pg.pager);
  }
  // a table's distances: one unit for the column (its head says it), by the rule a field's value
  // follows (format.js distText): metres while its largest is under 1 km, else km; NM in NM
  const unitOf = (ms) => (drawing.units() === 'nm' ? 'nm' : ms.every((m) => !(Number.isFinite(m) && m >= 1000)) ? 'm' : 'km'); // every: a long line's legs are more than Math.max(...) takes
  // line id's table of vertices: its row k made current (k: the vertex's index), the table at its page;
  // from the map (a vertex pressed: drawing.currentPlace)
  function pickPlace(id, k) {
    const table = `${id}:points`, from = k - (k % PAGE), name = `${table}@${from}`;
    pageAt.set(table, from);
    setCurrent(name, k - from);
    renderInspector();
    inspector.querySelector(`[data-grid="${CSS.escape(name)}"] tr[data-r="${k - from}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  // ---- a line's elevation profile (profile.js): a folding section, read when opened, read again as
  // the line changes; pointing at the chart shows the place on the map, pointing at the line on the
  // map shows it on the chart
  const profiles = new Map(); // line id → { key (its trace), prof (null while being read), failed }
  const profileShown = new Set();
  let profileCursor = null; // (d: metres along, or null) → the chart's cursor there
  // the chart gone (closed, the line no longer selected, the inspector built anew): its mark too
  const dropProfileCursor = () => { profileCursor?.(null); profileCursor = null; };
  let profileBuilt = 0;
  const W = 360, H = 110;
  function profileBlock(id) {
    const el = now(id), u = drawing.units();
    const open = profileShown.has(id);
    const head = foldHead('Elevation profile', open, () => { if (open) profileShown.delete(id); else profileShown.add(id); renderInspector(); });
    if (!open) return h('div', { class: 'fblock' }, head);
    const tr = lineTrace(drawing.doc, el), key = JSON.stringify(tr.coords);
    let p = profiles.get(id);
    if (!p || p.key !== key) {
      const mine = { key, prof: null, failed: false };
      profiles.set(id, p = mine);
      ctx.profile(tr).then((prof) => { mine.prof = prof; }, () => { mine.failed = true; })
        .then(() => { if (profiles.get(id) === mine && drawing.sel.size === 1 && drawing.sel.has(id)) renderInspector(); });
    }
    if (p.failed) profiles.delete(id); // said once; read again the next time it is shown
    if (!p.prof) return h('div', { class: 'fblock' }, head, h('p', { class: 'note' }, p.failed ? 'The elevation could not be read.' : 'Reading the elevation…'));
    const { pts, surface, length, lowest, highest } = p.prof;
    if (!lowest) return h('div', { class: 'fblock' }, head, h('p', { class: 'note' }, 'No elevation along this line (no data).'));
    // the chart: from the lowest to the highest, along the line; sea level in it (and its line) where the
    // line goes below it
    const sea = lowest.z < 0, top = sea ? Math.max(highest.z, 0) : highest.z, bottom = Math.min(lowest.z, top - 1);
    const X = (d) => (length ? (d / length) * W : 0), Y = (z) => ((top - z) / (top - bottom)) * (H - 14) + 4;
    const range = `${fmtElevation(lowest.z)} to ${fmtElevation(highest.z)}`;
    const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'profile', role: 'img', 'aria-label': `Elevation along the line, ${range}` });
    if (sea) chart.append(svg('line', { x1: 0, x2: W, y1: Y(0), y2: Y(0), class: 'psurface' }));
    let run = [];
    const flush = () => { if (run.length > 1) chart.append(svg('polyline', { points: run.join(' '), class: 'pline' })); run = []; };
    for (const x of pts) { if (Number.isFinite(x.z)) run.push(`${X(x.d).toFixed(1)},${Y(x.z).toFixed(1)}`); else flush(); }
    flush();
    for (const x of [lowest, highest]) chart.append(svg('circle', { cx: X(x.d), cy: Y(x.z), r: 2.5, class: 'pend' }));
    const cursor = svg('line', { y1: 0, y2: H, class: 'pcursor', visibility: 'hidden' });
    chart.append(cursor);
    const at = fvalue('');
    const nearest = (d) => pts.reduce((a, b) => (Math.abs(b.d - d) < Math.abs(a.d - d) ? b : a));
    // the chart's cursor at d (metres along), and the place on the map; null: none (the map's mark
    // taken away only if it is this one's: a form's preview is not)
    let marked = false;
    profileCursor = (d) => {
      if (d == null) { cursor.setAttribute('visibility', 'hidden'); at.textContent = ''; if (marked) drawing.setPreview([]); marked = false; return; }
      marked = true;
      const x = nearest(d);
      cursor.setAttribute('x1', X(x.d)); cursor.setAttribute('x2', X(x.d)); cursor.setAttribute('visibility', 'visible');
      at.textContent = `${fmtDist(x.d, u)} · ${Number.isFinite(x.z) ? fmtElevation(x.z) : 'no data'}`;
      drawing.setPreview([x.p]);
    };
    chart.addEventListener('pointermove', (e) => { const r = chart.getBoundingClientRect(); profileCursor(((e.clientX - r.left) / r.width) * length); });
    chart.addEventListener('pointerleave', () => profileCursor(null));
    return h('div', { class: 'fblock', 'data-key': `profile ${++profileBuilt}` }, head, // profileCursor is this one's: never kept by morph
      row('Elevation', fvalue(range), at),
      chart,
      row('Length', fvalue(`${fmtDist(surface, u)} along the surface · ${fmtDist(length, u)} on the map`, { title: 'Along the surface, seabed and ground: a lower bound (relief finer than the data is not in it)' }),
      h('button', { type: 'button', class: 'small', title: 'The profile as a file', onclick: () => ctx.download(profileCsv(p.prof), `${(el.name || 'line').replace(/[^\p{L}\p{N}-]+/gu, '-')}-profile.csv`, 'text/csv') }, 'CSV')));
  }
  // pointing at a line on the map whose profile is shown: its place on the chart
  map.on('mousemove', (e) => {
    if (!profileCursor || drawing.sel.size !== 1) return;
    const id = [...drawing.sel][0], x = find(drawing.doc, id);
    if (x?.kind !== 'line' || !profileShown.has(id)) return;
    profileCursor(drawing.hitAt(e.point, 6).includes(id) ? nearestAlong(lineTrace(drawing.doc, x.el).coords, [e.lngLat.lng, e.lngLat.lat]) : null); // off the line: no mark
  });

  // a line: its length (closed: its area and perimeter), its path, its vertices, its profile
  function lineInspector(id) {
    const doc = drawing.doc, el = now(id), closed = !!el.closed, u = drawing.units();
    const line = lineTrace(doc, el), held = !!holderOf(doc, el); // a point's shape: rigid, its vertices attached to nothing
    const at = line.at;
    const splitAt = (k) => drawing.change((d) => splitLine(d, id, k));
    // Its vertices as rows, numbered 1 (its start) to N (its end): a page of them shown. Lat, Lon (one
    // linked: what to); the leg from the vertex before (a closed line's first: from its last; typed:
    // this vertex moves; an attached one's as it is); along, from the start; its name.
    const ps = el.points, N = ps.length, attached = (k) => linkFrom(doc, id, k)?.to;
    const end = (k) => !closed && (k === 0 || k === N - 1), legged = (k) => k > 0 || closed; // an open line's ends; a vertex with a leg to it
    const coord = (k, axis) => F.coord(axis, () => now(id).points[k][axis === 'lat' ? 1 : 0],
      (v) => set(id, (x) => { const p = x.points[k]; x.points[k] = axis === 'lat' ? [p[0], v] : [v, p[1]]; }), `Vertex ${k + 1} ${axis === 'lat' ? 'latitude' : 'longitude'}`, 6);
    const lu = unitOf(ps.map((_, k) => (legged(k) ? legOf(ps, k).s : 0)));
    const legCells = (k) => (attached(k) || held ? [fvalue(inUnit(legOf(ps, k).s, lu)), fvalue(legOf(ps, k).azi.toFixed(1))] : legFields(id, k, 'Vertex', lu)); // a point's shape: rigid, read only
    const name = (k) => field(() => now(id).names[k], (t) => t, (nv) => set(id, (x) => { x.names[k] = nv; }), { 'aria-label': `Vertex ${k + 1} name`, placeholder: 'name' });
    // the grid fits the panel's 320 px: #, Lat, Lon, the leg and its bearing; the row current says
    // how far along the line its point is, and holds its name, in the bar over the grid
    const alongText = (k) => funit(`${distText(at[k] || 0, drawing.units()).text} along`);
    const rowAt = (k) => ({ cells: [end(k) ? h('span', { title: k ? 'Its end' : 'Its start' }, `${k + 1}`) : `${k + 1}`,
        ...(attached(k) ? [link(attached(k).element), null] : held ? [fvalue(ps[k][1].toFixed(6)), fvalue(ps[k][0].toFixed(6))] : [coord(k, 'lat'), coord(k, 'lon')]),
        ...(legged(k) ? legCells(k) : [null, null])] });
    const pointRows = () => { const x = now(id), qs = x.points, t = lineTrace(drawing.doc, x).at;
      return [['#', 'Lat', 'Lon', 'Leg m', 'Brg °', 'Along m', 'Name'], qs.map((q, k) => { const g = legged(k) ? legOf(qs, k) : null; return [k + 1, q[1], q[0], g ? +g.s.toFixed(3) : '', g ? +g.azi.toFixed(1) : '', +(t[k] || 0).toFixed(3), x.names[k]]; })]; };
    return [...commonTop('line', id),
      ...(closed ? [row('Area', valued(fmtArea(line.area, u))), row('Perimeter', distValue(line.length))] : [row('Length', distValue(line.length))]),
      row('Path', choice('Path', [[false, 'Straight', 'Geodesics'], [true, 'Smooth', 'A curve through its bends']], !!el.smooth, (v) => set(id, (x) => { x.smooth = v; }))),
      // closed (three vertices or more) and opened again; what is linked to its legs stays where it is
      held ? null : row('Closed', check(closed, (v) => set(id, (x, d) => { x.closed = v; reattach(d, id); }), { 'aria-label': 'Closed', title: 'Its last vertex joined to its first: an area', disabled: !closed && N < 3 })),
      placesTable(id, N, { unit: lu, copy: pointRows, rowAt,
        actions: (k) => ({ label: end(k) ? (k ? `Vertex ${N}, its end` : 'Vertex 1, its start') : `Vertex ${k + 1}`,
          buttons: held ? [k ? alongText(k) : null, name(k)].filter(Boolean) // a point's shape: rigid, its form by its handles
            : [k ? alongText(k) : null, name(k), k < N - 1 || closed ? act('Insert after', 'Insert', () => insertAfter(id, k)) : null,
              act('Delete', `${MOD} Delete; ${closed ? 'three' : 'two'} are kept`, () => removeAt(id, k), N <= fewestPlaces(el)),
              end(k) ? null : act('Split', closed ? 'Opened here: its start and its end' : 'Two lines, attached here', () => splitAt(k)),
              attachBtn(id, k, { class: 'small', 'aria-label': `Attach vertex ${k + 1} to…` }, 'Attach to…'), attached(k) ? act('Detach', 'Free, where it is', () => detach(id, k)) : null].filter(Boolean) }),
        insert: (k) => { if (!held && (k < N - 1 || closed)) insertAfter(id, k); }, remove: (k) => { if (!held) removeAt(id, k); } }),
      profileBlock(id),
      actionsRow(ruleActs(id), h('button', { type: 'button', class: 'small', title: 'Copies along this line', onclick: () => openDistribution({ element: id }) }, 'Distribute along…'),
        held ? null : libraryBtn(id, el.name)), // a point's shape: the point is kept, with it
      lookBlock([item(id)]), ...commonBottom('line', id)];
  }

  // a radius typed: the file's one rule, 0 < r < MAX_RADIUS (the field refuses 0 itself); one reaching a
  // pole is applied, the inspector saying it is not drawn
  return { lineInspector, pickPlace, dropProfileCursor,
    readAgain: () => placesRead.clear(), // a new rendering: the lines' vertices read again
    // the profiles of lines gone
    forgetGone: (doc) => { for (const id of profiles.keys()) if (!find(doc, id)) { profiles.delete(id); profileShown.delete(id); } } };
}
