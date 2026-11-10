# Depths

Where the depth shading and the isobaths come from, why, and what they can
and cannot say. For whoever uses the map and wonders how far to trust a
line, and for whoever changes this part of the code.

## In one paragraph

The sea's depths come from two public grids. In European seas the page reads
EMODnet's; everywhere else, GEBCO's. Each is drawn as it is: no depth is
corrected, smoothed or invented by this project. A click on the water says
which grid the depth comes from and whether it was measured there or
estimated. Neither grid is a nautical chart, and nothing here is for
navigation.

## The two grids

| | GEBCO 2026 | EMODnet DTM 2024 |
|---|---|---|
| Covers | the world | 36° W to 43° E, north of 15° N; read here north of 30° N, and of 27° N in the Atlantic |
| Cell | 15 arc-seconds, about 460 m | 1/16 arc-minute, about 115 m |
| Made by | one global compilation of many sources | one compilation per European sea basin |
| Says of each cell | how its depth was obtained (a code) | whether it was interpolated (a flag) |

Both are read from the project's data host, as plain files
(`tools/gebco.mjs` and `tools/emodnet.mjs` build them).

## Why EMODnet in Europe

GEBCO builds its grid cell by cell from different kinds of source: soundings,
depths read from satellite images, values predicted from gravity. Where two
kinds meet and disagree, the grid has a step that the seabed does not have.
West of Salamis, cells read from satellite images say 14 m in water that
charts give as 40 m, beside sounded cells that say 55 m near a shore where
charts give 15 to 25 m. The isobaths, drawn faithfully from those cells,
traced the boundaries between sources instead of the seabed.

This is not one bad spot. On the shelf worldwide, two neighbouring GEBCO
cells differ by 10 m and by half their depth in under 1 % of pairs when both
come from the same kind of source, and in 8 to 14 % of pairs when they do
not.

EMODnet's grid is put together sea by sea, by people who know each sea's
data, and it is finer. Measured the same way over all its area, it has
about a fifth fewer such steps than GEBCO (0.65 % of neighbouring cells
against 0.82 %; in the Aegean 2.8 % against 3.4 %), though not everywhere:
on the south coast of Turkey and in the Levant it has slightly more. Fewer
steps is smoother, not proven truer; and how much of its shelf holds its
own soundings varies from over 40 % in the North Sea to 10 % in the Aegean. Compared with a nautical chart at six places from
Liguria to the Dodecanese, it was better than GEBCO at four and equal at
one; at the sixth, where neither has soundings, the two were wrong in
different ways.

## Why its grid whole

An earlier version took EMODnet's cells only where EMODnet has soundings,
and GEBCO's elsewhere. Mixing two grids cell by cell is what GEBCO itself
does, with the same result: seams, each found only by looking. It would also
have left Salamis as it was, since EMODnet has no soundings there: its
values are interpolated, and they follow the charts.

So the rule is one grid per region, taken whole. Wherever EMODnet has water,
its depth is drawn, measured or estimated alike.

## What "interpolated" means

EMODnet flags a cell as interpolated when no sounding falls inside it. The
value is then computed from what lies around: other soundings, depth
contours from charts, an older grid. It is not empty and not flat. An
interpolated gulf has a shape, with its own hollows and rises, and the
isobaths draw that shape like any other.

How good it is varies, and the data does not say. West of Salamis the
interpolated depths agree with the charts. In the Gulf of La Spezia they are
close in the middle and too shallow in a wide band towards the shores.
EMODnet publishes nothing that tells the two cases apart: the flag, the
source reference and the count of values are the same in both. A rule of
this project's own to tell them apart would be a guess about a guess, so
there is none. The depths stay EMODnet's, and the page says what they are.

## What a click on the water says

- **EMODnet 2024 · surveyed.** Soundings fall in this cell.
- **EMODnet 2024 · interpolated: no soundings here.** EMODnet's estimate.
- **EMODnet 2024 · none here: from the water beside it.** EMODnet calls
  this cell land, but the base map has sea here and EMODnet has water close
  by. The depth is that water's, fading to the shore.
