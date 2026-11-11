// The corridor a fastest path must stay inside, for one movement from leg i to leg j.
//
// Right chain (the roadway on its left): the entry edge and curb of i, the inscribed circle
// counterclockwise to j's exit curb, then the exit curb and edge of j.
// Left chain (the roadway on its right): the centre line and splitter entry edge of i up to Se, the straight
// tangent from Se to the central island, the island counterclockwise, the tangent to j's Sx, then the
// splitter exit edge and centre line of j. When the straight line from Se to Sx already clears the island
// (a right turn) the island is left out and that straight line is used.
//
// The bounds of the lateral offset along each station's normal come from the true distance to these
// lines and arcs, less the clearance each one needs, found by bracketing and regula falsi on that distance.

import {
  line, arc, sub, unit, cross, polar, wrap2Pi, tangentAngleFromPoint, compileChain, primDistance, STRIDE,
} from '../geom.js';

const ORIGIN = { x: 0, y: 0 };

/** Length of (dx, dy). Math.hypot guards against overflow this never meets, and is several times slower. */
export function hyp(dx, dy) {
  return Math.sqrt(dx * dx + dy * dy);
}
const EXTEND = 20; // ft the corridor chains run past the ends of the reference line

export function clearanceFor(rr) {
  const curb = rr.get('fp.offset.curb');
  const cl = rr.get('fp.offset.centerline');
  const paint = rr.get('fp.offset.paint');
  return (tag) => (tag === 'centerline' ? cl : tag === 'edge' ? paint : curb);
}

/** Boundary chains (local coordinates) for the movement from leg index i to leg index j. */
export function movementChains(G, i, j) {
  const A = G.legs[i], B = G.legs[j];
  const reach = G.lead + EXTEND;

  const right = [
    line(A.P(A.sNose + reach, A.approachWidth), A.F, 'edge'),
    line(A.F, A.T1, 'curb'),
    A.entryArc,
  ];
  const sweep = wrap2Pi(B.theta - A.theta) + B.alphaT2x - A.alphaT2;
  if (sweep > 1e-9) right.push(arc(A.T2, B.T2x, ORIGIN, G.Ri, true, 'curb'));
  right.push(B.exitArc, line(B.T1x, B.Fx, 'curb'), line(B.Fx, B.P(B.sNose + reach, -B.departWidth), 'edge'));

  const left = [
    line(A.P(A.sNose + reach, 0), A.nose, 'centerline'),
    line(A.nose, A.Se, 'splitter'),
  ];
  const t1 = tangentAngleFromPoint(A.Se, G.Rc, false);
  const t2 = tangentAngleFromPoint(B.Sx, G.Rc, true);
  const P1 = polar(G.Rc, t1), P2 = polar(G.Rc, t2);
  const leftOfChord = cross(unit(sub(B.Sx, A.Se)), sub(ORIGIN, A.Se));
  let hullTouchesIsland = false;
  if (leftOfChord < G.Rc) {
    // The straight line from Se to Sx would cut the island: go round it on the two tangents.
    left.push(line(A.Se, P1, 'hull'));
    if (wrap2Pi(t2 - t1) > 1e-9) left.push(arc(P1, P2, ORIGIN, G.Rc, true, 'island'));
    left.push(line(P2, B.Sx, 'hull'));
    hullTouchesIsland = true;
  } else {
    // A right turn between near legs: the tangents cross before they reach the island. The path may use the
    // circulatory roadway up to where they cross (the straight line from Se to Sx is no curb).
    const d1 = unit(sub(P1, A.Se)), d2 = unit(sub(B.Sx, P2));
    const den = cross(d1, d2);
    const X = Math.abs(den) > 1e-12
      ? { x: A.Se.x + d1.x * (cross(sub(P2, A.Se), d2) / den), y: A.Se.y + d1.y * (cross(sub(P2, A.Se), d2) / den) }
      : null;
    if (X) left.push(line(A.Se, X, 'hull'), line(X, B.Sx, 'hull'));
    else left.push(line(A.Se, B.Sx, 'hull'));
  }
  left.push(line(B.Sx, B.nose, 'splitter'), line(B.nose, B.P(B.sNose + reach, 0), 'centerline'));
  return { right, left, hullTouchesIsland };
}

