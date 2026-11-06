// The drawing's panels (docs/drawing-ui.md): the tools in the bar (tools.js), the tree of the
// drawing's elements in the left panel (tree.js), and Properties in the right one, which shows what is selected (or, with nothing
// selected, the drawing itself) and edits it with fields. Fields apply on Enter or when they lose
// focus, one undo step each.

import { h, typing, morph, animate, NARROW } from '../dom.js';
import { ask, askText, note } from '../menu.js';
import { FINGER } from './layers.js';
import { find, elements, groupsOf, membersOf, leavesOf, canHold, label, KIND, lookOf, lookField, setLook, LOOK_FIELDS, SYMBOLS, LABEL_OFFSET, makeGroup, setGroup, moveStep, MAX_RADIUS, MAX_OFFSET, STROKE_WIDTH, TEXT_SIZE, SCALE, linkFrom, setLink, carry, holderOf, ringOf } from './document.js';
import { partName, lineRef, resolve } from './attach.js';
import { labelValues, labelText, TOKENS } from './labels.js';
import { totals, breakdown } from './lines.js';
import { connections } from './generator.js';
import { boundsOf, drawable } from './features.js';
import { inverse, areaOf, moveAbout } from '../geodesy.js';
import { norm180, norm360 } from '../geo.js';
import { fields, choice, select, check } from '../fields.js';
import { mac, MOD } from '../keys.js';
import { loadLibrary, saveLibrary, itemOf } from './library.js';
import { createDrawTab, itemNow, itemName } from './drawtab.js';
import { itemBase } from './place.js';
import { listGrid, forgetCurrent } from './grid.js';
import { fmtArea, fmtDist, rowsText, plural } from '../format.js';
import { fileGroup } from './files.js';
import { createTools } from './tools.js';
import { createTree, kindTitle, groupPath, eyeFor, shownName } from './tree.js';
import { createForms } from './forms.js';
import { createLineView } from './lineview.js';
import { icon, UI_ICON, SYMBOL_ICON } from '../icons.js';

const SYMBOL_TITLE = { diamond: 'Diamond', square: 'Square', triangle: 'Triangle', dot: 'Dot', none: 'None' };

