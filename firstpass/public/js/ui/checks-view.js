// The Checks tab of the Panorama window: one row per check with its status icon, title, value, limit, the plain-word
// explanation and the fix; the engine's notes (warnings and information, such as a corner built tighter or an island
// built longer) show under their row; a caret opens every line. Clicking a row zooms to the check's `where` and
// highlights it in the drawing. Rows are kept by check id and only changed cells are written, so it follows a drag live.
import { h, ico, setText, setAttr, setClass, keyed, whole, STATUS_WORD } from './dom.js';

export function fmtCheckValue(v, unit, isLimit = false, places = 1) {
  if (v === null || v === undefined) return '-';
  if (typeof v !== 'number') return String(v);
  if (unit === 'sq ft') return `${whole(v)} sq ft`;
  if (unit === 'problems') return isLimit ? '' : v === 0 ? 'No problems' : `${v} problem${v === 1 ? '' : 's'}`;
  if (unit === 'ft') return `${whole(v)} ft`;
  return `${v.toFixed(places)}${unit ? ` ${unit}` : ''}`;
}

/** The value and limit as written in a row; the value gets another decimal when the two would read the same but differ. */
export function valueAndLimit(c) {
  const lim = c.limit === null || c.limit === undefined ? (c.unit === 'problems' ? '' : '-') : fmtCheckValue(c.limit, c.unit, true);
  let val = fmtCheckValue(c.value, c.unit);
  if (val === lim && typeof c.value === 'number' && c.value !== c.limit) val = fmtCheckValue(c.value, c.unit, false, 2);
  return [val, lim];
}

/** A check's notes: its warning and information lines, shown without opening it (not for a check that only informs). */
export function checkNotes(c) {
  if (!c || c.status === 'info' || !Array.isArray(c.items)) return [];
  return c.items.filter((it) => it.status === 'warn' || it.status === 'info');
}

function itemRows(box, list) {
  keyed(box, list.map((it, i) => ({ ...it, k: `${i}` })), (it) => it.k,
    () => h('div', { class: 'ck-item' }, h('span', { class: 'ck-icon' }), h('span', { class: 'ck-it' })),
    (el, it) => {
      const ic = el.firstChild;
      if (ic.__n !== it.status) { ic.__n = it.status; ic.innerHTML = ''; ic.append(ico(it.status || 'info', 16)); ic.title = STATUS_WORD[it.status || 'info'] || ''; }
      setText(el.lastChild, it.text);
      setAttr(el.lastChild, 'title', it.text);
    });
}

export function createChecksView(app, body) {
  const head = h('div', { class: 'ck-row ck-head', role: 'row' },
    h('span', { class: 'ck-s', text: '' }), h('span', { class: 'ck-t', text: 'Check' }), h('span', { class: 'ck-v', text: 'Value' }),
    h('span', { class: 'ck-l', text: 'Limit' }), h('span', { class: 'ck-e', text: 'What it means' }), h('span', { class: 'ck-f', text: 'What to do' }));
  const list = h('div', { class: 'ck-list', role: 'rowgroup' });
  const banner = h('div', { class: 'ck-banner', hidden: true });
  body.append(banner, h('div', { class: 'ck-table', role: 'grid', 'aria-label': 'Checks' }, head, list));
  const openRows = new Set();
  let lastFails = new Set();

  function make(c) {
    const caret = h('button', { type: 'button', class: 'ck-caret', 'aria-label': 'Show the lines for each leg' });
    const s = h('span', { class: 'ck-s' }, caret, h('span', { class: 'ck-icon' }));
    const row = h('div', { class: 'ck-row', role: 'row', tabindex: '0', 'data-check': c.id }, s,
      h('span', { class: 'ck-t' }), h('span', { class: 'ck-v' }), h('span', { class: 'ck-l' }), h('span', { class: 'ck-e' }), h('span', { class: 'ck-f' }));
    const notes = h('div', { class: 'ck-items ck-notes', hidden: true });
    const items = h('div', { class: 'ck-items', hidden: true });
    const wrap = h('div', { class: 'ck-wrap' }, row, notes, items);
    wrap.__p = { row, notes, items, caret, icon: s.querySelector('.ck-icon'), cells: [...row.children].slice(1) };
    caret.addEventListener('click', (e) => { e.stopPropagation(); if (openRows.has(c.id)) openRows.delete(c.id); else openRows.add(c.id); app.request('panels'); });
    row.addEventListener('click', () => app.focusCheck(c.id, true));
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter') app.focusCheck(c.id, true); });
    return wrap;
  }

  function update(wrap, c) {
    const p = wrap.__p;
    if (p.icon.__n !== c.status) { p.icon.__n = c.status; p.icon.innerHTML = ''; p.icon.append(ico(c.status, 16)); p.icon.title = STATUS_WORD[c.status]; }
    const [t, v, l, e, f] = p.cells;
    setText(t, c.title);
    const [vt, lt] = valueAndLimit(c);
    setText(v, vt);
    setClass(v, 'calm', c.unit === 'problems' && c.value === 0);   // "No problems" is not coloured as a warning
    setText(l, lt);
    // One line each, as a table; the whole text shows on the chosen row and when the pointer rests on it.
    setText(e, c.explain); setAttr(e, 'title', c.explain || null);
    setText(f, c.fix || ''); setAttr(f, 'title', c.fix || null);
    setClass(p.row, `st-${c.status}`, true);
    for (const s of ['pass', 'warn', 'fail', 'info']) if (s !== c.status) setClass(p.row, `st-${s}`, false);
    const focus = app.store.get().focusCheck;
    setClass(p.row, 'focus', !!focus && focus.id === c.id);
    const isOpen = openRows.has(c.id) && c.items.length > 0;
    p.items.hidden = !isOpen;
    const notes = isOpen ? [] : checkNotes(c);
    p.notes.hidden = !notes.length;
    if (notes.length) itemRows(p.notes, notes);
    if (p.caret.__n !== `${isOpen}${c.items.length > 0}`) {
      p.caret.__n = `${isOpen}${c.items.length > 0}`;
      p.caret.innerHTML = '';
      if (c.items.length) p.caret.append(ico(isOpen ? 'caretDown' : 'caretRight', 16));
      p.caret.disabled = !c.items.length;
    }
    if (isOpen) itemRows(p.items, c.items);
  }

  return {
    update(result) {
      if (!result) return;
      banner.hidden = result.ok;
      if (!result.ok) setText(banner, `The shape cannot be built: ${result.problems[0] || ''} The drawing shows the last shape that could be built, dimmed.`);
      keyed(list, result.checks, (c) => c.id, make, update);
      // A check that has just turned red is brought into view (a drag can turn one red below the rows on show).
      const fails = new Set(result.checks.filter((c) => c.status === 'fail').map((c) => c.id));
      const fresh = [...fails].find((id) => !lastFails.has(id));
      lastFails = fails;
      if (fresh) {
        const row = list.querySelector(`.ck-row[data-check="${fresh}"]`);
        const box = body.closest('.pano-body') || body;
        if (row && box.getBoundingClientRect) {
          const r = row.getBoundingClientRect(), b = box.getBoundingClientRect();
          if (r.top < b.top + 22 || r.bottom > b.bottom) box.scrollTop += r.top - b.top - 22;   // below the column heads
        }
      }
    },
  };
}