- **GEBCO 2026 · surveyed, optical, estimated, or another grid.** GEBCO's
  depth, with the kind of source GEBCO gives for it. Outside Europe always;
  inside it only where EMODnet has no water within about 600 m (some ports
  and lagoons, and coasts it leaves out). That is 0.6 % of all the water in
  its area but 3 to 5 % of the water shallower than 200 m, and about a
  fifth on the south coast of Turkey and in the Levant.
  GEBCO's "surveyed" is generous: in the Aegean more than half the cells it
  calls surveyed are cells EMODnet marks as interpolated.

The *Depth sources* layer shows the same for the whole view: green
surveyed, orange estimated or interpolated, blue read from a satellite
image, grey from another grid. Where nothing is coloured, the grid has no
depth of its own.

## Comparing the two grids

Each layer drawn from the depths (*Depth shading*, *Isobaths*, *Depth
sources*) says its source behind its ⓘ, and there, in each of them, is the
one choice: *Depths in European seas* from *EMODnet*, as described here, or
from *GEBCO*, as everywhere else and as the page drew them before. The
shading, the isobaths, the depth on a click, a line's elevation profile and
*Depth sources* all follow it, and a link keeps it. With GEBCO chosen the
depth shading's legend names GEBCO alone, and so does a click.

It is there so that the choice of grid can be checked by anyone, place by
place, and for the places where EMODnet's estimate is the poorer one.
EMODnet's own drawing of its grid is the layer *EMODnet depth (Europe)*.
There is no third choice for EMODnet's grid alone: what is drawn in European
seas is already that, but for the fallback and the fade to the shore, both
of which a click names.

## The shore

The grids' coastlines are not the base map's. The page cuts every depth to
the OpenStreetMap coastline, so that a line ends on the shore as drawn.
Between the last cell with water and that shore the depth fades to zero over
about a cell's width.

The coastline is not used as a measured depth of 0 m. Tested against
EMODnet's own soundings, a straight slope from the shore reads 5 to 7 m too
shallow in the first hundred metres, because the seabed drops at the
waterline faster than a slope; the fade drawn now reads 2 to 14 m too deep
there. A curved profile is better on steep coasts and worse on flat ones. No
single rule fits, so the simplest is kept, and the 5 m and 10 m lines close
to a steep shore are the least certain on the map.

## Where the two grids meet

EMODnet's grid reaches south to 15° N, but the page reads it only north of
30° N, and of 27° N in the Atlantic, to keep the Canaries. South of that, in
the Red Sea and off West Africa, not one of its shelf cells holds a sounding
of its own, and the two grids disagree more than anywhere else (over 39 % of
the shelf on the Banc d'Arguin). Those are clear, shallow waters, where
GEBCO's depths read from satellite images are at their best, so GEBCO is
kept there. On the south shore of the Mediterranean EMODnet has no soundings
either, but a sea is not cut in two.

At the edge of that area the two grids are blended over a quarter of a
degree, so that no line breaks there.

## What the lines cannot say

- **Position.** A cell is 115 m or 460 m wide. A line drawn from it cannot
  be placed better than that, however smooth it looks zoomed in.
- **Shoals.** A cell holds the mean depth over its area. A rock shallower
  than its surroundings and smaller than a cell is not there. Charts draw
  the shallowest sounding; these grids do not.
- **Datum.** EMODnet's depths, and GEBCO's surveyed depths in Europe, are
  from the lowest astronomical tide, as charts give them. Where tides are
  large the sea is usually deeper than drawn.
- **Truth.** No open nautical chart exists for most of Europe. The
  comparisons above were made by eye against a commercial chart viewer whose
  source is not stated.

## Beyond Europe

GEBCO's steps between sources remain wherever only GEBCO is read. Some
countries publish open grids of their own waters; each could replace GEBCO
in its region, whole, as EMODnet does (ROADMAP).
