// Tracing the engine's true lines and arcs onto a 2D canvas through the camera: arcs stay arcs (canvas arc() in screen
// space, the y flip turning a counterclockwise world arc into an anticlockwise canvas one), never polylines. Also the
// hatch patterns and the halo text the drawing uses. A new primitive type: one more branch in tracePrim.

export function tracePrim(ctx, cam, p, move) {
  if (p.type === 'arc') {
    const cx = cam.sx(p.c.x), cy = cam.sy(p.c.y), r = p.r * cam.k;
    const a0 = Math.atan2(p.a.y - p.c.y, p.a.x - p.c.x);
    let a1 = Math.atan2(p.b.y - p.c.y, p.b.x - p.c.x);
    if (Math.abs(p.a.x - p.b.x) < 1e-9 && Math.abs(p.a.y - p.b.y) < 1e-9) a1 = a0 + (p.ccw ? 2 * Math.PI : -2 * Math.PI);
    if (move) ctx.moveTo(cam.sx(p.a.x), cam.sy(p.a.y));
    ctx.arc(cx, cy, r, -a0, -a1, !!p.ccw);
    return;
  }
  if (move) ctx.moveTo(cam.sx(p.a.x), cam.sy(p.a.y));
  ctx.lineTo(cam.sx(p.b.x), cam.sy(p.b.y));
}

/** A chain of primitives as one path; a gap between two primitives starts a new piece. */
export function traceChain(ctx, cam, chain) {
  let at = null;
  for (const p of chain) {
    const gap = !at || Math.abs(at.x - p.a.x) > 1e-6 || Math.abs(at.y - p.a.y) > 1e-6;
    tracePrim(ctx, cam, p, gap);
    at = p.b;
  }
}

/** Closed shapes inside a list of primitives: runs that end where they started (splitter islands, circles). */
export function closedRuns(chain) {
  const runs = [];
  let cur = [];
  for (const p of chain) {
    if (cur.length) {
      const last = cur[cur.length - 1];
      if (Math.abs(last.b.x - p.a.x) > 1e-6 || Math.abs(last.b.y - p.a.y) > 1e-6) { runs.push(cur); cur = []; }
    }
    cur.push(p);
    const first = cur[0];
    if (Math.abs(p.b.x - first.a.x) < 1e-6 && Math.abs(p.b.y - first.a.y) < 1e-6) { runs.push(cur); cur = []; }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

export function tracePolygon(ctx, cam, pts) {
  for (let i = 0; i < pts.length; i++) {
    const x = cam.sx(pts[i].x), y = cam.sy(pts[i].y);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

const hatches = new Map();
/** A diagonal hatch (the ANSI31 look) in a colour and spacing, made once. */
export function hatchPattern(ctx, color, spacing, dpr = 1) {
  const key = `${color}|${spacing}|${dpr}`;
  let pat = hatches.get(key);
  if (pat) return pat;
  const s = Math.max(3, Math.round(spacing * dpr));
  const c = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(s, s) : Object.assign(document.createElement('canvas'), { width: s, height: s });
  const g = c.getContext('2d');
  g.strokeStyle = color;
  g.globalAlpha = 0.45;
  g.lineWidth = Math.max(1, dpr * 0.8);
  g.beginPath();
  g.moveTo(0, s); g.lineTo(s, 0);
  g.moveTo(-1, 1); g.lineTo(1, -1);
  g.moveTo(s - 1, s + 1); g.lineTo(s + 1, s - 1);
  g.stroke();
  pat = ctx.createPattern(c, 'repeat');
  if (pat && pat.setTransform && typeof DOMMatrix === 'function') pat.setTransform(new DOMMatrix([1 / dpr, 0, 0, 1 / dpr, 0, 0]));
  hatches.set(key, pat);
  return pat;
}

/** Text that stays readable over any background: a dark halo, then the text. */
export function haloText(ctx, text, x, y, color, halo = 'rgba(16,20,26,0.85)') {
  ctx.lineWidth = 3;
  ctx.strokeStyle = halo;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}
