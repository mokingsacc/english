// Derived geometry of a single-lane roundabout, from the parameters to true lines and arcs.
//
// Everything here is worked in local coordinates with the centre of the circle at the origin, which keeps
// the arithmetic exact to well below a thousandth of a foot; evaluate() moves the answer to state plane
// coordinates at the end.
//
// Leg frame: u is the unit vector outward along the bearing; an entering driver travels along -u and rIn is
// that driver's right, so the entry lane lies on the rIn side. A point at station s (along u) and lateral
// offset t (toward rIn) from the leg axis is s u + (t - offsetLeft) rIn: the axis passes through
// C - offsetLeft rIn.

import {
  bearingVec, dot, cross, sub, unit, rightOf, leftOf, dist, line, arc, filletLineCircle, angleOf, wrap2Pi,
  closedChainArea, circleCircle, segmentsCross, arcSweep, segmentDistance, arcDistance, bracketRoot, TAU, DEG,
} from '../geom.js';
import { paramFor } from './params.js';
import { theLeg, sentence, whole, num, article } from '../format.js';

const MIN_ISLAND_RADIUS = 1; // ft; below this the central island is a point, not an island
const WIDTH_TOL = 1e-6; // ft; a built width within this of the width asked for is that width
const TOUCH = 1e-9; // radians of circle; less than this between an entry curve and the next exit curve is none
const LANE_TOL = 0.05; // ft; a lane beside the splitter island this much narrower than its approach lane is the same

