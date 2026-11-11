// Dynamic input: the small box by the cursor while a grip is dragged, showing the value being changed (its label from
// the parameters table) in a field she can type into. Enter takes the typed value, Tab moves to the next field (the
// centre grip has easting and northing), Esc puts the value back. It also carries the problem sentence when the shape
// cannot be built.
import { h, setText } from './dom.js';

export function createDynInput(app, host) {
  const box = h('div', { class: 'dyn', hidden: true, role: 'group', 'aria-label': 'Dynamic input' });
  host.append(box);
  let fields = [], active = 0, typed = false, spec = null;

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
    box.append(h('div', { class: 'dyn-hint', text: 'Type a value, then Enter. Tab for the next field, Esc to put it back.' }));
    active = 0; typed = false;
    box.hidden = false;
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
    /** Move the box beside the cursor and show the values (not while she is typing into it). */
    place(sx, sy, values) {
      if (box.hidden) return;
      box.style.transform = `translate(${Math.round(sx + 20)}px, ${Math.round(sy + 22)}px)`;
      if (!typed) fields.forEach(({ input }, i) => { if (values[i] !== undefined && input.value !== values[i]) input.value = values[i]; });
    },
    typing: () => typed,
    setLabel(t) { void setText; void t; },
  };
}
