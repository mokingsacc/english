// Paints what sits over the model and changes with every mouse move: the grid, selection and rollover highlights, grips
// (cool, hover, hot), the selection window (blue, solid, left to right) or crossing window (green, dashed, right to
// left), the rubber band line of a point prompt, the object snap marker, the crosshair with its pick box, the UCS icon,
// the north arrow, and a problem sentence by the cursor while the shape cannot be built. A new mark: one function here,
// called from paintOverlay.

import { LAYERS, GRIP, CURSOR, WINDOW, CROSSING } from './colors.js';
import { tracePrim } from './prims.js';

const FONT = '11px "Segoe UI", system-ui, sans-serif';

export function paintGrid(ctx, cam, scene) {
  if (!scene.toggles || !scene.toggles.grid) return;
  // The spacing: a round number of feet that keeps lines at least 14 px apart; every fifth line is darker.
  const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  let s = steps.find((v) => v * cam.k >= 14) || 10000;
  const v = cam.visible();
  ctx.save();
  ctx.lineWidth = 1;
  for (const major of [false, true]) {
    const step = major ? s * 5 : s;
    ctx.beginPath();
    for (let x = Math.ceil(v.x0 / step) * step; x <= v.x1; x += step) { const sx = Math.round(cam.sx(x)) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, cam.h); }
    for (let y = Math.ceil(v.y0 / step) * step; y <= v.y1; y += step) { const sy = Math.round(cam.sy(y)) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(cam.w, sy); }
    ctx.strokeStyle = major ? LAYERS.grid.major : LAYERS.grid.color;
    ctx.stroke();
  }
  ctx.restore();
}

export function paintOverlay(ctx, cam, scene) {
  paintPicked(ctx, cam, scene);
  paintGrips(ctx, cam, scene);
  paintBand(ctx, cam, scene);
  paintUcs(ctx, cam);
  paintNorth(ctx, cam);
  paintCursor(ctx, cam, scene);
}

function paintPicked(ctx, cam, scene) {
  const ix = scene.index;
  if (!ix) return;
  const sel = new Set(scene.selection || []);
  const hov = scene.hover && !sel.has(scene.hover) ? scene.hover : null;
  if (!sel.size && !hov) return;
  ctx.save();
  ctx.lineJoin = 'round';
  for (const [keys, st] of [[hov ? new Set([hov]) : null, LAYERS.hover], [sel, LAYERS.selection]]) {
    if (!keys || !keys.size) continue;
    ctx.beginPath();
    for (const it of ix.items) if (keys.has(it.key) && it.layer !== 'edge' && it.layer !== 'centerline') tracePrim(ctx, cam, it.prim, true);
    ctx.strokeStyle = st.color;
    ctx.lineWidth = st.width;
    ctx.globalAlpha = st === LAYERS.hover ? 0.55 : 0.9;
    ctx.setLineDash(st.dash || []);
    ctx.stroke();
  }
  ctx.restore();
}

function paintGrips(ctx, cam, scene) {
  if (!scene.grips || !scene.grips.length) return;
  const h = GRIP.size / 2;
  ctx.save();
  ctx.setLineDash([]);
  ctx.lineWidth = 1;
  for (const g of scene.grips) {
    const x = Math.round(cam.sx(g.x)), y = Math.round(cam.sy(g.y));
    const fill = g.key === scene.hotGrip ? GRIP.hot : g.key === scene.hoverGrip ? GRIP.hover : GRIP.cool;
    ctx.fillStyle = fill;
    ctx.fillRect(x - h, y - h, GRIP.size, GRIP.size);
    ctx.strokeStyle = GRIP.edge;
    ctx.strokeRect(x - h - 0.5, y - h - 0.5, GRIP.size + 1, GRIP.size + 1);
  }
  ctx.restore();
}

function paintBand(ctx, cam, scene) {
  const b = scene.band;
  if (b && b.kind === 'window') {
    const st = b.crossing ? CROSSING : WINDOW;
    const x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1), w = Math.abs(b.x1 - b.x0), h = Math.abs(b.y1 - b.y0);
    ctx.save();
    ctx.fillStyle = st.fill;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = st.stroke;
    ctx.lineWidth = 1;
    ctx.setLineDash(b.crossing ? [5, 4] : []);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.restore();
  } else if (b && b.kind === 'line') {
    ctx.save();
    ctx.strokeStyle = '#e6ebf0';
    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(b.x0, b.y0); ctx.lineTo(b.x1, b.y1); ctx.stroke();
    if (b.label) {
      ctx.font = FONT; ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(22,27,34,0.85)';
      const tw = ctx.measureText(b.label).width;
      const mx = (b.x0 + b.x1) / 2, my = (b.y0 + b.y1) / 2;
      ctx.fillRect(mx + 6, my - 18, tw + 8, 16);
      ctx.fillStyle = '#e6ebf0'; ctx.fillText(b.label, mx + 10, my - 6);
    }
    ctx.restore();
  }
}

