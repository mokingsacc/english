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
//
// Each side of a leg is laid out the way a designer lays it out (the entry here; the exit mirrors it with
// the exit radius, exit width and departure lane width):
//   - beside the island's body the outer curb runs parallel to the leg at half the splitter island width plus
//     the entry width, then turns onto the circle on a curve of the entry curb radius, tangent to both;
//   - the lane follows the curb: the island's entry edge is its body line down to where the curve begins,
//     then the arc concentric with that curve at the entry width, tangent to the body line, to the circle; so
//     the width measured square to the curb from where the island meets the circle is the entry width;
//   - the island is whatever is left between the entry and exit lanes, closed by the circle, at its body
//     width where the curves begin, then tapering to its nose, while the lane flares from the approach lane
//     width at the nose to the entry width where the island reaches its body width.

import {
  bearingVec, dot, cross, dist, line, arc, angleOf, wrap2Pi, closedChainArea, circleCircle, segmentsCross,
  arcSweep, segmentDistance, arcDistance, bracketRoot, TAU, DEG,
} from '../geom.js';
import { paramFor } from './params.js';
import { theLeg, sentence, whole, num } from '../format.js';

const MIN_ISLAND_RADIUS = 1; // ft; below this the central island is a point, not an island
const TOUCH = 1e-9; // radians of circle; less than this between an entry curve and the next exit curve is none
const EPS = 1e-6; // ft; a line or arc shorter than this is left out of a chain
const CURB_ROOM = 2; // ft; an outer curb line must pass at least this far inside the circle to turn onto it
const ORIGIN = { x: 0, y: 0 };

