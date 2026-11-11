// Every icon of the page, drawn fresh as SVG in the flat, small, many-coloured style of CAD ribbons, one entry per icon
// on a 32 by 32 grid so each reads at 16 px and at 32 px. Nothing here is traced or taken from any other product.
// icon('zoomExtents', 16) gives the SVG text. A new icon: one entry in ICONS (shapes only; no text, no outside files).

const C = {
  blue: '#3d8ee0', sky: '#8cc4ff', navy: '#1f5fa8', yellow: '#f2c84b', green: '#5fbf5f', dgreen: '#2f8f4e', red: '#e5534b',
  grey: '#c9d1da', mid: '#8a96a3', dark: '#39424e', white: '#f2f4f7', orange: '#f0963c', purple: '#a07cf0', cyan: '#4fd1d9',
  paper: '#e9edf2', brown: '#b07a45',
};

const sheet = (fill = C.paper) => `<path d="M7 3h13l6 6v20H7z" fill="${fill}" stroke="${C.mid}" stroke-width="1.5"/><path d="M20 3v6h6" fill="#cfd6de" stroke="${C.mid}" stroke-width="1.5"/>`;
const glass = (x = 13, y = 13) => `<circle cx="${x}" cy="${y}" r="8" fill="#cfe5ff" fill-opacity=".35" stroke="${C.grey}" stroke-width="2.6"/><path d="M${x + 6} ${y + 6}l7 7" stroke="${C.orange}" stroke-width="4" stroke-linecap="round"/>`;
const roundabout = (sw = 2.4) => `<path d="M16 1v8M16 23v8M1 16h8M23 16h8" stroke="${C.grey}" stroke-width="${sw + 1.4}"/><circle cx="16" cy="16" r="8.5" fill="none" stroke="${C.white}" stroke-width="${sw}"/><circle cx="16" cy="16" r="4" fill="${C.green}"/>`;

