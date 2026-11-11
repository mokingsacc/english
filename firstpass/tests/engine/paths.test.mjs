import test from 'node:test';
import assert from 'node:assert/strict';
import { derive } from '../../public/js/engine/roundabout/derive.js';
import { validate, defaultRoundabout } from '../../public/js/engine/roundabout/model.js';
import { resolveRules } from '../../public/js/engine/rules.js';
import { movementChains, compileMovement, clearanceFor } from '../../public/js/engine/roundabout/corridor.js';
import { listMovements, solveMovement, createPathWorkspace, pathRadii, passOptions } from '../../public/js/engine/roundabout/fastest-path.js';
import { chainSlack } from '../../public/js/engine/geom.js';
import { evaluate } from '../../public/js/engine/evaluate.js';
import { shapes } from './helpers.mjs';

const rr = resolveRules({});
const ws = createPathWorkspace();

function solveAll(r, rules = rr) {
  const G = derive(validate(r).value, rules);
  assert.ok(G.ok, String(G.problems));
  return { G, paths: listMovements(G).map((mv) => ({ mv, p: solveMovement(G, mv, rules, ws) })) };
}

test('movements: every leg to every other leg, classed by turn angle', () => {
  const { paths } = solveAll(defaultRoundabout());
  assert.equal(paths.length, 12);
  const kinds = Object.fromEntries(paths.map(({ mv }) => [mv.id, mv.kind]));
  assert.equal(kinds['N-S'], 'through');
  assert.equal(kinds['N-W'], 'right');
  assert.equal(kinds['N-E'], 'left');
  assert.equal(kinds['E-N'], 'right');
});

test('every path point keeps every clearance to within 0.05 ft', () => {
  for (const [name, r] of Object.entries(shapes())) {
    const { G, paths } = solveAll(r);
    const clr = clearanceFor(rr);
    for (const { mv, p } of paths) {
      assert.ok(p.ok, `${name} ${mv.id}: ${p.problems}`);
      const C = compileMovement(movementChains(G, mv.i, mv.j), clr);
      let worst = Infinity;
      for (let k = 0; k < p.n; k++) {
        worst = Math.min(worst, chainSlack(C.R, p.x[k], p.y[k]), chainSlack(C.L, p.x[k], p.y[k]));
      }
      assert.ok(worst >= -0.05, `${name} ${mv.id}: a point is ${-worst} ft inside a clearance`);
    }
  }
});

test('paths are smooth: no kinks, and the turn between neighbouring pieces stays small', () => {
  for (const [name, r] of Object.entries(shapes())) {
    const { paths } = solveAll(r);
    for (const { mv, p } of paths) {
      for (let k = 1; k < p.n - 1; k++) {
        const ax = p.x[k] - p.x[k - 1], ay = p.y[k] - p.y[k - 1], bx = p.x[k + 1] - p.x[k], by = p.y[k + 1] - p.y[k];
        const turn = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
        const h = 0.5 * (Math.hypot(ax, ay) + Math.hypot(bx, by));
        // Curvature turn / h of at most 1 / 25 ft: tighter than any curve a car follows here.
        assert.ok(turn / h < 1 / 25, `${name} ${mv.id} point ${k}: ${turn} rad over ${h} ft`);
      }
    }
  }
});

test('the circulating radius of a left turn lies within 15 percent of the island radius plus the curb clearance', () => {
  // Measured against the central island radius plus fp.offset.curb (the design's Rc + 5). A left turn hugs the
  // island over a long arc, so its fitted radius sits right at that value.
  for (const [name, r] of Object.entries(shapes())) {
    const e = evaluate(r, {});
    assert.ok(e.ok, name);
    const target = e.geometry.radii.island + rr.get('fp.offset.curb');
    for (const L of e.legs) {
      if (L.R.R4 === null) continue;
      assert.ok(Math.abs(L.R.R4 - target) <= 0.15 * target, `${name} ${L.id}: R4 ${L.R.R4} against ${target}`);
    }
  }
  const e = evaluate(defaultRoundabout(), {});
  for (const L of e.legs) assert.ok(Math.abs(L.R.R4 - 52) < 0.5, `default R4 ${L.R.R4}`);
});

test('a symmetric four-leg roundabout gives the same numbers on every leg', () => {
  for (const name of ['default', 'big', 'small']) {
    const e = evaluate(shapes()[name], {});
    const first = e.legs[0];
    for (const L of e.legs.slice(1)) {
      for (const k of ['R1', 'R2', 'R3', 'R4', 'R5']) assert.ok(Math.abs(L.R[k] - first.R[k]) < 0.5, `${name} ${L.id} ${k}: ${L.R[k]} against ${first.R[k]}`);
      for (const k of ['V1', 'V2', 'V3', 'V4', 'V5']) assert.ok(Math.abs(L.V[k] - first.V[k]) < 0.05, `${name} ${L.id} ${k}`);
    }
  }
});

test('the default roundabout lands in the expected speed band', () => {
  const e = evaluate(defaultRoundabout(), {});
  for (const L of e.legs) {
    assert.ok(L.V.V1 >= 18 && L.V.V1 <= 30, `V1 ${L.V.V1}`);
    assert.ok(L.V.V5 >= 15 && L.V.V5 <= 30, `V5 ${L.V.V5}`);
    assert.ok(L.V.V2 < L.V.V1);
    assert.ok(L.R.R2 > L.R.R4, 'a through path circulates on a flatter curve than a left turn');
  }
});

