// Plane geometry on true line segments and circular arcs.
//
// Conventions used everywhere in the engine:
//   x = easting, y = northing, feet.
//   Bearings are compass degrees clockwise from north; the unit vector for bearing b is (sin b, cos b).
//   Math angles (radians) run counterclockwise from east. Counterclockwise (a left turn) is positive.
//   The right of a direction (dx, dy) is (dy, -dx); the left is (-dy, dx).
//
// A primitive is { type: 'line', a, b, tag } or { type: 'arc', a, b, c, r, ccw, tag }, travelled from a to b.
// A chain is an array of primitives, each starting where the previous one ends.

export const DEG = Math.PI / 180;
export const TAU = 2 * Math.PI;

// ---------------------------------------------------------------- vectors

export function pt(x, y) { return { x, y }; }
export function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
export function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
export function scale(a, k) { return { x: a.x * k, y: a.y * k }; }
export function addScaled(a, d, k) { return { x: a.x + d.x * k, y: a.y + d.y * k }; }
export function dot(a, b) { return a.x * b.x + a.y * b.y; }
export function cross(a, b) { return a.x * b.y - a.y * b.x; }
export function len(a) { return Math.sqrt(a.x * a.x + a.y * a.y); }
export function dist(a, b) { const dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }
export function unit(a) { const l = len(a); return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 }; }
export function rightOf(d) { return { x: d.y, y: -d.x }; }
export function leftOf(d) { return { x: -d.y, y: d.x }; }
export function lerp(a, b, t) { return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
export function bearingVec(deg) { const r = deg * DEG; return { x: Math.sin(r), y: Math.cos(r) }; }
export function angleOf(a) { return Math.atan2(a.y, a.x); }
export function polar(r, ang) { return { x: r * Math.cos(ang), y: r * Math.sin(ang) }; }
/** Signed angle turning from direction `from` to direction `to`, counterclockwise positive, in (-pi, pi]. */
export function signedAngle(from, to) { return Math.atan2(cross(from, to), dot(from, to)); }
export function wrapPi(a) {
  a %= TAU;
  if (a <= -Math.PI) a += TAU; else if (a > Math.PI) a -= TAU;
  return a;
}
export function wrap2Pi(a) {
  a %= TAU;
  if (a < 0) a += TAU;
  return a;
}
/** Compass bearing (degrees, 0 to 360) of a direction vector. */
export function bearingOf(d) {
  let b = Math.atan2(d.x, d.y) / DEG;
  if (b < 0) b += 360;
  return b;
}

// ---------------------------------------------------------------- primitives

export function line(a, b, tag) { return { type: 'line', a, b, tag }; }
export function arc(a, b, c, r, ccw, tag) { return { type: 'arc', a, b, c, r, ccw, tag }; }

/** Angle travelled along an arc from a to b in its own direction, in [0, 2 pi). */
export function arcSweep(p) {
  const a0 = Math.atan2(p.a.y - p.c.y, p.a.x - p.c.x);
  const a1 = Math.atan2(p.b.y - p.c.y, p.b.x - p.c.x);
  return wrap2Pi(p.ccw ? a1 - a0 : a0 - a1);
}

export function primLength(p) {
  return p.type === 'line' ? dist(p.a, p.b) : p.r * arcSweep(p);
}

/** Unit direction of travel at the start (atEnd false) or end (atEnd true) of a primitive. */
export function primTangent(p, atEnd) {
  if (p.type === 'line') return unit(sub(p.b, p.a));
  const q = atEnd ? p.b : p.a;
  const rx = (q.x - p.c.x) / p.r, ry = (q.y - p.c.y) / p.r;
  return p.ccw ? { x: -ry, y: rx } : { x: ry, y: -rx };
}

/** Point a fraction f (0 to 1) of the way along a primitive. */
export function primPoint(p, f) {
  if (p.type === 'line') return lerp(p.a, p.b, f);
  const a0 = Math.atan2(p.a.y - p.c.y, p.a.x - p.c.x);
  const ang = a0 + (p.ccw ? 1 : -1) * arcSweep(p) * f;
  return { x: p.c.x + p.r * Math.cos(ang), y: p.c.y + p.r * Math.sin(ang) };
}

export function reversePrim(p) {
  return p.type === 'line' ? line(p.b, p.a, p.tag) : arc(p.b, p.a, p.c, p.r, !p.ccw, p.tag);
}

export function translatePrim(p, dx, dy) {
  const m = (q) => ({ x: q.x + dx, y: q.y + dy });
  return p.type === 'line' ? line(m(p.a), m(p.b), p.tag) : arc(m(p.a), m(p.b), m(p.c), p.r, p.ccw, p.tag);
}

export function translateChain(chain, dx, dy) {
  return chain.map((p) => translatePrim(p, dx, dy));
}

export function chainLength(chain) {
  let s = 0;
  for (const p of chain) s += primLength(p);
  return s;
}

/**
 * Points along a chain for drawing: lines keep their two ends, arcs are cut into pieces no longer than
 * `step` feet and no wider than `maxAngle` radians. Returns [{x, y}].
 */
export function flattenChain(chain, step = 2, maxAngle = 3 * DEG) {
  const out = [];
  for (let i = 0; i < chain.length; i++) {
    const p = chain[i];
    if (i === 0) out.push({ x: p.a.x, y: p.a.y });
    if (p.type === 'arc') {
      const sw = arcSweep(p);
      const n = Math.max(1, Math.ceil(Math.max((p.r * sw) / step, sw / maxAngle)));
      for (let k = 1; k < n; k++) out.push(primPoint(p, k / n));
    }
    out.push({ x: p.b.x, y: p.b.y });
  }
  return out;
}

/** Signed area enclosed by a closed chain of lines and arcs (counterclockwise positive). */
export function closedChainArea(chain) {
  let twice = 0;
  for (const p of chain) {
    if (p.type === 'line') {
      twice += p.a.x * p.b.y - p.a.y * p.b.x;
    } else {
      const phi = (p.ccw ? 1 : -1) * arcSweep(p);
      twice += p.c.x * (p.b.y - p.a.y) - p.c.y * (p.b.x - p.a.x) + p.r * p.r * phi;
    }
  }
  return twice / 2;
}

// ---------------------------------------------------------------- constructions

/**
 * Fillet between a line and a circle centred at the origin.
 * The line passes through P0 with unit direction d; the fillet arc of radius R has its centre on the
 * side m (unit, perpendicular to d) and touches the circle of radius Rc from outside.
 * Returns { O, T1, T2, lambda } where T1 = P0 + lambda d is the tangent point on the line and T2 the
 * tangent point on the circle, taking the first solution met travelling along d; or null if none.
 */
export function filletLineCircle(P0, d, m, R, Rc) {
  const wx = P0.x + R * m.x, wy = P0.y + R * m.y;
  const b = wx * d.x + wy * d.y;
  const c = wx * wx + wy * wy - (Rc + R) * (Rc + R);
  const disc = b * b - c;
  if (!(disc >= 0)) return null;
  const lambda = -b - Math.sqrt(disc);
  const O = { x: wx + lambda * d.x, y: wy + lambda * d.y };
  const T1 = { x: O.x - R * m.x, y: O.y - R * m.y };
  const lo = len(O);
  if (!(lo > 0)) return null;
  const T2 = { x: (O.x * Rc) / lo, y: (O.y * Rc) / lo };
  return { O, T1, T2, lambda };
}

/**
 * Tangent point on the circle of radius r about the origin for a straight line through the outside
 * point P, with the circle on the left of travel. `leaving` false: travel from P to the circle.
 * `leaving` true: travel from the circle to P. Returns the math angle of the tangent point, or NaN.
 */
export function tangentAngleFromPoint(P, r, leaving) {
  const D = len(P);
  if (!(D > r)) return NaN;
  const phi = Math.atan2(P.y, P.x);
  const beta = Math.acos(r / D);
  return leaving ? phi - beta : phi + beta;
}

/** Intersections of two circles: [] or [p, q]. */
export function circleCircle(c1, r1, c2, r2) {
  const dx = c2.x - c1.x, dy = c2.y - c1.y;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (!(d > 0) || d > r1 + r2 || d < Math.abs(r1 - r2)) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const mx = c1.x + (a * dx) / d, my = c1.y + (a * dy) / d;
  return [
    { x: mx - (h * dy) / d, y: my + (h * dx) / d },
    { x: mx + (h * dy) / d, y: my - (h * dx) / d },
  ];
}

/** True when segments ab and cd cross (touching at an end does not count). */
export function segmentsCross(a, b, c, d) {
  const d1 = cross(sub(b, a), sub(c, a)), d2 = cross(sub(b, a), sub(d, a));
  const d3 = cross(sub(d, c), sub(a, c)), d4 = cross(sub(d, c), sub(b, c));
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) &&
    ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}

