// The placing tools of the drawing (drawing.js, which takes these methods): the Line tool and
// Measure, Shape (two clicks, corner to corner, a sector in three), the Point tool and the Label tool;
// what is being drawn, its features and its values on the map. Methods of Drawing: this is the
// drawing (its map, document, draft and cursor).

import { emptyDoc, addLine, addLabel, find, nextName, KIND, lookOf, setLook, setLink, carry, ringOf } from './document.js';
import { placeKind, placeBox, build, BOX, styleLike } from './place.js';
import { itemKind, itemFor, keyName } from './library.js';
import { norm360 } from '../geo.js';
import { valueFeatures } from './features.js';
import { lineTrace, nearestAlong } from './lines.js';
import { inverse } from '../geodesy.js';
import { snapAt } from './snap.js';
import { attachAt, lineRef, resolve } from './attach.js';
import { SNAP_PX, guideWithValues, DRAFT_ID } from './input.js';

export class Drafting {
  // ---- the Line tool: its vertices, by clicks (drawing-ui.md §2.1) ----------
  // The Line tool, and Measure (drawing-ui.md §3) as it: each click a vertex, snapped (the Line tool's,
  // each on what it snapped to, attached there when it is made; a measurement's to nothing); Enter, a
  // double-click or Done ends it, a click on its first vertex closes it (a ring). What is measured
  // goes in the drawing as a measurement (measure: a guide of its own colour, its legs' lengths shown
  // as it is drawn), selected: saved and printed with it, deleted as anything else.
  lineClick(point, e) {
    if (this.closesPath(point)) return this.finishLine(true);
    const r = this.snapFor(point, e, { ...this.lastLeg(), attaches: this.tool === 'line' }), p = r.position, to = this.tool === 'line' ? r.to : null;
    const d = (this.draft ??= { pts: [], tos: [] }), last = d.pts.at(-1); // a double-click's second click: the same place
    if (!last || last[0] !== p[0] || last[1] !== p[1]) { d.pts.push(p); d.tos.push(to ?? null); }
    this.renderMarks();
    this.onChange('draft');
  }
  // the line made (closed: "Area n"; a measurement "Distance n"): each vertex attached to
  // the points they snapped to (on another line, a point shared there: attach.js attachAt), one undo
  // step; the tool stays on for the next
  // the Library item a tool's variant names ('library:<name>'), or null
  libraryItem(v) { return itemFor(this.library, v); }
  finishLine(closed = false) {
    const d = this.draft, measured = this.tool === 'measure';
    if (!(d?.pts.length > 1)) return; // no second point: nothing to make yet
    const mine = this.tool === 'line' ? this.libraryItem(this.variant.line) : null; // an item's line or area: its look and properties
    if (this.tool === 'line' && (this.variant.line === 'area' || (mine && itemKind(mine) === 'area'))) { if (d.pts.length < 3) return; closed = true; } // an area: closed as it ends, three vertices at least
    this.draft = null;
    let seg;
    this.change((doc) => {
      const name = closed ? 'Area' : measured ? 'Distance' : null;
      seg = addLine(doc, d.pts, { closed, ...(name ? { name: nextName(doc, 'line', name) } : {}), ...(measured ? guideWithValues() : {}) });
      if (mine) styleLike(doc, seg, 'line', mine);
      d.pts.forEach((position, i) => setLink(doc, seg.id, i, attachAt(doc, { position, to: d.tos[i] }))); // each vertex where it snapped, as its mark said
    });
    this.select([seg.id]);
    this.onChange('draft');
  }
  undoPoint() {
    const d = this.draft;
    if (!d) return;
    if (d.pts.length > 1 && this.tool !== 'shape') { d.pts.pop(); d.tos?.pop(); } else this.draft = null;
    this.renderMarks();
    this.onChange('draft');
  }
  cancelDraft() { this.draft = null; this.renderMarks(); this.onChange('draft'); }
  // the line or measurement being drawn, three points or more so far: the pointer on its first point (a
  // click there closes it)
  pathPoints() { return this.finishesOnDoubleClick() ? this.draft?.pts ?? [] : []; }
  closesPath(point) {
    const pts = this.pathPoints();
    if (pts.length < 3) return false;
    const q = this.map.project(pts[0]);
    return Math.hypot(q.x - point.x, q.y - point.y) <= SNAP_PX;
  }
  // the keys' (keyEvents): Enter or a double-click ends the line or measurement being drawn;
  // Esc drops it, or else ends the tool
  finish() { if (this.finishesOnDoubleClick()) this.finishLine(); }
  escape() {
    if (this.tool === 'sector' && this.draft?.pts.length) return this.undoPoint(); // one click back
    if (this.draft) this.cancelDraft();
    else this.stop();
  }
  finishesOnDoubleClick() { return ['line', 'measure'].includes(this.tool); }
  // Shape, in two clicks: the centre; then the size, the pointer showing it (a
  // circle's radius, an outline's front): a point and its shapes; a rectangle or an ellipse (place.js BOX) corner to corner
  // instead (Shift: a square, a circle). A second click on the first: the default size, centred there.
  // Facing north always (the bearing is set afterwards); a Library item, which has its size, in
  // one click.
  boxing() { return BOX.has(this.variant.shape); }
  shapeClick(point, e) {
    if (!this.draft) {
      const r = this.snapFor(point, e);
      this.draft = { pts: [r.position] };
      this.cursor = { point, p: r.position, snap: r, shift: !!e?.shiftKey }; // its preview from here, until the pointer moves
      if (keyName(this.variant.shape) !== null) return this.finishShape(null); // a Library item has its size: one click
      this.renderMarks();
      return this.onChange('draft');
    }
    const c = this.map.project(this.draft.pts[0]);
    if (Math.hypot(c.x - point.x, c.y - point.y) <= SNAP_PX) return this.finishShape(null);
    if (this.boxing()) return this.finishBox(this.snapFor(point, e).position, e.shiftKey);
    this.finishShape(this.snapFor(point, e).position);
  }
  // a rectangle or an ellipse from the first click's corner to q; the tool stays on for the next
  finishBox(q, square) {
    const a = this.draft.pts[0];
    this.draft = null;
    let el;
    this.change((doc) => { el = placeBox(doc, a, q, this.variant.shape, square); });
    this.select([el.id]);
    this.onChange('draft');
  }
  // the shape being drawn made, sized to q (null: the default size), facing north; the tool stays on
  // for the next
  finishShape(q) {
    const c = this.draft.pts[0], d = q ? inverse(c, q).s : 0;
    this.draft = null;
    let el;
    this.change((doc) => {
      el = placeKind(doc, c, this.variant.shape, this.library, d);
    });
    this.select([el.id]);
    this.onChange('draft');
  }
  // the shape being drawn, to the pointer: a point and its shapes as they would be made, in a
  // document of their own (its circles showing their radii), or null
  draftShape() {
    const d = this.draft, q = this.cursor?.p;
    if (this.tool !== 'shape' || !d || !q) return null;
    const doc = emptyDoc(0);
    const el = this.boxing() ? placeBox(doc, d.pts[0], q, this.variant.shape, !!this.cursor.shift) : placeKind(doc, d.pts[0], this.variant.shape, this.library, inverse(d.pts[0], q).s);
    for (const c of doc.circles) setLook(c, 'text.values', true);
    return { doc, el, centre: el.position, to: q };
  }
  // Shape › sector, in three clicks: the centre; the radius and one edge; the other edge, clockwise
  sectorClick(point, e) {
    const d = (this.draft ??= { pts: [] }), r = this.snapFor(point, e, { from: d.pts[0] ?? null });
    if (d.pts.length < 2) {
      if (!d.pts.length || inverse(d.pts[0], r.position).s > 0) d.pts.push(r.position);
    } else {
      const sec = this.draftSector(r.position);
      this.draft = null;
      let el;
      this.change((doc) => { el = build(doc, d.pts[0], sec.aperture ? 'sector' : 'circle', sec.r, { aperture: sec.aperture }); carry(doc, el, el.position, sec.bearing); });
      this.select([el.id]);
    }
    this.renderMarks();
    this.onChange('draft');
  }
  // the sector being drawn, to the pointer (or to q): { centre, r, bearing, aperture, first }, or null
  draftSector(q = this.cursor?.p) {
    const d = this.draft;
    if (this.tool !== 'sector' || !d?.pts.length || !q) return null;
    const c = d.pts[0], first = d.pts[1] ?? q, a = inverse(c, first);
    if (!d.pts[1]) return { centre: c, r: a.s, bearing: norm360(a.azi), aperture: 0, first };
    const ap = Math.round(norm360(inverse(c, q).azi - a.azi) * 10) / 10 || 360;
    return { centre: c, r: a.s, bearing: +norm360(a.azi + ap / 2).toFixed(4), aperture: ap >= 360 ? null : ap, first };
  }
  // the line or measurement being drawn, to the cursor: its points
  draftLine() {
    const pts = this.pathPoints();
    return pts.length ? { pts: [...pts, ...(this.cursor ? [this.cursor.p] : [])] } : null;
  }
  // what is being drawn: a shape, a sector, a polygon, or the line (what a click would join is marked
  // by snap.js, under the pointer only)
  draftFeatures() {
    const line = (coordinates) => ({ type: 'Feature', properties: { kind: 'draft' }, geometry: { type: 'LineString', coordinates } });
    const dot = (coordinates) => ({ type: 'Feature', properties: { kind: 'draftpt' }, geometry: { type: 'Point', coordinates } });
    const sh = this.draftShape();
    if (sh) {
      // the reach from the centre to the pointer: a radius, drawn as a guide for circles only (an
      // outline faces north whatever the pointer's direction, so the line would say nothing)
      const { doc } = sh, out = doc.lines.length ? [] : [line([sh.centre, sh.to])];
      for (const c of doc.circles) out.push(line(ringOf(c)));
      for (const s of doc.lines) out.push(line([...s.points, s.points[0]]));
      return out;
    }
    const sec = this.draftSector();
    if (sec) {
      const out = [line([sec.centre, sec.first])];
      if (this.draft.pts[1] && sec.r > 0) out.push(line(ringOf({ position: sec.centre, radius: sec.r, bearing: sec.bearing, aperture: sec.aperture })));
      return out;
    }
    const l = this.draftLine();
    if (!l) return [];
    return [line(l.pts), ...l.pts.slice(0, this.cursor ? -1 : undefined).map(dot)];
  }

