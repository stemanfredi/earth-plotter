# Roadmap

What is not done, and what has been decided about it. The page is the
reference for what it does; what was learned on the way is in
[docs/takeaways.md](docs/takeaways.md).

## Open

- **Inland water decided from its whole shore**, so that a lake or lagoon is
  the same at every zoom (the takeaway says what a version must do: read
  heights no finer than the view's, leave rivers per tile).
- **Smoothing where GEBCO's depths are estimated.** The *Depth sources* layer
  shows where depths are surveyed and where interpolated or predicted.
  Interpolated areas of sparse data can show the pattern of the data's own
  grid; smoothing only there would remove it without touching real detail.
  None seen so far: only if one appears.
- **EMODnet's depths: parked** (2026-11-04) on the branch `emodnet-depth`;
  why, and what a version must do: docs/takeaways.md.
- **The browser tests retried only weekly.** On a push, a failed smoke or
  ui run is run again after a minute, and a pass on the retry is only a
  warning on the run (since 2026-10-31). Provider failures are warnings on a
  push anyway, so the retry mostly covers checks of the page that fail now
  and then. The drawing tests run without the network since 2026-10-31,
  and no fixed waits are left (2026-11-06). Once the warning has stayed
  away for some weeks: retry only on the weekly run, so that such a check blocks a deploy until it is fixed.

## Offline areas

Built 2026-10-30 (Download › Offline areas); what is still open:

- **OpenFreeMap's answer.** Its terms allow offline downloads of at most
  3,000 tiles or 50 MB, with 4 parallel requests and an identifying
  User-Agent, which a browser cannot set; every tile request already carries
  the page's Origin. Asked whether that identifies it (if they read the
  Referer instead, it can be sent as the origin alone, with the privacy text
  changed). If they say no: their weekly planet file (same schema) hosted
  beside GEBCO's depths, and areas cut from it in the page.
- **OpenSeaMap's answer.** No tile policy published; its own offline page
  lists apps that cache its tiles. Asked; meanwhile the seamarks are saved
  two requests at a time, in the browser only: an area's file leaves them
  out.
- **Left out on purpose**: imagery (Esri's terms forbid it; EOX's are
  silent), forecasts and observations, the thematic layers, place search
  (its index cannot run in a page).

## Land and mountains

What walkers and climbers need from a map, against the open data a keyless
page can read (researched 2026-10-24). Coverage is by country: each layer
would say which.

- **Next**
  - Official topographic maps, slope classes and winter routes as overlays,
    by country: swisstopo (maps, slopes over 30° in four classes, ski-touring
    routes, hiking trails; free with attribution) and basemap.at (CC BY 4.0);
    IGN France once the licence of its own layers is read; Kartverket (CC BY
    4.0, zooms 12–20 for display only).
  - A line's ascent, descent and a walking time, from its elevation profile
    (which reads the land's heights too).
  - GPX in and out: routes and tracks read as lines, the drawing's lines
    written as GPX.
- **To research before deciding**
  - Avalanche danger: Euregio's bulletins (CAAML v6 JSON) and EAWS's warning
    regions (GeoJSON), both readable from a page. Licences not read yet, and
    the data is safety-critical: only with the bulletin's date always shown
    and a link to the official one.
  - Trail tiles from OpenStreetMap: grades, trail visibility, via ferrata,
    huts, drinking water and springs, which the base map's tiles leave out. A
    build like the seagrass one, much larger; Overpass cannot serve a public
    map.
  - Print with a grid: a paper map at a set scale, with a coordinate grid.
  - Detailed elevation in Switzerland (swissALTI3D, 0.5 and 2 m,
    cloud-optimised GeoTIFF): its catalogue says "proprietary" where the
    open-data terms say free; to reconcile first. Swiss grid: reprojected in
    the page or in a build.
- **Not planned**: weather forecasts (open only as model files, GRIB or
  NetCDF, which need a build and a server-like pipeline); hut availability and
  current route conditions (no open source); OpenTopoMap (an intermediary).

## Sea: ideas, each with what holds it back

- **Seabed habitats (EUSeaMap 2025, MSFD broad habitat types).** EMODnet
  Seabed Habitats' WMS draws a tile in minutes or not at all and its tile
  cache keeps nothing (2026-10-22), so a live layer would stay blank. The
  data is 2.4 million polygons: built into tiles and published like the
  seagrass, if that build proves worth it, or live if the service speeds up.
- **Detailed world vessel density, by vessel type.** The world layer is the
  World Bank's own tiles: all vessels, coarse. Its data (World Bank and IMF,
  2015–2021, 0.005°, CC BY 4.0, by vessel class) comes as GeoTIFFs only: tiles
  would be built from them and published with the site (zooms 0–7, an
  estimated 150–250 MB). EMODnet's density by ship type and EMSA's route
  density come as GeoTIFFs and OGC services too (CC BY 4.0); Global Fishing
  Watch has fishing effort behind a free token; raw AIS for national waters:
  Marine Cadastre (US), the Danish Maritime Authority.