export function derive(round, rr) {
  const problems = [];
  const warnings = [];
  const Ri = round.icd / 2;
  const Rc = Ri - round.circWidth;
  const Ra = Rc - round.apronWidth;
  const lead = rr.get('geom.leadLength');

  if (!(Rc > MIN_ISLAND_RADIUS)) {
    problems.push(`The circulatory roadway (${fmt(round.circWidth)} ft) leaves no room for a central island inside a ${fmt(round.icd)} ft circle. Make the circle bigger or the roadway narrower.`);
  } else if (!(Ra >= 0)) {
    problems.push(`The truck apron (${fmt(round.apronWidth)} ft) is wider than the central island can hold. The island edge is only ${fmt(Rc)} ft from the centre. Make the apron narrower or the circle bigger.`);
  }

  const legs = round.legs.map((lg, idx) => legFrame(lg, idx, Ri, lead, problems));
  if (problems.length) return { ok: false, problems, warnings };

  // Each curb side at the radius asked for, placed so that its width is the width asked for.
  for (const L of legs) {
    L.entrySide = buildSide(L, false, L.entryRadius, Ri);
    if (!L.entrySide.ok) problems.push(sideProblem(L, false, L.entryRadius, L.entrySide));
    L.exitSide = buildSide(L, true, L.exitRadius, Ri);
    if (!L.exitSide.ok) problems.push(sideProblem(L, true, L.exitRadius, L.exitSide));
  }
  if (problems.length) return { ok: false, problems, warnings };

  // Counterclockwise order of the legs around the circle (the way traffic circulates).
  const ccw = legs.map((L, i) => i).sort((a, b) => legs[a].theta - legs[b].theta || a - b);
  const pos = new Array(legs.length);
  ccw.forEach((li, p) => { pos[li] = p; });
  for (let p = 0; p < ccw.length; p++) {
    const a = legs[ccw[p]], b = legs[ccw[(p + 1) % ccw.length]];
    const gap = wrap2Pi(b.theta - a.theta);
    if (gap < 1 * DEG || gap > TAU - 1 * DEG) {
      problems.push(`The ${a.name} and the ${b.name} point the same way. Give each leg its own bearing.`);
    }
  }
  if (problems.length) return { ok: false, problems, warnings };

  // Where one leg's entry curve and the next leg's exit curve would overlap before reaching the circle,
  // both radii are shortened by one common factor until the two curves just meet on the circle.
  const minEntry = paramFor('legs.*.entryRadius').min, minExit = paramFor('legs.*.exitRadius').min;
  for (let p = 0; p < ccw.length; p++) {
    const A = legs[ccw[p]], B = legs[ccw[(p + 1) % ccw.length]];
    const gap = wrap2Pi(B.theta - A.theta);
    if (!(gap + B.exitSide.alpha - A.entrySide.alpha < -TOUCH)) continue;
    const fit = fitCorner(A, B, gap, Ri, minEntry, minExit);
    if (!fit.ok) {
      const more = fit.short > 0 ? Math.max(1, Math.ceil(fit.short / DEG)) : 0;
      problems.push(`${sentence(theLeg(A.name))} and ${theLeg(B.name)} are too close together. Even with the smallest curb radii allowed (${whole(minEntry)} ft at the entry and ${whole(minExit)} ft at the exit), the entry curve of ${theLeg(A.name)} runs into the exit curve of ${theLeg(B.name)} before they reach the circle. ${more ? `Spread the two legs about ${more} ${more === 1 ? 'degree' : 'degrees'} further apart` : 'Spread the two legs further apart'}, or make that entry or exit narrower.`);
      continue;
    }
    A.entrySide = fit.entry;
    B.exitSide = fit.exit;
    const asked = `${whole(A.entryRadius)} ft and ${whole(B.exitRadius)} ft`;
    const built = `${whole(fit.entry.R)} ft and ${whole(fit.exit.R)} ft`;
    warnings.push(`${sentence(theLeg(A.name))}'s entry curve and ${theLeg(B.name)}'s exit curve meet with no circle between them${built === asked ? '.' : `, so they are built at ${built}, not ${asked}.`}`);
  }
  if (problems.length) return { ok: false, problems, warnings };

  for (const L of legs) {
    finishLeg(L, Ri);
    for (const exit of [false, true]) {
      const lane = narrowestLane(L, exit, exit ? L.exitSide : L.entrySide);
      const ends = exit ? L.departWidth : L.approachWidth;
      if (!(lane < ends - LANE_TOL)) continue;
      const what = exit ? 'exit' : 'entry';
      const R = exit ? L.exitRadiusBuilt : L.entryRadiusBuilt;
      warnings.push(`The ${what} lane of ${theLeg(L.name)} narrows to ${num(Math.max(0, lane))} ft beside the splitter island, less than its ${fmt(ends)} ft ${exit ? 'departure' : 'approach'} lane: an ${what} ${fmt(exit ? L.exitWidth : L.entryWidth)} ft wide is tight for ${article(whole(R))} ${whole(R)} ft ${what} curb radius. Make the ${what} wider or its curb radius smaller.`);
    }
  }

  // Corners: the outer curb from one leg's entry, counterclockwise along the circle, to the next leg's exit.
  const corners = [];
  for (let p = 0; p < ccw.length; p++) {
    const i = ccw[p], k = ccw[(p + 1) % ccw.length];
    const A = legs[i], B = legs[k];
    const gap = wrap2Pi(B.theta - A.theta);
    const sweep = gap + B.alphaT2x - A.alphaT2;
    const touching = !(sweep > TOUCH);
    const chain = [...A.entryChain];
    if (!touching) chain.push(arc(A.T2, B.T2x, { x: 0, y: 0 }, Ri, true, 'curb'));
    chain.push(...B.exitChain);
    // Two curves that meet on the circle touch there and nowhere else, so only a corner with some circle
    // between its curves needs the crossing test.
    if (!touching && arcsCross(A.entryArc, B.exitArc)) {
      problems.push(`The entry curb of the ${A.name} crosses the exit curb of the ${B.name}. Make one of those curb radii smaller, or spread the two legs further apart.`);
    } else if (cornerSidesCross(A, B)) {
      problems.push(`The ${A.name} and the ${B.name} overlap outside the circle. Spread the two legs further apart.`);
    }
    corners.push({ from: i, to: k, sweep, touching, chain });
  }
  if (problems.length) return { ok: false, problems, warnings };

  const origin = { x: 0, y: 0 };
  const circle = (r, tag) => [
    arc({ x: r, y: 0 }, { x: -r, y: 0 }, origin, r, true, tag),
    arc({ x: -r, y: 0 }, { x: r, y: 0 }, origin, r, true, tag),
  ];

  // Land take: the outer curbs all round, closed across each leg at its nose station.
  const landChain = [];
  for (const c of corners) {
    const B = legs[c.to];
    for (const prim of c.chain) {
      if (prim.tag === 'edge') continue;
      landChain.push({ ...prim, tag: 'landtake' });
    }
    landChain.push(line(B.Fx, B.F, 'landtake'));
  }
  const landArea = closedChainArea(landChain);

  return {
    ok: true,
    problems,
    warnings,
    Ri, Rc, Ra,
    Rm: Ri - round.circWidth / 2,
    circWidth: round.circWidth,
    lead,
    legs,
    ccw,
    pos,
    corners,
    inscribed: circle(Ri, 'inscribed'),
    island: circle(Rc, 'island'),
    apron: Ra > 1e-6 ? circle(Ra, 'apron') : [],
    landTake: { chain: landChain, sqft: landArea },
  };
}

