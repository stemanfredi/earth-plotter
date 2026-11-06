# Drawing file format

Version 1. The contract for anything that reads or writes a drawing: the app's Download, a GIS, a
file made by hand or by a script. Code: `site/draw/file.js` (reading, writing), `document.js` (the
model), `check.js` (the checks). How the app behaves is in `drawing-ui.md`.

## The model

Five rules every part of the drawing keeps; a change that breaks one changes the model, not a detail.

1. **What is stored is real geography.** Positions on WGS 84; lengths, bearings and areas on the
   ellipsoid; the file plain GeoJSON. How an element is drawn (its look: colours, Offset, Scale)
   never changes where it is, what it measures or what is exported.
2. **Lines meet at points.** Where lines join, a point is shared: a vertex of each is attached to it,
   as ways share nodes in OpenStreetMap. Any number of lines meet at one point.
3. **A point can hold rigid shapes.** Circles, sectors and outlines placed as one piece with their
   point, kept in its frame and moved and turned with it, as a block in CAD.
4. **A line attaches only to what moves by itself:** a point, or a corner or an edge of a point's
   shape. A label may point at anything. Nothing attaches through a line to a line, so every
   attached vertex is settled in one pass.
5. **Rules make plain elements.** Distribute along and Connect make ordinary points and lines and
   keep their settings, to be edited again or updated; they follow nothing by themselves.

**Words.** An **element** is a point, circle, line, label or group. A **shape** is a circle or a
closed line a point holds; an **area** is a closed line drawn on its own. A line's corners are its
**vertices**; a **leg** joins two. A vertex is **attached** to what it follows; the file keeps each
attachment as a **link** (§7.6).

## 1. The file

- A **GeoJSON FeatureCollection** (RFC 7946), UTF-8, `.geojson` (`.json` is read too). Any GIS reads
  it as it is; the app reads any GeoJSON (§10).
- Each element is a Feature with its real geometry. Its name and the user's properties are plain
  properties, its own colours the common style names. Everything else of the app's is under one
  property, **`earthplotter`**; the drawing's own (version, times, view, look, groups, rules, links) is a
  foreign member `earthplotter` of the collection.
- The writer leaves out every value equal to its default (§13). The reader is forgiving: what is
  missing takes its default, what is wrong is repaired or skipped, and the report says so (§10).

## 2. Conventions

| What | How |
|---|---|
| Position | `[longitude, latitude]`, WGS 84 degrees; −180 ≤ lon ≤ 180, \|lat\| ≤ 90 (the map shows to ±85.05°; what lies beyond is kept, unseen). A third value is dropped. |
| Distance | metres |
| Angle | degrees clockwise from **true** north, 0 ≤ a < 360 (read: any finite value, normalised with a warning) |
| Colour | `"#rrggbb"`, read in either case, written in lower case; opacity apart, 0–1 |
| Stroke width | screen pixels, 0.5–20 |
| Text | any string, kept verbatim |
| Time | ISO 8601, UTC, whole seconds: `"2026-10-22T09:30:00Z"` |
| ID | 1–64 characters of `A–Z a–z 0–9 _ -`, unique across elements, groups and rules; a number is read as text. The app makes random 8-character IDs and keeps any others. |

**Order matters:** the order of the features is the panel's and the drawing order within a kind (the
first on top); between kinds the stacking is fixed (drawing-ui.md §7). The writer writes points, then
circles, lines and labels.

## 3. The collection

```json
{ "type": "FeatureCollection",
  "earthplotter": { "format": "earthplotter-drawing", "version": 1, "created": "2026-10-22T09:30:00Z", "modified": "2026-10-22T10:02:11Z",
    "meta": { "title": "", "description": "", "author": "" }, "view": { … }, "look": { "text": { "name": true }, "offset": 3 },
    "groups": [], "rules": [], "links": [] },
  "features": [] }
```

