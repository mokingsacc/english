import test from 'node:test';
import assert from 'node:assert/strict';
import { derive } from '../../public/js/engine/roundabout/derive.js';
import { validate, defaultRoundabout, defaultLeg } from '../../public/js/engine/roundabout/model.js';
import { resolveRules } from '../../public/js/engine/rules.js';
import { movementChains } from '../../public/js/engine/roundabout/corridor.js';
import { listMovements } from '../../public/js/engine/roundabout/fastest-path.js';
import { primTangent, primLength, closedChainArea, dist, flattenChain, reversePrim, DEG } from '../../public/js/engine/geom.js';
import { shapes } from './helpers.mjs';

const rr = resolveRules({});
const build = (r) => derive(validate(r).value, rr);

// Designed corners, where two pieces meet at an angle on purpose: the far point F (and Fx) where the edge
// line meets the flare line, the splitter island nose, the island's ends Se and Sx on the circle, and (in a
// right turn's corridor) the point where the two lines toward the central island cross.
function isDesignedCorner(G, p, q) {
  if (p.tag === 'hull' && q.tag === 'hull') return true;
  for (const L of G.legs) {
    for (const c of [L.F, L.Fx, L.nose, L.Se, L.Sx]) if (dist(q.a, c) < 1e-6) return true;
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
    if (isDesignedCorner(G, p, q)) continue;
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
  // Built as asked: widths measured square to the curb from the island's ends, and the radii.
  for (const L of G.legs) {
    assert.ok(Math.abs(L.entryWidthBuilt - 16.5) < 1e-6 && Math.abs(L.exitWidthBuilt - 18) < 1e-6, `${L.entryWidthBuilt} ${L.exitWidthBuilt}`);
    assert.equal(L.entryRadiusBuilt, 50);
    assert.equal(L.exitRadiusBuilt, 65);
  }
  assert.deepEqual(G.warnings, []);
  // Land take: the closed outline encloses more than the circle and less than a box round the noses.
  const area = G.landTake.sqft;
  assert.ok(area > Math.PI * 65 * 65 && area < (2 * 145) ** 2, String(area));
  assert.ok(Math.abs(closedChainArea(G.landTake.chain) - area) < 1e-6);
  // The outline as a polygon of many points gives nearly the same area.
  const pts = flattenChain(G.landTake.chain, 0.5);
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }
  assert.ok(Math.abs(a / 2 - area) / area < 1e-3);
  // Slack: at least 15 degrees of the circle between every entry curve and the next exit curve, so any leg
  // can turn 15 degrees either way before a corner needs shorter radii.
  for (const c of G.corners) {
    assert.ok(!c.touching && c.sweep >= 15 * DEG, `corner ${c.from}-${c.to}: ${c.sweep / DEG} degrees`);
    assert.equal(c.chain.filter((p) => p.type === 'arc' && p.c.x === 0 && p.c.y === 0).length, 1);
  }
});

/** The shortest distance from S to a curb (its line, then its arc), found by walking along it in short steps. */
function walkedWidth(S, F, T1, arcPrim) {
  let best = Infinity;
  const n = Math.ceil(dist(F, T1) / 0.02);
  for (let k = 0; k <= n; k++) best = Math.min(best, dist({ x: F.x + ((T1.x - F.x) * k) / n, y: F.y + ((T1.y - F.y) * k) / n }, S));
  for (const p of flattenChain([arcPrim], 0.02, 0.02 * DEG)) best = Math.min(best, dist(p, S));
  return best;
}