  // the values of what is being drawn, as Measure always showed them: each leg's length, a closed
  // line's area and perimeter, a shape's radii (valueFeatures, on a document of its own)
  draftValues() {
    const u = this.units(), b = this.bearings(), sh = this.draftShape();
    // what is being dragged: its values while it moves, whether or not it shows them
    const dragged = this.drag?.moved && this.drag.id && find(this.doc, this.drag.id);
    if (dragged && dragged.kind !== 'label' && dragged.kind !== 'group' && !lookOf(this.doc, dragged.el).text.values) {
      const shows = (x) => ({ ...x, look: { ...x.look, text: { ...x.look.text, values: true } } });
      return valueFeatures({ ...this.doc, circles: [], lines: [], [KIND[dragged.kind].list]: [shows(dragged.el)] }, u, b); // it alone
    }
    if (sh) return valueFeatures(sh.doc, u, b);
    const l = this.draftLine();
    if (!l || l.pts.length < 2) return [];
    const doc = emptyDoc(0);
    addLine(doc, l.pts, { ...guideWithValues(), id: DRAFT_ID });
    return valueFeatures(doc, u, b);
  }


  // a new element of the tool's kind at p, at its default size, as its variant says, selected (the
  // Point tool's click)
  place(p) {
    let el;
    this.change((doc) => { el = placeKind(doc, p, this.variant.point, this.library); });
    this.select([el.id]);
    return el;
  }

