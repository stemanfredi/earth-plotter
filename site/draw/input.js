// What the drawing's pointer and keys share (drawing.js, drafting.js, dragging.js, boxing.js): how far
// snapping and grabbing reach, and where a pointer event is on the map.
import { FINGER } from './layers.js';
import { RADIUS as SNAP_RADIUS } from './snap.js';

// with a finger (drawing-ui.md §1): snapping reaches farther, handles are grabbed farther, a + is
// added only along longer legs
export const SNAP_PX = FINGER ? 16 : SNAP_RADIUS, GRAB_PX = FINGER ? 22 : 5, MID_PX = FINGER ? 80 : 40;
// a pointer event's place on the map's canvas (px)
export const canvasPoint = (map, e) => { const r = map.getCanvasContainer().getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
// what Measure makes (a measurement: a guide of its own colour, its values shown); how what is drawn shows its values
export const guideWithValues = () => ({ guide: true, measure: true, look: { text: { values: true } } });
// the ID of the line being drawn, as measured for its values: always the same, so the traces cached by
// ID (lines.js) keep one entry for it, not one for each move of the pointer
export const DRAFT_ID = '~draft';
