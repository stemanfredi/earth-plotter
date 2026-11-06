// Box select (drawing.js, which takes these methods): Shift-drag a box with no tool on (a finger:
// Box select, then a drag), what lies inside added to the selection. Methods of Drawing.

import { elements, isShown, reading } from './document.js';
import { GEOMETRY } from './features.js';
import { canvasPoint } from './input.js';

export class Boxing {
  // Box select (Select's other kind, B): the next drag on the map, a mouse's or a finger's, draws the
  // box (as Shift-drag does), then back to Select; on: false puts it off
  boxSelect(on) {
    if (on) this.leave(); // a tool, Attach to…, a form: given up (the next drag is the box's)
    this.boxNext = on;
    this.map.getCanvas().style.cursor = on ? 'crosshair' : '';
    this.onChange('tool');
  }
  // ---- box select: Shift-drag a box with no tool on (a finger: held, then dragged), what lies inside
  // added to the selection -------
  boxEvents(map) {
    const box = document.createElement('div');
    box.className = 'dbox';
    box.hidden = true;
    map.getCanvasContainer().append(box);
    let from = null;
    const at = (e) => canvasPoint(map, e);
    map.boxZoom.disable(); // Shift-drag is the box's, not the map's box zoom
    const begin = (p) => {
      map.dragPan.disable();
      from = p;
      Object.assign(box.style, { left: `${from.x}px`, top: `${from.y}px`, width: '0px', height: '0px' });
      box.hidden = false;
    };
    // first (capture, after a drag's): Shift pressed on the map with no tool, or Box select pressed
    // (a finger's way too: the dock's button), not on what a drag takes
    map.getCanvasContainer().addEventListener('pointerdown', (e) => {
      if (this.tool || this.drag || !(e.shiftKey || this.boxNext) || (e.button !== 0 && e.pointerType !== 'touch') || e.ctrlKey || e.metaKey) return;
      if (from) return; // a second finger
      begin(at(e));
    }, true);
    map.getCanvasContainer().addEventListener('contextmenu', (e) => { if (from) e.preventDefault(); }); // a long press's menu while the box is drawn
    window.addEventListener('pointermove', (e) => {
      if (!from) return;
      const p = at(e);
      Object.assign(box.style, { left: `${Math.min(from.x, p.x)}px`, top: `${Math.min(from.y, p.y)}px`, width: `${Math.abs(p.x - from.x)}px`, height: `${Math.abs(p.y - from.y)}px` });
    });
    const end = () => {
      from = null;
      box.hidden = true;
      map.dragPan.enable();
      if (this.boxNext) this.boxSelect(false); // one box, then Select again
    };
    window.addEventListener('pointercancel', () => { if (from) end(); }); // taken by the browser: nothing selected
    // Esc while it is drawn (keyEvents): dropped, nothing selected; true when there was one
    this.dropBox = () => { if (!from) return false; end(); return true; };
    window.addEventListener('pointerup', (e) => {
      if (!from) return;
      const p = at(e), a = from;
      end();
      if (Math.abs(p.x - a.x) < 3 && Math.abs(p.y - a.y) < 3) return; // a click, not a drag
      this.select(this.inside([Math.min(a.x, p.x), Math.min(a.y, p.y), Math.max(a.x, p.x), Math.max(a.y, p.y)]), 'add');
      this.onChange('box');
    });
  }
  // the visible elements inside a screen box [x0, y0, x1, y1]: points and circles by their centre,
  // lines when all of them is inside
  inside([x0, y0, x1, y1]) {
    const inBox = (p) => { const q = this.map.project(p); return q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1; };
    return reading(this.doc, () => elements(this.doc).filter((x) => isShown(this.doc, x.el) && GEOMETRY[x.kind].inside(this.doc, x.el, inBox)).map((x) => x.el.id));
  }
}
