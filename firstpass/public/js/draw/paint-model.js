// Paints the roundabout itself from an evaluate result: land take, sight triangles, islands with their hatch, edge and
// centre lines, yield lines, curbs, the fastest paths coloured by speed with R and V labels at each fitted arc, the leg
// names, the speed legend, and the checks that fail (their `where` in red). Colours and line styles come from
// colors.js LAYERS. Text keeps one screen size at every zoom. A new layer: a few lines here and a row in LAYERS.

import { LAYERS, BUCKET_COLORS, SPEED_BUCKETS, speedBucket, speedColor, SPEED_STOPS, STATUS_COLOR } from './colors.js';
import { traceChain, tracePolygon, closedRuns, hatchPattern, haloText, tracePrim } from './prims.js';

const FONT = '11px "Segoe UI", system-ui, sans-serif';
const BOLD = '600 12px "Segoe UI", system-ui, sans-serif';

function stroke(ctx, st, k = 1) {
  ctx.strokeStyle = st.color;
  ctx.lineWidth = (st.width || 1) * k;
  ctx.setLineDash(st.dash || []);
  ctx.stroke();
}

export function paintModel(ctx, cam, scene) {
  const res = scene.shown;
  if (!res || !res.ok) return;
  const G = res.geometry, D = scene.display, L = G.layers;
  ctx.save();
  ctx.globalAlpha = scene.dim ? 0.32 : 1;
  ctx.lineJoin = 'round';

  if (D.landtake && L.landtake.length) {
    ctx.beginPath(); traceChain(ctx, cam, L.landtake); ctx.closePath();
    ctx.fillStyle = LAYERS.landtake.fill; ctx.fill();
    stroke(ctx, LAYERS.landtake);
  }
  if (D.sight) {
    for (const t of G.sightTriangles) {
      const st = t.stream === 'entering' ? LAYERS.sightEntering : LAYERS.sightCirculating;
      ctx.beginPath(); tracePolygon(ctx, cam, t.polygon);
      ctx.fillStyle = st.fill; ctx.fill(); stroke(ctx, st);
    }
  }
  if (D.islands) paintIslands(ctx, cam, L, scene.dpr);
  if (D.edges) {
    ctx.beginPath(); for (const p of L.edge) tracePrim(ctx, cam, p, true); stroke(ctx, LAYERS.edge);
    ctx.beginPath(); for (const p of L.centerline) tracePrim(ctx, cam, p, true); stroke(ctx, LAYERS.centerline);
    ctx.beginPath(); traceChain(ctx, cam, L.inscribed); stroke(ctx, LAYERS.inscribed);
    ctx.beginPath(); for (const p of L.entrance) tracePrim(ctx, cam, p, true); stroke(ctx, LAYERS.entrance);
    ctx.beginPath(); for (const p of L.exit) tracePrim(ctx, cam, p, true); stroke(ctx, LAYERS.exit);
  }
  if (D.curbs) { ctx.beginPath(); traceChain(ctx, cam, L.curb); stroke(ctx, LAYERS.curb); }
  ctx.setLineDash([]);
  paintFailures(ctx, cam, scene);
  if (D.paths) paintPaths(ctx, cam, res);
  const names = legNamePlaces(ctx, cam, G);
  if (D.speeds && D.paths) paintSpeedLabels(ctx, cam, res, names.map((p) => p.box));
  paintLegNames(ctx, names);
  ctx.restore();
}

function paintIslands(ctx, cam, L, dpr) {
  // The apron is the ring between the central island edge and the raised island; the raised island is inside it.
  if (L.island.length) {
    ctx.beginPath(); traceChain(ctx, cam, L.island); ctx.closePath();
    if (L.apron.length) { traceChain(ctx, cam, L.apron); ctx.closePath(); }
    ctx.fillStyle = LAYERS.apron.fill; ctx.fill('evenodd');
    ctx.fillStyle = hatchPattern(ctx, LAYERS.apron.color, LAYERS.apron.hatch, dpr); ctx.fill('evenodd');
    ctx.beginPath(); traceChain(ctx, cam, L.island); stroke(ctx, LAYERS.island);
  }
  if (L.apron.length) {
    ctx.beginPath(); traceChain(ctx, cam, L.apron); ctx.closePath();
    ctx.fillStyle = LAYERS.island.fill; ctx.fill();
    ctx.fillStyle = hatchPattern(ctx, LAYERS.island.color, LAYERS.island.hatch, dpr); ctx.fill();
    stroke(ctx, LAYERS.apron);
  }
  for (const run of closedRuns(L.splitter)) {
    ctx.beginPath(); traceChain(ctx, cam, run); ctx.closePath();
    ctx.fillStyle = LAYERS.splitter.fill; ctx.fill();
    ctx.fillStyle = hatchPattern(ctx, LAYERS.splitter.color, LAYERS.splitter.hatch, dpr); ctx.fill();
    stroke(ctx, LAYERS.splitter);
  }
}

