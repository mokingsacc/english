// evaluate(roundabout, rules) -> { ok, problems, geometry, movements, legs, checks, headline }
//
// Pure and deterministic. Never throws: a shape that cannot be built, a bad number or a bad project setting
// gives ok false with plain-word problems. Everything returned is in world coordinates (state plane ft).
// Radii are in ft (Infinity where a path does not curve), speeds in mph, distances in ft.

import { validate } from './roundabout/model.js';
import { resolveRules } from './rules.js';
import { derive } from './roundabout/derive.js';
import { listMovements, solveMovement, createPathWorkspace, pathRadii } from './roundabout/fastest-path.js';
import { movementSpeeds, speedProfile, speedDifference } from './roundabout/speeds.js';
import {
  stoppingSightDistance, intersectionSightLength, entryEyePoint, sightTriangle, insideRange,
} from './sight.js';
import { runChecks } from './checks/index.js';
import { translatePrim } from './geom.js';
import { whole, num, mph, theLeg } from './format.js';

// Scratch arrays shared by every call. They carry nothing from one call to the next that can change an
// answer: every value is written before it is read.
let WS = null;

const RADII = ['R1', 'R2', 'R3', 'R4', 'R5'];
const SPEEDS = ['V1', 'V2', 'V3', 'V4', 'V5'];

export function evaluate(round, rules) {
  try {
    return evaluateShape(round, rules);
  } catch (err) {
    const out = failed(['The tool could not work this shape out. Please send it with the Report a problem button so it can be fixed.'], resolveSafe(rules), null);
    out.internalError = String((err && err.stack) || err);
    return out;
  }
}

function resolveSafe(rules) {
  try { return resolveRules(rules); } catch { return resolveRules(null); }
}