/** The leg's frame and the points fixed by its own parameters: the splitter island, the nose and far ends. */
function legFrame(lg, idx, Ri, lead, problems) {
  const u = bearingVec(lg.bearing);
  const rIn = { x: -u.y, y: u.x };
  const o = lg.offsetLeft;
  const P = (s, t) => ({ x: s * u.x + (t - o) * rIn.x, y: s * u.y + (t - o) * rIn.y });
  const hw = lg.splitterWidth / 2;
  const name = lg.name;
  const L = {
    idx, id: lg.id, name, bearing: lg.bearing, u, rIn, offset: o, theta: angleOf(u),
    approachSpeed: lg.approachSpeed, approachWidth: lg.approachWidth, departWidth: lg.departWidth,
    entryWidth: lg.entryWidth, exitWidth: lg.exitWidth, entryRadius: lg.entryRadius, exitRadius: lg.exitRadius,
    splitterLength: lg.splitterLength, splitterWidth: lg.splitterWidth, P,
  };

  if (Math.abs(hw - o) > Ri - 2 || Math.abs(hw + o) > Ri - 2) {
    problems.push(`The splitter island of the ${name} is too wide, or its leg is shifted too far, to meet the circle. Make the island narrower or reduce the approach offset.`);
    return L;
  }
  const sNose = Math.sqrt((Ri + lg.splitterLength) ** 2 - o * o);
  const sSe = Math.sqrt(Ri * Ri - (hw - o) ** 2);
  const sSx = Math.sqrt(Ri * Ri - (hw + o) ** 2);
  L.sNose = sNose; L.sSe = sSe; L.sSx = sSx;
  L.nose = P(sNose, 0);
  L.Se = P(sSe, hw);
  L.Sx = P(sSx, -hw);
  L.F = P(sNose, lg.approachWidth);
  L.Fx = P(sNose, -lg.departWidth);
  L.farIn = P(sNose + lead, lg.approachWidth);
  L.farOut = P(sNose + lead, -lg.departWidth);
  L.farCl = P(sNose + lead, 0);
  // Angles of points about the centre, measured from the leg axis (counterclockwise positive).
  L.alpha = (p) => Math.atan2(cross(u, p), dot(u, p));
  L.alphaSe = L.alpha(L.Se);
  L.alphaSx = L.alpha(L.Sx);
  return L;
}

// Curb sides. The entry curb is a straight flare line from F (the approach lane edge at the island nose)
// and an arc of the entry radius tangent to that line and touching the inscribed circle from outside. The
// entry width is measured the way an engineer measures it: square to that curb, from Se, the point where
// the splitter island's edge meets the circle. The line's direction is set by its lateral offset w at the
// station of Se; the width grows with w, so w is found by a bracketed root find. The exit side mirrors
// this from Fx and Sx.

const WIDE = 1, RADIUS = 2, NARROW = 3, CROSS = 4;