export function compileMovement(chains, clr) {
  return { R: compileChain(chains.right, 1, clr), L: compileChain(chains.left, -1, clr) };
}

// ---------------------------------------------------------------- reference line

/**
 * Initial reference line for movement i to j into ws.rx, ws.ry: the entry lane centre from the far end,
 * the middle of the circulatory roadway, then the exit lane centre to the far end; smoothed, then
 * resampled at the stations of `plan` (see stationPositions). Returns the number of stations.
 */
export function initialReference(G, i, j, plan, ws) {
  const A = G.legs[i], B = G.legs[j];
  const pts = [];
  pts.push(A.P(A.sNose + G.lead, A.approachWidth / 2));
  pts.push(A.P(A.sNose, A.approachWidth / 2));
  pts.push(A.entranceMid);
  const th0 = Math.atan2(A.entranceMid.y, A.entranceMid.x);
  const th1 = Math.atan2(B.exitMid.y, B.exitMid.x);
  const sweep = wrap2Pi(th1 - th0);
  const lead = 0.3;
  if (sweep > 2 * lead + 0.05) {
    const a0 = th0 + lead, a1 = th0 + sweep - lead;
    const n = Math.max(2, Math.ceil((a1 - a0) / 0.1));
    for (let k = 0; k <= n; k++) pts.push(polar(G.Rm, a0 + ((a1 - a0) * k) / n));
  } else {
    pts.push(polar(G.Rm + G.circWidth / 4, th0 + sweep / 2));
  }
  pts.push(B.exitMid);
  pts.push(B.P(B.sNose, -B.departWidth / 2));
  pts.push(B.P(B.sNose + G.lead, -B.departWidth / 2));

  const m = pts.length;
  let total = 0;
  for (let k = 1; k < m; k++) total += hyp(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y);
  const smoothStep = 4;
  ensure(ws, Math.max(m, Math.ceil(total / Math.min(smoothStep, plan.h0)) + 8));
  for (let k = 0; k < m; k++) { ws.tx[k] = pts[k].x; ws.ty[k] = pts[k].y; }
  let n = resampleUniform(ws.tx, ws.ty, m, smoothStep, ws.rx, ws.ry);
  smooth(ws.rx, ws.ry, n, 5, 3, ws);
  n = resampleStations(ws.rx, ws.ry, n, plan, ws.tx, ws.ty, ws);
  ws.rx.set(ws.tx.subarray(0, n));
  ws.ry.set(ws.ty.subarray(0, n));
  return n;
}

/**
 * Station positions along a path of length L into out (a growable array in ws.pos); returns the count.
 * plan = { h0, hFar, far }: spacing h0 everywhere except within `far` ft of either end, where it grows
 * linearly to hFar at the end (the far approach and departure are straight lane, and cost stations
 * without carrying any curvature). With hFar <= h0 the spacing is uniform.
 */
export function stationPositions(L, plan, ws) {
  const { h0, hFar, far } = plan;
  const out = growPos(ws, Math.ceil(L / Math.max(0.5, h0)) + 8);
  if (!(hFar > h0) || !(far > 0) || L < 2 * far + 4 * h0) {
    const segs = Math.max(2, Math.round(L / h0));
    for (let q = 0; q <= segs; q++) out[q] = (L * q) / segs;
    return segs + 1;
  }
  // Graded offsets measured from an end: spacing h0 at distance `far`, growing at RATE ft per ft toward the end.
  const RATE = 0.15;
  const g = ws.grade || (ws.grade = new Float64Array(256));
  let cnt = 0, d = 0;
  while (d < far && cnt < g.length - 1) {
    g[cnt++] = d;
    d += Math.min(hFar, h0 + (far - d) * RATE);
  }
  const sc = far / d;
  for (let q = 0; q < cnt; q++) g[q] *= sc;
  const core = L - 2 * far;
  const m = Math.max(1, Math.round(core / h0));
  let k = 0;
  for (let q = 0; q < cnt; q++) out[k++] = g[q];
  for (let q = 0; q <= m; q++) out[k++] = far + (core * q) / m;
  for (let q = cnt - 1; q >= 0; q--) out[k++] = L - g[q];
  return k;
}

function growPos(ws, n) {
  if (!ws.pos || ws.pos.length < n) ws.pos = new Float64Array(Math.max(n, 512));
  return ws.pos;
}

