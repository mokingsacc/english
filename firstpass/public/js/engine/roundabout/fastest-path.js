// Fastest paths (NCHRP Report 672 section 6.7.1): the smoothest, flattest path of one car through the
// roundabout, ignoring lane lines, kept clear of curbs, centre lines and painted edges.
//
// Computed as a racing line: minimum bending energy inside the corridor. Along a reference line sampled
// every few feet, each point may move sideways by a_k along its normal within [lo_k, hi_k]; the sum of
// squared second differences of the points is minimised (a pentadiagonal box QP, solved by qp.js). The
// solution becomes the next reference and the problem is solved again, so the side moves stay small.
// Then the path's curvature is split into turning runs and the radii R1 to R5 are fitted.

import { solveBoxQP, createQPWorkspace } from '../qp.js';
import { signedAngle } from '../geom.js';
import {
  movementChains, compileMovement, clearanceFor, initialReference, normals, computeBounds, resampleStations,
  ensure, polylineLength, hyp,
} from './corridor.js';

const KAPPA_ZERO = 1e-5; // 1/ft; flatter than a 100,000 ft radius counts as straight
const WINDOWS = []; // scratch for smallestRadius: (first point, last point, radius) per window

/** Every movement from each leg to every other leg (no U-turns), entry legs in input order. */
export function listMovements(G) {
  const out = [];
  const nLegs = G.legs.length;
  for (const A of G.legs) {
    for (let step = 1; step < nLegs; step++) {
      const B = G.legs[G.ccw[(G.pos[A.idx] + step) % nLegs]];
      const turn = (signedAngle({ x: -A.u.x, y: -A.u.y }, B.u) * 180) / Math.PI;
      const kind = Math.abs(turn) <= 45 ? 'through' : turn > 0 ? 'left' : 'right';
      out.push({ id: `${A.id}-${B.id}`, from: A.id, to: B.id, i: A.idx, j: B.idx, kind, turn, steps: step });
    }
  }
  return out;
}

export function createPathWorkspace() {
  const ws = { cap: 0, u0R: new Float64Array(64), u0L: new Float64Array(64), ordR: new Int32Array(64), ordL: new Int32Array(64) };
  ensure(ws, 512);
  ws.qcap = 0;
  ensureQP(ws, 512);
  return ws;
}

function ensureQP(ws, n) {
  if (ws.qcap >= n) return;
  const cap = Math.max(n, Math.ceil(ws.qcap * 1.5), 256);
  ws.D0 = new Float64Array(cap); ws.D1 = new Float64Array(cap); ws.D2 = new Float64Array(cap);
  ws.q = new Float64Array(cap); ws.x = new Float64Array(cap); ws.qlo = new Float64Array(cap); ws.qhi = new Float64Array(cap);
  ws.qp = createQPWorkspace(cap);
  ws.qcap = cap;
}

/**
 * Station plan for a pass: spacing h0 through the roundabout and out to `fp.station.fine` ft past each
 * nose, growing to `fp.station.far` at the far ends. h0 is `fp.station`, or more on a larger circle. The first of several passes uses twice the spacing:
 * it only has to find the shape for the next pass to linearise about.
 */
export function stationPlan(G, rr, pass, passes) {
  // On a larger circle the curves are flatter, so the points can be further apart for the same sag of the
  // path between them (sag = spacing squared / (8 radius)) on the tightest curve, the one round the island.
  const rTight = Math.max(1, G.Rc + rr.get('fp.offset.curb'));
  const base = Math.max(rr.get('fp.station'), Math.sqrt(8 * rTight * rr.get('fp.station.sag')));
  const h0 = base * (pass === 0 && passes > 1 ? 2 : 1);
  return { h0, hFar: Math.max(h0, rr.get('fp.station.far')), far: Math.max(0, G.lead - rr.get('fp.station.fine')) };
}

/** Solver stopping rules for each pass. Earlier passes are linearised again, so they stop once the bending
 * energy stops falling noticeably; the last pass is solved tightly. */