function legR1(r) {
  const e = evaluate(r, {});
  assert.ok(e.ok, String(e.problems));
  return e.legs[0].R.R1;
}

test('a wider entry never lowers R1', () => {
  // The entry width is measured at the circle, so a wider entry moves the whole curb line out beside the island
  // and gives the path more room. (Below 16 ft at the default 50 ft radius the lane beside the island narrows
  // too far for a car; see the geometry check.)
  let prev = -Infinity;
  for (let w = 16.5; w <= 26; w += 0.5) {
    const r = defaultRoundabout();
    r.legs[0].entryWidth = w;
    const R1 = legR1(r);
    assert.ok(R1 >= prev - 0.05, `entry width ${w}: R1 ${R1} after ${prev}`);
    prev = R1;
  }
});

test('a bigger entry radius changes R1 smoothly', () => {
  // With the width at the circle held, a bigger radius pulls the curb line in beside the island, so R1 need
  // not grow; it must still change smoothly, with no jumps.
  let prev = null;
  for (let er = 30; er <= 70; er += 1) {
    const r = defaultRoundabout();
    r.legs.forEach((l) => { l.entryWidth = 20; l.exitWidth = 21; });
    r.legs[0].entryRadius = er;
    const R1 = legR1(r);
    if (prev !== null) assert.ok(Math.abs(R1 - prev) < 4, `entry radius ${er}: R1 ${R1} after ${prev}`);
    prev = R1;
  }
});

test('shifting the approach further left never raises R1', () => {
  let prev = Infinity;
  for (let o = -7; o <= 8; o += 1) {
    const r = defaultRoundabout();
    r.legs.forEach((l) => { l.entryWidth = 20; l.exitWidth = 21; });
    r.legs[0].offsetLeft = o;
    const R1 = legR1(r);
    assert.ok(R1 <= prev + 0.05, `offset ${o}: R1 ${R1} after ${prev}`);
    prev = R1;
  }
});

test('the stopping rules used on drag frames agree with a solve to rounding', () => {
  const tight = () => ({ tol: 1e-13, ftol: 0, maxIter: 3000 });
  for (const name of ['default', 'skew', 'six']) {
    const G = derive(validate(shapes()[name]).value, rr);
    for (const mv of listMovements(G)) {
      const a = solveMovement(G, mv, rr, ws, passOptions);
      const ax = a.x.slice(), ay = a.y.slice();
      const Ra = pathRadii(a, mv, rr);
      const b = solveMovement(G, mv, rr, ws, tight);
      const Rb = pathRadii(b, mv, rr);
      let dev = 0;
      for (let k = 0; k < Math.min(a.n, b.n); k++) dev = Math.max(dev, Math.hypot(ax[k] - b.x[k], ay[k] - b.y[k]));
      assert.ok(a.n === b.n && dev < 0.01, `${name} ${mv.id}: ${dev} ft`);
      for (const k of ['R1', 'R2', 'R3', 'R4', 'R5']) {
        if (Ra[k] === null || !Number.isFinite(Ra[k])) continue;
        assert.ok(Math.abs(Ra[k] - Rb[k]) < 1e-3 * Rb[k], `${name} ${mv.id} ${k}`);
      }
    }
  }
});

test('solver.converged says whether each path was solved to its stopping rules', () => {
  for (const [name, r] of Object.entries(shapes())) {
    const e = evaluate(r, {});
    for (const m of e.movements.filter((x) => x.ok)) {
      assert.equal(m.solver.converged, true, `${name} ${m.id}: ${m.solver.stopReason}`);
      assert.ok(m.solver.stopReason === 'gradient' || m.solver.stopReason === 'objective');
      assert.ok(m.solver.gradTol > 0 && Number.isFinite(m.solver.gradNorm));
      if (m.solver.stopReason === 'gradient') assert.ok(m.solver.gradNorm <= m.solver.gradTol);
    }
  }
  // Cut short, the same solve says so.
  const G = derive(validate(defaultRoundabout()).value, rr);
  const mv = listMovements(G)[1];
  const cut = solveMovement(G, mv, rr, ws, () => ({ tol: 1e-14, ftol: 0, maxIter: 2 }));
  assert.equal(cut.solver.converged, false);
  assert.equal(cut.solver.stopReason, 'iterations');
});

test('a path that cannot fit is reported with its place', () => {
  const r = defaultRoundabout();
  r.circWidth = 12; // a 12 ft roadway cannot hold a car 5 ft clear of both curbs on a tight circle
  r.legs.forEach((l) => { l.entryWidth = 12; l.exitWidth = 12; l.exitRadius = 100; l.splitterWidth = 30; });
  const e = evaluate(r, {});
  if (!e.ok) return; // the shape itself may already be unbuildable; that is reported elsewhere
  const bad = e.movements.filter((m) => !m.ok);
  assert.ok(bad.length > 0, 'expected a path that cannot fit');
  for (const m of bad) {
    assert.match(m.problems[0], /cannot fit/);
    assert.ok(Number.isFinite(m.place.x) && Number.isFinite(m.place.y));
  }
  const geo = e.checks.find((c) => c.id === 'geometry');
  assert.equal(geo.status, 'fail');
});