export const ICONS = {
  fp: `<rect x="1" y="1" width="30" height="30" rx="3" fill="${C.navy}"/><rect x="1" y="1" width="30" height="30" rx="3" fill="none" stroke="${C.sky}" stroke-opacity=".5"/>`
    + `<path d="M6 8h9M6 8v17M6 16h7" stroke="${C.white}" stroke-width="3.2" fill="none"/><path d="M18 25V8h5a4.5 4.5 0 0 1 0 9h-5" stroke="${C.yellow}" stroke-width="3.2" fill="none"/>`,
  new: `${sheet()}<path d="M24 19l1.6 3.4 3.4 1.6-3.4 1.6L24 29l-1.6-3.4L19 24l3.4-1.6z" fill="${C.yellow}" stroke="#b9902a"/>`,
  open: `<path d="M3 8h9l3 3h12v4H3z" fill="#d9a441"/><path d="M3 27l4-12h23l-4 12z" fill="${C.yellow}" stroke="#b9902a" stroke-width="1.2"/><path d="M3 8v19" stroke="#b9902a" stroke-width="1.2"/>`,
  save: `<path d="M4 4h20l4 4v20H4z" fill="${C.blue}" stroke="${C.navy}" stroke-width="1.4"/><rect x="9" y="4" width="13" height="8" fill="${C.paper}"/><rect x="17" y="5.5" width="3" height="5" fill="${C.dark}"/><rect x="8" y="17" width="16" height="11" fill="${C.white}"/><path d="M11 21h10M11 24.5h10" stroke="${C.mid}" stroke-width="1.4"/>`,
  undo: `<path d="M9 12h11a7 7 0 0 1 0 14h-6" fill="none" stroke="${C.sky}" stroke-width="3.4" stroke-linecap="round"/><path d="M3 12l8-7v14z" fill="${C.blue}"/>`,
  redo: `<path d="M23 12H12a7 7 0 0 0 0 14h6" fill="none" stroke="${C.sky}" stroke-width="3.4" stroke-linecap="round"/><path d="M29 12l-8-7v14z" fill="${C.blue}"/>`,
  export: `${sheet()}<path d="M11 14h9M11 18h6" stroke="${C.mid}" stroke-width="1.6"/><path d="M14 22h9v-4l7 6.5-7 6.5v-4h-9z" fill="${C.green}" stroke="${C.dgreen}" stroke-width="1.2" transform="translate(-3 -2)"/>`,
  icd: `<circle cx="16" cy="16" r="12" fill="none" stroke="${C.white}" stroke-width="2.4"/><circle cx="16" cy="16" r="5" fill="${C.green}"/><path d="M4 16h24" stroke="${C.yellow}" stroke-width="2"/><path d="M4 16l5-3.5v7zM28 16l-5-3.5v7z" fill="${C.yellow}"/>`,
  move: `<path d="M16 2l5 6h-3v6h6v-3l6 5-6 5v-3h-6v6h3l-5 6-5-6h3v-6H8v3l-6-5 6-5v3h6V8h-3z" fill="${C.yellow}" stroke="#b9902a" stroke-width="1"/>`,
  rotate: `<path d="M16 16V3" stroke="${C.grey}" stroke-width="4"/><circle cx="16" cy="16" r="5" fill="none" stroke="${C.white}" stroke-width="2.2"/><path d="M27 18a11 11 0 0 1-21 3" fill="none" stroke="${C.sky}" stroke-width="2.6"/><path d="M26 9l3 9-8-2z" fill="${C.blue}"/>`,
  leg: `${roundabout(2)}<circle cx="25" cy="7" r="6" fill="${C.green}" stroke="${C.dgreen}"/><path d="M25 3.5v7M21.5 7h7" stroke="${C.white}" stroke-width="2.2"/>`,
  erase: `<path d="M4 22l12-13 11 10-8 9h-9z" fill="#f08aa0" stroke="#b55a6e" stroke-width="1.4"/><path d="M4 22l6-6 10 9-2 3h-8z" fill="${C.paper}" stroke="#b55a6e" stroke-width="1.4"/><path d="M15 29h13" stroke="${C.grey}" stroke-width="2"/>`,
  zoom: glass(),
  zoomExtents: `<path d="M2 9V2h7M23 2h7v7M30 23v7h-7M9 30H2v-7" fill="none" stroke="${C.sky}" stroke-width="2.4"/>${glass(14, 14)}`,
  zoomWindow: `<rect x="2" y="2" width="16" height="12" fill="${C.blue}" fill-opacity=".25" stroke="${C.sky}" stroke-width="2" stroke-dasharray="3 2"/>${glass(15, 16)}`,
  zoomObject: `<path d="M3 21l7-14 9 5z" fill="${C.green}" fill-opacity=".5" stroke="${C.green}" stroke-width="1.6"/>${glass(16, 16)}`,
  zoomPrevious: `${glass(16, 15)}<path d="M2 6h8l-3-3M10 6l-3 3" stroke="${C.sky}" stroke-width="2" fill="none" stroke-linecap="round"/>`,
  pan: `<path d="M10 17V8a2 2 0 0 1 4 0v7V5a2 2 0 0 1 4 0v10V7a2 2 0 0 1 4 0v9-5a2 2 0 0 1 4 0v9c0 6-3.5 10-9 10-4 0-6-2-8-5l-4-6a2 2 0 0 1 3-2.5z" fill="#f5d2b0" stroke="#a8754e" stroke-width="1.4" stroke-linejoin="round"/>`,
  option: `<path d="M5 5h14v18H5z" fill="${C.paper}" stroke="${C.mid}" stroke-width="1.4"/><path d="M11 10h14v18H11z" fill="${C.white}" stroke="${C.mid}" stroke-width="1.4"/><circle cx="18" cy="19" r="4.5" fill="none" stroke="${C.blue}" stroke-width="1.8"/><path d="M18 12.5v2.5M18 23v2.5M11.5 19H14M22 19h2.5" stroke="${C.blue}" stroke-width="1.8"/><circle cx="26" cy="7" r="5" fill="${C.green}"/><path d="M26 4v6M23 7h6" stroke="${C.white}" stroke-width="1.8"/>`,
  rename: `<rect x="2" y="9" width="28" height="14" rx="1" fill="${C.white}" stroke="${C.mid}" stroke-width="1.4"/><path d="M6 19l3-7 3 7M7 17h4M15 12v7h2.5a2 2 0 0 0 0-4H15h2a1.7 1.7 0 0 0 0-3.4H15" fill="none" stroke="${C.dark}" stroke-width="1.5"/><path d="M24 6v20M22 6h4M22 26h4" stroke="${C.blue}" stroke-width="1.8"/>`,
  properties: `<rect x="4" y="3" width="24" height="26" fill="${C.paper}" stroke="${C.mid}" stroke-width="1.4"/><rect x="4" y="3" width="24" height="5" fill="${C.blue}"/><path d="M8 13h6M8 18h6M8 23h6" stroke="${C.mid}" stroke-width="2"/><path d="M17 13h7M17 18h7M17 23h7" stroke="${C.blue}" stroke-width="2"/><path d="M15.5 10v16" stroke="#b7c0ca"/>`,
  check: `<rect x="5" y="5" width="22" height="25" rx="1.5" fill="${C.paper}" stroke="${C.mid}" stroke-width="1.4"/><rect x="11" y="2" width="10" height="6" rx="1" fill="${C.grey}" stroke="${C.mid}"/><path d="M9 18l5 5 9-11" fill="none" stroke="${C.green}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  compare: `<rect x="2" y="4" width="13" height="24" fill="${C.paper}" stroke="${C.mid}" stroke-width="1.3"/><rect x="17" y="4" width="13" height="24" fill="${C.paper}" stroke="${C.mid}" stroke-width="1.3"/><path d="M5 22v-8M9 22v-12M20 22v-5M24 22v-11" stroke="${C.blue}" stroke-width="2.6"/><path d="M27 22v-14" stroke="${C.green}" stroke-width="2.6"/><path d="M12 22v-4" stroke="${C.orange}" stroke-width="2.6"/>`,
  layers: `<path d="M16 4l13 6-13 6-13-6z" fill="${C.yellow}" stroke="#b9902a" stroke-width="1.2"/><path d="M3 15l13 6 13-6" fill="none" stroke="${C.sky}" stroke-width="2.4"/><path d="M3 21l13 6 13-6" fill="none" stroke="${C.green}" stroke-width="2.4"/>`,
  paths: `<path d="M3 29C8 20 6 12 16 11s11-4 13-9" fill="none" stroke="${C.green}" stroke-width="3.2" stroke-linecap="round"/><path d="M3 29C8 20 6 12 16 11" fill="none" stroke="${C.yellow}" stroke-width="3.2" stroke-linecap="round"/><path d="M3 29c2.5-4 3.5-8 5-11" fill="none" stroke="${C.red}" stroke-width="3.2" stroke-linecap="round"/>`,
  speeds: `<path d="M3 18a13 13 0 0 1 26 0" fill="none" stroke="${C.grey}" stroke-width="3"/><path d="M3 18a13 13 0 0 1 6-11" fill="none" stroke="${C.green}" stroke-width="3"/><path d="M23 7a13 13 0 0 1 6 11" fill="none" stroke="${C.red}" stroke-width="3"/><path d="M16 18l6-8" stroke="${C.white}" stroke-width="2.4" stroke-linecap="round"/><circle cx="16" cy="18" r="2.5" fill="${C.white}"/><rect x="8" y="23" width="16" height="6" rx="1" fill="${C.blue}"/>`,
  sight: `<path d="M3 28L29 28L29 6z" fill="${C.purple}" fill-opacity=".35" stroke="${C.purple}" stroke-width="2" stroke-linejoin="round"/><path d="M24 28v-5h5" fill="none" stroke="${C.white}" stroke-width="1.5"/><path d="M7 28l2-3M12 28l1.5-2.5M17 28l1-2" stroke="${C.white}" stroke-width="1.2"/><circle cx="5" cy="27" r="2.5" fill="${C.yellow}"/>`,
  landtake: `<path d="M5 9l9-5 13 6 1 13-9 6-14-4z" fill="#ff00ff" fill-opacity=".15" stroke="#ff4dff" stroke-width="2" stroke-dasharray="4 2.5" stroke-linejoin="round"/><circle cx="16" cy="16" r="5" fill="none" stroke="${C.white}" stroke-width="2"/>`,
  photo: `<rect x="2" y="5" width="28" height="22" fill="#7cc0f0" stroke="${C.grey}" stroke-width="1.5"/><path d="M2 27l9-11 6 7 4-4 9 8z" fill="${C.dgreen}"/><circle cx="23" cy="11" r="3" fill="${C.yellow}"/>`,
  regen: `<path d="M26 12a11 11 0 0 0-19-3" fill="none" stroke="${C.sky}" stroke-width="2.8"/><path d="M5 3v8h8z" fill="${C.blue}"/><path d="M6 20a11 11 0 0 0 19 3" fill="none" stroke="${C.green}" stroke-width="2.8"/><path d="M27 29v-8h-8z" fill="${C.dgreen}"/>`,
  help: `<circle cx="16" cy="16" r="13" fill="${C.blue}" stroke="${C.navy}" stroke-width="1.4"/><path d="M11.5 12.5a4.5 4.5 0 1 1 6.5 4c-1.4.8-2 1.6-2 3.2" fill="none" stroke="${C.white}" stroke-width="3" stroke-linecap="round"/><circle cx="16" cy="24.5" r="2" fill="${C.white}"/>`,
  selfcheck: `<path d="M16 3l11 4v8c0 7-5 12-11 14C10 27 5 22 5 15V7z" fill="${C.dgreen}" stroke="#1f6b39" stroke-width="1.4"/><path d="M10.5 16l4 4 7-8" fill="none" stroke="${C.white}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
  report: `<path d="M4 5h24v16H14l-6 6v-6H4z" fill="${C.paper}" stroke="${C.mid}" stroke-width="1.4" stroke-linejoin="round"/><path d="M16 8v7" stroke="${C.red}" stroke-width="3" stroke-linecap="round"/><circle cx="16" cy="18.5" r="1.8" fill="${C.red}"/>`,
  toolspace: `<rect x="3" y="3" width="26" height="26" fill="${C.paper}" stroke="${C.mid}" stroke-width="1.4"/><rect x="3" y="3" width="5" height="26" fill="${C.blue}"/><path d="M11 8h3M13 8v15M13 13h4M13 18h4M13 23h4" stroke="${C.mid}" stroke-width="1.5" fill="none"/><rect x="17" y="11" width="8" height="4" fill="${C.yellow}"/><rect x="17" y="16" width="8" height="4" fill="${C.green}"/><rect x="17" y="21" width="8" height="4" fill="${C.sky}"/>`,
  panorama: `<rect x="2" y="6" width="28" height="20" fill="${C.paper}" stroke="${C.mid}" stroke-width="1.4"/><rect x="2" y="6" width="28" height="5" fill="${C.blue}"/><path d="M2 16h28M2 21h28M12 11v15" stroke="#aeb8c3" stroke-width="1.2"/><circle cx="7" cy="18.5" r="1.8" fill="${C.green}"/><circle cx="7" cy="23.5" r="1.8" fill="${C.red}"/>`,
  settings: `<path d="M16 9.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z" fill="none" stroke="${C.grey}" stroke-width="6" stroke-dasharray="3.4 1.7"/><circle cx="16" cy="16" r="8" fill="none" stroke="${C.grey}" stroke-width="2.6"/><circle cx="16" cy="16" r="3" fill="${C.blue}"/>`,
  deleteOption: `${sheet()}<path d="M12 14l9 9M21 14l-9 9" stroke="${C.red}" stroke-width="3" stroke-linecap="round"/>`,
  roundabout: roundabout(),
  project: `<path d="M3 7h10l3 3h13v17H3z" fill="${C.yellow}" stroke="#b9902a" stroke-width="1.3"/><circle cx="16" cy="19" r="5" fill="none" stroke="${C.dark}" stroke-width="2"/>`,
  folder: `<path d="M3 8h10l3 3h13v16H3z" fill="${C.yellow}" stroke="#b9902a" stroke-width="1.3"/>`,
  path: `<path d="M3 27C10 18 8 9 29 5" fill="none" stroke="${C.green}" stroke-width="3.2" stroke-linecap="round"/><circle cx="3.5" cy="26.5" r="2.5" fill="${C.yellow}"/>`,
  truck: `<rect x="2" y="9" width="17" height="13" fill="${C.sky}" stroke="${C.navy}" stroke-width="1.3"/><path d="M19 13h6l4 5v4H19z" fill="${C.blue}" stroke="${C.navy}" stroke-width="1.3"/><rect x="21" y="14.5" width="4" height="3" fill="${C.white}"/><circle cx="8" cy="24" r="3" fill="${C.dark}" stroke="${C.grey}" stroke-width="1.4"/><circle cx="24" cy="24" r="3" fill="${C.dark}" stroke="${C.grey}" stroke-width="1.4"/>`,
  grid: `<path d="M4 8h24M4 16h24M4 24h24M8 4v24M16 4v24M24 4v24" stroke="${C.grey}" stroke-width="1.6"/>`,
  polar: `<circle cx="16" cy="16" r="12" fill="none" stroke="${C.grey}" stroke-width="1.6" stroke-dasharray="2.5 2.5"/><path d="M16 16L28 9" stroke="${C.green}" stroke-width="2.4"/><path d="M16 16h12" stroke="${C.grey}" stroke-width="1.6"/><circle cx="16" cy="16" r="2.2" fill="${C.white}"/>`,
  osnap: `<rect x="9" y="9" width="14" height="14" fill="none" stroke="${C.yellow}" stroke-width="2.6"/><path d="M16 3v6M16 23v6M3 16h6M23 16h6" stroke="${C.grey}" stroke-width="1.6"/>`,
  dyn: `<path d="M5 27V5l17 13-8 1z" fill="${C.white}" stroke="${C.dark}" stroke-width="1.3" stroke-linejoin="round"/><rect x="16" y="20" width="14" height="9" fill="${C.blue}" stroke="${C.sky}"/><path d="M19 24.5h8" stroke="${C.white}" stroke-width="1.6"/>`,
  bulbOn: `<path d="M16 3a8.5 8.5 0 0 0-5 15.4V22h10v-3.6A8.5 8.5 0 0 0 16 3z" fill="${C.yellow}" stroke="#b9902a" stroke-width="1.4"/><rect x="11.5" y="23" width="9" height="5" rx="1" fill="${C.grey}"/>`,
  bulbOff: `<path d="M16 3a8.5 8.5 0 0 0-5 15.4V22h10v-3.6A8.5 8.5 0 0 0 16 3z" fill="#4c6178" stroke="#7d93aa" stroke-width="1.4"/><rect x="11.5" y="23" width="9" height="5" rx="1" fill="${C.mid}"/>`,
  pass: `<circle cx="16" cy="16" r="13" fill="#2fae5c"/><path d="M9.5 16.5l4.5 4.5 8.5-9.5" fill="none" stroke="${C.white}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  warn: `<path d="M16 3l14 25H2z" fill="#f2c200" stroke="#a88600" stroke-width="1.2" stroke-linejoin="round"/><path d="M16 11v8" stroke="#2b2b2b" stroke-width="3.4" stroke-linecap="round"/><circle cx="16" cy="23.5" r="2" fill="#2b2b2b"/>`,
  fail: `<circle cx="16" cy="16" r="13" fill="#e0443a"/><path d="M10.5 10.5l11 11M21.5 10.5l-11 11" stroke="${C.white}" stroke-width="3.6" stroke-linecap="round"/>`,
  info: `<circle cx="16" cy="16" r="13" fill="#3d8ee0"/><circle cx="16" cy="9.5" r="2.2" fill="${C.white}"/><path d="M16 14v10" stroke="${C.white}" stroke-width="3.6" stroke-linecap="round"/>`,
  verify: `<path d="M16 3l14 25H2z" fill="none" stroke="#f2c200" stroke-width="2.4" stroke-linejoin="round"/><path d="M16 11v8" stroke="#f2c200" stroke-width="3" stroke-linecap="round"/><circle cx="16" cy="23.5" r="1.8" fill="#f2c200"/>`,
  close: `<path d="M8 8l16 16M24 8L8 24" stroke="${C.grey}" stroke-width="3" stroke-linecap="round"/>`,
  caretDown: `<path d="M8 12h16l-8 9z" fill="${C.grey}"/>`,
  caretRight: `<path d="M12 8v16l9-8z" fill="${C.grey}"/>`,
  plus: `<path d="M16 6v20M6 16h20" stroke="${C.grey}" stroke-width="3.2" stroke-linecap="round"/>`,
  select: `<path d="M7 4v22l6-6 4 9 4-2-4-9h8z" fill="${C.white}" stroke="${C.dark}" stroke-width="1.4" stroke-linejoin="round"/>`,
  cmd: `<path d="M4 9l7 7-7 7" fill="none" stroke="${C.grey}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 24h14" stroke="${C.grey}" stroke-width="3" stroke-linecap="round"/>`,
  model: `<rect x="3" y="5" width="26" height="22" fill="none" stroke="${C.grey}" stroke-width="2"/><path d="M8 22l8-12 8 12" fill="none" stroke="${C.sky}" stroke-width="2"/>`,
  layout: `<rect x="6" y="3" width="20" height="26" fill="${C.paper}" stroke="${C.mid}" stroke-width="1.4"/><rect x="9" y="6" width="14" height="13" fill="none" stroke="${C.blue}" stroke-width="1.4"/><path d="M9 23h14M9 26h8" stroke="${C.mid}" stroke-width="1.4"/>`,
};

/** The SVG text of an icon at a size in px (16 or 32 usually). Unknown names draw an empty square. */
export function icon(name, size = 16) {
  const body = ICONS[name] || `<rect x="4" y="4" width="24" height="24" fill="none" stroke="${C.mid}" stroke-width="2"/>`;
  return `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true" focusable="false">${body}</svg>`;
}