export function passOptions(pass, passes) {
  // Measured on the test shapes (default, T, skew, large, small, offset, six legs): against a solve to
  // rounding, these move no path point by more than 0.001 ft and no radius by more than 1 part in 100,000.
  if (pass === passes - 1) return { tol: 1e-10, ftol: 1e-9, maxIter: 200 };
  return { tol: 1e-8, ftol: pass === 0 ? 1e-4 : 1e-6, maxIter: 60 };
}

/**
 * Solve one movement. Returns { ok, problems, n, x, y, s } in local coordinates (plain arrays), plus
 * the corridor chains used, or ok false with a plain description of where the path cannot fit.
 * `optionsFor(pass, passes)` may replace the solver's stopping rules (tests use it for a tight reference).
 */
export function solveMovement(G, mv, rr, ws, optionsFor = passOptions) {
  const clr = clearanceFor(rr);
  const chains = movementChains(G, mv.i, mv.j);
  const C = compileMovement(chains, clr);
  const passes = Math.max(1, Math.round(rr.get('fp.passes')));
  const reach = 2 * G.Ri + 60;
  let plan = stationPlan(G, rr, 0, passes);
  let n = initialReference(G, mv.i, mv.j, plan, ws);
  let qpStats = null;
  const iterations = [];

  for (let pass = 0; pass < passes; pass++) {
    const last = pass === passes - 1;
    ensureQP(ws, n);
    normals(ws.rx, ws.ry, n, ws.nx, ws.ny);
    const bad = computeBounds(ws, n, C, reach, last ? 1e-5 : 1e-3);
    if (bad >= 0) return cannotFit(G, mv, ws.rx[bad], ws.ry[bad], bad, n, chains);
    const { lo, hi } = ws;
    // Start and end: pinned to the left bound, two stations each, so the path starts in the lane's heading.
    lo[0] = hi[0]; lo[1] = hi[1]; lo[n - 2] = hi[n - 2]; lo[n - 1] = hi[n - 1];
    if (!(hi[0] < reach && hi[1] < reach && hi[n - 2] < reach && hi[n - 1] < reach)) {
      return cannotFit(G, mv, ws.rx[0], ws.ry[0], 0, n, chains);
    }
    assemble(ws, n, plan.h0);
    const x = ws.x;
    for (let k = 0; k < n; k++) x[k] = 0 < lo[k] ? lo[k] : 0 > hi[k] ? hi[k] : 0;
    const opt = optionsFor(pass, passes);
    qpStats = solveBoxQP({ n, D0: ws.D0, D1: ws.D1, D2: ws.D2, q: ws.q, lo, hi, x, ...opt }, ws.qp);
    iterations.push(qpStats.iterations);
    const { rx, ry, nx, ny, px, py } = ws;
    for (let k = 0; k < n; k++) { px[k] = rx[k] + x[k] * nx[k]; py[k] = ry[k] + x[k] * ny[k]; }
    if (!last) {
      plan = stationPlan(G, rr, pass + 1, passes);
      ensure(ws, Math.ceil(polylineLength(px, py, n) / plan.h0) + 8);
      n = resampleStations(ws.px, ws.py, n, plan, ws.rx, ws.ry, ws);
      // Where the path runs along a straight bound (the far approach and departure) an early pass stops
      // with its points zigzagging by a few thousandths of a foot, and a reference with that zigzag makes the
      // next pass slow. A light [1 2 1] filter removes it; the next pass re-solves the offsets anyway.
      filter121(ws.rx, ws.ry, n, ws.tmp, ws.tmp2);
    }
  }

  const xs = new Array(n), ys = new Array(n), s = new Array(n);
  let acc = 0;
  for (let k = 0; k < n; k++) {
    xs[k] = ws.px[k]; ys[k] = ws.py[k];
    if (k > 0) acc += hyp(xs[k] - xs[k - 1], ys[k] - ys[k - 1]);
    s[k] = acc;
  }
  return { ok: true, problems: [], n, x: xs, y: ys, s, chains, solver: { iterations, converged: qpStats.converged, gradNorm: qpStats.gradNorm } };
}