function evaluateShape(round, rules) {
  const v = validate(round);
  const rr = resolveRules(rules);
  const problems = [...v.problems, ...rr.problems];
  if (problems.length) return failed(problems, rr, v.value);
  const R = v.value;
  const G = derive(R, rr);
  if (!G.ok) return failed(G.problems, rr, R);

  const cx = R.center.x, cy = R.center.y;
  const W = (p) => ({ x: p.x + cx, y: p.y + cy });
  const WP = (p) => translatePrim(p, cx, cy);

  // Fastest paths, radii and speeds, in local coordinates first.
  if (!WS) WS = createPathWorkspace();
  const moves = listMovements(G).map((mv) => {
    const A = G.legs[mv.i], B = G.legs[mv.j];
    const base = { id: mv.id, from: mv.from, to: mv.to, kind: mv.kind, turn: round1(mv.turn), steps: mv.steps, i: mv.i, j: mv.j };
    const p = solveMovement(G, mv, rr, WS);
    if (!p.ok) {
      return { ...base, ok: false, problems: p.problems, place: W(p.place), local: null, R: nulls(RADII), V: nulls(SPEEDS), d12: null, d23: null, arcs: {} };
    }
    const radii = pathRadii(p, mv, rr);
    const sp = movementSpeeds(mv, radii, A.approachSpeed, B.approachSpeed, rr);
    const speed = speedProfile(p.s, p.n, sp.knots, A.approachSpeed, B.approachSpeed, rr);
    const Rv = {}, Vv = {};
    for (const k of RADII) Rv[k] = radii[k];
    for (const k of SPEEDS) Vv[k] = sp[k];
    return { ...base, ok: true, problems: [], local: { ...p, speed }, radii, R: Rv, V: Vv, d12: sp.d12, d23: sp.d23, solver: p.solver };
  });
  const byId = new Map(moves.map((m) => [m.id, m]));

  // Per-leg summary: the leg's own movements, the conflicting movements, and sight distances.
  const legs = G.legs.map((L) => legSummary(G, L, moves));
  legs.forEach((s) => { s.upstreamMain = legs[s.upstreamIdx].main; });
  const triangles = [];
  for (const s of legs) {
    const L = G.legs[s.idx];
    s.ssd = {
      approach: ssd(L.approachSpeed, rr),
      circulating: s.Vcirc === null ? null : ssd(s.Vcirc, rr),
      exit: s.exitSpeed === null ? null : ssd(s.exitSpeed, rr),
    };
    s.isd = { entering: null, circulating: null };
    const eye = entryEyePoint(L, rr.get('sight.isd.eyeBack'));
    if (!eye) continue;
    s.eye = W(eye);
    const up = s.upstreamMain ? byId.get(s.upstreamMain) : null;
    if (up && up.ok) {
      const vEnt = 0.5 * (up.V.V1 + (up.kind === 'left' ? up.V.V4 : up.V.V2));
      const tri = isdTriangle(G, eye, L, up, vEnt, 'entering', s, rr, W);
      if (tri) { s.isd.entering = tri; triangles.push(tri); }
    }
    const cf = s.conflicting ? byId.get(s.conflicting) : null;
    if (cf && cf.ok) {
      const tri = isdTriangle(G, eye, L, cf, s.Vconf, 'circulating', s, rr, W);
      if (tri) { s.isd.circulating = tri; triangles.push(tri); }
    }
  }

  // World coordinates for everything handed out.
  const layers = {
    curb: [], edge: [], centerline: [], splitter: [], island: [], apron: [], inscribed: [], entrance: [], exit: [], landtake: [],
  };
  for (const c of G.corners) for (const p of c.chain) (p.tag === 'edge' ? layers.edge : layers.curb).push(WP(p));
  for (const L of G.legs) {
    for (const p of L.splitter) layers.splitter.push(WP(p));
    for (const p of L.centerline) layers.centerline.push(WP(p));
    layers.entrance.push(WP(L.entrance));
    layers.exit.push(WP(L.exitLine));
  }
  layers.island = G.island.map(WP);
  layers.apron = G.apron.map(WP);
  layers.inscribed = G.inscribed.map(WP);
  layers.landtake = G.landTake.chain.map(WP);
  const sqftPerAcre = rr.get('units.sqftPerAcre');
  const landTake = { sqft: G.landTake.sqft, acres: G.landTake.sqft / sqftPerAcre };

  const geometry = {
    center: { x: cx, y: cy },
    radii: { inscribed: G.Ri, island: G.Rc, apron: G.Ra, middle: G.Rm },
    layers,
    legs: G.legs.map((L) => ({
      id: L.id, name: L.name, bearing: L.bearing,
      nose: W(L.nose), Se: W(L.Se), Sx: W(L.Sx), far: W(L.farCl), entranceMid: W(L.entranceMid), exitMid: W(L.exitMid),
      F: W(L.F), Fx: W(L.Fx), farIn: W(L.farIn), farOut: W(L.farOut), T1: W(L.T1), T2: W(L.T2), T1x: W(L.T1x), T2x: W(L.T2x),
      entryWidthBuilt: L.entryWidthBuilt, exitWidthBuilt: L.exitWidthBuilt,
      entryRadiusBuilt: L.entryRadiusBuilt, exitRadiusBuilt: L.exitRadiusBuilt,
      entryWidthPoint: W(L.entryWidthPoint), exitWidthPoint: W(L.exitWidthPoint),
    })),
    landTake,
    sightTriangles: triangles,
  };

  const movements = moves.map((m) => publicMovement(m, W));
  const legsOut = legs.map(publicLeg);

  const ctx = {
    ok: true, problems: [], round: R, rules: rr, rule: (id) => rr.get(id), overridden: rr.overridden,
    geometry, movements, legs: legsOut, derived: G, toWorld: W, warnings: G.warnings,
  };
  const checks = runChecks(ctx);
  return { ok: true, problems: [], geometry, movements, legs: legsOut, checks, headline: headline(legsOut, landTake, checks) };
}

function failed(problems, rr, round) {
  const ctx = { ok: false, problems, round, rules: rr, rule: (id) => rr.get(id), overridden: rr.overridden, geometry: null, movements: [], legs: [], warnings: [] };
  const checks = runChecks(ctx);
  return { ok: false, problems, geometry: null, movements: [], legs: [], checks, headline: headline([], null, checks, problems) };
}

function nulls(keys) {
  const o = {};
  for (const k of keys) o[k] = null;
  return o;
}

function round1(v) {
  return Math.round(v * 10) / 10;
}

