// What the site's modules expect of a browser, for the unit tests (npm test: node --import this):
// GeographicLib as the page loads it (a global), and the two globals a module touches at load.
import { createRequire } from 'node:module';

globalThis.geodesic = createRequire(import.meta.url)('geographiclib-geodesic');
globalThis.window ??= { addEventListener() {}, URL }; // URL: maplibre-contour makes its worker's blob URL at load
globalThis.document ??= { addEventListener() {}, visibilityState: 'visible' };
