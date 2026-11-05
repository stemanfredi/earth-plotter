// The drawing on the map: the document being edited (store.js: undo, selection), drawn in the
// layers of layers.js from features.js and labels.js, with the placing tools, clicks, hit testing,
// dragging and the box (Shift-drag); saved in this browser as it changes (saving.js).

import { find, isShown, LABEL_OFFSET, offsetOf, fewestPlaces, holderOf, canHold, setGroup, isChosen, drawnOf } from './document.js';
import { typing } from '../dom.js';
import { serialise } from './file.js';
import { DrawStore } from './store.js';
import { Saving } from './saving.js';
import { note } from '../menu.js';
import { addIcons, measureText, HIT_LAYERS, MARK_LAYERS, CURSOR } from './layers.js';
import { drawParts, valueFeatures } from './features.js';
import { labelFeatures } from './labels.js';
import { moveAbout } from '../geodesy.js';
import { snapAt, stepped } from './snap.js';
import { attachAt, attachable, deleteVertex } from './attach.js';
import { clipOf, paste, centreOf } from './clipboard.js';
import { SNAP_PX, MID_PX } from './input.js';
import { Drafting } from './drafting.js';
import { Dragging } from './dragging.js';
import { Boxing } from './boxing.js';

export class Drawing extends DrawStore {
  // onChange(what): 'doc' (the document changed), 'sel' (the selection), 'tool', 'draft' (what is
  // being drawn), 'drag', 'box' (a box select ended), 'place' (a handle pressed: currentPlace),
  // 'placed' (a label placed: its text to type), 'storage' (saving failed or another tab saved).
  // known: what the app offers, for parse().
  // getView(): the map's view in the format's terms. units(): the display units ('km' | 'nm');
  // bearings(): each leg's bearing shown beside its length.
  constructor(map, { onChange, known, getView, units = () => 'km', bearings = () => false }) {
    super();
    Object.assign(this, { map, onChange, known, getView, units, bearings });
    this.saving = new Saving(this);
    this.tool = null;
    this.last = null; // the last click: its point and what was under it, for clicking through
    this.zoomRaf = 0;
    // what is being drawn: a line { pts, tos (what each snapped to) }; a sector { pts }; a shape
    // { pts: [its centre] }
    this.draft = null;
    this.button = null; // the bar's button of the tool on (Shape › sector draws with 'sector')
    this.cursor = null;
    map.on('click', (e) => this.click(e));
    let hoverRaf = 0, hoverEvent = null; // once a frame, the last move: pointer() queries the map's features
    map.on('mousemove', (e) => { hoverEvent = e; if (!hoverRaf) hoverRaf = requestAnimationFrame(() => { hoverRaf = 0; this.pointer(hoverEvent); }); });
    this.dragEvents(map);
    this.boxEvents(map);
    this.keyEvents(map);
    this.drag = null; // a drag under way: { id, role, ref, start, orig (the document before), moved }
    this.boxNext = false; // Box select on: the next drag on the map draws the box (boxSelect)
    this.repointing = null; // { id, index }: the vertex the next click attaches (a label's 0, a line's: its inspector's Attach to…)
    this.picking = null; // the Connect form: what a click on the map picks (roots)
    this.keepSel = false; // a form open: a click on the map changes nothing (the form is filled from what was selected)
    this.currentPlace = null; // the vertex current on the element selected (setPlace)
    this.marksOn = true;
    // what each tool makes, as the Library's item chosen last says (library.js; drawing-ui.md §2): Point a
    // diamond; Line a line, an area (closed as it ends) or one like a Library item's; Shape a point
    // holding a circle, rings, a sector (three clicks), an outline (a closed line) or a Library item (a
    // point of the user's, with its shapes); Label a label, or one like a Library item's. Measure has none: a line, closed or
    // not, a measurement
    this.variant = { point: 'symbol', line: 'line', shape: 'circle', label: 'label' };
    this.library = []; // the user's own items in the Library (library.js), by the tools' variants 'library:<name>'
    // labels keep their place on screen next to what they point at: drawn again as the map moves
    let labelRaf = 0;
    map.on('move', () => {
      if (!this.doc.labels.length) return;
      cancelAnimationFrame(labelRaf);
      labelRaf = requestAnimationFrame(() => this.renderLabels());
    });
    // once a frame while zooming, the marks of what is selected (handles are thinned at the zoom)
    map.on('zoom', () => {
      if (!this.sel.size && !this.hover) return;
      cancelAnimationFrame(this.zoomRaf);
      this.zoomRaf = requestAnimationFrame(() => this.renderMarks());
    });
  }
  // the store's (store.js): a change to the document draws and saves it; the selection and the hover
  // only the marks
  changed() { this.render(); this.saving.soon(); this.onChange('doc'); }
  selectionChanged() {
    if (this.repointing && !this.sel.has(this.repointing.id)) this.cancelRepoint();
    this.currentPlace = null;
    this.renderMarks();
    this.onChange('sel');
  }
  hoverChanged() { this.renderMarks(); }
  preview(fn) { super.preview(fn); this.render(); }
  // a label's text being typed: only the labels drawn again
  previewLabels(fn) { super.preview(fn); this.labelTexts = null; this.renderLabels(); }
  // another document (opened from the list, New, imported): a line or a polygon being drawn belongs to
  // the one it replaces
  adopt(doc) {
    if (this.draft) this.cancelDraft();
    super.adopt(doc);
  }
  // the document as a file (GeoJSON), with the map's view as it is now
  text() {
    return serialise(this.doc, this.getView());
  }