function paintCursor(ctx, cam, scene) {
  const c = scene.cursor;
  if (!c || !c.visible) return;
  ctx.save();
  ctx.setLineDash([]);
  if (c.snap) {
    const x = cam.sx(c.snap.x), y = cam.sy(c.snap.y);
    ctx.strokeStyle = '#ffd400'; ctx.lineWidth = 2;
    ctx.beginPath();
    if (c.snap.kind === 'center') ctx.arc(x, y, 6, 0, 2 * Math.PI);
    else if (c.snap.kind === 'mid') { ctx.moveTo(x - 7, y + 5); ctx.lineTo(x, y - 7); ctx.lineTo(x + 7, y + 5); ctx.closePath(); }
    else if (c.snap.kind === 'quadrant') { ctx.moveTo(x, y - 7); ctx.lineTo(x + 7, y); ctx.lineTo(x, y + 7); ctx.lineTo(x - 7, y); ctx.closePath(); }
    else ctx.rect(x - 6, y - 6, 12, 12);
    ctx.stroke();
  }
  if (c.mode !== 'hand') {
    const x = Math.round(c.sx) + 0.5, y = Math.round(c.sy) + 0.5, a = CURSOR.arm, p = CURSOR.pick / 2;
    ctx.strokeStyle = CURSOR.color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x - a, y); ctx.lineTo(x - p, y); ctx.moveTo(x + p, y); ctx.lineTo(x + a, y);
    ctx.moveTo(x, y - a); ctx.lineTo(x, y - p); ctx.moveTo(x, y + p); ctx.lineTo(x, y + a);
    ctx.stroke();
    if (c.mode !== 'point') ctx.strokeRect(x - p, y - p, 2 * p, 2 * p);
  }
  if (scene.problem) paintProblem(ctx, c.sx + 22, c.sy, scene.problem, cam);
  ctx.restore();
}

function paintProblem(ctx, x, y, text, cam) {
  ctx.font = FONT;
  const lines = wrap(ctx, text, 300);
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 14, h = lines.length * 15 + 10;
  // Above and to the right of the cursor: the dynamic input box sits below and to the right.
  if (x + w > cam.w - 4) x = Math.max(4, x - w - 44);
  y = y - h - 18;
  if (y < 4) y = Math.min(cam.h - h - 4, y + h + 18 + 96);
  ctx.fillStyle = 'rgba(40,16,16,0.94)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = LAYERS.fail.color; ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = '#ffd9d6';
  ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, x + 7, y + 6 + i * 15));
}

function wrap(ctx, text, max) {
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    const t = line ? `${line} ${word}` : word;
    if (ctx.measureText(t).width > max && line) { out.push(line); line = word; } else line = t;
  }
  if (line) out.push(line);
  return out.slice(0, 6);
}

/** The UCS icon at the bottom left: X (red) to the east, Y (green) to the north, a square at the origin. */
function paintUcs(ctx, cam) {
  const x = 22, y = cam.h - 38, L = 34;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.strokeStyle = '#e5484d'; ctx.fillStyle = '#e5484d';
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + L, y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x + L + 7, y); ctx.lineTo(x + L - 2, y - 4); ctx.lineTo(x + L - 2, y + 4); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#46c36f'; ctx.fillStyle = '#46c36f';
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - L); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y - L - 7); ctx.lineTo(x - 4, y - L + 2); ctx.lineTo(x + 4, y - L + 2); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#d8dee6';
  ctx.fillRect(x - 3, y - 3, 6, 6);
  ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = '#e5484d'; ctx.fillText('X', x + L + 10, y + 4);
  ctx.fillStyle = '#46c36f'; ctx.fillText('Y', x - 3, y - L - 11);
  ctx.restore();
}

/** A north arrow at the top left: the drawing is always north up. */
function paintNorth(ctx) {
  const x = 30, y = 46;
  ctx.save();
  ctx.setLineDash([]);
  ctx.fillStyle = '#d8dee6';
  ctx.beginPath(); ctx.moveTo(x, y - 22); ctx.lineTo(x + 9, y + 10); ctx.lineTo(x, y + 3); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#d8dee6'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(x, y - 22); ctx.lineTo(x - 9, y + 10); ctx.lineTo(x, y + 3); ctx.closePath(); ctx.stroke();
  ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('N', x, y - 28);
  ctx.restore();
}