  // A label where the Label tool clicks: on a point, a circle or a closed line, pointing at it; on an open line,
  // at that distance along it; elsewhere, free text there. Selected, for its text to be typed.
  placeLabel(point, p) {
    let el;
    const mine = this.libraryItem(this.variant.label); // an item's label: its text and look
    this.change((doc) => { const r = this.anchorFor(point, p); el = addLabel(doc, r.position, r.to); if (mine) styleLike(doc, el, 'label', mine); });
    this.snapMark = null; // placed: its mark gone with the click (drawn again as the pointer moves)
    this.select([el.id]);
    this.onChange('placed'); // the panel puts the cursor in its text
    return el;
  }
  // where a label clicked at would point, and at what ({ position, to: a target, or null): what
  // snapping finds there (a point's centre, a vertex, a place on an edge or a line's leg); else a
  // point, a closed line's centre or an open line where it is clicked; else the position itself
  anchorFor(point, p) {
    const r = snapAt(this.doc, [point.x, point.y], this.view(), { ids: new Set(this.hitAt(point, SNAP_PX)), radius: SNAP_PX });
    const at = (to) => ({ position: [...resolve(this.doc, to).position], to });
    if (r?.to && !r.to.end) return at(r.to);
    const x = this.hitAt(point).map((id) => find(this.doc, id)).find((y) => y && ['point', 'circle', 'line'].includes(y.kind));
    if (x?.kind === 'line' && !x.el.closed) return at(lineRef(this.doc, x.el, nearestAlong(lineTrace(this.doc, x.el).coords, p)));
    if (x) return at({ element: x.el.id });
    return { position: p, to: null };
  }
}
