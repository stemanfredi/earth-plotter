// Esri World Imagery with the visitor's own key (docs/esri-key.md). Esri's terms ask for an ArcGIS
// account, so the page shows its imagery only with a key the visitor brings, checked here first:
// Esri's tile host does not check keys (any key, even a wrong one, gets tiles), so the page asks the
// Basemap Styles service, which checks the key, its basemaps privilege and its referrers. The key
// stays in this browser. It and the tile requests go to Esri with the page's origin as the
// referrer (Esri reads a key's allowed sites from the Referer header); every other host gets none.
import { HOSTS } from './hosts.js';
import { store } from './dom.js';
import { escapeHtml } from './format.js';

const KEY = 'earthplotter.esri'; // { key, state: 'ok' | 'refused', checked: ms }
export const ESRI_TILES = `${HOSTS.esriTiles}/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`;
const ESRI_META = `${HOSTS.esriTiles}/arcgis/rest/services/World_Imagery/MapServer?f=json`;
const ESRI_CHECK = `${HOSTS.esriStyles}/arcgis/rest/services/styles/v2/styles/arcgis/imagery`;
export const ESRI_DOC = 'https://github.com/stemanfredi/earth-plotter/blob/main/docs/esri-key.md';
// Esri asks for "Powered by Esri" and its data providers, always on screen: the service's own text
// once the key is checked (credit), this one (2026-11-09) until then
export const esriAttribution = (text) => `Powered by <a href="https://www.esri.com">Esri</a> · ${escapeHtml(text)}`;
export const ESRI_CREDIT = esriAttribution('Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community');
const ESRI_FETCH = { credentials: 'omit', referrerPolicy: 'strict-origin' };
const withKey = (url, key) => `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(key)}`;

// the key this browser holds, with Esri's last answer, or null
export function held() {
  const v = store.json(KEY);
  return v && typeof v.key === 'string' && v.key && (v.state === 'ok' || v.state === 'refused') ? v : null;
}
export const usable = () => held()?.state === 'ok';
export const forget = () => store.remove(KEY);

// Esri's answer for key, asked from this page: 'ok', or 'refused' (a wrong or expired key, one
// without the basemaps privilege, or one not allowed on this site); throws when Esri cannot be
// asked (no connection, an answer that is neither)
export async function ask(key, fetchFn = fetch) {
  const r = await fetchFn(withKey(ESRI_CHECK, key), ESRI_FETCH);
  let body = null;
  try { body = await r.json(); } catch { /* not JSON */ }
  if (body?.error || [401, 403, 498, 499].includes(r.status)) return 'refused'; // 498 Token Invalid: sent with HTTP 200 too
  if (r.ok && body?.version === 8) return 'ok'; // a style: the key works here
  throw new Error(`Esri answered HTTP ${r.status}`);
}
// key asked about and kept with Esri's answer (one that cannot be asked is not kept); the answer
export async function use(key, fetchFn) {
  const state = await ask(key, fetchFn);
  store.set(KEY, JSON.stringify({ key, state, checked: Date.now() }));
  return state;
}
// the key held asked about again (each time the page starts with Esri's imagery, and when it is
// chosen: an expired or revoked key stops being used); Esri out of reach keeps the last answer
export async function recheck(fetchFn) {
  const h = held();
  if (!h) return null;
  try { return await use(h.key, fetchFn); } catch { return h.state; }
}
// what MapLibre asks for: Esri's tiles with the key, once Esri accepted it, and the page's origin
// as the referrer; every other address as it is, with no referrer
export function request(url) {
  if (!url.startsWith(`${HOSTS.esriTiles}/`)) return { url, referrerPolicy: 'no-referrer' };
  const h = held();
  return { url: h?.state === 'ok' ? withKey(url, h.key) : url, referrerPolicy: 'strict-origin' };
}
// Esri's credit text of the moment (its providers get renamed), asked with the key; null when there
// is no accepted key or no answer
export async function credit(fetchFn = fetch) {
  const h = held();
  if (h?.state !== 'ok') return null;
  try {
    const text = (await (await fetchFn(withKey(ESRI_META, h.key), ESRI_FETCH)).json()).copyrightText;
    return typeof text === 'string' && text ? esriAttribution(text) : null;
  } catch { return null; }
}
