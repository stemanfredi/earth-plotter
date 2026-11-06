// Draw (docs/drawing-ui.md §9): everything there is to draw, in the left panel's Draw tab
// (the bar has no tool that makes elements): the built-in kinds (a point, a line, an area, a label, the
// shapes), then the user's own items in their folders ("Folder / Name"), each with a picture and its
// size; a filter. A row clicked: drawing it (the tool that draws it on; again: off); one placed in a
// click dragged onto the map: placed there. An item's ⋯: rename (its folder too), duplicate, delete.

import { h, svg, store, NARROW } from '../dom.js';
import { ask, askText, note } from '../menu.js';
import { BUILT_IN, builtInName, placeKind, itemBase, itemKind, itemFor, itemKey, keyName, TOOL_OF } from './place.js';
import { emptyDoc, styleOf, lookOf } from './document.js';
import { folderOf, byName } from './library.js';
import { icon, KIND_ICON, POINT_ICON, SYMBOL_ICON } from '../icons.js';

const KIND_TYPE = 'application/x-earthplotter-kind'; // a row dragged: the kind it places
const M = 111320; // metres to a degree, at the equator (where an item is laid out to be measured)

// A point item laid out facing north about [0, 0] (as placed), measured once: its shapes shown (else all
// of them, an item whose shapes are all hidden), in metres east and north of its point
const laid = new WeakMap();
function layout(x) {
  if (laid.has(x)) return laid.get(x);
  const doc = emptyDoc(0), pt = placeKind(doc, [0, 0], itemKey(x.name), [x]);
  const xy = ([lon, lat]) => [lon * M, lat * M];
  let circles = doc.circles, lines = doc.lines.filter((l) => l.closed);
  if (![...circles, ...lines].some((e) => e.visible)) { circles = circles.map((c) => ({ ...c, visible: true })); lines = lines.map((l) => ({ ...l, visible: true })); }
  circles = circles.filter((c) => c.visible).map((c) => ({ c: xy(c.position), r: c.radius, aperture: c.aperture, bearing: c.bearing, st: styleOf(doc, c) }));
  lines = lines.filter((l) => l.visible).map((l) => ({ pts: l.points.map(xy), st: styleOf(doc, l) }));
  const ext = [...circles.flatMap(({ c, r }) => [[c[0] - r, c[1] - r], [c[0] + r, c[1] + r]]), ...lines.flatMap((l) => l.pts)];
  const box = ext.length ? [Math.min(...ext.map((p) => p[0])), Math.min(...ext.map((p) => p[1])), Math.max(...ext.map((p) => p[0])), Math.max(...ext.map((p) => p[1]))] : null;
  const out = { symbol: pt.symbol, circles, lines, box };
  laid.set(x, out);
  return out;
}

// a size to tell items apart, not to measure by (Properties has the exact one): two figures at most
// ("0.8", "6.1", "14", "30"), then its unit: metres, then km or NM as the drawing's units say
const NM = 1852;
const figure = (v) => +v.toFixed(v < 10 ? 1 : 0);
const short = (m, units) => (m < 1000 ? `${figure(m)} m` : units === 'nm' ? `${figure(m / NM)} NM` : `${figure(m / 1000)} km`);
// what a point item measures: its largest circle's radius, else its outline's extent, the larger side first
// (as placed, facing north), in the larger's unit
export function sizeOf(x, units) {
  if (itemKind(x) !== 'point') return ''; // a line's, an area's, a label's: a look, no size
  const { circles, box } = layout(x);
  if (circles.length) return `r ${short(Math.max(...circles.map((c) => c.r)), units)}`;
  if (!box) return '';
  const [big, small] = [box[3] - box[1], box[2] - box[0]].sort((p, q) => q - p), [num, unit] = short(big, units).split(' ');
  return `${num} × ${figure(small * (num / big))} ${unit}`;
}

