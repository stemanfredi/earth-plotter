import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialState, readAddress, viewToAddress, hashOf, KNOWN, ENTRIES } from '../../site/address.js';
import { parse } from '../../site/draw/file.js';

const fresh = () => ({ state: initialState(Date.UTC(2026, 10, 6, 9, 30)), display: { units: 'km', bearings: false } });
const here = { center: [12, 41], zoom: 4 };
// a view written as an address, then read back into a page's state
function roundTrip(v) {
  const q = new URLSearchParams();
  viewToAddress(v, q, here);
  const { state, display } = fresh(), camera = readAddress(hashOf(q), state, display);
  return { hash: hashOf(q), state, display, camera };
}

test('address: the state as it starts, the hour of now', () => {
  const { state } = fresh();
  assert.equal(state.time, Date.UTC(2026, 10, 6, 9));
  assert.ok(state.on.has('chart'));
  assert.equal(state.colour, '');
});

test('address: a view written and read back, its camera, layers, data, time, depth, units', () => {
  const v = { center: [9.82488, 44.09044], zoom: 12.5, bearing: 350, layers: [{ id: 'chart' }, { id: 'depth', variant: 'atlas' }, { id: 'relief', opacity: 0.5 }],
    data: { colour: { id: 'waves', variant: 'height' }, arrows: { id: 'currents', variant: 'surface' }, time: '2026-11-06T13:00:00Z', depth: 50 }, units: 'nm', bearings: true };
  const { hash, state, display, camera } = roundTrip(v);
  assert.deepEqual({ ...camera, center: camera.center.map((x) => +x.toFixed(5)) }, { zoom: 12.5, center: [9.82488, 44.09044], bearing: -10 });
  assert.deepEqual([...state.on].sort(), ['chart', 'depth', 'relief']);
  assert.equal(state.opacity.relief, 0.5);
  assert.ok(!/var=/.test(hash), 'a default variant is not written');
  assert.equal(state.colour, 'waves:height');
  assert.equal(state.arrows, 'currents:surface');
  assert.equal(state.time, Date.UTC(2026, 10, 6, 13));
  assert.equal(state.depth, 50);
  assert.deepEqual(display, { units: 'nm', bearings: true });
});

test('address: an Ocean data layer\'s opacity kept, once for an item in both menus; a default one not written', () => {
  const { hash, state } = roundTrip({ center: [12, 41], zoom: 5, layers: [{ id: 'chart' }],
    data: { colour: { id: 'currents', variant: 'surface', opacity: 0.4 }, arrows: { id: 'currents', variant: 'surface', opacity: 0.4 } } });
  assert.equal(state.opacity.currents, 0.4);
  assert.equal(hash.match(/currents:0\.4/g).length, 1);
  assert.ok(!/op=/.test(roundTrip({ center: [12, 41], zoom: 5, data: { colour: { id: 'waves', variant: 'height', opacity: 0.85 } } }).hash));
  // a view without data leaves the address's data opacities as they are, and without layers its layers'
  const q = new URLSearchParams('op=waves:0.3,relief:0.2');
  viewToAddress({ center: [12, 41], zoom: 5 }, q, here);
  assert.equal(q.get('op'), 'relief:0.2,waves:0.3');
});

test('address: one base map, the first listed; none listed: the chart', () => {
  const read = (hash) => { const { state, display } = fresh(); readAddress(hash, state, display); return [...state.on]; };
  assert.deepEqual(read('#on=coastline'), ['chart', 'coastline']);
  assert.deepEqual(read('#on=sat,chart,roads'), ['sat', 'roads']);
  assert.deepEqual(read('#on=waves,nothing,chart'), ['chart'], 'unknown items and data layers dropped');
});

test('address: what is not valid is left as it was', () => {
  const { state, display } = fresh(), was = structuredClone({ ...state, on: [...state.on] });
  const camera = readAddress('#v=4/95/12&t=2026-13-01T00&dz=7&col=waves:nope&op=relief:x,depth:&per=nope:2020', state, display);
  assert.equal(camera, null, 'a latitude past the pole');
  assert.deepEqual({ ...state, on: [...state.on] }, was);
});

test('address: a drawing file\'s view, checked, comes back the same through the address', () => {
  const file = JSON.stringify({ type: 'FeatureCollection', features: [], earthplotter: { // this format's version (none given)
    view: { center: [9.8, 44.1], zoom: 9, bearing: 0, layers: [{ id: 'chart' }], data: { colour: { id: 'normalwaves', variant: 'height', opacity: 0.6 }, arrows: null, time: '2026-01-15T12:00:00Z', depth: null } } } });
  const { view } = parse(file, KNOWN, Date.UTC(2026, 10, 6));
  assert.deepEqual(view.data.colour, { id: 'normalwaves', variant: 'height', opacity: 0.6 });
  const { state } = roundTrip(view);
  assert.equal(state.colour, 'normalwaves:height');
  assert.equal(state.opacity.normalwaves, 0.6);
});

test('address: every menu entry names an item at a variant the file check knows', () => {
  for (const e of [...ENTRIES.colour, ...ENTRIES.arrows]) {
    const [id, v] = e.key.split(':');
    assert.ok(KNOWN.data[id].includes(v), e.key);
  }
});
