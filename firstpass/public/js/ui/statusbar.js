// The status bar along the very bottom: the cursor's northing and easting in feet (two decimals, live), the drawing
// aids (grid F7, polar tracking to 15 degree bearings F10, object snap F3, dynamic input F12) and the layer display
// list, the coordinate zone and units, one quiet line about the aerial photo, the sync state in plain words, and Check
// myself. A new toggle: one row in TOGGLES and its flag in store.js toggles.
import { h, ico, setText, setClass } from './dom.js';
import { openMenu } from './menu.js';
import { DISPLAY } from '../draw/colors.js';
import { zoneText } from '../app/sample.js';

export const TOGGLES = [
  { key: 'grid', icon: 'grid', label: 'Grid', key2: 'F7', text: 'Shows a grid of lines in feet behind the drawing.' },
  { key: 'polar', icon: 'polar', label: 'Polar tracking', key2: 'F10', text: 'Snaps picked bearings to 15 degree steps.' },
  { key: 'osnap', icon: 'osnap', label: 'Object snap', key2: 'F3', text: 'Snaps the cursor to the centre, noses, curb ends and other named points.' },
  { key: 'dyn', icon: 'dyn', label: 'Dynamic input', key2: 'F12', text: 'Shows the value by the cursor while you drag a grip, where you can type it.' },
];

const fmt = (v) => (Number.isFinite(v) ? v.toFixed(2) : '-');

export function createStatusbar(app, root) {
  const coords = h('div', { class: 'sb-coords', 'data-tip': 'Cursor position', 'data-tip-text': 'Northing and easting of the cursor in state plane feet.' });
  const model = h('button', { type: 'button', class: 'sb-model', text: 'MODEL', 'data-tip': 'Model space', 'data-tip-text': 'You are drawing in model space, in real feet.' });
  const toggles = h('div', { class: 'sb-toggles' });
  const btns = {};
  for (const t of TOGGLES) {
    const b = h('button', { type: 'button', class: 'sb-tog', 'aria-pressed': 'false', 'aria-label': t.label, 'data-tip': `${t.label} (${t.key2})`, 'data-tip-text': t.text }, ico(t.icon, 16));
    b.addEventListener('click', () => app.toggle(t.key));
    btns[t.key] = b;
    toggles.append(b);
  }
  const layersBtn = h('button', { type: 'button', class: 'sb-tog', 'aria-label': 'Layer display', 'data-tip': 'Layer display', 'data-tip-text': 'Turns the display layers on and off.' }, ico('layers', 16));
  layersBtn.addEventListener('click', () => {
    const r = layersBtn.getBoundingClientRect();
    const st = app.store.get();
    openMenu([{ title: 'Layer display' }, ...DISPLAY.map((d) => ({ label: d.label, checked: !!st.display[d.key], run: () => app.toggleDisplay(d.key) }))], r.left, r.top - 260);
  });
  toggles.append(layersBtn);
  const zone = h('div', { class: 'sb-zone', 'data-tip': 'Coordinate system', 'data-tip-text': 'California state plane coordinates of this project. Angles are bearings clockwise from north.' });
  const photo = h('div', { class: 'sb-photo' });
  const net = h('div', { class: 'sb-net', role: 'status' }, h('span', { class: 'dot' }), h('span', { class: 'sb-net-text' }));
  const self = h('button', { type: 'button', class: 'sb-self', 'data-tip': 'Check myself', 'data-tip-text': 'Checks the server, the connector, the maths, the export, the photos and the speed of this machine.' }, ico('selfcheck', 16), h('span', { text: 'Check myself' }));
  self.addEventListener('click', () => app.runCommand('CHECKMYSELF'));
  root.append(coords, model, toggles, h('div', { class: 'sb-sep' }), zone, photo, h('div', { class: 'sb-fill' }), net, self);
  const netText = net.querySelector('.sb-net-text');

  return {
    update(st, cursor) {
      setText(coords, cursor ? `N ${fmt(cursor.y)} ft   E ${fmt(cursor.x)} ft` : 'N -   E -');
      for (const t of TOGGLES) {
        setClass(btns[t.key], 'on', !!st.toggles[t.key]);
        btns[t.key].setAttribute('aria-pressed', st.toggles[t.key] ? 'true' : 'false');
      }
      setText(zone, st.project ? zoneText(st.project.epsg) : '');
      setText(photo, st.photo.text || '');
      setText(netText, st.net.text);
      if (net.dataset.state !== st.net.state) net.dataset.state = st.net.state;
    },
  };
}
