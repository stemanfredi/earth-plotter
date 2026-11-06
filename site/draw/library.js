// The Library's own items (docs/drawing-ui.md §9), each kept under a name ("Folder / Name"): a point
// with its shapes (sizes and bearings as they are about it, shown or hidden), its symbol and its look,
// placed again by the Shape tool; or a line, an area or a label, its look and properties (a label: its
// text) given to each one drawn with it. Shown and chosen in the Draw tab (drawtab.js). Each is
// a small drawing of its own ({ name, doc }), kept as a drawing's file is. They live in this browser
// only, never in the app or a drawing's file; a small file of their own moves them to another browser
// (Download › Library, Open a file…). Local storage may be missing or refuse: every access is guarded.

import { parse, toFile } from './file.js';
import { alone, clipOf, paste } from './clipboard.js';
import { emptyDoc, find } from './document.js';
import { itemKind } from './place.js';
import { store } from '../dom.js';
import { note } from '../menu.js';

const KEY = 'earthplotter.library'; // the items in this browser
const FORMAT = 'earthplotter-library'; // a library's file

// as kept: each item's drawing as its file's object
const kept = (list) => list.map((x) => ({ name: x.name, drawing: toFile(x.doc) }));
export function loadLibrary() {
  const v = store.json(KEY);
  return Array.isArray(v) ? clean(v) : [];
}
export function saveLibrary(list) {
  if (!store.set(KEY, JSON.stringify(kept(list)))) note('The library could not be saved in this browser (storage full or turned off)');
}
// element id of doc as an item named name: a drawing of it (a point: with its shapes, as they are; a
// line or a label alone, shown, its name kept, not a measurement)
export function itemOf(doc, id, name) {
  if (find(doc, id)?.kind === 'point') return { name, doc: alone(doc, id) };
  const d = emptyDoc(0), clip = clipOf(doc, [id]);
  for (const [i, { el }] of paste(d, clip, (q) => q).entries()) { el.name = clip.items[i].el.name; el.visible = true; el.measure = false; }
  return { name, doc: d };
}
// the library as a file, and back (what is not an item left out); null: not a library's file
export const libraryFile = (list) => `${JSON.stringify({ format: FORMAT, items: kept(list) }, null, 2)}\n`;
export function readLibrary(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return null; }
  return raw?.format === FORMAT && Array.isArray(raw.items) ? clean(raw.items) : null;
}
// the items whose drawing reads (as a file is: what is not valid left out) and holds a point, a line
// or a label, each name once
function clean(list) {
  const seen = new Set();
  return list.filter((x) => x && typeof x.name === 'string' && x.name.trim() && !seen.has(x.name) && seen.add(x.name))
    .map((x) => ({ name: x.name, doc: parse(JSON.stringify(x.drawing ?? null)).doc })).filter((x) => x.doc && (x.doc.points.length || x.doc.lines.length || x.doc.labels.length));
}
// whether an item is a point holding shapes (Distribute along repeats only those)
export const hasShapes = (x) => itemKind(x) === 'point' && !!(x.doc.circles.length || x.doc.lines.length);
// an item's folder: what its name says before its last " / " ("A / B / C": "A / B"), or ''
export const folderOf = (name) => { const i = name.lastIndexOf(' / '); return i < 0 ? '' : name.slice(0, i).trim(); };
// names in the order people read them: "70 kHz" before "100 kHz", case aside
export const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
