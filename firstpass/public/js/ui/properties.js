// The Properties palette: a dropdown naming the selection ("Roundabout", "Leg (1)", "No selection"), then category rows
// (General, Geometry, Approach, Entry, Exit, Splitter island, Results) with name and value columns. The rows come from
// the engine's parameters table (label, unit, min, max, step; help is the tooltip); values are edited in place and
// change the drawing through the change ops. Results rows are read only: R1 to R5, V1 to V5 and the values as built,
// shown beside the asked value whenever the two differ. Rows rebuild only when the selection changes; otherwise only
// the values that changed are written. A new parameter appears here by itself; a new group maps in CATEGORY.
import { PARAMS, LEG_PARAMS, ROUND_PARAMS, legField } from '../engine/index.js';
import { h, ico, setText, setAttr, setClass, showValue, whole } from './dom.js';
import { zoneText } from '../app/sample.js';
import { prefs } from '../app/prefs.js';

export const CATEGORY = { Location: 'Geometry', Circle: 'Geometry', 'Leg position': 'Geometry', 'Leg approach': 'Approach', 'Leg entry': 'Entry', 'Leg exit': 'Exit', 'Leg splitter island': 'Splitter island' };
const ORDER = ['General', 'Geometry', 'Approach', 'Entry', 'Exit', 'Splitter island', 'Results'];
const categoryOf = (p) => CATEGORY[p.group] || p.group.replace(/^Leg /, '').replace(/^./, (c) => c.toUpperCase());
const VARIES = '*VARIES*';
const placesOf = (p) => (p.step && p.step < 1 ? 2 : 2);

