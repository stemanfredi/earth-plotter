# Tools: the interface

How drawing and measuring behave: what the screen shows is not repeated here, only what it cannot
show (the layout's rules, snapping and attaching, order, the look's cascade, the rules, keys,
storage). The file is in `drawing-format.md`.

Code: `site/frame.js` the frame, `site/draw/` the rest (architecture.md says which file holds what).

## Principles

How the interface decides, when this file does not say. The model it shows is in
`drawing-format.md` (The model).

- **Copy the established tool.** A behaviour another tool has made familiar (QGIS, a drawing tool's
  groups, CAD's blocks, OpenStreetMap's shared nodes) is taken as it is, not invented again.
- **Draw roughly, type exactly.** The map is for placing and dragging; Properties for exact values.
  A drag sets the same values its fields do, and the values show on the map while it moves.
- **The screen shows, the note tells only what it cannot.** Nothing visible is announced; a value
  refused, a file not read, a click that did nothing is. Tooltips are short: a name, a key, at
  most what a field means.
- **One way back.** Esc (Back, a right-click) steps back one level, always in the same order; every
  action is one undo step.
- **One grammar.** Every inspector runs in the same order; one kind of table, one unit rule, one
  number style; one word for one thing (the model's words); whatever folds (a Layers group, a section
  of Properties, a row of the tree or the Library) has one fold mark, before its name.
- **What behaves differently looks different.** A shape (it moves with its point, rigid) and an
  area (edited vertex by vertex) differ in name and icon; a snap mark says what a click would attach
  to.
- **The real object first.** Marks never hide an element's own stroke; what is drawn larger or
  beside (Scale, Offset) is said in its look, and values are always the real ones.
- **Mouse and finger alike.** The same rules, larger targets; what a key or right-click does has a
  button with a finger.
- **Neutral words.** Geometry's words only: what an element stands for is the user's, in its name
  and properties.

## 1. The layout

One layout at every width (`site/frame.js`).

- **The bar**, across the top: the file group, **Open** (the drawings in this browser, + New, **Open
  a file…**), **Download** (the drawing's GeoJSON, a
  picture, GIS data, the Library; apart, **Offline areas…**), **Copy link**; **Layers**, **Elements** and **Library** (the left panel's
  tabs); **Undo**, **Redo** (history, not tools); **Select** and **Box select**; **Measure**; at its end **find a place** (a field; / goes to it), **About**
  and the **Properties** toggle. The drawing is named in Elements' first row and its Properties.
  With a finger under 1,280 px (a tablet), as on a phone: **☰** in place of Open holds the
  file group and About, find a place is behind its lens with the map's controls. The bar has no tool
  that makes elements: what is drawn is chosen in the Library (§9), the bar acting on the map (a
  measurement is a question asked of it).
- **Box select** (B): the next drag on the map, a mouse's or a finger's, draws a box (even one starting
  on the selection); what lies inside is selected, then Select again. A drag with Select moves the map
  (or, on the selection, moves it); Shift-drag is the box too, but on a handle (its proportions, its
  15° steps). While a drag is under way, Undo, Redo, Delete and Paste wait: Esc puts the drag back.
  On a phone its button is in the dock.
- **The left panel**: **Layers**, **Elements** (the tree, §4) or **Library** (§9), as its
  button in the bar (or **L**, **E**, **K**) chose: pressed again, it closes. At first it is open on Layers;
  Layers' button turns while the map's layers load.
- **Properties** (the inspector, §5), on the right: a switch of the user's (its toggle, **I**, or a
  double-click on an element), off at first. While on, it shows what is selected, else the drawing (its title,
  its display, its totals); on a phone it shows the drawing only while on (a tap on the tree's first
  row turns it on). The left panel making way for it, or
  a label placed (its text there to be typed), shows or hides it for the moment: the switch comes
  back as it was at its next press. Its head: what it shows, then
  **Zoom to**, **Duplicate**, **Group**, **Delete**.
- Each panel is as wide as dragged at its inner edge (left 200–480 px, right 260–600; a
  double-click: 260 and 320); widths, the tab and the switch are remembered in this browser. Where
  both would leave less than 480 px of map, Properties, while shown, takes the room and the left
  panel comes back after; the first time in a visit a note says so, and Layers or Elements (or L,
  E) then brings it back, Properties off.
