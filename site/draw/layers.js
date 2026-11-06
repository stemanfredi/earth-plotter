// What the drawing draws with: its map layers (in the sources draw, drawzoom, drawover, drawlabel and drawvalue:
// features.js and labels.js make their features), the symbols as signed distance fields, and which
// layers a click hits, a press grabs, the PNG export hides.
import { INK } from './document.js';
import { RADIUS as SNAP_RADIUS } from './snap.js';

// The marks of interaction (drawing-ui.md §7): yellow cased in white (seen on the sea's blue, the chart's
// white, satellite) for the bands, the targets and the + marks, hovered at half strength, selected and
// what a click would hit at full; the handles white, edged in the UI's ink (INK); what is not made yet
// (being drawn, a form's preview) dashed, in that ink. Measurements keep magenta: content.
const MARK = '#ffc400', WHITE = '#ffffff', HOVER = 0.7; // HOVER: every hover mark's strength (band, ring, label)
const FREE = '#5d6d79'; // a snap that attaches nothing: the vertex only put there (the guides' grey)
const SNAPPED = ['case', ['==', ['get', 'free'], 1], FREE, MARK]; // a snap mark: attaches, or not
const HALO_W = 1.5; // the case of a text or a symbol on the map (names, symbols, labels, values, the + marks)

// the symbols and the label box, added to the map once its style is loaded
export function addIcons(map) {
  for (const [name, shape] of Object.entries(SHAPES)) if (!map.hasImage(`draw-${name}`)) map.addImage(`draw-${name}`, sdfIcon(shape, name === 'arrow' ? 56 : 40), { sdf: true, pixelRatio: 2 });
  // a label's box: stretched around its text (its border is the icon's halo, in the text's colour)
  if (!map.hasImage('draw-box')) map.addImage('draw-box', sdfIcon(BOX), { sdf: true, pixelRatio: 2, stretchX: [[14, 26]], stretchY: [[14, 26]], content: [12, 12, 28, 28] });
}

// ---- symbols ---------------------------------------------------------------------------------
// each symbol's signed distance (px, negative inside) at a point of its 24 × 24 px cell, centred
// on 0, 0 (pixelRatio 2: 12 px on screen)
const poly = (pts) => (x, y) => {
  let d = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
    const nx = by - ay, ny = ax - bx, len = Math.hypot(nx, ny);
    d = Math.max(d, ((x - ax) * nx + (y - ay) * ny) / len); // outward normal: the points go clockwise on screen
  }
  return d;
};
const SHAPES = {
  diamond: poly([[0, -9], [9, 0], [0, 9], [-9, 0]]),
  square: poly([[-7, -7], [7, -7], [7, 7], [-7, 7]]),
  triangle: poly([[0, -9], [8.5, 6], [-8.5, 6]]),
  dot: (x, y) => Math.hypot(x, y) - 6,
  centre: (x, y) => Math.hypot(x, y) - 3.5,
  handle: poly([[-4, -4], [4, -4], [4, 4], [-4, 4]]),
  arrow: poly([[0, 0], [8, 18], [-8, 18]]), // its tip at the centre: on the point it points at
  plus: (x, y) => Math.min(Math.max(Math.abs(x) - 6, Math.abs(y) - 1.5), Math.max(Math.abs(x) - 1.5, Math.abs(y) - 6)),
};
// a rounded rectangle filling most of the 40 px cell
const BOX = (x, y) => { const qx = Math.abs(x) - 8, qy = Math.abs(y) - 8; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 4; };
// a label text's size on screen [w, h] (px), as MapLibre will set it (near enough: the leader stops at
// its edge)
let measureCtx = null;
export function measureText(text, px) {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  measureCtx.font = `${px}px "Noto Sans", Arial, sans-serif`;
  const lines = text.split('\n');
  return [Math.max(...lines.map((l) => measureCtx.measureText(l).width)), lines.length * px * 1.2];
}
// MapLibre's SDF icons (as TinySDF makes them): the edge at alpha 0.75, 8 px of falloff each side
function sdfIcon(dist, size = 40, buffer = 8) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = dist(x + 0.5 - size / 2, y + 0.5 - size / 2);
    data[(y * size + x) * 4 + 3] = 255 * Math.min(1, Math.max(0, 0.75 - d / buffer));
  }
  return { width: size, height: size, data };
}