  // ---- the map ---------------------------------------------------------------------------
  // the symbols, drawn here as signed distance fields (tinted per feature by icon-color)
  addIcons() { addIcons(this.map); }
  // Draw the parts asked for (features.js drawParts), each in its own source: 'draw' the circles,
  // fills and symbols, 'drawzoom' the lines, 'drawover' the marks, the line being drawn and the
  // forms' previews (Distribute, Connect). A change to the document draws all three; the selection,
  // the pointer, the Line tool's cursor and zooming only the marks.
  render(parts = ALL_PARTS) {
    const p = drawParts(this.doc, this.sel, this.hover, { zoom: this.map.getZoom(), midPx: MID_PX }, parts);
    const set = (id, features) => this.map.getSource(id)?.setData({ type: 'FeatureCollection', features });
    if (parts.base) { set('draw', p.base); this.values = null; this.labelTexts = null; }
    if (parts.zoom) set('drawzoom', p.zoom);
    // the values: again when the drawing changed, or while what is drawn or dragged shows its own (not
    // at every move of the pointer otherwise: a drawing's values are many)
    const draft = parts.base || parts.marks ? this.draftValues() : [];
    if (parts.base || draft.length || this.draftShown) set('drawvalue', [...(this.values ??= valueFeatures(this.doc, this.units(), this.bearings())), ...draft]);
    this.draftShown = draft.length > 0;
    if (parts.marks) {
      let over = [...p.marks, ...this.draftFeatures()];
      // the generator's form: the lines and nodes it would make, faint, and the roots picked, ringed; the
      // guide line's selection marks hidden (its handles would read as more nodes, its halo hide the lines)
      if (this.previewPts?.length || this.picked?.length) over = over.filter((f) => !['handle', 'sel', 'hover', 'stalk'].includes(f.properties.kind));
      for (const l of this.previewLines || []) over.push({ type: 'Feature', properties: { kind: 'ghostline' }, geometry: { type: 'LineString', coordinates: l } });
      for (const q of this.previewPts || []) over.push({ type: 'Feature', properties: { kind: 'ghost' }, geometry: { type: 'Point', coordinates: q } });
      for (const q of this.picked || []) over.push({ type: 'Feature', properties: { kind: 'pick' }, geometry: { type: 'Point', coordinates: q } });
      // where a click or a drag would snap: a ring on a vertex, a cross at a crossing, a dot on an edge
      if (this.snapMark) over.push({ type: 'Feature', properties: { kind: `snap${this.snapMark.kind}`, free: this.snapMark.free ? 1 : 0 }, geometry: { type: 'Point', coordinates: this.snapMark.position } });
      // the vertex current: ringed
      const pm = this.placeAt();
      if (pm) over.push({ type: 'Feature', properties: { kind: 'place' }, geometry: { type: 'Point', coordinates: pm } });
      set('drawover', over);
      this.renderLabels();
    }
  }
  renderMarks() { this.render(MARKS_ONLY); }
  // the labels (labels.js), in their own source: only they change as the map moves
  renderLabels() {
    const src = this.map.getSource('drawlabel');
    if (!src) return;
    src.setData({ type: 'FeatureCollection', features: labelFeatures(this.doc, this.view(), this.marksOn ? this.sel : new Set(), this.marksOn ? this.hover : null, this.units(), this.labelTexts ??= new Map()) });
  }
  // what a form would make, shown on the map, not in the drawing: nodes, roots (ringed), lines
  setPreview(pts, picked = [], lines = []) {
    if (!pts.length && !picked.length && !this.previewPts?.length && !this.picked?.length) return;
    this.previewPts = pts;
    this.picked = picked;
    this.previewLines = lines;
    this.renderMarks();
  }
  // whether id is selected: itself, or a shape with its point
  chosen(id) { const x = find(this.doc, id); return !!x && isChosen(this.doc, this.sel, x.el); }
  // the lines drawn beside their real geometry (Offset): their IDs
  offset() { return this.doc.lines.filter((s) => isShown(this.doc, s) && offsetOf(this.doc, s)).map((s) => s.id); }
  // the shapes drawn at a Scale other than their size (display only): their IDs
  scaled() { return [...this.doc.circles, ...this.doc.lines].filter((x) => isShown(this.doc, x) && drawnOf(this.doc, x).k !== 1).map((x) => x.id); }
  // the IDs under a screen point: those right under it first, then those within pad px (lines drawn
  // offset are a few px from each other: the one clicked must come first), each set topmost first
  hitAt(point, pad = 4) {
    const layers = HIT_LAYERS.filter((id) => this.map.getLayer(id));
    const within = (r) => this.map.queryRenderedFeatures([[point.x - r, point.y - r], [point.x + r, point.y + r]], { layers }).map((f) => f.properties.id).filter(Boolean); // not a measurement being measured
    return [...new Set([...within(1), ...within(pad)])];
  }
  click(e) {
    if (this.pressedHandle) { this.pressedHandle = false; e.cleared = true; return; } // the click a press on a handle ends: the handle's, not a selection's
    const p = [e.lngLat.lng, e.lngLat.lat];
    if (this.tool === 'line' || this.tool === 'measure') return this.lineClick(e.point, e.originalEvent);
    if (this.tool === 'shape') return this.shapeClick(e.point, e.originalEvent);
    if (this.tool === 'sector') return this.sectorClick(e.point, e.originalEvent);
    // picking (Connect's roots): a click on a point or anywhere is for the picker, not a selection
    if (this.picking && !this.tool) { e.cleared = true; this.picking(this.pointAt(e.point), p); return; } // a point, or a place (no point there); used here, no depth asked
    if (this.keepSel && !this.tool) return;
    if (this.tool === 'label') return this.placeLabel(e.point, p);
    if (this.repointing) e.cleared = true; // Attach to…'s click, a miss too: used here, no depth asked
    if (this.repointing?.index === null) { // a shape held by the point clicked (its inspector's Attach to…)
      const { id } = this.repointing, pid = this.pointAt(e.point);
      this.cancelRepoint();
      if (pid && canHold(this.doc, pid, id)) this.change((doc) => setGroup(doc, id, pid));
      else note('Nothing there to attach to'); // a miss: nothing moves
      return this.onChange('sel');
    }
    if (this.repointing) { // a vertex attached to what is clicked (its inspector's Attach to…)
      const { id, index } = this.repointing, label = find(this.doc, id)?.kind === 'label';
      const r = label ? this.anchorFor(e.point, p) : this.snapFor(e.point, e.originalEvent, { exclude: new Set([id]), attaches: true });
      this.cancelRepoint();
      if (!(label ? r.to : attachable(this.doc, r.to) && !holderOf(this.doc, find(this.doc, id)?.el))) { note('Nothing there to attach to'); return this.onChange('sel'); } // a miss (or a point's shape, whose vertices are attached to nothing): the place stays where it is
      this.change((doc) => {
        const x = find(doc, id);
        if (!x) return;
        // free text set on an element: its text moves off it, with an arrow
        if (label && r.to && !x.el.offset[0] && !x.el.offset[1]) { x.el.offset = [...LABEL_OFFSET]; if (x.el.leader === 'none') x.el.leader = 'arrow'; }
        this.putPlace(doc, x, index, label ? r : { position: r.position, to: attachAt(doc, r) });
      });
      return;
    }
    if (this.tool) return this.place(this.snapFor(e.point, e.originalEvent).position);
    const add = e.originalEvent.ctrlKey || e.originalEvent.metaKey; // as the tree: Ctrl/⌘ adds or removes (Shift is the box's and the 15° steps')
    const hits = this.hitAt(e.point);
    // nothing there: the selection cleared, and said on the click (app.js: a click that only clears it reads no depth)
    if (!hits.length) { this.last = null; if (!add) { if (this.sel.size) e.cleared = true; this.select([]); } return; }
    // the same place again: the next one down. A point's shape: its point (with its shapes), whatever
    // is selected; the same place again, the shape alone (as a group is entered in drawing tools)
    const again = this.last && Math.hypot(this.last.x - e.point.x, this.last.y - e.point.y) < 3 && this.last.hits.join() === hits.join();
    let id = again && !add ? hits[(hits.indexOf(this.last.id) + 1) % hits.length] : hits[0];
    const held = holderOf(this.doc, find(this.doc, id)?.el);
    if (held && !(again && this.last.id === held.id)) id = held.id;
    this.last = { x: e.point.x, y: e.point.y, hits, id };
    this.select([id], add ? 'toggle' : 'replace');
  }
  pointer(e) {
    this.lastPoint = e.point; // where a paste goes
    if (['line', 'measure', 'sector'].includes(this.tool) || (this.tool === 'shape' && this.draft)) {
      let r = this.snapFor(e.point, e.originalEvent, this.tool === 'shape' ? {} : this.tool === 'sector' ? { from: this.draft?.pts[0] ?? null } : { ...this.lastLeg(), attaches: this.tool === 'line' }); // as on the click: a shape's size, Shift steps nothing; a sector's edges step round its centre
      if (this.closesPath(e.point)) { r = { position: this.pathPoints()[0], to: null, kind: 'vertex' }; this.snapMark = { kind: 'vertex', position: r.position, free: false }; } // a click closes it
      this.cursor = { point: e.point, p: r.position, snap: r, shift: !!e.originalEvent?.shiftKey };
      this.renderMarks();
      if (this.draft) this.onChange('draft');
      return;
    }
    if (this.tool === 'point' || this.tool === 'shape') { // where a click would place it; the cursor kept current, so a shape's preview starts at its first click, not at the last shape's end
      const r = this.snapFor(e.point, e.originalEvent);
      this.cursor = { point: e.point, p: r.position, snap: r, shift: !!e.originalEvent?.shiftKey };
      this.renderMarks();
      return;
    }
    if (this.snapMark && !this.drag) { this.snapMark = null; this.renderMarks(); }
    // Attach to… waiting, the Label tool: where a click would snap, marked as for drawing (a label points
    // at anything a snap finds; a line's vertex attaches where the model allows)
    const rp = this.repointing, label = this.tool === 'label' || (rp && find(this.doc, rp.id)?.kind === 'label');
    if (label) { // where the label would point, as its click finds it (anchorFor): marked
      const r = this.anchorFor(e.point, [e.lngLat.lng, e.lngLat.lat]);
      this.snapMark = r.to ? { kind: r.to.edge != null ? 'edge' : 'vertex', position: r.position, free: false } : null;
      this.renderMarks();
    } else if (rp && rp.index !== null) {
      this.snapFor(e.point, e.originalEvent, { exclude: new Set([rp.id]), attaches: true });
      this.renderMarks();
    }
    if (this.repointing || this.boxNext) { this.map.getCanvas().style.cursor = 'crosshair'; return; }
    // picking roots (the form's Connect): over a point, it is taken (or dropped); elsewhere, a new
    // root is placed there
    if (this.picking && !this.tool) { this.map.getCanvas().style.cursor = this.pointAt(e.point) ? 'pointer' : 'crosshair'; return; }
    if (this.tool || this.drag) return;
    // over a handle, the cursor says what dragging it does; over a selected element, that it moves
    const h = this.sel.size && this.handleAt(e.point), hits = h ? [] : this.hitAt(e.point, 3);
    const role = h ? h.role : hits.some((id) => this.chosen(id)) ? 'move' : null;
    this.map.getCanvas().style.cursor = role ? CURSOR[role] : hits.length ? 'pointer' : '';
  }
  // hide or show the selection and hover marks (the PNG export captures the map without them)
  showMarks(on) {
    this.marksOn = on;
    for (const id of MARK_LAYERS) if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }

