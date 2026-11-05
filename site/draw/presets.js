// The user's own presets (docs/drawing-ui.md §9): a point kept under a name ("Folder / Name") with its
// shapes (sizes and bearings as they are about it, shown or hidden), its symbol and its look, placed
// again from the Library (library.js) by the Shape tool. Each is a small drawing of its own ({ name, doc }),
// kept as a drawing's file is. They live in this browser only, never in the app or a drawing's file; a
// small file of their own moves them to another browser (Download › Library, Open a file…). Local
// storage may be missing or refuse: every access is guarded.

import { parse, toFile } from './file.js';
import { alone } from './clipboard.js';
import { store } from '../dom.js';
import { note } from '../menu.js';

const KEY = 'earthplotter.presets';
const PRESETS_FORMAT = 'earthplotter-presets';

// as kept: each preset's drawing as its file's object
const kept = (list) => list.map((x) => ({ name: x.name, drawing: toFile(x.doc) }));
export function loadPresets() {
  const v = store.json(KEY);
  return Array.isArray(v) ? clean(v) : [];
}
export function savePresets(list) {
  if (!store.set(KEY, JSON.stringify(kept(list)))) note('The presets could not be saved in this browser (storage full or turned off)');
}
// point id of doc as a preset named name: a drawing of it and its shapes, as they are
export const presetOf = (doc, id, name) => ({ name, doc: alone(doc, id) });
// the presets as a file, and back (what is not a preset left out); null: not a presets file
export const presetsFile = (list) => `${JSON.stringify({ format: PRESETS_FORMAT, presets: kept(list) }, null, 2)}\n`;
export function readPresets(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { return null; }
  return raw?.format === PRESETS_FORMAT && Array.isArray(raw.presets) ? clean(raw.presets) : null;
}
// the presets whose drawing reads (as a file is: what is not valid left out) and holds a point, each
// name once
function clean(list) {
  const seen = new Set();
  return list.filter((x) => x && typeof x.name === 'string' && x.name.trim() && !seen.has(x.name) && seen.add(x.name))
    .map((x) => ({ name: x.name, doc: parse(JSON.stringify(x.drawing ?? null)).doc })).filter((x) => x.doc?.points.length);
}
// whether a preset holds shapes (Distribute along repeats only those)
export const hasShapes = (x) => !!(x.doc.circles.length || x.doc.lines.length);
// a preset's folder: what its name says before its last " / " ("A / B / C": "A / B"), or ''
export const folderOf = (name) => { const i = name.lastIndexOf(' / '); return i < 0 ? '' : name.slice(0, i).trim(); };
// names in the order people read them: "70 kHz" before "100 kHz", case aside
export const byName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
