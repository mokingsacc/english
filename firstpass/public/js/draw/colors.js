// The drawing's colours in one table, after the CAD colour index habit on a dark model space: white curbs, grey edge
// lines, yellow dashed centre lines, green splitter islands, cyan central island, and so on. Change a layer's colour
// here and every part of the drawing follows. A new display layer is one row in LAYERS (and one line in DISPLAY when
// she should be able to turn it on and off with LAYER).

export const MODEL_BG = '#212830';

// width in screen px; dash in screen px; fill: a tint under the outline; hatch: a diagonal hatch spacing in px.
export const LAYERS = {
  curb:       { label: 'Curbs', color: '#ffffff', width: 1.6 },
  edge:       { label: 'Edge lines', color: '#a7b0ba', width: 1, dash: [10, 4] },
  centerline: { label: 'Centre lines', color: '#ffff00', width: 1, dash: [18, 4, 3, 4] },
  splitter:   { label: 'Splitter islands', color: '#00ff00', width: 1.4, fill: 'rgba(0,255,0,0.10)', hatch: 7 },
  island:     { label: 'Central island', color: '#00ffff', width: 1.4, fill: 'rgba(0,255,255,0.08)', hatch: 9 },
  apron:      { label: 'Truck apron', color: '#ff9f40', width: 1.2, fill: 'rgba(255,159,64,0.10)', hatch: 4 },
  inscribed:  { label: 'Inscribed circle', color: '#8a96a3', width: 1, dash: [6, 5] },
  entrance:   { label: 'Yield lines', color: '#ffffff', width: 1.4, dash: [5, 3] },
  exit:       { label: 'Exit lines', color: '#8a96a3', width: 1, dash: [2, 4] },
  landtake:   { label: 'Land take', color: '#ff00ff', width: 1, dash: [12, 6], fill: 'rgba(255,0,255,0.05)' },
  sightEntering:    { label: 'Sight triangle, entering', color: '#b08cff', width: 1, fill: 'rgba(176,140,255,0.13)' },
  sightCirculating: { label: 'Sight triangle, circulating', color: '#ffb35c', width: 1, fill: 'rgba(255,179,92,0.13)' },
  pathLabel:  { label: 'Speed labels', color: '#e8edf2', halo: 'rgba(16,20,26,0.85)' },
  legName:    { label: 'Leg names', color: '#7fd4ff', halo: 'rgba(16,20,26,0.85)' },
  fail:       { label: 'Failed check', color: '#ff3b30', width: 3 },
  warn:       { label: 'Warning', color: '#ffcc00', width: 2.5 },
  focus:      { label: 'Chosen check', color: '#4fc3ff', width: 2.5 },
  selection:  { label: 'Selected', color: '#4fa8ff', width: 2.6, dash: [6, 4] },
  hover:      { label: 'Under the cursor', color: '#9fd0ff', width: 2.6 },
  grid:       { label: 'Grid', color: 'rgba(120,136,154,0.16)', major: 'rgba(120,136,154,0.30)' },
};

// Grips as the CAD habit colours them: cool (blue), hover (warmer), hot (red).
export const GRIP = { cool: '#1e7bff', hover: '#ff8a3d', hot: '#ff1a1a', edge: '#0b0f14', size: 8 };

export const CURSOR = { color: '#e6ebf0', pick: 9, arm: 46 };
export const WINDOW = { stroke: '#4fa8ff', fill: 'rgba(60,140,255,0.16)' };
export const CROSSING = { stroke: '#4cd964', fill: 'rgba(60,200,90,0.16)' };

// Display layers she turns on and off (LAYER, the Layers panel, the status bar). key: the scene's view flag.
export const DISPLAY = [
  { key: 'curbs', label: 'Curbs', kw: 'Curbs' },
  { key: 'edges', label: 'Edge lines', kw: 'Edge' },
  { key: 'islands', label: 'Islands', kw: 'Islands' },
  { key: 'paths', label: 'Fastest paths', kw: 'Paths' },
  { key: 'speeds', label: 'Speed labels', kw: 'Speeds' },
  { key: 'sight', label: 'Sight triangles', kw: 'Triangles' },
  { key: 'landtake', label: 'Land take', kw: 'Landtake' },
  { key: 'photo', label: 'Aerial photo', kw: 'pHoto' },
];

export function defaultDisplay() {
  return { curbs: true, edges: true, islands: true, paths: true, speeds: true, sight: false, landtake: false, photo: true };
}

// Speed along the fastest paths: blue slow, green about right, yellow near the limit, red fast (mph).
export const SPEED_STOPS = [[10, [40, 110, 255]], [17, [40, 200, 230]], [22, [90, 220, 70]], [26, [255, 215, 0]], [32, [255, 60, 40]]];

export function speedRGB(v) {
  const s = SPEED_STOPS;
  if (!(v > s[0][0])) return s[0][1];
  for (let i = 1; i < s.length; i++) {
    if (v <= s[i][0]) {
      const [va, ca] = s[i - 1], [vb, cb] = s[i];
      const t = (v - va) / (vb - va);
      return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
    }
  }
  return s[s.length - 1][1];
}

export function speedColor(v) {
  const c = speedRGB(v);
  return `rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`;
}

/** The speed bucket a value falls in (paths are stroked one bucket at a time: a few strokes, not one per segment). */
export const SPEED_BUCKETS = 28;
export const SPEED_MIN = 8, SPEED_MAX = 34;
export function speedBucket(v) {
  const t = (v - SPEED_MIN) / (SPEED_MAX - SPEED_MIN);
  return Math.max(0, Math.min(SPEED_BUCKETS - 1, Math.floor(t * SPEED_BUCKETS)));
}
export const BUCKET_COLORS = Array.from({ length: SPEED_BUCKETS }, (_, i) => speedColor(SPEED_MIN + ((i + 0.5) / SPEED_BUCKETS) * (SPEED_MAX - SPEED_MIN)));

export const STATUS_COLOR = { pass: '#3ccf6e', warn: '#ffcc00', fail: '#ff4a3d', info: '#6fb6ff' };
