// The Panorama window docked under the drawing: its name down a strip at the left with close and collapse, the tabs
// Checks and Compare along its bottom edge as in the CAD original, and a grip on its top edge to resize it. Height and
// state are remembered on this browser; CHECK, COMPARE and PANORAMA (and the ribbon) open it again.
import { h, ico, setClass } from './dom.js';
import { prefs } from '../app/prefs.js';
import { createChecksView } from './checks-view.js';
import { createCompareView } from './compare-view.js';

export const PANO_TABS = [{ id: 'checks', label: 'Checks' }, { id: 'compare', label: 'Compare' }];

export function createPanorama(app, root) {
  const strip = h('div', { class: 'pano-strip' });
  const close = h('button', { type: 'button', class: 'pal-x', 'aria-label': 'Close Panorama', 'data-tip': 'Close Panorama', 'data-tip-text': 'Type PANORAMA, CHECK or COMPARE to open it again.' }, ico('close', 16));
  const fold = h('button', { type: 'button', class: 'pal-fold', 'aria-label': 'Collapse Panorama', 'data-tip': 'Collapse Panorama', 'data-tip-text': 'Shows only the tabs. Click a tab to open it again.' }, ico('caretDown', 16));
  strip.append(close, fold, h('span', { class: 'pal-title', text: 'PANORAMA' }));
  const grip = h('div', { class: 'pano-grip', 'aria-hidden': 'true' });
  const views = h('div', { class: 'pano-views' });
  const tabs = h('div', { class: 'pano-tabs', role: 'tablist' });
  const bodies = {}, tabBtns = {};
  for (const t of PANO_TABS) {
    bodies[t.id] = h('div', { class: 'pano-body', 'data-tab': t.id, hidden: true });
    views.append(bodies[t.id]);
    tabBtns[t.id] = h('button', { type: 'button', class: 'pano-tab', role: 'tab', 'data-tab': t.id, text: t.label });
    tabBtns[t.id].addEventListener('click', () => show(t.id));
    tabs.append(tabBtns[t.id]);
  }
  root.append(grip, strip, h('div', { class: 'pano-main' }, views, tabs));
  const checks = createChecksView(app, bodies.checks);
  const compare = createCompareView(app, bodies.compare);

  let tab = prefs.get('panorama.tab', 'checks');
  let height = prefs.get('panorama.height', Math.round(Math.max(120, Math.min(220, window.innerHeight * 0.2))));
  const setH = () => root.style.setProperty('--pano-h', `${height}px`);
  setH();
  const setState = (s) => {
    root.hidden = s === 'closed';
    setClass(root, 'collapsed', s === 'collapsed');
    prefs.set('panorama.state', s);
    app.layout();
    app.request('panels');
  };
  const state = () => (root.hidden ? 'closed' : root.classList.contains('collapsed') ? 'collapsed' : 'open');
  setState(prefs.get('panorama.state', 'open'));

  function show(id) {
    tab = bodies[id] ? id : 'checks';
    for (const t of PANO_TABS) { bodies[t.id].hidden = t.id !== tab; setClass(tabBtns[t.id], 'active', t.id === tab); }
    prefs.set('panorama.tab', tab);
    if (state() !== 'open') setState('open');
    app.request('panels');
  }
  show(tab);
  if (prefs.get('panorama.state', 'open') !== 'open') setState(prefs.get('panorama.state', 'open'));

  close.addEventListener('click', () => setState('closed'));
  fold.addEventListener('click', () => setState(state() === 'collapsed' ? 'open' : 'collapsed'));
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const y0 = e.clientY, h0 = height;
    const move = (ev) => { height = Math.max(70, Math.min(window.innerHeight * 0.6, Math.round(h0 - (ev.clientY - y0)))); setH(); app.layout(); };
    const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); prefs.set('panorama.height', height); };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });

  return {
    show,
    toggle: () => setState(state() === 'open' ? 'closed' : 'open'),
    state,
    update(st, current, result) {
      if (state() !== 'open') return;
      if (tab === 'checks') checks.update(result);
      else compare.update(st, current, result);
    },
  };
}
