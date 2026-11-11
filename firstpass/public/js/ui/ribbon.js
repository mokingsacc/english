// The ribbon: tabs Home, Roundabout, Analyze, Output, Manage, each with panels titled in a strip along their bottom
// edge; large buttons (32 px icon, label under) and small ones (16 px icon, label beside) in rows of three; flyout
// arrows where a button has variants. Selecting the roundabout or a leg adds a contextual tab at the right end in a
// contrasting colour ("Roundabout: Option A", "Leg: North leg") and opens it. Every button comes from the commands
// registry (commands/index.js ribbonEntries); pressing one runs its command, which echoes on the command line.
// A new tab or panel: one row in TABS (a panel a command names that is not listed is added at the end of its tab).
// A short window (under SHORT_PX high, as a laptop at 150 per cent scaling) folds the ribbon to its tab row so the drawing
// keeps its room; a tab then opens its panels over the drawing until she presses a button or clicks elsewhere, and the
// arrow at the right keeps them open on this browser.

import { h, ico, setText, setClass } from './dom.js';
import { tipFor } from './tooltip.js';
import { openMenu } from './menu.js';
import { prefs } from '../app/prefs.js';

export const SHORT_PX = 700;

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

  // Folded in a short window unless she pinned the panels open there; minimized by her own choice otherwise.
  const shortQuery = typeof matchMedia === 'function' ? matchMedia(`(max-height: ${SHORT_PX - 1}px)`) : null;
  const isShort = () => !!(shortQuery && shortQuery.matches);
  function fold() {
    const short = isShort();
    setClass(root, 'folded', short && !prefs.get('ribbon.shortOpen', false));
    setClass(root, 'minimized', !short && prefs.get('ribbon.min', false));
    if (!root.classList.contains('folded')) peek(false);
    const shut = root.classList.contains('folded') || root.classList.contains('minimized');
    minBtn.dataset.tip = shut ? 'Show the ribbon' : 'Minimize the ribbon';
    minBtn.dataset.tipText = shut ? 'Keeps the panels open under the tab names.' : 'Shows only the tab names, to give the drawing more room. Click again to show the panels.';
  }
  minBtn.addEventListener('click', () => {
    if (isShort()) prefs.set('ribbon.shortOpen', !prefs.get('ribbon.shortOpen', false));
    else prefs.set('ribbon.min', !root.classList.contains('minimized'));
    fold();
    app.layout();
  });
  if (shortQuery && shortQuery.addEventListener) shortQuery.addEventListener('change', () => { fold(); app.layout(); });

  // The panels opened over the drawing from a folded ribbon: they close on a button, a click elsewhere, or Esc.
  const away = (e) => { if (!root.contains(e.target)) peek(false); };
  const esc = (e) => { if (e.key === 'Escape') peek(false); };
  function peek(on) {
    if (on === root.classList.contains('peek')) return;
    setClass(root, 'peek', on);
    const f = on ? 'addEventListener' : 'removeEventListener';
    document[f]('pointerdown', away, true);
    document[f]('keydown', esc, true);
  }

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
      peek(false);
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
    const again = id === active;
    active = id;
    for (const [k, p] of panes) p.hidden = k !== id;
    for (const [k, b] of tabBtns) { setClass(b, 'active', k === id); b.setAttribute('aria-selected', k === id ? 'true' : 'false'); }
    if (byHand && !id.startsWith('ctx-')) { prefs.set('ribbon.tab', id); beforeCtx = null; }
    if (byHand && root.classList.contains('folded')) peek(!(again && root.classList.contains('peek')));
    else if (byHand && root.classList.contains('minimized')) { prefs.set('ribbon.min', false); fold(); app.layout(); }
  }
  fold();
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