/** One pass of the [1 2 1] / 4 filter over the inner points; the end points stay put. */
function filter121(xs, ys, n, tx, ty) {
  for (let k = 1; k < n - 1; k++) {
    tx[k] = 0.25 * (xs[k - 1] + 2 * xs[k] + xs[k + 1]);
    ty[k] = 0.25 * (ys[k - 1] + 2 * ys[k] + ys[k + 1]);
  }
  for (let k = 1; k < n - 1; k++) { xs[k] = tx[k]; ys[k] = ty[k]; }
}

/**
 * Bending energy of the path p[k] = c[k] + a[k] n[k], as 0.5 a'Aa + q'a.
 * At each inner station the curvature is the second divided difference
 *   kappa[k] = (2 / (h- + h+)) ((p[k+1] - p[k]) / h+ - (p[k] - p[k-1]) / h-)
 * weighted by its share of length (h- + h+) / 2, then scaled by h0^3 so that on uniform spacing h0 the
 * sum is exactly the design's sum of |p[k-1] - 2 p[k] + p[k+1]|^2. The spacings come from the reference.
 */
function assemble(ws, n, h0) {
  const { rx, ry, nx, ny, D0, D1, D2, q } = ws;
  for (let k = 0; k < n; k++) { D0[k] = 0; D1[k] = 0; D2[k] = 0; q[k] = 0; }
  const h03 = h0 * h0 * h0;
  for (let k = 1; k <= n - 2; k++) {
    const hm = hyp(rx[k] - rx[k - 1], ry[k] - ry[k - 1]);
    const hp = hyp(rx[k + 1] - rx[k], ry[k + 1] - ry[k]);
    const sum = hm + hp;
    const al = 2 / (hm * sum), ga = 2 / (hp * sum), be = -(al + ga);
    const w = 0.5 * sum * h03;
    const dx = al * rx[k - 1] + be * rx[k] + ga * rx[k + 1];
    const dy = al * ry[k - 1] + be * ry[k] + ga * ry[k + 1];
    const ax = al * nx[k - 1], ay = al * ny[k - 1];
    const bx = be * nx[k], by = be * ny[k];
    const cx = ga * nx[k + 1], cy = ga * ny[k + 1];
    D0[k - 1] += w * (ax * ax + ay * ay);
    D0[k] += w * (bx * bx + by * by);
    D0[k + 1] += w * (cx * cx + cy * cy);
    D1[k - 1] += w * (ax * bx + ay * by);
    D1[k] += w * (bx * cx + by * cy);
    D2[k - 1] += w * (ax * cx + ay * cy);
    q[k - 1] += w * (ax * dx + ay * dy);
    q[k] += w * (bx * dx + by * dy);
    q[k + 1] += w * (cx * dx + cy * dy);
  }
  for (let k = 0; k < n; k++) D0[k] += 1e-9;
}

function cannotFit(G, mv, x, y, k, n, chains) {
  const A = G.legs[mv.i], B = G.legs[mv.j];
  const r = hyp(x, y);
  let where;
  if (r < G.Ri) {
    const ang = Math.atan2(y, x);
    let best = G.legs[0], bd = Infinity;
    for (const L of G.legs) {
      const d = Math.abs(Math.atan2(Math.sin(ang - L.theta), Math.cos(ang - L.theta)));
      if (d < bd) { bd = d; best = L; }
    }
    where = `inside the circle, near the ${best.name}`;
  } else if (k < n / 2) {
    where = `on the entry of the ${A.name}, about ${Math.round(r - G.Ri)} ft out from the circle`;
  } else {
    where = `on the exit of the ${B.name}, about ${Math.round(r - G.Ri)} ft out from the circle`;
  }
  return {
    ok: false,
    problems: [`The fastest path from the ${A.name} to the ${B.name} cannot fit ${where}: the roadway there is too narrow for a car with the required clearances from the curbs and lines.`],
    place: { x, y, station: k },
    chains,
  };
}

