// The address: the page's state as the URL's hash says it, and as a drawing file's view says it
// (docs/drawing-format.md §4), one grammar read and written here, with no map and no page: the
// catalogue's items and entries, the state as it starts, the hash read into it, a view written as a
// hash. app.js keeps what needs the map (the view as it is now, applying it).
import { ITEMS, isBase, GIBS, CMEMS, CMEMS_DEPTHS, DENSITY, GRIDS, drawsOf } from './catalog.js';
import { norm180 } from './geo.js';

export const byId = Object.assign(Object.create(null), Object.fromEntries(ITEMS.map((it) => [it.id, it]))); // no inherited names: the link names items
// Ocean data: the layers that change with time, chosen in two menus, colours and arrows. An entry
// is an item at a variant ('waves:height'), in the menus of what it can draw (drawsOf: currents in
// both, speed and direction)
export const DATA = ITEMS.filter((it) => it.group === 'data');
export const variantsOf = (it) => (it.group === 'data' ? Object.keys(it.kind === 'gibs' ? GIBS : CMEMS[it.id]) : it.variants ? Object.keys(it.variants) : null); // its choices, by key
const drawsOfEntry = (it, v) => (it.kind === 'gibs' ? ['colour'] : drawsOf(CMEMS[it.id][v]));
const entryLabel = (it, v, slot) => (it.kind === 'gibs' ? `NASA ${GIBS[v].label.replace('True colour', 'true colour')}`
  : CMEMS[it.id][v].labels?.[slot] ?? CMEMS[it.id][v].label);
export const entryOf = (key) => { if (!key) return null; const [id, variant] = key.split(':'); return { id, variant: variant ?? null }; }; // 'item:variant' → { id, variant }, '' → null
export const ENTRIES = { colour: [], arrows: [] }; // slot → [{ key, it, label }]
for (const it of DATA) for (const v of variantsOf(it)) for (const slot of drawsOfEntry(it, v)) ENTRIES[slot].push({ key: `${it.id}:${v}`, it, label: entryLabel(it, v, slot) });
// the base maps: one of them is on, always (their group is exclusive); the first is the default
const BASES = ITEMS.filter(isBase).map((it) => it.id);

export const hour = (t) => Math.floor(t / 36e5) * 36e5; // the hour a time falls in (ms)
// a layer as it starts: its first variant, its own opacity, a density dataset's default period
export const defaultsOf = (it) => ({ variant: variantsOf(it)?.[0], opacity: it.opacity ?? undefined, period: DENSITY[it.id]?.defaultPeriod });
// the state as the page starts (now: ms), before the address is read
export const initialState = (now) => ({
  on: new Set(ITEMS.filter((it) => it.on).map((it) => it.id)),
  variant: Object.fromEntries(ITEMS.filter((it) => variantsOf(it)).map((it) => [it.id, defaultsOf(it).variant])),
  opacity: Object.fromEntries(ITEMS.filter((it) => it.opacity != null).map((it) => [it.id, it.opacity])),
  time: hour(now), // the map's time: the hour shown (ms), now by default
  depth: 0, // Copernicus layers with depth: metres below the surface (CMEMS_DEPTHS)
  period: Object.fromEntries(Object.keys(DENSITY).map((id) => [id, defaultsOf(byId[id]).period])), // density datasets
  grid: GRIDS[0][0], // the grid the sea's depths are read from in European seas (catalog.js GRIDS)
  colour: '', arrows: '', // Ocean data: the entry drawing colours, the one drawing arrows ('item:variant', '' for none)
});

