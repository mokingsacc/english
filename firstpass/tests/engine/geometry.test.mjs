import test from 'node:test';
import assert from 'node:assert/strict';
import { derive } from '../../public/js/engine/roundabout/derive.js';
import { validate, defaultRoundabout, defaultLeg } from '../../public/js/engine/roundabout/model.js';
import { resolveRules } from '../../public/js/engine/rules.js';
import { movementChains } from '../../public/js/engine/roundabout/corridor.js';
import { listMovements } from '../../public/js/engine/roundabout/fastest-path.js';
import { primTangent, primLength, closedChainArea, dist, flattenChain } from '../../public/js/engine/geom.js';
import { shapes } from './helpers.mjs';

const rr = resolveRules({});
const build = (r) => derive(validate(r).value, rr);

// Designed corners, where two pieces meet at an angle on purpose: the far point F (and Fx) where the edge
// line meets the flare line, the splitter island nose, and the island's ends Se and Sx on the circle.
function isDesignedCorner(G, p) {
  for (const L of G.legs) {
    for (const q of [L.F, L.Fx, L.nose, L.Se, L.Sx]) if (dist(p, q) < 1e-6) return true;
  }
  return false;
}

function checkChain(G, chain, name) {
  for (const p of chain) {
    assert.ok(primLength(p) > 0, `${name}: a piece of zero length`);
    if (p.type === 'arc') {
      assert.ok(Math.abs(dist(p.a, p.c) - p.r) < 1e-6 && Math.abs(dist(p.b, p.c) - p.r) < 1e-6, `${name}: arc ends off its circle`);
    }
  }
  for (let i = 1; i < chain.length; i++) {
    const p = chain[i - 1], q = chain[i];
    assert.ok(dist(p.b, q.a) < 1e-6, `${name}: gap of ${dist(p.b, q.a)} ft between pieces ${i - 1} and ${i}`);
    if (isDesignedCorner(G, q.a)) continue;
    const t1 = primTangent(p, true), t2 = primTangent(q, false);
    const angle = Math.atan2(t1.x * t2.y - t1.y * t2.x, t1.x * t2.x + t1.y * t2.y);
    assert.ok(Math.abs(angle) < 1e-6, `${name}: pieces ${i - 1} (${p.tag}) and ${i} (${q.tag}) meet at ${angle} rad`);
  }
}

test('every curb chain is continuous and tangent at its joints', () => {
  for (const [name, r] of Object.entries(shapes())) {
    const G = build(r);
    assert.ok(G.ok, `${name}: ${G.problems}`);
    for (const c of G.corners) checkChain(G, c.chain, `${name} corner ${c.from}-${c.to}`);
    for (const L of G.legs) {
      checkChain(G, L.entryChain, `${name} ${L.name} entry`);
      checkChain(G, L.exitChain, `${name} ${L.name} exit`);
      checkChain(G, L.splitter, `${name} ${L.name} splitter`);
      // The entry and exit curbs meet the inscribed circle on a tangent.
      const tEntry = primTangent(L.entryArc, true);
      const radial = { x: L.T2.x / G.Ri, y: L.T2.y / G.Ri };
      assert.ok(Math.abs(tEntry.x * radial.x + tEntry.y * radial.y) < 1e-9, `${name} ${L.name} entry curb is not tangent to the circle`);
      assert.ok(Math.abs(Math.hypot(L.T2.x, L.T2.y) - G.Ri) < 1e-9);
      assert.ok(Math.abs(Math.hypot(L.T2x.x, L.T2x.y) - G.Ri) < 1e-9);
    }
  }
});

test('every corridor chain of every movement is continuous and tangent except at designed corners', () => {
  for (const [name, r] of Object.entries(shapes())) {
    const G = build(r);
    for (const mv of listMovements(G)) {
      const ch = movementChains(G, mv.i, mv.j);
      checkChain(G, ch.right, `${name} ${mv.id} right`);
      checkChain(G, ch.left, `${name} ${mv.id} left`);
    }
  }
});

test('the default roundabout has the expected circles, legs and land take', () => {
  const G = build(defaultRoundabout());
  assert.equal(G.Ri, 65);
  assert.equal(G.Rc, 47);
  assert.equal(G.Ra, 37);
  assert.equal(G.legs.length, 4);
  // A north leg's entry lane is on its west side.
  const N = G.legs[0];
  assert.ok(N.T1.x < 0 && N.Se.x < 0 && N.Sx.x > 0);
  // Built widths come out wider than the nominal 16 ft because the curb arc cuts the corner.
  assert.ok(N.entryWidthBuilt > 16 && N.entryWidthBuilt < 22, String(N.entryWidthBuilt));
  assert.ok(N.exitWidthBuilt > 16 && N.exitWidthBuilt < 26, String(N.exitWidthBuilt));
  // Land take: the closed outline encloses more than the circle and less than a box round the noses.
  const area = G.landTake.sqft;
  assert.ok(area > Math.PI * 65 * 65 && area < (2 * 145) ** 2, String(area));
  assert.ok(Math.abs(closedChainArea(G.landTake.chain) - area) < 1e-6);
  // The outline as a polygon of many points gives nearly the same area.
  const pts = flattenChain(G.landTake.chain, 0.5);
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }
  assert.ok(Math.abs(a / 2 - area) / area < 1e-3);
  // The default sits right at the limit: barely any of the circle is left between one leg's entry curb and
  // the next leg's exit curb (see the report).
  for (const c of G.corners) assert.ok(c.sweep >= 0 && c.sweep < 0.001);
});

test('shapes that cannot be built are reported in plain words, not drawn', () => {
  const cases = [];
  const r1 = defaultRoundabout(); r1.icd = 70; r1.circWidth = 40;
  cases.push([r1, /no room for a central island/]);
  const r2 = defaultRoundabout(); r2.apronWidth = 30; r2.icd = 80; r2.circWidth = 18;
  cases.push([r2, /truck apron/]);
  const r3 = defaultRoundabout(); r3.legs = [0, 75, 180, 255].map((b) => defaultLeg(b));
  cases.push([r3, /runs into the exit curb/]);
  const r4 = defaultRoundabout(); r4.legs[1].bearing = 0.5;
  cases.push([r4, /point the same way|runs into|overlap|crosses/]);
  const r5 = defaultRoundabout(); r5.legs[0].entryRadius = 250; r5.legs[0].splitterLength = 20;
  cases.push([r5, /too big for its splitter island|runs into|crosses/]);
  for (const [r, re] of cases) {
    const G = build(r);
    assert.equal(G.ok, false);
    assert.match(G.problems.join(' '), re);
  }
});

test('legs are taken counterclockwise whatever order they are listed in', () => {
  const r = defaultRoundabout();
  r.legs = [r.legs[2], r.legs[0], r.legs[3], r.legs[1]];
  const G = build(r);
  assert.ok(G.ok);
  const order = G.ccw.map((i) => G.legs[i].id);
  // Counterclockwise from east: north, west, south.
  const k = order.indexOf('E');
  assert.deepEqual([0, 1, 2, 3].map((q) => order[(k + q) % 4]), ['E', 'N', 'W', 'S']);
});
