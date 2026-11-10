# Development

For whoever changes the code or hosts a copy. What the page is and why it is
shaped as it is: [the README](../README.md) and [architecture.md](architecture.md).

## Working on it

Requirements: the Node.js version in `.nvmrc`; a local Chrome or Chromium for
the browser tests. The page itself needs no build: `site/` is what is served.

```sh
npm ci              # development dependencies (test tooling only)
npm run serve       # http://127.0.0.1:8000, site/ only, caching off (--host 0.0.0.0 for a phone)
npm test            # unit tests, offline (also that what npm run vendor writes is up to date: tools/deps.mjs)
npm run lint        # ESLint's recommended rules
npm run smoke       # end-to-end in headless Chrome, against the live providers
npm run draw        # the drawing tools in headless Chrome, the network blocked
npm run ui          # layout at phone, tablet and desktop widths: no overlaps, 44 px targets; the network blocked
npm run tiles-check # elevation tiles of known trouble spots: seams, zooms, lakes
npm run perf        # how long the depth layers take to draw
npm run data-check  # newer density data; a layer or Copernicus dataset no longer offered (newer libraries: npm outdated)
npm run vendor      # site/vendor/, the security policy and sw.js's lists written anew
```

The browser tests use `/usr/bin/google-chrome` by default; set
`CHROME=/path/to/chrome` for another binary. They serve the site on port 8099,
which the project's data host allows cross-origin reads from.

The smoke test depends on the network by design, because the page depends on
the providers; how a provider's failure counts is said in `test/browser.mjs`.

What the browser tests share (the site served, Chrome, the checks and the
sections) is in `test/browser.mjs`; each test says what it covers at its top.
Some functions are exported only for the unit tests. The reasons behind a
rule in the code are in a comment next to it, not here.

## Dependencies

MapLibre GL JS, maplibre-contour, GeographicLib and polygon-clipping are the
page's own files in `site/vendor/`, copied from npm at the versions in
`package.json`, with their licences, by `npm run vendor`. No CDN
is involved. polygon-clipping loads only on the first GIS export.

To upgrade one: change its version in `package.json`, run `npm install` and
`npm run vendor` (until then a unit test says `site/vendor/` is
out of date), and test the page.

## The service worker

What `site/sw.js` does is in architecture.md (Offline) and its comments. Its
lists of files and hosts are written by `npm run vendor`, its version by the
deploy; `dev`, on a development copy, is network first, so an edit shows at a
reload.

## Continuous integration and deploy

`.github/workflows/ci.yml` tests, and deploys `main` to GitHub Pages; what it
runs when, and why, is in its comments. Pages must be enabled once in the
repository settings, with *Source: GitHub Actions*.

## Hosting a copy

Any static web server can serve `site/`. What a copy inherits:

- **The providers are not yours.** Map tiles, imagery and ocean data are
  fetched from public services, each under its own terms. Most are open data
  with attribution; one is not: the Sentinel-2 mosaics from 2018 on allow no
  commercial use (a commercial copy keeps the 2016 one). Esri's imagery is
  shown only with a visitor's own ArcGIS key (docs/esri-key.md). Any provider
  may change its service, limit requests or go away, and a copy is bound by
  the same terms as this one. The list is in the page, behind each layer's ⓘ,
  and below (Providers).
- **What a copy cannot promise:** that the providers stay available, or that
  the data is as current as the original. A source that fails is marked in
  the page rather than drawn blank.

Two things are the project's own and need replacing in a copy:

- **The data host.** GEBCO's and EMODnet's depths, the seagrass tiles and the national
  imagery's coverage are read from the host named in `site/hosts.js`; a copy
  changes that one line. What the host must do:
  - serve, over HTTPS, the folders the data builds write, each as it is at the
    host's root: `gebco-2026/`, `emodnet-2024/`, `seagrass-2025/`, `coverage-2026/` (no
    listing, no function, no key; content types are not needed: the page reads
    every file as bytes);
  - answer a file it does not have with 404 (or 403): the page reads that as
    empty (a land-free chunk, a tile without seagrass);
  - allow cross-origin reads from the page's origin, and from
    `http://127.0.0.1:8099` for the browser tests;
  - not keep `coverage-2026/` cached for long, here or in browsers: it is
    replaced when rebuilt, and an old copy draws the old coverage. After a
    rebuild, clear any cached copies. `gebco-2026/`, `emodnet-2024/` and
    `seagrass-2025/` never change: a new release is a new folder, which the page is changed to read.
