// The drawing's tools (docs/drawing-ui.md §1, §2): what makes elements is chosen in Draw
// (drawtab.js); the bar holds Undo, Redo, Select, Box select and Measure; the touch row over the map's
// foot (with a finger). On a phone Undo, Redo, Box select and Measure are the dock, the bar along the
// bottom, with Back, what is being drawn and Done while a tool is on. A tool's key (P, G, S, T, M)
// turns it on with what it drew last, or off (app.js).

import { h, NARROW } from '../dom.js';
import { keyOf, MOD } from '../keys.js';
import { icon, SELECT_ICON, BOX_ICON, UI_ICON } from '../icons.js';

// drawing (drawing.js); ctx: { bar, frame, props, foot (the map's foot's left stack: the touch row goes
// there), dock (a phone's bar along the bottom) }; del(ids): delete, asked first (the touch row's);
// fileBtns: the bar's file group (files.js); drawsNow(): the name of what is being drawn (drawtab.js),
// or ''. Returns { press, renderTools, renderTouch }.
export function createTools(drawing, ctx, { del, fileBtns, drawsNow }) {
  // a tool's key: on (with what it drew last), or off; Box select's too
  const press = (tool) => (tool === 'box' ? drawing.boxSelect(!drawing.boxNext) : drawing.button === tool ? drawing.stop() : drawing.start(tool));
  // Measure: a question asked of the map, not a thing drawn: the bar's
  const measureBtn = h('button', { type: 'button', 'data-tool': 'measure', 'aria-pressed': 'false', 'aria-label': 'Measure', title: `Measure (${keyOf('measure')})`, onclick: () => press('measure') }, icon(...UI_ICON.ruler));
  const undoBtn = h('button', { type: 'button', class: 'urbtn', 'aria-label': 'Undo', title: `Undo (${MOD} Z)`, onclick: () => drawing.undo() }, icon(...UI_ICON.undo));
  const redoBtn = h('button', { type: 'button', class: 'urbtn', 'aria-label': 'Redo', title: `Redo (${MOD} Shift Z)`, onclick: () => drawing.redo() }, icon(...UI_ICON.redo));
  const sep = () => h('span', { class: 'tsep', 'aria-hidden': 'true' });
  // Select
  const selectBtn = h('button', { type: 'button', class: 'selbtn', 'aria-label': 'Select', title: 'Select',
    onclick: () => drawing.leave() }, icon(...SELECT_ICON));
  // Select's other kind: the next drag on the map draws a box, what lies inside selected; then Select
  const boxBtn = h('button', { type: 'button', class: 'boxbtn', 'aria-label': 'Box select', 'aria-pressed': 'false', title: `Box select (${keyOf('box')})`,
    onclick: () => press('box') }, icon(...BOX_ICON));
  // With a finger (drawing-ui.md §1): what keys and a mouse do on a computer, each shown when it
  // applies. Back steps back one level (what is half drawn, else the tool, else the selection). On a
  // phone Back and Done are the dock's, what is being drawn between them; the selection's actions are
  // its sheet's head (frame.js). A finger always snaps (a place near something, not on it: zoomed in,
  // the 16 px are less)
  const touchBtn = (text, title, run) => h('button', { type: 'button', title, onclick: run }, text);
  const touch = {
    done: touchBtn('Done', 'End the line or measurement being drawn (Enter, or a double-click)', () => drawing.finish()),
    back: touchBtn('Back', 'Back one step: what is half drawn, else the tool, else the selection (Esc)', () => drawing.back()),
    del: touchBtn('Delete', 'Delete the selection (Delete)', () => del([...drawing.sel])),
    dup: touchBtn('Duplicate', `A copy of the selection beside it (${MOD} D)`, () => drawing.duplicate()),
  };
  touch.done.classList.add('done');
  const nowName = h('span', { class: 'drawsnow', 'aria-live': 'polite' }); // a phone's dock: what is being drawn
  const touchbar = h('div', { class: 'touchbar', role: 'group', 'aria-label': 'Actions' });
  ctx.foot.append(touchbar); // the map's foot, under the legends
  function renderTouch() {
    const sel = drawing.sel.size > 0, tool = !!drawing.tool, phone = NARROW.matches;
    touch.done.hidden = !(['line', 'measure'].includes(drawing.tool) && drawing.draft);
    touch.back.hidden = !tool; // a tap on the map clears the selection
    touch.del.hidden = touch.dup.hidden = !sel || tool || !ctx.props.hidden; // Properties' head has them while it is shown
    const measuring = drawing.button === 'measure';
    nowName.textContent = tool && !measuring ? drawsNow() : '';
    nowName.hidden = !phone || !tool || measuring;
    boxBtn.hidden = phone && tool; // a phone, while drawing: Back, Undo, Redo, what is drawn (Measure's own button), Done
    measureBtn.hidden = phone && tool && !measuring;
    touchbar.hidden = phone || [touch.done, touch.back, touch.del, touch.dup].every((b) => b.hidden);
    undoBtn.disabled = !drawing.undos.length && !drawing.draft; // half drawn: Undo takes back a point (a phone has no Backspace)
    redoBtn.disabled = !drawing.redos.length;
  }
  // The bar (drawing-ui.md §1): the file group (files.js); Layers, Elements and Draw (the left
  // panel's tabs); Undo, Redo (history); Select and Box select; Measure; at its end Properties' toggle
  // (app.js puts find a place before it)
  const historySep = sep(), measureSep = sep();
  ctx.bar.replaceChildren(...fileBtns, sep(), ...ctx.frame.tabBtns, historySep, undoBtn, redoBtn, sep(), selectBtn, boxBtn, measureSep, measureBtn, h('span', { class: 'grow' }), ctx.frame.rightBtn);
  // a phone: the dock (Back, Undo, Redo, Box select, Measure, what is drawn, Done); else the bar, Back and Done in the touch row
  function placeTools() {
    if (NARROW.matches) ctx.dock.replaceChildren(touch.back, undoBtn, redoBtn, boxBtn, measureBtn, nowName, touch.done);
    else {
      historySep.after(undoBtn, redoBtn);
      selectBtn.after(boxBtn);
      measureSep.after(measureBtn);
      touchbar.replaceChildren(...Object.values(touch));
    }
    renderTouch();
  }
  NARROW.addEventListener?.('change', placeTools);
  placeTools();
  function renderTools() {
    const on = drawing.button;
    selectBtn.setAttribute('aria-pressed', String(!on && !drawing.boxNext));
    boxBtn.setAttribute('aria-pressed', String(!!drawing.boxNext));
    measureBtn.setAttribute('aria-pressed', String(on === 'measure'));
    renderTouch();
  }
  return { press, renderTools, renderTouch };
}
