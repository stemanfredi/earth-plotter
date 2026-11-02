// Isobaths as vector tiles: the lines are traced from the depths as the data has them, uncut, at the
// zoom where the data has its last detail, and cut in vector space against the sea polygons the base
// map draws at the tile's own zoom (clip.js isobaths), so that a line ends on the shore as it is
// drawn, at any zoom, and never a pixel over it. The raster says how deep, the vector says where the
// sea is. Pure: no fetching, no worker. Coordinates are a tile's, 0…EXTENT across it, y down.
import mlcontour from './vendor/maplibre-contour.mjs';

const { generateIsolines, HeightTile } = mlcontour;
export const EXTENT = 4096;

// The lines of a tile every `step` metres, from its elevation and its 8 neighbours' ([nw, n, ne, w,
// c, e, sw, s, se], each size × size metres row-major, or undefined off the world), as
// maplibre-contour traces them: pixel centres averaged to a grid, a one-pixel buffer so that the
// lines meet the neighbours' without a gap. → { level: [[x, y, x, y, …], …] }
export function traceLines(neighbours, size, step) {
  const tiles = neighbours.map((data) => data && HeightTile.fromRawDem({ width: size, height: size, data }));
  const tile = HeightTile.combineNeighbors(tiles);
  if (!tile) return {};
  return generateIsolines(step, tile.materialize(2).averagePixelCentersToGrid().materialize(1), EXTENT, 1);
}

// The parts of lines ([[x, y, x, y, …], …]) inside the region bounded by rings ([[x, y, …], …], a
// polygon's outer rings and holes together, inside where the winding is not zero, as the base map
// fills water). Each segment is split where it crosses an edge, and each piece kept if its middle is
// inside; the pieces kept in a row make one line. Edges are indexed by bands of y, so that a tile's
// thousands of edges are not all tried for each segment.
export function clipLines(lines, rings) {
  const edges = []; // [x1, y1, x2, y2]
  for (const r of rings) for (let i = 0; i < r.length; i += 2) edges.push([r[i], r[i + 1], r[(i + 2) % r.length], r[(i + 3) % r.length]]);
  if (!edges.length) return [];
  let lo = Infinity, hi = -Infinity;
  for (const [, y1, , y2] of edges) { lo = Math.min(lo, y1, y2); hi = Math.max(hi, y1, y2); }
  const BANDS = 64, band = (y) => Math.max(0, Math.min(BANDS - 1, Math.floor(((y - lo) / (hi - lo || 1)) * BANDS)));
  const bands = Array.from({ length: BANDS }, () => []);
  edges.forEach((e, k) => { for (let b = band(Math.min(e[1], e[3])); b <= band(Math.max(e[1], e[3])); b++) bands[b].push(k); });
  const inside = (px, py) => {
    if (py < lo || py > hi) return false;
    let wn = 0;
    for (const k of bands[band(py)]) {
      const [x1, y1, x2, y2] = edges[k];
      if ((y1 <= py) === (y2 <= py)) continue;
      if (x1 + ((py - y1) * (x2 - x1)) / (y2 - y1) > px) wn += y2 > y1 ? 1 : -1;
    }
    return wn !== 0;
  };
  const out = [];
  for (const line of lines) {
    let cur = null;
    for (let i = 0; i + 3 < line.length; i += 2) {
      const ax = line[i], ay = line[i + 1], bx = line[i + 2], by = line[i + 3], dx = bx - ax, dy = by - ay;
      const ts = [0, 1];
      if (Math.max(ay, by) >= lo && Math.min(ay, by) <= hi) {
        const seen = new Set();
        for (let b = band(Math.min(ay, by)); b <= band(Math.max(ay, by)); b++) {
          for (const k of bands[b]) {
            if (seen.has(k)) continue;
            seen.add(k);
            const [x1, y1, x2, y2] = edges[k], ex = x2 - x1, ey = y2 - y1, den = dx * ey - dy * ex;
            if (!den) continue;
            const t = ((x1 - ax) * ey - (y1 - ay) * ex) / den, u = ((x1 - ax) * dy - (y1 - ay) * dx) / den;
            if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
          }
        }
        ts.sort((p, q) => p - q);
      }
      for (let k = 0; k + 1 < ts.length; k++) {
        const t0 = ts[k], t1 = ts[k + 1];
        if (t1 - t0 < 1e-9) continue;
        const tm = (t0 + t1) / 2;
        if (!inside(ax + dx * tm, ay + dy * tm)) { cur = null; continue; }
        const x0 = ax + dx * t0, y0 = ay + dy * t0, x1 = ax + dx * t1, y1 = ay + dy * t1;
        if (!cur) { cur = [x0, y0]; out.push(cur); }
        cur.push(x1, y1);
      }
    }
  }
  return out;
}

