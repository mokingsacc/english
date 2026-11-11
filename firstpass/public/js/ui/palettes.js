// Docked palettes (Toolspace on the left, Properties on the right): a title strip with the name written down its edge,
// a close button and a collapse button; vertical tabs on the edge where a palette has several; a grip on the inner
// edge to resize. Collapsed shows only the strip (click it to open again); closed hides the palette until its command
// opens it. Sizes and states are remembered on this browser. createPalette(app, el, { name, side, tabs, width }).
import { h, ico, setClass } from './dom.js';
import { prefs } from '../app/prefs.js';

export function createPalette(app, el, { id, name, side, tabs = null, width = 240, min = 180, max = 520 }) {
  const strip = h('div', { class: 'pal-strip' });
  const close = h('button', { type: 'button', class: 'pal-x', 'aria-label': `Close ${name}`, 'data-tip': `Close ${name}`, 'data-tip-text': `Type ${id.toUpperCase()} to open it again.` }, ico('close', 16));
  const fold = h('button', { type: 'button', class: 'pal-fold', 'aria-label': `Collapse ${name}`, 'data-tip': `Collapse ${name}`, 'data-tip-text': 'Shows only this strip. Click the strip to open it again.' }, ico(side === 'left' ? 'caretRight' : 'caretDown', 16));
  const title = h('span', { class: 'pal-title', text: name.toUpperCase() });
  strip.append(close, fold, title);
  const main = h('div', { class: 'pal-main' });
  const bodies = {};
  const vtabs = tabs ? h('div', { class: 'pal-vtabs', role: 'tablist' }) : null;
  let current = null;
  if (tabs) {
    for (const t of tabs) {
      const b = h('div', { class: 'pal-body', 'data-tab': t.id, hidden: true });
      bodies[t.id] = b;
      main.append(b);
      const tb = h('button', { type: 'button', class: 'pal-vtab', role: 'tab', 'data-tab': t.id }, h('span', { text: t.label }));
      tb.addEventListener('click', () => show(t.id));
      vtabs.append(tb);
    }
  } else {
    bodies.main = h('div', { class: 'pal-body' });
    main.append(bodies.main);
  }
  const grip = h('div', { class: 'pal-grip', 'aria-hidden': 'true' });
  el.classList.add('palette', side);
  if (side === 'left') el.append(strip, main, ...(vtabs ? [vtabs] : []), grip);
  else el.append(grip, ...(vtabs ? [vtabs] : []), main, strip);

  let w = prefs.get(`${id}.width`, width);
  const apply = () => { el.style.setProperty('--pal-w', `${w}px`); };
  apply();
  const setState = (s) => {
    setClass(el, 'collapsed', s === 'collapsed');
    el.hidden = s === 'closed';
    prefs.set(`${id}.state`, s);
    app.layout();
  };
  const state = () => (el.hidden ? 'closed' : el.classList.contains('collapsed') ? 'collapsed' : 'open');
  setState(prefs.get(`${id}.state`, 'open'));

  close.addEventListener('click', (e) => { e.stopPropagation(); setState('closed'); });
  fold.addEventListener('click', (e) => { e.stopPropagation(); setState(state() === 'collapsed' ? 'open' : 'collapsed'); });
  strip.addEventListener('click', () => { if (state() === 'collapsed') setState('open'); });

  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    grip.setPointerCapture(e.pointerId);
    const x0 = e.clientX, w0 = w;
    const move = (ev) => {
      const dx = ev.clientX - x0;
      w = Math.max(min, Math.min(max, Math.round(side === 'left' ? w0 + dx : w0 - dx)));
      apply();
      app.layout();
    };
    const up = () => { grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); prefs.set(`${id}.width`, w); };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });

  function show(tab) {
    if (!tabs) { setState('open'); return; }
    current = bodies[tab] ? tab : tabs[0].id;
    for (const [k, b] of Object.entries(bodies)) b.hidden = k !== current;
    for (const b of vtabs.children) setClass(b, 'active', b.dataset.tab === current);
    prefs.set(`${id}.tab`, current);
    if (state() !== 'open') setState('open');
    app.request('tree');
  }
  if (tabs) show(prefs.get(`${id}.tab`, tabs[0].id));
  if (tabs && prefs.get(`${id}.state`, 'open') !== 'open') setState(prefs.get(`${id}.state`, 'open'));

  return {
    bodies,
    show,
    open: () => (tabs ? show(current) : setState('open')),
    toggle: () => setState(state() === 'open' ? 'closed' : 'open'),
    state,
    tab: () => current,
  };
}