// ---------------------------------------------------------------- fast distance to chains
//
// A compiled chain packs its primitives into one Float64Array for distance queries in tight loops.
// Per primitive (STRIDE numbers):
//   0 type (0 line, 1 arc)  1 ax  2 ay  3 bx  4 by
//   line: 5 dx  6 dy (unit)  7 length
//   arc:  5 cx  6 cy  7 r  8 direction (+1 counterclockwise, -1 clockwise)  9 sweep  10 sweep above pi (0 or 1)
//   11 clearance required from this primitive

export const STRIDE = 12;

/**
 * side: +1 when the free side (the roadway) is on the left of the chain's direction, -1 when on the right.
 * clearanceOf(tag) gives the clearance for each primitive (0 when omitted).
 */
export function compileChain(chain, side, clearanceOf) {
  const n = chain.length;
  const buf = new Float64Array(n * STRIDE);
  let clrMax = 0;
  for (let i = 0; i < n; i++) {
    const p = chain[i], o = i * STRIDE;
    buf[o + 1] = p.a.x; buf[o + 2] = p.a.y; buf[o + 3] = p.b.x; buf[o + 4] = p.b.y;
    if (p.type === 'line') {
      const dx = p.b.x - p.a.x, dy = p.b.y - p.a.y, L = Math.sqrt(dx * dx + dy * dy);
      buf[o] = 0; buf[o + 5] = L > 0 ? dx / L : 0; buf[o + 6] = L > 0 ? dy / L : 0; buf[o + 7] = L;
    } else {
      const sw = arcSweep(p);
      buf[o] = 1; buf[o + 5] = p.c.x; buf[o + 6] = p.c.y; buf[o + 7] = p.r;
      buf[o + 8] = p.ccw ? 1 : -1; buf[o + 9] = sw; buf[o + 10] = sw > Math.PI ? 1 : 0;
    }
    const clr = clearanceOf ? clearanceOf(p.tag) : 0;
    buf[o + 11] = clr;
    if (clr > clrMax) clrMax = clr;
  }
  return { buf, n, side, clrMax, chain };
}

