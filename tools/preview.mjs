#!/usr/bin/env node
// The page's preview, site/preview.jpg (the README's picture and shared links' og:image, 1200 × 630):
// the page as a first visit sees it, the left panel on Draw, Properties closed, the view given.
// Headless Chrome as the browser tests use it (CHROME=…; served on 8099, which the data host allows,
// for the depth shading):
//   node tools/preview.mjs [zoom/lat/lon/bearing]     default: the Bay of Naples
import { chromium } from 'playwright-core';
import { serve, chromeOptions } from '../test/serve.mjs';
import { openPage } from '../test/browser.mjs';

const view = process.argv[2] ?? '9.6/40.68/14.09/0';
const server = await serve(), browser = await chromium.launch(chromeOptions());
try {
  const page = await openPage(await browser.newContext({ viewport: { width: 1200, height: 630 } }), `${server.url}#v=${view}`, 'draw'); // Properties: closed, as on a first visit
  if (page.errors.length) throw new Error(`the page: ${page.errors.join('; ')}`);
  await page.mouse.move(700, 20); // on the bar: no hover on the map, no position shown at its foot
  await page.screenshot({ path: new URL('../site/preview.jpg', import.meta.url).pathname, type: 'jpeg', quality: 85 });
} finally {
  await browser.close();
  server.close();
}