// ---- layers ----------------------------------------------------------------------------------
const FONT = ['Noto Sans Regular']; // the map's own (style.js), from the same glyph server
const ofKind = (kind) => ['==', ['get', 'kind'], kind]; // a source's features of one kind (features.js, labels.js)
// a label's text, its box stretched round it when it has one
const labelLayout = { 'text-field': ['get', 'text'], 'text-font': FONT, 'text-size': ['get', 'px'], 'text-max-width': 100, 'text-line-height': 1.2,
  'text-allow-overlap': true, 'text-ignore-placement': true, 'icon-image': ['case', ['==', ['get', 'box'], 1], 'draw-box', ''],
  'icon-text-fit': 'both', 'icon-text-fit-padding': [3, 5, 3, 5], 'icon-allow-overlap': true, 'icon-ignore-placement': true };
// a stroke's dash, per feature (solid: one long dash)
const DASH = ['match', ['get', 'dash'], 'dashed', ['literal', [4, 3]], 'dotted', ['literal', [1, 2]], ['literal', [1, 0]]];
// the drawing order within a kind (features.js z): the first in its list drawn on top
const Z = ['coalesce', ['get', 'z'], 0];
// a line's Offset (features.js: off, px, positive to the right of its direction), as QGIS offsets a
// line symbol: drawn by MapLibre beside the geometry, display only
const OFF = ['coalesce', ['get', 'off'], 0];
const lineLayer = (kind, source) => ({
  id: `draw-${kind}-line`, type: 'line', source, filter: ofKind(kind),
  layout: { 'line-join': 'round', 'line-sort-key': Z },
  paint: { 'line-color': ['get', 'sc'], 'line-opacity': ['get', 'so'], 'line-width': ['get', 'sw'], 'line-offset': OFF, 'line-dasharray': DASH },
});
const fillLayer = (kind, source) => ({
  id: `draw-${kind}-fill`, type: 'fill', source, filter: ['all', ofKind(kind), ['==', ['get', 'fill'], 1]],
  layout: { 'fill-sort-key': Z },
  paint: { 'fill-color': ['get', 'fc'], 'fill-opacity': ['get', 'fo'] },
});
// the hover band, never on the element's own stroke, clear of it by 3 px: outside a polygon's outline
// (negative offset: the left of a counter-clockwise ring, its outside on screen), on both sides of a
// line: one line of the mark's blue (no casing: it read as white lines either side of it)
const BAND = 2;
const HALO = [['line', MARK, BAND, HOVER]];
const haloLayers = (geom, sides, parts) => sides.flatMap((side) => parts.map(([part, colour, width, opacity]) => ({
  id: `draw-mark-${part}-${geom.toLowerCase()}${sides.length > 1 ? (side > 0 ? '-r' : '-l') : ''}`, type: 'line', source: 'drawover',
  filter: ['all', ofKind('hover'), ['==', ['geometry-type'], geom]],
  layout: { 'line-join': 'round' },
  paint: { 'line-color': colour, 'line-width': width, 'line-opacity': opacity,
    'line-offset': ['+', OFF, ['*', side, ['+', ['/', ['get', 'sw'], 2], 3, BAND / 2]]] } })));
