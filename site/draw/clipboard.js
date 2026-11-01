// Copy, paste, duplicate (docs/drawing-ui.md §8). A copy keeps its group (when the drawing has
// it), its look and properties; a point's shapes are copied with it, a shape copied alone is free; it gets new IDs and numbered names, and keeps the links between the
// elements copied together (a line's vertex linked to an element left behind is free; a label on one
// keeps pointing at it, if it is in the drawing, else is free where it pointed). The clipboard holds the
// elements as the document does, in this page, so they paste into another drawing opened in it too.
// Pure.

import { find, leavesOf, positionsIn, newId, idsOf, KIND, nextName, emptyDoc, follow } from './document.js';
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
export function paste(doc, clip, mv) {
  const taken = idsOf(doc), ids = new Map(), groups = new Set(doc.groups.map((g) => g.id));
  for (const { el } of clip.items) ids.set(el.id, newId(doc, taken));
  const made = [];
  for (const { kind, el: src } of clip.items) {
    const el = clone(src);
    el.id = ids.get(src.id);
    el.name = nameOn(doc, kind, baseOf(src.name));
    if (!ids.has(el.groupId)) delete el.frame; // a shape copied without its point: free
    el.groupId = ids.get(el.groupId) ?? (groups.has(el.groupId) ? el.groupId : null); // a shape in the copy of its point
    for (const [o, k] of positionsIn(kind, el)) o[k] = mv(o[k]);
    doc[KIND[kind].list].push(el);
    made.push({ kind, el });
  }
  for (const { kind, el } of made) if (kind === 'point') follow(doc, el); // its shapes as its frame holds them: exactly as they were about it
  for (const { from, to } of clip.links) {
    const keep = ids.has(to.element) || (doc.labels.some((a) => a.id === ids.get(from[0])) && find(doc, to.element));
    if (keep) doc.links.push({ from: [ids.get(from[0]), from[1]], to: { ...to, element: ids.get(to.element) ?? to.element } });
  }
  return made;
}
// point id of doc and its shapes, as they are, in a drawing of their own (a preset; a rule's copy as its
// template): every one shown and no guide, as a copy placed from it is
export function alone(doc, id) {
  const d = emptyDoc(0);
  for (const { kind, el } of paste(d, clipOf(doc, [id]), (q) => q)) { el.visible = true; if (kind !== 'label') el.guide = false; }
  return d;
}
