// What the Point and Shape tools place (docs/drawing-ui.md §9): a point, and the shapes it holds. The
// Shape tool's kinds are built in (build); the Library's own points are kept with their shapes,
// placed again as copies (placeCopy). Pure: it changes the document given; the caller keeps the undo
// step.

import { addPoint, addCircle, addLine, nextName, carry } from './document.js';
import { OUTLINES, OUTLINE_NAME, outlinePoints } from './outlines.js';
import { inverse } from '../geodesy.js';
import { unrollTo } from '../geo.js';
import { clipOf, paste, shapesKeep } from './clipboard.js';

// A Library item (library.js) as a tool's variant and a rule's copy say it: 'library:<name>'
const PREFIX = 'library:';
export const itemKey = (name) => `${PREFIX}${name}`;
// the name such a key says, or null (a built-in kind's)
export const keyName = (v) => (typeof v === 'string' && v.startsWith(PREFIX) ? v.slice(PREFIX.length) : null);
// what an item is: 'point' (with its shapes), 'line', 'area' (a closed line) or 'label'; the tool drawing it
export const itemKind = (x) => (x.doc.points.length ? 'point' : x.doc.lines.length ? (x.doc.lines[0].closed ? 'area' : 'line') : 'label');
export const TOOL_OF = { point: 'shape', line: 'line', area: 'line', label: 'label' };
// the item a key says, in list, or null; tool given: only one that tool draws (a key kept by a tool
// may name an item replaced since by another kind)
export function itemFor(list, v, tool = null) {
  const n = keyName(v), x = n === null ? null : list.find((y) => y.name === n) ?? null;
  return x && (!tool || TOOL_OF[itemKind(x)] === tool) ? x : null;
}

// what a built-in kind is called: "Circle", "Rings", "Rectangle"…
const KIND_NAME = { circle: 'Circle', rings: 'Rings', sector: 'Sector', ...OUTLINE_NAME };
export const builtInName = (kind) => KIND_NAME[kind];
export const BUILT_IN = Object.keys(KIND_NAME);

// A built-in kind at p: a point (no symbol, named after the kind, no property: only a Library item
// names itself, fromLibrary) and its shapes, facing north, the largest reaching d metres (a circle's radius, an outline's half
// length; 0: its own size). Its own size: a circle of 1 km; rings at 1, 2 and 3 km (the first
// filled); a sector of 1 km, aperture wide; an outline 100 × 50 m (a triangle equilateral, 100 m a
// side), or size ([length, width]: a box's). Returns the point.
export function build(doc, p, kind, d = 0, { aperture = 90, size = null } = {}) {
  const pt = addPoint(doc, p, { symbol: 'none', name: nextName(doc, 'point', KIND_NAME[kind]) });
  const r3 = (v) => Math.round(Math.max(v, 0.001) * 1000) / 1000, held = { groupId: pt.id, name: '' }; // a held shape has no name of its own: the point's names them
  if (OUTLINES.includes(kind)) {
    const [l, w] = size ?? (kind === 'triangle' ? [50 * Math.sqrt(3), 100] : [100, 50]), k = d > 0 ? (2 * d) / l : 1;
    addLine(doc, outlinePoints(p, 0, r3(l * k), r3(w * k), kind), { ...held, closed: true });
  } else {
    const radii = kind === 'rings' ? [1000, 2000, 3000] : [1000], k = d > 0 ? d / radii.at(-1) : 1;
    radii.forEach((r, i) => addCircle(doc, p, { ...held, radius: r3(r * k), ...(kind === 'sector' ? { aperture } : {}), ...(i ? { look: { fill: { opacity: 0 } } } : {}) }));
  }
  return pt;
}

// A copy of the first point of tpl (a drawing: a Library item's, or a rule's copy) and of its shapes, at p
// facing bearing, in group groupId: pasted where it is, then carried there and turned; its shapes keep
// their names (a point's shapes need not be told apart by name). Returns the point.
export function placeCopy(doc, tpl, p, bearing = 0, groupId = null) {
  const pt = paste(doc, clipOf(tpl, [tpl.points[0].id]), (q) => q, shapesKeep)[0].el;
  pt.groupId = groupId;
  carry(doc, pt, p, bearing);
  return pt;
}

// A copy placed from a Library item keeps its properties, with the property library naming the item
// (set, or replaced: the item's point may have been placed from another)
export function fromLibrary(pt, name) {
  pt.properties = [...pt.properties.filter((x) => x.key !== 'library'), { key: 'library', value: name }];
}

// A line or a label drawn with a Library item (a line's, an area's, a label's): its look, its
// properties with the property library naming it, a line's guide and curve, a label's text; a line named
// after it
export function styleLike(doc, el, kind, mine) {
  const tpl = kind === 'label' ? mine.doc.labels[0] : mine.doc.lines[0];
  if (!tpl) return;
  el.look = structuredClone(tpl.look ?? {});
  el.properties = structuredClone(tpl.properties ?? []);
  fromLibrary(el, mine.name);
  if (kind === 'label') { el.text = tpl.text; return; }
  el.guide = tpl.guide; el.smooth = tpl.smooth;
  el.name = nextName(doc, 'line', itemBase(mine.name));
}

// what a point placed from a Library item is named after: its name, without its folder ("Folder / Name")
export const itemBase = (name) => name.split(' / ').at(-1).trim() || 'Point';

// What the Point or the Shape tool places at p, by the tool's kind: a built-in kind (Shape), a Library
// item ('library:<name>', which names itself in the property library: a built-in sets none),
// else a diamond (Point). Each faces north: its bearing is set afterwards (the stalk, the inspector),
// so that a shape does not swing while it is sized. d (the Shape tool's second click, metres from the
// centre): a built-in's largest shape reaches it; 0: its own size. A Library item keeps its size.
export function placeKind(doc, p, kind, library, d = 0) {
  const mine = itemFor(library, kind, 'shape');
  if (mine) {
    const name = nextName(doc, 'point', itemBase(mine.name)), pt = placeCopy(doc, mine.doc, p); // named before the copy takes a name
    pt.name = name;
    fromLibrary(pt, mine.name);
    return pt;
  }
  return KIND_NAME[kind] ? build(doc, p, kind, d) : addPoint(doc, p); // a symbol
}

// The kinds drawn corner to corner (their box): the first click one corner, the second the opposite
// one; square (Shift): as long as wide, the larger of the two
export const BOX = new Set(['rectangle', 'ellipse']);
export function placeBox(doc, a, b, kind, square = false) {
  b = unrollTo(a, b); // across the antimeridian: the box between them, not round the world
  const centre = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let length = inverse([centre[0], a[1]], [centre[0], b[1]]).s, width = inverse([a[0], centre[1]], [b[0], centre[1]]).s; // north-south, east-west
  if (square) length = width = Math.max(length, width);
  return build(doc, centre, kind, 0, { size: [length, width] });
}