// One stroke per speed bucket: a few dozen strokes for every path together, not one per segment.
const segs = Array.from({ length: SPEED_BUCKETS }, () => []);
function paintPaths(ctx, cam, res) {
  for (const s of segs) s.length = 0;
  for (const m of res.movements) {
    if (!m.ok || !m.path) continue;
    const p = m.path;
    let px = cam.sx(p.x[0]), py = cam.sy(p.y[0]);
    for (let k = 1; k < p.n; k++) {
      const x = cam.sx(p.x[k]), y = cam.sy(p.y[k]);
      const b = speedBucket(0.5 * (p.speed[k] + p.speed[k - 1]));
      segs[b].push(px, py, x, y);
      px = x; py = y;
    }
  }
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.setLineDash([]);
  for (let b = 0; b < SPEED_BUCKETS; b++) {
    const s = segs[b];
    if (!s.length) continue;
    ctx.beginPath();
    for (let i = 0; i < s.length; i += 4) { ctx.moveTo(s[i], s[i + 1]); ctx.lineTo(s[i + 2], s[i + 3]); }
    ctx.strokeStyle = BUCKET_COLORS[b];
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
  for (const m of res.movements) {
    if (m.ok || !m.place) continue;
    ctx.beginPath(); ctx.arc(cam.sx(m.place.x), cam.sy(m.place.y), 9, 0, 2 * Math.PI);
    ctx.strokeStyle = LAYERS.fail.color; ctx.lineWidth = 2.5; ctx.stroke();
  }
}

const ORDER = { through: 0, left: 1, right: 2 };
const hits = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

// Each label tries four places round its arc's middle point and is left out when none is clear of the labels already
// placed and of the leg names, and when another label already stands for a point this close (the same curve on two paths).
// Zoomed out (the circle smaller than OVERVIEW_PX across) only the fastest of each of R1 to R5 is labelled.
const OVERVIEW_PX = 240;
function paintSpeedLabels(ctx, cam, res, taken) {
  const anchors = [];
  const moves = res.movements.filter((m) => m.ok).sort((a, b) => (ORDER[a.kind] ?? 3) - (ORDER[b.kind] ?? 3));
  let arcs = [];
  for (const m of moves) for (const name of ['R1', 'R2', 'R3', 'R4', 'R5']) if (m.arcs[name] && m.arcs[name].mid) arcs.push({ name, a: m.arcs[name] });
  const across = 2 * res.geometry.radii.inscribed * Math.abs(cam.sx(1) - cam.sx(0));
  if (across < OVERVIEW_PX) {
    const top = new Map();
    for (const it of arcs) { const t = top.get(it.name); if (!t || (it.a.speed || 0) > (t.a.speed || 0)) top.set(it.name, it); }
    arcs = [...top.values()];
  }
  ctx.font = FONT;
  ctx.textBaseline = 'middle';
  for (const { name, a } of arcs) {
    const x = cam.sx(a.mid.x), y = cam.sy(a.mid.y);
    if (x < 0 || y < 0 || x > cam.w || y > cam.h) continue;
    if (anchors.some((q) => Math.abs(q[0] - x) < 40 && Math.abs(q[1] - y) < 20)) continue;
    const r = a.r === Infinity ? 'straight' : `${Math.round(a.r)} ft`;
    const v = a.speed == null ? '' : `, ${Math.round(a.speed)} mph`;
    const text = `${name} ${r}${v}`;
    const w = ctx.measureText(text).width + 4;
    const spots = [[x + 5, y - 8], [x - 5 - w, y - 8], [x + 5, y + 8], [x - 5 - w, y + 8]];
    let at = null;
    for (const [tx, ty] of spots) {
      const box = [tx - 2, ty - 7, w, 14];
      if (box[0] < 0 || box[0] + w > cam.w || !taken.every((t) => !hits(t, box))) continue;
      at = [tx, ty]; taken.push(box); break;
    }
    if (!at) continue;
    anchors.push([x, y]);
    ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 2 * Math.PI); ctx.fillStyle = speedColor(a.speed || 0); ctx.fill();
    haloText(ctx, text, at[0], at[1], LAYERS.pathLabel.color, LAYERS.pathLabel.halo);
  }
}

