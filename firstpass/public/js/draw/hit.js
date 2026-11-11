// Hit testing against the true lines and arcs of the drawing (never against pixels): the distance from a point to a
// line segment and to a circular arc, the nearest primitive within a tolerance, and whether a primitive lies inside or
// crosses a selection window. Pure maths in world feet; tests/page/hit.test.mjs checks it.
//
// A primitive is the engine's { type: 'line', a, b } or { type: 'arc', a, b, c, r, ccw }. To make a new kind of object
// pickable, give it primitives with an owner key and pass them to nearest() (app/model-index.js builds the list).

const TAU = Math.PI * 2;

export function distToSegment(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - a.x) * dx + (py - a.y) * dy) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = a.x + t * dx - px, qy = a.y + t * dy - py;
  return Math.sqrt(qx * qx + qy * qy);
}

/** Angle swept from a to b in the arc's own direction, in [0, 2 pi). */
export function arcSweep(p) {
  const a0 = Math.atan2(p.a.y - p.c.y, p.a.x - p.c.x);
  const a1 = Math.atan2(p.b.y - p.c.y, p.b.x - p.c.x);
  let s = p.ccw ? a1 - a0 : a0 - a1;
  s %= TAU;
  if (s < 0) s += TAU;
  // A whole circle drawn as one arc from a point back to itself.
  if (s < 1e-12 && Math.hypot(p.a.x - p.b.x, p.a.y - p.b.y) < 1e-9) s = TAU;
  return s;
}

/** True when the direction from the centre to (px, py) lies within the arc's span. */
export function onArcSpan(p, px, py) {
  const a0 = Math.atan2(p.a.y - p.c.y, p.a.x - p.c.x);
  const ang = Math.atan2(py - p.c.y, px - p.c.x);
  let t = p.ccw ? ang - a0 : a0 - ang;
  t %= TAU;
  if (t < 0) t += TAU;
  return t <= arcSweep(p) + 1e-12;
}

export function distToArc(px, py, p) {
  if (onArcSpan(p, px, py)) return Math.abs(Math.hypot(px - p.c.x, py - p.c.y) - p.r);
  return Math.min(Math.hypot(px - p.a.x, py - p.a.y), Math.hypot(px - p.b.x, py - p.b.y));
}

export function distToPrim(px, py, p) {
  return p.type === 'arc' ? distToArc(px, py, p) : distToSegment(px, py, p.a, p.b);
}

/**
 * The nearest of `items` ([{ prim, key, rank? }]) within tol feet of (x, y), or null. A lower rank wins a near tie (a
 * leg's own line before the circle it touches), so picking at a joint takes the more specific object.
 */
export function nearest(items, x, y, tol) {
  let best = null, bd = Infinity;
  for (const it of items) {
    const d = distToPrim(x, y, it.prim);
    if (d > tol) continue;
    const score = d + (it.rank || 0) * tol * 0.25;
    if (score < bd) { bd = score; best = { ...it, d }; }
  }
  return best;
}

/** Points along a primitive (ends included), at most `step` feet apart along arcs. */
export function primPoints(p, step = 2) {
  if (p.type !== 'arc') return [p.a, p.b];
  const sw = arcSweep(p);
  const n = Math.max(2, Math.min(256, Math.ceil((p.r * sw) / step)));
  const a0 = Math.atan2(p.a.y - p.c.y, p.a.x - p.c.x);
  const dir = p.ccw ? 1 : -1;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const ang = a0 + dir * sw * (i / n);
    out.push({ x: p.c.x + p.r * Math.cos(ang), y: p.c.y + p.r * Math.sin(ang) });
  }
  return out;
}

/** The world box of a primitive (arcs exactly, through their compass extremes). */
export function primBox(p) {
  const xs = [p.a.x, p.b.x], ys = [p.a.y, p.b.y];
  if (p.type === 'arc') {
    for (let q = 0; q < 4; q++) {
      const ang = (q * Math.PI) / 2;
      const x = p.c.x + p.r * Math.cos(ang), y = p.c.y + p.r * Math.sin(ang);
      if (onArcSpan(p, x, y)) { xs.push(x); ys.push(y); }
    }
  }
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

export function boxInside(inner, outer) {
  return inner.x0 >= outer.x0 && inner.x1 <= outer.x1 && inner.y0 >= outer.y0 && inner.y1 <= outer.y1;
}

function inBox(q, box) {
  return q.x >= box.x0 && q.x <= box.x1 && q.y >= box.y0 && q.y <= box.y1;
}

function segCrossesBox(a, b, box) {
  if (inBox(a, box) || inBox(b, box)) return true;
  const c = [{ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 }, { x: box.x1, y: box.y1 }, { x: box.x0, y: box.y1 }];
  for (let i = 0; i < 4; i++) if (segsCross(a, b, c[i], c[(i + 1) % 4])) return true;
  return false;
}

function segsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b);
}

/** A crossing window takes a primitive that lies inside it or crosses its edge. */
export function primCrossesBox(p, box) {
  const pts = primPoints(p, Math.max(0.5, (box.x1 - box.x0 + box.y1 - box.y0) / 200));
  for (let i = 1; i < pts.length; i++) if (segCrossesBox(pts[i - 1], pts[i], box)) return true;
  return false;
}

/** A selection window from two corners: {box, crossing}. Dragged right to left it is a crossing window. */
export function selectionWindow(w0, w1, sx0, sx1) {
  return {
    box: { x0: Math.min(w0.x, w1.x), y0: Math.min(w0.y, w1.y), x1: Math.max(w0.x, w1.x), y1: Math.max(w0.y, w1.y) },
    crossing: sx1 < sx0,
  };
}

/**
 * The owner keys a window selects from `items` ([{ prim, key }]): a window takes an owner whose primitives all lie
 * inside it; a crossing window takes an owner with any primitive inside or crossing it.
 */
export function windowSelect(items, box, crossing) {
  const all = new Map();
  for (const it of items) {
    if (!all.has(it.key)) all.set(it.key, []);
    all.get(it.key).push(it.prim);
  }
  const out = [];
  for (const [key, prims] of all) {
    const hit = crossing ? prims.some((p) => primCrossesBox(p, box)) : prims.every((p) => boxInside(primBox(p), box));
    if (hit) out.push(key);
  }
  return out;
}