/**
 * Distance from (x, y) to one compiled primitive. Writes out[0] = distance (never negative) and
 * out[1] = side value (positive on the left of the primitive's direction; for a point beside the
 * primitive this is the signed distance to its line or circle).
 */
export function primDistance(buf, o, x, y, out) {
  if (buf[o] === 0) {
    const ax = buf[o + 1], ay = buf[o + 2], dx = buf[o + 5], dy = buf[o + 6];
    const wx = x - ax, wy = y - ay;
    const along = wx * dx + wy * dy;
    const side = dx * wy - dy * wx;
    out[1] = side;
    if (along <= 0) { out[0] = Math.sqrt(wx * wx + wy * wy); return; }
    if (along >= buf[o + 7]) {
      const ex = x - buf[o + 3], ey = y - buf[o + 4];
      out[0] = Math.sqrt(ex * ex + ey * ey);
      return;
    }
    out[0] = side < 0 ? -side : side;
    return;
  }
  const cx = buf[o + 5], cy = buf[o + 6], r = buf[o + 7], dir = buf[o + 8];
  const vx = x - cx, vy = y - cy;
  const rho = Math.sqrt(vx * vx + vy * vy);
  out[1] = dir * (r - rho);
  const uax = buf[o + 1] - cx, uay = buf[o + 2] - cy, ubx = buf[o + 3] - cx, uby = buf[o + 4] - cy;
  const s1 = dir * (uax * vy - uay * vx), s2 = dir * (vx * uby - vy * ubx);
  const inside = buf[o + 10] === 1 ? (s1 >= 0 || s2 >= 0) : (s1 >= 0 && s2 >= 0);
  if (inside) { const g = rho - r; out[0] = g < 0 ? -g : g; return; }
  const ex = x - buf[o + 1], ey = y - buf[o + 2], fx = x - buf[o + 3], fy = y - buf[o + 4];
  const da = ex * ex + ey * ey, db = fx * fx + fy * fy;
  out[0] = Math.sqrt(da < db ? da : db);
}

const OUT = new Float64Array(2);