function ssd(speed, rr) {
  return { speed, distance: stoppingSightDistance(speed, rr) };
}

/** The leg's own movements, the movements that conflict with its entry, and its summary radii and speeds. */
function legSummary(G, L, moves) {
  const n = G.legs.length;
  const own = moves.filter((m) => m.i === L.idx);
  const pick = (list, better) => list.reduce((a, b) => (a === null || better(b, a) ? b : a), null);
  const through = pick(own.filter((m) => m.kind === 'through'), (b, a) => Math.abs(b.turn) < Math.abs(a.turn));
  const left = pick(own.filter((m) => m.kind === 'left'), (b, a) => b.steps > a.steps);
  const right = pick(own.filter((m) => m.kind === 'right'), (b, a) => b.steps < a.steps);
  // The movement that gives the leg's entry, circulating and exit radii: the through movement, or when
  // there is none (the stem of a T) the turn closest to straight that is not a right turn.
  const main = through || pick(own.filter((m) => m.kind !== 'right'), (b, a) => Math.abs(b.turn) < Math.abs(a.turn));
  // The leg just upstream (the entering driver's left). Its left turn circulates across this entry; when it
  // has none, its through movement does.
  const upstreamIdx = G.ccw[(G.pos[L.idx] - 1 + n) % n];
  const passing = moves.filter((m) => m.i === upstreamIdx && m.steps >= 2);
  const conflicting = pick(passing.filter((m) => m.kind === 'left'), (b, a) => b.steps > a.steps)
    || pick(passing, (b, a) => b.steps > a.steps);
  const circOf = (m) => (m && m.ok ? (m.kind === 'left' ? m.V.V4 : m.V.V2) : null);
  const exits = moves.filter((m) => m.j === L.idx && m.ok && m.V.V3 !== null);
  const fastestExit = pick(exits, (b, a) => b.V.V3 > a.V.V3);

  const R = nulls(RADII), V = nulls(SPEEDS);
  if (main && main.ok) {
    R.R1 = main.R.R1; V.V1 = main.V.V1;
    R.R3 = main.R.R3; V.V3 = main.V.V3;
    if (main.kind === 'through') { R.R2 = main.R.R2; V.V2 = main.V.V2; }
  }
  if (left && left.ok) { R.R4 = left.R.R4; V.V4 = left.V.V4; }
  if (right && right.ok) { R.R5 = right.R.R5; V.V5 = right.V.V5; }
  return {
    idx: L.idx, id: L.id, name: L.name, bearing: L.bearing, approachSpeed: L.approachSpeed,
    through: through ? through.id : null, left: left ? left.id : null, right: right ? right.id : null,
    main: main ? main.id : null, mainKind: main ? main.kind : null,
    R, V,
    Vcirc: circOf(main),
    upstreamIdx, upstream: G.legs[upstreamIdx].id, upstreamName: G.legs[upstreamIdx].name,
    conflicting: conflicting ? conflicting.id : null,
    conflictingKind: conflicting ? conflicting.kind : null,
    Vconf: circOf(conflicting),
    exitSpeed: fastestExit ? fastestExit.V.V3 : null,
    exitMovement: fastestExit ? fastestExit.id : null,
    entryWidthBuilt: L.entryWidthBuilt, exitWidthBuilt: L.exitWidthBuilt,
    entryRadiusBuilt: L.entryRadiusBuilt, exitRadiusBuilt: L.exitRadiusBuilt,
  };
}

function isdTriangle(G, eye, L, m, speed, stream, s, rr, W) {
  const len = intersectionSightLength(speed, rr);
  const path = m.local;
  const range = insideRange(path, G.Ri + 1);
  if (!range) return null;
  const tri = sightTriangle(eye, path, L.entranceMid, len, range);
  if (!tri) return null;
  return {
    leg: L.id, stream, movement: m.id, from: m.from, speed, length: len, reached: tri.reached,
    eye: W(tri.eye), conflict: W(tri.conflict), end: W(tri.end), polygon: tri.polygon.map(W),
  };
}

