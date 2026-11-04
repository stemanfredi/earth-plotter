# Takeaways

Conclusions reached the hard way, kept so they are not reached twice. Each is
a fact about this project as it stands, with its date; the story behind it is
in the history, not here.

- **GEBCO's grid needs no clean-up before drawing** (2026-10). The filters
  written for a tile-based DEM (filling small pits, blurring tile seams,
  filling dry blocks) all addressed that DEM's defects. Sampled with one
  spline from the same cells, GEBCO tiles join at their edges by construction,
  show no false pits and agree across zooms. The check that proves it runs
  weekly (`npm run tiles-check`).

- **A tile-based DEM is not a source of sea depths** (2026-10). Its
  bathymetry stops at a zoom, its sea is filled with zero in blocks, and its
  land and sea sources meet in false pits and peaks at the coast. Reading a
  bathymetric grid directly, as data, removed all of it.

- **Inland water classified per tile can differ by zoom** (2026-10-26). A
  lake or lagoon is judged from the shore vertices in the first tile that
  asks, within an 8 m margin, so a large liman may be "at sea level" at one
  zoom and "a lake" at another when the page opens there first. Deciding
  from the whole shoreline, read at the zoom where the body fits in one tile,
  makes every zoom agree, but costs ancestor tiles and finer depth chunks
  (up to about 3 MB more on the north Caspian) and is wrong for rivers, whose
  banks are one polygon for a long way. A version that keeps the cost down
  must read heights no finer than the view's and leave rivers per tile.

- **Line offsets belong to the renderer** (2026-10). Drawing lines apart by
  computing new geometry needed a page of heuristics and still met at shared
  ends badly. A signed pixel offset per line, applied by MapLibre as GIS
  tools do, is a number the user sets and nothing to maintain.

- **A new version is told by the service worker, not by a version file**
  (2026-10). A file read at load cannot tell the page's own version from the
  latest (and logs a 404 on every local copy); a new worker waits until the
  page applies it, which is the moment to say so.

- **A double scale bar costs a row** (2026-10). Two stacked bars made the
  bottom of the screen a row taller, and everything above it sat high,
  wrongly on a phone. One bar in the chosen units is enough on screen; the
  picture export keeps both.

- **Survey-grade depths in selected areas were not worth keeping** (October
  2026). Built as "area packs", files of finer depths for one area made by a
  separate tool, and set aside the next day because regular users could not
  obtain the source data. What building them taught, for finer depths later:
  - Measure EMODnet's coverage on the OSM open sea, not on GEBCO's
    coastline, and fill only open-sea gaps from GEBCO.
  - Never take GEBCO's depths in lagoons or lakes: the Venice Lagoon reads
    10 m in GEBCO, about 1 m in EMODnet.
  - OSM's land polygons put lagoons behind barrier islands on land: cut the
    OSM inland water out of the land.
  - Fill empty grid cells from their neighbours before contouring, and trace
    the edge of no data with marching squares, or the edges come out stepped.
- **EMODnet merged with GEBCO was not worth keeping** (November 2026). Its
  DTM 2024 merged with GEBCO 2026 into one store over Europe, on the branch
  `emodnet-depth` (tools/emodnet.mjs). What it taught, for a depth surface
  built later:
  - GEBCO 2026 already holds EMODnet's surveys in Europe, coarser (median
    difference 0.5 m at La Spezia): the gain is resolution, large on rocky,
    island and fjord coasts (Split, Oslofjord, Marseille: GEBCO more than
    3 m off in 21–53 % of surveyed cells under 50 m), small on flat gulfs.
  - Both are from lowest astronomical tide in Europe's surveyed tidal
    waters: GEBCO took EMODnet's values as they are (St Malo: median 0.1 m
    apart where mean sea level stands 6.5 m higher).
  - EMODnet's interpolation flag has three states: 1 interpolated, 0 and no
    flag at all surveyed (most of the Solent, the Gulf of La Spezia). A cell
    flagged 1 is a guess whatever it holds: its 0 m in ports it has no
    soundings of (La Spezia's) turned sea into land.
  - Two grids with two coastlines make seams, each found by looking:
    speckle and checkerboards of surveyed and interpolated cells
    (Tenerife), steps where surveys meet the other grid, GEBCO's coast
    strip drawn as land under OSM's sea (Cinque Terre), squares from
    averaging near steep shores (Tromsø), straight edges at block borders.
  - Resampling GEBCO into a finer store changes it even where nothing else
    does: its water reached further inland and its lines moved. Keep a
    merged store to the surveys and their blending zone, the rest drawn
    from GEBCO's own.
  - Every chunk of a store must exist: a saved offline area cannot hold a
    file that is not there. Land as one value, not its heights, halved the
    store (4.9 GB to 2.8 GB).