// An item's picture (24 × 24, as the icons): its shapes shown, in their own colours, fitted; a point
// alone its symbol
export function thumbOf(x) {
  const kind = itemKind(x);
  if (kind !== 'point') return lookThumb(x, kind);
  const { symbol, circles, lines, box } = layout(x);
  if (!box) return icon(...(SYMBOL_ICON[symbol]?.length ? SYMBOL_ICON[symbol] : KIND_ICON.point));
  const span = Math.max(box[2] - box[0], box[3] - box[1]) || 1, k = 20 / span;
  const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
  const at = ([e, n]) => [12 + (e - cx) * k, 12 - (n - cy) * k]; // north up
  const paint = (st) => ({ stroke: st.stroke.color, 'stroke-opacity': st.stroke.opacity, fill: st.fill.opacity > 0 ? st.fill.color : 'none', 'fill-opacity': Math.max(st.fill.opacity, 0.15),
    'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke', ...(st.stroke.dash === 'dashed' ? { 'stroke-dasharray': '3 2' } : {}) });
  const shapes = [
    ...[...circles].sort((a, b) => b.r - a.r).map(({ c, r, aperture, bearing, st }) => {
      const [x0, y0] = at(c), rr = Math.max(r * k, 0.75);
      if (!aperture) return svg('circle', { cx: x0, cy: y0, r: rr, ...paint(st) });
      const end = (a) => [x0 + rr * Math.sin((a * Math.PI) / 180), y0 - rr * Math.cos((a * Math.PI) / 180)];
      const [a1, a2] = [end(bearing - aperture / 2), end(bearing + aperture / 2)];
      return svg('path', { d: `M${x0} ${y0}L${a1[0]} ${a1[1]}A${rr} ${rr} 0 ${aperture > 180 ? 1 : 0} 1 ${a2[0]} ${a2[1]}Z`, ...paint(st) });
    }),
    ...lines.map(({ pts, st }) => svg('polygon', { points: pts.map(at).map((p) => p.join(',')).join(' '), ...paint(st) })),
  ];
  return svg('svg', { viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': 'true', class: 'thumb' }, ...shapes);
}

// The Library's items: what a row draws, as [tool, its variant]: a point, a line, an area (a line
// closed as it ends), a label, else a shape (a built-in kind or a point item: the Shape tool's)
const BASIC = { 'tool:point': ['point', null, 'Point', KIND_ICON.point], 'tool:line': ['line', 'line', 'Line', KIND_ICON.line],
  'tool:area': ['line', 'area', 'Area', KIND_ICON.polygon], 'tool:label': ['label', 'label', 'Label', KIND_ICON.label] };
export function itemTool(v, library) {
  if (BASIC[v]) return BASIC[v].slice(0, 2);
  const mine = itemFor(library, v);
  return [mine ? TOOL_OF[itemKind(mine)] : 'shape', v];
}
// the item being drawn now (from the tool on and its variant), or null
export function itemNow(drawing) {
  const t = drawing.button, v = drawing.variant[t];
  if (t === 'shape' || keyName(v) !== null) return v;
  return { point: 'tool:point', label: 'tool:label', line: v === 'area' ? 'tool:area' : 'tool:line' }[t] ?? null;
}
// what an item is called: one of the user's by its full name ("Folder / Name"), a built-in by its own
export const itemName = (v) => keyName(v) ?? BASIC[v]?.[2] ?? builtInName(v) ?? v;
// a line's, an area's or a label's picture: a stroke as it draws one, a swatch, "Aa" in its colour
const stroke = (st) => ({ stroke: st.stroke.color, 'stroke-opacity': st.stroke.opacity, 'stroke-width': Math.min(Math.max(st.stroke.width, 1), 4),
  ...(st.stroke.dash === 'dashed' ? { 'stroke-dasharray': '4 2.5' } : st.stroke.dash === 'dotted' ? { 'stroke-dasharray': '0.1 3', 'stroke-linecap': 'round' } : {}) });
function lookThumb(x, kind) {
  const box = (...kids) => svg('svg', { viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': 'true', class: 'thumb' }, ...kids);
  if (kind === 'label') {
    const t = lookOf(x.doc, x.doc.labels[0]).text;
    return box(...(t.background === 'box' ? [svg('rect', { x: 2, y: 5, width: 20, height: 14, rx: 2, fill: '#fff', stroke: t.color })] : []),
      svg('text', { x: 12, y: 16.5, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 600, fill: t.color }, 'Aa'));
  }
  const st = styleOf(x.doc, x.doc.lines[0]);
  if (kind === 'area') return box(svg('rect', { x: 3, y: 5, width: 18, height: 14, rx: 1, fill: st.fill.opacity > 0 ? st.fill.color : 'none', 'fill-opacity': Math.max(st.fill.opacity, 0.15), ...stroke(st) }));
  return box(svg('path', { d: 'M2 17 8 9l6 6 8-9', fill: 'none', 'stroke-linejoin': 'round', ...stroke(st) }));
}

// an item's picture: a built-in's icon, the user's own its own
const itemPicture = (v, library) => {
  const mine = itemFor(library, v);
  return mine ? thumbOf(mine) : icon(...(BASIC[v]?.[3] || POINT_ICON[v] || KIND_ICON.shape));
};
const BUILT_INS = [...Object.keys(BASIC), ...BUILT_IN]; // the Built-in folder, in order
const FOLDED = 'earthplotter.draw.folded'; // the folders folded, kept in this browser

// drawing (drawing.js); root: the tab's body; frame (frame.js: a phone's sheet folded while drawing);
// changed(): the user's items changed. Returns { render(force) }.
export function createDrawTab(drawing, root, { frame, changed }) {
  let filter = '', sig = '', folding = false; // folding: a phone's sheet folded away for drawing, back when the tool goes off
  const kept = store.json(FOLDED);
  const folded = new Set(Array.isArray(kept) ? kept : []);
  const fold = (id, open) => { if (open) folded.add(id); else folded.delete(id); store.set(FOLDED, JSON.stringify([...folded])); render(true); };
  const filterInput = h('input', { type: 'search', placeholder: 'Filter by name', 'aria-label': 'Filter what to draw', oninput: (e) => { filter = e.target.value; render(true); } });
  const list = h('ul', { class: 'dlist', 'aria-label': 'What to draw' });
  root.append(h('div', { class: 'dfilter' }, filterInput), list);

  // a row clicked: drawing it, or (the one being drawn) no longer; a phone: the sheet out of the way
  // while it is drawn
  const choose = (v) => {
    if (itemNow(drawing) === v) return drawing.stop();
    const [tool, variant] = itemTool(v, drawing.library);
    if (variant) drawing.variant[tool] = variant;
    drawing.start(tool);
    if (NARROW.matches && frame.tab === 'draw') { folding = true; frame.toggleTab('draw'); }
  };

  // a folder's head: its fold, its name, how many it holds
  const head = (id, name, n, open) => h('li', { class: 'drow dgroup' },
    h('button', { type: 'button', class: 'dfold', 'aria-expanded': String(open), 'aria-label': `Show what ${name} holds`, onclick: () => fold(id, open) }),
    h('span', { class: 'kind' }, icon(...KIND_ICON.group)),
    h('button', { type: 'button', class: 'dname', onclick: () => fold(id, open) }, name),
    h('span', { class: 'val' }, String(n)));
  // an item's row: its picture, its name, its size; pressed while it is being drawn; one placed in a
  // click (a point, a shape) dragged onto the map, placed there
  const row = (v, name, size, more = null) => {
    const drags = itemTool(v, drawing.library)[0] === 'shape' || v === 'tool:point', on = itemNow(drawing) === v;
    return h('li', { class: `drow d1${on ? ' sel' : ''}`, draggable: String(drags),
      ondragstart: drags ? (e) => { e.dataTransfer.setData(KIND_TYPE, v); e.dataTransfer.effectAllowed = 'copy'; } : null },
    h('span', { class: 'dfold none', 'aria-hidden': 'true' }),
    h('span', { class: 'kind' }, itemPicture(v, drawing.library)),
    h('button', { type: 'button', class: 'dname', 'aria-pressed': String(on), title: on ? 'Being drawn: click to stop (Esc)' : drags ? 'Click, then on the map; or drag it there' : 'Click, then on the map', onclick: () => choose(v) }, name),
    h('span', { class: 'val' }, size), more);
  };

  function render(force = false) {
    if (folding && !drawing.tool) { folding = false; if (NARROW.matches && !frame.tab) frame.toggleTab('draw'); } // drawn: a phone's sheet back
    if (root.closest('[hidden]')) return; // built when its tab is seen
    const now = [drawing.library.map((x) => x.name).join('\n'), itemNow(drawing), drawing.units()].join('|');
    if (!force && now === sig) return; // nothing it shows changed (a drawing's change is not its business)
    sig = now;
    const f = filter.trim().toLowerCase(), hit = (name) => !f || name.toLowerCase().includes(f), u = drawing.units();
    const rows = [];
    const section = (id, name, items) => { // items: [v, name, size, more]
      if (!items.length) return;
      const open = !!f || !folded.has(id);
      rows.push(head(id, name, items.length, open));
      if (open) rows.push(...items.map((x) => row(...x)));
    };
    section('', 'Built-in', BUILT_INS.filter((k) => hit(itemName(k))).map((k) => [k, itemName(k), ''])); // folded or not as the user left it
    const mine = drawing.library.filter((x) => hit(x.name));
    const folders = [...new Set(mine.map((x) => folderOf(x.name)))].sort((a, b) => (!a - !b) || byName(a, b)); // folders, then the items in none
    for (const fo of folders) {
      const items = mine.filter((x) => folderOf(x.name) === fo).sort((a, b) => byName(a.name, b.name))
        .map((x) => [itemKey(x.name), itemBase(x.name), sizeOf(x, u), moreBtn(x.name)]);
      if (fo) section(`f:${fo}`, fo, items);
      else rows.push(...items.map((x) => row(...x))); // loose: at the end, no head
    }
    if (!drawing.library.length && !f) rows.push(h('li', { class: 'empty' }, 'Add your own from an element\'s Properties.'));
    else if (!rows.length) rows.push(h('li', { class: 'empty' }, 'Nothing matches the filter.'));
    list.replaceChildren(...rows);
  }

  // an item's ⋯: renamed (its folder with it), duplicated, deleted
  const moreBtn = (name) => h('button', { type: 'button', class: 'more', 'aria-label': `${name}: rename, duplicate or delete`, title: 'Rename, duplicate or delete', onclick: () => manage(name) }, '⋯');
  async function manage(name) {
    const a = await ask('Library item', `“${name}”`, [['delete', 'Delete'], ['duplicate', 'Duplicate'], ['rename', 'Rename…']]);
    if (a === 'delete') drawing.setLibrary(drawing.library.filter((x) => x.name !== name));
    if (a === 'rename' || a === 'duplicate') {
      const start = a === 'rename' ? name : `${name} copy`;
      const to = (await askText(a === 'rename' ? 'Rename' : 'Duplicate', 'Name (Folder / Name)', start))?.trim();
      if (!to || to === name) return;
      if (drawing.library.some((x) => x.name === to)) return note(`The library already has “${to}”`);
      const x = drawing.library.find((p) => p.name === name);
      if (a === 'rename') drawing.setLibrary(drawing.library.map((p) => (p === x ? { ...p, name: to } : p)), [name, to]);
      else drawing.setLibrary([...drawing.library, { ...x, name: to }]);
    }
    if (!a) return;
    changed();
    render(true);
  }

  // a row dropped on the map: its kind placed there (its default size; an item of the user's its own), selected
  const box = drawing.map.getContainer();
  box.addEventListener('dragover', (e) => { if (e.dataTransfer?.types.includes(KIND_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  box.addEventListener('drop', (e) => {
    const v = e.dataTransfer?.getData(KIND_TYPE);
    if (!v) return;
    e.preventDefault();
    const r = box.getBoundingClientRect(), p = drawing.map.unproject([e.clientX - r.left, e.clientY - r.top]);
    let el;
    if (!drawing.change((doc) => { el = placeKind(doc, [p.lng, p.lat], itemTool(v, drawing.library)[1], drawing.library); })) return;
    drawing.select([el.id]);
    changed();
  });

  return { render };
}