- **The map's foot**: one strip above the bottom row, between the panels (a phone: above its sheet).
  At its left, stacked: the legends, the touch row; at its right **the map's controls**: my
  position, zoom in and out (with a mouse: a finger pinches), north (only when turned). Nothing else
  sits there, so nothing overlaps. The bottom row between the panels, one line: credits (what does
  not fit fades at the end and scrolls sideways), the time shown (a chip: a click opens its
  calendar), the depth shown when a layer has one (a chip: a click opens its list), the cursor's
  position, the scale (a click switches km and NM; in orange with "≈" before it where the scale
  varies across the view, the tooltip by how much).
- **Copy link** carries the view, the layers and the display settings (`u=nm`, `brg=1`), never the
  drawing. The drawing goes out as a file (**Download** › **Drawing (GeoJSON)**, with the view) and
  comes in by **Open a file…** or a file dropped on the map, after a report (what it holds, what was skipped and
  why); a library file adds its presets (§9); an offline area's file (a zip) joins the offline areas.
- **The note**, a chip under the bar at the centre, says for a few seconds what the screen cannot
  show: a value not applied and why, a file not read, what was copied, why a click or a box did
  nothing, a root not used, a panel that made way. What is visible (a deletion, a copy selected, a
  rule's result) is not said.

**On a phone** (under 720 px) the top is for looking, the bottom for doing. The bar holds **☰**
(Open's menu with Download's, Copy link and About), find a place (a field), Layers, Elements and
Library. The **dock**, a bar along the bottom, holds Undo, Redo, Box select and Measure; while a tool is
on: **Back**, Undo, Redo, what is being drawn (its name; Measure's button) and **Done** (a line or
measurement being drawn). A row picked in the Library folds the sheet away; the tool off, it comes back.
The panels are one bottom sheet at a time over the dock (half the screen; as tall as its grip is
dragged, short of the bars, the map's foot and some map; closed when dragged to the bottom). What is
selected, while Properties is off and the left panel closed, **peeks**: Properties' head alone (what it
is, Zoom to, Duplicate, Group, Delete); a tap or a drag up on it turns Properties on, a drag down
turns it off again; a tap on the map clears the selection. Both panels start closed. Zoom to and a
place found are fitted to the map the bars and the panels leave.

**With a finger** (a tablet; a phone's are the dock's and the peek's): a row over the map's foot:
**Done** (a line or measurement being drawn), **Back** (one level, as Esc), **Delete** and
**Duplicate** (a selection). Handles are 14 px, grabbed within 22 px; snapping reaches 16 px, always
(to place near something without snapping to it, zoom in); a + only on legs over 80 px; a second
finger during a drag puts it back and lets the map pinch.

**Colours and sizes**: pressed is blue, a panel shown pale blue, yellow the marks on the map (bands,
targets, +), handles white edged in ink, magenta the map's own (measurements,
the search's pin). With a mouse the bar is 39 px (32 px buttons, 20 px icons), rows 24 px, heads 30 px; with a
finger every target is 44 px. Text: 11, 12, 13, 14, 16 px (a × glyph 18 or 20).

## 2. Tools

One tool is on at a time, and stays on after each placement. A row of the Library (§9) turns on the
tool that draws it; the row again, Esc or Select turns it off. A tool's key works from anywhere but a
panel's control (a button, a box: focus there keeps the letters for it): on with what it drew last, or
off. Measure is the bar's.

| Tool (key) | The Library's | Makes |
|---|---|---|
| Point (P) | Point | a point: a marker, the same size at every zoom |
| Line (G) | Line, Area | a line; closed on its first vertex (an Area: as it ends), a closed line (an area) |
| Shape (S) | circle, rings, sector, rectangle, ellipse, triangle, three vehicles, the user's presets | a point with no symbol holding its shapes (circles, a sector, or a closed line: the outline's vertices), the point named after its kind, its shapes nameless (the tree shows them by kind and size); a preset of the user's keeps its properties and names itself in the property `preset` |
| Label (T) | Label | a label |
| Measure (M) | (the bar's) | nothing, unless kept (§3) |

### 2.1 Placing and drawing

- **Shape**: the centre, then the size as the pointer moves (a circle's radius, rings' outermost, an
  outline's front: 100 × 50, a triangle equilateral). It makes a point and the shapes it holds: a
  circle each (rings: three, the first filled), a sector, or an outline's vertices as a closed line,
  each a shape like any other once made. It faces north; its bearing is a second step (the point's
  stalk, or Bearing). A **rectangle** or **ellipse** goes corner to corner instead (**Shift**: a
  square, a circle). The second click on the first: the default size. A preset of the user's keeps
  its size: one click.
- **Line**: as Measure, a click per point, snapped to what is drawn; Enter, a double-click, a
  right-click or Done ends it at its last vertex, each vertex attached where it snapped to a point, a
  shape or another line (§2.2: as its mark said); a click on its first vertex (three or more)
  closes it: a closed line, "Area 1", filled, its last leg back to its first vertex. Backspace or
  Undo takes back a vertex.
- **Sector**: the centre; the radius and one edge; the other edge, clockwise (back on the first: a
  circle): a point holding the sector. Esc goes one click back.
- **Label**: points at what snapping finds (else a closed line's centre, a spot on an open line), or is free
  text where clicked; its text selected, ready to type. It has no name of its own: the tree shows
  it by its text as it reads, and renames it by its text.
- What is drawn or dragged shows its values on the map (legs, total, area, radius). Exact lengths and
  bearings are typed afterwards, in the points' tables (§5).
- **Shift**: 15° steps from the leg before (from north for the first). **Alt**: nothing snapped or
  attached.
- **Esc** (or a right-click with nothing to finish) steps back one level: a drag (put back), else a
  box being drawn (dropped), else a form open (Distribute along, Connect), else Attach to… waiting, else what is half drawn, else the
  tool, else Box select, else the selection. A tool started while a form is open closes the form.

### 2.2 Snapping and attaching

Clicks and drags snap within **6 px**. The nearest target of the first kind found wins: a **vertex**
(a point's centre, a circle's, a line's vertex or an open line's free end), then a **crossing**
of two edges or legs, then an **edge**. Hidden elements are not snapped to. The target is marked: a
ring on a vertex, a cross on a crossing, a dot on an edge; in yellow where a click there attaches (a
line's vertex, below), in grey where it only puts the vertex there.

**Lines meet at points.** Any vertex of a line (its ends, and every vertex between: dragged or by
**Attach to…**) is attached to what it snaps to and follows it. On a point, to that point; on a
**point's shape** (a rectangle, an outline), to its corner or to a spot along its edge, following it
as its point moves and turns (its real corner, whatever its Scale); on another line's vertex or free
end, a dot is made there and both are attached to it; on another line's **leg**, a vertex is put in
that line there too, and a dot joins both (that line stays one line, a closed one closed). A guide,
a circle's centre and a crossing give a position only. A point's shape itself is attached to
nothing: it goes with its point (a line given to a point, or a shape detached, loses the attachments
it may no longer have). **Detach** frees an attached vertex where it is.

**A label** points at what it snaps to and follows it: a point's or a circle's **centre**, a line's
**vertex**, or a spot along a **leg** (turning and stretching with it).

A vertex whose point or target goes is free where it was; an edit of the line a label is on keeps it
on the nearest vertex or edge.

## 3. Measure

Measure: a click per point, snapped; each leg and the total shown. Enter or a double-click ends it; a
click on its first vertex closes it (area and perimeter). What it measured goes in the drawing,
selected, as a line "Distance 1" or a closed line "Area 1": a **measurement**, a guide of its own,
magenta and dashed, its values shown. It stays one whatever its values: Show values off, it is still
magenta (and a guide showing its values is still a grey guide). Saved, printed and exported with the
drawing; Delete (or Undo) removes it; unticking Guide makes it part of the drawing.

## 4. The tree

- Its first row is the drawing: its title ("Untitled drawing" while it has none; a click selects it:
  Properties, when on, show it, and on a phone it turns them on; a double-click renames it, as any row), how many elements it
  holds, and an eye for everything listed.
- Then groups first, what is in each one step further in (a group folds), then the rest; a point's
  shapes are rows under it, one step further in, folded to start with: its caret opens them, and a
  shape selected shows its row. A row: the element's icon (a point with no symbol: its first
  shape's), its name (else its kind and place: a point's closed shape is an **Outline**, a closed line
  drawn on its own an **Area**), a short value (a point's shapes, a radius, length,
  area, text, a group's count), its eye.
- **Order**: the first of a kind is drawn on top; between kinds the stacking is fixed (§7). A row
  dragged onto a group goes into it, a shape's onto a point into that point; onto a row of its kind,
  before it and into its group; onto another, into its group. Ctrl/⌘ ] and [ move the selection a
  step up or down among its kind.
- Selecting: a click (Shift: a range; Ctrl/⌘: add or remove), ↑ ↓, or on the map (the tree follows);
  hovering a row outlines its element. **Box select** (or Shift-drag) on the map adds what lies
  entirely inside the box. Past 30 elements a filter appears (names and property values), with **Select all
  shown**. Double-click a name, or F2, renames.

## 5. Properties

It shows one element, several (its head counts them by kind; what they share, set on all at once;
one Look for all; how far apart two points are, and the bearing from the first to the second;
**Connect…**), a group (**Connect…** on the points in it), or the drawing (title, description, author, when it was created;
**Display**, the drawing's look, the distance units and the leg bearings; **Totals**). A field applies on Enter
or when left, one undo step; a value that does not read stays marked and is not applied; Esc puts it
back. ↑ ↓ nudge a number by its last digit (Shift: ten). Distances show by the one rule below (to
the metre); what is typed is kept as typed. Properties is updated in place as the
drawing changes (a field being typed in keeps its text and the focus; Tab and a click go where they
go); during a drag on the map it shows the drawing as it was, and is drawn again when the drag ends
(the map shows the values while it moves).

**Totals** (the drawing's, a group's), by group or by a property, with Copy: the open lines' length,
by group and by what a connection made; the areas drawn; and what was **placed**, by kind: a point
alone, or a point with its shapes counted once, named by what was placed ("Aerial vehicle 2 ·
Sector 3"; its outline not an area, its circles not circles).

One grammar, top to bottom: what it is (the rule that made it, its name), its geometry, its lists,
its **actions** (one row of buttons: Edit…, Update and Select all for what a rule made, Distribute along…,
Add to library…, Select members, Connect…), its **Look**, then its foot (a shape's **Point**, **In
group**, **Guide**, **Data**). Every number is 12 px, of one width; a unit stands beside its value in grey (a distance
field shows its number, its unit next to it or in the column's head: typed with another unit, it is
read in that one). One rule for every distance: metres below 1 km, else km; with NM, NM; shown to the
metre (km to three decimals, NM to three: about 2 m). A column
takes one unit by its largest value.

- **Rows**: a label, one value or a pair (latitude · longitude, colour · opacity), and a last column
  for an action (detach, attach, ↺). A box ticked is a row like any other.
- **Lists** (a line's vertices, data, the totals, a connection's roots): one
  kind of table, none wider than the panel's 320 px. A long one scrolls in its own box, its head
  kept. The row clicked is current, its
  actions (and what did not fit the columns) in a bar over the list, shown only then, and on keys
  (Insert, Ctrl/⌘ Delete); ↑ ↓ and Enter keep the column. Past 100 rows, a page at a time. **Copy**
  gives every row, tab-separated, for a spreadsheet. Numbers are right-aligned, with fixed decimals:
  degrees to 6 (a decimetre), distances in the column's unit (in its head) to the metre, bearings
  to 1.
- **Sections** have the heads of Layers' groups, and each folds, its fold mark first (as every fold): **Data**,
  open while it has properties of the user's; **Elevation profile**, read when opened; **Totals**,
  open to start with; the others (Look, Vertices…) open to start with, one folded staying folded from
  one element to the next.
- **A line**: its **Length**; closed, its **Area** and **Perimeter** instead. **Closed** (three
  vertices or more) joins its last vertex to its first, unticked opens it again.
- **A line's vertices**, 1 (its start) to N (its end): Lat, Lon; the **leg** from the vertex before
  (a closed line's vertex 1: from its last), its length and bearing (typed: that vertex alone moves,
  the legs either side of it change). The row current says how far **along** the line its vertex is
  and holds its name. A vertex attached shows what to, its leg as it is. Every row's bar has **Attach
  to…** (pressed while the next click chooses) and, attached, **Detach** (it stays where it is);
  **Insert after** (not an open line's last), **Delete** (two are kept; closed, three) and **Split**
  (not an end: two lines, attached to a point made there; on a closed line, any point: it opens
  there, its start and its end at that point). The row current is ringed on the map; a point pressed
  on the map makes its row current, on its page. A point's shape is rigid: its rows only show its
  vertices (and their names), its form changes by its handles.
- **What several share** (two or more selected, or a group's members under **Each member**): every
  row two or more of them have, "mixed" where they differ; a value set there goes to each that has
  it. Points: Position each axis alone (a latitude typed puts them all on that parallel, their
  longitudes kept), Symbol, and Bearing for those holding shapes (carried). Circles: Radius. Lines: Path. All but
  labels: Guide. Labels: Leader.
- **The look's cascade:** an element's own value, else the drawing's Display, else the default; **↺**
  gives a field back. Fill (a closed line's, not an open one's) and Stroke are rows (a colour, its opacity in %), Width (px) and Dash
  their own. Where several differ a field says "mixed" and a change writes only that field. A group
  is only who is in it: joining or leaving changes nothing of an element; its Look sets each member.
  A hidden group hides everything in it, a hidden point its shapes.
- A line's **Path**: straight, or smooth (a curve through the vertices, following them).
  **Elevation profile**: the elevation along it, as the shadings draw it (the sea's depths below sea
  level, the land's heights above; every 30 m, at most 1,000 places; one that could not be read a
  gap), its lowest and highest, a chart linked to the map both ways, its length along the surface,
  CSV. When none could be read it says so, and reads again when next shown.
- **A point**: its Position and, while it holds shapes, its **Bearing** (typed, or its stalk: its shapes move and turn with it,
  each keeping its distance and bearing from it; a symbol is never turned), its Symbol, its **Shapes** (each a link to it).
  **Add to library…**. Its **Look** sets its symbol's colour and its shapes' look (each field on
  those that have it). **Data**: its properties as keys and values.
- **A circle**: its centre, **Radius**, **Aperture** (a sector that wide, centred on its **Bearing**;
  empty or 360: the whole circle, as the file reads it), its **Area**; **Distribute along…**. Its look is its own, as any
  element's: Fill (an opacity of 0: not filled), Stroke, Width, Dash, Show values (its radius).
- **A shape's Point** (a circle or a line): the point holding it, and **Detach** (free where it
  is, in the point's group: an element of its own, named, a closed one an Area, never scaled); a point
  holds circles and closed lines only; free, **Attach to…** (the next click on a point makes that point hold
  it). A shape held by a point has no In group: it is in its point's. It moves only with its point:
  dragged or its Position typed, its point moves and carries every shape (Detach it to move it
  apart); alone, its own handles still size it.
- A **label**: its text, with value codes ({name}, {along}…: **+ name** and the like insert them) and,
  while it has any, what it **reads** under it; **Attached to** what and where (a line's vertex or leg,
  as its table numbers them), or its **Position**; **Along**, on
  a line; **Text offset**, where its text was dragged to (↺: back); **Leader**. Look:
  text size (px), colour, background (halo or box).
- A **group**: **Members** as the tree counts them (everything in it, its subgroups' too) and its
  subgroups, with the group's eye (as its row's); **Totals** as the drawing's, its members only, by subgroup
  (Copy); **Select members**; **Look · sets each member** (a group has no look of its own); its foot
  as every element's.
- **Guide** (points, circles, lines): faint and dashed, left out of the totals.

## 6. Distribute along and Connect: rules

Both are **rules** (`generator.js`): they make plain elements and keep their settings, to be edited
again. They follow nothing by themselves: **Update** brings what one made up to date with what it
was made from. What a rule makes is in a group of its own; anything it made shows a **Made by** row
("Distribute along Line 2 · 12 copies", "Connection · trees, 12 points to 1 root") with **Edit…**
(its form again), **Update** and **Select all**.

**Distribute along…** (a line, a closed one round its ring from its first vertex, or a circle,
clockwise: its whole round from its bearing, a sector's arc) opens a form in Properties (any tool
goes off):

- **By** spacing or count; **Margins** at the start and the end (none round a ring); **Offset** left, right or
  alternating (Out, In round a circle); **Copy**, a built-in kind or a preset of yours; **Radius**
  (500 m to start with; a preset keeps its size); **Aperture** (a sector facing away; empty: circles);
  **In group**. Each copy is a point and its shapes, turned to face away.
- It makes a group "Distribute along" and the name, holding **Copies** (and **Connection**, once
  its copies are connected).
- A faint preview follows the settings; **Create** makes it in one undo step. Copies stay where
  they are made; **Update** places them again along what they lie along as it is now (one moved by
  hand too); when another number of them fits now, it asks first, as Edit… warns.
- **Edit…**: the same count and copy moves the copies, as they are (one changed by hand keeps its
  own); another copy makes them anew of it, another count anew as the first copy left is (warned
  first), and their connection with them.

**Connect…** (two or more points selected, or a group holding them: a distribution's own, its
Copies) opens its form (a click on the map picks a root):

- **Tree** (root → hub → each point) or **Chain** (root → point → next point); **Group size** Auto
  (the cheapest cut; trees up to 32 points) or a number; **Min. branch** (a tree's hubs at least
  this far from their points and root); **Roots**, each with a **weight**. While roots are picked a
  click places a new root, or takes or drops a point. The points are taken in order (a
  distribution's along its line, else as selected) and planned as drawing-format.md §8.2 says. The
  summary says the groups, the roots used and the total length; a root that wins nothing is
  reported unused.
- A faint preview follows the settings; **Connect** makes it in one undo step, in a group
  "Connection" (a distribution's beside its Copies, else in the points' group). Its lines follow the
  points they are attached to; a hub stays where it was made. **Update** plans it again from its
  points and roots as they are; **Edit…**: **Connect again**, its lines and hubs made anew.
- **Deleting a root** leaves the lines to it with a free end; Update plans it with the roots left.
  The last one deleted ends the rule: its lines and hubs stay, plain.

## 7. On the map

- **Stacking**, bottom to top: circles and sectors, closed lines' fills, lines (guides under),
  symbols, names and values, labels; within each, the drawing order (§4).
- **Marks** are yellow cased in white, seen on the sea's blue as on the chart: half strength for hovering (a band just outside the
  element), full for the selection and for targets. The one element selected shows its handles; among
  several, the same squares at their key points, inert. What is not made yet is dashed and dark. Selecting never moves the
  map; Zoom to does.
- **Clicks**, no tool on: the topmost element (Ctrl/⌘: added or removed, as in the tree); the same place again, the next one down. A shape a
  point holds: a click selects its point (with its shapes, marked with it); the same place again,
  the shape alone.
- **Dragging** a selected element moves it (several together) as one piece along the ellipsoid: each
  position keeps its distance and bearing from where it was grabbed, which stays under the pointer, so
  it keeps its size at any latitude. One undo step; Esc puts it back; positions snap (Alt: free;
  Shift: 15° steps). A point moved or turned carries its shapes; a shape it holds, dragged, moves it.
  **Handles**: a circle's radius; a sector's two ends and its stalk (its bearing); a point's stalk,
  just beyond its shapes' front (it turns them with it); a line's vertices (one attached to a point moves
  the point; another, dropped on a point, a point's shape or another line, is attached there) and a **+** halfway along a leg (a closed
  line's last leg too); a label's text and, free or on a line, its point. A point selected shows its
  shapes' handles with its own. A shape a point holds is rigid: a vertex dragged resizes it, its form
  kept and the vertex farthest from it staying put (a rectangle's opposite corner; Shift: its
  proportions too), the point moving to stay its centre; no **+**. The point itself shows no dot
  while it holds shapes.
- **Display only** (never in lengths or exports): **Offset**, a line drawn beside itself (−50 to 50
  px, as QGIS offsets a line symbol; ⇉ in the tree); **Scale**, a point's shapes (what the
  Shape tool and the presets place) drawn up to 100 times their size or down to a tenth, about the
  point, so that they stay seen zoomed out (an area drawn is never drawn larger): set on one, on several at once, or in Display for
  every one. Its handles are where it is drawn and set its real size through it; its values, the
  totals, the file and what is attached to it keep the real one. A point's symbol keeps its shapes
  found at any zoom. A circle's name is on its rim, under its radius (a sector's: at its arc's middle),
  so rings about one centre each show theirs. Names collide away; labels are always drawn.

## 8. Keys

| Key | Does |
|---|---|
| / | search |
| L, E | the left panel on Layers, on Elements, or closed |
| I | Properties on or off |
| P, G, S, T, M | point, line, shape, label, measure; again: off |
| B, Shift-drag | Box select: a box, what lies inside added to the selection |
| Enter, double-click, right-click | finishes |
| Backspace | takes back a point |
| Esc, right-click | steps back one level |
| ↑ ↓ | previous, next element in the tree |
| Delete (Mac: also ⌘ Backspace) | deletes the vertex current (pressed on the map or its row), else the selection |
| F2 | rename |
| Ctrl/⌘ Z, Ctrl/⌘ Shift Z | undo, redo |
| Ctrl/⌘ C, V, D | copy, paste, duplicate |
| Ctrl/⌘ ], [ | the selection up or down in the drawing order |

None act while typing in a field, except Esc and Enter. About lists them from `site/keys.js`.

**Copy, paste, duplicate:** a copy keeps its group, look and properties, gets new numbered names and
keeps the attachments between the elements copied together (a line's vertex on one left behind is
free); a point is copied with its shapes, a shape copied alone is free. Paste
puts its middle at the pointer, moved there as a drag moves (its size kept at any latitude);
Duplicate 20 px beside. One undo step; the copy selected. The clipboard
lives in this page, so it pastes into another drawing opened in it.

## 9. The Library

Everything there is to draw, in the left panel's **Library** tab (**K**), as a drawing tool's library
of shapes or blocks: **Built-in** (Point, Line, Area, Label, then the Shape tool's kinds), then the
user's **presets** in their folders, a name's part before its last " / " ("Folder / Name"); a folder's
presets in the order people read ("70" before "100"), those in none last. Folders stay folded as left.
Each row: a picture (a point preset's: what is shown of it, in its own colours, north up; a line's: a
stroke as it draws; an area's: a swatch; a label's: "Aa" in its colour); its name; a point preset's
size, to tell them apart (a largest circle's radius, else its sides, the larger first). A filter above.
A row clicked: drawing it, the row pressed; again, no longer. One placed in a click (a point, a shape,
a point preset) dragged onto the map: placed there (its default size), selected.

**Add to library…** (the Properties of a point, a line, an area or a label: not of a point's shape,
which goes with its point) keeps it under a name ("Folder / Name"), a small drawing of its own.

- **A point** keeps its shapes as they are (their sizes, their places and bearings about it, their own
  looks, shown or hidden); Distribute along copies all of one that holds shapes. Placing one makes a
  copy of it facing north about the place clicked, at its own size (one click), the point named after
  it (numbered, its folder left out), its shapes keeping their names, its properties kept with the
  preset's name as `preset`, the point shown, its shapes shown or hidden as saved, none a guide.
- **A line or an area** keeps its look, its properties, whether it is a guide or curved. The Line tool
  then draws each one so (an area's closed as it ends), named after it, its properties with `preset`.
- **A label** keeps its look, its properties and its text (its live values too): each placed so.

A preset's **⋯**: Rename… (its folder too), Duplicate, Delete. Adding one under a name in use asks
before replacing it (a file's replaces). Presets live in this browser only; **Download** › **Library
(JSON)** and **Open a file…** move them.

## 10. Deleting, and drawings in this browser

- Delete goes at once (Undo brings it back). A point takes its shapes with it; a point with no
  symbol goes with its last shape, as nothing of it would be left to see. Lines attached to what
  goes stay, their points free where they were; labels on it stay, free. A group with members asks first: the group only (what is
  in it goes to the group above), or everything in it.
- Each drawing is saved as it changes, never sent anywhere; the open one comes back with the page.
  **Open** lists the drawings in this browser (last change, size): a click opens one with its view (where
  it was drawn, its layers, time, depth and units, as an import does), a bin deletes it for good
  (asked first); **+ New drawing** adds one.
- When the browser refuses to save, Properties says so (Download › Drawing keeps it as a file); when
  another tab saved the same drawing, it says so, with **Reload**.