  // ---- what the panel sets ------------------------------------------------------------------
  // The vertex current on the element selected: { id, index } (0 its start), pressed on
  // the map or its row in Properties' table current; or null
  setPlace(place) {
    if (JSON.stringify(place) === JSON.stringify(this.currentPlace)) return;
    this.currentPlace = place;
    this.renderMarks();
  }
  // where the vertex current is, ringed on the map
  placeAt() {
    const c = this.currentPlace, x = c && find(this.doc, c.id);
    const q = x?.kind === 'line' ? x.el.points[c.index] : null;
    return q ? drawnOf(this.doc, x.el).f(q) : null; // where it is drawn (a point's shape at its Scale)
  }
  // Delete with a vertex current: it removed, as its row's Delete does (while the line keeps
  // its fewest); false when it cannot be (Delete takes the element)
  removePlace() {
    const c = this.currentPlace, x = c && this.sel.size === 1 && this.sel.has(c.id) && find(this.doc, c.id);
    if (!x?.el.points?.[c.index] || x.el.points.length <= fewestPlaces(x.el) || holderOf(this.doc, x.el)) return false; // a point's shape: rigid
    this.change((doc) => deleteVertex(doc, c.id, c.index));
    return true;
  }
  // what the next click on the map attaches (Attach to…): vertex index of element id (a label's 0, a
  // line's vertex; null: a shape as a whole, to a point); or nothing
  startRepoint(id, index = 0) {
    this.stop(); // a click on the map now attaches, not a tool's next point
    this.boxSelect(false);
    this.repointing = { id, index };
    this.map.getCanvas().style.cursor = 'crosshair';
  }
  cancelRepoint() { this.repointing = null; this.snapMark = null; this.map.getCanvas().style.cursor = ''; }
  // Attach to… given up by something else started (a tool, Box select): the panel told, its button
  // let go
  giveUpRepoint() { if (!this.repointing) return; this.cancelRepoint(); this.renderMarks(); this.onChange('sel'); }
  // what a click on the map picks while the generator's form is open (fn(nodeId, position)), or null
  setPicking(fn, keepSel = !!fn) { this.picking = fn; this.keepSel = keepSel; if (!fn && !this.tool) this.map.getCanvas().style.cursor = ''; }
  // a tool's variant chosen (its row of kinds): the tool on with it
  setVariant(button, v) {
    this.variant[button] = v;
    this.start(button);
  }