// ---------------------------------------------------------------- radii

/** Signed curvature (counterclockwise positive) at each point, from the circle through three neighbours. */
export function curvature(x, y, n, out) {
  const k = out || new Array(n);
  for (let i = 1; i < n - 1; i++) {
    const ax = x[i] - x[i - 1], ay = y[i] - y[i - 1];
    const bx = x[i + 1] - x[i], by = y[i + 1] - y[i];
    const cx = x[i + 1] - x[i - 1], cy = y[i + 1] - y[i - 1];
    const den = Math.sqrt((ax * ax + ay * ay) * (bx * bx + by * by) * (cx * cx + cy * cy));
    k[i] = den > 0 ? (2 * (ax * by - ay * bx)) / den : 0;
  }
  k[0] = n > 1 ? k[1] : 0;
  k[n - 1] = n > 1 ? k[n - 2] : 0;
  return k;
}

/** Runs of one turning direction: [{ sign, i0, i1 }] with inclusive point indices. */
export function turningRuns(kappa, n) {
  const runs = [];
  let cur = null;
  for (let i = 0; i < n; i++) {
    const sg = kappa[i] > KAPPA_ZERO ? 1 : kappa[i] < -KAPPA_ZERO ? -1 : 0;
    if (cur && sg === cur.sign) { cur.i1 = i; continue; }
    if (cur) runs.push(cur);
    cur = sg === 0 ? null : { sign: sg, i0: i, i1: i };
  }
  if (cur) runs.push(cur);
  return runs;
}

/** Least-squares (algebraic) circle radius through points a..b inclusive; Infinity when they are straight. */
export function fitRadius(x, y, a, b) {
  const m = b - a + 1;
  if (m < 3) return Infinity;
  let mx = 0, my = 0;
  for (let i = a; i <= b; i++) { mx += x[i]; my += y[i]; }
  mx /= m; my /= m;
  let sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0, sz = 0;
  for (let i = a; i <= b; i++) {
    const u = x[i] - mx, v = y[i] - my, z = u * u + v * v;
    sxx += u * u; sxy += u * v; syy += v * v; sxz += u * z; syz += v * z; sz += z;
  }
  const det = sxx * syy - sxy * sxy;
  const scale = (sxx + syy) * (sxx + syy);
  if (!(det > 1e-12 * scale)) return Infinity;
  const D = (-sxz * syy + syz * sxy) / det;
  const E = (-syz * sxx + sxz * sxy) / det;
  const r2 = (D * D + E * E) / 4 + sz / m;
  return r2 > 0 ? Math.sqrt(r2) : Infinity;
}

/**
 * Smallest fitted radius over any window of `win` ft inside the run [i0, i1]. A run shorter than the window
 * is fitted whole, over at least `minWin` ft centred on the run. Returns { r, a, b, sMid }.
 */
export function smallestRadius(x, y, s, n, i0, i1, win, minWin) {
  const L = s[i1] - s[i0];
  if (L <= win) {
    let a = i0, b = i1;
    if (L < minWin) {
      const mid = 0.5 * (s[i0] + s[i1]);
      const sa = mid - minWin / 2, sb = mid + minWin / 2;
      while (a > 0 && s[a] > sa) a--;
      while (b < n - 1 && s[b] < sb) b++;
    }
    return { r: fitRadius(x, y, a, b), a, b, sMid: 0.5 * (s[a] + s[b]) };
  }
  let best = { r: Infinity, a: i0, b: i1, sMid: 0.5 * (s[i0] + s[i1]) };
  const rs = WINDOWS;
  rs.length = 0;
  let b = i0;
  for (let a = i0; a <= i1; a++) {
    while (b < i1 && s[b] - s[a] < win) b++;
    if (s[b] - s[a] < win - 1e-9) break;
    const r = fitRadius(x, y, a, b);
    rs.push(a, b, r);
    if (r < best.r) best = { r, a, b, sMid: 0.5 * (s[a] + s[b]) };
  }
  // On a curve of nearly constant radius many windows come within a hair of the smallest, and which one wins
  // is down to rounding. The arc is then placed in the middle of all windows within 0.1 percent of it, so
  // its middle (used for the distances between curves) stays put.
  if (best.r < Infinity) {
    const lim = best.r * 1.001;
    let first = -1, last = -1;
    for (let q = 0; q < rs.length; q += 3) if (rs[q + 2] <= lim) { if (first < 0) first = q; last = q; }
    if (first >= 0 && last > first) {
      best.a = rs[first]; best.b = rs[last + 1];
      best.sMid = 0.25 * (s[rs[first]] + s[rs[first + 1]] + s[rs[last]] + s[rs[last + 1]]);
    }
  }
  return best;
}

