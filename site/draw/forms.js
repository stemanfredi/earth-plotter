// The rules' forms in Properties (drawing-ui.md §6): Distribute along and Connect, their previews on the
// map and a rule's Made by row (Edit…, Update, Select all). Built by panel.js with the inspector's
// parts (kit); the form open is this module's state.

import { h } from '../dom.js';
import { note, ask } from '../menu.js';
import { find, leavesOf, label } from './document.js';
import { DISTRIBUTE_D, distribute, lines, planConnection, makeDistribution, editDistribution, connect, reconnect, alongTrace, alongOf, distributions, connections, ruleOf, updateRule, MAX_COPIES, MAX_TREE } from './generator.js';
import { BUILT_IN, builtInName, itemFor, itemKey, keyName } from './place.js';
import { alone } from './clipboard.js';
import { reachOf } from './features.js';
import { choice, select } from '../fields.js';
import { hasShapes } from './library.js';
import { listGrid } from './grid.js';
import { fmtDist, plural } from '../format.js';
import { groupPath } from './tree.js';
import { row, pair, funit, fvalue, withUnit } from './rows.js';

export function createForms(kit) {
  const { drawing, map, F, section, distValue, link, now, tops, radiusCheck, selKey, setTitle, render: renderInspector } = kit;
  const connectBtn = (xs) => { const ids = xs.filter((x) => x.kind === 'point').map((x) => x.el.id); return ids.length > 1 ? h('button', { type: 'button', class: 'small', title: 'Lines from roots to these points', onclick: () => openConnect(ids) }, 'Connect…') : null; };
  const copies = (n) => `${n} ${n === 1 ? 'copy' : 'copies'}`;
  // a root no group is cheapest from, once made: said, as the form said it before
  const unusedRoots = (ids) => `Not used: ${ids.map((o) => label('point', now(o))).join(', ')} (no group is cheapest from it)`;
  // The rule an element was made by (generator.js ruleOf: a copy, a hub, a line, the rule's groups):
  // { row (what it made, a row at the top), acts (Edit…: its form; Select all: everything it made) },
  // or null
  // Update; a distribution whose copies would come to another number asks first, as Edit… warns: they
  // are made anew (changes made to them by hand lost, their connection made again)
  async function update(r) {
    const along = r.kind === 'distribute' && alongOf(drawing.doc, r.along.element), n = along && distribute(drawing.doc, along, r).points.length;
    if (along && n !== r.pointIds.length && !(await ask('Update', `${copies(n)} fit now, not ${r.pointIds.length}: they are made anew, and what was changed in them by hand is lost.`, [[() => true, 'Update']]))) return;
    drawing.change((d) => { updateRule(d, r.id); });
  }
  function ruleRow(id) {
    const doc = drawing.doc, r = ruleOf(doc, id);
    if (!r) return null;
    const live = (ids) => ids.filter((x) => doc.points.some((n) => n.id === x)).length;
    const along = r.kind === 'distribute' && find(doc, r.along.element);
    const text = r.kind === 'distribute' ? `Distribute along ${label(along.kind, along.el)} · ${copies(r.pointIds.length)}` // what it is along: there (a rule along nothing is dropped)
      : `Connection · ${r.pattern === 'chain' ? 'chains' : 'trees'}, ${plural(live(r.pointIds), 'point')} to ${plural(live(r.roots.map((o) => o.id)), 'root')}`;
    const all = () => drawing.select(tops(leavesOf(drawing.doc, [r.groupId])));
    return { row: row('Made by', fvalue(text, { title: text })),
      acts: [h('button', { type: 'button', class: 'small', title: 'Its settings', onclick: () => (r.kind === 'distribute' ? openDistribution(r.along, r) : openConnect(r.pointIds, r)) }, 'Edit…'),
        // made again with its settings, from what it was made from as it is now (a rule follows nothing by itself)
        h('button', { type: 'button', class: 'small', title: r.kind === 'distribute' ? 'Its copies placed again along it as it is now' : 'Planned again from its points and roots as they are now',
          onclick: () => update(r) }, 'Update'),
        h('button', { type: 'button', class: 'small', title: 'Everything it made', onclick: all }, 'Select all')] };
  }

  // ---- the tools' forms (generator.js): Distribute along a line or an arc; Connect points to roots
  // form: { kind: 'distribute', along ({ element }: the line, or the circle), distributionId } or
  // { kind: 'connect', pointIds, connectionId } (an id: the one edited or made again, or null), and the
  // selection it was opened with (another closes it)
  let form = null;
  const DFORM = { by: 'spacing', spacing: 1000, count: 10, startMargin: 0, endMargin: 0, offset: 0, side: 'left', radius: DISTRIBUTE_D.radius, aperture: null, item: 'circle', copy: null, groupId: null };
  const CON = { pattern: 'tree', groupSize: 'auto', minBranch: 0, roots: [], newRoots: [] };
  const dform = { ...DFORM }, con = { ...CON }; // a new form starts from these; one edited, from its rule's
  const dformParams = () => ({ spacing: dform.spacing, count: dform.by === 'count' ? dform.count : null, startMargin: dform.startMargin, endMargin: dform.endMargin, offset: dform.offset, side: dform.side, radius: dform.radius, aperture: dform.aperture, item: dform.item, copy: dform.copy, groupId: dform.groupId,
    along: form && { element: form.along.element } });
  const conParams = () => ({ pattern: con.pattern, groupSize: con.groupSize, minBranch: con.minBranch, roots: con.roots.map((r) => ({ ...r })), newRoots: con.newRoots.map((q) => [...q]) });
  function openForm(f) {
    drawing.stop(); // a click on the map now picks a root, not a tool's next point
    drawing.boxSelect(false);
    form = { ...f, sel: selKey() };
    drawing.setPicking(form.kind === 'connect' ? pick : null, true); // roots are picked on the map while Connect's is open
    formPreview();
    renderInspector();
  }
  function openDistribution(along, a = null) {
    Object.assign(dform, DFORM); // a new one: the defaults
    if (a) Object.assign(dform, { by: a.count ? 'count' : 'spacing', spacing: a.spacing || dform.spacing, count: a.count || a.pointIds.length, startMargin: a.startMargin, endMargin: a.endMargin,
      offset: a.offset, side: a.side, radius: a.radius, aperture: a.aperture, item: a.item ?? 'circle' });
    // a Library item's copies: its drawing (renamed or deleted since: a copy as placed), its size its own
    // (never a radius, which would make them circles)
    const first = a?.pointIds.find((id) => find(drawing.doc, id));
    if (a && keyName(a.item) !== null) dform.copy = itemFor(drawing.library.filter(hasShapes), a.item)?.doc ?? (first ? alone(drawing.doc, first) : null);
    openForm({ kind: 'distribute', along: { element: along.element }, distributionId: a?.id ?? null });
  }
  function openConnect(pointIds, c = null) {
    Object.assign(con, CON, c ? { pattern: c.pattern, groupSize: c.groupSize, minBranch: c.minBranch, roots: c.roots.map((r) => ({ ...r })) } : {}, { newRoots: [] });
    openForm({ kind: 'connect', pointIds: [...pointIds], connectionId: c?.id ?? null });
  }
  function closeForm() {
    form = null;
    drawing.setPicking(null);
    drawing.setPreview([]);
  }
  const distributionRun = () => distribute(drawing.doc, alongOf(drawing.doc, form.along.element), dformParams());
  // what Connect would make (plan() in generator.js keeps the last plan by its inputs: the preview and
  // the form, drawn in the same task, share it): { positions (in order), roots, plan }
  const connectPlan = () => { const { nodes, roots, plan: p } = planConnection(drawing.doc, { pointIds: form.pointIds, ...conParams() }); return { positions: nodes.map((n) => n.position), roots, plan: p }; };
  // what the form would make, faint on the map: a distribution's points; a connection's lines, its
  // roots ringed
  function formPreview() {
    if (form.kind === 'distribute') return drawing.setPreview(distributionRun().points.map((x) => x.position));
    const c = connectPlan();
    drawing.setPreview([], c.roots.map((r) => r.position), c.plan ? lines(c.positions, c.roots, c.plan, con.pattern) : []);
  }
  // a setting changed: the preview and the form follow
  const formChanged = () => { formPreview(); renderInspector(); };
  // a click on the map while roots are picked: on a point, it is a root or no longer one; anywhere
  // else, a new root there (on one, it goes)
  function pick(nid, pos) {
    if (nid) {
      if (form.pointIds.includes(nid)) return note('That point is one of those being connected');
      con.roots = con.roots.some((r) => r.id === nid) ? con.roots.filter((r) => r.id !== nid) : [...con.roots, { id: nid, weight: 1 }];
    } else {
      const near = con.newRoots.findIndex((q) => { const a = map.project(q), b = map.project(pos); return Math.hypot(a.x - b.x, a.y - b.y) < 12; });
      con.newRoots = near >= 0 ? con.newRoots.filter((_, i) => i !== near) : [...con.newRoots, pos];
    }
    formChanged();
  }
  const formButtons = (text, ok, onclick) => h('div', { class: 'frow fbuttons' },
    h('button', { type: 'button', class: 'done', disabled: !ok, onclick }, text),
    h('button', { type: 'button', onclick: () => { closeForm(); renderInspector(); } }, 'Cancel'));

  // the connection's settings (tree or chain, group size, roots and their weights) and what it would make
  function connectRows(c) {
    const u = drawing.units(), redo = formChanged, p = c.plan;
    const names = [...con.roots.map((r) => label('point', now(r.id))), ...con.newRoots.map((_, i) => `New root ${i + 1}`)];
    const sizes = p ? p.groups.map((g) => g.nodes.length) : [];
    const what = con.pattern === 'chain' ? 'chain' : 'tree';
    const summary = !c.roots.length ? 'Choose at least one root: click the map where the lines start (anywhere, or on a point).'
      : p ? `${sizes.length} ${what}${sizes.length > 1 ? 's' : ''} (${sizes.join(', ')}), ${new Set(p.groups.map((g) => g.root)).size} of ${plural(c.roots.length, 'root')} used; ${fmtDist(p.total, u)} of lines in all (straight; the cheapest cut).` : '';
    const unused = p ? p.unused.map((i) => names[i]) : [];
    const drop = (k) => () => { if (k < con.roots.length) con.roots = con.roots.filter((_, i) => i !== k); else con.newRoots = con.newRoots.filter((_, i) => i !== k - con.roots.length); redo(); };
    const weight = (k) => (k < con.roots.length
      ? F.number(() => con.roots[k].weight, (v) => { con.roots[k].weight = v; redo(); }, `Weight of ${names[k]}`, { above: true, title: 'Its pull' })
      : fvalue('1', { title: 'Set it once made' }));
    return [row('Pattern', choice('Tree or chain', [['tree', 'Tree', 'root → hub → each point'], ['chain', 'Chain', 'root → point → next point …']], con.pattern, (v) => { con.pattern = v; redo(); })),
      row('Group size', pair(choice('Group size', [['auto', 'Auto', `any size: the cheapest cut${con.pattern === 'tree' ? ` (trees of up to ${MAX_TREE})` : ''}`], ['set', 'Set', `points at most per ${what}`]], con.groupSize === 'auto' ? 'auto' : 'set', (v) => { con.groupSize = v === 'auto' ? 'auto' : 3; redo(); }), '',
        con.groupSize === 'auto' ? [] : F.number(() => con.groupSize, (v) => { con.groupSize = v; redo(); }, 'Group size', { whole: true, above: true, max: con.pattern === 'tree' ? MAX_TREE : Infinity, title: `Points at most per ${what}` }))),
      con.pattern === 'tree' ? row('Min. branch', withUnit(F.dist(() => con.minBranch, (m) => { con.minBranch = m; redo(); }, 'Shortest branch', { zero: true,
        title: 'A hub at least this far from its points' }))) : null,
      // the roots, a table: a point's name (a link), or a new root's place; its weight; × drops it
      section('Roots', `Roots (${c.roots.length})`, { tip: 'Click the map, or a point' },
        names.length ? listGrid({ name: 'roots', plain: true, head: true, columns: [{ head: 'Root', width: 170 }, { head: 'Weight', width: 70, cls: 'n', title: 'Its pull' }, { width: 40 }],
          rows: names.map((name, k) => ({ cells: [k < con.roots.length ? link(con.roots[k].id) : fvalue(name, { title: `${con.newRoots[k - con.roots.length][1].toFixed(5)}, ${con.newRoots[k - con.roots.length][0].toFixed(5)}` }),
            weight(k), h('button', { type: 'button', class: 'x', 'aria-label': `Drop ${name}`, title: 'Drop it', onclick: drop(k) }, '×')] })) }) : null),
      h('p', { class: 'note fsummary' }, summary, unused.length ? ` Not used: ${unused.join(', ')} (no group is cheapest from it; a weight above 1 would pull some).` : '')];
  }
  // Distribute along a line or a point's arc: one form, one undo step
  function distributionForm() {
    const doc = drawing.doc, along = find(doc, form.along.element), editing = form.distributionId && distributions(doc).find((a) => a.id === form.distributionId);
    const closed = alongTrace(doc, along.el).closed;
    const run = distributionRun(), points = run.points, redo = formChanged;
    // a distance that may be 0 (margins, the offset), or must be above 0 (spacing)
    const dist = (key, aria, zero) => withUnit(F.dist(() => dform[key], (m) => { dform[key] = m; redo(); }, aria, { zero }));
    const differs = editing && points.length !== editing.pointIds.length;
    const connected = differs && connections(doc).some((c) => c.pointIds.some((n) => editing.pointIds.includes(n)));
    // what is repeated: a built-in kind (the circle to start with), or a Library item (its size its own)
    const mine = drawing.library.filter(hasShapes);
    const choose = (v) => {
      dform.item = v;
      dform.copy = itemFor(mine, v)?.doc ?? null; // its point and shapes, as placed by hand
      redo();
    };
    const reach = dform.copy ? reachOf(dform.copy, dform.copy.points[0]) : null;
    const arc = along.kind === 'circle';
    setTitle(`${editing ? 'Edit, distributed along' : 'Distribute along'} ${label(along.kind, along.el)}`);
    return [
      row('By', choice('Points by', [['spacing', 'Spacing'], ['count', 'Count']], dform.by, (v) => { dform.by = v; redo(); })),
      dform.by === 'spacing' ? row('Spacing', dist('spacing', 'Spacing', false)) : row('Count', F.number(() => dform.count, (v) => { dform.count = v; redo(); }, 'Count', { whole: true, above: true, max: MAX_COPIES })),
      run.capped ? h('p', { class: 'note warn' }, `At most ${MAX_COPIES.toLocaleString('en')} copies: the spacing would give more`) : null,
      closed ? null : row('Margins', pair(dist('startMargin', 'Start margin', true), '·', dist('endMargin', 'End margin', true))),
      row('Offset', pair(dist('offset', 'Offset', true), '·', select('Side', [['left', arc ? 'Out' : 'Left'], ['right', arc ? 'In' : 'Right'], ['alternate', 'Alternate']], dform.side, (v) => { dform.side = v; redo(); }))),
      row('Copy', select('Copy', [...BUILT_IN.map((k) => [k, builtInName(k)]), ...mine.map((x) => [itemKey(x.name), x.name]),
        ...(dform.copy && !itemFor(mine, dform.item) ? [[dform.item, `${keyName(dform.item)} (as copied)`]] : [])], dform.item, choose, { title: 'What each copy is' })), // an item renamed or deleted since: its copy is kept
      dform.copy ? row('Radius', distValue(reach, { title: 'The item\'s own' }))
        : row('Radius', withUnit(F.dist(() => dform.radius, (m) => { dform.radius = m; redo(); }, 'Radius', { check: radiusCheck, title: dform.item === 'circle' ? 'Each circle\'s, whatever the spacing' : 'Its largest shape\'s reach, whatever the spacing' }))),
      dform.item === 'circle' ? row('Aperture', F.angle(() => dform.aperture, (v) => { dform.aperture = v; redo(); }, `Aperture (degrees): a sector ${arc ? 'facing outwards' : 'facing away from the line'}; empty or 360: a circle`, { wrap: false, none: true }), funit('°')) : null,
      editing ? null : row('In group', select('Group', [['', 'none (at the top)'], ...doc.groups.map((g) => [g.id, groupPath(drawing.doc, g)])], dform.groupId ?? '', (v) => { dform.groupId = v || null; }, { title: 'Where its group goes' })),
      h('p', { class: 'note fsummary' }, points.length ? `${copies(points.length)}.` : `No copy fits: ${arc ? 'the circle' : 'the line'} is shorter than the margins, or the spacing too long.`),
      differs ? h('p', { class: 'note warn' }, `Another number of points (${editing.pointIds.length} now): they are made anew${connected ? ', and connected again' : ''}. Changes made to those by hand are lost; Undo brings them back.`) : null,
      formButtons(editing ? 'Apply' : 'Create', points.length, () => {
        let r;
        const params = dformParams();
        closeForm(); // first: the change's rendering shows what was made, not the form again
        const made = drawing.change((d) => { r = editing ? editDistribution(d, editing.id, params) : makeDistribution(d, params); });
        if (r) drawing.select([r.distribution.groupId]); // drawn again if the selection changes
        if (!made) renderInspector(); // nothing changed (or refused): the form gone all the same
      })];
  }

  // Connect, for points placed by hand (and Connect again, for a connection so made)
  function connectForm() {
    const doc = drawing.doc;
    const editing = form.connectionId && connections(doc).find((c) => c.id === form.connectionId);
    const c = connectPlan();
    setTitle(`${editing ? 'Connect again' : 'Connect'} ${plural(c.positions.length, 'point')}`);
    return [editing ? h('p', { class: 'note warn' }, 'Its lines and hubs are made again; changes made to those by hand are lost (Undo brings them back).') : null,
      ...connectRows(c),
      formButtons(editing ? 'Connect again' : 'Connect', c.plan, () => {
        let r;
        const ids = form.pointIds, params = conParams();
        closeForm(); // first: the change's rendering shows what was made, not the form again
        const made = drawing.change((d) => { r = editing ? reconnect(d, editing.id, params) : connect(d, { pointIds: ids, ...params }); });
        if (r) drawing.select(r.connection.groupId ? [r.connection.groupId] : ids); // drawn again if the selection changes
        if (!made) renderInspector(); // nothing changed (or refused): the form gone all the same
        if (r?.unused.length) note(unusedRoots(r.unused));
      })];
  }

  // nothing selected: the drawing itself
  return { ruleRow, connectBtn, openDistribution, closeForm, formPreview,
    current: () => form, // the form open, or null
    view: () => (form.kind === 'distribute' ? distributionForm() : connectForm()) };
}
