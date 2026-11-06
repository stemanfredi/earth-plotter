// Dragging on the map (drawing.js, which takes these methods; drawing-ui.md §5): a press on a handle
// or a selected element takes the gesture from the map's panning; each move applies the drag to the
// document as it was when it started (one undo step when released). Methods of Drawing.

import { find, elements, positionsIn, MAX_LABEL_OFFSET, MAX_RADIUS, linkFrom, setLink, carry, holderOf, moveElements, drawnOf } from './document.js';
import { settleGeometry } from './store.js';
import { HANDLE_LAYERS } from './layers.js';
import { drawnCircle } from './features.js';
import { inverse, destination, moveAbout } from '../geodesy.js';
import { clamp } from '../geo.js';
import { stepped, neighbours } from './snap.js';
import { attachAt, insertVertex, refNear } from './attach.js';
import { radiusTo, bearingTo, sectorEdgeTo, scaledPlaces } from './drag.js';
import { GRAB_PX, canvasPoint } from './input.js';

export class Dragging {
  // ---- dragging (drawing-ui.md §5): selected elements and their handles ------------------------
  handleAt(point, pad = GRAB_PX) {
    const layers = HANDLE_LAYERS.filter((id) => this.map.getLayer(id));
    const f = this.map.queryRenderedFeatures([[point.x - pad, point.y - pad], [point.x + pad, point.y + pad]], { layers })[0];
    return f && { id: f.properties.id, role: f.properties.role, ref: f.properties.ref };
  }
  dragEvents(map) {
    const box = map.getCanvasContainer(), at = (e) => canvasPoint(map, e);
    // first (capture): a press on a handle or a selected element takes the gesture from the map's panning
    box.addEventListener('pointerdown', (e) => {
      // a second finger during a drag: everything back (as Esc), the map's pinch takes over
      if (this.drag && e.pointerId !== this.drag.pointer) { this.cancelDrag(); return; } // a second finger: everything as it was (Esc too: keyEvents)
      this.pressedHandle = false;
      if (e.button !== 0 || this.tool || this.picking || this.repointing || this.boxNext || !this.sel.size || e.ctrlKey || e.metaKey) return; // Box select: the box's; Attach to…: the click's
      const pt = at(e), h = this.handleAt(pt);
      if (!h && e.shiftKey) return; // Shift on the selection: the box's (on a handle: its proportions, its 15° steps)
      this.pressedHandle = !!h;
      const grab = h || (this.hitAt(pt, 3).some((id) => this.chosen(id)) ? { role: 'move' } : null);
      if (!grab) return;
      // a line's vertex (a handle of it) pressed: its row in Properties' table made current (place: the
      // element and the row's index, a line's start 0)
      if (h?.role === 'vertex' || h?.role === 'scale') { this.setPlace({ id: h.id, index: +h.ref }); this.onChange('place'); }
      map.dragPan.disable();
      const ll = map.unproject([pt.x, pt.y]);
      this.drag = { ...grab, start: [ll.lng, ll.lat], from: pt, orig: JSON.stringify(this.doc), moved: false, pointer: e.pointerId };
    }, true);
    let raf = 0, move = null; // the move waiting for the next frame
    window.addEventListener('pointermove', (e) => {
      const d = this.drag;
      if (!d) return;
      const pt = at(e);
      if (!d.moved && Math.hypot(pt.x - d.from.x, pt.y - d.from.y) < 3) return;
      d.moved = true;
      cancelAnimationFrame(raf);
      move = () => {
        move = null;
        if (this.drag !== d) return;
        const ll = map.unproject([pt.x, pt.y]);
        this.doc = JSON.parse(d.orig);
        this.apply(d, [ll.lng, ll.lat], e, pt);
        settleGeometry(this.doc);
        this.render();
        this.onChange('drag');
      };
      raf = requestAnimationFrame(() => move?.());
    });
    window.addEventListener('pointercancel', () => { if (this.drag) this.cancelDrag(); }); // taken by the browser: as a second finger
    window.addEventListener('pointerup', () => {
      const d = this.drag;
      if (!d) return;
      cancelAnimationFrame(raf);
      move?.(); // the last move, not drawn yet: where it is released
      this.drag = null;
      this.snapMark = null;
      map.dragPan.enable();
      if (d.moved) this.pending = d.orig;
      if (!(d.moved && this.change(() => {}))) this.onChange('drag'); // one undo step, from the document before the drag (the change draws everything; else the drag's end does)
    });
  }
  cancelDrag() {
    this.doc = JSON.parse(this.drag.orig);
    this.drag = null;
    this.snapMark = null; // the snap the drag showed: gone with it
    this.map.dragPan.enable();
    this.render();
    this.onChange('drag');
  }

