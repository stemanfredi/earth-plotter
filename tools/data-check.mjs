#!/usr/bin/env node
// What the providers offer against what catalog.js names (newer library versions: npm outdated).
// Weekly in CI. Newer data periods in the EMODnet density WMS show as a notice; a density layer, its
// times, a Copernicus dataset or one of its variables no longer offered fail the run (a dataset
// version retired, a layer renamed: the page would draw nothing there). So do the imagery's: a
// country's coverage not on the data host, a national service or EOX's newest year not answering
// with an image; EOX's next year offered is a notice.
//   node tools/data-check.mjs
import { DENSITY, HA_WMS, ITEMS, CMEMS, ORTHO, EOX_YEARS, eoxTiles } from '../site/catalog.js';
import { HOSTS } from '../site/hosts.js';
import { partOf } from '../site/cmems.js';
import { COVERAGE } from '../site/ortho.js';

const problems = [];
const problem = (title, what) => {
  problems.push(`${title}: ${what}`);
  console.log(`${title.padEnd(24)} ${what}   ← NOT OFFERED`);
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=${title}::${what}`);
};

// newest period the WMS offers for each density dataset vs the newest one catalog.js lists
const r = await fetch(`${HA_WMS}?service=WMS&request=GetCapabilities&version=1.3.0`);
if (!r.ok) throw new Error(`EMODnet capabilities ${r.status}`);
const xml = await r.text();
for (const [id, d] of Object.entries(DENSITY)) {
  const title = ITEMS.find((x) => x.id === id)?.label ?? id; // the layer's name as the menu shows it
  const name = d.layer('all');
  const i = xml.indexOf(`<Name>${name}</Name>`);
  if (i < 0) { problem(title, `the WMS has no layer ${name}`); continue; }
  const times = (/name="time"[^>]*>([^<]*)/.exec(xml.slice(i, xml.indexOf('</Layer>', i))) || [])[1] || '';
  const newest = times.match(/\d{4}-\d{2}/g)?.sort().at(-1);
  if (!newest) { problem(title, `the WMS lists no times for ${name}`); continue; }
  const listed = [...d.periods].sort().at(-1);
  const offered = id === 'traffic' ? newest.slice(0, 4) : newest;
  const newer = offered > listed;
  console.log(`${title.padEnd(24)} listed to ${listed.padEnd(8)} WMS offers to ${offered}${newer ? '   ← newer data: update catalog.js' : ''}`);
  if (newer && process.env.GITHUB_ACTIONS) console.log(`::notice title=Newer ${title}::the WMS has ${offered}; catalog.js lists to ${listed}`);
}

// each Copernicus dataset the layers draw: its capabilities answer and list every variable drawn
// from it (dataset ids carry a version, _202311, which Copernicus retires)
const datasets = new Map(); // product/dataset → variables drawn
for (const v of Object.values(CMEMS).flatMap(Object.values)) {
  for (const part of v.parts) { const { id, variable } = partOf(part); datasets.set(id, new Set([...(datasets.get(id) || []), variable])); }
}
const ids = [...datasets.keys()];
for (let k = 0; k < ids.length; k += 4) { // four at a time
  await Promise.all(ids.slice(k, k + 4).map(async (id) => {
    const caps = await fetch(`${HOSTS.copernicusWmts}/teroWmts/${id}?SERVICE=WMTS&REQUEST=GetCapabilities`).catch((e) => ({ ok: false, status: e.message }));
    if (!caps.ok) { problem('Copernicus', `${id}: capabilities ${caps.status}`); return; }
    const text = await caps.text(), missing = [...datasets.get(id)].filter((variable) => !text.includes(`/${variable}</ows:Identifier>`));
    if (missing.length) problem('Copernicus', `${id}: no layer ${missing.join(', ')}`);
  }));
}
console.log(`Copernicus: ${ids.length} datasets asked, ${problems.filter((p) => p.startsWith('Copernicus')).length} not as listed`);

// the imagery: each country's coverage published, its service answering one tile inside it (Italy:
// any of its flights), EOX's newest year answering; its next year a notice
const tile = (url, z, x, y) => url.replace('{z}', z).replace('{x}', x).replace('{y}', y);
const image = (url) => fetch(url).then((t) => t.ok && /^image\//.test(t.headers.get('content-type')), () => false);
for (const o of ORTHO) {
  const ix = await fetch(`${COVERAGE}/${o.id}/index.json`).then((t) => (t.ok ? t.json() : null), () => null);
  if (!ix?.inside?.length) { problem(`aerial ${o.id}`, `no coverage at ${COVERAGE}/${o.id}/index.json`); continue; }
  const [y, x] = ix.inside[Math.floor(ix.inside.length / 2)]; // a row half-way down: inland
  const ok = (await Promise.all(o.parts.map((p) => image(tile(p, ix.z, x, y))))).some(Boolean);
  console.log(`${o.id.padEnd(24)} coverage ${ix.inside.length} rows inside; tile ${ix.z}/${x}/${y} ${ok ? 'an image' : 'no image'}`);
  if (!ok) problem(`aerial ${o.id}`, `no image for tile ${ix.z}/${x}/${y}`);
}
const newest = Math.max(...EOX_YEARS);
if (!await image(tile(eoxTiles(newest), 0, 0, 0))) problem('EOX', `no image for ${newest}`);
else console.log(`${'EOX'.padEnd(24)} ${newest} answers`);
if (await image(tile(eoxTiles(newest + 1), 0, 0, 0))) {
  console.log(`${'EOX'.padEnd(24)} ${newest + 1} offered   ← newer mosaic: add it to EOX_YEARS`);
  if (process.env.GITHUB_ACTIONS) console.log(`::notice title=Newer EOX::EOX offers ${newest + 1}; catalog.js lists to ${newest}`);
}
if (problems.length) process.exit(1);
