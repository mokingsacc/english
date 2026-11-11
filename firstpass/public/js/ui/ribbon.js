// The ribbon: tabs Home, Roundabout, Analyze, Output, Manage, each with panels titled in a strip along their bottom
// edge; large buttons (32 px icon, label under) and small ones (16 px icon, label beside) in rows of three; flyout
// arrows where a button has variants. Selecting the roundabout or a leg adds a contextual tab at the right end in a
// contrasting colour ("Roundabout: Option A", "Leg: North leg") and opens it. Every button comes from the commands
// registry (commands/index.js ribbonEntries); pressing one runs its command, which echoes on the command line.
// A new tab or panel: one row in TABS (a panel a command names that is not listed is added at the end of its tab).

import { h, ico, setText, setClass } from './dom.js';
import { tipFor } from './tooltip.js';
import { openMenu } from './menu.js';
import { prefs } from '../app/prefs.js';

export const TABS = [
  { id: 'home', label: 'Home', panels: ['Create', 'Modify', 'Layers', 'View', 'Palettes'] },
  { id: 'roundabout', label: 'Roundabout', panels: ['Circle', 'Legs', 'Options'] },
  { id: 'analyze', label: 'Analyze', panels: ['Checks', 'Show', 'Tool'] },
  { id: 'output', label: 'Output', panels: ['Export', 'Reports'] },
  { id: 'manage', label: 'Manage', panels: ['Project', 'Settings', 'Help'] },
  { id: 'ctx-round', contextual: 'round', panels: ['Modify', 'General', 'Analyze'] },
  { id: 'ctx-leg', contextual: 'leg', panels: ['Modify', 'General'] },
];

export function createRibbon(app, root, entries) {
  const tabsEl = h('div', { class: 'rb-tabs', role: 'tablist' });
  const body = h('div', { class: 'rb-body' });
  const minBtn = h('button', { class: 'rb-min', type: 'button', 'data-tip': 'Minimize the ribbon', 'data-tip-text': 'Shows only the tab names, to give the drawing more room. Click again to show the panels.' }, ico('caretDown', 16));
  root.append(tabsEl, body);
  const tabBtns = new Map(), panes = new Map();
  let active = prefs.get('ribbon.tab', 'home');
  let beforeCtx = null;

  for (const t of TABS) {
    const btn = h('button', { class: `rb-tab${t.contextual ? ' ctx' : ''}`, type: 'button', role: 'tab', 'data-tab': t.id, text: t.label || '' });
    btn.addEventListener('click', () => select(t.id, true));
    if (t.contextual) btn.hidden = true;
    tabBtns.set(t.id, btn);
    tabsEl.append(btn);
    const pane = h('div', { class: 'rb-pane', 'data-tab': t.id, role: 'tabpanel', hidden: true });
    panes.set(t.id, pane);
    body.append(pane);
    const mine = entries.filter((e) => e.tab === t.id);
    const names = [...t.panels, ...new Set(mine.map((e) => e.panel).filter((p) => !t.panels.includes(p)))];
    for (const name of names) {
      const list = mine.filter((e) => e.panel === name);
      if (list.length) pane.append(panel(name, list));
    }
  }
  tabsEl.append(h('span', { class: 'rb-spacer' }), minBtn);
  minBtn.addEventListener('click', () => {
    const min = !root.classList.contains('minimized');
    setClass(root, 'minimized', min);
    prefs.set('ribbon.min', min);
    app.layout();
  });
  if (prefs.get('ribbon.min', false)) root.classList.add('minimized');

  function panel(name, list) {
    const row = h('div', { class: 'rb-panel-body' });
    let col = null;
    // Large buttons first, then the small ones stacked three to a column, as a CAD ribbon panel lays them out.
    const ordered = [...list.filter((e) => e.size === 'large'), ...list.filter((e) => e.size !== 'large')];
    for (const e of ordered) {
      if (e.size === 'large') { row.append(button(e, 'large')); col = null; continue; }
      if (!col || col.children.length >= 3) { col = h('div', { class: 'rb-col' }); row.append(col); }
      col.append(button(e, 'small'));
    }
    return h('section', { class: 'rb-panel' }, row, h('div', { class: 'rb-panel-title', text: name }));
  }

  function button(e, size) {
    const cmd = app.commands.find((c) => c.name === e.command);
    const attrs = { type: 'button', class: `rb-btn ${size}`, 'data-cmd': e.command, ...tipFor(cmd, e.label), 'aria-label': e.label };
    if (e.report) attrs['data-report-btn'] = '';
    const b = h('button', attrs, ico(e.icon, size === 'large' ? 32 : 16), h('span', { class: 'rb-label', text: e.label }));
    b.addEventListener('click', () => {
      if (e.report) { app.echoCommand(e.command); return; }   // report.js opens the sheet from data-report-btn
      app.runCommand(e.command, e.args || []);
    });
    if (!e.flyout) return b;
    const arrow = h('button', { type: 'button', class: `rb-fly ${size}`, 'data-tip': `${e.label} options`, 'data-tip-text': 'Shows the other ways this button can work.', 'aria-label': `${e.label} options` }, ico('caretDown', 16));
    arrow.addEventListener('click', () => {
      const r = arrow.getBoundingClientRect();
      openMenu(e.flyout.map((f) => ({ label: f.label, run: () => app.runCommand(e.command, f.args || []) })), r.left, r.bottom + 2, { className: 'flyout' });
    });
    return h('div', { class: `rb-split ${size}` }, b, arrow);
  }

  function select(id, byHand) {
    if (!panes.has(id)) id = 'home';
    active = id;
    for (const [k, p] of panes) p.hidden = k !== id;
    for (const [k, b] of tabBtns) { setClass(b, 'active', k === id); b.setAttribute('aria-selected', k === id ? 'true' : 'false'); }
    if (byHand && !id.startsWith('ctx-')) { prefs.set('ribbon.tab', id); beforeCtx = null; }
    if (byHand && root.classList.contains('minimized')) { root.classList.remove('minimized'); prefs.set('ribbon.min', false); app.layout(); }
  }
  select(active.startsWith('ctx-') ? 'home' : active);

  let shownCtx = null;
  return {
    select,
    /** Contextual tabs follow the selection: the roundabout's or a leg's tab appears and opens; it goes when cleared. */
    update(st, option, legs) {
      const hasRound = st.selection.includes('round');
      const want = legs.length ? 'ctx-leg' : hasRound ? 'ctx-round' : null;
      const rb = tabBtns.get('ctx-round'), lb = tabBtns.get('ctx-leg');
      rb.hidden = !hasRound || !!legs.length;
      lb.hidden = !legs.length;
      if (option) setText(rb, `Roundabout: ${option.name}`);
      if (legs.length) setText(lb, legs.length === 1 ? `Leg: ${legs[0].name}` : `Legs: ${legs.length} selected`);
      if (want !== shownCtx) {
        if (want) { if (!beforeCtx && !active.startsWith('ctx-')) beforeCtx = active; select(want); }
        else select(beforeCtx || prefs.get('ribbon.tab', 'home'));
        shownCtx = want;
        if (!want) beforeCtx = null;
      }
    },
    active: () => active,
  };
}