/**
 * Resample the polyline (xs, ys, n points) at the stations of `plan`, into (ox, oy), which must be other
 * arrays. Grows the workspace first if needed (so pass ws arrays only through ws). Returns the count.
 */
export function resampleStations(xs, ys, n, plan, ox, oy, ws) {
  const L = polylineLength(xs, ys, n);
  const cnt = stationPositions(L, plan, ws);
  const pos = ws.pos;
  if (ox.length < cnt || oy.length < cnt) throw new Error('resampleStations: output arrays too short');
  let k = 1, acc = 0, segLen = n > 1 ? hyp(xs[1] - xs[0], ys[1] - ys[0]) : 0;
  ox[0] = xs[0]; oy[0] = ys[0];
  for (let q = 1; q < cnt - 1; q++) {
    const target = pos[q];
    while (k < n - 1 && acc + segLen < target) {
      acc += segLen;
      k++;
      segLen = hyp(xs[k] - xs[k - 1], ys[k] - ys[k - 1]);
    }
    const f = segLen > 0 ? Math.min(1, Math.max(0, (target - acc) / segLen)) : 0;
    ox[q] = xs[k - 1] + (xs[k] - xs[k - 1]) * f;
    oy[q] = ys[k - 1] + (ys[k] - ys[k - 1]) * f;
  }
  ox[cnt - 1] = xs[n - 1]; oy[cnt - 1] = ys[n - 1];
  return cnt;
}

/** Length of the polyline (xs, ys, n points). */
export function polylineLength(xs, ys, n) {
  let total = 0;
  for (let k = 1; k < n; k++) total += hyp(xs[k] - xs[k - 1], ys[k] - ys[k - 1]);
  return total;
}

/** Make sure the workspace arrays hold at least n stations. */
export function ensure(ws, n) {
  if (ws.cap >= n) return;
  const cap = Math.max(n, Math.ceil(ws.cap * 1.5), 256);
  for (const k of ['tx', 'ty', 'rx', 'ry', 'nx', 'ny', 'lo', 'hi', 'px', 'py', 'cum', 'tmp', 'tmp2']) {
    const old = ws[k];
    ws[k] = new Float64Array(cap);
    if (old) ws[k].set(old.subarray(0, Math.min(old.length, cap)));
  }
  ws.cap = cap;
}

export function createCorridorWorkspace() {
  const ws = { cap: 0, u0R: new Float64Array(64), u0L: new Float64Array(64), ordR: new Int32Array(64), ordL: new Int32Array(64) };
  ensure(ws, 512);
  return ws;
}

/**
 * Resample the polyline (xs, ys, n points) at equal spacing as close to `spacing` as divides its length.
 * Writes to (ox, oy), which must be other arrays with room for length / spacing + 3 points, and returns
 * the new count. The ends are kept exactly.
 */
export function resampleUniform(xs, ys, n, spacing, ox, oy) {
  const total = polylineLength(xs, ys, n);
  const segs = Math.max(2, Math.round(total / spacing));
  const h = total / segs;
  ox[0] = xs[0]; oy[0] = ys[0];
  let k = 1, acc = 0, segLen = n > 1 ? hyp(xs[1] - xs[0], ys[1] - ys[0]) : 0;
  for (let q = 1; q < segs; q++) {
    const target = q * h;
    while (k < n - 1 && acc + segLen < target) {
      acc += segLen;
      k++;
      segLen = hyp(xs[k] - xs[k - 1], ys[k] - ys[k - 1]);
    }
    const f = segLen > 0 ? Math.min(1, Math.max(0, (target - acc) / segLen)) : 0;
    ox[q] = xs[k - 1] + (xs[k] - xs[k - 1]) * f;
    oy[q] = ys[k - 1] + (ys[k] - ys[k - 1]) * f;
  }
  ox[segs] = xs[n - 1]; oy[segs] = ys[n - 1];
  return segs + 1;
}