function publicMovement(m, W) {
  const out = {
    id: m.id, from: m.from, to: m.to, kind: m.kind, turn: m.turn, ok: m.ok, problems: m.problems,
    R: m.R, V: m.V, d12: m.d12, d23: m.d23, arcs: {}, path: null,
  };
  if (!m.ok) { out.place = m.place; return out; }
  const p = m.local;
  const x = new Array(p.n), y = new Array(p.n), s = new Array(p.n), speed = new Array(p.n);
  for (let k = 0; k < p.n; k++) {
    const q = W({ x: p.x[k], y: p.y[k] });
    x[k] = q.x; y[k] = q.y; s[k] = p.s[k]; speed[k] = p.speed[k];
  }
  out.path = { n: p.n, x, y, s, speed };
  for (const [name, a] of Object.entries(m.radii.arcs)) {
    if (!a || a.a < 0) continue;
    const vName = 'V' + name.slice(1);
    out.arcs[name] = { r: a.r, sStart: p.s[a.a], sEnd: p.s[a.b], sMid: a.sMid, mid: W(pointAt(p, a.sMid)), speed: m.V[vName] };
  }
  out.solver = m.solver;
  return out;
}

function pointAt(p, sv) {
  let lo = 0, hi = p.n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (p.s[mid] <= sv) lo = mid; else hi = mid; }
  const f = p.s[hi] > p.s[lo] ? (sv - p.s[lo]) / (p.s[hi] - p.s[lo]) : 0;
  return { x: p.x[lo] + (p.x[hi] - p.x[lo]) * f, y: p.y[lo] + (p.y[hi] - p.y[lo]) * f };
}

/** The leg summary without the engine's own bookkeeping (indexes into its internal arrays). */
function publicLeg(s) {
  const out = { ...s };
  delete out.idx; delete out.upstreamIdx; delete out.upstreamMain;
  return out;
}

/** Worst entry speed, worst speed difference, land take, and the count of fails and warns. */
function headline(legs, landTake, checks, problems) {
  const fails = checks.filter((c) => c.status === 'fail').length;
  const warns = checks.filter((c) => c.status === 'warn').length;
  let entry = null, drop = null;
  for (const L of legs) {
    // Compared to a hundredth of a mph, so that legs with the same speed keep the first one named rather than
    // whichever rounding happens to favour.
    for (const [v, m] of [[L.V.V1, L.main], [L.V.V5, L.right]]) {
      if (v !== null && (entry === null || above(v, entry.value))) entry = { value: v, leg: L.id, movement: m };
    }
    const d = speedDifference(L);
    if (d && (drop === null || above(d.value, drop.value))) drop = { ...d, leg: L.id };
  }
  const parts = [];
  if (problems && problems.length) {
    parts.push(`The shape cannot be built. ${problems[0]}`);
  } else {
    const nameOf = (id) => (legs.find((l) => l.id === id) || {}).name || id;
    if (entry) parts.push(`The fastest entry is ${mph(entry.value)}, on ${theLeg(nameOf(entry.leg))}.`);
    if (drop) parts.push(`The largest speed difference is ${mph(drop.value)}, on ${theLeg(nameOf(drop.leg))}.`);
    if (landTake) parts.push(`The roundabout takes ${whole(landTake.sqft)} square feet of land (${num(landTake.acres, 2)} acres).`);
  }
  parts.push(countSentence(fails, warns));
  return {
    worstEntrySpeed: entry,
    worstSpeedDrop: drop,
    landTake: landTake ? { sqft: landTake.sqft, acres: landTake.acres } : null,
    fails, warns,
    text: parts.join(' '),
  };
}

function above(a, b) {
  return Math.round(a * 100) > Math.round(b * 100);
}

function countSentence(fails, warns) {
  const n = (k) => (k === 1 ? '1 check' : `${k} checks`);
  if (!fails && !warns) return 'No check fails or warns.';
  if (!warns) return `${n(fails)} ${fails === 1 ? 'fails' : 'fail'} and none warns.`;
  if (!fails) return `No check fails and ${n(warns)} ${warns === 1 ? 'warns' : 'warn'}.`;
  return `${n(fails)} ${fails === 1 ? 'fails' : 'fail'} and ${n(warns)} ${warns === 1 ? 'warns' : 'warn'}.`;
}
