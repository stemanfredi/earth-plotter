// Layers as data (the GIS export): the values a layer draws, read from its datasets' Zarr stores
// (zarr.js) and written as GeoTIFF (geotiff.js), over the view's bounding box [west, south, east,
// north]. Each returns [{ key, file, w, h, transform, names, units, title, description, data }].
import { CMEMS, EMODNET, GEBCO, GEBCO_TID } from './catalog.js';
import { partTimes, partLevels, regionOf, cmemsStacUrl, storedVariables, partOf, partIn } from './cmems.js';
import { openStore, timeScale, nearest, cellsOf, readCells } from './zarr.js';
import { geotiff } from './geotiff.js';
import { gebcoStore } from './gebco.js';
import { fetchOk, fetchBytes, lru } from './net.js';
import { normalWords } from './format.js';

// One raster record of the export: the cells' grid (cellsOf) as a GeoTIFF of planes, EPSG:4326
function rasterOf(cells, key, { title, description, names, units, planes, bands }) {
  const w = cells.cols.length, h = cells.rows.length, transform = [cells.dlon, 0, cells.west - cells.dlon / 2, 0, -cells.dlat, cells.north + cells.dlat / 2];
  return { key, file: `${key}.tif`, w, h, transform, names, units, title, description, data: geotiff(planes, w, h, transform, { crs: 4326, bands }) };
}

// Copernicus's and EMODnet's stores read their files with fetchBytes: null where the store says 403
// or 404, as a public bucket answers 403, not 404, for a file it does not hold; either means a chunk
// not stored (all land, or a time no longer kept), read as fill. A store that is not public fails at
// its metadata (zarr.js openStore), not with empty rasters. (GEBCO's: gebco.js, none missing.)
const stores = lru(Infinity); // part → promise of its store and coordinates
function storeOf(part) {
  return stores(part, async () => {
    const r = await fetchOk(cmemsStacUrl(part));
    const store = await openStore((await r.json()).assets.timeChunked.href, fetchBytes);
    const [time, lat, lon, elevation] = await Promise.all(['time', 'latitude', 'longitude', 'elevation'].map((c) => (store.meta(c) ? store.coord(c) : null)));
    return { store, times: Array.from(time, timeScale(store.meta('time').attrs.units)), lat, lon, elevation };
  });
}
// raster/<item>[-<region>].tif: the values a Copernicus layer draws, read from each of its datasets'
// Zarr stores (zarr.js), at the time and level it draws, in the dataset's own latitude/longitude
// grid over the view's bounding box; arrows as two bands, eastward and northward
// at: { variant, t, depth } as captured
export async function cmemsValues(id, at, box) {
  const v = CMEMS[id][at.variant];
  if (v.still) throw new Error('published as a map only, not as data'); // its datasets have no Zarr store
  const [times, levels] = await Promise.all([partTimes(id, at.variant, at.t), partLevels(id, at.variant, at.depth)]);
  return (await Promise.all(v.parts.map(async (part, i) => {
    // partTimes: undefined where the dataset's steps could not be read (the map asked for its tiles
    // anyway): said, not left out in silence; null where it has nothing at this time
    if (!partIn(part, box)) return null; // a region the view does not meet: not asked about at all
    if (times[i] === undefined) throw new Error('its time steps could not be read');
    if (times[i] === null) return null; // nothing at this time
    const { store, times: ts, lat, lon, elevation } = await storeOf(part);
    const ti = nearest(ts, times[i], 6e4), zi = elevation && levels[i] != null ? nearest(elevation, +levels[i]) : 0;
    const cells = cellsOf(lat, lon, box);
    if (ti < 0 || !cells.rows.length) return null; // not in the store (yet), or not in view
    const names = storedVariables(part), units = names.map((n) => store.meta(n).attrs.units || '');
    const planes = await Promise.all(names.map((n) => readCells(store, n, ti, zi, cells)));
    const region = regionOf(part)?.name || (v.parts.length > 1 ? 'Global' : ''), key = `raster/${id}${region ? `-${region.toLowerCase()}` : ''}`;
    // a climatology's time is a month of its stand-in year: said as the month, not as that year's date
    const when = v.month ? normalWords(ts[ti], 'en') : new Date(ts[ti]).toISOString(), level = elevation ? +Math.abs(elevation[zi]).toFixed(2) : null;
    const description = `${partOf(part).id.replace('/', ' / ')}: ${names.join(', ')} (${[...new Set(units)].join(', ')})${v.month ? ',' : ' at'} ${when}${level != null ? `, ${level} m deep` : ''}; its own grid, EPSG:4326${cells.step > 1 ? `, every ${cells.step}th cell` : ''}, over the view's bounding box. No data: NaN`;
    return rasterOf(cells, key, { title: `${v.label}${region ? `, ${region}` : ''}: values`, description, names, units, planes,
      bands: names.map((n, k) => ({ description: `${n}, ${when}${level != null ? `, ${level} m` : ''}`, unit: units[k] })) });
  }))).filter(Boolean);
}