/** The curb of one side at lateral offset w and radius R: { O, T1, T2, alpha, width, ... } or a reason code. */
function curbAt(L, exit, R, w, Ri) {
  const F = exit ? L.Fx : L.F;
  const N = exit ? L.P(L.sSx, -w) : L.P(L.sSe, w);
  const d = unit(sub(N, F));
  const f = filletLineCircle(F, d, exit ? leftOf(d) : rightOf(d), R, Ri);
  // No curve joins the line to the circle: the line is aimed either outside the circle (too wide) or across
  // the splitter island to the far side of the circle.
  if (!f) return w < L.splitterWidth / 2 ? CROSS : WIDE;
  if (!(f.lambda > 1e-6)) return RADIUS;
  const a = L.alpha(f.T2);
  if (exit ? !(a < L.alphaSx - 1e-6) : !(a > L.alphaSe + 1e-6)) return NARROW;
  const side = { O: f.O, T1: f.T1, T2: f.T2, alpha: a, w, R };
  if (!(narrowestLane(L, exit, side) > 0)) return CROSS;
  const S = exit ? L.Sx : L.Se;
  // Both curb arcs turn clockwise: the entry arc from T1 to T2, the exit arc from T2 to T1.
  const arcD = exit ? arcDistance(S, f.T2, f.T1, f.O, R, false) : arcDistance(S, f.T1, f.T2, f.O, R, false);
  const lineD = segmentDistance(S, F, f.T1);
  side.width = Math.min(lineD, arcD);
  side.onArc = arcD <= lineD;
  return side;
}

/**
 * One curb side (exit false: the entry) at radius R, with the width the leg asks for.
 * Returns { ok: true, O, T1, T2, alpha, width, w, R } or { ok: false, why, limit } where why is 'wide',
 * 'radius', 'narrow' or 'cross' and limit is the widest (for 'wide') or narrowest (otherwise) width that can
 * be built, or null.
 */
function buildSide(L, exit, R, Ri) {
  const W = exit ? L.exitWidth : L.entryWidth;
  const hw = L.splitterWidth / 2;
  // The width grows with w. The bracket runs from a line aimed across the splitter island (w far below hw)
  // to one aimed well outside the circle, where no curve can join it to the circle.
  const reach = 2 * Ri + Math.abs(L.offset) + hw + (exit ? L.departWidth : L.approachWidth);
  const f = (w) => {
    const c = curbAt(L, exit, R, w, Ri);
    return typeof c === 'object' ? c.width - W : c === WIDE ? Infinity : -Infinity;
  };
  const r = bracketRoot(f, hw - reach, hw + reach, 1e-10, 1e-9);
  const c = curbAt(L, exit, R, r.x, Ri);
  if (typeof c === 'object' && Math.abs(c.width - W) <= WIDTH_TOL) return { ok: true, ...c };
  const atLo = curbAt(L, exit, R, r.lo, Ri), atHi = curbAt(L, exit, R, r.hi, Ri);
  if (atHi === WIDE) return { ok: false, why: 'wide', limit: typeof atLo === 'object' ? atLo.width : null };
  const why = atLo === RADIUS ? 'radius' : atLo === NARROW ? 'narrow' : 'cross';
  return { ok: false, why, limit: typeof atHi === 'object' ? atHi.width : null };
}

function sideProblem(L, exit, R, s) {
  const what = exit ? 'exit' : 'entry';
  const W = exit ? L.exitWidth : L.entryWidth;
  const who = theLeg(L.name);
  if (s.why === 'wide') {
    const most = s.limit !== null ? ` The most it can be is about ${num(Math.floor(s.limit * 10) / 10)} ft.` : '';
    return `The ${what} of ${who} cannot be ${fmt(W)} ft wide: the circle cannot take that much width there.${most} Make the ${what} or the splitter island narrower, or the circle bigger.`;
  }
  const least = s.limit !== null ? ` The narrowest it can be is about ${num(Math.ceil(s.limit * 10) / 10)} ft.` : '';
  if (s.why === 'radius') {
    const where = exit ? 'end beyond' : 'start before';
    return `The ${what} of ${who} cannot be as narrow as ${fmt(W)} ft with ${article(fmt(R))} ${fmt(R)} ft ${what} curb radius: the curve would have to ${where} the splitter island nose.${least} Make the ${what} curb radius smaller, the island longer, or the ${what} wider.`;
  }
  if (s.why === 'narrow') {
    return `The ${what} of ${who} cannot be as narrow as ${fmt(W)} ft: its curb would meet the circle inside the splitter island.${least} Make the ${what} wider or the island narrower.`;
  }
  return `The ${what} of ${who} cannot be as narrow as ${fmt(W)} ft with ${article(fmt(R))} ${fmt(R)} ft ${what} curb radius: its curb would cross the splitter island.${least} Make the ${what} wider, the island narrower, or the ${what} curb radius smaller.`;
}