/**
 * Radii of a solved path. Through: R1 (entry), R2 (circulating), R3 (exit). Left turn: R1, R4
 * (circulating), R3. Right turn: R5 (smallest right-turn radius). Values not defined for the movement
 * are null; a missing run gives Infinity. Each fitted arc is reported with its middle station.
 */
export function pathRadii(path, mv, rr) {
  const { x, y, s, n } = path;
  const win = rr.get('fp.window'), minWin = rr.get('fp.window.min');
  const kappa = curvature(x, y, n);
  const runs = turningRuns(kappa, n);
  const fit = (run) => {
    const f = smallestRadius(x, y, s, n, run.i0, run.i1, win, minWin);
    return { r: f.r, a: f.a, b: f.b, sMid: f.sMid, s0: s[f.a], s1: s[f.b] };
  };
  const none = { r: Infinity, a: -1, b: -1, sMid: NaN };
  // Every turning run is fitted once; the named radii pick from these. All of them are kept (runArcs) so the
  // speed along the path can follow every curve, not only the named ones.
  const fits = runs.map((run) => ({ ...fit(run), sign: run.sign }));
  const out = { R1: null, R2: null, R3: null, R4: null, R5: null, arcs: {}, kappa, runs, runArcs: fits };
  const fitOf = (run) => fits[runs.indexOf(run)];

  if (mv.kind === 'right') {
    let best = none;
    runs.forEach((run, q) => { if (run.sign < 0 && fits[q].r < best.r) best = fits[q]; });
    out.R5 = best.r; out.arcs.R5 = best;
    return out;
  }

  // The circulating run: the left-turning run that comes closest to the centre.
  let circ = -1, closest = Infinity;
  runs.forEach((run, idx) => {
    if (run.sign <= 0) return;
    for (let i = run.i0; i <= run.i1; i++) {
      const d = x[i] * x[i] + y[i] * y[i];
      if (d < closest) { closest = d; circ = idx; }
    }
  });
  let entryRun = null, exitRun = null, circArc = none;
  if (circ >= 0) {
    circArc = fits[circ];
    for (let q = circ - 1; q >= 0; q--) if (runs[q].sign < 0) { entryRun = runs[q]; break; }
    for (let q = circ + 1; q < runs.length; q++) if (runs[q].sign < 0) { exitRun = runs[q]; break; }
  } else {
    // No left-turning run at all: split the right-turning runs at the point nearest the centre.
    let iMin = 0;
    for (let i = 0; i < n; i++) if (x[i] * x[i] + y[i] * y[i] < x[iMin] * x[iMin] + y[iMin] * y[iMin]) iMin = i;
    for (const run of runs) {
      if (run.sign >= 0) continue;
      if (run.i1 <= iMin) entryRun = run;
      else if (!exitRun && run.i0 >= iMin) exitRun = run;
    }
  }
  const e = entryRun ? fitOf(entryRun) : none;
  const xr = exitRun ? fitOf(exitRun) : none;
  out.R1 = e.r; out.arcs.R1 = e;
  out.R3 = xr.r; out.arcs.R3 = xr;
  if (mv.kind === 'left') { out.R4 = circArc.r; out.arcs.R4 = circArc; }
  else { out.R2 = circArc.r; out.arcs.R2 = circArc; }
  return out;
}