  // ---- tools -----------------------------------------------------------------------------
  start(tool) {
    if (this.keepSel) this.onChange('cancel'); // a form open (Distribute, Connect): closed, as Esc closes it
    this.giveUpRepoint(); // Attach to… waiting: given up (the next click is the tool's)
    if (this.tool) this.stop();
    this.boxNext = false;
    clearTimeout(this.dblZoom); // stop()'s, which would turn it on again after this
    const v = this.variant[tool];
    this.button = tool;
    this.tool = tool === 'shape' && v === 'sector' ? v : tool;
    this.map.doubleClickZoom.disable();
    this.map.getCanvas().style.cursor = 'crosshair';
    this.onChange('tool');
  }
  stop() {
    if (!this.tool) return;
    this.snapMark = null;
    this.tool = null;
    this.button = null;
    this.draft = null;
    this.renderMarks();
    this.map.getCanvas().style.cursor = '';
    this.dblZoom = setTimeout(() => this.map.doubleClickZoom.enable(), 0);
    this.onChange('tool');
  }

  // Copy, paste, duplicate (clipboard.js): the selection kept; pasted with its middle at the pointer
  // (else the map's centre), moved there along the ellipsoid (moveAbout: it keeps its size at any
  // latitude), or duplicated beside itself (20 px on screen); one undo step, the copy selected
  copy() {
    if (!this.sel.size) return 0;
    this.clip = clipOf(this.doc, [...this.sel]);
    return this.clip.items.length;
  }
  paste(clip = this.clip, at = null) {
    if (this.moving()) return 0;
    const c = clip && centreOf(clip);
    if (!c) return 0;
    const pt = at ?? this.lastPoint ?? this.map.project(this.map.getCenter());
    const to = this.map.unproject(pt);
    let made = [];
    this.change((doc) => { made = paste(doc, clip, moveAbout(c, [to.lng, to.lat])); });
    const ids = new Set(made.map((x) => x.el.id));
    this.select(made.filter((x) => !ids.has(x.el.groupId)).map((x) => x.el.id)); // a point, its shapes with it (as a click selects)
    return made.length;
  }
  duplicate() {
    if (this.moving()) return 0;
    const clip = this.sel.size && clipOf(this.doc, [...this.sel]), c = clip && centreOf(clip);
    if (!c) return 0;
    const q = this.map.project(c);
    return this.paste(clip, { x: q.x + 20, y: q.y + 20 });
  }
  // ---- snapping (snap.js): where a click or a drag lands --------------------------------------
  // the map's projection, as snap.js wants it
  view() {
    return { project: (p) => { const q = this.map.project(p); return [q.x, q.y]; }, unproject: (q) => { const p = this.map.unproject(q); return [p.lng, p.lat]; }, measure: measureText };
  }
  // Snapping at a screen point: { position, to (what a line's vertex would attach to), kind }. e: the
  // event (Alt: as it is, nothing snapped or attached; Shift, drawing from `from`: in 15° steps from
  // the leg before, prev → from); exclude: elements never snapped to; attaches: a line's vertex, attached
  // where it snaps when it can be. Marks the target on the map: as a click there attaches (the mark's
  // colour), or only puts the vertex there (grey: free).
  snapFor(point, e, { from = null, prev = null, exclude = new Set(), attaches = false } = {}) {
    const ll = this.map.unproject(point), raw = [ll.lng, ll.lat];
    let r;
    if (e?.altKey) r = { position: raw, to: null, kind: null }; // Alt: free
    else if (e?.shiftKey && from) r = { position: stepped(from, raw, prev), to: null, kind: null };
    else r = snapAt(this.doc, [point.x, point.y], this.view(), { ids: new Set(this.hitAt(point, SNAP_PX)), exclude, radius: SNAP_PX }) || { position: raw, to: null, kind: null };
    this.snapMark = r.kind ? { kind: r.kind, position: r.position, free: !(attaches && attachable(this.doc, r.to)) } : null;
    return r;
  }
  // the leg being drawn: where it starts, and the leg before it (for Shift)
  lastLeg() {
    const pts = this.draft?.pts ?? [];
    return { from: pts.at(-1) ?? null, prev: pts.at(-2) ?? null };
  }
  // a point within snapping distance of a screen point, if any (the nearest): Connect's roots
  pointAt(point) {
    let best = null, bd = SNAP_PX;
    for (const n of this.doc.points) {
      if (!isShown(this.doc, n)) continue;
      const q = this.map.project(n.position), d = Math.hypot(q.x - point.x, q.y - point.y);
      if (d <= bd) { best = n.id; bd = d; }
    }
    return best;
  }