// how many of a store's chunks (meta m) the cells read
const chunksOf = (cells, m) => new Set(cells.rows.map((r) => Math.floor(r / m.chunks[0]))).size * new Set(cells.cols.map((c) => Math.floor(c / m.chunks[1]))).size;
// raster/gebco-depth.tif: GEBCO's elevation over the view's bounding box, in its own grid, at the
// finest level that needs at most 16 of its chunks (level 0, GEBCO's 15″ cells, for views up to
// several degrees across; a coarser one, means of 2^k × 2^k cells, for wider views: never left out).
// raster/gebco-source.tif: its type identifier codes, the same way (a coarser level: the most
// common code of the cells below). The coordinates follow from the grids' regular spacing, so none
// are downloaded. The map's store (gebco.js): a chunk missing fails the export, not read as fill.
// raster/emodnet-depth.tif: the depths as the page draws them in European seas, from its own store of
// EMODnet's grid (tools/emodnet.mjs), the same way: its 1/16′ cells for a view a few degrees across, a
// coarser level (the mean of the water among 2^k × 2^k cells) for a wider one. Land has no value.
const DEPTH_GRIDS = {
  elevation: { url: GEBCO, variable: 'elevation', key: 'raster/gebco-depth', title: 'GEBCO depth: values', unit: 'm', band: 'elevation, GEBCO 2026', cell: '15″', source: 'GEBCO 2026 Grid (GEBCO Compilation Group)',
    what: (grid) => `elevation (m, negative below mean sea level; in Europe's surveyed tidal waters below lowest astronomical tide, as GEBCO took EMODnet's surveys), ${grid}` },
  tid: { url: GEBCO_TID, variable: 'tid', key: 'raster/gebco-source', title: 'GEBCO depth sources: type identifier codes', unit: '', band: 'type identifier, GEBCO 2026', cell: '15″', source: 'GEBCO 2026 Grid (GEBCO Compilation Group)', codes: true,
    what: (grid) => `type identifier: how each cell's depth was obtained (0 land, 10–17 surveyed, 16 of them read from satellite images, 40–47 estimated, 70–72 other grids or unknown; the codes in GEBCO's documentation), ${grid}` },
  emodnet: { url: EMODNET, variable: 'elevation', key: 'raster/emodnet-depth', title: 'EMODnet depth: values', unit: 'm', band: 'elevation, EMODnet DTM 2024', cell: '1/16′', source: 'EMODnet Bathymetry DTM 2024, as Earth Plotter draws it in European seas',
    what: (grid) => `the sea's depth (m, negative; vertical reference lowest astronomical tide; to a quarter of a metre), EMODnet's cells surveyed and interpolated alike, GEBCO's water where EMODnet has none near; land has no value; ${grid}` },
};
export const gebcoValues = (box, grid = 'elevation') => gridValues(DEPTH_GRIDS[grid], box);
// a depth store's values over box, g as above (exported for the unit tests)
export async function gridValues(g, box) {
  const variable = g.variable, store = await gebcoStore(g.url);
  for (let k = 0; ; k++) {
    const name = `${k}/${variable}`, m = store.meta(name);
    if (!m) throw new Error('no level of the grid fits this view');
    // the level's cells: GEBCO's go round the world from 90° N, 180° W; a regional store says its own
    const [H, W] = m.shape, cs = m.attrs.cell_size_degrees ?? 180 / H, north = m.attrs.north ?? 90, west = m.attrs.west ?? -180;
    const cells = cellsOf(Float64Array.from({ length: H }, (_, i) => north - (i + 0.5) * cs), Float64Array.from({ length: W }, (_, i) => west + (i + 0.5) * cs), box);
    if (!cells.rows.length) return [];
    const blocks = chunksOf(cells, m);
    if (blocks > 16 || cells.step > 1) continue;
    const level = !k ? `its own grid (${g.cell} cells)` : g.codes ? `level ${k} of its grid (the most common code of ${2 ** k} × ${2 ** k} of its ${g.cell} cells)` : `level ${k} of its grid (means of ${2 ** k} × ${2 ** k} of its ${g.cell} cells)`;
    const description = `${g.source}: ${g.what(level)}, EPSG:4326, over the view's bounding box. No data: NaN. Not for navigation`;
    return [rasterOf(cells, g.key, { title: g.title, description, names: [variable], units: [g.unit], planes: [await readCells(store, name, 0, 0, cells)], bands: [{ description: g.band, unit: g.unit }] })];
  }
}
// the same, the depths as drawn in European seas
export const emodnetValues = (box) => gebcoValues(box, 'emodnet');