/** Moving average over +-half points, repeated `passes` times; the window shrinks near the ends so they stay put. */
function smooth(xs, ys, n, half, passes, ws) {
  const tx = ws.tmp, ty = ws.tmp2;
  for (let p = 0; p < passes; p++) {
    for (let k = 0; k < n; k++) {
      const h = Math.min(half, k, n - 1 - k);
      let sx = 0, sy = 0;
      for (let q = k - h; q <= k + h; q++) { sx += xs[q]; sy += ys[q]; }
      tx[k] = sx / (2 * h + 1);
      ty[k] = sy / (2 * h + 1);
    }
    for (let k = 0; k < n; k++) { xs[k] = tx[k]; ys[k] = ty[k]; }
  }
}

/** Unit left normals of the polyline (rx, ry) into (nx, ny). */
export function normals(rx, ry, n, nx, ny) {
  for (let k = 0; k < n; k++) {
    const a = k > 0 ? k - 1 : 0, b = k < n - 1 ? k + 1 : n - 1;
    const tx = rx[b] - rx[a], ty = ry[b] - ry[a];
    const l = Math.sqrt(tx * tx + ty * ty) || 1;
    nx[k] = -ty / l;
    ny[k] = tx / l;
  }
}

// ---------------------------------------------------------------- bounds

const OUT = new Float64Array(2);

function ensurePrim(ws, n) {
  if (ws.u0R.length >= n) return;
  ws.u0R = new Float64Array(n); ws.u0L = new Float64Array(n);
  ws.ordR = new Int32Array(n); ws.ordL = new Int32Array(n);
}

/** Distances from (x, y) to every primitive, and the primitives sorted nearest first. */
function prep(cc, x, y, u0, ord) {
  const buf = cc.buf, n = cc.n;
  for (let p = 0; p < n; p++) {
    primDistance(buf, p * STRIDE, x, y, OUT);
    u0[p] = OUT[0];
    let q = p;
    while (q > 0 && u0[ord[q - 1]] > OUT[0]) { ord[q] = ord[q - 1]; q--; }
    ord[q] = p;
  }
}

/**
 * Clearance slack at the point a distance `ad` from the station point (see geom.chainSlack), skipping
 * primitives that cannot be nearest because they were already too far from the station point.
 */
function slack(cc, x, y, ad, u0, ord) {
  const buf = cc.buf, n = cc.n, clrMax = cc.clrMax;
  let bestG = Infinity, bestU = Infinity, bestSide = 0, bestClr = 0;
  for (let q = 0; q < n; q++) {
    const p = ord[q];
    const lb = u0[p] - ad;
    if (lb >= bestU && lb - clrMax >= bestG) break;
    const o = p * STRIDE;
    primDistance(buf, o, x, y, OUT);
    const u = OUT[0], clr = buf[o + 11];
    if (u < bestU) { bestU = u; bestSide = OUT[1]; bestClr = clr; }
    const g = u - clr;
    if (g < bestG) bestG = g;
  }
  return bestSide * cc.side > 0 ? bestG : -bestU - bestClr;
}

/**
 * From offset a0 (slack g0 >= 0) move along the normal in direction dir until the slack reaches zero.
 * Returns the offset just on the clear side of that point, or dir * reach when nothing is met.
 */
function boundFrom(cc, cx, cy, nx, ny, dir, a0, g0, reach, tol, u0, ord) {
  let aIn = a0, gIn = g0, aOut = NaN, gOut = 0;
  for (let it = 0; it < 60; it++) {
    let a = aIn + dir * (1.5 * gIn + 0.02);
    let capped = false;
    if (a * dir >= reach) { a = dir * reach; capped = true; }
    const g = slack(cc, cx + a * nx, cy + a * ny, a < 0 ? -a : a, u0, ord);
    if (g < 0) { aOut = a; gOut = g; break; }
    aIn = a; gIn = g;
    if (capped) return a;
  }
  if (aOut !== aOut) return aIn;
  return refine(cc, cx, cy, nx, ny, aIn, gIn, aOut, gOut, tol, u0, ord);
}

/**
 * From offset a0 where the slack g0 is negative, move in direction dir until the slack is no longer
 * negative. Returns the first clear offset, or NaN when none is found within reach.
 */
