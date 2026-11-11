// The Compare tab of the Panorama window: the options as columns, one row per headline value and per check, the best
// value in each row marked. Clicking a column header puts that option on screen. Each option is worked out once and
// kept (app/evaluator.js), and the option on screen follows a grip drag live. A new row: one entry in ROWS.
import { h, setText, setClass, whole, STATUS_WORD } from './dom.js';
import { fmtCheckValue } from './checks-view.js';

const RANK = { pass: 0, info: 1, warn: 2, fail: 3 };

// value(result) -> number or null; better: 'low' or 'high' marks the best; show(v) the text.
const ROWS = [
  { key: 'entry', label: 'Fastest entry', better: 'low', value: (r) => (r.ok && r.headline.worstEntrySpeed ? r.headline.worstEntrySpeed.value : null), show: (v) => `${v.toFixed(1)} mph` },
  { key: 'drop', label: 'Largest speed difference', better: 'low', value: (r) => (r.ok && r.headline.worstSpeedDrop ? r.headline.worstSpeedDrop.value : null), show: (v) => `${v.toFixed(1)} mph` },
  { key: 'land', label: 'Land take', better: 'low', value: (r) => (r.ok ? r.headline.landTake.acres : null), show: (v) => `${v.toFixed(2)} acres` },
  { key: 'fails', label: 'Checks that fail', better: 'low', value: (r) => (r.ok ? r.headline.fails : null), show: (v) => String(v) },
  { key: 'warns', label: 'Checks that warn', better: 'low', value: (r) => (r.ok ? r.headline.warns : null), show: (v) => String(v) },
];

export function createCompareView(app, body) {
  const table = h('table', { class: 'cmp' });
  const thead = h('thead'), tbody = h('tbody');
  table.append(thead, tbody);
  body.append(h('div', { class: 'cmp-wrap' }, table));
  let shapeKey = '';

  function rowsFor(results) {
    const first = results.find((r) => r && r.checks);
    const checkRows = first ? first.checks.map((c) => ({
      key: `c:${c.id}`, label: c.title, check: c.id,
      better: c.unit === 'mph' && c.limit !== null ? 'low' : c.id === 'land-take' ? 'low' : 'rank',
    })) : [];
    return [...ROWS, ...checkRows];
  }

  function build(options, rows) {
    thead.textContent = ''; tbody.textContent = '';
    const tr = h('tr', {}, h('th', { class: 'cmp-name', text: '' }));
    for (const o of options) {
      const th = h('th', { class: 'cmp-opt', 'data-opt': o.id, 'data-tip': o.name, 'data-tip-text': 'Click to put this option on screen.' }, h('button', { type: 'button', text: o.name }));
      th.firstChild.addEventListener('click', () => app.setOption(o.id));
      tr.append(th);
    }
    thead.append(tr);
    for (const r of rows) {
      const row = h('tr', { 'data-row': r.key }, h('th', { class: 'cmp-name', text: r.label }));
      for (const o of options) row.append(h('td', { 'data-opt': o.id }));
      tbody.append(row);
    }
  }

  return {
    update(st, current, currentResult) {
      const options = st.project.options;
      const results = options.map((o) => (o.id === current.id ? currentResult : app.evaluateOption(o)));
      const rows = rowsFor(results);
      const key = options.map((o) => `${o.id}:${o.name}`).join('|') + '#' + rows.map((r) => r.key).join(',');
      if (key !== shapeKey) { shapeKey = key; build(options, rows); }
      for (const th of thead.querySelectorAll('th.cmp-opt')) {
        setClass(th, 'current', th.dataset.opt === current.id);
        const o = options.find((x) => x.id === th.dataset.opt);
        if (o) setText(th.firstChild, o.name);
      }
      [...tbody.children].forEach((tr, ri) => {
        const r = rows[ri];
        const cells = [...tr.children].slice(1);
        const vals = results.map((res) => {
          if (!res) return { v: null, text: '-' };
          if (!r.check) { const v = r.value(res); return { v, text: v === null ? '-' : r.show(v) }; }
          const c = res.checks.find((x) => x.id === r.check);
          if (!c) return { v: null, text: '-' };
          const num = typeof c.value === 'number' ? c.value : null;
          const shown = num !== null && !(c.unit === 'problems' && num === 0);   // "Pass", not "Pass, none"
          return { v: r.better === 'rank' ? RANK[c.status] : num, status: c.status, text: `${STATUS_WORD[c.status]}${shown ? `, ${fmtCheckValue(num, c.unit)}` : ''}` };
        });
        const nums = vals.map((x) => x.v).filter((v) => v !== null && v !== undefined);
        const best = nums.length > 1 ? (r.better === 'high' ? Math.max(...nums) : Math.min(...nums)) : null;
        const allSame = nums.length > 1 && nums.every((v) => Math.abs(v - nums[0]) < 1e-9);
        cells.forEach((td, i) => {
          setText(td, vals[i].text);
          setClass(td, 'best', best !== null && !allSame && vals[i].v !== null && Math.abs(vals[i].v - best) < 1e-9);
          setClass(td, 'current', options[i].id === current.id);
          for (const s of ['pass', 'warn', 'fail', 'info']) setClass(td, `st-${s}`, vals[i].status === s);
        });
      });
      void whole;
    },
  };
}