/**
 * Shorten A's entry radius and B's exit radius by one common factor k until the two curves meet on the
 * circle. Each radius stops at its smallest allowed value; below that the other one goes on alone. The
 * circle between the curves grows as k falls, so k is found by a bracketed root find, which keeps the
 * built radii moving smoothly as a leg is turned. Returns { ok: true, entry, exit } (the two sides) or
 * { ok: false, short } with short the circle (radians) still missing at the smallest radii.
 */
function fitCorner(A, B, gap, Ri, minEntry, minExit) {
  const Re = A.entryRadius, Rx = B.exitRadius;
  const kFloor = Math.min(1, Math.min(minEntry / Re, minExit / Rx));
  const at = (k) => {
    const entry = buildSide(A, false, Math.max(k * Re, Math.min(minEntry, Re)), Ri);
    const exit = buildSide(B, true, Math.max(k * Rx, Math.min(minExit, Rx)), Ri);
    return { entry, exit, sweep: entry.ok && exit.ok ? gap + exit.alpha - entry.alpha : -Infinity };
  };
  const low = at(kFloor);
  if (!(low.sweep >= 0)) return { ok: false, short: Number.isFinite(low.sweep) ? -low.sweep : 0 };
  const r = bracketRoot((k) => -at(k).sweep, kFloor, 1, 1e-13, 1e-12);
  let best = at(r.x);
  if (!(best.sweep >= -1e-12)) best = at(r.lo);
  return { ok: true, entry: best.entry, exit: best.exit };
}

/** The leg's curbs, arcs, chains and widths from its two curb sides. */
function finishLeg(L, Ri) {
  const e = L.entrySide, x = L.exitSide;
  L.entryRadiusBuilt = e.R;
  L.exitRadiusBuilt = x.R;
  L.N = L.P(L.sSe, e.w);
  L.Nx = L.P(L.sSx, -x.w);
  L.entryO = e.O; L.T1 = e.T1; L.T2 = e.T2;
  L.exitO = x.O; L.T1x = x.T1; L.T2x = x.T2;
  L.alphaT2 = e.alpha;
  L.alphaT2x = x.alpha;
  L.entryArc = arc(L.T1, L.T2, L.entryO, e.R, false, 'curb');
  L.exitArc = arc(L.T2x, L.T1x, L.exitO, x.R, false, 'curb');
  L.entryChain = [line(L.farIn, L.F, 'edge'), line(L.F, L.T1, 'curb'), L.entryArc];
  L.exitChain = [L.exitArc, line(L.T1x, L.Fx, 'curb'), line(L.Fx, L.farOut, 'edge')];
  L.splitter = [
    line(L.nose, L.Se, 'splitter'),
    arc(L.Se, L.Sx, { x: 0, y: 0 }, Ri, false, 'splitter'),
    line(L.Sx, L.nose, 'splitter'),
  ];
  L.centerline = [line(L.nose, L.farCl, 'centerline')];
  L.entrance = arc(L.Se, L.T2, { x: 0, y: 0 }, Ri, true, 'entrance');
  L.exitLine = arc(L.T2x, L.Sx, { x: 0, y: 0 }, Ri, true, 'exit');
  const midAng = (a, b) => L.theta + (a + b) / 2;
  L.entranceMid = { x: Ri * Math.cos(midAng(L.alphaSe, L.alphaT2)), y: Ri * Math.sin(midAng(L.alphaSe, L.alphaT2)) };
  L.exitMid = { x: Ri * Math.cos(midAng(L.alphaSx, L.alphaT2x)), y: Ri * Math.sin(midAng(L.alphaSx, L.alphaT2x)) };
  // Widths as built: square to the curb from the end of the splitter island (equal to the widths asked for),
  // and the point on the curb each one is measured to.
  L.entryWidthBuilt = e.width;
  L.exitWidthBuilt = x.width;
  L.entryWidthPoint = nearestOnCurb(L.Se, e, L.F);
  L.exitWidthPoint = nearestOnCurb(L.Sx, x, L.Fx);
}

