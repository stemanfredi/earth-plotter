#!/usr/bin/env node
// What the providers offer against what catalog.js names (newer library versions: npm outdated).
// Weekly in CI. Newer data periods in the EMODnet density WMS show as a notice; a density layer, its
// times, a Copernicus dataset or one of its variables no longer offered fail the run (a dataset
// version retired, a layer renamed: the page would draw nothing there).
//   node tools/data-check.mjs
import { DENSITY, HA_WMS, ITEMS, CMEMS } from '../site/catalog.js';
import { HOSTS } from '../site/hosts.js';
import { partOf } from '../site/cmems.js';

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
if (problems.length) process.exit(1);