test('built widths equal the widths asked for, across widths, radii and circle sizes', () => {
  let built = 0, refused = 0;
  for (const icd of [90, 130, 200, 300]) {
    for (const [er, xr] of [[30, 40], [50, 65], [80, 100], [120, 160]]) {
      for (const w of [12, 14, 16, 18, 20, 23, 25]) {
        const r = defaultRoundabout();
        r.icd = icd;
        r.circWidth = Math.min(18, icd / 2 - 10);
        r.apronWidth = 0;
        r.legs.forEach((l) => Object.assign(l, { entryRadius: er, exitRadius: xr, entryWidth: w, exitWidth: w + 1 }));
        const G = build(r);
        const label = `icd ${icd} radii ${er} ${xr} width ${w}`;
        if (!G.ok) {
          // A width that cannot be built is refused in words that name it.
          assert.match(G.problems.join(' '), /cannot be (as narrow as )?\d+(\.\d)? ft|too close together/, label);
          refused++;
          continue;
        }
        built++;
        for (const L of G.legs) {
          assert.ok(Math.abs(L.entryWidthBuilt - w) < 0.05 && Math.abs(L.exitWidthBuilt - (w + 1)) < 0.05, `${label}: ${L.entryWidthBuilt} ${L.exitWidthBuilt}`);
          // Measured independently, square to the curb as built from the island's ends.
          assert.ok(Math.abs(walkedWidth(L.Se, L.F, L.T1, L.entryArc) - L.entryWidthBuilt) < 0.01, label);
          assert.ok(Math.abs(walkedWidth(L.Sx, L.Fx, L.T1x, reversePrim(L.exitArc)) - L.exitWidthBuilt) < 0.01, label);
          assert.ok(Math.abs(dist(L.Se, L.entryWidthPoint) - L.entryWidthBuilt) < 1e-6, label);
          assert.ok(Math.abs(dist(L.Sx, L.exitWidthPoint) - L.exitWidthBuilt) < 1e-6, label);
        }
      }
    }
  }
  assert.ok(built >= 40 && refused >= 10, `${built} built, ${refused} refused`);
});

test('every test shape is built with the widths it asks for, the T and offset shapes included', () => {
  for (const [name, r] of Object.entries(shapes())) {
    const G = build(r);
    assert.ok(G.ok, `${name}: ${G.problems}`);
    r.legs.forEach((lg, i) => {
      const L = G.legs[i];
      assert.ok(Math.abs(L.entryWidthBuilt - lg.entryWidth) < 1e-6, `${name} ${L.name} entry ${L.entryWidthBuilt}`);
      assert.ok(Math.abs(L.exitWidthBuilt - lg.exitWidth) < 1e-6, `${name} ${L.name} exit ${L.exitWidthBuilt}`);
    });
  }
});

test('turning one leg 40 degrees either way: radii as asked to 15 degrees, then shortened smoothly, then refused', () => {
  // The stated limit: with the default sizes a leg turns 15 degrees either way before a corner needs shorter
  // radii, and 22 degrees before even the smallest allowed radii (30 ft entry, 40 ft exit) do not fit.
  for (const k of [0, 1]) {
    let prev = null;
    for (let d = -40; d <= 40; d++) {
      const r = defaultRoundabout();
      r.legs[k].bearing = (r.legs[k].bearing + d + 360) % 360;
      const G = build(r);
      if (Math.abs(d) > 22) {
        assert.equal(G.ok, false, `leg ${k} turned ${d}`);
        assert.match(G.problems[0], /are too close together\. Even with the smallest curb radii allowed \(30 ft at the entry and 40 ft at the exit\).* Spread the two legs about \d+ degrees? further apart/);
        prev = null;
        continue;
      }
      assert.ok(G.ok, `leg ${k} turned ${d}: ${G.problems}`);
      const radii = G.legs.flatMap((L) => [L.entryRadiusBuilt, L.exitRadiusBuilt]);
      if (Math.abs(d) <= 15) {
        assert.deepEqual(radii, G.legs.flatMap(() => [50, 65]), `leg ${k} turned ${d}`);
        assert.deepEqual(G.warnings, []);
      } else {
        assert.equal(G.warnings.length, 1, `leg ${k} turned ${d}`);
        assert.ok(G.corners.some((c) => c.touching));
      }
      for (const v of radii) assert.ok(v >= 30 - 1e-9 && v <= 65);
      // No jumps while dragging: at most 6 ft per degree.
      if (prev) radii.forEach((v, i) => assert.ok(Math.abs(v - prev[i]) <= 6, `leg ${k} turned ${d}: ${prev[i]} to ${v}`));
      prev = radii;
    }
  }
});

