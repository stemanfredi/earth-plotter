// Esri World Imagery with the visitor's own key (docs/esri-key.md). Esri's terms ask for an ArcGIS
// account, so the page shows its imagery only with a key the visitor brings, checked here first:
// Esri's tile host does not check keys (any key, even a wrong one, gets tiles), so the page asks the
// Basemap Styles service, which checks the key, its basemaps privilege and its referrers. Only a key
// Esri accepted is kept, in this browser. It and the tile requests go to Esri with the page's origin
// as the referrer (Esri reads a key's allowed sites from the Referer header).
import { HOSTS } from './hosts.js';
import { h, store } from './dom.js';
import { note } from './menu.js';

const KEY = 'earthplotter.esri'; // { key, checked: ms }: a key Esri accepted
export const ESRI_TILES = `${HOSTS.esriTiles}/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`;
const ESRI_CHECK = `${HOSTS.esriStyles}/arcgis/rest/services/styles/v2/styles/arcgis/imagery`;
export const ESRI_DOC = 'https://github.com/stemanfredi/earth-plotter/blob/main/docs/esri-key.md';
// Esri asks for "Powered by Esri" and its data providers, always on screen (its text of 2026-11-09)
export const ESRI_CREDIT = 'Powered by <a href="https://www.esri.com">Esri</a> · Source: Esri, Vantor, Earthstar Geographics, and the GIS User Community';
const REFUSED = [401, 403, 498, 499]; // 498 Token Invalid, 499 Token Required: sent with HTTP 200 too
const withKey = (url, key) => `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(key)}`;

// the key this browser holds, as Esri accepted it, or null
export function held() {
  const v = store.json(KEY);
  return v && typeof v.key === 'string' && v.key ? v : null;
}
export const usable = () => !!held();
export const forget = () => store.remove(KEY);
const keep = (key) => store.set(KEY, JSON.stringify({ key, checked: Date.now() })); // false: this browser keeps nothing

// Esri's answer for key, asked from this page: 'ok', or 'refused' (a wrong or expired key, one
// without the basemaps privilege, or one not allowed on this site); throws when Esri cannot be
// asked (no connection, no answer in 15 s, a fault of its own)
export async function ask(key, fetchFn = fetch) {
  const r = await fetchFn(withKey(ESRI_CHECK, key), { credentials: 'omit', referrerPolicy: 'strict-origin', signal: AbortSignal.timeout(15000) });
  let body = null;
  try { body = await r.json(); } catch { /* not JSON */ }
  if (REFUSED.includes(body?.error?.code ?? r.status)) return 'refused';
  if (r.ok && body?.version === 8) return 'ok'; // a style: the key works here
  throw new Error(`Esri answered ${body?.error?.code ? `error ${body.error.code}` : `HTTP ${r.status}`}`);
}
// key asked about, and kept once Esri accepts it; the answer
export async function use(key, fetchFn) {
  const state = await ask(key, fetchFn);
  if (state === 'ok' && !keep(key)) throw new Error('this browser keeps nothing');
  return state;
}
// the key held asked about again (once a start, when Esri's imagery is first shown): a key expired
// or revoked is forgotten; Esri out of reach, or another key kept meanwhile, changes nothing. The
// answer: 'ok', 'refused', or null (no key, or nothing learnt)
export async function recheck(fetchFn) {
  const was = held();
  if (!was) return null;
  let state;
  try { state = await ask(was.key, fetchFn); } catch { return null; }
  if (held()?.key !== was.key) return null;
  if (state === 'ok') keep(was.key); else forget();
  return state;
}
// what MapLibre asks of Esri's tile host: with the key and the page's origin, once a key is accepted;
// null for any other address (app.js asks those with no referrer)
export function request(url) {
  if (!url.startsWith(`${HOSTS.esriTiles}/`)) return null;
  const k = held();
  return k ? { url: withKey(url, k.key), referrerPolicy: 'strict-origin' } : { url, referrerPolicy: 'no-referrer' };
}

// The key's panel, under Satellite's choice while Esri's is chosen: what is needed and the field, or
// the key in use and its Remove. fallback names what is drawn without a key; onChange: a key
// accepted or forgotten, the map to draw again.
export function keyBox({ fallback, onChange }) {
  const el = h('div', { class: 'keybox', hidden: true });
  const field = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Your ArcGIS key', placeholder: 'Paste your ArcGIS key',
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } } }); // kept across renders: a failed check keeps what was pasted
  let busy = false, said = '', asked = false; // an answer awaited; what the last one said; the key held asked about this start
  const submit = () => { const key = field.value.trim(); if (key && !busy) check(key); };
  async function check(key) {
    busy = true; said = ''; render();
    try {
      if (await use(key) === 'ok') field.value = '';
      else said = 'Esri did not accept the key: wrong, expired, without the Basemaps privilege, or not allowed on this site.';
    } catch (e) {
      said = /keeps nothing/.test(e.message) ? 'Esri accepted the key, but this browser keeps nothing (a private window, or storage blocked).'
        : `Esri could not be asked (${e.message}): try again.`;
    }
    busy = false;
    render(); onChange();
  }
  function remove() { forget(); said = ''; render(); onChange(); }
  function render() {
    if (el.hidden) return;
    const k = held(), here = location.origin;
    el.replaceChildren(...[
      h('p', { class: 'note', role: 'status' }, k ? `Your key is in use, as Esri accepted it on ${new Date(k.checked).toLocaleDateString()}.`
        : `${said || 'Esri\'s imagery needs your own free ArcGIS key.'} Showing ${fallback} until Esri accepts one.`),
      k ? h('div', { class: 'keyrow' }, h('button', { type: 'button', class: 'small', onclick: remove }, 'Remove key'))
        : h('div', { class: 'keyrow' }, field, h('button', { type: 'button', class: 'small', disabled: busy, onclick: submit }, busy ? 'Checking…' : 'Use')),
      k ? null : h('p', { class: 'note' }, 'The key\'s referrers must include ', h('code', {}, here), ' ',
        h('button', { type: 'button', class: 'small link', onclick: () => navigator.clipboard?.writeText(here).then(() => note(`${here} copied`), () => {}) }, 'Copy')),
      h('p', { class: 'note' }, 'The key stays in this browser; it and the imagery requests go to Esri. ',
        h('a', { href: ESRI_DOC, target: '_blank', rel: 'noopener' }, 'How to get a key'))].filter(Boolean));
  }
  return {
    el,
    // shown (Esri's imagery chosen) or not; the first time, the key held asked about again
    async show(on) {
      el.hidden = !on;
      render();
      if (!on || asked) return;
      asked = true;
      if (await recheck() === 'refused') { said = 'Esri no longer accepts the key kept: it is forgotten.'; render(); onChange(); }
    },
  };
}
