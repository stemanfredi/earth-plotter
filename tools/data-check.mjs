#!/usr/bin/env node
// Newer data periods in the EMODnet density WMS than catalog.js lists (newer library versions: npm
// outdated). Weekly in CI, where a newer period shows as a notice.
//   node tools/data-check.mjs
import { DENSITY, HA_WMS, ITEMS } from '../site/catalog.js';

// newest period the WMS offers for each density dataset vs the newest one catalog.js lists
const r = await fetch(`${HA_WMS}?service=WMS&request=GetCapabilities&version=1.3.0`);
if (!r.ok) throw new Error(`EMODnet capabilities ${r.status}`);
const xml = await r.text();
for (const [id, d] of Object.entries(DENSITY)) {
  const title = ITEMS.find((x) => x.id === id)?.label ?? id; // the layer's name as the menu shows it
  const name = d.layer('all');
  const i = xml.indexOf(`<Name>${name}</Name>`);
  const times = (/name="time"[^>]*>([^<]*)/.exec(xml.slice(i, xml.indexOf('</Layer>', i))) || [])[1] || '';
  const newest = times.match(/\d{4}-\d{2}/g)?.sort().at(-1);
  const listed = [...d.periods].sort().at(-1);
  const offered = id === 'traffic' ? newest?.slice(0, 4) : newest;
  const newer = offered && offered > listed;
  console.log(`${title.padEnd(24)} listed to ${listed.padEnd(8)} WMS offers to ${offered}${newer ? '   ← newer data: update catalog.js' : ''}`);
  if (newer && process.env.GITHUB_ACTIONS) console.log(`::notice title=Newer ${title}::the WMS has ${offered}; catalog.js lists to ${listed}`);
}