- **The data builds.** Each tool says how to run it at its top, and writes one
  folder (above) to copy to the host:
  - `tools/gebco.mjs`: GEBCO's grids, downloaded (about 11 GB) and built into
    two Zarr stores (3.9 GB), then verified against the grids;
  - `tools/emodnet.mjs`: EMODnet's depth model, downloaded (7.3 GB) and built
    into two Zarr stores (2.9 GB), GEBCO's stores beside it;
  - `tools/seagrass.mjs`: EMODnet's seagrass product, downloaded and cut into
    tiles (needs `unzip`);
  - `tools/coverage.mjs`: OpenStreetMap's national boundaries, cut into the
    masks the national imagery is clipped with, and the tiles with sea in
    them, where a service's white is cleared (needs about 4 GB of memory).
- **The preview.** `tools/preview.mjs` takes `site/preview.jpg` again (the
  README's picture and shared links'), after a change to what the page shows.

A copy that adds a host adds it to `site/hosts.js` and runs `npm run vendor`
(the security policy and the preloads are written from it: architecture.md,
Every host in one place).

## Providers

The map data and imagery are not part of this repository. The browser fetches
them from each provider, and each layer stays under its provider's licence.
The page is the reference for coverage, resolution and periods (each layer's
ⓘ); they are defined in `site/catalog.js`, as are the credits, so this table
is a summary only.

| Layer | Provider | Licence |
|---|---|---|
| Chart base, coastline, roads, buildings, names, boundaries | OpenStreetMap via OpenFreeMap (OpenMapTiles schema) | ODbL |
| Satellite | EOX Sentinel-2 cloudless (EOxCloudless), one mosaic a year: 2025 to 2018, and 2016 (2017 covers only Europe) | CC BY 4.0 (2016); CC BY-NC-SA 4.0 from 2018 (non-commercial) |
| Satellite, with the visitor's own key | Esri World Imagery, keyed (docs/esri-key.md) | Esri's terms, under the visitor's own ArcGIS account |
| National aerial photos (over Satellite, from zoom 12, inside each country) | National aerial imagery: IGN BD ORTHO (France and its overseas departments), swisstopo SWISSIMAGE (Switzerland), Beeldmateriaal Nederland via PDOK (the Netherlands), AGEA 2022–2024 (Italy); each cut to its country with masks built from OpenStreetMap's boundaries, on the project's data host | Licence Ouverte 2.0; swisstopo's free use with attribution; CC BY 4.0; CC BY 4.0. The masks: ODbL |
| Depth shading, isobaths, depth on click | GEBCO 2026 Grid (GEBCO Compilation Group); in European seas EMODnet Bathymetry's DTM 2024. Repacked as Zarr stores on the project's data host (the GIS export's EMODnet values from EMODnet's own Zarr store, listed in EDITO's catalogue) | GEBCO: free to use and redistribute, with attribution; EMODnet: CC BY 4.0 |
| Depth sources | GEBCO 2026 type identifier grid; in European seas EMODnet's flag of interpolated cells, likewise | As above |
| Relief shading, land contours | AWS Terrain Tiles (Terrarium) | Open data, with attribution per source |
| Seamarks | OpenSeaMap | CC BY-SA 2.0 |
| Seabed substrate (Europe) | EMODnet Geology | CC BY 4.0 |
| Seagrass (Europe) | EMODnet Seabed Habitats, seagrass cover 2025, cut into tiles on the project's data host; its Caribbean part (CC BY-NC) left out | CC BY 4.0 |
| Maritime zones | Marine Regions (Flanders Marine Institute, VLIZ) | CC BY 4.0; not for legal or navigational use |
| Wrecks, cables, pipelines, offshore installations, wind farms, military and protected areas | EMODnet Human Activities (wrecks: UKHO) | CC BY 4.0 |
| Vessel density (Europe) | EMODnet Human Activities | EMODnet open data, attribution requested |
| Vessel density (world) | World Bank Group and IMF, Global Shipping Traffic Density | CC BY 4.0 |
| Route density (Europe) | EMSA, via EMODnet Human Activities | CC BY 4.0 |
| Sea state, water properties, satellite observations, water quality, normals | Copernicus Marine Service | Copernicus Marine licence: free, attribution required |
| NASA daily (true colour) | NASA EOSDIS GIBS | NASA open data |
| Place search | Photon (komoot), OpenStreetMap data | ODbL |

Vessel and route density cover European and neighbouring seas only. The
density periods offered in the menu are listed in `site/catalog.js`; when
`npm run data-check` reports newer data, extend the list there.