export function createProperties(app, body) {
  const pick = h('select', { class: 'pr-pick', 'aria-label': 'Selection' });
  const quick = h('button', { type: 'button', class: 'pr-tool', 'data-tip': 'Select objects', 'data-tip-text': 'Click objects in the drawing to select them; Esc clears.', 'aria-label': 'Select objects' }, ico('select', 16));
  quick.addEventListener('click', () => app.focusDrawing());
  const table = h('div', { class: 'pr-table', role: 'grid' });
  const help = h('div', { class: 'pr-help' });
  body.append(h('div', { class: 'pr-head' }, pick, quick), table, help);
  let structureKey = '', filter = 'all';
  const collapsed = new Set(prefs.get('properties.collapsed', []));
  let rows = [];

  pick.addEventListener('change', () => { filter = pick.value; structureKey = ''; app.request(); });

  function rowsFor(st, option, legs) {
    const out = [];
    const hasRound = st.selection.includes('round');
    const kind = filter === 'round' || (filter === 'all' && hasRound && !legs.length) ? 'round' : (filter === 'leg' || legs.length) ? 'leg' : 'none';
    if (kind === 'none') {
      out.push({ cat: 'General', key: 'p-name', label: 'Project', get: (s) => s.project.name });
      out.push({ cat: 'General', key: 'p-opt', label: 'Option on screen', get: () => option.name });
      out.push({ cat: 'General', key: 'p-n', label: 'Options', get: (s) => String(s.project.options.length) });
      out.push({ cat: 'General', key: 'p-zone', label: 'Coordinates', get: (s) => zoneText(s.project.epsg) });
      out.push({ cat: 'General', key: 'p-site', label: 'Site', get: (s) => (s.project.site ? `${s.project.site.lat.toFixed(5)}, ${s.project.site.lon.toFixed(5)}` : '-') });
      out.push({ cat: 'Results', key: 'r-head', label: 'Checks', res: (r) => countWords(r) });
      return { kind, rows: out };
    }
    if (kind === 'round') {
      out.push({ cat: 'General', key: 'g-name', label: 'Option name', text: true, get: () => option.name, set: (v) => app.change([app.op.renameOption(option.id, v)]) });
      out.push({ cat: 'General', key: 'g-kind', label: 'Object', get: () => 'Roundabout, single lane' });
      out.push({ cat: 'General', key: 'g-legs', label: 'Legs', get: () => String(app.round().legs.length) });
      for (const p of ROUND_PARAMS) out.push(paramRow(p, () => [p.path]));
      out.push({ cat: 'Results', key: 'r-entry', label: 'Fastest entry', res: (r) => headlineValue(r, 'entry') });
      out.push({ cat: 'Results', key: 'r-drop', label: 'Largest speed difference', res: (r) => headlineValue(r, 'drop') });
      out.push({ cat: 'Results', key: 'r-land', label: 'Land take', res: (r) => (r.ok ? `${whole(r.headline.landTake.sqft)} sq ft (${r.headline.landTake.acres.toFixed(2)} acres)` : '-') });
      out.push({ cat: 'Results', key: 'r-checks', label: 'Checks', res: (r) => countWords(r) });
      return { kind, rows: out };
    }
    const ids = legs.map((l) => l.id);
    out.push({ cat: 'General', key: 'g-legname', label: 'Name', text: true, get: () => same(app.selectedLegs().map((l) => l.name)),
      set: (v) => app.change(ids.map((id) => app.op.set(option.id, `legs.${id}.name`, v))) });
    out.push({ cat: 'General', key: 'g-legid', label: 'Leg id', get: () => same(app.selectedLegs().map((l) => l.id)) });
    for (const p of LEG_PARAMS) out.push(paramRow(p, () => ids.map((id) => `legs.${id}.${legField(p)}`), legField(p)));
    for (const k of ['R1', 'R2', 'R3', 'R4', 'R5']) out.push({ cat: 'Results', key: `r-${k}`, label: `${k}, ${RADIUS_WORDS[k]}`, res: (r) => legResult(r, ids, (L) => L.R[k], 'ft') });
    for (const k of ['V1', 'V2', 'V3', 'V4', 'V5']) out.push({ cat: 'Results', key: `r-${k}`, label: `${k}, ${SPEED_WORDS[k]}`, res: (r) => legResult(r, ids, (L) => L.V[k], 'mph') });
    for (const p of LEG_PARAMS) {
      const f = legField(p);
      out.push({ cat: 'Results', key: `r-built-${f}`, label: `${p.label} as built`, built: f, res: (r) => builtValue(r, ids, f, p.unit, app.selectedLegs()) });
    }
    // Shown when the engine reports it: how wide the island is where it meets the circle.
    out.push({ cat: 'Results', key: 'r-splitter-circle', label: 'Splitter island width at the circle', built: 'splitterWidthAtCircle',
      res: (r) => (r && r.ok && r.legs.some((L) => typeof L.splitterWidthAtCircle === 'number') ? legResult(r, ids, (L) => L.splitterWidthAtCircle, 'ft') : null) });
    return { kind, rows: out };
  }

  function paramRow(p, paths, field) {
    return {
      cat: categoryOf(p), key: `p-${p.path}`, label: p.label, param: p, help: p.help,
      get: () => {
        const round = app.round();
        const vals = field ? app.selectedLegs().map((l) => l[field]) : [p.path.startsWith('center.') ? round.center[p.path.slice(7)] : round[p.path]];
        const v = same(vals);
        return v === VARIES ? VARIES : showValue(v, p.unit, placesOf(p));
      },
      raw: () => {
        const round = app.round();
        const vals = field ? app.selectedLegs().map((l) => l[field]) : [p.path.startsWith('center.') ? round.center[p.path.slice(7)] : round[p.path]];
        return same(vals);
      },
      set: (v) => app.change(paths().map((path) => app.op.set(app.option().id, path, v))),
    };
  }

  function build(spec, st) {
    table.textContent = '';
    rows = [];
    const cats = ORDER.filter((c) => spec.rows.some((r) => r.cat === c)).concat([...new Set(spec.rows.map((r) => r.cat))].filter((c) => !ORDER.includes(c)));
    for (const cat of cats) {
      const head = h('button', { type: 'button', class: 'pr-cat', 'aria-expanded': collapsed.has(cat) ? 'false' : 'true' }, ico(collapsed.has(cat) ? 'caretRight' : 'caretDown', 16), h('span', { text: cat }));
      const group = h('div', { class: 'pr-group', hidden: collapsed.has(cat) });
      head.addEventListener('click', () => {
        if (collapsed.has(cat)) collapsed.delete(cat); else collapsed.add(cat);
        prefs.set('properties.collapsed', [...collapsed]);
        structureKey = '';
        app.request();
      });
      table.append(head, group);
      for (const r of spec.rows.filter((x) => x.cat === cat)) {
        const name = h('div', { class: 'pr-name', text: r.label, title: r.help || r.label });
        const val = h('div', { class: `pr-val${r.set ? ' edit' : ''}${r.res ? ' ro' : ''}`, tabindex: r.set ? '0' : null, 'data-key': r.key });
        const el = h('div', { class: 'pr-row', role: 'row', 'data-key': r.key }, name, val);
        if (r.help) { el.dataset.tip = r.label; el.dataset.tipText = r.help; if (r.param) el.dataset.tipMore = `From ${r.param.min} to ${r.param.max} ${r.param.unit}.`; }
        if (r.set) {
          const start = () => edit(r, val);
          val.addEventListener('click', start);
          val.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); start(); } });
          el.addEventListener('click', () => { setText(help, r.help || ''); });
        }
        group.append(el);
        rows.push({ r, val, el });
      }
    }
    void st;
  }

  function edit(r, val) {
    if (val.querySelector('input')) return;
    const cur = r.raw ? r.raw() : r.get(app.store.get());
    const input = h('input', { class: 'pr-input', type: 'text', value: cur === VARIES || cur == null ? '' : r.text ? String(cur) : String(Math.round(cur * 100) / 100), 'aria-label': r.label });
    val.textContent = '';
    val.__t = undefined;
    val.append(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const text = input.value.trim();
      input.remove();
      val.__t = undefined;
      if (save && text !== '') {
        let v = text;
        if (!r.text) {
          v = Number(text.replace(/\s*(ft|mph|degrees?|deg|')\s*$/i, ''));
          if (!Number.isFinite(v)) { app.echo(`${r.label} must be a number${r.param ? ` in ${r.param.unit}` : ''}.`, 'error'); app.request(); return; }
        }
        const res = r.set(v);
        if (res && !res.ok) app.echo(res.error, 'error');
      }
      app.request();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      else if (e.key === 'Tab') { finish(true); }
    });
    input.addEventListener('blur', () => finish(true));
  }

  return {
    update(st, option, legs, result) {
      if (!option) return;
      const hasRound = st.selection.includes('round');
      const types = [];
      if (hasRound) types.push(['round', 'Roundabout (1)']);
      if (legs.length) types.push(['leg', `Leg (${legs.length})`]);
      const opts = !types.length ? [['none', 'No selection']] : types.length > 1 ? [['all', `All (${legs.length + 1})`], ...types] : [['all', types[0][1]]];
      const optKey = opts.map((o) => o.join(':')).join('|');
      if (pick.__k !== optKey) {
        pick.__k = optKey;
        pick.textContent = '';
        for (const [v, t] of opts) pick.append(h('option', { value: v, text: t }));
        filter = 'all';
        pick.value = 'all';
        if (!types.length) pick.value = 'none';
      }
      const spec = rowsFor(st, option, legs);
      const key = `${spec.kind}|${st.selection.join(',')}|${option.id}|${filter}|${[...collapsed].join(',')}`;
      if (key !== structureKey) { structureKey = key; build(spec, st); }
      for (const { r, val, el } of rows) {
        if (val.querySelector('input')) continue;
        let text;
        if (r.res) text = result ? r.res(result) : '-';
        else text = r.get(st);
        setText(val, text);
        setClass(el, 'varies', text === VARIES);
        if (r.built) setAttr(el, 'hidden', text === null || text === '' ? true : null);
      }
    },
  };
}

const RADIUS_WORDS = { R1: 'entry path radius', R2: 'circulating path radius', R3: 'exit path radius', R4: 'left turn radius', R5: 'right turn radius' };
const SPEED_WORDS = { R1: '', V1: 'entry speed', V2: 'circulating speed', V3: 'exit speed', V4: 'left turn speed', V5: 'right turn speed' };

/** One value for several, or *VARIES* when they differ. */
function same(vals) {
  if (!vals.length) return null;
  return vals.every((v) => v === vals[0]) ? vals[0] : VARIES;
}

function legResult(r, ids, read, unit) {
  if (!r || !r.ok) return '-';
  const vals = ids.map((id) => r.legs.find((L) => L.id === id)).filter(Boolean).map(read);
  if (!vals.length) return '-';
  const rounded = vals.map((v) => (v === null || v === undefined ? '-' : v === Infinity ? 'straight' : showValue(v, unit, 1)));
  return rounded.every((v) => v === rounded[0]) ? rounded[0] : VARIES;
}

/** The value as built beside the asked value, when the engine reports one (<field>Built) and it differs; null hides the row. */
function builtValue(r, ids, field, unit, legs) {
  if (!r || !r.ok) return null;
  const key = `${field}Built`;
  const vals = [];
  let differs = false;
  for (const id of ids) {
    const L = r.legs.find((x) => x.id === id) || {};
    const G = (r.geometry && r.geometry.legs.find((x) => x.id === id)) || {};
    const built = typeof L[key] === 'number' ? L[key] : typeof G[key] === 'number' ? G[key] : null;
    if (built === null) return null;
    const asked = (legs.find((l) => l.id === id) || {})[field];
    const off = Math.abs(built - asked) > 0.005;
    differs = differs || off;
    vals.push(off ? `${showValue(built, unit)} (asked ${showValue(asked, unit)})` : showValue(built, unit));
  }
  if (!differs) return null;
  return vals.every((v) => v === vals[0]) ? vals[0] : VARIES;
}

function headlineValue(r, which) {
  if (!r || !r.ok) return '-';
  const hl = r.headline;
  const v = which === 'entry' ? hl.worstEntrySpeed : hl.worstSpeedDrop;
  if (!v) return '-';
  const leg = r.legs.find((L) => L.id === v.leg);
  return `${v.value.toFixed(1)} mph, ${leg ? leg.name : v.leg}`;
}

function countWords(r) {
  if (!r) return '-';
  if (!r.ok) return 'The shape cannot be built';
  const { fails, warns } = r.headline;
  if (!fails && !warns) return 'All pass';
  return `${fails} fail, ${warns} warn`;
}

export { PARAMS };