- **GMTDS world density, monthly to 2024** (NGA, by MapLarge): keyless and
  readable from a page, but its terms conflict (CC BY 4.0 for authorised
  downloads, services by request, site terms forbidding public display).
  Only with written permission.
- **NOAA charts (US waters)** as an overlay; **survey-grade depths in US
  waters (NOAA BlueTopo)**, GeoTIFFs in local UTM projections, which need a
  reader and reprojection in the page.
- **The base map from OpenStreetMap's own vector tiles** instead of
  OpenFreeMap: the same data, another schema (no sea names), limited capacity.
- **Place search from Nominatim** instead of Photon: its usage policy rules
  out search as you type.
- **Tides** (found 2026-11-06, two ways): EOT20 (DGFI-TUM, CC BY 4.0,
  SEANOE 10.17882/79489), the constituents of a global tide model, 66°S–66°N,
  built once into a Zarr store beside GEBCO's, so the page predicts the tide
  for any place and date itself; or Open-Meteo's sea level with tides
  (Copernicus SMOC, from 2022, ten days ahead; keyless, CORS, free for a
  site without ads or subscriptions, CC BY 4.0, under 10,000 calls a day per
  visitor). Both from mean sea level, not chart datum, and weak near the
  coast. NOAA's (US only) refused an automated check.
- **A wind forecast**: the wind layer is a satellite observation, a day late;
  Copernicus Marine has no wind forecast. Open-Meteo's forecast API (ECMWF,
  ICON, GFS; terms as for its tides above) is keyless and CORS, as points,
  not tiles: a forecast for a point or an area, not a layer.
- **Magnetic bearings**: bearings are true; magnetic ones need a declination
  model by place and year (WMM).

## Statistics of an area

Pick a point or an area and a period, and read what the layers say about it
over time: how high the waves are and how often, the calm spells, the
storms, the seasons, against the normal of the place. Researched 2026-11-06.

What makes it possible: each Copernicus dataset has, beside the store the
GIS export reads (`timeChunked`: one time over a wide area), a `geoChunked`
store (decades of a small block of cells), keyless, CORS, in the format
`site/zarr.js` reads. A probe of the Mediterranean wave hindcast
(MEDSEA_MULTIYEAR_WAV_006_012: hourly, 4.2 km, 1985 to three months ago, in
blocks of 4 × 4 cells) read one block's wave height for all 42 years in one
second, 6.6 MB; direction 9 MB more, period 2 MB. The global hindcast
(GLOBAL_MULTIYEAR_WAV_001_032: 3-hourly, 0.2°, from 1980) has blocks of
8 × 4 cells, 1.6° × 0.8°. Cost is by block, not by cell: an area of 50 km in
the Mediterranean is about nine blocks, 60 MB a variable for the whole
record. Stores with the same layout: wind (hourly, from satellites, about
19 years), sea surface temperature (daily, since 1981), the Mediterranean
and global physics (temperature, salinity, mixed layer, currents, sea
level: daily and monthly), altimetry, Mediterranean chlorophyll,
altimeter wave heights (daily, since 2002), the wave forecasts (about five
years of analysis and nine days ahead), and monthly climatologies (the
Mediterranean physics one with standard deviations).

