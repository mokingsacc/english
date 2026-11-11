// The Checks tab of the Panorama window: one row per check with its status icon, title, value, limit, the plain-word
// explanation and the fix; a caret opens the per-leg lines. Clicking a row zooms to the check's `where` and highlights
// it in the drawing. Rows are kept by check id and only changed cells are written, so it can follow a grip drag live.
import { h, ico, setText, setClass, keyed, whole, STATUS_WORD } from './dom.js';

export function fmtCheckValue(v, unit) {
  if (v === null || v === undefined) return '-';
  if (typeof v !== 'number') return String(v);
  if (unit === 'sq ft') return `${whole(v)} sq ft`;
  if (unit === 'problems') return v === 0 ? 'none' : `${v} problem${v === 1 ? '' : 's'}`;
  if (unit === 'ft') return `${whole(v)} ft`;
  return `${v.toFixed(1)}${unit ? ` ${unit}` : ''}`;
}

export function createChecksView(app, body) {
  const head = h('div', { class: 'ck-row ck-head', role: 'row' },
    h('span', { class: 'ck-s', text: '' }), h('span', { class: 'ck-t', text: 'Check' }), h('span', { class: 'ck-v', text: 'Value' }),
    h('span', { class: 'ck-l', text: 'Limit' }), h('span', { class: 'ck-e', text: 'What it means' }), h('span', { class: 'ck-f', text: 'What to do' }));
  const list = h('div', { class: 'ck-list', role: 'rowgroup' });
  const banner = h('div', { class: 'ck-banner', hidden: true });
  body.append(banner, h('div', { class: 'ck-table', role: 'grid', 'aria-label': 'Checks' }, head, list));
  const openRows = new Set();

  function make(c) {
    const caret = h('button', { type: 'button', class: 'ck-caret', 'aria-label': 'Show the lines for each leg' });
    const s = h('span', { class: 'ck-s' }, caret, h('span', { class: 'ck-icon' }));
    const row = h('div', { class: 'ck-row', role: 'row', tabindex: '0', 'data-check': c.id }, s,
      h('span', { class: 'ck-t' }), h('span', { class: 'ck-v' }), h('span', { class: 'ck-l' }), h('span', { class: 'ck-e' }), h('span', { class: 'ck-f' }));
    const items = h('div', { class: 'ck-items', hidden: true });
    const wrap = h('div', { class: 'ck-wrap' }, row, items);
    wrap.__p = { row, items, caret, icon: s.querySelector('.ck-icon'), cells: [...row.children].slice(1) };
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
    setText(v, fmtCheckValue(c.value, c.unit));
    setText(l, c.limit === null || c.limit === undefined ? '-' : fmtCheckValue(c.limit, c.unit === 'problems' ? 'problems' : c.unit));
    setText(e, c.explain);
    setText(f, c.fix || '');
    setClass(p.row, `st-${c.status}`, true);
    for (const s of ['pass', 'warn', 'fail', 'info']) if (s !== c.status) setClass(p.row, `st-${s}`, false);
    const focus = app.store.get().focusCheck;
    setClass(p.row, 'focus', !!focus && focus.id === c.id);
    const isOpen = openRows.has(c.id) && c.items.length > 0;
    p.items.hidden = !isOpen;
    if (p.caret.__n !== `${isOpen}${c.items.length > 0}`) {
      p.caret.__n = `${isOpen}${c.items.length > 0}`;
      p.caret.innerHTML = '';
      if (c.items.length) p.caret.append(ico(isOpen ? 'caretDown' : 'caretRight', 16));
      p.caret.disabled = !c.items.length;
    }
    if (isOpen) {
      keyed(p.items, c.items.map((it, i) => ({ ...it, k: `${i}` })), (it) => it.k,
        () => h('div', { class: 'ck-item' }, h('span', { class: 'ck-icon' }), h('span', { class: 'ck-it' })),
        (el, it) => {
          const ic = el.firstChild;
          if (ic.__n !== it.status) { ic.__n = it.status; ic.innerHTML = ''; ic.append(ico(it.status || 'info', 16)); }
          setText(el.lastChild, it.text);
        });
    }
  }

  return {
    update(result) {
      if (!result) return;
      banner.hidden = result.ok;
      if (!result.ok) setText(banner, `The shape cannot be built: ${result.problems[0] || ''} The drawing shows the last shape that could be built, dimmed.`);
      keyed(list, result.checks, (c) => c.id, make, update);
    },
  };
}