| Field | Notes |
|---|---|
| `format` | `"earthplotter-drawing"`; written, not checked |
| `version` | `1`; missing: this version; anything else refuses the file |
| `created`, `modified` | missing or not a time: the time of import |
| `meta` | `title`, `description`, `author`: free text |
| `view` | §4; missing: the map's view and layers stay as they are |
| `look` | the drawing's look (§6): `text.name`, `offset`, `scale` only |
| `groups`, `rules`, `links` | §7.1, §8, §7.6 |

Without `earthplotter` the file is plain GeoJSON, read as such.

## 4. View

```json
"view": { "center": [12.5, 41.9], "zoom": 7.25, "bearing": 0,
  "layers": [ { "id": "…", "variant": "…", "period": "…", "opacity": 0.8 } ],
  "data": { "colour": { "id": "…", "variant": "…" }, "arrows": null, "time": "2026-10-22T09:00:00Z", "depth": 0 },
  "units": "km", "bearings": false }
```

| Field | Notes |
|---|---|
| `center`, `zoom`, `bearing` | the map's view; `zoom` 0–24; `bearing` its rotation |
| `layers` | the layers shown, by the app's ID; `variant`, `period`, `opacity` only where they differ from the layer's default |
| `data` | the data layers chosen (colours, arrows: `{ id, variant }` or `null`), the hour and the depth (m), each only while a layer shown uses it. The app always writes it (`{}`: none), so opening the file clears the map's; missing, they stay. |
| `units` | `"km"` or `"nm"` |
| `bearings` | each leg's bearing shown with its length |

An unknown layer, variant, period, data entry or depth is skipped with a warning.

## 5. Every feature

```json
{ "type": "Feature", "id": "l1",
  "geometry": { "type": "LineString", "coordinates": [[12.4, 41.9], [12.5, 41.88]] },
  "properties": { "name": "Line 1", "ref": "7", "stroke": "#1f77b4", "stroke-width": 3,
    "earthplotter": { "kind": "line", "group": "g1", "look": { "stroke": { "dash": "dashed" } } } } }
```

**Plain properties** (what a GIS shows as columns):

| Property | Notes |
|---|---|
| `name` | free text (not on a label: its text names it) |
| the user's properties | one column each, in order, as text. A key equal to a name in this table or `earthplotter` is written `p_<key>`, a repeated one `<key>_2`… |
| `stroke`, `stroke-width`, `stroke-opacity`, `fill`, `fill-opacity` | the element's **own** style only (§6) |

**`earthplotter`**, the app's own:

| Field | Notes |
|---|---|
| `kind` | `"point"`, `"circle"`, `"line"`, `"label"`; always written. On reading only `circle` and `label` matter (a `Point` geometry then is one); else the geometry decides. |
| `group` | what holds it, at most one: a group; a shape's, the point that holds it (§7.2) |
| `frame` | a point's shape's: where it is about its point (§7.2) |
| `visible` | `false`: hidden (not drawn, not in GIS data; in the file). A hidden group hides its members, a hidden point its shapes. |
| `guide` | supporting geometry: faint, dashed, left out of totals (not on labels) |
| `measure` | `true`: a **measurement** (what Measure makes): a guide of its own colour (`guide` read as `true` too), its name not drawn |
| `look` | the rest of its own look (§6): the stroke's `dash`, `text`, `offset`, `scale` |
| `properties` | the user's properties as `[{ "key", "value" }]`, written only when a key had to be renamed as a column; read instead of the columns |

## 6. The look

```json
{ "fill": { "color": "#e8590c", "opacity": 0.15 },
  "stroke": { "color": "#e8590c", "opacity": 1, "width": 1.5, "dash": "solid" },
  "text": { "name": false, "values": false, "size": 13, "color": "#1f2c36", "background": "halo" },
  "offset": 0, "scale": 1 }
```