// a finger (a coarse pointer): handles drawn larger (14 px from 8), as drawing.js grabs them farther
export const FINGER = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
// what the drawing's pointer shares (drawing.js, drafting.js, dragging.js, boxing.js): with a finger
// (drawing-ui.md §1), snapping reaches farther, handles are grabbed farther, a + is added only along
// longer legs
export const SNAP_PX = FINGER ? 16 : SNAP_RADIUS, GRAB_PX = FINGER ? 22 : 5, MID_PX = FINGER ? 80 : 40;
// a pointer event's place on the map's canvas (px)
export const canvasPoint = (map, e) => { const r = map.getCanvasContainer().getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
const HANDLE_SIZE = FINGER ? 1.75 : 1;
// handles at an outline's key points: small squares, white with a dark edge
const handleLayer = (id, source, kind) => ({ id, type: 'symbol', source, filter: ofKind(kind),
  layout: { 'icon-image': 'draw-handle', 'icon-size': HANDLE_SIZE, 'icon-allow-overlap': true, 'icon-ignore-placement': true },
  paint: { 'icon-color': WHITE, 'icon-halo-color': INK, 'icon-halo-width': 1.5 } });
// a place marked: a ring of the mark's colour round it
const ringLayer = (id, kind) => ({ id, type: 'circle', source: 'drawover', filter: ofKind(kind),
  paint: { 'circle-radius': 11, 'circle-opacity': 0, 'circle-stroke-color': MARK, 'circle-stroke-width': 3 } });
// what is not made yet: a dashed line in ink
const draftLayer = (id, kind, opacity = 1) => ({ id, type: 'line', source: 'drawover', filter: ofKind(kind), layout: { 'line-join': 'round' },
  paint: { 'line-color': INK, 'line-opacity': opacity, 'line-width': 2, 'line-dasharray': [3, 2] } });
// a name on the map (features.js), in its element's colour on a white halo; tests: which names, with
// the kind; layout: where it is put
const nameLayer = (id, source, tests, layout) => ({ id, type: 'symbol', source, filter: ['all', ofKind('name'), ...tests],
  layout: { 'text-field': ['get', 'nm'], 'text-font': FONT, 'text-size': 11, ...layout },
  paint: { 'text-color': ['get', 'c'], 'text-halo-color': WHITE, 'text-halo-width': HALO_W } });
// bottom to top: circles, closed lines' fills, lines (guides, the others), the hover band,
// symbols, handles, the selection's rings; within each, the drawing order (Z)
export const DRAW_LAYERS = [
  fillLayer('ring', 'draw'), lineLayer('ring', 'draw'),
  fillLayer('polygon', 'draw'), // a closed line's fill: its stroke is a line's
  // under the lines: the lines' click targets, invisible
  { id: 'draw-linehit', type: 'line', source: 'drawzoom', filter: ofKind('linehit'), paint: { 'line-width': 10, 'line-opacity': 0, 'line-offset': OFF } },
  lineLayer('guide', 'drawzoom'), lineLayer('path', 'drawzoom'),
  ...haloLayers('Polygon', [-1], HALO), ...haloLayers('LineString', [-1, 1], HALO),
  { id: 'draw-symbol', type: 'symbol', source: 'draw', filter: ofKind('symbol'),
    layout: { 'icon-image': ['concat', 'draw-', ['get', 'symbol']], 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    paint: { 'icon-color': ['get', 'sc'], 'icon-opacity': ['get', 'so'], 'icon-halo-color': WHITE, 'icon-halo-width': HALO_W } },
  handleLayer('draw-handle', 'drawover', 'handle'),
  // the forms' previews: the points a distribution would make (faint diamonds), Connect's roots (rings) and lines
  draftLayer('draw-ghostline', 'ghostline', 0.75),
  { id: 'draw-ghost', type: 'symbol', source: 'drawover', filter: ofKind('ghost'),
    layout: { 'icon-image': 'draw-diamond', 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    paint: { 'icon-color': INK, 'icon-opacity': 0.6 } },
  ringLayer('draw-mark-pick', 'pick'),
  // while a line is selected: a + halfway along its legs; the stalk that turns a point or a sector
  { id: 'draw-stalk', type: 'line', source: 'drawover', filter: ofKind('stalk'), paint: { 'line-color': MARK, 'line-width': 1.5 } },
  { id: 'draw-mid', type: 'symbol', source: 'drawover', filter: ofKind('mid'),
    layout: { 'icon-image': 'draw-plus', 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    paint: { 'icon-color': MARK, 'icon-halo-color': WHITE, 'icon-halo-width': HALO_W } },
  // the line being drawn (Line tool)
  draftLayer('draw-draft', 'draft'),
  // where a click or a drag snaps (snap.js): a ring on a vertex, a dot on an edge, a cross at a crossing;
  // in the marks' colour where a click attaches there, grey where it only puts the vertex there (free)
  { id: 'draw-snapto', type: 'circle', source: 'drawover', filter: ['in', ['get', 'kind'], ['literal', ['snapvertex', 'snapedge']]],
    paint: { 'circle-radius': ['match', ['get', 'kind'], 'snapvertex', 8, 4], 'circle-color': SNAPPED, 'circle-opacity': ['match', ['get', 'kind'], 'snapvertex', 0, 1],
      'circle-stroke-color': ['match', ['get', 'kind'], 'snapvertex', SNAPPED, WHITE], 'circle-stroke-width': ['match', ['get', 'kind'], 'snapvertex', 3, 1.5] } },
  // the vertex of the row current in Properties' table: ringed, as a
  // mark (not in the exports)
  ringLayer('draw-mark-place', 'place'),
  { id: 'draw-snapcross', type: 'symbol', source: 'drawover', filter: ofKind('snapcrossing'),
    layout: { 'icon-image': 'draw-plus', 'icon-rotate': 45, 'icon-size': 1.4, 'icon-allow-overlap': true, 'icon-ignore-placement': true },
    paint: { 'icon-color': SNAPPED, 'icon-halo-color': WHITE, 'icon-halo-width': 2 } }, // a wider case than HALO_W: the cross lies on the two lines that cross
  { id: 'draw-draftpt', type: 'circle', source: 'drawover', filter: ofKind('draftpt'),
    paint: { 'circle-radius': 3.5, 'circle-color': WHITE, 'circle-stroke-color': INK, 'circle-stroke-width': 1.5 } },
  // names on the map (features.js): along lines, below points, on circles' rims, at closed lines' centres; MapLibre leaves out
  // those that collide
  nameLayer('draw-name-line', 'drawzoom', [['==', ['geometry-type'], 'LineString']], { 'symbol-placement': 'line', 'symbol-spacing': 300, 'text-max-angle': 40 }),
  { id: 'draw-name-vertex', type: 'circle', source: 'draw', filter: ['all', ofKind('name'), ['has', 'vx']],
    paint: { 'circle-radius': 2.5, 'circle-color': ['get', 'c'], 'circle-stroke-color': WHITE, 'circle-stroke-width': 1 } },
  nameLayer('draw-name-point', 'draw', [['==', ['geometry-type'], 'Point'], ['!', ['has', 'ctr']], ['!', ['has', 'rim']], ['!', ['has', 'under']]],
    { 'text-variable-anchor': ['top', 'bottom', 'right', 'left'], 'text-radial-offset': 0.9, 'text-justify': 'center', 'text-max-width': 12 }), // centred below it (else above, right, left): the same however its shapes are turned
  nameLayer('draw-name-under', 'draw', [['has', 'under']], { 'text-anchor': 'top', 'text-offset': [0, 0.3], 'text-max-width': 12 }), // a point's, just under its outlines
  nameLayer('draw-name-rim', 'draw', [['has', 'rim']], { 'text-anchor': ['get', 'anchor'], 'text-offset': ['case', ['==', ['get', 'anchor'], 'bottom'], ['literal', [0, -0.3]], ['literal', [0, 0.3]]], 'text-max-width': 24 }), // a circle's, just inside its rim (its anchor: features.js rimOf)
  nameLayer('draw-name-centre', 'drawzoom', [['has', 'ctr']], { 'text-max-width': 12 }),
  // labels (labels.js, their own source): leaders, their ends, the text (on a halo, or in a box);
  // always shown, where the user put them
  { id: 'draw-leader', type: 'line', source: 'drawlabel', filter: ofKind('leader'), layout: { 'line-cap': 'round' },
    paint: { 'line-color': ['get', 'c'], 'line-width': 1.25 } },
  { id: 'draw-lend', type: 'symbol', source: 'drawlabel', filter: ofKind('lend'),
    layout: { 'icon-image': 'draw-arrow', 'icon-rotate': ['get', 'rot'], 'icon-rotation-alignment': 'viewport',
      'icon-allow-overlap': true, 'icon-ignore-placement': true },
    paint: { 'icon-color': ['get', 'c'] } },
  // a label selected or hovered: the mark's rim round its text or its box (hidden with the other marks)
  { id: 'draw-mark-label', type: 'symbol', source: 'drawlabel', filter: ['all', ofKind('label'), ['!=', ['get', 'mark'], '']], layout: labelLayout,
    paint: { 'text-color': 'rgba(0,0,0,0)', 'text-halo-color': MARK, 'text-halo-width': ['case', ['==', ['get', 'box'], 1], 0, 3], 'text-halo-blur': 0,
      'text-opacity': ['match', ['get', 'mark'], 'sel', 1, HOVER], 'icon-opacity': ['match', ['get', 'mark'], 'sel', 1, HOVER],
      'icon-color': MARK, 'icon-halo-color': MARK, 'icon-halo-width': 2 } },
  { id: 'draw-label-text', type: 'symbol', source: 'drawlabel', filter: ofKind('label'), layout: labelLayout,
    paint: { 'text-color': ['get', 'c'], 'text-halo-color': WHITE, 'text-halo-width': ['case', ['==', ['get', 'box'], 1], 0, HALO_W],
      'icon-color': WHITE, 'icon-halo-color': ['get', 'c'], 'icon-halo-width': 1 } }, // the box's halo is its 1 px border
  handleLayer('draw-lhandle', 'drawlabel', 'lhandle'),
  // a point's centre: selected, a small white dot edged as a handle; hovered, a ring
  { id: 'draw-mark-point', type: 'circle', source: 'drawover', filter: ['all', ['in', ['get', 'kind'], ['literal', ['sel', 'hover']]], ['==', ['geometry-type'], 'Point']],
    paint: { 'circle-radius': ['match', ['get', 'kind'], 'sel', 5, 11], 'circle-color': WHITE, 'circle-opacity': ['match', ['get', 'kind'], 'sel', 1, 0],
      'circle-stroke-color': ['match', ['get', 'kind'], 'sel', INK, MARK], 'circle-stroke-width': ['match', ['get', 'kind'], 'sel', 1.5, BAND], 'circle-stroke-opacity': ['match', ['get', 'kind'], 'sel', 1, HOVER] } },
  // among several selected, each element's key points as its handles would look, inert (features.js dots)
  handleLayer('draw-mark-dot', 'drawover', 'dot'),
  // the values of the elements showing them, and of what is being drawn (features.js valueFeatures):
  // on top of everything
  { id: 'draw-value', type: 'symbol', source: 'drawvalue', filter: ['has', 'label'],
    layout: { 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Bold'], 'text-size': 11, 'text-anchor': ['get', 'anchor'],
      'text-allow-overlap': true, 'text-ignore-placement': true, 'text-justify': 'center' },
    paint: { 'text-color': '#7a0d55', 'text-halo-color': WHITE, 'text-halo-width': HALO_W } },
];
// what a click can hit, topmost first (drawing-ui.md §5): symbols, lines, closed lines' fills, circles
export const HIT_LAYERS = DRAW_LAYERS.filter((l) => /^draw-(symbol|polygon|path|guide|linehit|ring|label-text)/.test(l.id)).map((l) => l.id).reverse();
export const MARK_LAYERS = DRAW_LAYERS.filter((l) => /^draw-(mark|handle|stalk|mid|lhandle)/.test(l.id)).map((l) => l.id);
// what a press can grab, and the cursor over each
export const HANDLE_LAYERS = ['draw-handle', 'draw-mid', 'draw-lhandle'];
export const CURSOR = { move: 'move', point: 'grab', vertex: 'grab', mid: 'copy', scale: 'nwse-resize', radius: 'ew-resize', aperture: 'ew-resize', rotate: 'crosshair', anchor: 'grab' };