// root: the left panel's Elements tab. ctx: { drawing, map, bar
// (the bar, its tools here), props (the right panel: the inspector), foot and dock (tools.js), frame (frame.js), outputs, offlineItem, copyLink(), about() (files.js),
// onImport(doc, view) (an imported document, the view it was made in), openDrawing(id), openArea(file), download(text, name), profile(trace) }
export function drawView(root, ctx) {
  const { drawing, map } = ctx;
  const F = fields({ note, units: drawing.units }), { field } = F; // fields.js: each applies on Enter or when left
  // a longitude past ±180° (clicked on a world copy) shown in range, as the file writes it: the field
  // would refuse it back
  const { coord, position } = F, inRange = (v) => (v == null ? v : norm180(v));
  F.coord = (axis, get, ...rest) => coord(axis, axis === 'lon' ? () => inRange(get()) : get, ...rest);
  F.position = (get, ...rest) => position(() => { const p = get(); return [inRange(p[0]), p[1]]; }, ...rest);
  let facts = null; // the totals: computed once per change, when the list or the inspector reads them
  let totalsBy = ''; // the drawing's totals by group (''), or by the values of a property (its key)
  const totalsFolded = new Set(); // the Totals view's groups folded (by key)
  const computeFacts = () => (facts = { totals: totals(drawing.doc), breakdown: breakdown(drawing.doc, totalsBy || null) });
  const fx = () => facts || computeFacts();

  drawing.library = loadLibrary();
  const files = fileGroup(drawing, ctx, () => libraryChanged());
  const tools = createTools(drawing, ctx, { del, fileBtns: files.buttons, drawsNow: () => itemBase(itemName(itemNow(drawing) ?? '')) }); // an item without its folder
  const { renderTools } = tools;
  // Draw (drawtab.js), the left panel's third tab: everything there is to draw, the Library's items among it; built only while seen
  const library = createDrawTab(drawing, ctx.drawTab, { frame: ctx.frame, changed: () => renderTools() });
  const libraryChanged = () => { renderTools(); library.render(true); };

  // ---- the tree (tree.js), its first row the drawing ------------------------------------------
  const tree = createTree(drawing, { facts: fx, drawingPicked: () => { if (NARROW.matches) ctx.frame.setProps(true); } }); // a phone: the drawing's row turns Properties on, showing it
  // the tree built only while it is seen (a large drawing's rows cost tens of ms per change); built
  // when its tab opens (render('tool'), after any change of the frame)
  let listStale = false;
  const listSeen = () => !root.closest('[hidden]');
  const renderList = () => { facts = null; listStale = !listSeen(); if (!listStale) tree.render(); };
  // the inspector's head: what it shows, the actions on it (renderHead), its fold
  let title = ''; // what the inspector shows, said in its head (set by the inspector built)
  const inspTitle = h('span', { class: 'ititle' }), inspActs = h('span', { class: 'iacts' });
  const inspHead = h('div', { class: 'dinsphead' }, inspTitle, inspActs);

  // ---- deleting -----------------------------------------------------------------------------
  async function del(ids) {
    const doc = drawing.doc;
    const groups = ids.filter((id) => find(doc, id)?.kind === 'group');
    let withMembers = false;
    const members = elements(doc).filter((x) => groupsOf(doc, x.el).some((g) => groups.includes(g.id))).length;
    if (members) {
      const a = await ask('Delete group', `The group${groups.length > 1 ? 's have' : ' has'} ${members} member${members > 1 ? 's' : ''}.`,
        [['all', 'Delete the group and everything in it'], ['ungroup', 'Delete the group only (members kept)']]); // the main button keeps the most
      if (!a) return;
      withMembers = a === 'all';
    }
    drawing.remove(ids, withMembers); // lines attached to a point deleted stay, their vertices free where they were
  }

  // ---- inspector: fields ----------------------------------------------------------------------
  const inspector = h('div', { class: 'dinspect' });
  // the element id as it is now (a field's closure keeps the id, never a stale object)
  const now = (id) => find(drawing.doc, id)?.el;
  const set = (id, fn) => drawing.change((doc) => fn(find(doc, id).el, doc));
  // A value grid's row (docs/drawing-ui.md §5): its label, its cell (one value or a pair, at most
  // one small button after it: never wrapping) and its last column, kept for a trailing × or ↺ so
  // nothing shifts when one appears. Without a label and with buttons only: an action row, which may
  // wrap.
  const isX = (k) => k?.tagName === 'BUTTON' && k.classList.contains('x');
  const row = (text, ...kids) => {
    kids = kids.flat().filter(Boolean);
    const last = isX(kids.at(-1)) ? kids.pop() : null;
    if (!text && kids.length && kids.every((k) => k.tagName === 'BUTTON')) return h('div', { class: 'frow' }, ...kids, last);
    return h('div', { class: 'frow vrow' }, h('span', { class: 'flabel' }, text), h('div', { class: 'vcell' }, ...kids), h('span', { class: 'vlast' }, last));
  };
  // two fields read as one value, side by side (a pair, §2), sep between them
  const pair = (a, sep, b) => h('span', { class: 'vpair' }, ...[a].flat(), h('span', { class: 'vsep' }, sep), ...[b].flat());
  const textField = (id, key, aria, area = false) => F.text(() => now(id)[key], (v) => set(id, (el) => { el[key] = v; }), aria, area ? 2 : 0);
  // a circle's centre: a held one's moves its point (its shapes with it), as a drag does
  const coordFields = (id, key) => { const [, lat, , lon] = F.position(() => now(id)[key], (p) => set(id, (el, doc) => { const n = holderOf(doc, el); if (n) carry(doc, n, moveAbout(el[key], p)(n.position)); else el[key] = p; }), '', 6); return row('Position', pair(lat, '·', lon)); };
  // a value's unit beside it, in grey (drawing-ui.md §5: never inside the text): a distance field's
  // (fields.js unitText), or a formatted value's ("10.08 km" → 10.08 · km)
  const funit = (t) => h('span', { class: 'funit' }, t);
  const withUnit = (input) => [input, funit(input.unitText())];
  const fvalue = (t, attrs = {}) => h('span', { class: 'fvalue', ...attrs }, t);
  const valued = (text, attrs = {}) => { const i = text.lastIndexOf(' '); return i < 0 ? [fvalue(text, attrs)] : [fvalue(text.slice(0, i), attrs), funit(text.slice(i + 1))]; };
  const distValue = (m, attrs = {}) => valued(fmtDist(m, drawing.units()), attrs);

  // The look of xs ({ kind, el }, one or several; a group: everything in it; the drawing: { kind:
  // 'drawing', el: doc }): each field what they are drawn with (document.js lookOf: their own value,
  // else the drawing's), "mixed" where they differ; a change sets it on each of them, ↺ takes it back.
  // A group has no look of its own: it reaches its members. Only the fields their kinds have (a line
  // no fill, a label its text, a shape its minimum size); fields: those to show, else all of those.
  // xs with each group replaced by its members (its subgroups' too), none twice; the drawing as it is
  const flat = (xs) => (xs[0]?.kind === 'drawing' ? xs : leavesOf(drawing.doc, xs.map((x) => x.el.id)));
  function lookBlock(xs, fields = null, title = 'Look', extra = []) {
    const doc = drawing.doc;
    xs = flat(xs);
    if (!xs.length && !extra.length) return null; // an empty group
    const has = (x, f) => LOOK_FIELDS[x.kind].includes(f) && !(f.startsWith('fill.') && x.kind === 'line' && !x.el.closed) // a line's fill: while it is closed
      && (f !== 'scale' || x.kind === 'drawing' || (!!holderOf(doc, x.el) && (x.kind === 'circle' || x.el.closed))); // a scale: a point's shapes'
    const shown = (f) => (!fields || fields.includes(f)) && xs.some((x) => has(x, f));
    const looks = xs.map((x) => lookOf(doc, x.el));
    const same = (f) => { const vs = xs.map((x, i) => (has(x, f) ? lookField(looks[i], f) : undefined)).filter((v) => v !== undefined); return vs.every((v) => v === vs[0]) ? vs[0] : null; };
    const target = (d, x) => (x.kind === 'drawing' ? d : find(d, x.el.id).el);
    // live: shown as it changes (a colour being picked), the undo step made when it is set
    const put = (f, v, live = false) => (live ? drawing.preview : drawing.change).call(drawing, (d) => { for (const x of xs) if (has(x, f)) setLook(target(d, x), f, v); });
    // what ↺ gives back: the drawing's, for what the drawing sets; else the default
    const aboveOf = (f) => (xs.some((x) => x.kind === 'drawing') || !LOOK_FIELDS.drawing.includes(f) ? 'the default' : 'the drawing\'s');
    const back = (...fs) => (xs.some((x) => fs.some((f) => has(x, f) && lookField(x.el.look, f) !== undefined))
      ? h('button', { type: 'button', class: 'x', title: `Back to ${aboveOf(fs[0])}`, 'aria-label': `${fs[0]} back to ${aboveOf(fs[0])}`,
        onclick: () => drawing.change((d) => { for (const x of xs) for (const f of fs) if (has(x, f)) setLook(target(d, x), f, undefined); }) }, '↺') : null);
    const mixed = (v) => (v === null ? h('span', { class: 'mixed' }, 'mixed') : null);
    const colour = (f, aria) => {
      const v = same(f);
      return [h('input', { type: 'color', value: v ?? lookField(looks[0], f), 'aria-label': aria, oninput: (e) => put(f, e.target.value, true), onchange: (e) => put(f, e.target.value) }), mixed(v)]; // lookOf: never without a colour (DEFAULT_LOOK under everything)
    };
    const num = (f, aria, lo, hi, title) => F.number(() => same(f), (v) => put(f, v), aria, { min: lo, max: hi, placeholder: 'mixed', bad: `a number from ${lo} to ${hi}`, title });
    const tick = (f, text, title) => row(text, check(same(f), (v) => put(f, v), { 'aria-label': text, title }), back(f));
    // Fill and Stroke: rows of the grid like any other (a colour, its opacity), Width and Dash their own
    // an opacity as a percentage (kept as 0 to 1)
    const opacity = (f, aria) => [F.number(() => { const v = same(f); return v === null ? null : Math.round(v * 100); }, (v) => put(f, v / 100), aria, { max: 100, placeholder: 'mixed', bad: 'a percentage, 0 to 100', title: 'Opacity' }), funit('%')];
    return section(title, title, {},
      shown('fill.color') ? row('Fill', colour('fill.color', 'Fill colour'), opacity('fill.opacity', 'Fill opacity (%)'), back('fill.color', 'fill.opacity')) : null,
      shown('stroke.color') ? row('Stroke', colour('stroke.color', 'Stroke colour'), opacity('stroke.opacity', 'Stroke opacity (%)'), back('stroke.color', 'stroke.opacity')) : null,
      shown('stroke.width') ? row('Width', num('stroke.width', 'Stroke width (px)', ...STROKE_WIDTH), funit('px'), back('stroke.width')) : null,
      shown('stroke.dash') ? row('Dash', choice('Dash', [['solid', '—', 'Solid'], ['dashed', '- -', 'Dashed'], ['dotted', '···', 'Dotted']], same('stroke.dash'), (v) => put('stroke.dash', v)), back('stroke.dash')) : null,
      shown('text.size') ? row('Text size', num('text.size', 'Text size (px)', ...TEXT_SIZE), funit('px'), back('text.size')) : null,
      shown('text.color') ? row('Text colour', colour('text.color', 'Text colour'), back('text.color')) : null,
      shown('text.background') ? row('Background', choice('Background', [['halo', 'Halo', 'A white halo'], ['box', 'Box', 'A white box']], same('text.background'), (v) => put('text.background', v)), back('text.background')) : null,
      shown('text.name') ? tick('text.name', xs.length > 1 || xs[0].kind === 'drawing' ? 'Names on map' : 'Name on map', 'Names are left out where they would collide; zooming in shows them') : null,
      shown('text.values') ? tick('text.values', 'Show values', 'Values on the map: each leg\'s length, a closed line\'s area and perimeter, a circle\'s radius') : null,
      shown('offset') ? row('Offset', F.number(() => same('offset'), (v) => put('offset', v), 'Offset (px)', { min: -MAX_OFFSET, max: MAX_OFFSET, placeholder: 'mixed', bad: `pixels from −${MAX_OFFSET} to ${MAX_OFFSET}`,
        title: 'Pixels beside its line, on screen only' }), funit('px'), back('offset')) : null,
      shown('scale') ? row('Scale', F.number(() => same('scale'), (v) => put('scale', v), 'Drawing scale', { min: SCALE[0], max: SCALE[1], placeholder: 'mixed', bad: `a factor from ${SCALE[0]} to ${SCALE[1]}`,
        title: 'Drawn this many times its size about its point, on the map only: its size, its values and the totals stay real' }), funit('×'), back('scale')) : null,
      ...extra);
  }
  // the group an element (or a group) is in: none, or one of the drawing's that can hold them all
  function groupRow(ids) {
    const doc = drawing.doc;
    const gs = ids.map((id) => find(doc, id)?.el.groupId ?? null), same = gs.every((g) => g === gs[0]) ? gs[0] : undefined;
    const fits = doc.groups.filter((g) => ids.every((id) => canHold(doc, g.id, id)));
    return row('In group', select('In group', [['', 'none'], ...fits.map((g) => [g.id, groupPath(drawing.doc, g)])], same === undefined ? null : same ?? '', (v) => {
      drawing.change((d) => { for (const id of ids) setGroup(d, id, v || null); });
    }));
  }

  // its data, near the foot: its properties, keys and values of the user's own (a description, a
  // category: properties like any other)
  // Data, folded while it has nothing of the user's: the Library item it was placed from is said under
  // its heading (it is a property all the same, in the list once open)
  // A folding section's head (drawing-ui.md §5: every section folds), as a group's in Layers:
  // the whole head folds it (its title a button, for keys), its fold mark first (style.css); extras: buttons
  // after the title (Copy, +). data-key: its state, so that morph never keeps a head whose click
  // would toggle from the state it was made in
  const foldHead = (title, open, toggle, ...extras) => h('h3', { class: open ? 'folds open' : 'folds', 'data-key': open ? 'open' : 'folded', onclick: (e) => { if (!e.target.closest('.hbtns, .hfold')) toggle(); } },
    h('button', { type: 'button', class: 'hfold', 'aria-expanded': String(open), 'aria-label': `${open ? 'Fold' : 'Open'} ${title}`, onclick: toggle }, title),
    h('span', { class: 'hbtns' }, ...extras.flat().filter(Boolean)));
  // Any other section: open to start with, folded by hand (by its key, this session: Look folded stays
  // folded from one element to the next); extras (Copy) and body shown while open; tip: its head's title
  const sectionsFolded = new Set();
  const section = (key, title, { extras = [], tip } = {}, ...body) => {
    const open = !sectionsFolded.has(key);
    const head = foldHead(title, open, () => { sectionsFolded[open ? 'add' : 'delete'](key); renderInspector(); }, open ? extras : []);
    if (tip) head.title = tip;
    return h('div', { class: 'fblock' }, head, ...(open ? body : []));
  };
  // the row of what can be done to it (one place, before Look): the rule's Edit… and Select all, then its own
  const actionsRow = (...btns) => { btns = btns.flat().filter(Boolean); return btns.length ? row('', ...btns) : null; };
  const dataOpen = new Set(); // the elements whose Data was opened by hand
  function dataBlock(id) {
    const el = now(id);
    const put = (fn) => set(id, (x) => fn(x.properties));
    const removeAt = (i) => put((ps) => ps.splice(i, 1));
    const from = el.properties.find((p) => p.key === 'library');
    const open = el.properties.some((p) => p.key !== 'library') || dataOpen.has(id);
    const toggle = () => { if (open) dataOpen.delete(id); else dataOpen.add(id); renderInspector(); };
    // the empty last row: a key typed there adds a property
    const addKey = field(() => '', (t) => (t.trim() ? t : undefined), (v) => { dataOpen.add(id); put((ps) => ps.push({ key: v, value: '' })); }, { 'aria-label': 'Add a key', placeholder: 'add a key…', bad: 'a key cannot be empty' });
    return h('div', { class: 'fblock' },
      foldHead('Data', open, toggle,
        FINGER ? h('button', { type: 'button', class: 'small', title: 'Add a property', onclick: () => { dataOpen.add(id); put((p) => p.push({ key: 'key', value: '' })); } }, '+') : null,
        open && el.properties.length ? copyBtn(() => [['Key', 'Value'], now(id).properties.map((p) => [p.key, p.value])]) : null),
      !open && from ? h('p', { class: 'note' }, `from the library: ${from.value}`) : null,
      open ? listGrid({ name: `${id}:data`,
        columns: [{ head: 'Key', width: 120 }, { head: 'Value', width: 180 }],
        rows: el.properties.map((p, i) => ({ cells: [
          field(() => p.key, (t) => (t.trim() ? t : undefined), (v) => put((ps) => { ps[i].key = v; }), { 'aria-label': 'Key', bad: 'a key cannot be empty' }),
          field(() => p.value, (t) => t, (v) => put((ps) => { ps[i].value = v; }), { 'aria-label': 'Value' })] })),
        add: [addKey, null],
        actions: (i) => ({ label: el.properties[i].key, buttons: [act('Delete', `${MOD} Delete`, () => removeAt(i))] }),
        keys: { remove: removeAt } }) : null);
  }
  // every inspector's top (its title, kind · name, in the head): the rule that made it, its name
  const commonTop = (kind, id) => {
    const el = now(id);
    title = `${kindTitle(drawing.doc, kind, el)} · ${shownName(drawing.doc, kind, el, drawing.units())}`;
    return [ruleRow(id)?.row, kind === 'label' ? null : row('Name', textField(id, 'name', 'Name'))]; // a label is its text
  };
  const ruleActs = (id) => ruleRow(id)?.acts ?? [];
  // and its foot: the group it is in (a shape: its point), Guide, its data (Delete: in the head)
  // Guide ticked or not: unticked, part of the drawing (a measurement too: no longer one)
  const setGuide = (x, v) => { x.guide = v; if (!v) delete x.measure; };
  const commonBottom = (kind, id) => {
    const el = now(id);
    // Guide (supporting geometry: faint, out of the totals): a measurement is a guide of its own;
    // unticking Guide makes either part of the drawing
    const guide = kind !== 'label' && kind !== 'group' ? row('Guide', check(el.guide, (v) => set(id, (x) => setGuide(x, v)), { 'aria-label': 'Guide', title: 'Faint and dashed, out of the totals' })) : null; // unticked: part of the drawing (a measurement too)
    return [kind === 'circle' || (kind === 'line' && el.closed) ? pointRow(id) : null, holderOf(drawing.doc, el) ? null : groupRow([id]), guide, dataBlock(id)]; // a Point row: on what a point can hold
  };
  // A shape's point: the one holding it (it moves and turns with it), and Detach (free, in the
  // point's group); free (a circle, a closed line: canHold), Attach to… (the next click on a point)
  function pointRow(id) {
    const p = holderOf(drawing.doc, now(id)), waits = drawing.repointing?.id === id;
    const attach = h('button', { type: 'button', class: 'small', 'aria-pressed': String(waits), title: 'Then click the point that is to hold it',
      onclick: () => { if (waits) drawing.cancelRepoint(); else drawing.startRepoint(id, null); renderInspector(); } }, 'Attach to…');
    if (!p) return row('Point', fvalue('none'), attach);
    return row('Point', link(p.id), h('button', { type: 'button', class: 'x', title: 'Free, where it is', 'aria-label': 'Detach from its point',
      onclick: () => set(id, (x, d) => setGroup(d, id, p.groupId)) }, icon(...UI_ICON.detach))); // free (setGroup: named, never scaled)
  }
  // a point at position, turned to bearing, its shapes with it (each of xs: one of a field)
  const carryAll = (xs, fn) => drawing.change((d) => { for (const x of xs) { const p = find(d, x).el; carry(d, p, ...fn(p)); } });

  const kindOf = (id) => find(drawing.doc, id)?.kind;
  // the IDs of xs but a point's shapes (selected with their point)
  const tops = (xs) => xs.filter((x) => !holderOf(drawing.doc, x.el)).map((x) => x.el.id);
  const item = (id) => find(drawing.doc, id);
  // a button selecting another element (a point, a line, a group)
  const link = (id, text) => h('button', { type: 'button', class: 'small link', onclick: () => drawing.select([id]) }, text ?? label(kindOf(id), now(id)));

  // Add to library… (drawing-ui.md §9): a point with its shapes as they are (hidden ones too), a line, an
  // area or a label for its look and properties (a label's text), kept under a name ("Folder / Name")
  const libraryBtn = (id, name) => h('button', { type: 'button', class: 'small', title: 'Keep it in the Library, to draw again',
    onclick: async () => {
      const to = (await askText('Add to library', 'Name (Folder / Name)', name || 'Item'))?.trim();
      if (!to) return;
      if (drawing.library.some((x) => x.name === to) && !(await ask('Add to library', `Replace “${to}” in the library?`, [[() => true, 'Replace']]))) return;
      drawing.library = [...drawing.library.filter((x) => x.name !== to), itemOf(drawing.doc, id, to)];
      saveLibrary(drawing.library);
      libraryChanged();
      note(`“${to}” added to the Library`);
    } }, 'Add to library…');
  // a point: its position and bearing (its shapes carried), its symbol, its shapes, its look, Add to library…
  function pointInspector(id) {
    const el = now(id), shapes = membersOf(drawing.doc, id);
    const [, lat, , lon] = F.position(() => now(id).position, (q) => carryAll([id], (p) => [q, p.bearing]), '', 6);
    const parts = [...commonTop('point', id), row('Position', pair(lat, '·', lon)),
      shapes.length ? row('Bearing', F.angle(() => now(id).bearing, (v) => carryAll([id], (p) => [p.position, v]), 'Bearing (degrees true): its shapes turn with it'), funit('°T')) : null, // as its stalk: only while it holds shapes (a symbol is never turned)
      row('Symbol', choice('Symbol (the same size on screen at every zoom)', SYMBOLS.map((sy) => [sy, sy === 'none' ? '∅' : icon(...SYMBOL_ICON[sy]), SYMBOL_TITLE[sy]]), el.symbol, (sy) => set(id, (x) => { x.symbol = sy; }))),
      shapes.length ? row('Shapes', h('span', {}, ...shapes.map((x) => link(x.el.id)))) : null];
    parts.push(actionsRow(ruleActs(id), libraryBtn(id, el.name)), lookBlock([item(id)]));
    return [...parts, ...commonBottom('point', id)];
  }

  // a vertex's (or a label's) Attach to… (the next click on the map chooses what to link it to), pressed while it
  // waits for a click
  const waiting = (id, k) => drawing.repointing?.id === id && drawing.repointing.index === k;
  const attachBtn = (id, k, attrs, ...content) => h('button', { type: 'button', ...attrs, 'aria-pressed': String(waiting(id, k)), title: 'Then click where to attach it',
    onclick: () => { if (waiting(id, k)) drawing.cancelRepoint(); else drawing.startRepoint(id, k); renderInspector(); } }, ...content);
  const detach = (id, k) => set(id, (x, d) => setLink(d, id, k, null)); // free where it is
  // What a label points at: linked, a link to it and where on it, Detach (the broken link) and Attach
  // to…; free, its position typed, and Attach to…
  function refRow(text, id) {
    const to = linkFrom(drawing.doc, id)?.to, on = to && find(drawing.doc, to.element);
    const attach = attachBtn(id, 0, { class: 'x', 'aria-label': `Attach ${text.toLowerCase()} to…` }, icon(...UI_ICON.attach));
    if (!on) { const [, lat, , lon] = F.position(() => now(id).position, (q) => set(id, (x) => { x.position = q; }), '', 6); return row(text, pair(lat, '·', lon), attach); }
    return row(text, link(on.el.id), partName(to) ? h('span', { class: 'funit' }, partName(to)) : null,
      h('button', { type: 'button', class: 'x', title: 'Free, where it is', 'aria-label': `Detach ${text.toLowerCase()}`, onclick: () => detach(id, 0) }, icon(...UI_ICON.detach)), attach);
  }

  // a label: its text (with live values), what it points at, its leader and its look
  const TOKEN_TEXT = { name: ['name', 'The name of what it points at'], length: ['length', 'The length of the line it points at, or of the side'],
    along: ['distance along', 'The distance along the line to where it points'], bearing: ['bearing', 'The bearing of the side or leg it points at'],
    radius: ['radius', 'The circle\'s radius'], area: ['area', 'The area of the closed line or circle'], perimeter: ['perimeter', 'The perimeter of the closed line'] };
  function labelInspector(id) {
    const doc = drawing.doc, el = now(id), u = drawing.units(), to = linkFrom(doc, id)?.to;
    const at = to && resolve(doc, to), values = labelValues(doc, to, u);
    const text = h('textarea', { rows: 3, 'aria-label': 'Text', class: 'ltext' }, el.text);
    text.addEventListener('input', () => drawing.previewLabels((d) => { find(d, id).el.text = text.value; })); // seen on the map as it is typed
    text.addEventListener('change', () => set(id, (x) => { x.text = text.value; }));
    const insert = (token) => {
      const a = text.selectionStart ?? text.value.length, b = text.selectionEnd ?? a;
      text.value = text.value.slice(0, a) + token + text.value.slice(b);
      set(id, (x) => { x.text = text.value; });
    };
    const tokens = TOKENS.filter((k) => values[k] !== undefined);
    // on a line: how far along it, typed (the leg there, and where on it)
    const onLine = at?.element?.kind === 'line' && at.along !== undefined;
    const alongRow = onLine ? row('Along', withUnit(F.dist(() => at.along, (m) => drawing.change((d) => setLink(d, id, 0, lineRef(d, find(d, to.element).el, m))), 'Distance along', { zero: true,
      title: `Of ${fmtDist(at.length, u)}` }))) : null;
    // what it reads on the map, under its text, while a value fills it in
    const reads = /\{\w+\}/.test(el.text) ? h('p', { class: 'note' }, `Reads: ${labelText(doc, el, u).split('\n').map((t) => t.trim()).filter(Boolean).join(' · ') || '(nothing)'}`) : null;
    // its place: where it points (free: a position), along a line, and its text moved from there
    const moved = el.offset[0] !== (to ? LABEL_OFFSET[0] : 0) || el.offset[1] !== (to ? LABEL_OFFSET[1] : 0);
    return [...commonTop('label', id),
      row('Text', text), reads,
      tokens.length ? row('', ...tokens.map((k) => h('button', { type: 'button', class: 'small', title: `A live ${TOKEN_TEXT[k][0]}`, onclick: () => insert(`{${k}}`) }, `+ ${TOKEN_TEXT[k][0]}`))) : null,
      refRow(to ? 'Attached to' : 'Position', id), alongRow,
      row('Text offset', fvalue(`${el.offset[0]}, ${el.offset[1]}`.replace(/-/g, '−'), { title: 'Drag its text on the map' }), funit('px'),
        moved ? h('button', { type: 'button', class: 'x', title: 'Back to the default', 'aria-label': 'Text offset back to where a new label puts it', onclick: () => set(id, (x) => { x.offset = to ? [...LABEL_OFFSET] : [0, 0]; }) }, '↺') : null),
      leaderRow([item(id)]),
      actionsRow(ruleActs(id), libraryBtn(id, labelText(drawing.doc, el, drawing.units()).split('\n')[0])), lookBlock([item(id)]),
      ...commonBottom('label', id)];
  }

  // labels' leader: a line from the text to its point, an arrow head there, or none (one or several labels)
  function leaderRow(xs) {
    const on = xs.map((x) => x.el.leader !== 'none'), v = on.every((x) => x === on[0]) ? on[0] : null;
    return row('Leader', check(v, (x) => drawing.change((d) => { for (const y of xs) find(d, y.el.id).el.leader = x ? 'arrow' : 'none'; }),
      { 'aria-label': 'Leader', title: 'A line from the text to its point' }));
  }

  // A long list a page at a time (drawing-ui.md §5): PAGE rows, from the page shown (each list's own,
  // this session), and ‹ › under it; Copy still takes every row. rows: the absolute rows
  // shown, in order.
  const PAGE = 100, pageAt = new Map();
  function paged(name, total) {
    const from = Math.min(pageAt.get(name) ?? 0, Math.max(0, total - 1) - (Math.max(0, total - 1) % PAGE)), to = Math.min(total, from + PAGE);
    const go = (f) => { pageAt.set(name, f); renderInspector(); };
    const pager = total > PAGE ? h('div', { class: 'lpager' },
      // data-key: the page each goes to (morph keeps a button only when it does the same)
      h('button', { type: 'button', class: 'small', 'aria-label': 'Previous rows', 'data-key': `to ${from - PAGE}`, disabled: !from, onclick: () => go(from - PAGE) }, '‹'),
      h('span', { class: 'funit' }, `${from + 1}–${to} of ${total}`),
      h('button', { type: 'button', class: 'small', 'aria-label': 'Next rows', 'data-key': `to ${from + PAGE}`, disabled: to >= total, onclick: () => go(from + PAGE) }, '›')) : null;
    return { rows: Array.from({ length: to - from }, (_, k) => from + k), pager, name: `${name}@${from}` };
  }
  // a row action's button, in a list grid's bar
  const act = (text, title, onclick, disabled = false) => h('button', { type: 'button', class: 'small', title, disabled, onclick }, text);
  // a list's Copy: its rows (rows(): [head, rows]) as text a spreadsheet takes, every column
  const copyBtn = (rows) => h('button', { type: 'button', class: 'small', title: 'For a spreadsheet', onclick: () => {
    const [head, body] = rows();
    navigator.clipboard?.writeText(rowsText(head, body)).then(() => note(`${plural(body.length, 'row')} copied`), () => note('This browser did not let them be copied'));
  } }, 'Copy');

  // a line: its table of vertices, its profile, its inspector (lineview.js)
  const lines = createLineView({ drawing, map, ctx, F, field, row, funit, fvalue, valued, distValue, link, now, set, item, foldHead, section, actionsRow, act, copyBtn, paged, PAGE, pageAt,
    attachBtn, detach, commonTop, commonBottom, lookBlock, ruleActs, libraryBtn, openDistribution: (...a) => openDistribution(...a), inspector, render: () => renderInspector() });
  const { lineInspector, pickPlace, dropProfileCursor } = lines;
  const radiusCheck = (m) => (m < MAX_RADIUS ? null : 'a distance under 10 000 km');
  // a circle (a sector: with an aperture): its centre, radius, aperture and bearing, its area,
  // Distribute along…
  function circleInspector(id) {
    const el = now(id), u = drawing.units(), at = (fn) => set(id, fn);
    return [...commonTop('circle', id), coordFields(id, 'position'),
      row('Radius', withUnit(F.dist(() => now(id).radius, (m) => at((x) => { x.radius = m; }), 'Radius', { check: radiusCheck }))),
      row('Aperture', F.angle(() => now(id).aperture, (v) => at((x) => { x.aperture = v || null; }), 'Aperture (degrees): a sector centred on its bearing; empty or 360: a whole circle', { wrap: false, none: true }), funit('°')),
      row('Bearing', F.angle(() => now(id).bearing, (v) => at((x) => { x.bearing = v; }), 'Bearing (degrees true): a sector\'s middle, a circle\'s start'), funit('°T')),
      drawable(el) ? row('Area', valued(fmtArea(areaOf(ringOf(el)), u))) : h('p', { class: 'note warn' }, `Not drawn: a circle of ${fmtDist(el.radius, u)} there reaches a pole.`),
      actionsRow(ruleActs(id), h('button', { type: 'button', class: 'small', title: 'Copies round it', onclick: () => openDistribution({ element: id }) }, 'Distribute along…')),
      lookBlock([item(id)]), ...commonBottom('circle', id)];
  }

  function groupInspector(id) {
    const doc = drawing.doc;
    const direct = membersOf(doc, id);
    const below = membersOf(doc, id, true).filter((x) => x.kind !== 'group'); // everything in it, its subgroups' too
    const shownEye = eyeFor(drawing, () => [item(id)], 'members'); // the group's own flag, as its row's eye: one flag hides them all
    shownEye.render();
    // its members as the tree counts them (everything in it, its subgroups' too), and its subgroups
    const allSubs = membersOf(doc, id, true).length - below.length;
    // its totals as the drawing's, its members only, by subgroup (its own: under its name)
    const shared = below.length > 1 ? sharedRows(below) : [];
    const totalsOf = below.length ? totalsBlock(null, (gid) => (gid ? groupPath(doc, doc.groups.find((g) => g.id === gid)) : ''), breakdown(doc, null, new Set(below.map((x) => x.el.id))), '', `${id}:totals`) : null;
    return [...commonTop('group', id),
      row('Members', fvalue([plural(below.length, 'element'), allSubs ? plural(allSubs, 'subgroup') : ''].filter(Boolean).join(' · ')), direct.length ? shownEye : null),
      totalsOf,
      actionsRow(ruleActs(id), h('button', { type: 'button', class: 'small', title: 'Everything in it', disabled: !below.length, onclick: () => drawing.select(tops(below)) }, 'Select members'), connectBtn(below)),
      ...(shared.length ? [section('Each member', 'Each member', {}, ...shared)] : []),
      lookBlock([item(id)], null, 'Look · sets each member'), ...commonBottom('group', id)];
  }

  // What several elements share (drawing-ui.md §5): every row two or more of them have, "mixed"
  // where they differ (as Look), a value set on each that has it. Two or more points: Position,
  // Symbol, and Bearing for those holding shapes (carried); two or more circles, their Radius; two or more lines,
  // their Path; any but labels, Guide. xs: the elements (several selected, or a group's members)
  function sharedRows(xs) {
    const pts = xs.filter((x) => x.kind === 'point'), lines = xs.filter((x) => x.kind === 'line'), circles = xs.filter((x) => x.kind === 'circle'), geo = [...pts, ...circles, ...lines];
    const same = (ys, f) => { const vs = ys.map(f); return vs.every((v) => v === vs[0]) ? vs[0] : null; };
    const each = (ys, fn) => drawing.change((d) => { for (const y of ys) fn(find(d, y.el.id).el, d); });
    const out = [];
    if (pts.length > 1) {
      const nowPts = () => pts.map((x) => now(x.el.id)).filter(Boolean);
      // their position, each axis alone: a latitude typed puts them all on that parallel, their longitudes kept
      const ids = pts.map((x) => x.el.id);
      const axis = (k, aria) => F.coord(k ? 'lat' : 'lon', () => same(nowPts(), (p) => p.position[k]), (v) => carryAll(ids, (p) => [k ? [p.position[0], v] : [v, p.position[1]], p.bearing]), aria, 6);
      out.push(row('Position', pair(axis(1, 'Latitude of each point'), '·', axis(0, 'Longitude of each point'))));
      // Bearing: the points holding shapes (a symbol is never turned), two or more
      const holding = pts.filter((x) => membersOf(drawing.doc, x.el.id).length), held = () => holding.map((x) => now(x.el.id)).filter(Boolean);
      if (holding.length > 1) out.push(row('Bearing', F.angle(() => same(held(), (p) => p.bearing), (v) => carryAll(holding.map((x) => x.el.id), (p) => [p.position, v]), 'Bearing (degrees true) of each point holding shapes'), funit('°T')));
      out.push(row('Symbol', choice('Symbol of each point', SYMBOLS.map((sy) => [sy, sy === 'none' ? '∅' : icon(...SYMBOL_ICON[sy]), SYMBOL_TITLE[sy]]), same(pts, (x) => x.el.symbol), (sy) => each(pts, (p) => { p.symbol = sy; }))));
    }
    if (circles.length > 1) {
      const nowCs = () => circles.map((x) => now(x.el.id)).filter(Boolean);
      out.push(row('Radius', withUnit(F.dist(() => same(nowCs(), (c) => c.radius), (m) => each(circles, (c) => { c.radius = m; }), 'Radius of each circle', { check: radiusCheck }))));
    }
    if (lines.length > 1) out.push(row('Path', choice('Path of each line', [[false, 'Straight', 'Geodesics'], [true, 'Smooth', 'A curve through its bends']], same(lines, (x) => !!x.el.smooth), (v) => each(lines, (l) => { l.smooth = v; }))));
    if (geo.length > 1) out.push(row('Guide', check(same(geo, (x) => x.el.guide), (v) => each(geo, (g) => setGuide(g, v)), { 'aria-label': 'Guide', title: 'Faint and dashed, out of the totals' })));
    return out;
  }

  // a new group of ids, in the nearest group they are all in; it is selected
  function groupThem(ids) { let g; drawing.change((doc) => { g = makeGroup(doc, ids); }); drawing.select([g.id]); }
  function severalInspector(xs) {
    const counts = {};
    for (const x of xs) counts[x.kind] = (counts[x.kind] || 0) + 1;
    // two points: how far apart, and the bearing from the first to the second
    const between = xs.length === 2 && xs.every((x) => x.kind === 'point') ? inverse(xs[0].el.position, xs[1].el.position) : null;
    title = `${xs.length} elements · ${Object.entries(counts).map(([k, n]) => plural(n, KIND[k].name.toLowerCase())).join(', ')}`;
    return [between ? row('Apart', distValue(between.s, { title: 'From the first to the second' })) : null,
    between ? row('Bearing 1→2', fvalue(norm360(between.azi).toFixed(1), { title: `From ${label(xs[0].kind, xs[0].el)} to ${label(xs[1].kind, xs[1].el)}` }), funit('°T')) : null,
    ...sharedRows(flat(xs)),
    flat(xs).some((x) => x.kind === 'label') ? leaderRow(flat(xs).filter((x) => x.kind === 'label')) : null,
    actionsRow(connectBtn(flat(xs))),
    lookBlock(xs),
    groupRow(tops(xs)), // a point's shapes stay its
  ];
  }

  // Connect… for the points among xs (a group's: everything in it), two or more
  // the rules' forms (forms.js), built with the inspector's parts
  const selKey = () => [...drawing.sel].sort().join(' ');
  const forms = createForms({ drawing, map, F, row, section, pair, funit, fvalue, withUnit, distValue, link, now, tops, radiusCheck, selKey,
    setTitle: (t) => { title = t; }, render: () => renderInspector() });
  const { ruleRow, connectBtn, openDistribution, closeForm, formPreview } = forms;
  function drawingInspector() {
    const m = drawing.doc.meta;
    const meta = (key, aria, area) => F.text(() => m[key], (v) => drawing.change((doc) => { doc.meta[key] = v; }), aria, area ? 2 : 0);
    const n = elements(drawing.doc).length;
    const groupName = (gid) => (gid ? groupPath(drawing.doc, drawing.doc.groups.find((g) => g.id === gid)) : 'Not grouped');
    const keys = [...new Set(elements(drawing.doc).filter((x) => x.kind !== 'group').flatMap((x) => x.el.properties.map((p) => p.key)))].sort((a, b) => a.localeCompare(b));
    if (totalsBy && !keys.includes(totalsBy)) { totalsBy = ''; computeFacts(); } // its key gone
    const by = select('Totals by', [['', 'group'], ...keys.map((k) => [k, k])], totalsBy || '', (v) => { totalsBy = v; computeFacts(); renderInspector(); });
    const offsetElsewhere = elements(drawing.doc).filter((x) => x.el.look?.offset != null); // where Offset is set on an element
    title = `Drawing · ${m.title?.trim() || 'Untitled drawing'}`;
    const titleField = Object.assign(meta('title', 'Title'), { placeholder: 'Untitled drawing' }); // what the tree and the bar call it while it has none
    const when = (t) => new Date(t).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    return [row('Title', titleField), row('Description', meta('description', 'Description', true)), row('Author', meta('author', 'Author')),
      row('Created', fvalue(when(drawing.doc.created), { title: 'Last change: ' + when(drawing.doc.modified) })),
      lookBlock([{ kind: 'drawing', el: drawing.doc }], LOOK_FIELDS.drawing, 'Display', [
        offsetElsewhere.length ? h('p', { class: 'note' }, 'Offset also set on ', ...offsetElsewhere.map((x) => link(x.el.id))) : null,
        row('Units', choice('Distance units', [['km', 'km', 'Kilometres'], ['nm', 'NM', 'Nautical miles']], ctx.display.units, (v) => ctx.setDisplay({ units: v }))),
        row('Leg bearings', check(ctx.display.bearings, (v) => ctx.setDisplay({ bearings: v }), { 'aria-label': 'Leg bearings', title: 'Beside each length on the map' }))]),
      n > 1 ? totalsBlock(keys.length ? by : null, groupName) : null,
      drawing.saving.failed ? h('p', { class: 'note warn' }, 'This browser does not let the drawing be saved (storage full or turned off): Download › Drawing (GeoJSON) keeps it as a file.') : null,
      drawing.saving.otherTab ? h('p', { class: 'note warn' }, 'The drawing was changed in another tab. Saving here replaces that version. ', h('button', { type: 'button', class: 'small', onclick: () => location.reload() }, 'Reload')) : null];
  }
  // The Totals view (docs/drawing-ui.md §5): a list grid, no head, of the lines by group (or by a
  // property's values), each listed under its group, those a connection made summed by what they are
  // (trunks and branches; a chain's root links and the links between points); the areas; the points
  // by kind. Each section's row names its columns; a group's rows fold; a name selects its element;
  // Copy gives every row tab-separated, in metres, for a spreadsheet
  const MADE_PART = { trunk: 'trunks, root → hub', branch: 'branches, hub → point', 'root link': 'root → first point', link: 'between points' };
  // b: what is counted (the drawing's, or a group's: breakdown's only); key: the property it is by, or ''
  const totalsClosed = new Set(); // the Totals sections folded (by their grid's name)
  function totalsBlock(by, groupName, b = fx().breakdown, key = totalsBy, name = 'totals') {
    const u = drawing.units(), doc = drawing.doc;
    const open = !totalsClosed.has(name);
    const head = foldHead('Totals', open, () => { totalsClosed[open ? 'add' : 'delete'](name); renderInspector(); });
    if (!open) return h('div', { class: 'fblock' }, head);
    // a group holding a connection: its pattern and roots beside the name (two are both "Connection")
    const made = (k) => { const c = k && connections(doc).find((x) => x.groupId === k); return c ? ` (${c.pattern}, from ${c.roots.map((r) => label('point', now(r.id))).join(', ')})` : ''; };
    const keyName = (k) => (key ? (k ? `“${k}”` : `No ${key}`) : groupName(k) + made(k));
    const rows = [], copy = []; // copy: [section, group, name, count, length m, area m², perimeter m]
    const tr = (cls, ...cells) => rows.push({ cls, cells });
    const sel = (text, id) => h('button', { type: 'button', class: 'small link', title: 'Select it', onclick: () => drawing.select([id]) }, text);
    const fold = (k, folded, text) => h('button', { type: 'button', class: 'small link tfold', 'aria-expanded': String(!folded), title: folded ? 'Show its lines' : 'Fold its lines', onclick: () => { totalsFolded[folded ? 'delete' : 'add'](k); renderInspector(); } }, `${folded ? '▸' : '▾'} ${text}`);
    const nameOf = (kind, id) => label(kind, find(doc, id).el);
    const lineRows = [...b.lines.rows].sort((p, q) => (!p.key) - (!q.key) || keyName(p.key).localeCompare(keyName(q.key)));
    const one = lineRows.length === 1 && (!lineRows[0].key || !groupName) && !key; // nothing grouped: no group rows (by a property, the row says "No …")
    if (b.lines.count) {
      tr('sec', 'Lines', '', 'Length');
      for (const r of lineRows) {
        const folded = totalsFolded.has(r.key), g = one ? '' : keyName(r.key);
        if (!one) { tr('grp', fold(r.key, folded, g), plural(r.count, 'line'), fmtDist(r.length, u)); copy.push(['Lines', g, '', r.count, r.length, '', '']); }
        for (const p of r.parts) { if (!folded) tr(one ? 'part top' : 'part', MADE_PART[p.part], plural(p.count, 'line'), fmtDist(p.length, u)); copy.push(['Lines', g, MADE_PART[p.part], p.count, p.length, '', '']); }
        for (const l of r.lines) { if (!folded) tr(one ? 'item top' : 'item', sel(nameOf('line', l.id), l.id), '', fmtDist(l.length, u)); copy.push(['Lines', g, nameOf('line', l.id), 1, l.length, '', '']); }
      }
      tr('all', 'All lines', plural(b.lines.count, 'line'), fmtDist(b.lines.length, u));
      copy.push(['Lines', '', 'All lines', b.lines.count, b.lines.length, '', '']);
    }
    if (b.areas.count) {
      tr('sec', 'Areas', 'Area', 'Perimeter');
      for (const a of b.areas.rows) { tr('item top', sel(nameOf('line', a.id), a.id), fmtArea(a.area, u), fmtDist(a.perimeter, u)); copy.push(['Areas', '', nameOf('line', a.id), 1, '', a.area, a.perimeter]); }
      tr('all', 'All areas', fmtArea(b.areas.area, u), fmtDist(b.areas.perimeter, u));
      copy.push(['Areas', '', 'All areas', b.areas.count, '', b.areas.area, b.areas.perimeter]);
    }
    if (b.points.count) {
      tr('sec', 'Placed', 'Count', ''); // points and what was placed with the Shape tool (a point with its shapes, once)
      for (const [k, c] of [...b.points.kinds].sort((p, q) => q[1] - p[1])) { const kname = key ? keyName(k) : k; tr('item top', kname, String(c), ''); copy.push(['Points', '', kname, c, '', '', '']); }
      tr('all', 'All', String(b.points.count), '');
      copy.push(['Points', '', 'All', b.points.count, '', '', '']);
    }
    const hidden = b.lines.hidden || b.areas.hidden || b.points.hidden;
    const HEAD = ['Section', key || 'Group', 'Name', 'Count', 'Length (m)', 'Area (m²)', 'Perimeter (m)'];
    const r1 = (v) => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : v);
    head.title = `Guides and measurements are left out; lines running together each count${hidden ? '; hidden ones are counted' : ''}`;
    head.lastChild.append(copyBtn(() => [HEAD, copy.map((c) => c.map(r1))]));
    return h('div', { class: 'fblock' }, head,
      by ? row('By', by) : null,
      listGrid({ name, plain: true, columns: [{ width: 150 }, { width: 70, cls: 'num' }, { width: 84, cls: 'num' }], rows }));
  }
  // Built again on each change, and put in place of what it shows (dom.js morph): what stays the same
  // stays, with its focus, caret and scroll, so Tab and a click from a field just applied land where
  // they go. Something else shown (another selection, a form): built anew.
  let shows = null;
  function renderInspector() {
    lines.readAgain();
    dropProfileCursor(); // a profile shown again makes its own
    const xs = drawing.selected();
    const form = forms.current();
    if (form && selKey() !== form.sel) { closeForm(); note('The form closed: the selection changed'); }
    ctx.frame.has(!NARROW.matches || !!forms.current() || xs.length > 0 || ctx.frame.props); // Properties shown while it has something (a computer: the drawing, with nothing selected; a phone: the drawing too while the user turned it on), and is on
    // not seen (off, or nothing to show): not built; built anew when it is (render('tool'))
    if (ctx.props.hidden) { shows = null; return; }
    const what = `${forms.current() ? `${forms.current().kind}:${forms.current().sel}` : ''}|${selKey()}`;
    // a field being edited, when something else is to be shown, is applied first, to the element it belongs to
    if (what !== shows && inspector.contains(document.activeElement)) document.activeElement.blur();
    if (what !== shows) forgetCurrent(); // another selection: no table row current (Delete takes it, not a vertex chosen before)
    const kids = forms.current() ? forms.view() : !xs.length ? drawingInspector()
      : xs.length > 1 ? severalInspector(xs)
        : { point: pointInspector, circle: circleInspector, line: lineInspector, group: groupInspector, label: labelInspector }[xs[0].kind](xs[0].el.id);
    const top = inspector.scrollTop;
    if (what === shows) morph(inspector, h('div', {}, kids.flat().filter(Boolean)));
    else inspector.replaceChildren(...kids.flat().filter(Boolean));
    shows = what;
    inspector.scrollTop = top;
    renderHead(xs);
  }
  // The inspector's head (drawing-ui.md §5): what it shows, then Zoom to, Duplicate, Group and Delete
  // for the selection (with nothing selected, Zoom to all of it; none while a form is open).
  function renderHead(xs = drawing.selected()) {
    inspTitle.textContent = title;
    inspTitle.title = title; // whole, where the head cuts it
    const ids = xs.map((x) => x.el.id), every = ids.length ? ids : elements(drawing.doc).map((x) => x.el.id);
    const act = (paths, aria, title, run) => h('button', { type: 'button', class: 'hact', 'aria-label': aria, title, onclick: run }, icon(...paths));
    inspActs.replaceChildren(...(forms.current() ? [] : [
      every.length ? act(UI_ICON.zoom, 'Zoom to', 'Zoom to', () => showOnMap(new Set(every))) : null,
      ids.length ? act(UI_ICON.duplicate, 'Duplicate', `Duplicate (${MOD} D)`, () => drawing.duplicate()) : null,
      ids.length ? act(UI_ICON.group, 'Group', 'Group', () => groupThem(ids)) : null,
      ids.length ? act(UI_ICON.delete, 'Delete', 'Delete (Delete)', () => del(ids)) : null,
    ].filter(Boolean)));
  }

  // ---- map and files --------------------------------------------------------------------------
  // a double-click on an element, with no tool on, turns Properties on (the map does not zoom)
  map.on('dblclick', (e) => { if (!drawing.tool && drawing.hitAt(e.point).length) { e.preventDefault(); ctx.frame.setProps(true); } });
  function showOnMap(ids) {
    const b = boundsOf(drawing.doc, ids);
    if (b) map.fitBounds(b, { padding: ctx.free(), maxZoom: 20, animate: animate() }); // clear of the panel; close enough for a 6 m shape
  }
  root.replaceChildren(tree.box);
  ctx.props.append(inspHead, inspector);
  renderList();
  renderTools();

  // ---- keys ----------------------------------------------------------------------------------
  window.addEventListener('keydown', (e) => {
    if (document.querySelector('dialog[open]')) return;
    const typed = typing(e.target); // a box ticked is no typing: the keys stay the drawing's
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
      if (typed) return; // the field's own undo
      e.preventDefault();
      if (e.shiftKey) drawing.redo(); else drawing.undo();
      return;
    }
    // copy, paste, duplicate (Ctrl/⌘ C, V, D): the selection's elements, not text being typed
    if (mod && !e.altKey && !typed && ['c', 'v', 'd'].includes(e.key.toLowerCase())) {
      const k = e.key.toLowerCase();
      if (k === 'c' && (!drawing.sel.size || !getSelection().isCollapsed)) return; // nothing selected, or text (in Properties): the page's own copy
      e.preventDefault();
      const n = k === 'c' ? drawing.copy() : k === 'v' ? drawing.paste() : drawing.duplicate();
      if (n && k === 'c') note(`Copied: ${plural(n, 'element')}`); // the clipboard has no other sign; a paste or a copy made is selected
      return;
    }
    // the drawing order: Ctrl/⌘ ] one step up (drawn above), [ one step down, among its kind in its group
    if (mod && !typed && (e.key === ']' || e.key === '[') && drawing.sel.size) {
      e.preventDefault();
      const dir = e.key === ']' ? -1 : 1, ids = tree.shown().map((x) => x.el.id).filter((id) => drawing.sel.has(id));
      drawing.change((doc) => { for (const id of dir < 0 ? ids : ids.reverse()) moveStep(doc, id, dir); });
      return;
    }
    // deleting: Delete; on a Mac, whose delete key is Backspace, ⌘-Backspace as in the Finder. Never
    // Backspace alone, which takes back a point while drawing (here and in Measure)
    // a vertex current (pressed on the map or its row): it, else the selection
    if (!typed && (e.key === 'Delete' || (mac && e.metaKey && e.key === 'Backspace')) && drawing.sel.size) { e.preventDefault(); if (!drawing.removePlace()) del([...drawing.sel]); return; }
    if (typed || mod || e.altKey) return;
    // the tools' keys: app.js, from anywhere
    // ↑ ↓ step the tree, unless what has the focus takes them itself (a slider, a radio card, the map)
    const ownArrows = e.target.closest?.('input[type=range], .maplibregl-canvas');
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !ownArrows && ctx.frame.tab === 'elements' && tree.step(e.key === 'ArrowDown' ? 1 : -1)) e.preventDefault(); // the tree stepped only while seen
    else if (e.key === 'F2' && drawing.sel.size === 1) { e.preventDefault(); tree.rename([...drawing.sel][0]); }
  });

  // ---- rendering ---------------------------------------------------------------------------
  return {
    render(what) {
      if (what === 'tool') { // also after any change of the frame: what has just come into view built
        if (listStale && listSeen()) { listStale = false; tree.render(); }
        if (shows === null && !ctx.props.hidden) renderInspector();
        library.render();
        return renderTools();
      }
      if (what === 'draft') return tools.renderTouch();
      if (what === 'cancel') { closeForm(); return renderInspector(); } // Esc or a right-click on the map with a form open
      if (what === 'drag') { if (!drawing.drag) renderInspector(); return; } // when it is let go (the map shows its values while it moves); the tree then too
      // a line's vertex pressed on the map: its row in the table made current
      if (what === 'place') { const { id, index } = drawing.currentPlace; if (drawing.sel.size === 1 && drawing.sel.has(id)) pickPlace(id, index); return; }
      if (what === 'box' && !drawing.sel.size) note('Nothing lies entirely inside the box'); // a box drawn: why nothing is selected
      // a label just placed (and selected, so shown): its text ready to be typed
      if (what === 'placed') {
        if (ctx.props.hidden) ctx.frame.showProps(true); // typing it is the point of placing it: Properties shown (the user's switch as it was)
        if (shows === null) renderInspector();
        const t = inspector.querySelector('.ltext'); t?.focus(); t?.select(); return;
      }
      // the selection only changed: the rows marked again, not built again (each row's value is a length
      // or an area, computed)
      if (what === 'sel') {
        if (!listStale) tree.mark();
      } else renderList();
      renderInspector();
      if (forms.current() && what === 'doc') formPreview(); // the form's preview follows the drawing (an undo, its line edited)
      if (what === 'doc') lines.forgetGone(drawing.doc); // a line gone: its profile too
      library.render(); // only if what it shows changed (the units)
      renderTools();
    },
    importFile: (f) => files.importFile(f), // a file dropped on the map (app.js)
    press: tools.press, // the tools' keys (app.js)
  };
}