Decided 2026-11-06: statistics as **maps**, layers like the others (the
same menus, colour ranges, legend and time), before any report of its own:
the least new interface. Steps, each usable alone:

1. **Normals: done** (Ocean data › Normals). Copernicus's own maps, as
   tiles: each month's mean wave height (Mediterranean 1993–2016, 4.2 km;
   the world 0.2°), temperature at depth, bottom temperature, salinity,
   mixed layer and currents (Mediterranean 4.2 km, the world 1/12°), drawn
   at the calendar month of the map's time; the 99th percentile of wave
   height averaged over the years (Mediterranean 1993–2019; Iberia, Biscay
   and Ireland 1980–2023), one map with no time. Left out: the mean wave
   period of the climatologies (Tm02, not the peak period the Waves layer
   draws, so its colours would not compare), the Mediterranean's monthly
   standard deviations, the Black Sea's wave power (a 2023 anomaly).
2. **Indicator maps built by the project** (parked 2026-11-06), published beside GEBCO's
   depths and drawn by the page in its own colours, a click giving the
   cell's values: per month, the share of time below 1, 1.5 and 2 m and
   the chance of 12 and 24 hours in a row below them; per year, the
   heights expected once in 10 and 50 years, the mean wave power, the
   trend. A tool reads the hindcasts' series once (the reader and the
   statistics below) and writes them; its download is the cost, of the
   order of 100 GB a region for the wave height, again each year.
3. **Now against normal**: the forecast's wave height as a percentile of
   the place's same month ("a one-in-twenty November day"), from 2.
4. **The water's indicators**: marine heatwave days a year (Hobday's
   definition), the trend of sea temperature, chlorophyll's season.
5. **A report of a drawn area** (what 2 cannot say: a period of one's
   own, a threshold of one's own, the storms with their dates, a wave
   rose), read in the page from the series; its cost said before reading.
6. **What does not change**, for a drawn area: its sea surface, its
   depths by band, how much of them is surveyed (GEBCO's sources),
   seabed substrate, vessel density, zones, cables and wind farms inside.

Built for 2 and 5, not yet used by the page: `site/series.js` reads a
record (catalog.js RECORDS) as series from its `geoChunked` store, its
chunks counted before reading, a few at a time, cancellable, an area
reduced to its mean, its maximum or its mean direction; `site/stats.js`
has the statistics as pure functions (spread, months, share below a
height, calm spells, directions, annual maxima, Gumbel return levels by
L-moments, storms as events, Sen's trend, wave power).

What it must say every time: the model's cell (4.2 km does not see a
harbour; cells by the shore have no value), the product and its period,
the seam where a hindcast gives way to the forecast's analysis, and that
heights beyond twice the record's length are not estimated. Directions are
averaged as angles; hours in a row are not independent, so storms are
counted as events (peaks apart by at least two days).

Also found, for later: Open-Meteo's ERA5 waves from 1940 (0.5°, coarse, the
oldest record); EMODnet Physics' buoys (ERDDAP, CORS, CC BY) to set the
model beside an observation near the area; IBTrACS's cyclone tracks (NOAA,
CSV; licence to read) crossing the area.

## Drawing

- **A drawing as a viewer page**: a standalone HTML file holding the map and
  the elements visible at that moment, with a box to show and hide them and
  no editing, to show a drawing to someone without the app (a link never
  carries a drawing).
- **Counts and lengths as a spreadsheet**: one row per element (kind, name,
  group, properties, length, area) and a sheet of the totals the app already
  shows, by group or by any property; XLSX with the zip writer, or CSV.
- **Clip to sea**: a switch on a point and on an area, for the map only, so
  radii, sectors and areas are drawn only where they cover the sea, cut at the
  coast the map draws; the inspector would show the whole area and its part
  at sea; exports keep the whole shapes. The coast must be fetched for the
  element's box at a zoom fit for its size and unioned from tile pieces, and
  the sea polygon reader lives in the clipping worker: a step's worth of work
  for a display nicety.