test('a shortened corner: both curves meet on the circle at one point, tangent, and the warning names them', () => {
  const G = build(shapes().turned);
  assert.ok(G.ok, String(G.problems));
  const E = G.legs[1], N = G.legs[0];
  assert.deepEqual(G.warnings, [
    `The East leg's entry curve and the North leg's exit curve meet with no circle between them, so they are built at ${Math.round(E.entryRadiusBuilt)} ft and ${Math.round(N.exitRadiusBuilt)} ft, not 50 ft and 65 ft.`,
  ]);
  // One common factor for both.
  assert.ok(Math.abs(E.entryRadiusBuilt / 50 - N.exitRadiusBuilt / 65) < 1e-9);
  assert.ok(E.entryRadiusBuilt < 50 && N.exitRadiusBuilt < 65);
  assert.ok(dist(E.T2, N.T2x) < 1e-6);
  const corner = G.corners.find((c) => c.from === 1 && c.to === 0);
  assert.ok(corner.touching);
  assert.ok(!corner.chain.some((p) => p.type === 'arc' && p.c.x === 0 && p.c.y === 0), 'no circle between the two curves');
  checkChain(G, corner.chain, 'turned corner');
  // The built curves are the ones drawn and the ones the fastest paths are kept clear of.
  assert.equal(E.entryArc.r, E.entryRadiusBuilt);
  assert.equal(N.exitArc.r, N.exitRadiusBuilt);
  const right = movementChains(G, 1, 0).right;
  assert.ok(right.includes(E.entryArc) && right.includes(N.exitArc));
  // The other legs keep their radii.
  assert.equal(G.legs[2].entryRadiusBuilt, 50);
  assert.equal(G.legs[3].exitRadiusBuilt, 65);
});

test('shapes that cannot be built are reported in plain words, not drawn', () => {
  const cases = [];
  const r1 = defaultRoundabout(); r1.icd = 70; r1.circWidth = 40;
  cases.push([r1, /no room for a central island/]);
  const r2 = defaultRoundabout(); r2.apronWidth = 30; r2.icd = 80; r2.circWidth = 18;
  cases.push([r2, /truck apron/]);
  const r3 = defaultRoundabout(); r3.legs = [0, 50, 180, 230].map((b) => defaultLeg(b));
  cases.push([r3, /The Northeast leg and the North leg are too close together\..* Spread the two legs about 18 degrees further apart/]);
  const r4 = defaultRoundabout(); r4.legs[1].bearing = 0.5;
  cases.push([r4, /point the same way|too close together|overlap|crosses/]);
  const r5 = defaultRoundabout(); r5.legs[0].entryRadius = 250;
  cases.push([r5, /The entry of the North leg cannot be as narrow as 16\.5 ft with a 250 ft entry curb radius: the curve would have to start before the splitter island nose\. The narrowest it can be is about [\d.]+ ft\./]);
  const r6 = defaultRoundabout(); r6.legs[2].exitRadius = 150;
  cases.push([r6, /The exit of the South leg cannot be as narrow as 18 ft with a 150 ft exit curb radius: the curve would have to end beyond the splitter island nose/]);
  const r7 = defaultRoundabout(); r7.icd = 70; r7.circWidth = 14; r7.apronWidth = 0; r7.legs[1].entryWidth = 26;
  cases.push([r7, /The entry of the East leg cannot be 26 ft wide: the circle cannot take that much width there\. The most it can be is about [\d.]+ ft\./]);
  const r8 = defaultRoundabout(); r8.legs[0].splitterLength = 20;
  cases.push([r8, /The exit of the North leg cannot be 18 ft wide: the circle cannot take that much width there\. The most it can be is about 17\.1 ft\./]);
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
