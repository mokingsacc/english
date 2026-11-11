// Shared maths for the grips: a leg's frame worked out from its parameters alone (so grips sit right even while the
// shape cannot be built), the arc of a curb curve found in the drawing, and where a line meets the circle.
//
//   legFrame(round, leg) -> { C, u, rIn, o, Ri, hw, sNose, sSe, sSx, P(s, t), Se, Sx, nose }
// u points from the centre out along the leg; rIn is the entering driver's right; P(s, t) is the point at station s
// along the leg and t to the right of its axis (docs/design.md, Derived geometry).

export function legFrame(round, leg) {
  const C = round.center;
  const b = (leg.bearing * Math.PI) / 180;
  const u = { x: Math.sin(b), y: Math.cos(b) };
  const rIn = { x: -u.y, y: u.x };
  const o = leg.offsetLeft || 0;
  const Ri = round.icd / 2;
  const hw = leg.splitterWidth / 2;
  const P = (s, t) => ({ x: C.x + s * u.x + (t - o) * rIn.x, y: C.y + s * u.y + (t - o) * rIn.y });
  const root = (v) => Math.sqrt(Math.max(0, v));
  const sNose = root((Ri + leg.splitterLength) ** 2 - o * o);
  const sSe = root(Ri * Ri - (hw - o) ** 2);
  const sSx = root(Ri * Ri - (hw + o) ** 2);
  return { C, u, rIn, o, Ri, hw, sNose, sSe, sSx, P, Se: P(sSe, hw), Sx: P(sSx, -hw), nose: P(sNose, 0) };
}

export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });

/** The leg's geometry in a result (named points), or null. */
export function legGeom(result, id) {
  return result && result.ok && result.geometry ? result.geometry.legs.find((l) => l.id === id) || null : null;
}

const near = (p, q) => Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) < 0.01;

/** The curb arc from point a to point b in a result's curb layer, or null. */
export function curbArc(result, a, b) {
  if (!result || !result.ok || !a || !b) return null;
  for (const p of result.geometry.layers.curb) if (p.type === 'arc' && near(p.a, a) && near(p.b, b)) return p;
  return null;
}

/** The middle point of an arc. */
export function arcMid(p) {
  const a0 = Math.atan2(p.a.y - p.c.y, p.a.x - p.c.x);
  const a1 = Math.atan2(p.b.y - p.c.y, p.b.x - p.c.x);
  let sw = p.ccw ? a1 - a0 : a0 - a1;
  sw = ((sw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const m = a0 + (p.ccw ? 1 : -1) * sw / 2;
  return { x: p.c.x + p.r * Math.cos(m), y: p.c.y + p.r * Math.sin(m) };
}

/** Where the line from p through q, carried on beyond q, first meets the circle (C, R); null when it misses. */
export function rayCircle(p, q, C, R) {
  const dx = q.x - p.x, dy = q.y - p.y;
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  const fx = q.x - C.x, fy = q.y - C.y;
  const bq = fx * ux + fy * uy, cq = fx * fx + fy * fy - R * R;
  const disc = bq * bq - cq;
  if (disc < 0) return null;
  const t = -bq - Math.sqrt(disc);
  const t2 = -bq + Math.sqrt(disc);
  const tt = t >= 0 ? t : t2;
  return tt >= 0 ? { x: q.x + ux * tt, y: q.y + uy * tt } : null;
}

/**
 * A curb radius from a grip drag: the curve's middle point moves away from the corner it rounds (where its straight
 * curb would meet the circle) in step with the radius, so the new radius is the old one scaled by how far the cursor
 * is from that corner, measured along the line from the corner through the grip.
 */
export function radiusFromDrag(r0, corner, grip0, P) {
  const d0x = grip0.x - corner.x, d0y = grip0.y - corner.y;
  const d0 = Math.hypot(d0x, d0y);
  if (!(d0 > 1e-6)) return r0;
  const along = ((P.x - corner.x) * d0x + (P.y - corner.y) * d0y) / d0;
  return (r0 * Math.max(0.05, along)) / d0;
}