| Field | Notes |
|---|---|
| `fill`, `stroke` | colour, opacity; width 0.5–20 px; dash `solid`, `dashed`, `dotted`. A line's fill only while closed; opacity 0: no fill. A point has only a stroke colour and opacity: its symbol's. |
| `text.name` | its name on the map (a group's: everything in it) |
| `text.values` | its values on the map: a line's legs, a closed line's area and perimeter, a circle's radius |
| `text.size`, `.color`, `.background` | a label's: 8–48 px; a colour; `halo` or `box` |
| `offset` | a line drawn this many pixels to the right of its direction (negative: left), −50 to 50; display only |
| `scale` | a point's shape drawn this many times its size about its point, 0.1–100; display only (its geometry, values, totals, export and attachments stay real). A shape no point holds is never scaled. |

**The cascade:** each field an element leaves out comes from its role (a guide's: grey, faint,
dashed; a measurement's: magenta, dashed, no name), else the drawing's `earthplotter.look`, else the
defaults (§13). An element writes only what it sets itself: its colours, opacities and width as the
common style names, the rest in `earthplotter.look`. A group has no look; `visible` is not part of it: an
element is drawn only if every group it is in is shown.

## 7. Elements

### 7.1 Group

Listed in the collection's `earthplotter.groups`, not as features:

```json
{ "id": "g2", "groupId": "g1", "name": "Group 2", "properties": [], "visible": true }
```

`groupId` is the group it is in (absent: at the top). A group is only who is in it: joining or
leaving changes nothing of an element. A group without a valid, unused ID is skipped; a member naming
a group that is not there becomes standalone, and a group inside itself goes to the top (warnings).

### 7.2 Point

A `Point` geometry: `"earthplotter": { "kind": "point", "bearing": 45, "symbol": "diamond" }`.

| Field | Notes |
|---|---|
| `bearing` | turning it turns the shapes it holds |
| `symbol` | `diamond`, `square`, `triangle`, `dot`, `none` (the default; a feature without `earthplotter`: `diamond`); a fixed screen size, never turned |
| properties | one placed from a Library item keeps its properties, and `library` names the item |

**Its shapes.** A circle or a closed line whose `group` is a point's ID is **held** by it: listed
under it, hidden, deleted and copied with it; in the point's group through it. A point holds nothing
else (a file saying so, an open line included: the element standalone, warning). The Shape tool's kinds are a point and its
shapes: a circle, rings (several), a sector, or an outline (a closed line, `site/draw/outlines.js`).
A shape is rigid: its form changes by its own fields and handles, not vertex by vertex.

**Its frame.** A shape is kept in its point's frame:

```json
"frame": { "places": [[20.5545352, 213.6011], [159.4443607, 213.5993]], "turn": 0 }
```

| Field | Notes |
|---|---|
| `places` | one `[a, d]` per vertex in its own order (a circle: its centre): `d` metres from the point, `a` degrees from its bearing (−180 to 180) |
| `turn` | a circle's bearing, this many degrees from the point's |

Its positions are worked out from its frame, so it goes with its point exactly. The file writes both,
the geometry for other tools and the frame, about the point as the file writes it (7 decimals; its
bearing 4); degrees to 7 decimals, metres to 4. On reading **the frame wins**: a position more than
10⁻⁶° from where it puts it goes there, counted ("the file was edited elsewhere"). A shape without a
valid frame gets one from where it is.

### 7.3 Line

A `LineString`: its vertices in order, the first its start. A **closed** line (an area) is a
`Polygon`: one ring, its first vertex repeated at its end, at least three vertices, one more leg from
its last back to its first. Holes are not read.

```json
"earthplotter": { "kind": "line", "smooth": true, "names": ["", "bend 1", ""] }
```

| Field | Notes |
|---|---|
| `smooth` | a smooth curve through its vertices; else straight legs |
| `names` | one name per vertex, in its own order, written when one is named |
| `reversed` | a closed line's: its ring written reversed (below) |

**Legs.** Straight legs are **geodesics**. A smooth line's (three vertices or more) are cubic Béziers
in Web Mercator, Catmull-Rom handles (`site/draw/lines.js`); the curve is the line itself: its length,
area and export are the curve's, summed over close samples. Lengths and areas are never stored.

A closed ring is written **counter-clockwise** (RFC 7946). One kept clockwise is written reversed
with `"reversed": true`, and read back in its own order, so that its vertices keep their numbers
(§7.6) and its `names` their order.

### 7.4 Circle

A `Point` geometry at its centre: `"earthplotter": { "kind": "circle", "radius": 5000, "aperture": 90, "bearing": 45 }`.

| Field | Notes |
|---|---|
| `radius` | metres, above 0 and below 10 000 km; always written; without one the circle is skipped |
| `aperture` | a sector this wide (above 0, below 360) centred on `bearing`; missing or 360 and more: a whole circle |
| `bearing` | a sector's middle; a whole circle's start (where Distribute along begins) |

One reaching a pole is not drawn.

### 7.5 Label

A `Point` geometry where it points:

```json
"earthplotter": { "kind": "label", "text": "{name}\n{along}", "offset": [40, -40], "leader": "arrow",
  "look": { "text": { "size": 16, "background": "box" } } }
```

| Field | Notes |
|---|---|
| what it points at | its link (§7.6); none: free, at its position |
| `text` | free text, `\n` a new line; `{name}`, `{length}`, `{along}`, `{bearing}`, `{radius}`, `{area}`, `{perimeter}` filled in as drawn, in the display units (empty where they do not apply) |
| `offset` | the text's centre in pixels from where it points (x right, y down; ±2000) |
| `leader` | `arrow` (a line to where it points) or `none` |

A label has no name, no style names and no `guide`.

### 7.6 Links

What a vertex of a line, or a label, is attached to: one list, `earthplotter.links`.

```json
"links": [ { "from": ["l1", 0], "to": { "element": "a" } },
  { "from": ["l1", 1], "to": { "element": "sh", "edge": 2, "at": 0.5 } },
  { "from": ["t1", 0], "to": { "element": "l1", "vertex": 1 } } ]
```

`from` is `[ID, index]`: a line's vertex (any, 0 its start) or a label's `0`; one link a vertex.
`to`, a target (a bare ID is read as `{ "element" }`; indices from 0):

| `to` | | From |
|---|---|---|
| `{ "element" }` | a point's position; a circle's centre; a closed line's centre (the mean of its vertices); an open line's middle | a line's vertex: a point only. A label: any. |
| `{ "element", "vertex" }` | a line's vertex | a line's vertex: a point's shape only. A label: any line. |
| `{ "element", "edge", "at" }` | along edge k (vertex k to the next, as drawn), a fraction `at` (0–1; missing 0), turning and stretching with it | as `vertex` |

Where lines meet they meet at a point: a vertex of each attached to it. A vertex of a point's shape
is never linked; a group, a label or a guide is never a line's target. The rule is kept after every
change too: a link it no longer allows (a line given to a point, a shape detached and now an area)
goes, its vertex free where it is. A closed line's vertices count in its own order;
the rectangle's are its front right, back right, back left, front left; a triangle's its apex, back
right, back left.

Every vertex keeps its position in the geometry, so other tools see it there; on reading **the link
wins** (lines' vertices first, then labels), counted when more than 10⁻⁶° off. Dropped, with a
warning: a link from what is not a line's vertex or a label (a shape's included), to what is not
there or has no such vertex or edge, to its own element, from a vertex already linked, or from a
line's vertex to a target it may not have. Vertices added to or taken from a line: links from it
are numbered again (one from a vertex taken goes), links to it move to the nearest vertex or edge. A
line split at a vertex carries its second half's links, both halves attached to the point made
there; a closed line split there is opened instead, its links numbered from its new start.

## 8. Rules

`earthplotter.rules`: what Distribute along and Connect keep to be edited again or updated; they follow
nothing by themselves (drawing-ui.md §6). A `kind` other than `distribute` or `connect`, or no valid
unused `id`: skipped. An ID of an element deleted since is not an error: it is dropped at the next
change. A rule whose line or circle, copies, points or roots are all gone is dropped; what it made
stays.

### 8.1 Distribute along

```json
{ "id": "ar1", "kind": "distribute", "groupId": "g5", "copiesId": "g6", "along": { "element": "l9" },
  "count": 3, "startMargin": 500, "endMargin": 500, "offset": 200, "side": "alternate", "radius": 300, "aperture": 120,
  "pointIds": ["p20", "p21", "p22"] }
```

| Field | Notes |
|---|---|
| `along` | required: the line (a closed one round its ring from its first vertex) or the circle (clockwise: its whole round from its bearing, a sector's arc) |
| `groupId`, `copiesId` | its own group ("Distribute along …") and the copies' ("Copies") in it |
| `spacing` or `count` | a copy every so many metres from the start margin, or so many evenly between the margins (round a whole circle: no margins) |
| `startMargin`, `endMargin`, `offset` | metres |
| `side` | `left`, `right`, `alternate`, facing along it (round a circle, left is outwards) |
| `item` | each copy: `circle` (default: a circle of `radius`, a sector of `aperture`), another built-in kind scaled to `radius`, or `library:<name>` (a Library item, its own size) |
| `radius`, `aperture` | metres (default 500); degrees (none: circles) |
| `pointIds` | its copies, in order along it: plain points holding their shapes, facing away |

### 8.2 Connect

```json
{ "id": "c1", "kind": "connect", "groupId": "g7", "pattern": "tree", "groupSize": "auto", "minBranch": 200,
  "roots": [ { "id": "o1", "weight": 2 } ], "pointIds": ["p20", "p21", "p22"], "created": ["h1", "l40", "l41"] }
```

| Field | Notes |
|---|---|
| `groupId` | its group ("Connection") |
| `pattern` | `tree` (root → hub → each point) or `chain` (root → the nearer end point → the next); else `tree` |
| `groupSize` | points at most per tree or chain (a tree's at most 32), or `auto` |
| `minBranch` | a tree's hub at least this many metres from its points and root |
| `roots` | `[{ "id", "weight" }]`, weight above 0 (1 not written) |
| `pointIds` | the points, in the order they are cut into groups |
| `created` | its hubs and lines: what Connect again replaces |

The plan cuts the points, in order, into groups of consecutive points, each joined to one root, the
cut and the roots chosen together as the cheapest (each group's length divided by its root's weight;
a tie: the cut whose largest group is smallest). Each tree has a hub of its own (a dot) at the geometric median of its
points and root. Its lines are plain lines attached to the points they join; what each is (trunk,
branch, root link, link) follows from what its ends are attached to.

## 9. Writing

- Defaults left out (§13), an object when nothing in it differs.
- Rounding: positions 7 decimals (about 1 cm); metres 3; angles 4; the view's zoom 2, its bearing 1;
  opacities and widths 3; an edge's `at` 6 (left out when 0); a frame as §7.2. The reader takes any
  precision.
- Indented JSON, each position on one line. A drawing read back is the same drawing
  (`test/unit/draw-document.test.mjs`).

## 10. Reading

Any GeoJSON: a FeatureCollection, a Feature or a bare geometry.

- `Point` → a point (a circle, a label by `earthplotter.kind`), `LineString` → a line, `Polygon` → a
  closed line; each part of a Multi geometry an element of its own (the first keeps the ID).
- **Foreign features** (no `earthplotter`): a point is a `diamond`; the name from `name`, `Name` or `title`
  (the app's own: `name` only); the style from the common names; every other property a user's, as
  text (objects as JSON).
- A `earthplotter` (the collection's, a feature's, a link's `to`, `properties`) written back as text by a
  GIS is parsed again.
- A missing, malformed or repeated ID gets a new one; a longitude past ±180° is brought back.
- **Repaired** with a warning: opacities and widths clamped; angles normalised; a colour that is not
  `#rrggbb` or an unknown dash dropped; an unknown symbol, leader or background the default; a bad
  aperture a circle; a name given as a number made text; an unknown group standalone. Clamped
  silently: a line's offset (±50), a label's (±2000), a text size (8–48), a Scale (0.1–100), the
  zoom (0–24).
- Unknown fields are ignored and not written again.
- **Refused** (nothing loads): over 64 MB; not JSON; not an object; not GeoJSON; another version;
  more than 1 000 000 positions in its lines.
- **Limits:** past 20 000 elements, 10 000 characters of text, 200 properties on one element, the
  rest is dropped (warning).
- **Skipped**, the rest loading: not a Feature; no geometry, or a GeometryCollection; a position not
  `[lon, lat]` or its latitude out of range; a line of fewer than two positions (closed: three) or
  more than 100 000; a circle without a valid radius; a group or rule as §7.1, §8.

The report lists what was refused, skipped, repaired and moved, before the drawing is added.

## 11. Other tools; the GIS export

A GIS opening the file sees points, lines and closed lines (polygons) where they are, circles and
labels as points, names and properties as columns, each element's own style, and `earthplotter` (usually
as text; the collection's is ignored by most). It does not see radii, sectors, symbols or label
placement, nor geodesic or curved legs (straight in longitude and latitude: a 50 km east-west leg at
40°N about 40 m apart in the middle).

**GIS data** (a ZIP) carries the file itself, `drawing.geojson`, and `vector/drawings.geojson`, the
drawing **as drawn** (`exportFeatures`, `site/draw/features.js`): only what is shown; positions not
rounded; a point a `Point`; a circle a `Polygon` (`kind` `circle` or `sector`, `radius_m`, `area_m2`, a
sector's `bearing_deg` and `aperture_deg`); a line a `LineString` along its legs as drawn (`length_m`,
and `surface_length_m` when its elevation profile was read); a closed line a counter-clockwise
`Polygon` (`area_m2`, `perimeter_m`); a label a `Point` with its `text`, `anchor` and `along_m`. Each
has `kind`, `id`, `name`, `group` (`A / B`), `point` (a shape's), `guide`, then its properties
(`p_`, `_2` as §5). No style, no `earthplotter`.

## 12. Example

A point holding a 5 km sector; a point holding a rectangle; a line from the first point to the second
through a dot it shares with an area; a label along the line. Written by the app (`serialise`),
shortened only in layout.

```json
{
  "type": "FeatureCollection",
  "earthplotter": {
    "format": "earthplotter-drawing",
    "version": 1,
    "created": "2026-10-22T09:30:00Z",
    "modified": "2026-10-22T09:30:00Z",
    "meta": { "title": "Example" },
    "view": { "center": [12.5, 41.9], "zoom": 9, "data": {} },
    "links": [
      { "from": ["l1", 0], "to": { "element": "a" } },
      { "from": ["l1", 1], "to": { "element": "j" } },
      { "from": ["l1", 2], "to": { "element": "s" } },
      { "from": ["g1", 1], "to": { "element": "j" } },
      { "from": ["t1", 0], "to": { "element": "l1", "edge": 0, "at": 0.5 } }
    ]
  },
  "features": [
    { "type": "Feature", "id": "a",
      "geometry": { "type": "Point", "coordinates": [12.4, 41.9] },
      "properties": { "name": "A",
        "earthplotter": { "kind": "point", "symbol": "diamond", "bearing": 45 } } },
    { "type": "Feature", "id": "s",
      "geometry": { "type": "Point", "coordinates": [12.6, 41.95] },
      "properties": { "name": "Rectangle 1",
        "earthplotter": { "kind": "point", "bearing": 30 } } },
    { "type": "Feature", "id": "j",
      "geometry": { "type": "Point", "coordinates": [12.5, 41.8] },
      "properties": { "name": "Point 1",
        "earthplotter": { "kind": "point", "symbol": "dot" } } },
    { "type": "Feature", "id": "c",
      "geometry": { "type": "Point", "coordinates": [12.4, 41.9] },
      "properties": { "earthplotter": { "kind": "circle", "group": "a", "frame": { "places": [[0, 0]], "turn": 0 }, "radius": 5000, "aperture": 90, "bearing": 45 } } },
    { "type": "Feature", "id": "r",
      "geometry": { "type": "Polygon", "coordinates": [[[12.6004227, 41.951897], [12.5980106, 41.9487782], [12.5995773, 41.948103], [12.6019894, 41.9512218], [12.6004227, 41.951897]]] },
      "properties": { "earthplotter": { "kind": "line", "group": "s",
        "frame": { "places": [[20.5545352, 213.6011], [159.4443607, 213.5993], [-159.4435921, 213.6035], [-20.5561999, 213.5992]] }, "reversed": true } } },
    { "type": "Feature", "id": "l1",
      "geometry": { "type": "LineString", "coordinates": [[12.4, 41.9], [12.5, 41.8], [12.6, 41.95]] },
      "properties": { "name": "Line 1", "ref": "7",
        "earthplotter": { "kind": "line" } } },
    { "type": "Feature", "id": "g1",
      "geometry": { "type": "Polygon", "coordinates": [[[12.5, 41.75], [12.55, 41.8], [12.5, 41.8], [12.45, 41.8], [12.5, 41.75]]] },
      "properties": { "name": "Area 1", "fill-opacity": 0.3,
        "earthplotter": { "kind": "line", "reversed": true } } },
    { "type": "Feature", "id": "t1",
      "geometry": { "type": "Point", "coordinates": [12.4500389, 41.8500111] },
      "properties": { "earthplotter": { "kind": "label", "text": "{name}" } } }
  ]
}
```

`c` and `r` are held by their points (`group`) and placed by their frames: the sector on `a`; the
rectangle's corners about 214 m from `s`, at ±20.6° and ±159.4° from its bearing, written
counter-clockwise and `reversed`. The line runs from `a` to `s` through the dot `j`, which vertex 1 of
the area `g1` is attached to too: they meet there. The label points half way along the line's first
leg.

## 13. Every default

What a value is when the file leaves it out; writing it with this value means the same.

| Where | Field | Default |
|---|---|---|
| collection | `earthplotter` | none: plain GeoJSON |
| collection | `version`; `created`, `modified` | `1`; the time of import |
| collection | `meta` | `{ "title": "", "description": "", "author": "" }` |
| collection | `view`; `look` | none (the map stays as it is); `{}` |
| collection | `groups`, `rules`, `links` | `[]` |
| view | `center`, `zoom`, `layers`, `data` | the map's (`data` left out only by hand) |
| view | `bearing`; `units`; `bearings` | `0`; `"km"`; `false` |
| view layer | `variant`, `opacity`, `period` | the layer's own |
| view data | `colour`, `arrows`, `time`, `depth` | `null` |
| feature | `id`; `name`; properties | a new one; `""`; none |
| feature | style names, `earthplotter.look` | none: the drawing's, else the defaults |
| feature | `kind`; `group`; `visible` | from the geometry; none; `true` |
| feature | `guide`, `measure` | `false` |
| default look | fill; stroke | `#e8590c` 0.15; `#e8590c` 1, width 1.5, `solid` |
| default look | text | `name` `false`, `values` `false`, `size` 13, `color` `#1f2c36`, `background` `halo` |
| default look | `offset`; `scale` | `0`; `1` |
| guide style | fill; stroke | `#5d6d79` 0.05; `#5d6d79` 1, width 1, `dashed` |
| measurement style | fill; stroke | `#b0127a` 0.08; `#b0127a` 1, width 2, `dashed` |
| group | `groupId`; `name`; `properties`; `visible` | `null`; `""`; `[]`; `true` |
| point | `bearing`; `symbol` | `0`; `none` (`diamond` without `earthplotter`) |
| circle | `aperture`; `bearing` | none (whole); `0` |
| line | `names`; `smooth`; `reversed` | each `""`; `false`; `false` |
| label | `text`; `offset`; `leader` | `""`; `[40, -40]`; `arrow` |
| link target | `at` | `0` |
| distribute | `groupId`, `copiesId`, `spacing`, `count`, `aperture`, `item` | `null` (`item`: a circle) |
| distribute | `startMargin`, `endMargin`, `offset`; `side`; `radius`; `pointIds` | `0`; `left`; `500`; `[]` |
| connect | `groupId`; `pattern`; `groupSize`; `minBranch` | `null`; `tree`; `auto`; `0` |
| connect | `roots`, `pointIds`, `created`; a root's `weight` | `[]`; `1` |