// The hash (location.hash) read into state and display ({ units, bearings }): what it says that is
// known and valid, the rest as it was. Returns the camera it gives ({ zoom, center, bearing }), or null.
export function readAddress(hash, state, display) {
  const q = new URLSearchParams(hash.replace(/^#/, ''));
  const v = (q.get('v') || '').split('/').map(Number);
  const camera = v.length >= 3 && v.every(Number.isFinite) && Math.abs(v[1]) <= 90 ? { zoom: v[0], center: [norm180(v[2]), v[1]], bearing: v[3] || 0 } : null; // a latitude past the pole would throw in MapLibre; a longitude past 180° is the same place
  if (q.has('on')) {
    const on = q.get('on').split(',').filter((id) => byId[id] && byId[id].group !== 'data'); // the data layers: col= and arr= (applyData)
    const base = on.find((id) => BASES.includes(id)) ?? BASES[0]; // one base, the first listed: none or two would leave the map without one, or draw two
    state.on = new Set([base, ...on.filter((id) => !BASES.includes(id))]);
  }
  for (const kv of (q.get('var') || '').split(',')) {
    const { id: k, variant: val } = entryOf(kv) ?? {};
    if (byId[k]?.group !== 'data' && Object.hasOwn(byId[k]?.variants ?? {}, val)) state.variant[k] = val;
  }
  for (const kv of (q.get('op') || '').split(',')) { // the data layers' too
    const [k, val] = kv.split(':');
    if (Object.hasOwn(state.opacity, k) && val !== '' && Number.isFinite(+val)) state.opacity[k] = Math.min(1, Math.max(0, +val));
  }
  for (const [slot, key] of [['colour', 'col'], ['arrows', 'arr']]) if (ENTRIES[slot].some((e) => e.key === q.get(key))) state[slot] = q.get(key);
  const t = /^\d{4}-\d{2}-\d{2}T\d{2}$/.test(q.get('t') || '') ? Date.parse(`${q.get('t')}:00:00Z`) : NaN; // a date that is no date (month 13) is NaN
  if (Number.isFinite(t)) state.time = t;
  if (CMEMS_DEPTHS.includes(+q.get('dz'))) state.depth = +q.get('dz');
  if (GRIDS.some(([g]) => g === q.get('grid'))) state.grid = q.get('grid');
  for (const kv of (q.get('per') || '').split(',')) {
    const [k, val] = kv.split(':');
    if (Object.hasOwn(DENSITY, k) && DENSITY[k].periods.includes(val)) state.period[k] = val;
  }
  display.bearings = q.get('brg') === '1';
  if (q.get('u') === 'nm') display.units = 'nm';
  return camera;
}

// A view (a drawing file's, or the page's: viewOf in app.js) written into the address q (URLSearchParams),
// over what q says: what it gives replaces it. here: the camera where the view has none ({ center, zoom }).
// Of each layer what differs from its default; an Ocean data entry's opacity likewise.
export function viewToAddress(v, q, here) {
  const c = v.center || here.center;
  q.set('v', [(v.zoom ?? here.zoom).toFixed(2), c[1].toFixed(5), c[0].toFixed(5), +((v.bearing ?? 0) > 180 ? v.bearing - 360 : v.bearing ?? 0).toFixed(1)].join('/')); // a tenth of a degree: a drawing's bearing comes back as saved
  const differs = (l, key) => l[key] !== undefined && l[key] !== defaultsOf(byId[l.id] ?? {})[key]; // a file's layer lacking one: its default
  const kv = (ls, key) => ls.filter((l) => differs(l, key)).map((l) => `${l.id}:${l[key]}`);
  if (v.layers) {
    q.set('on', v.layers.map((l) => l.id).join(','));
    for (const [key, p] of [['variant', 'var'], ['period', 'per']]) { const s = kv(v.layers, key).join(','); if (s) q.set(p, s); else q.delete(p); }
  }
  // opacity: the layers' and the data entries' (an item in both menus: once); of what the view does
  // not give (no layers, no data), the address's own kept
  const old = (q.get('op') || '').split(',').filter(Boolean), kept = (data) => old.filter((s) => (byId[s.split(':')[0]]?.group === 'data') === data);
  const ops = [...(v.layers ? kv(v.layers, 'opacity') : kept(false)), ...(v.data ? kv([v.data.colour, v.data.arrows].filter(Boolean), 'opacity') : kept(true))];
  if (ops.length) q.set('op', [...new Set(ops)].join(',')); else q.delete('op');
  if (v.data) {
    for (const [slot, p] of [['colour', 'col'], ['arrows', 'arr']]) { const e = v.data[slot]; if (e) q.set(p, e.variant ? `${e.id}:${e.variant}` : e.id); else q.delete(p); }
    if (v.data.time) q.set('t', v.data.time.slice(0, 13)); else q.delete('t');
    if (v.data.depth) q.set('dz', v.data.depth); else q.delete('dz');
  }
  if (v.grid && v.grid !== GRIDS[0][0]) q.set('grid', v.grid); else q.delete('grid'); // the depths' grid, where it is not the usual one
  if (v.units === 'nm') q.set('u', 'nm'); else q.delete('u');
  if (v.bearings) q.set('brg', '1'); else q.delete('brg');
}
// the address as the hash, its separators left readable
export const hashOf = (q) => `#${q.toString().replace(/%2C/g, ',').replace(/%2F/g, '/').replace(/%3A/g, ':').replace(/%3B/g, ';').replace(/%7E/g, '~').replace(/%21/g, '!')}`;

// What the app offers, for checking a drawing file's view: layers with their variants and
// periods, the ocean-data entries, the depths
export const KNOWN = {
  layers: Object.fromEntries(ITEMS.filter((it) => it.group !== 'data').map((it) => [it.id, { variants: it.variants ? Object.keys(it.variants) : null, periods: DENSITY[it.id]?.periods || null }])),
  data: {},
  depths: CMEMS_DEPTHS,
};
for (const e of [...ENTRIES.colour, ...ENTRIES.arrows]) { const { id, variant: v } = entryOf(e.key); if (!(KNOWN.data[id] ||= []).includes(v)) KNOWN.data[id].push(v); }