/** The point of a curb side (its straight line from F, then its arc) nearest to S. */
function nearestOnCurb(S, side, F) {
  if (side.onArc) {
    const d = unit(sub(S, side.O));
    const p = { x: side.O.x + side.R * d.x, y: side.O.y + side.R * d.y };
    if (Math.abs(dist(p, S) - side.width) < 1e-6) return p;
    // S is not beside the arc, so the nearest point is one of its ends.
    return dist(side.T1, S) < dist(side.T2, S) ? side.T1 : side.T2;
  }
  const dx = side.T1.x - F.x, dy = side.T1.y - F.y, ll = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1, ((S.x - F.x) * dx + (S.y - F.y) * dy) / ll));
  return { x: F.x + t * dx, y: F.y + t * dy };
}

/**
 * The narrowest the entry lane (exit true: the exit lane) gets beside the splitter island, measured square to
 * the leg axis from the island edge to the curb, as the approach and departure lane widths are. Beside the
 * straight part of the curb the width changes linearly; beside the arc it is narrowest where the arc runs
 * parallel to the island edge.
 */
function narrowestLane(L, exit, side) {
  const sign = exit ? -1 : 1;
  const st = (p) => dot(p, L.u);
  const lat = (p) => sign * (dot(p, L.rIn) + L.offset);
  const sS = exit ? L.sSx : L.sSe;
  const hw = L.splitterWidth / 2;
  const slope = hw / (L.sNose - sS);
  const island = (s) => hw - slope * (s - sS);
  const { O, R, T1, T2 } = side;
  const os = st(O), ot = lat(O), s1 = st(T1), s2 = st(T2);
  const onArc = (s) => ot - Math.sqrt(Math.max(0, R * R - (s - os) ** 2)) - island(s);
  let least = Math.min(exit ? L.departWidth : L.approachWidth, lat(T1) - island(s1));
  const lo = Math.max(sS, Math.min(s1, s2)), hi = Math.min(L.sNose, s1);
  if (hi > lo) {
    least = Math.min(least, onArc(lo));
    const sMin = os - (R * slope) / Math.sqrt(1 + slope * slope);
    if (sMin > lo && sMin < hi) least = Math.min(least, onArc(sMin));
  }
  return least;
}

/** True when two arcs cross somewhere inside both of their spans (touching at an end does not count). */
function arcsCross(p, q) {
  const pts = circleCircle(p.c, p.r, q.c, q.r);
  for (const x of pts) {
    if (dist(x, p.a) < 1e-6 || dist(x, p.b) < 1e-6 || dist(x, q.a) < 1e-6 || dist(x, q.b) < 1e-6) continue;
    if (onArc(p, x) && onArc(q, x)) return true;
  }
  return false;
}

function onArc(p, x) {
  const sw = arcSweep(p);
  const a0 = Math.atan2(p.a.y - p.c.y, p.a.x - p.c.x);
  const ax = Math.atan2(x.y - p.c.y, x.x - p.c.x);
  const t = wrap2Pi(p.ccw ? ax - a0 : a0 - ax);
  return t > 1e-9 && t < sw - 1e-9;
}

function cornerSidesCross(A, B) {
  const sa = [[A.farIn, A.F], [A.F, A.T1]];
  const sb = [[B.T1x, B.Fx], [B.Fx, B.farOut]];
  for (const [a, b] of sa) for (const [c, d] of sb) if (segmentsCross(a, b, c, d)) return true;
  return false;
}

function fmt(v) {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
}
