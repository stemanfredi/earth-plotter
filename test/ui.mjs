#!/usr/bin/env node
// Layout check: at phone, tablet and desktop width, with Layers closed and open and the drawing's views,
//  - no two overlays overlap, except under the bar or a panel (which must then be on top);
//  - nothing on screen leaves the viewport;
//  - every visible control is a ≥ 44 × 44 px target (labels count for their checkbox).
//   CHROME=/path/to/chrome npm run ui        Screenshots go to $UI_SHOTS if set.
import { readFileSync } from 'node:fs';
import { start, frames, until, openPage, addDistance } from './browser.mjs';

// phone and tablet are touch devices (pointer: coarse, 44 px targets); desktop has a mouse (36 px; 24
// in the panels, 28 (32 drawn) in the bar, 32 in the map's controls and the search bar)
const VIEWPORTS = [['phone', 390, 844, true], ['tablet', 820, 1180, true], ['desktop', 1280, 800, false]];
// overlays that must not collide (screen-space boxes of floating UI)
const OVERLAYS = {
  search: '#search', controls: '#mapctl', legend: '#legends', touch: '.touchbar', note: '.dnote', status: '#status', bar: '#bar', dock: '#dock', side: '#side', props: '#props',
};

// a drawing as the app saves it (GeoJSON, version 1): a point holding two sectors, one holding a rectangle, a line
// from and back to the point, a label along the line
const DRAWING = JSON.stringify({ type: 'FeatureCollection', earthplotter: { format: 'earthplotter-drawing', version: 1,
  links: [{ from: ['g1', 0], to: 'n1' }, { from: ['g1', 3], to: 'n1' }, { from: ['l1', 0], to: { element: 'g1', edge: 0, at: 0.4 } }] }, features: [
  { type: 'Feature', id: 'n1', geometry: { type: 'Point', coordinates: [14, 44.5] }, properties: { name: 'Point 1', key: 'value',
    earthplotter: { kind: 'point', bearing: 45 } } },
  { type: 'Feature', id: 's1', geometry: { type: 'Point', coordinates: [13, 44] }, properties: { name: 'Rectangle 1', earthplotter: { kind: 'point' } } },
  { type: 'Feature', id: 'c1', geometry: { type: 'Point', coordinates: [14, 44.5] }, properties: { name: 'Sector 1', earthplotter: { kind: 'circle', group: 'n1', radius: 20000, aperture: 90, bearing: 45 } } },
  { type: 'Feature', id: 'c2', geometry: { type: 'Point', coordinates: [14, 44.5] }, properties: { name: 'Sector 2', 'fill-opacity': 0, earthplotter: { kind: 'circle', group: 'n1', radius: 40000, aperture: 90, bearing: 45 } } },
  { type: 'Feature', id: 'r1', geometry: { type: 'Polygon', coordinates: [[[12.9, 43.95], [13.1, 43.95], [13.1, 44.05], [12.9, 44.05], [12.9, 43.95]]] }, properties: { name: 'Rectangle 1', earthplotter: { kind: 'line', group: 's1' } } },
  { type: 'Feature', id: 'g1', geometry: { type: 'LineString', coordinates: [[14, 44.5], [14.5, 44.2], [14.2, 43.9], [14, 44.5]] }, properties: { name: 'Line 1',
    earthplotter: { kind: 'line', names: ['', 'a point', '', ''] } } },
  { type: 'Feature', id: 'l1', geometry: { type: 'Point', coordinates: [14.2, 44.4] }, properties: { name: 'Label 1',
    earthplotter: { kind: 'label', text: '{name}\n{along}', look: { text: { background: 'box' } } } } }] });
// put where the app keeps its drawings (draw/saving.js): the list, the one open, its text
const SEED = (d) => { localStorage.setItem('earthplotter.drawings', JSON.stringify([{ id: 'ui', title: '', modified: '2026-10-24T00:00:00Z', size: d.length }])); localStorage.setItem('earthplotter.drawings.current', 'ui'); localStorage.setItem('earthplotter.drawing.ui', d); };