// ---- a minimal Mapbox Vector Tile writer: one layer of lines with one integer property ---------
function writer() {
  let buf = new Uint8Array(1024), n = 0;
  const room = (k) => { if (n + k > buf.length) { const b = new Uint8Array(Math.max(buf.length * 2, n + k)); b.set(buf); buf = b; } };
  const w = {
    varint(v) { room(10); do { let b = v & 0x7f; v = Math.floor(v / 128); if (v) b |= 0x80; buf[n++] = b; } while (v); },
    bytes(field, b) { w.varint((field << 3) | 2); w.varint(b.length); room(b.length); buf.set(b, n); n += b.length; },
    message(field, fn) { const inner = writer(); fn(inner); w.bytes(field, inner.done()); },
    done: () => buf.slice(0, n), // its own buffer, exactly: MapLibre takes the buffer whole
  };
  return w;
}
const zz = (v) => (v << 1) ^ (v >> 31); // zigzag
// a vector tile holding layer `name`, with a line feature per entry of features: [{ value, lines }],
// `key` = value on each (an integer), the lines' coordinates rounded to integers
export function encodeLines(name, key, features, extent = EXTENT) {
  const t = writer();
  t.message(3, (l) => {
    l.bytes(1, new TextEncoder().encode(name));
    const values = [...new Set(features.map((f) => f.value))];
    for (const f of features) {
      // each line as whole points, a point the same as the last dropped; a line under two points left
      // out, and a feature with no line left
      const lines = f.lines.map((line) => {
        const pts = [];
        for (let i = 0; i < line.length; i += 2) { const x = Math.round(line[i]), y = Math.round(line[i + 1]); if (!pts.length || pts.at(-2) !== x || pts.at(-1) !== y) pts.push(x, y); }
        return pts;
      }).filter((pts) => pts.length >= 4);
      if (!lines.length) continue;
      l.message(2, (ft) => {
        ft.message(2, (tags) => { tags.varint(0); tags.varint(values.indexOf(f.value)); });
        ft.varint((3 << 3) | 0); ft.varint(2); // type LINESTRING
        ft.message(4, (g) => {
          let cx = 0, cy = 0;
          for (const pts of lines) {
            g.varint((1 << 3) | 1); g.varint(zz(pts[0] - cx)); g.varint(zz(pts[1] - cy)); cx = pts[0]; cy = pts[1]; // MoveTo
            g.varint((pts.length / 2 - 1) << 3 | 2); // LineTo × n − 1
            for (let i = 2; i < pts.length; i += 2) { g.varint(zz(pts[i] - cx)); g.varint(zz(pts[i + 1] - cy)); cx = pts[i]; cy = pts[i + 1]; }
          }
        });
      });
    }
    l.bytes(3, new TextEncoder().encode(key));
    for (const v of values) l.message(4, (val) => { val.varint((6 << 3) | 0); val.varint(zz(v)); }); // sint_value
    l.varint((5 << 3) | 0); l.varint(extent);
    l.varint((15 << 3) | 0); l.varint(2);
  });
  return t.done();
}
