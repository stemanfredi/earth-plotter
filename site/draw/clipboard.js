// Copy, paste, duplicate (docs/drawing-ui.md §8). A copy keeps its group (when the drawing has
// it), its look and properties; a point's shapes are copied with it, a shape copied alone is free; it gets new IDs and numbered names, and keeps the links between the
// elements copied together (a line's vertex linked to an element left behind is free; a label on one
// keeps pointing at it, if it is in the drawing, else is free where it pointed). The clipboard holds the
// elements as the document does, in this page, so they paste into another drawing opened in it too.
// Pure.

import { leavesOf, positionsIn, newId, takenIds, KIND, nextName, emptyDoc, carry } from './document.js';
import { targetPosition } from './attach.js';
import { samePosition } from '../geo.js';
import { extentOf } from './features.js';

const clone = (x) => structuredClone(x);

// The elements ids as a clipboard: { items: [{ kind, el }], links: the links from their vertices and anchors } (for
// a group, everything in it; for a point, its shapes; the groups themselves are not copied).
export function clipOf(doc, ids) {
  const items = leavesOf(doc, ids).map(({ kind, el }) => ({ kind, el: clone(el) })), mine = new Set(items.map((x) => x.el.id));
  return { items, links: clone(doc.links.filter((l) => mine.has(l.from[0]))) };
}

// the middle of what a clipboard holds (its bounding box's centre), or null
export function centreOf(clip) {
  const b = extentOf(clip.items.flatMap(({ kind, el }) => positionsIn(kind, el).map(([o, k]) => o[k])));
  return b && [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}
// "Point 4" → "Point"; a name with no number of its own is its own base
const baseOf = (name) => /^(.*\S) \d+$/.exec(name)?.[1] ?? name;
// the next free name on base (document.js nextName), or '' for a name that was empty
const nameOn = (doc, kind, base) => (base ? nextName(doc, kind, base) : '');

// The clipboard pasted into doc, each position moved by mv(position): the new elements, in order.
// Each gets a numbered name, but those whose kind keep(kind) says: their names as copied.
export function paste(doc, clip, mv, keep = () => false) {
  const taken = takenIds(doc), ids = new Map(), groups = new Set(doc.groups.map((g) => g.id));
  const points = new Set(clip.items.filter((x) => x.kind === 'point').map((x) => x.el.id)); // each carried, its shapes with it (below)
  for (const { el } of clip.items) ids.set(el.id, newId(doc, taken));
  const made = [];
  for (const { kind, el: src } of clip.items) {
    const el = clone(src);
    el.id = ids.get(src.id);
    el.name = keep(kind) ? src.name : nameOn(doc, kind, baseOf(src.name));
    el.groupId = ids.get(el.groupId) ?? (groups.has(el.groupId) ? el.groupId : null); // a shape in the copy of its point
    if (kind !== 'point' && !points.has(src.groupId)) for (const [o, k] of positionsIn(kind, el)) o[k] = mv(o[k]);
    doc[KIND[kind].list].push(el);
    made.push({ kind, el });
  }
  for (const { kind, el } of made) if (kind === 'point') carry(doc, el, mv(el.position)); // its shapes exactly as they were about it
  // a link among the elements copied: to the copy; a label's to an element left behind: kept only if
  // that element is where the label pointed when copied (the same drawing: the same element; another
  // drawing's element of the same ID is not it), else the label free where it points
  const copied = new Map(clip.items.map((x) => [x.el.id, x]));
  const same = (from, to) => { const x = copied.get(from[0]), q = x?.kind === 'label' && targetPosition(doc, to); return !!q && samePosition(q, x.el.position); };
  for (const { from, to } of clip.links) {
    const keep = ids.has(to.element) || same(from, to);
    if (keep) doc.links.push({ from: [ids.get(from[0]), from[1]], to: { ...to, element: ids.get(to.element) ?? to.element } });
  }
  return made;
}
// paste's keep for a point and its shapes: the shapes keep their names (its point names them)
export const shapesKeep = (kind) => kind !== 'point';
// point id of doc and its shapes, as they are, in a drawing of their own (a Library item; a rule's copy as its
// template): the point shown, its shapes shown or hidden as they are (a copy placed from it is so), and no
// guide; each shape keeps its name
export function alone(doc, id) {
  const d = emptyDoc(0);
  for (const { kind, el } of paste(d, clipOf(doc, [id]), (q) => q, shapesKeep)) {
    if (kind === 'point') el.visible = true;
    if (kind !== 'label') el.guide = false;
  }
  return d;
}