// Without the network, as draw.mjs: what is checked is the page's layout, not a provider's day (the
// map's tiles and glyphs fail; the layout does not depend on them). Two of the legends are drawn from
// what Copernicus says of its colours: its answers for the two layers on, as fixtures (test/fixtures)
const LEGENDS = { VHM0: 'legend-VHM0.json', sea_water_velocity: 'legend-sea_water_velocity.json' };
const offline = async (opts) => {
  const c = await browser.newContext({ serviceWorkers: 'block', ...opts });
  await c.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => {
    const layer = /[?&]REQUEST=GetLegend&/.test(r.request().url()) && new URL(r.request().url()).searchParams.get('LAYER')?.split('/').at(-1);
    if (!LEGENDS[layer]) return r.abort();
    return r.fulfill({ contentType: 'application/json', body: readFileSync(new URL(`./fixtures/${LEGENDS[layer]}`, import.meta.url)) });
  });
  return c;
};

const { browser, base, check, section, finish } = await start();

for (const [name, width, height, touch] of VIEWPORTS) {
  // 'map': the left panel not on Layers (Elements, where a computer opens on Layers); 'layers': on
  // Layers; then the Elements tab four times: the drawing's inspector, a node's, a line's, a label's
  for (const view of ['map', 'layers', 'drawing', 'draw', 'line', 'label']) {
    await section(`${name} ${width}px, ${view}`, async () => {
      const ctx = await offline({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
      // the Elements tab with a drawing: a point with two sectors (its inspector shown) and a shape
      const inspect = !['map', 'layers'].includes(view);
      if (inspect) await ctx.addInitScript(SEED, DRAWING);
      // a zoomed-out view (scale note shown), four stacked legends (they once ran over the
      // credits), a measurement; the Layers groups open (on a phone the panel starts closed)
      const page = await openPage(ctx, `${base}#v=5/45/14/0&col=waves:height&arr=currents:surface&on=chart,coastline,depth,isobaths,traffic,legend`,
        view === 'layers' ? 'layers' : 'elements', ['base', 'sea', 'data']);
      if (view === 'layers' && await page.locator('#bar .ptab[data-tab=layers]').getAttribute('aria-pressed') !== 'true') await page.click('#bar .ptab[data-tab=layers]');
      await addDistance(page, [12, 44], [13, 44.5]);
      // the left panel (on a phone closed to start with): open on Elements; an element (or the drawing)
      // selected, its properties shown (on a phone in place of the tree)
      if (inspect && await page.locator('#bar .ptab[data-tab=elements]').getAttribute('aria-pressed') !== 'true') await page.click('#bar .ptab[data-tab=elements]');
      if (view === 'drawing') await page.click('.droot .dname');
      if (view === 'draw') await page.click('.dlist .drow .dname');
      if (view === 'line') await page.click('.dlist .drow:has(.kind[title=Line]) .dname');
      if (view === 'label') await page.click('.dlist .drow:has(.kind[title=Label]) .dname');
      if (inspect && await page.locator('#props').isHidden()) await page.keyboard.press('i');
      // the inspector's text: no element printed as text ("[object …]")
      if (inspect) check(!(await page.evaluate(() => document.querySelector('.dinspect').textContent.includes('[object'))), `${name}: the ${view} inspector shows no "[object …]"`);
      await page.mouse.move(width / 2, height / 2); // shows the cursor readout
      // (only with the map under the pointer: on a phone a panel may cover it)
      await until(page, ([x, y]) => !document.elementFromPoint(x, y)?.closest('.maplibregl-canvas') || document.querySelector('#pos')?.textContent, [width / 2, height / 2]);
      await frames(page); // laid out as shown (the legends are there from the map's load; its tiles do not matter here)
      if (process.env.UI_SHOTS) await page.screenshot({ path: `${process.env.UI_SHOTS}/${name}-${view}.png` });
      const r = await page.evaluate(({ OVERLAYS }) => {
        // with a mouse 36 px, but 24 in the panels (grids of rows), 28 (32 drawn) in the bar, 32 in the map's controls
        const COARSE = matchMedia('(pointer: coarse)').matches, MIN = COARSE ? 44 : 36, minOf = (el) => (COARSE ? MIN : el.closest('#side, #props') ? 24 : el.closest('#bar') ? 28 : el.closest('#mapctl, #search') ? 32 : MIN);
        const seen = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(el).visibility !== 'hidden' && el.closest('[hidden]') === null; };
        const boxes = {};
        for (const [k, sel] of Object.entries(OVERLAYS)) {
          const el = document.querySelector(sel);
          if (el && seen(el)) boxes[k] = el.getBoundingClientRect().toJSON();
        }
        const overlaps = [], offscreen = [];
        const keys = Object.keys(boxes);
        for (let i = 0; i < keys.length; i++) {
          const a = boxes[keys[i]];
          if (a.left < 0 || a.top < 0 || a.right > innerWidth + 0.5 || a.bottom > innerHeight + 0.5) offscreen.push(keys[i]);
          for (let j = i + 1; j < keys.length; j++) {
            const b = boxes[keys[j]];
            const x = Math.min(a.right, b.right) - Math.max(a.left, b.left), y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (x <= 0.5 || y <= 0.5) continue;
            const pair = [keys[i], keys[j]];
            if (pair.some((k) => ['bar', 'side', 'props', 'note'].includes(k))) { // allowed only if the bar, the panel or the note (centred on the window, a few seconds) is the one on top
              const cx = Math.max(a.left, b.left) + x / 2, cy = Math.max(a.top, b.top) + y / 2;
              if (document.elementFromPoint(cx, cy)?.closest('#bar, #side, #props, .dnote')) continue;
            }
            overlaps.push(`${pair.join(' × ')} ${Math.round(x)}×${Math.round(y)}`);
          }
        }
        // targets: controls, except checkboxes/radios whose label is the target
        const small = [];
        for (const el of document.querySelectorAll('button, select, summary, input, label, [role=button]:not(#scale)')) {
          if (!seen(el) || el.closest('#menu details:not([open]) > ul')) continue;
          if (!COARSE && el.closest('.status')) continue; // the bottom row's chips: text-sized with a mouse, as its links; a finger's 44 px (style.css)
          if (el.matches('input[type=checkbox], input[type=radio]') && (el.closest('label') || (el.id && document.querySelector(`label[for="${el.id}"]`)))) continue;
          if (el.matches('label') && !el.querySelector('input') && !el.htmlFor) continue; // plain text labels
          const b = el.getBoundingClientRect();
          if (b.width < minOf(el) - 0.5 || b.height < minOf(el) - 0.5) {
            small.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} ${Math.round(b.width)}×${Math.round(b.height)}`);
          }
        }
        return { overlaps, offscreen, small: [...new Set(small)], MIN };
      }, { OVERLAYS });
      const where = `${name} ${width}px, ${inspect ? `Elements, ${{ drawing: 'the drawing', draw: 'a node', line: 'a line', label: 'a label' }[view]}` : view === 'layers' ? 'Layers open' : 'not on Layers'}`;
      check(!r.overlaps.length, `${where}: no overlapping overlays ${r.overlaps.join(', ')}`);
      check(!r.offscreen.length, `${where}: nothing off screen ${r.offscreen.join(', ')}`);
      check(!r.small.length, `${where}: targets ≥ ${r.MIN} px ${r.small.join(', ')}`);
      check(!page.errors.length, `${where}: no page errors ${page.errors.join(' | ')}`);
      await ctx.close();
    });
  }
}
await finish();
