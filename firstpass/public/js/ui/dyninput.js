// Dynamic input: the small box by the cursor while a grip is dragged, showing the value being changed (its label from
// the parameters table) in a field she can type into. Enter takes the typed value, Tab moves to the next field (the
// centre grip has easting and northing), Esc puts the value back. A radius shows as it is built; when the radius asked
// for and the one built differ, a line under the field says both ("asked 250.00 ft, built 132.00 ft"). The box stays
// inside the drawing: near an edge it goes to the other side of the cursor (its size is measured when it opens and when
// the note shows or goes, never on every move).
import { h, setText } from './dom.js';

export function createDynInput(app, host) {
  const box = h('div', { class: 'dyn', hidden: true, role: 'group', 'aria-label': 'Dynamic input' });
  host.append(box);
  let fields = [], active = 0, typed = false, spec = null, noteEl = null;
  let bw = 0, bh = 0;   // the box's size, measured when it opens and when the note shows or goes
  const measure = () => { bw = box.offsetWidth; bh = box.offsetHeight; };
  const EDGE = 8;

  function open(s) {
    spec = s;
    box.textContent = '';
    fields = s.fields.map((f, i) => {
      const input = h('input', { type: 'text', class: 'dyn-in', 'aria-label': f.label, value: f.text });
      input.addEventListener('keydown', (e) => key(e));
      input.addEventListener('focus', () => { active = i; });
      const row = h('label', { class: 'dyn-row' }, h('span', { class: 'dyn-label', text: f.label }), input, h('span', { class: 'dyn-unit', text: f.unit || '' }));
      box.append(row);
      return { input, f };
    });
    noteEl = h('div', { class: 'dyn-note', hidden: true, role: 'status' });
    box.append(noteEl, h('div', { class: 'dyn-hint', text: 'Type a value, then Enter. Tab for the next field, Esc to put it back.' }));
    active = 0; typed = false;
    box.hidden = false;
    measure();
  }

  function key(e) {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); app.cancelDrag(); }
    else if (e.key === 'Tab') { e.preventDefault(); active = (active + 1) % fields.length; fields[active].input.focus(); fields[active].input.select(); }
    else typed = true;
  }

  function commit() {
    const vals = fields.map(({ input }) => Number(String(input.value).replace(/\s*(ft|mph|degrees?|deg)\s*$/i, '')));
    if (vals.some((v) => !Number.isFinite(v))) { app.echo('Type a number in each field.', 'error'); return; }
    spec.onEnter(vals);
  }

  return {
    open,
    close() { box.hidden = true; spec = null; fields = []; if (box.contains(document.activeElement)) document.activeElement.blur(); },
    isOpen: () => !box.hidden,
    /** A key typed during the drag goes into the box: the first key replaces the value, as in the CAD original. */
    typeKey(ch) {
      if (!fields.length) return false;
      const input = fields[active].input;
      input.focus();
      if (!typed) { input.value = ''; typed = true; }
      input.value += ch;
      return true;
    },
    /** Move the box beside the cursor and show the values and the note, { values, note } (not while she is typing into
     * it); null keeps what is shown. */
    place(sx, sy, shown) {
      if (box.hidden) return;
      if (shown && !typed) {
        fields.forEach(({ input }, i) => { if (shown.values[i] !== undefined && input.value !== shown.values[i]) input.value = shown.values[i]; });
        if (noteEl) {
          setText(noteEl, shown.note || '');
          if (noteEl.hidden !== !shown.note) { noteEl.hidden = !shown.note; measure(); }
        }
      }
      const W = app.camera.w, H = app.camera.h;
      let x = sx + 20, y = sy + 22;
      if (x + bw > W - EDGE) x = sx - 20 - bw;
      if (y + bh > H - EDGE) y = sy - 22 - bh;
      x = Math.max(EDGE, Math.min(W - bw - EDGE, x));
      y = Math.max(EDGE, Math.min(H - bh - EDGE, y));
      box.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    },
    typing: () => typed,
  };
}
