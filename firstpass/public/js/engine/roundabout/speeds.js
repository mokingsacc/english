// Fastest path speeds (NCHRP Report 672 section 6.7.1, Equations 6-1 to 6-4).
//
// Each fitted radius gives a speed from the radius and the cross slope of the curve: entry, exit and right
// turn curves (R1, R3, R5) are taken as sloping 2 percent toward the inside of the curve, the circulating
// curves (R2, R4) 2 percent toward the outside. Then the entry speed is lowered to what a car can shed before
// the circulating curve, and the exit speed to what it can gain after it. Every speed is capped at the
// approach speed of the road. All constants come from the rules table.

/** Speed in mph on a curve of radius r ft. slope is +1 (toward the inside) or -1 (toward the outside). */
export function speedFromRadius(r, slope, rr) {
  if (!(r > 0)) return 0;
  if (r === Infinity) return Infinity;
  const k = rr.get(slope > 0 ? 'speed.eq.pos.k' : 'speed.eq.neg.k');
  const p = rr.get(slope > 0 ? 'speed.eq.pos.p' : 'speed.eq.neg.p');
  return k * Math.pow(r, p);
}

/**
 * The highest speed a car can reach at distance d ft from a point where it travels at v mph, changing speed
 * at rate a ft/s2 over that distance: sqrt((1.47 v)^2 + 2 a d) / 1.47.
 */
export function speedAfter(v, a, d, rr) {
  const f = rr.get('speed.fpsPerMph');
  if (v === Infinity) return Infinity;
  return Math.sqrt((f * v) ** 2 + 2 * a * Math.max(0, d)) / f;
}

/**
 * Speeds for one movement from its radii (see fastest-path.pathRadii).
 * entryCap and exitCap are the approach speeds of the entry and exit legs (mph).
 * Returns { V1, V2, V3, V4, V5, raw, d12, d23, knots } with null for speeds the movement does not have.
 * knots are the points of the path (station s, speed v) the speed profile is built from.
 * V1, V2 and V4 are capped at the entry leg's approach speed, V3 at the exit leg's (the road it leaves on).
 */
export function movementSpeeds(mv, radii, entryCap, exitCap, rr) {
  const out = { V1: null, V2: null, V3: null, V4: null, V5: null, raw: {}, d12: null, d23: null, knots: [] };
  const arcs = radii.arcs;
  if (mv.kind === 'right') {
    const raw = speedFromRadius(radii.R5, 1, rr);
    out.raw.V5 = raw;
    out.V5 = Math.min(raw, entryCap);
    if (arcs.R5 && arcs.R5.a >= 0) out.knots.push(knot(arcs.R5, out.V5, 'V5'));
    addRunKnots(out, radii, entryCap, exitCap, rr);
    return out;
  }
  const circName = mv.kind === 'left' ? 'R4' : 'R2';
  const vName = mv.kind === 'left' ? 'V4' : 'V2';
  const rawCirc = speedFromRadius(radii[circName], -1, rr);
  const raw1 = speedFromRadius(radii.R1, 1, rr);
  const raw3 = speedFromRadius(radii.R3, 1, rr);
  out.raw.V1 = raw1; out.raw[vName] = rawCirc; out.raw.V3 = raw3;
  const vc = Math.min(rawCirc, entryCap);
  let v1 = Math.min(raw1, entryCap);
  let v3 = Math.min(raw3, exitCap);
  const a1 = arcs.R1, ac = arcs[circName], a3 = arcs.R3;
  const has = (a) => a && a.a >= 0 && Number.isFinite(a.sMid);
  if (has(a1) && has(ac)) {
    out.d12 = Math.max(0, ac.sMid - a1.sMid);
    v1 = Math.min(v1, speedAfter(vc, rr.get('speed.decel'), out.d12, rr));
  }
  if (has(ac) && has(a3)) {
    out.d23 = Math.max(0, a3.sMid - ac.sMid);
    v3 = Math.min(v3, speedAfter(vc, rr.get('speed.accel'), out.d23, rr));
  }
  out.V1 = v1; out[vName] = vc; out.V3 = v3;
  if (has(a1)) out.knots.push(knot(a1, v1, 'V1'));
  if (has(ac)) out.knots.push(knot(ac, vc, vName));
  if (has(a3)) out.knots.push(knot(a3, v3, 'V3'));
  addRunKnots(out, radii, entryCap, exitCap, rr);
  return out;
}

/**
 * Knots for the speed profile from the curves that carry no named speed (for example the circulating part of
 * a right turn on a roundabout with many legs), so the profile slows for every curve. Drawing only: these
 * speeds are not reported or checked.
 */
/** A knot: the speed v holds over the fitted stretch [s0, s1] of the path, centred on s. */
function knot(arc, v, name) {
  return { s: arc.sMid, s0: Number.isFinite(arc.s0) ? arc.s0 : arc.sMid, s1: Number.isFinite(arc.s1) ? arc.s1 : arc.sMid, v, name };
}

function addRunKnots(out, radii, entryCap, exitCap, rr) {
  const named = Object.values(radii.arcs).filter((a) => a && a.a >= 0);
  for (const f of radii.runArcs || []) {
    if (!(f.a >= 0) || !Number.isFinite(f.sMid)) continue;
    if (named.some((a) => a === f || (a.sMid >= f.sMid - 1e-9 && a.a === f.a && a.b === f.b))) continue;
    const v = Math.min(speedFromRadius(f.r, f.sign > 0 ? -1 : 1, rr), entryCap, exitCap);
    if (v < Math.min(entryCap, exitCap)) out.knots.push(knot(f, v, null));
  }
  out.knots.sort((p, q) => p.s - q.s);
}

/**
 * Speed at every point of a path (for drawing it coloured by speed): along each fitted curve the curve's
 * speed; between curves, as fast as the deceleration before the next one and the acceleration after the last
 * one allow;
 * never above the approach speeds (the entry leg's before the circulating curve, the exit leg's after it).
 */
export function speedProfile(s, n, knots, entryCap, exitCap, rr, out) {
  const v = out || new Array(n);
  const f = rr.get('speed.fpsPerMph');
  const dec = rr.get('speed.decel'), acc = rr.get('speed.accel');
  let split = s[n - 1] / 2;
  for (const kn of knots) if (kn.name === 'V2' || kn.name === 'V4' || kn.name === 'V5') split = kn.s;
  for (let k = 0; k < n; k++) {
    let best = s[k] <= split ? entryCap : exitCap;
    for (const kn of knots) {
      const before = kn.s0 - s[k], after = s[k] - kn.s1;
      const w = before > 0 ? Math.sqrt((f * kn.v) ** 2 + 2 * dec * before) / f
        : after > 0 ? Math.sqrt((f * kn.v) ** 2 + 2 * acc * after) / f
          : kn.v;
      if (w < best) best = w;
    }
    v[k] = best;
  }
  return v;
}

/**
 * The larger of a leg's two speed differences (see evaluate's leg summary): its entry speed against its own
 * circulating speed, and against the speed of the traffic circulating across its entry.
 * Returns { value, kind: 'own' | 'conflicting' } or null when neither can be worked out.
 */
export function speedDifference(leg) {
  let best = null;
  if (leg.V.V1 !== null && leg.Vcirc !== null) best = { value: Math.abs(leg.V.V1 - leg.Vcirc), kind: 'own' };
  if (leg.V.V1 !== null && leg.Vconf !== null) {
    const v = Math.abs(leg.V.V1 - leg.Vconf);
    if (!best || v > best.value) best = { value: v, kind: 'conflicting' };
  }
  return best;
}
