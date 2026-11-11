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
  closedChainArea, compileChain, chainSignedDistance, circleCircle, segmentsCross, arcSweep, TAU, DEG,
} from '../geom.js';

const MIN_ISLAND_RADIUS = 1; // ft; below this the central island is a point, not an island

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

  const legs = round.legs.map((lg, idx) => deriveLeg(lg, idx, Ri, lead, problems));
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

  // Corners: the outer curb from one leg's entry, counterclockwise along the circle, to the next leg's exit.
  const corners = [];
  for (let p = 0; p < ccw.length; p++) {
    const i = ccw[p], k = ccw[(p + 1) % ccw.length];
    const A = legs[i], B = legs[k];
    const gap = wrap2Pi(B.theta - A.theta);
    const sweep = gap + B.alphaT2x - A.alphaT2;
    const chain = [...A.entryChain];
    if (sweep < -1e-9) {
      problems.push(`The entry curb of the ${A.name} runs into the exit curb of the ${B.name} before they reach the circle. Make one of those curb radii smaller, or spread the two legs further apart.`);
    } else if (sweep > 1e-9) {
      chain.push(arc(A.T2, B.T2x, { x: 0, y: 0 }, Ri, true, 'curb'));
    }
    chain.push(...B.exitChain);
    if (sweep >= -1e-9) {
      if (arcsCross(A.entryArc, B.exitArc)) {
        problems.push(`The entry curb of the ${A.name} crosses the exit curb of the ${B.name}. Make one of those curb radii smaller, or spread the two legs further apart.`);
      } else if (cornerSidesCross(A, B)) {
        problems.push(`The ${A.name} and the ${B.name} overlap outside the circle. Spread the two legs further apart.`);
      }
    }
    corners.push({ from: i, to: k, sweep, chain });
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

function deriveLeg(lg, idx, Ri, lead, problems) {
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

  // Entry: a flare line from the far point F to the near point N (lateral offset splitterWidth/2 +
  // entryWidth at the station where the splitter island meets the circle), then an arc of the entry radius
  // tangent to that line and touching the inscribed circle from outside. The arc cuts the corner, so the
  // entry as built (shortest distance from the splitter island end to the curb) comes out wider than
  // entryWidth; it is reported as entryWidthBuilt. The exit side mirrors this.
  L.N = P(sSe, hw + lg.entryWidth);
  L.Nx = P(sSx, -(hw + lg.exitWidth));
  const d = unit(sub(L.N, L.F));
  const fe = filletLineCircle(L.F, d, rightOf(d), lg.entryRadius, Ri);
  if (!fe) {
    problems.push(`The entry of the ${name} is too wide for the circle to take. Make the entry or the splitter island narrower, or the circle bigger.`);
    return L;
  }
  if (!(fe.lambda > 1e-6)) {
    problems.push(`The entry curb radius of the ${name} (${fmt(lg.entryRadius)} ft) is too big for its splitter island: the curve would have to start before the island nose. Make the radius smaller or the island longer.`);
    return L;
  }
  L.entryO = fe.O; L.T1 = fe.T1; L.T2 = fe.T2;

  const dx = unit(sub(L.Nx, L.Fx));
  const fx = filletLineCircle(L.Fx, dx, leftOf(dx), lg.exitRadius, Ri);
  if (!fx) {
    problems.push(`The exit of the ${name} is too wide for the circle to take. Make the exit or the splitter island narrower, or the circle bigger.`);
    return L;
  }
  if (!(fx.lambda > 1e-6)) {
    problems.push(`The exit curb radius of the ${name} (${fmt(lg.exitRadius)} ft) is too big for its splitter island: the curve would have to end beyond the island nose. Make the radius smaller or the island longer.`);
    return L;
  }
  L.exitO = fx.O; L.T1x = fx.T1; L.T2x = fx.T2;

  // Angles of the mouth points about the centre, measured from the leg axis (counterclockwise positive).
  const alpha = (p) => Math.atan2(cross(u, p), dot(u, p));
  L.alphaSe = alpha(L.Se);
  L.alphaSx = alpha(L.Sx);
  L.alphaT2 = alpha(L.T2);
  L.alphaT2x = alpha(L.T2x);
  if (!(L.alphaT2 > L.alphaSe + 1e-6)) {
    problems.push(`The entry curb of the ${name} meets the circle inside the splitter island. Make the entry wider or the island narrower.`);
    return L;
  }
  if (!(L.alphaT2x < L.alphaSx - 1e-6)) {
    problems.push(`The exit curb of the ${name} meets the circle inside the splitter island. Make the exit wider or the island narrower.`);
    return L;
  }

  L.entryArc = arc(L.T1, L.T2, L.entryO, lg.entryRadius, false, 'curb');
  L.exitArc = arc(L.T2x, L.T1x, L.exitO, lg.exitRadius, false, 'curb');
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
  const midAng = (a, b) => angleOf(u) + (a + b) / 2;
  L.entranceMid = { x: Ri * Math.cos(midAng(L.alphaSe, L.alphaT2)), y: Ri * Math.sin(midAng(L.alphaSe, L.alphaT2)) };
  L.exitMid = { x: Ri * Math.cos(midAng(L.alphaSx, L.alphaT2x)), y: Ri * Math.sin(midAng(L.alphaSx, L.alphaT2x)) };

  // Widths as built: the shortest distance from the end of the splitter island to the outer curb.
  L.entryWidthBuilt = chainSignedDistance(compileChain([line(L.F, L.T1), L.entryArc], 1), L.Se.x, L.Se.y);
  L.exitWidthBuilt = chainSignedDistance(compileChain([L.exitArc, line(L.T1x, L.Fx)], 1), L.Sx.x, L.Sx.y);
  return L;
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