/** Where each leg's name goes (beyond its splitter island, along the leg) and the box it takes on screen. */
function legNamePlaces(ctx, cam, G) {
  ctx.font = BOLD;
  return G.legs.map((L) => {
    const dx = L.far.x - L.nose.x, dy = L.far.y - L.nose.y, n = Math.hypot(dx, dy) || 1;
    const x = cam.sx(L.nose.x + (dx / n) * 70), y = cam.sy(L.nose.y + (dy / n) * 70);
    const w = ctx.measureText(L.name).width + 6;
    return { text: L.name, x, y, box: [x - w / 2, y - 9, w, 18] };
  });
}

function paintLegNames(ctx, places) {
  ctx.font = BOLD;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const p of places) haloText(ctx, p.text, p.x, p.y, LAYERS.legName.color, LAYERS.legName.halo);
  ctx.textAlign = 'left';
}

/** The `where` of every failing check (and of the check chosen in the Checks window) drawn in its status colour. */
function paintFailures(ctx, cam, scene) {
  const res = scene.shown;
  const marks = [];
  for (const c of res.checks) {
    if (c.status === 'fail') marks.push({ where: c.where, color: LAYERS.fail.color, width: 3.5 });
  }
  if (scene.focus) marks.push({ where: scene.focus.where, color: STATUS_COLOR[scene.focus.status] || LAYERS.focus.color, width: 4.5 });
  if (!marks.length) return;
  ctx.save();
  ctx.globalAlpha = scene.dim ? 0.3 : 0.75;
  ctx.setLineDash([]);
  for (const mk of marks) {
    const w = mk.where || {};
    ctx.strokeStyle = mk.color;
    ctx.fillStyle = mk.color;
    ctx.lineWidth = mk.width;
    if (w.legs && w.legs.length && scene.index) {
      ctx.beginPath();
      for (const it of scene.index.items) {
        if (it.layer !== 'curb' && it.layer !== 'splitter' && it.layer !== 'entrance') continue;
        if (w.legs.includes(it.key.slice(4))) tracePrim(ctx, cam, it.prim, true);
      }
      ctx.stroke();
    }
    for (const id of w.movements || []) {
      const m = res.movements.find((q) => q.id === id);
      if (!m || !m.path) continue;
      ctx.beginPath();
      for (let k = 0; k < m.path.n; k++) {
        const x = cam.sx(m.path.x[k]), y = cam.sy(m.path.y[k]);
        if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.lineWidth = mk.width + 2; ctx.globalAlpha *= 0.6; ctx.stroke(); ctx.globalAlpha /= 0.6; ctx.lineWidth = mk.width;
    }
    for (const poly of w.polygons || []) { ctx.beginPath(); tracePolygon(ctx, cam, poly); ctx.lineWidth = 1.5; ctx.stroke(); ctx.lineWidth = mk.width; }
    for (const p of w.points || []) { ctx.beginPath(); ctx.arc(cam.sx(p.x), cam.sy(p.y), 8, 0, 2 * Math.PI); ctx.stroke(); }
  }
  ctx.restore();
}

/** The speed legend, bottom right of the drawing: what the colours of the fastest paths mean. */
export function paintLegend(ctx, cam, scene) {
  if (!scene.display.paths) return;
  const W = 190, H = 34, x0 = cam.w - W - 12, y0 = cam.h - H - 30;
  ctx.save();
  ctx.fillStyle = 'rgba(22,27,34,0.82)';
  ctx.fillRect(x0 - 8, y0 - 16, W + 16, H + 18);
  ctx.font = FONT;
  ctx.fillStyle = '#c9d1da';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('Fastest path speed, mph', x0, y0 - 3);
  const lo = SPEED_STOPS[0][0], hi = SPEED_STOPS[SPEED_STOPS.length - 1][0];
  for (let i = 0; i < W; i += 2) { ctx.fillStyle = speedColor(lo + ((hi - lo) * i) / W); ctx.fillRect(x0 + i, y0 + 2, 2, 9); }
  ctx.fillStyle = '#c9d1da';
  ctx.textAlign = 'center';
  for (let v = 10; v <= 30; v += 5) ctx.fillText(String(v), x0 + ((v - lo) / (hi - lo)) * W, y0 + 25);
  ctx.restore();
}