  // the drag's new values, on this.doc as it was when it started (p: the pointer; e: Shift, Alt)
  apply(d, p, e, pt) {
    const doc = this.doc, el = d.id && find(doc, d.id)?.el;
    const point = (id) => doc.points.find((n) => n.id === id);
    const snap = e.shiftKey ? 15 : 0;
    switch (d.role) {
      case 'move': return this.moveSelection(doc, d.start, p);
      case 'anchor': { // a free label's point, or where along the edge (a line's leg) it points
        const to = linkFrom(doc, el.id)?.to, x = to && find(doc, to.element);
        if (!to) el.position = moveAbout(d.start, p)(el.position);
        else if (x) setLink(doc, el.id, 0, refNear(doc, x, p) ?? to);
        return;
      }
      case 'point': { // a line's vertex linked to a point's centre: the point moves (its shapes with it), snapped (not onto itself, its shapes or its lines)
        const n = point(d.ref), mine = new Set([n.id, ...doc.links.filter((l) => l.to.element === n.id).map((l) => l.from[0]), ...elements(doc).filter((x) => x.el.groupId === n.id).map((x) => x.el.id)]);
        carry(doc, n, this.snapped(pt, e, moveAbout(d.start, p)(n.position), { exclude: mine }).position);
        return;
      }
      case 'vertex': { // a line's vertex, snapped; on a point or another line, attached there (Alt: free)
        const i = +d.ref, r = this.snapped(pt, e, moveAbout(d.start, p)(el.points[i]), { exclude: new Set([el.id]), attaches: true, ...neighbours(el.points, i) });
        this.putPlace(doc, { kind: 'line', el }, i, { position: r.position, to: attachAt(doc, r) });
        return;
      }
      case 'scale': { // its vertices as drawn resized; their real ones that over its Scale, about the point's new place
        const n = holderOf(doc, el), t = drawnOf(doc, el), r = scaledPlaces(n.position, n.bearing, el.points.map(t.f), +d.ref, p, e.shiftKey);
        carry(doc, n, r.centre); el.points = r.points.map((q) => { const g = inverse(r.centre, q); return g.s ? destination(r.centre, g.azi, g.s / t.k) : [...r.centre]; });
        return;
      } // a held shape's vertex: the shape resized, the farthest vertex kept (Shift: its proportions too); its point moves to stay its centre, its other shapes with it
      case 'mid': { const q = this.snapped(pt, e, p, { exclude: new Set([el.id]) }).position; insertVertex(doc, el.id, +d.ref + 1, q); return; } // a place added halfway along a leg
      case 'radius': { const c = drawnCircle(doc, el); el.radius = clamp(radiusTo(c.position, p) * el.radius / c.radius, 1, MAX_RADIUS - 1); return; } // a circle's size only: a sector's ends and the stalk turn it
      case 'aperture': Object.assign(el, sectorEdgeTo(drawnCircle(doc, el).position, el.bearing, el.aperture, +d.ref, p, snap)); return; // one end of a sector's arc: its aperture, and its bearing (its middle)
      case 'rotate': if (el.radius) { el.bearing = bearingTo(drawnCircle(doc, el).position, p, snap); } else carry(doc, el, el.position, bearingTo(el.position, p, snap)); // a sector; a point, its shapes with it
    }
  }
  // a dragged position: snapped where the pointer is near something (snapFor), else where the drag
  // puts it (at: the grabbed thing moved as the pointer), in steps with Shift
  snapped(pt, e, at, opts) {
    if (e.shiftKey && opts.from) { this.snapMark = null; return { position: stepped(opts.from, at, opts.prev), to: null }; }
    const r = this.snapFor(pt, e, { exclude: opts.exclude, attaches: !!opts.attaches });
    return r.kind ? r : { position: at, to: null };
  }
  // the selection moved with the pointer, about where it was grabbed (document.js moveElements: the
  // place grabbed stays under the pointer); labels alone in it: their text moves (its offset on screen)
  moveSelection(doc, start, p) {
    if (![...this.sel].every((id) => find(doc, id)?.kind === 'label')) return moveElements(doc, this.sel, start, p);
    const a = this.map.project(start), b = this.map.project(p), px = (v) => clamp(Math.round(v), -MAX_LABEL_OFFSET, MAX_LABEL_OFFSET); // within the file's reach
    for (const id of this.sel) { const { el } = find(doc, id); el.offset = [px(el.offset[0] + b.x - a.x), px(el.offset[1] + b.y - a.y)]; }
  }

  // vertex (or anchor) index of x ({ kind, el }) put at r.position and linked to r.to (a target, or null: free)
  putPlace(doc, x, index, r) {
    const [o, k] = positionsIn(x.kind, x.el)[index];
    o[k] = [...r.position];
    setLink(doc, x.el.id, index, r.to);
  }
}
