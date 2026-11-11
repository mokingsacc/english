// The page's small windows: Check myself (one green or red line each, with what to do), Open project (her projects to
// pick from), and the Layers palette (each display layer with its on and off bulb and its colour). A new window: one
// function here that builds it with modal() or floating().
import { h, ico } from './dom.js';
import { runSelfCheck } from '../app/selfcheck.js';
import { DISPLAY, LAYERS } from '../draw/colors.js';

const LAYER_COLOR = { curbs: LAYERS.curb.color, edges: LAYERS.edge.color, islands: LAYERS.island.color, paths: '#5adc46', speeds: LAYERS.pathLabel.color,
  sight: LAYERS.sightEntering.color, landtake: LAYERS.landtake.color, photo: '#7cc0f0' };

function modal(title, cls = '') {
  const dlg = h('dialog', { class: `dlg ${cls}` });
  const close = h('button', { type: 'button', class: 'dlg-x', 'aria-label': 'Close' }, ico('close', 16));
  const body = h('div', { class: 'dlg-body' });
  const foot = h('div', { class: 'dlg-foot' });
  dlg.append(h('div', { class: 'dlg-head' }, h('h2', { text: title }), close), body, foot);
  close.addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
  return { dlg, body, foot };
}

export function createDialogs(app) {
  let layersEl = null;

  async function checkMyself() {
    const { dlg, body, foot } = modal('Check myself', 'selfcheck');
    const again = h('button', { type: 'button', class: 'btn', text: 'Run again' });
    const done = h('button', { type: 'button', class: 'btn go', text: 'Close' });
    foot.append(again, done);
    done.addEventListener('click', () => dlg.close());
    const run = async () => {
      body.textContent = '';
      body.append(h('p', { class: 'muted', text: 'Checking...' }));
      let lines;
      try { lines = await runSelfCheck(app); } catch (e) { lines = [{ id: 'page', ok: false, title: 'This page', text: `Check myself itself broke (${e.message}). Use Report a problem.` }]; }
      body.textContent = '';
      const list = h('ul', { class: 'sc-list' });
      for (const l of lines) list.append(h('li', { class: `sc-line ${l.ok ? 'ok' : 'bad'}`, 'data-line': l.id }, h('span', { class: 'sc-dot', 'aria-label': l.ok ? 'Fine' : 'Needs attention' }), h('div', {}, h('b', { text: l.title }), h('div', { text: l.text }))));
      body.append(list);
      app.lastSelfCheck = lines;
    };
    again.addEventListener('click', run);
    await run();
  }

  function openProjects(projects) {
    const { dlg, body, foot } = modal('Open project', 'open');
    const cancel = h('button', { type: 'button', class: 'btn', text: 'Cancel' });
    foot.append(cancel);
    cancel.addEventListener('click', () => dlg.close());
    if (!projects.length) body.append(h('p', { text: 'You have no projects yet. NEW makes one.' }));
    const list = h('div', { class: 'proj-list' });
    for (const p of projects) {
      const b = h('button', { type: 'button', class: 'proj' }, ico('project', 32), h('span', {}, h('b', { text: p.name }),
        h('small', { text: `${p.options.map((o) => o.name).join(', ')}. Changed ${new Date(p.updated_at).toLocaleString()}.` })));
      b.addEventListener('click', async () => { dlg.close(); const r = await app.openProject(p.id); if (!r.ok) app.echo(r.error, 'error'); else app.echo(`Opened "${p.name}".`, 'done'); });
      list.append(b);
    }
    body.append(list);
  }

  function layers() {
    if (layersEl) { layersEl.remove(); layersEl = null; }
    const close = h('button', { type: 'button', class: 'dlg-x', 'aria-label': 'Close' }, ico('close', 16));
    const rows = h('div', { class: 'ly-rows' });
    layersEl = h('div', { class: 'floating layers-pal', role: 'dialog', 'aria-label': 'Layer display' },
      h('div', { class: 'fl-head' }, h('span', { text: 'Layer display' }), close),
      h('div', { class: 'ly-row ly-headrow' }, h('span', { text: 'On' }), h('span', { text: 'Colour' }), h('span', { text: 'Name' })), rows);
    close.addEventListener('click', () => { layersEl.remove(); layersEl = null; });
    const draw = () => {
      rows.textContent = '';
      const st = app.store.get();
      for (const d of DISPLAY) {
        const on = !!st.display[d.key];
        const bulb = h('button', { type: 'button', class: 'ly-bulb', 'aria-pressed': String(on), 'aria-label': `${d.label} ${on ? 'on' : 'off'}`, 'data-layer': d.key }, ico(on ? 'bulbOn' : 'bulbOff', 16));
        bulb.addEventListener('click', () => { app.toggleDisplay(d.key); draw(); });
        rows.append(h('div', { class: `ly-row${on ? '' : ' off'}` }, bulb, h('span', { class: 'ly-swatch', style: { background: LAYER_COLOR[d.key] } }), h('span', { text: d.label })));
      }
    };
    draw();
    document.body.append(layersEl);
    const vp = app.viewportRect();
    layersEl.style.left = `${Math.round(vp.left + 70)}px`;
    layersEl.style.top = `${Math.round(vp.top + 12)}px`;
    layersEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') { layersEl.remove(); layersEl = null; } });
    return { refresh: draw };
  }

  return { checkMyself, openProjects, layers: { open: layers } };
}
