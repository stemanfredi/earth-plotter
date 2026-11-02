import { test } from 'node:test';
import assert from 'node:assert/strict';
import { traceLines, clipLines, encodeLines, EXTENT } from '../../site/isobaths.js';

// a small vector tile reader for what encodeLines writes: { name, extent, features: [{ value, lines }] }
function readTile(buf) {
  let p = 0;
  const varint = () => { let v = 0, s = 0, b; do { b = buf[p++]; v += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return v; };
  const bytes = () => { const n = varint(), out = buf.subarray(p, p + n); p += n; return out; };
  const zz = (n) => (n >>> 1) ^ -(n & 1);
  assert.equal(varint(), (3 << 3) | 2);
  const layer = bytes();
  p = 0; buf = layer;
  const out = { features: [], keys: [], values: [] };
  while (p < layer.length) {
    const f = varint() >> 3;
    if (f === 1) out.name = new TextDecoder().decode(bytes());
    else if (f === 3) out.keys.push(new TextDecoder().decode(bytes()));
    else if (f === 5) out.extent = varint();
    else if (f === 15) varint();
    else if (f === 4) { const v = bytes(), save = [buf, p]; buf = v; p = 0; assert.equal(varint(), (6 << 3) | 0); out.values.push(zz(varint())); [buf, p] = save; }
    else if (f === 2) {
      const fb = bytes(), save = [buf, p]; buf = fb; p = 0;
      const ft = { lines: [] };
      while (p < fb.length) {
        const k = varint() >> 3;
        if (k === 2) { const t = bytes(), s2 = [buf, p]; buf = t; p = 0; varint(); ft.vi = varint(); [buf, p] = s2; }
        else if (k === 3) ft.type = varint();
        else if (k === 4) {
          const g = bytes(), s2 = [buf, p]; buf = g; p = 0;
          let x = 0, y = 0, cur = null;
          while (p < g.length) { const c = varint(), id = c & 7, n = c >> 3; for (let i = 0; i < n; i++) { x += zz(varint()); y += zz(varint()); if (id === 1) { cur = [x, y]; ft.lines.push(cur); } else cur.push(x, y); } }
          [buf, p] = s2;
        }
      }
      out.features.push(ft); [buf, p] = save;
    }
  }
  for (const ft of out.features) ft.value = out.values[ft.vi];
  return out;
}

test('clipLines: the parts of lines inside the rings, nonzero winding (a hole cut out), pieces in a row one line', () => {
  const square = [0, 0, 100, 0, 100, 100, 0, 100], hole = [40, 40, 40, 60, 60, 60, 60, 40]; // the hole wound the other way
  const across = clipLines([[-10, 50, 110, 50]], [square, hole]);
  assert.deepEqual(across.map((l) => l.map(Math.round)), [[0, 50, 40, 50], [60, 50, 100, 50]]);
  const inside = clipLines([[10, 10, 30, 10, 30, 30]], [square]);
  assert.deepEqual(inside, [[10, 10, 30, 10, 30, 30]]); // never crossing: one line, as it was
  assert.deepEqual(clipLines([[-5, -5, -1, -1]], [square]), []); // outside: nothing
  assert.deepEqual(clipLines([[10, 10, 90, 90]], []), []); // no sea: nothing
  const diag = clipLines([[-50, 50, 150, 50]], [[0, 0, 100, 0, 100, 100, 0, 100], [200, 0, 300, 0, 300, 100, 200, 100]]);
  assert.deepEqual(diag.map((l) => l.map(Math.round)), [[0, 50, 100, 50]]); // two separate polygons: inside one of them
});

test('encodeLines: a vector tile MapLibre reads: one layer, lines by value, coordinates whole', () => {
  const tile = readTile(encodeLines('contours', 'ele', [{ value: -5, lines: [[0.4, 1.6, 10, 10, 20, 10]] }, { value: -20, lines: [] }, { value: -30, lines: [[5.2, 5.2, 4.9, 4.8]] }, { value: -10, lines: [[3, 3, 3, 3, 4, 4]] }]));
  assert.equal(tile.name, 'contours'); assert.equal(tile.extent, EXTENT); assert.deepEqual(tile.keys, ['ele']);
  assert.deepEqual(tile.features.map((f) => [f.type, f.value, f.lines]), [[2, -5, [[0, 2, 10, 10, 20, 10]]], [2, -10, [[3, 3, 4, 4]]]]); // a repeated point dropped; a feature with no line, or none of two points once rounded, left out
});

test('traceLines: a slope traced every 10 m, the lines where the depth crosses, across the tile and its neighbours', () => {
  const S = 8, slope = (dx) => Float32Array.from({ length: S * S }, (_, k) => -((k % S) + dx) * 5); // 5 m deeper per column, the neighbours continuing it
  const nb = [slope(-S), slope(0), slope(S), slope(-S), slope(0), slope(S), slope(-S), slope(0), slope(S)];
  const lines = traceLines(nb, S, 10);
  const levels = Object.keys(lines).map(Number).sort((a, b) => a - b);
  assert.deepEqual(levels, [-40, -30, -20, -10, 0]); // −35 … 0 within the tile, −40 in the buffer beyond its east edge
  const xOf = (lv) => { const l = lines[lv][0]; for (let i = 2; i < l.length; i += 2) assert.ok(Math.abs(l[i] - l[0]) < 1, `${lv}: a vertical`); return l[0]; };
  assert.ok(xOf(-10) < xOf(-20) && xOf(-20) < xOf(-30), 'deeper to the east');
  const ten = lines[-10][0];
  const ys = ten.filter((_, i) => i % 2);
  assert.ok(Math.min(...ys) < 0 && Math.max(...ys) > EXTENT, 'runs through the tile, buffer to buffer'); // vertical: y from the buffer above to below
});