function enterFrom(cc, cx, cy, nx, ny, dir, a0, g0, reach, tol, u0, ord) {
  let aOut = a0, gOut = g0, aIn = NaN, gIn = 0;
  for (let it = 0; it < 60; it++) {
    let a = aOut + dir * (1.5 * -gOut + 0.02);
    let capped = false;
    if (a * dir >= reach) { a = dir * reach; capped = true; }
    const g = slack(cc, cx + a * nx, cy + a * ny, a < 0 ? -a : a, u0, ord);
    if (g >= 0) { aIn = a; gIn = g; break; }
    aOut = a; gOut = g;
    if (capped) return NaN;
  }
  if (aIn !== aIn) return NaN;
  return refine(cc, cx, cy, nx, ny, aIn, gIn, aOut, gOut, tol, u0, ord);
}

/** Illinois regula falsi on a bracket [aIn (slack >= 0), aOut (slack < 0)]; returns the clear end. */
function refine(cc, cx, cy, nx, ny, aIn, gIn, aOut, gOut, tol, u0, ord) {
  let last = 0;
  for (let it = 0; it < 80; it++) {
    const w = aOut - aIn;
    if ((w < 0 ? -w : w) <= tol || gIn <= 1e-7) break;
    let a = aIn + (w * gIn) / (gIn - gOut);
    const lo = aIn < aOut ? aIn : aOut, hi = aIn < aOut ? aOut : aIn;
    if (!(a > lo && a < hi)) a = 0.5 * (aIn + aOut);
    const g = slack(cc, cx + a * nx, cy + a * ny, a < 0 ? -a : a, u0, ord);
    if (g >= 0) {
      aIn = a; gIn = g;
      if (last === 1) gOut *= 0.5;
      last = 1;
    } else {
      aOut = a; gOut = g;
      if (last === -1) gIn *= 0.5;
      last = -1;
    }
  }
  return aIn;
}

/**
 * Lateral bounds lo[k] <= a <= hi[k] along each station's left normal (ws.rx, ws.ry, ws.nx, ws.ny) for the
 * compiled corridor C = { R, L }. Returns -1 when every station has room, else the first station without.
 */
export function computeBounds(ws, n, C, reach, tol) {
  const { rx, ry, nx, ny, lo, hi } = ws;
  ensurePrim(ws, Math.max(C.R.n, C.L.n));
  const { u0R, u0L, ordR, ordL } = ws;
  let bad = -1;
  for (let k = 0; k < n; k++) {
    const cx = rx[k], cy = ry[k], vx = nx[k], vy = ny[k];
    prep(C.R, cx, cy, u0R, ordR);
    prep(C.L, cx, cy, u0L, ordL);
    const gr = slack(C.R, cx, cy, 0, u0R, ordR);
    const gl = slack(C.L, cx, cy, 0, u0L, ordL);
    let l, h;
    if (gr >= 0 && gl >= 0) {
      l = boundFrom(C.R, cx, cy, vx, vy, -1, 0, gr, reach, tol, u0R, ordR);
      h = boundFrom(C.L, cx, cy, vx, vy, 1, 0, gl, reach, tol, u0L, ordL);
    } else if (gr < 0 && gl >= 0) {
      l = enterFrom(C.R, cx, cy, vx, vy, 1, 0, gr, reach, tol, u0R, ordR);
      if (l === l) {
        const g2 = slack(C.L, cx + l * vx, cy + l * vy, l < 0 ? -l : l, u0L, ordL);
        h = g2 >= 0 ? boundFrom(C.L, cx, cy, vx, vy, 1, l, g2, reach, tol, u0L, ordL) : -Infinity;
      } else h = -Infinity;
    } else if (gl < 0 && gr >= 0) {
      h = enterFrom(C.L, cx, cy, vx, vy, -1, 0, gl, reach, tol, u0L, ordL);
      if (h === h) {
        const g2 = slack(C.R, cx + h * vx, cy + h * vy, h < 0 ? -h : h, u0R, ordR);
        l = g2 >= 0 ? boundFrom(C.R, cx, cy, vx, vy, -1, h, g2, reach, tol, u0R, ordR) : Infinity;
      } else l = Infinity;
    } else {
      l = Infinity; h = -Infinity;
    }
    if (!(l <= h)) {
      if (l - h < 1e-6 && Number.isFinite(l) && Number.isFinite(h)) { const m = 0.5 * (l + h); l = m; h = m; }
      else if (bad < 0) bad = k;
    }
    lo[k] = l; hi[k] = h;
  }
  return bad;
}
