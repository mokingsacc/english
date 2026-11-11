// Shared maths for the grips. Every grip takes its place from evaluate's output (named points and the curb chain), never
// from the asked parameters, so a grip always sits on what is drawn even when the engine builds something other than
// what was asked (a curve shortened to fit, a width measured square to the curb).
//   legGeom(result, id)  curbArc(result, a, b)  curveGrip(result, onRoad, onCircle, avoid?)  along(L, d)  bearingOf(C, P)
import { primPoint, primTangent } from '../../engine/index.js';

export { along } from '../model-index.js';   // a point d feet beyond a leg's nose, out along the leg

export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const unit = (v) => { const n = Math.hypot(v.x, v.y) || 1; return { x: v.x / n, y: v.y / n }; };
const near = (p, q) => !!p && !!q && Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) < 0.01;

/** The geometry of a result that was built, or null. */
export function geomOf(result) {
  return result && result.ok && result.geometry ? result.geometry : null;
}

/** The leg's geometry in a result (named points), or null. */
export function legGeom(result, id) {
  const G = geomOf(result);
  return G ? G.legs.find((l) => l.id === id) || null : null;
}

/** The curb arc between points a and b (either way round) in a result's curb layer, or null. */
export function curbArc(result, a, b) {
  const G = geomOf(result);
  if (!G || !a || !b) return null;
  for (const p of G.layers.curb) if (p.type === 'arc' && ((near(p.a, a) && near(p.b, b)) || (near(p.a, b) && near(p.b, a)))) return p;
  return null;
}

/** The middle point of an arc. */
export function arcMid(p) {
  return primPoint(p, 0.5);
}

/** The middle of the arc, or the quarter point farther from `avoid` when the middle is within a fifth of the chord of it. */
export function gripPlace(arc, avoid) {
  const mid = arcMid(arc);
  const chord = Math.hypot(arc.a.x - arc.b.x, arc.a.y - arc.b.y);
  if (!avoid || Math.hypot(mid.x - avoid.x, mid.y - avoid.y) > 0.2 * chord) return mid;
  const q1 = primPoint(arc, 0.25), q3 = primPoint(arc, 0.75);
  const d = (p) => Math.hypot(p.x - avoid.x, p.y - avoid.y);
  return d(q1) >= d(q3) ? q1 : q3;
}

/** Where a ray from q in direction d first meets the circle (C, R) going forward; null when it misses. */
export function rayCircle(q, d, C, R) {
  const u = unit(d);
  const fx = q.x - C.x, fy = q.y - C.y;
  const bq = fx * u.x + fy * u.y, cq = fx * fx + fy * fy - R * R;
  const disc = bq * bq - cq;
  if (disc < 0) return null;
  const t1 = -bq - Math.sqrt(disc), t2 = -bq + Math.sqrt(disc);
  const t = t1 >= 0 ? t1 : t2;
  return t >= 0 ? { x: q.x + u.x * t, y: q.y + u.y * t } : null;
}

/**
 * A leg's curb curve as drawn, between onRoad (where it leaves the approach or departure curb) and onCircle (where it
 * meets the circle): the arc, the grip's place on it, and the corner it rounds (the road curb carried on past onRoad
 * until it meets the inscribed circle). The grip sits at the curve's middle, or a quarter of the way along when `avoid`
 * (the width grip's point) is near the middle, so the two grips do not sit on top of each other. Null when there is no curve.
 */
export function curveGrip(result, onRoad, onCircle, avoid = null) {
  const G = geomOf(result);
  const arc = curbArc(result, onRoad, onCircle);
  if (!G || !arc) return null;
  let dir = null;
  for (const p of G.layers.curb) {
    if (p === arc) continue;
    if (near(p.b, onRoad)) { dir = primTangent(p, true); break; }
    if (near(p.a, onRoad)) { const t = primTangent(p, false); dir = { x: -t.x, y: -t.y }; break; }
  }
  const corner = (dir && rayCircle(onRoad, dir, G.center, G.radii.inscribed)) || onCircle;
  return { arc, mid: gripPlace(arc, avoid), corner, r: arc.r };
}

/**
 * A curb radius from a grip drag: the curve's middle point moves away from the corner it rounds in step with the
 * radius, so the new radius is the drawn one scaled by how far the cursor is from that corner, measured along the line
 * from the corner through the grip.
 */
export function radiusFromDrag(r0, corner, grip0, P) {
  const d0x = grip0.x - corner.x, d0y = grip0.y - corner.y;
  const d0 = Math.hypot(d0x, d0y);
  if (!(d0 > 1e-6)) return r0;
  const alongIt = ((P.x - corner.x) * d0x + (P.y - corner.y) * d0y) / d0;
  return (r0 * Math.max(0.05, alongIt)) / d0;
}

/** The bearing in degrees, clockwise from north, from C to P. */
export function bearingOf(C, P) {
  const b = (Math.atan2(P.x - C.x, P.y - C.y) * 180) / Math.PI;
  return b < 0 ? b + 360 : b;
}