export function derive(round, rr) {
  const problems = [];
  const warnings = [];
  const notes = [];
  const Ri = round.icd / 2;
  const Rc = Ri - round.circWidth;
  const Ra = Rc - round.apronWidth;
  const lead = rr.get('geom.leadLength');
  const noseMargin = rr.get('geom.noseMargin');
  const noseTaper = rr.get('geom.noseTaper');

  if (!(Rc > MIN_ISLAND_RADIUS)) {
    problems.push(`The circulatory roadway (${fmt(round.circWidth)} ft) leaves no room for a central island inside a ${fmt(round.icd)} ft circle. Make the circle bigger or the roadway narrower.`);
  } else if (!(Ra >= 0)) {
    problems.push(`The truck apron (${fmt(round.apronWidth)} ft) is wider than the central island can hold. The island edge is only ${fmt(Rc)} ft from the centre. Make the apron narrower or the circle bigger.`);
  }

  const legs = round.legs.map((lg, idx) => legFrame(lg, idx, Ri, round.icd, problems));
  if (problems.length) return { ok: false, problems, warnings, notes };

  // Each side at the radius asked for.
  for (const L of legs) {
    L.entrySide = buildSide(L, false, L.entryRadius, Ri);
    if (!L.entrySide.ok) problems.push(sideProblem(L, false, round.icd));
    L.exitSide = buildSide(L, true, L.exitRadius, Ri);
    if (!L.exitSide.ok) problems.push(sideProblem(L, true, round.icd));
  }
  if (problems.length) return { ok: false, problems, warnings, notes };

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
  if (problems.length) return { ok: false, problems, warnings, notes };

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
  if (problems.length) return { ok: false, problems, warnings, notes };

  for (const L of legs) finishLeg(L, Ri, lead, noseMargin, noseTaper, problems, notes);
  if (problems.length) return { ok: false, problems, warnings, notes };

  // Corners: the outer curb from one leg's entry, counterclockwise along the circle, to the next leg's exit.
  const corners = [];
  for (let p = 0; p < ccw.length; p++) {
    const i = ccw[p], k = ccw[(p + 1) % ccw.length];
    const A = legs[i], B = legs[k];
    const gap = wrap2Pi(B.theta - A.theta);
    const sweep = gap + B.alphaT2x - A.alphaT2;
    const touching = !(sweep > TOUCH);
    const chain = [...A.entryChain];
    if (!touching) chain.push(arc(A.T2, B.T2x, ORIGIN, Ri, true, 'curb'));
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
  if (problems.length) return { ok: false, problems, warnings, notes };

  const circle = (r, tag) => [
    arc({ x: r, y: 0 }, { x: -r, y: 0 }, ORIGIN, r, true, tag),
    arc({ x: -r, y: 0 }, { x: r, y: 0 }, ORIGIN, r, true, tag),
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
    notes,
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

/** The leg's frame and its own fixed values. Adds a problem when an outer curb cannot reach the circle. */
function legFrame(lg, idx, Ri, icd, problems) {
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
    splitterLength: lg.splitterLength, splitterWidth: lg.splitterWidth, hw, P,
  };
  // Angles of points about the centre, measured from the leg axis (counterclockwise positive); stations
  // along the leg, and lateral offsets from its axis toward the entry side.
  L.alpha = (p) => Math.atan2(cross(u, p), dot(u, p));
  L.st = (p) => dot(p, u);
  L.lat = (p) => dot(p, rIn) + o;

  for (const exit of [false, true]) {
    const q = hw + (exit ? lg.exitWidth : lg.entryWidth);
    // The distance of the straight outer curb from the centre of the circle.
    const off = Math.abs(exit ? q + o : q - o);
    if (off > Ri - CURB_ROOM) problems.push(curbMissProblem(L, exit, q, icd));
  }
  return L;
}

function curbMissProblem(L, exit, q, icd) {
  const what = exit ? 'exit' : 'entry';
  const shift = L.offset ? ', or reduce the approach offset' : '';
  return `The ${what} curb of ${theLeg(L.name)} cannot turn onto the circle: it runs ${fmt(q)} ft from the leg's centre line (half the splitter island and the ${what} width), too far out for a ${fmt(icd)} ft circle. Make the circle bigger, or the splitter island or the ${what} narrower${shift}.`;
}

// A guard: with the curb check in legFrame passed, every side can be laid out, so this is not expected.
function sideProblem(L, exit, icd) {
  const what = exit ? 'exit' : 'entry';
  const R = exit ? L.exitRadius : L.entryRadius;
  return `The ${what} curb of ${theLeg(L.name)} cannot be laid out on a ${fmt(icd)} ft circle with a ${fmt(R)} ft radius. Make the circle bigger, or the splitter island or the ${what} narrower.`;
}

/**
 * One side of a leg (exit false: the entry) at curb radius R. Returns { ok: false } when the curb cannot be
 * laid out on the circle, else the side in leg terms (q is the lateral offset from the axis toward this side):
 *   qC, qO       the straight curb beside the island's body (half the island plus the width) and the curve's
 *                centre; sO the station of the centre and of T1
 *   O, T1, T2    the curve's centre and its ends on the straight curb and on the circle; alpha the angle of T2
 *   S, sS, qS    where the island meets the circle, the point the width is measured from
 *   kind, J, sJ  the island's edge: 'arc' (the body line down to J at the station where the curve begins, then
 *                the concentric arc, tangent to it there, to S) or 'body' (the body line reaches the circle
 *                before the curve begins, so S is on it and J is S: the island meets the circle at its body
 *                width and the curb is straight beside it there).
 */
function buildSide(L, exit, R, Ri) {
  const sg = exit ? -1 : 1;
  const W = exit ? L.exitWidth : L.entryWidth;
  const lane = exit ? L.departWidth : L.approachWidth;
  const hw = L.hw;
  const qC = hw + W, qO = qC + R;
  const s2 = (Ri + R) ** 2 - (sg * qO - L.offset) ** 2;
  if (!(s2 > 0)) return { ok: false };
  const sO = Math.sqrt(s2);
  const O = L.P(sO, sg * qO);
  const T1 = L.P(sO, sg * qC);
  const f = Ri / (Ri + R);
  const T2 = { x: O.x * f, y: O.y * f };
  const alpha = L.alpha(T2);
  const side = { ok: true, exit, sg, R, W, lane, hw, qC, qO, sO, O, T1, T2, alpha, K: null };
  const J = L.P(sO, sg * hw);
  if (dist(J, ORIGIN) > Ri) {
    // The concentric arc at the width asked for leaves the body line at J and meets the circle at two points
    // either side of the line through the centres; the one toward the island is S.
    const pts = circleCircle(O, R + W, ORIGIN, Ri);
    if (!pts.length) return { ok: false };
    side.kind = 'arc';
    side.S = pts.length > 1 && sg * L.alpha(pts[1]) < sg * L.alpha(pts[0]) ? pts[1] : pts[0];
    side.J = J;
    side.sJ = sO;
  } else {
    const b2 = Ri * Ri - (sg * hw - L.offset) ** 2;
    if (!(b2 > 0)) return { ok: false };
    side.kind = 'body';
    side.S = L.P(Math.sqrt(b2), sg * hw);
    side.J = side.S;
    side.sJ = Math.sqrt(b2);
  }
  side.sS = L.st(side.S);
  side.qS = sg * L.lat(side.S);
  return side;
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

/** The leg's island, nose, curbs, chains and widths from its two sides. */
function finishLeg(L, Ri, lead, noseMargin, noseTaper, problems, notes) {
  const e = L.entrySide, x = L.exitSide, hw = L.hw;
  L.entryRadiusBuilt = e.R;
  L.exitRadiusBuilt = x.R;
  L.entryO = e.O; L.T1 = e.T1; L.T2 = e.T2;
  L.exitO = x.O; L.T1x = x.T1; L.T2x = x.T2;
  L.alphaT2 = e.alpha;
  L.alphaT2x = x.alpha;
  L.Se = e.S; L.Sx = x.S;
  L.alphaSe = L.alpha(L.Se);
  L.alphaSx = L.alpha(L.Sx);

  // The island's body runs at its full width to where the farther of its edges leaves the body line, then
  // tapers to the nose, which sits at the length asked for or, when that leaves too short a taper, the margin
  // beyond. Along the taper each outer curb shifts from its lane width at the nose to half the island plus
  // the entry or exit width, and the island's edges shift by half its width: none more steeply than one in
  // noseTaper.
  const sBody = Math.max(e.sJ, x.sJ);
  const shift = Math.max(hw, Math.abs(e.qC - e.lane), Math.abs(x.qC - x.lane));
  const margin = Math.max(noseMargin, noseTaper * shift);
  const sAsked = Math.sqrt((Ri + L.splitterLength) ** 2 - L.offset ** 2);
  const sNose = Math.max(sAsked, sBody + margin);
  L.sBody = sBody;
  L.sNose = sNose;
  L.splitterLengthBuilt = sNose > sAsked ? Math.sqrt(sNose * sNose + L.offset * L.offset) - Ri : L.splitterLength;
  if (L.splitterLengthBuilt > L.splitterLength + 0.05) {
    notes.push({
      leg: L.id,
      text: `The splitter island of ${theLeg(L.name)} is built ${num(L.splitterLengthBuilt)} ft long, not ${fmt(L.splitterLength)} ft, so that it runs ${num(margin)} ft past where its entry and exit curves begin and its lanes have room to widen beside it.`,
    });
  }
  L.nose = L.P(sNose, 0);
  L.F = L.P(sNose, L.approachWidth);
  L.Fx = L.P(sNose, -L.departWidth);
  L.farIn = L.P(sNose + lead, L.approachWidth);
  L.farOut = L.P(sNose + lead, -L.departWidth);
  L.farCl = L.P(sNose + lead, 0);
  L.entryCurbTaper = L.P(sBody, e.qC);
  L.exitCurbTaper = L.P(sBody, -x.qC);
  L.islandEntryTaper = L.P(sBody, hw);
  L.islandExitTaper = L.P(sBody, -hw);

  // Curbs: the approach edge at the nose, the curb flaring along the taper, the straight curb, then the curve.
  L.entryArc = arc(L.T1, L.T2, L.entryO, e.R, false, 'curb');
  L.exitArc = arc(L.T2x, L.T1x, L.exitO, x.R, false, 'curb');
  L.entryCurb = keep([line(L.F, L.entryCurbTaper, 'curb'), line(L.entryCurbTaper, L.T1, 'curb'), L.entryArc]);
  L.exitCurb = keep([L.exitArc, line(L.T1x, L.exitCurbTaper, 'curb'), line(L.exitCurbTaper, L.Fx, 'curb')]);
  L.entryChain = [line(L.farIn, L.F, 'edge'), ...L.entryCurb];
  L.exitChain = [...L.exitCurb, line(L.Fx, L.farOut, 'edge')];

  // The island: from the nose along its entry edge to the circle, the circle, then its exit edge back.
  L.islandEntry = keep([
    line(L.nose, L.islandEntryTaper, 'splitter'),
    line(L.islandEntryTaper, e.J, 'splitter'),
    ...(e.kind === 'arc' ? [arc(e.J, e.S, e.O, e.R + e.W, false, 'splitter')] : []),
  ]);
  L.islandExit = keep([
    ...(x.kind === 'arc' ? [arc(x.S, x.J, x.O, x.R + x.W, false, 'splitter')] : []),
    line(x.J, L.islandExitTaper, 'splitter'),
    line(L.islandExitTaper, L.nose, 'splitter'),
  ]);
  L.splitter = [...L.islandEntry, arc(L.Se, L.Sx, ORIGIN, Ri, false, 'splitter'), ...L.islandExit];
  L.islandEntryJoin = e.J; L.islandExitJoin = x.J;
  // The island's edges no longer step; these stay for the page and are always null.
  L.islandEntryStep = null;
  L.islandExitStep = null;
  L.islandEntryRadius = e.kind === 'arc' ? e.R + e.W : null;
  L.islandExitRadius = x.kind === 'arc' ? x.R + x.W : null;

  // Each edge of the island keeps at least half its body width from the axis, so the two sides cannot meet;
  // this stays as a guard.
  L.splitterWidthAtCircle = L.alphaSe > L.alphaSx ? dist(L.Se, L.Sx) : 0;
  if (!(L.alphaSe - L.alphaSx > 1e-6)) {
    problems.push(`The entry and exit of ${theLeg(L.name)} overlap where they meet the circle, which leaves no room for the splitter island. Make the entry or exit narrower, the splitter island wider, or the curb radii larger.`);
  }

  L.centerline = [line(L.nose, L.farCl, 'centerline')];
  L.entrance = arc(L.Se, L.T2, ORIGIN, Ri, true, 'entrance');
  L.exitLine = arc(L.T2x, L.Sx, ORIGIN, Ri, true, 'exit');
  const midAng = (a, b) => L.theta + (a + b) / 2;
  L.entranceMid = { x: Ri * Math.cos(midAng(L.alphaSe, L.alphaT2)), y: Ri * Math.sin(midAng(L.alphaSe, L.alphaT2)) };
  L.exitMid = { x: Ri * Math.cos(midAng(L.alphaSx, L.alphaT2x)), y: Ri * Math.sin(midAng(L.alphaSx, L.alphaT2x)) };

  // Widths as built: square to the curb from where the island meets the circle, and the point on the curb
  // each one is measured to (on the curve, square to it, so straight toward its centre).
  L.entryWidthBuilt = curbDistance(L.Se, L.entryCurb);
  L.exitWidthBuilt = curbDistance(L.Sx, L.exitCurb);
  L.entryWidthPoint = toward(L.entryO, L.Se, e.R);
  L.exitWidthPoint = toward(L.exitO, L.Sx, x.R);

  // Lateral offsets of the island edge and the curb at a station, for the sight distance eye point.
  L.entryIslandQ = (s) => islandQ(L, e, s);
  L.entryCurbQ = (s) => curbQ(L, e, s);
  L.exitIslandQ = (s) => islandQ(L, x, s);
  L.exitCurbQ = (s) => curbQ(L, x, s);
}

/** Lateral offset of the island's edge on one side, toward that side, at station s. */
function islandQ(L, side, s) {
  if (s >= L.sNose) return 0;
  if (s >= L.sBody) return (L.hw * (L.sNose - s)) / (L.sNose - L.sBody);
  if (s >= side.sJ || side.kind === 'body') return L.hw;
  if (s <= side.sS) return side.qS;
  const r = side.R + side.W, d = s - side.sO;
  return side.qO - Math.sqrt(Math.max(0, r * r - d * d));
}

/** Lateral offset of the outer curb on one side, away from the axis, at station s. */
function curbQ(L, side, s) {
  if (s >= L.sNose) return side.lane;
  if (s >= L.sBody) return side.qC + ((side.lane - side.qC) * (s - L.sBody)) / (L.sNose - L.sBody);
  if (s >= side.sO) return side.qC;
  const d = s - side.sO;
  if (-d >= side.R) return side.qO;
  return side.qO - Math.sqrt(side.R * side.R - d * d);
}

/** The point at distance r from c toward p. */
function toward(c, p, r) {
  const d = dist(c, p);
  return { x: c.x + ((p.x - c.x) * r) / d, y: c.y + ((p.y - c.y) * r) / d };
}

/** The shortest distance from p to a curb chain of lines and clockwise arcs. */
function curbDistance(p, chain) {
  let best = Infinity;
  for (const c of chain) {
    const d = c.type === 'line' ? segmentDistance(p, c.a, c.b) : arcDistance(p, c.a, c.b, c.c, c.r, c.ccw);
    if (d < best) best = d;
  }
  return best;
}

/** The chain without the lines and arcs too short to matter. */
function keep(chain) {
  return chain.filter((p) => {
    if (dist(p.a, p.b) >= EPS) return true;
    if (p.type !== 'arc') return false;
    // A full turn would be no arc at all here: an island edge or curb curve turns well under half a circle.
    const sw = arcSweep(p);
    return sw > 1e-6 && sw < Math.PI;
  });
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
  const sa = [line(A.farIn, A.F), ...A.entryCurb.filter((p) => p.type === 'line')];
  const sb = [...B.exitCurb.filter((p) => p.type === 'line'), line(B.Fx, B.farOut)];
  for (const a of sa) for (const b of sb) if (segmentsCross(a.a, a.b, b.a, b.b)) return true;
  return false;
}

function fmt(v) {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
}
