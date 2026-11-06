# Earth Plotter

**[earthplotter.org](https://earthplotter.org)**

![The Bay of Naples in Earth Plotter: depth shading, isobaths, relief and place names, beside the Draw panel](site/preview.jpg)

A free map of the world's land and sea in your browser, from open data. It
draws the OpenStreetMap base map with relief and contours, depth shading and
isobaths, satellite imagery, seamarks, shipping density, ocean data from
Copernicus Marine and NASA's daily imagery. Measure and draw on it, export the
view as GIS data, and save areas to use without a connection.

**Not for navigation.** Positions, coastlines and depths come from open
datasets of varying accuracy. Depths are a global elevation model, not
soundings.

## What you can do

Choose layers by task; each says where its data comes from, under what
licence, and how fine it is. Click the sea for its depth. Search a place or
type coordinates. Set one time for every layer that changes with time, and
one depth for the ocean variables. Measure distances, bearings and areas along
the real curve of the Earth, in kilometres or nautical miles. Save the view
in the browser to open it without a connection: the base map, relief and
contours, depths and isobaths, and seamarks. Draw points,
shapes of real size, lines, areas and labels; keep them in groups; attach
lines to what they touch; place copies along a line and connect them to
roots. Read a line's elevation profile, at sea and on land. Export the view as a picture, as GIS data
that QGIS opens, or your drawing as GeoJSON. Install the page as an app on a
phone.

Everything runs in your browser. There is no account, no key and no server
of its own: the page fetches each layer from its provider as you look at it.

## Privacy

Drawings stay in your browser and are never sent anywhere. The page keeps
its own files in your browser too, so that it opens without a connection, and
so are the areas you save for use without one. Tile requests
necessarily tell each provider which area you are looking at; a hidden layer
makes no request. Place names you type go to the search provider as you type,
with the map's centre to a tenth of a degree; coordinates are read in the
page. Your location, when you show it, stays in
the page. The About dialog in the page says the same, and each layer's ⓘ
names its provider.

## Hosting a copy

The page is static: the `site/` folder can be served by any web server, with
no build and nothing to install. What a copy inherits, what it must provide
itself, and how to set it up: [docs/development.md](docs/development.md).

## More

- [docs/architecture.md](docs/architecture.md): how the code is shaped, and why.
- [docs/drawing-ui.md](docs/drawing-ui.md) and
  [docs/drawing-format.md](docs/drawing-format.md): the drawing tools and
  their file.
- [docs/takeaways.md](docs/takeaways.md): what was learned the hard way.
- [ROADMAP.md](ROADMAP.md): what is open, what to research, what is not planned.

## Licence

The code is under GPL-3.0-or-later; see `LICENSE`. The libraries in
`site/vendor/` keep their own licences, copied beside them. Map data and
imagery stay under their providers' licences.
