// The drawing being edited, without the map: the document (document.js), its selection, the element
// under the pointer, undo and redo. Pure: no map, no
// DOM (the tests run it in Node). The map's side (drawing.js) extends it and is told of each change:
// changed() (the document), selectionChanged(), hoverChanged().

import { emptyDoc, touch, find, elements, remove, reading, making } from './document.js';
import { refreshAttached } from './attach.js';
import { pruneRules } from './generator.js';

const UNDO_STEPS = 100, UNDO_CHARS = 20e6; // the undo steps' JSON, in characters (two bytes each in memory: up to 40 MB)

// after any change, in one pass: the attached vertices and anchors where what they are on is; the rules' lists what is still there (a rule follows nothing: Update)
export function settleGeometry(doc) {
  reading(doc, () => refreshAttached(doc)); // indexed: these add or take away no element
  pruneRules(doc);
}

export class DrawStore {
  constructor() {
    this.doc = emptyDoc();
    this.sel = new Set();
    this.hover = null;
    this.undos = []; // the document before each change, as JSON, oldest first
    this.redos = [];
    this.pending = null; // the document before a change being previewed (a colour being picked)
  }
  // the map's: told of what changed
  changed() {}
  selectionChanged() {}
  hoverChanged() {}

  // ---- selection ---------------------------------------------------------------------------
  // mode: 'replace', 'toggle' (each id in or out) or 'add'
  select(ids, mode = 'replace') {
    const next = mode === 'replace' ? new Set() : new Set(this.sel);
    for (const id of ids) {
      if (mode === 'toggle' && next.has(id)) next.delete(id);
      else next.add(id);
    }
    if (next.size === this.sel.size && [...next].every((id) => this.sel.has(id))) return;
    this.sel = next;
    this.selectionChanged();
  }
  selected() { return [...this.sel].map((id) => find(this.doc, id)).filter(Boolean); }
  setHover(id) {
    if (this.hover === id) return;
    this.hover = id;
    this.hoverChanged();
  }

  // ---- changes, undo -----------------------------------------------------------------------
  // A change shown while it is being made (a colour picker moving), not yet an undo step: the next
  // change() makes the step, from the document as it was before the first preview.
  preview(fn) {
    if (this.pending == null) this.pending = JSON.stringify(this.doc);
    fn(this.doc);
  }
  // fn(doc) changes the document: one undo step (none when nothing changed: a field applied twice),
  // true when one was made. One that fails leaves the document as it was before it, not half changed.
  change(fn) {
    const before = this.pending ?? JSON.stringify(this.doc);
    this.pending = null;
    // making: the IDs in use and the names' numbers counted once, however many elements the change makes
    try { making(this.doc, () => fn(this.doc)); settleGeometry(this.doc); } catch (e) { this.doc = JSON.parse(before); this.settle(); throw e; }
    if (JSON.stringify(this.doc) === before) return false;
    touch(this.doc);
    this.undos.push(before);
    let chars = this.undos.reduce((n, s) => n + s.length, 0);
    while (this.undos.length > UNDO_STEPS || (chars > UNDO_CHARS && this.undos.length > 1)) chars -= this.undos.shift().length;
    this.redos = [];
    this.settle();
    return true;
  }
  undo() { this.step(this.undos, this.redos); }
  redo() { this.step(this.redos, this.undos); }
  step(from, to) {
    if (!from.length) return;
    if (this.pending != null) { this.doc = JSON.parse(this.pending); this.pending = null; } // a preview not applied: dropped
    to.push(JSON.stringify(this.doc));
    this.doc = JSON.parse(from.pop());
    this.settle();
  }
  // after the document changed: the selection and the hover keep only what still exists
  settle() {
    const ids = new Set(elements(this.doc).map((x) => x.el.id));
    this.sel = new Set([...this.sel].filter((id) => ids.has(id)));
    if (this.hover && !ids.has(this.hover)) this.hover = null;
    this.changed();
  }
  // a delete: one undo step (a connection that lost a root keeps the rest: Update plans it again)
  remove(ids, withMembers = false) { this.change((doc) => { remove(doc, ids, withMembers); }); }
  // A whole other document (read back, opened, New): nothing selected,
  // undo starting again.
  adopt(doc) {
    this.doc = doc;
    this.undos = [];
    this.redos = [];
    this.pending = null;
    this.sel = new Set();
    this.hover = null;
    this.settle();
  }
  isEmpty() { const d = this.doc; return !elements(d).length && !d.meta.title && !d.meta.description && !d.meta.author; }
}
