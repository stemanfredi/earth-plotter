// The inspector's rows (docs/drawing-ui.md §5), as Properties builds them (panel.js, lineview.js,
// forms.js): pure builders of elements, no state of the drawing.

import { h } from '../dom.js';
import { note } from '../menu.js';
import { rowsText, plural } from '../format.js';

// A value grid's row: its label, its cell (one value or a pair, at most one small button after it:
// never wrapping) and its last column, kept for a trailing × or ↺ so nothing shifts when one appears.
// Without a label and with buttons only: an action row, which may wrap.
const isX = (k) => k?.tagName === 'BUTTON' && k.classList.contains('x');
export const row = (text, ...kids) => {
  kids = kids.flat().filter(Boolean);
  const last = isX(kids.at(-1)) ? kids.pop() : null;
  if (!text && kids.length && kids.every((k) => k.tagName === 'BUTTON')) return h('div', { class: 'frow' }, ...kids, last);
  return h('div', { class: 'frow vrow' }, h('span', { class: 'flabel' }, text), h('div', { class: 'vcell' }, ...kids), h('span', { class: 'vlast' }, last));
};
// two fields read as one value, side by side (a pair, §2), sep between them
export const pair = (a, sep, b) => h('span', { class: 'vpair' }, ...[a].flat(), h('span', { class: 'vsep' }, sep), ...[b].flat());
// a value's unit beside it, in grey (§5: never inside the text): a distance field's (fields.js
// unitText), or a formatted value's ("10.08 km" → 10.08 · km)
export const funit = (t) => h('span', { class: 'funit' }, t);
export const withUnit = (input) => [input, funit(input.unitText())];
export const fvalue = (t, attrs = {}) => h('span', { class: 'fvalue', ...attrs }, t);
export const valued = (text, attrs = {}) => { const i = text.lastIndexOf(' '); return i < 0 ? [fvalue(text, attrs)] : [fvalue(text.slice(0, i), attrs), funit(text.slice(i + 1))]; };
// the row of what can be done to it (one place, before Look): the rule's Edit… and Select all, then its own
export const actionsRow = (...btns) => { btns = btns.flat().filter(Boolean); return btns.length ? row('', ...btns) : null; };
// a row action's button, in a list grid's bar
export const act = (text, title, onclick, disabled = false) => h('button', { type: 'button', class: 'small', title, disabled, onclick }, text);
// a list's Copy: its rows (rows(): [head, rows]) as text a spreadsheet takes, every column
export const copyBtn = (rows) => h('button', { type: 'button', class: 'small', title: 'For a spreadsheet', onclick: () => {
  const [head, body] = rows();
  navigator.clipboard?.writeText(rowsText(head, body)).then(() => note(`${plural(body.length, 'row')} copied`), () => note('This browser did not let them be copied'));
} }, 'Copy');
// A folding section's head (drawing-ui.md §5: every section folds), as a group's in Layers:
// the whole head folds it (its title a button, for keys), its fold mark first (style.css); extras: buttons
// after the title (Copy, +). data-key: its state, so that morph never keeps a head whose click
// would toggle from the state it was made in
export const foldHead = (title, open, toggle, ...extras) => h('h3', { class: open ? 'folds open' : 'folds', 'data-key': open ? 'open' : 'folded', onclick: (e) => { if (!e.target.closest('.hbtns, .hfold')) toggle(); } },
  h('button', { type: 'button', class: 'hfold', 'aria-expanded': String(open), onclick: toggle }, title), // named by its title, open or not
  h('span', { class: 'hbtns' }, ...extras.flat().filter(Boolean)));
// a long list's page (drawing-ui.md §5): rows shown at a time
export const PAGE = 100;