  // Undo while a line or measurement is being drawn: its last point back (Backspace too)
  // while a drag moves nothing else changes the drawing (Undo, Redo, Delete, Paste…: its next move
  // would put the drawing back as it was, the change and an undo step lost); Esc ends it first. A press
  // not yet moved lets a change through (a field applied as it loses the focus to that press), and the
  // drag then starts from the drawing so changed
  moving() { return !!this.drag?.moved; }
  pressed() { if (this.drag) this.drag.orig = JSON.stringify(this.doc); }
  undo() { if (this.moving()) return; if (this.draft) this.undoPoint(); else super.undo(); this.pressed(); }
  redo() { if (this.moving()) return; super.redo(); this.pressed(); }
  change(fn) { if (this.moving()) return false; const made = super.change(fn); this.pressed(); return made; }
  // Back one level (Esc, a right-click with nothing to finish, the touch Back): a drag put back, a box
  // dropped, a form closed, Attach to… given up, what is half drawn dropped, else the tool ended, else
  // Box select off, else the selection cleared
  back() {
    if (this.drag) return this.cancelDrag();
    if (this.dropBox?.()) return; // a box being drawn: dropped
    if (this.keepSel) return this.onChange('cancel'); // the form's Cancel
    if (this.repointing) { this.cancelRepoint(); return this.onChange('sel'); }
    if (this.tool) return this.escape();
    if (this.boxNext) return this.boxSelect(false);
    this.select([]);
  }
  // The keys and clicks of what is being drawn, from anywhere but a field or a dialog: Enter, a
  // double-click or a right-click (not a right drag, which rotates the map) finishes the line or
  // polygon, as in QGIS; a right-click with nothing to finish steps back one level, as Esc does:
  // a drag undone, a form closed, Attach to… given up, what is half-drawn dropped, else the tool
  // ended, else the selection cleared. Backspace (or Undo) takes back a point.
  keyEvents(map) {
    const escape = () => this.back();
    let right = null;
    map.on('mousedown', (e) => { if (e.originalEvent.button === 2) right = e.point; });
    map.on('contextmenu', (e) => { if (right && Math.hypot(e.point.x - right.x, e.point.y - right.y) <= 3) { if (this.finishesOnDoubleClick() && this.pathPoints().length >= 2) this.finish(); else escape(); } });
    map.on('dblclick', (e) => { if (this.finishesOnDoubleClick()) { e.preventDefault(); this.finish(); } });
    window.addEventListener('keydown', (e) => {
      if (typing(e.target) || document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape') escape(); // with Alt held too: Alt is the key for dragging free of snapping
      else if (e.ctrlKey || e.metaKey || e.altKey || !this.tool) return;
      else if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); this.finish(); } // Enter on a focused button is that button's own click
      else if (e.key === 'Backspace' && !e.target.closest('input, select, textarea')) { e.preventDefault(); this.undoPoint(); } // a slider's or a box's Backspace is its own
    });
  }
}

const ALL_PARTS = { base: true, zoom: true, marks: true }, MARKS_ONLY = { marks: true };

// the placing tools, dragging and the box: their methods Drawing's own (drafting.js, dragging.js, boxing.js)
for (const from of [Drafting, Dragging, Boxing]) {
  for (const k of Object.getOwnPropertyNames(from.prototype)) if (k !== 'constructor') Object.defineProperty(Drawing.prototype, k, Object.getOwnPropertyDescriptor(from.prototype, k));
}