/** Signed distance from (x, y) to a compiled chain: positive on its free side. Uses the nearest primitive. */
export function chainSignedDistance(cc, x, y) {
  let best = Infinity, side = 0;
  for (let i = 0; i < cc.n; i++) {
    primDistance(cc.buf, i * STRIDE, x, y, OUT);
    if (OUT[0] < best) { best = OUT[0]; side = OUT[1]; }
  }
  return side * cc.side > 0 ? best : -best;
}

/**
 * Clearance slack at (x, y): on the free side, the smallest (distance minus required clearance) over all
 * primitives; on the far side, minus (distance plus clearance). Zero or more means the point is clear.
 */
export function chainSlack(cc, x, y) {
  let bestU = Infinity, side = 0, clrNear = 0, bestG = Infinity;
  for (let i = 0; i < cc.n; i++) {
    const o = i * STRIDE;
    primDistance(cc.buf, o, x, y, OUT);
    if (OUT[0] < bestU) { bestU = OUT[0]; side = OUT[1]; clrNear = cc.buf[o + 11]; }
    const g = OUT[0] - cc.buf[o + 11];
    if (g < bestG) bestG = g;
  }
  return side * cc.side > 0 ? bestG : -bestU - clrNear;
}

// ---------------------------------------------------------------- distance to one primitive, and roots

/** Distance from p to the segment from a to b. */
export function segmentDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, wx = p.x - a.x, wy = p.y - a.y;
  const ll = dx * dx + dy * dy;
  let t = ll > 0 ? (wx * dx + wy * dy) / ll : 0;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const ex = wx - t * dx, ey = wy - t * dy;
  return Math.sqrt(ex * ex + ey * ey);
}

/** Distance from p to the arc from a to b about c with radius r, counterclockwise when ccw is true. */
export function arcDistance(p, a, b, c, r, ccw) {
  const a0 = Math.atan2(a.y - c.y, a.x - c.x);
  const sw = arcSweep({ a, b, c, ccw });
  const ap = Math.atan2(p.y - c.y, p.x - c.x);
  const t = wrap2Pi(ccw ? ap - a0 : a0 - ap);
  if (t <= sw) return Math.abs(Math.sqrt((p.x - c.x) ** 2 + (p.y - c.y) ** 2) - r);
  return Math.min(dist(p, a), dist(p, b));
}

/**
 * Root of a non-decreasing function f on [lo, hi]. Where f is not defined it may answer -Infinity (below
 * the range it is defined on) or Infinity (above it). Bisection runs while either end of the bracket is not
 * finite, then Illinois regula falsi. Stops when |f| <= ftol or the bracket is shorter than xtol.
 * Returns { x, fx, lo, hi, flo, fhi }: x is the end with the smaller |f|, and flo <= 0 <= fhi when f(lo) <= 0
 * <= f(hi) to start with. The caller judges whether fx is close enough to zero: at a jump it is not.
 */
export function bracketRoot(f, lo, hi, xtol, ftol, maxIter = 200) {
  let flo = f(lo), fhi = f(hi);
  if (!(flo <= 0) || !(fhi >= 0)) {
    const useLo = Math.abs(flo) <= Math.abs(fhi);
    return { x: useLo ? lo : hi, fx: useLo ? flo : fhi, lo, hi, flo, fhi };
  }
  let a = flo, b = fhi, last = 0;
  for (let it = 0; it < maxIter; it++) {
    if (-flo <= ftol) return { x: lo, fx: flo, lo, hi, flo, fhi };
    if (fhi <= ftol) return { x: hi, fx: fhi, lo, hi, flo, fhi };
    if (hi - lo <= xtol) break;
    let m = a > -Infinity && b < Infinity ? lo + ((hi - lo) * -a) / (b - a) : 0.5 * (lo + hi);
    if (!(m > lo && m < hi)) m = 0.5 * (lo + hi);
    const fm = f(m);
    if (fm !== fm) break;
    if (fm <= 0) {
      lo = m; flo = a = fm;
      if (last === -1) b *= 0.5;
      last = -1;
    } else {
      hi = m; fhi = b = fm;
      if (last === 1) a *= 0.5;
      last = 1;
    }
  }
  const useLo = -flo <= fhi;
  return { x: useLo ? lo : hi, fx: useLo ? flo : fhi, lo, hi, flo, fhi };
}
