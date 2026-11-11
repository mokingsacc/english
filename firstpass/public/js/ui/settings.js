// Settings, the Toolspace's second tab: every design limit from the engine's rules table (label, value, unit, where it
// comes from), grouped, editable in place for this project through the set_rule op. Rows marked with the yellow
// triangle are still to be checked against NCHRP Research Report 1043. A value changed for this project shows in bold
// with Standard to put it back. The pane at the bottom shows the chosen row's source. New rules appear by themselves;
// a new group is one row in GROUPS.
import { RULES } from '../engine/index.js';
import { h, ico, setText, setClass, keyed } from './dom.js';

const GROUPS = [['fp.', 'Fastest paths'], ['speed.', 'Speeds'], ['sight.ssd.', 'Stopping sight distance'], ['sight.isd.', 'Intersection sight distance'], ['geom.', 'Drawing'], ['units.', 'Units']];
const groupOf = (id) => (GROUPS.find(([p]) => id.startsWith(p)) || [null, 'Other'])[1];

export function createSettings(app, body) {
  const list = h('div', { class: 'rules', role: 'grid', 'aria-label': 'Design limits' });
  const detail = h('div', { class: 'rule-detail' });
  body.append(h('div', { class: 'rules-head' }, h('span', { text: 'Design limits for this project' })), list, detail);
  let chosen = null;

  const items = [];
  for (const [, name] of GROUPS.concat([[null, 'Other']])) {
    const rules = RULES.filter((r) => groupOf(r.id) === name);
    if (!rules.length) continue;
    items.push({ key: `g:${name}`, group: name });
    for (const r of rules) items.push({ key: r.id, rule: r });
  }

  function make(it) {
    if (it.group) return h('div', { class: 'rule-group', text: it.group });
    const r = it.rule;
    const mark = h('span', { class: 'rule-mark' });
    if (r.verify) { mark.append(ico('verify', 16)); mark.title = 'To be checked against NCHRP Research Report 1043 before relying on it.'; }
    const val = h('button', { type: 'button', class: 'rule-val', 'aria-label': `${r.label}, value` });
    const row = h('div', { class: 'rule', role: 'row', 'data-rule': r.id, 'data-tip': r.label, 'data-tip-text': `Standard value ${r.value} ${r.unit}. ${r.verify ? 'Still to be checked against NCHRP Research Report 1043.' : ''}`, 'data-tip-more': `Source: ${r.source}` },
      mark, h('span', { class: 'rule-label', text: r.label }), val, h('span', { class: 'rule-unit', text: r.unit }));
    row.__val = val;
    row.addEventListener('click', () => { chosen = r.id; showDetail(); });
    val.addEventListener('click', (e) => { e.stopPropagation(); chosen = r.id; showDetail(); edit(r, val); });
    return row;
  }

  function edit(r, val) {
    if (val.querySelector('input')) return;
    const cur = valueOf(r);
    const input = h('input', { type: 'text', class: 'rule-input', value: String(cur), 'aria-label': r.label });
    val.textContent = ''; val.__t = undefined;
    val.append(input);
    input.focus(); input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const t = input.value.trim();
      input.remove(); val.__t = undefined;
      if (save && t !== '' && Number(t) !== cur) {
        const v = Number(t);
        if (!Number.isFinite(v)) app.echo(`${r.label} must be a number in ${r.unit}.`, 'error');
        else {
          const res = app.change([app.op.setRule(r.id, v === r.value ? null : v)]);
          if (res && !res.ok) app.echo(res.error, 'error');
        }
      }
      app.request('tree');
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  const valueOf = (r) => {
    const rules = (app.store.get().project || {}).rules || {};
    return rules[r.id] !== undefined ? rules[r.id] : r.value;
  };

  function showDetail() {
    const r = RULES.find((x) => x.id === chosen);
    detail.textContent = '';
    if (!r) { detail.append(h('div', { class: 'muted', text: 'Click a row to see where its value comes from. Click a value to change it for this project.' })); return; }
    const rules = (app.store.get().project || {}).rules || {};
    const changed = rules[r.id] !== undefined && rules[r.id] !== r.value;
    detail.append(h('div', { class: 'rd-label', text: r.label }), h('div', { text: `Standard value: ${r.value} ${r.unit}${changed ? `. This project uses ${rules[r.id]} ${r.unit}.` : '.'}` }),
      h('div', { class: 'muted', text: `Source: ${r.source}.` }));
    if (r.verify) detail.append(h('div', { class: 'rd-verify', text: 'Still to be checked against NCHRP Research Report 1043 before the tool is relied on.' }));
    if (changed) {
      const back = h('button', { type: 'button', class: 'btn', text: 'Put back the standard value' });
      back.addEventListener('click', () => { const res = app.change([app.op.setRule(r.id, null)]); if (res && !res.ok) app.echo(res.error, 'error'); showDetail(); });
      detail.append(back);
    }
  }
  showDetail();

  let lastRules = null;
  return {
    update(st) {
      const rules = (st.project && st.project.rules) || {};
      if (rules === lastRules && list.childElementCount) return;
      lastRules = rules;
      keyed(list, items, (it) => it.key, make, (row, it) => {
        if (!it.rule) return;
        const v = valueOf(it.rule);
        if (!row.__val.querySelector('input')) setText(row.__val, String(v));
        setClass(row, 'changed', rules[it.rule.id] !== undefined && rules[it.rule.id] !== it.rule.value);
      });
      if (chosen) showDetail();
    },
  };
}
