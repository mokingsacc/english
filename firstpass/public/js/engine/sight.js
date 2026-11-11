// Sight distance.
//
// Stopping sight distance (AASHTO Green Book, Equation 3-2): reaction distance plus braking distance,
//   d = 1.468 t V + 1.075 V^2 / a, rounded up to the next 5 ft.
// Intersection sight distance at a roundabout entry (NCHRP Report 672 section 6.7.3): the driver waiting to
// enter, with the eye 50 ft back from the entrance line in the entry lane, must see
//   d1 = 1.468 Vent tc along the path of cars entering from the next leg upstream (Vent = mean of that
//        movement's entry and circulating speeds), and
//   d2 = 1.468 Vcirc tc along the path of cars already circulating (the left turn passing the entry),
// with tc the critical headway. Each gives a triangle to keep clear: the eye, the conflict point in front of
// the entry, and the point d1 (or d2) back along the conflicting path.

import { dot } from './geom.js';

/** Stopping sight distance in ft for a speed in mph, rounded up to the rules' rounding length. */
export function stoppingSightDistance(v, rr) {
  const raw = stoppingSightDistanceRaw(v, rr);
  const step = rr.get('sight.ssd.roundTo');
  if (!(step > 0)) return raw;
  // A hair of tolerance so that a distance already on a multiple is not pushed up by rounding error.
  return Math.ceil(raw / step - 1e-9) * step;
}

/** Stopping sight distance in ft before rounding. */
export function stoppingSightDistanceRaw(v, rr) {
  if (!(v > 0)) return 0;
  const t = rr.get('sight.ssd.reactionTime');
  const a = rr.get('sight.ssd.decel');
  return rr.get('sight.ssd.reactionFactor') * t * v + (rr.get('sight.ssd.brakeFactor') * v * v) / a;
}

/** Intersection sight distance in ft along a conflicting path driven at v mph. */
export function intersectionSightLength(v, rr) {
  if (!(v > 0)) return 0;
  return rr.get('sight.isd.factor') * v * rr.get('sight.isd.criticalHeadway');
}

/**
 * The eye point of a driver waiting to enter from leg L (derived leg, local coordinates): in the middle of
 * the entry lane, `eyeBack` ft back from the middle of the entrance line. Returns { x, y } or null.
 */
export function entryEyePoint(L, eyeBack) {
  const s = dot(L.entranceMid, L.u) + eyeBack;
  const tSplit = s >= L.sNose ? 0 : (L.splitterWidth / 2) * ((L.sNose - s) / (L.sNose - L.sSe));
  const tCurb = curbLateral(L, s);
  if (!(tCurb > tSplit)) return null;
  return L.P(s, 0.5 * (tSplit + tCurb));
}

/** Lateral offset (from the leg axis, toward the entry side) of the entry curb at station s. */
function curbLateral(L, s) {
  const o = L.offset;
  const frame = (p) => ({ s: dot(p, L.u), t: dot(p, L.rIn) + o });
  if (s >= L.sNose) return L.approachWidth;
  const F = frame(L.F), T1 = frame(L.T1);
  if (s >= T1.s) return F.t + ((T1.t - F.t) * (s - F.s)) / (T1.s - F.s);
  const O = frame(L.entryO), r = L.entryRadius;
  const ds = s - O.s;
  if (Math.abs(ds) > r) return frame(L.T2).t;
  return O.t - Math.sqrt(r * r - ds * ds);
}

/**
 * Walk back `len` ft along the polyline (x, y, s arrays) from the point nearest to `target`, searching only
 * points with index in [from, to]. Returns { conflict, points (from the conflict point back), reached }
 * where reached is the length actually walked (shorter when the path starts first), or null.
 */
export function walkBack(path, target, len, from = 0, to = path.n - 1) {
  const { x, y, s } = path;
  let best = -1, bd = Infinity;
  for (let k = Math.max(0, from); k <= Math.min(path.n - 1, to); k++) {
    const d = (x[k] - target.x) ** 2 + (y[k] - target.y) ** 2;
    if (d < bd) { bd = d; best = k; }
  }
  if (best < 0) return null;
  const s0 = s[best], sEnd = s0 - len;
  const points = [{ x: x[best], y: y[best] }];
  let k = best;
  while (k > 0 && s[k - 1] > sEnd) { k--; points.push({ x: x[k], y: y[k] }); }
  let reached = s0 - s[k];
  if (k > 0) {
    const f = (s[k] - sEnd) / (s[k] - s[k - 1]);
    points.push({ x: x[k] + (x[k - 1] - x[k]) * f, y: y[k] + (y[k - 1] - y[k]) * f });
    reached = len;
  }
  return { conflict: points[0], points, reached };
}

/**
 * One sight triangle: the eye, the conflict point and the path back from it, closed by the sight line.
 * Returns { polygon, eye, conflict, end, length, reached } or null when the path does not pass the entry.
 */
export function sightTriangle(eye, path, target, len, range) {
  const w = walkBack(path, target, len, range ? range[0] : 0, range ? range[1] : path.n - 1);
  if (!w) return null;
  const polygon = [eye, ...w.points];
  return { polygon, eye, conflict: w.conflict, end: w.points[w.points.length - 1], length: len, reached: w.reached };
}

/** Index range of the part of a path inside the inscribed circle (radius Ri about the origin). */
export function insideRange(path, Ri) {
  let a = -1, b = -1;
  for (let k = 0; k < path.n; k++) {
    if (path.x[k] * path.x[k] + path.y[k] * path.y[k] <= Ri * Ri) { if (a < 0) a = k; b = k; }
  }
  return a < 0 ? null : [a, b];
}

/** Signed area of a polygon (counterclockwise positive), for tests and labels. */
export function polygonArea(pts) {
  let A = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    A += p.x * q.y - q.x * p.y;
  }
  return A / 2;
}
