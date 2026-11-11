import test from 'node:test';
import assert from 'node:assert/strict';
import { derive } from '../../public/js/engine/roundabout/derive.js';
import { validate, defaultRoundabout, defaultLeg } from '../../public/js/engine/roundabout/model.js';
import { resolveRules } from '../../public/js/engine/rules.js';
import { movementChains } from '../../public/js/engine/roundabout/corridor.js';
import { listMovements } from '../../public/js/engine/roundabout/fastest-path.js';
import { primTangent, primLength, closedChainArea, dist, dot, flattenChain, DEG } from '../../public/js/engine/geom.js';
import { shapes } from './helpers.mjs';

const rr = resolveRules({});
const build = (r) => derive(validate(r).value, rr);

// Designed corners, where two pieces meet at an angle on purpose: the far point F (and Fx) where the edge
// line meets the curb's flare beside the island, where that flare meets the straight curb (or the curve), the
// splitter island's nose, the corners of its taper, its ends Se and Sx on the circle, and (in a right turn's
// corridor) the point where the two lines toward the central island cross. Where the island's edge leaves its
// body line for the arc beside the curve is not one: the two are tangent there.
function isDesignedCorner(G, p, q) {
  if (p.tag === 'hull' && q.tag === 'hull') return true;
  for (const L of G.legs) {
    const corners = [L.F, L.Fx, L.nose, L.Se, L.Sx, L.entryCurbTaper, L.exitCurbTaper, L.islandEntryTaper,
      L.islandExitTaper];
    for (const c of corners) if (c && dist(q.a, c) < 1e-6) return true;
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

test('the default roundabout has the expected circles, legs, islands and land take', () => {
  const G = build(defaultRoundabout());
  assert.equal(G.Ri, 65);
  assert.equal(G.Rc, 47);
  assert.equal(G.Ra, 37);
  assert.equal(G.legs.length, 4);
  // A north leg's entry lane is on its west side.
  const N = G.legs[0];
  assert.ok(N.T1.x < 0 && N.Se.x < 0 && N.Sx.x > 0);
  for (const L of G.legs) {
    // Built as asked: widths measured square to the curb from the island's ends, the radii and the island.
    assert.ok(Math.abs(L.entryWidthBuilt - 16) < 1e-9 && Math.abs(L.exitWidthBuilt - 17) < 1e-9, `${L.entryWidthBuilt} ${L.exitWidthBuilt}`);
    assert.equal(L.entryRadiusBuilt, 60);
    assert.equal(L.exitRadiusBuilt, 80);
    assert.equal(L.splitterLengthBuilt, 110);
    // Beside the island's body the lane has the entry (or exit) width: the straight curb is half the island
    // plus that width from the axis, and the island is at its body width where the farther curve begins.
    assert.ok(Math.abs(L.lat(L.T1) - 23) < 1e-9 && Math.abs(L.lat(L.T1x) + 24) < 1e-9);
    assert.ok(Math.abs(L.lat(L.islandEntryTaper) - 7) < 1e-9 && Math.abs(L.lat(L.islandExitTaper) + 7) < 1e-9);
    // Beside the curves the island's edges follow the lanes, so it is wider at the circle than its body.
    assert.ok(L.splitterWidthAtCircle > 14, String(L.splitterWidthAtCircle));
    assert.equal(L.islandEntryRadius, 60 + 16);
    assert.equal(L.islandExitRadius, 80 + 17);
    // The island's edge leaves its body line where the curve begins, square across from the curve's start.
    assert.ok(dist(L.islandEntryJoin, L.P(L.st(L.T1), 7)) < 1e-9 && dist(L.islandExitJoin, L.P(L.st(L.T1x), -7)) < 1e-9);
    assert.equal(L.islandEntryStep, null);
    assert.equal(L.islandExitStep, null);
  }
  assert.deepEqual(G.warnings, []);
  assert.deepEqual(G.notes, []);
  // Land take: the closed outline encloses more than the circle and less than a box round the noses.
  const area = G.landTake.sqft;
  assert.ok(area > Math.PI * 65 * 65 && area < (2 * 175) ** 2, String(area));
  assert.ok(Math.abs(closedChainArea(G.landTake.chain) - area) < 1e-6);
  // The outline as a polygon of many points gives nearly the same area.
  const pts = flattenChain(G.landTake.chain, 0.5);
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p.x * q.y - q.x * p.y; }
  assert.ok(Math.abs(a / 2 - area) / area < 1e-3);
  // Some of the inscribed circle between every entry curve and the next exit curve: about 2.6 degrees.
  for (const c of G.corners) {
    assert.ok(!c.touching && c.sweep >= 2.5 * DEG, `corner ${c.from}-${c.to}: ${c.sweep / DEG} degrees`);
    assert.equal(c.chain.filter((p) => p.type === 'arc' && p.c.x === 0 && p.c.y === 0).length, 1);
  }
});

/** The shortest distance from S to a curb chain, found by walking along each of its pieces in short steps. */
function walkedWidth(S, curb) {
  let best = Infinity;
  for (const p of curb) {
    if (p.type === 'line') {
      const n = Math.max(1, Math.ceil(dist(p.a, p.b) / 0.02));
      for (let k = 0; k <= n; k++) best = Math.min(best, dist({ x: p.a.x + ((p.b.x - p.a.x) * k) / n, y: p.a.y + ((p.b.y - p.a.y) * k) / n }, S));
    } else {
      for (const q of flattenChain([p], 0.02, 0.02 * DEG)) best = Math.min(best, dist(q, S));
    }
  }
  return best;
}

test('built widths equal the widths asked for, across widths, radii and circle sizes', () => {
  let built = 0, refused = 0;
  for (const icd of [90, 130, 200, 300]) {
    for (const [er, xr] of [[30, 40], [50, 65], [65, 100], [100, 200], [150, 400]]) {
      for (const w of [12, 14, 16, 18, 20, 23, 25]) {
        const r = defaultRoundabout();
        r.icd = icd;
        r.circWidth = Math.min(18, icd / 2 - 10);
        r.apronWidth = 0;
        r.legs.forEach((l) => Object.assign(l, { entryRadius: er, exitRadius: xr, entryWidth: w, exitWidth: w + 1 }));
        const G = build(r);
        const label = `icd ${icd} radii ${er} ${xr} width ${w}`;
        if (!G.ok) {
          // Only what cannot physically be built is refused, in words that say what: on the 90 ft circle,
          // four legs with entries of 16 ft or more do not fit even with the smallest curb radii.
          assert.match(G.problems.join(' '), /too close together/, label);
          assert.ok(icd === 90 && w >= 16, label);
          refused++;
          continue;
        }
        built++;
        for (const L of G.legs) {
          assert.ok(Math.abs(L.entryWidthBuilt - w) < 1e-6 && Math.abs(L.exitWidthBuilt - (w + 1)) < 1e-6, `${label}: ${L.entryWidthBuilt} ${L.exitWidthBuilt}`);
          // Measured independently, by walking the curb as built, from the island's ends.
          assert.ok(Math.abs(walkedWidth(L.Se, L.entryCurb) - w) < 0.01, label);
          assert.ok(Math.abs(walkedWidth(L.Sx, L.exitCurb) - (w + 1)) < 0.01, label);
          assert.ok(Math.abs(dist(L.Se, L.entryWidthPoint) - L.entryWidthBuilt) < 1e-6, label);
          assert.ok(Math.abs(dist(L.Sx, L.exitWidthPoint) - L.exitWidthBuilt) < 1e-6, label);
        }
      }
    }
  }
  assert.ok(built >= 115 && refused <= 25, `${built} built, ${refused} refused`);
});

test('every test shape is built with the widths it asks for, the T and offset shapes included', () => {
  for (const [name, r] of Object.entries(shapes())) {
    const G = build(r);
    assert.ok(G.ok, `${name}: ${G.problems}`);
    r.legs.forEach((lg, i) => {
      const L = G.legs[i];
      assert.ok(Math.abs(L.entryWidthBuilt - lg.entryWidth) < 1e-6, `${name} ${L.name} entry ${L.entryWidthBuilt}`);
      assert.ok(Math.abs(L.exitWidthBuilt - lg.exitWidth) < 1e-6, `${name} ${L.name} exit ${L.exitWidthBuilt}`);
      assert.ok(Math.abs(walkedWidth(L.Se, L.entryCurb) - lg.entryWidth) < 0.01, `${name} ${L.name} entry walked`);
      assert.ok(Math.abs(walkedWidth(L.Sx, L.exitCurb) - lg.exitWidth) < 0.01, `${name} ${L.name} exit walked`);
    });
  }
});

test('the island: lanes follow the curb, the island is what is left, and it reaches past the farther curve', () => {
  const noseMargin = rr.get('geom.noseMargin'), noseTaper = rr.get('geom.noseTaper');
  for (const [name, r] of Object.entries(shapes())) {
    const G = build(r);
    for (const L of G.legs) {
      const label = `${name} ${L.name}`;
      // The island is one closed outline: nose, entry edge, the circle between Se and Sx, exit edge, nose.
      assert.ok(dist(L.splitter[0].a, L.nose) < 1e-9 && dist(L.splitter[L.splitter.length - 1].b, L.nose) < 1e-9, label);
      // Along the taper the lane flares, square to the leg, from the approach (or departure) lane width at the
      // nose to the entry (or exit) width where the island reaches its body width.
      for (const f of [0, 0.25, 0.5, 0.75, 1]) {
        const s = L.sBody + f * (L.sNose - L.sBody);
        assert.ok(Math.abs(L.entryCurbQ(s) - L.entryIslandQ(s) - (L.entryWidth + (L.approachWidth - L.entryWidth) * f)) < 1e-9, label);
        assert.ok(Math.abs(L.exitCurbQ(s) - L.exitIslandQ(s) - (L.exitWidth + (L.departWidth - L.exitWidth) * f)) < 1e-9, label);
      }
      // Beside the body the lane has the entry (or exit) width, out to where its curve begins.
      for (const s of [L.st(L.T1), L.sBody]) assert.ok(Math.abs(L.entryCurbQ(s) - L.entryIslandQ(s) - L.entryWidth) < 1e-9, label);
      for (const s of [L.st(L.T1x), L.sBody]) assert.ok(Math.abs(L.exitCurbQ(s) - L.exitIslandQ(s) - L.exitWidth) < 1e-9, label);
      // No curb and no edge of the island shifts sideways along the taper more steeply than one in noseTaper.
      const taper = L.sNose - L.sBody;
      const shift = Math.max(L.hw, Math.abs(L.hw + L.entryWidth - L.approachWidth), Math.abs(L.hw + L.exitWidth - L.departWidth));
      assert.ok(taper >= noseTaper * shift - 1e-9 && taper >= noseMargin - 1e-9, label);
      // The nose is where it was asked to be, or further out so that the island reaches past both curves.
      const asked = L.splitterLength;
      assert.ok(L.splitterLengthBuilt >= asked - 1e-9, label);
      assert.ok(L.sNose >= Math.max(dot(L.T1, L.u), dot(L.T1x, L.u)) + noseMargin - 1e-9, label);
      if (L.splitterLengthBuilt > asked + 0.05) assert.ok(G.notes.some((n) => n.leg === L.id && /is built [\d.]+ ft long, not/.test(n.text)), label);
      else assert.ok(!G.notes.some((n) => n.leg === L.id && /ft long, not/.test(n.text)), label);
      // The island is never narrower than its body: each edge keeps at least half the body width from the axis
      // all the way to the circle.
      assert.ok(L.splitterWidthAtCircle >= L.splitterWidth - 1e-9, label);
      for (let s = L.sBody; s > L.st(L.Se); s -= 0.5) assert.ok(L.entryIslandQ(s) >= L.hw - 1e-9, label);
      for (let s = L.sBody; s > L.st(L.Sx); s -= 0.5) assert.ok(L.exitIslandQ(s) >= L.hw - 1e-9, label);
    }
  }
  // A short island asked for is built long enough, and says so. With the default sizes the exit curb shifts
  // 12 ft along the taper (half the island and the exit width, less the departure lane), so the taper is 72 ft.
  const r = defaultRoundabout(); r.legs[0].splitterLength = 20;
  const G = build(r);
  assert.ok(G.ok);
  assert.ok(G.legs[0].splitterLengthBuilt > 80);
  assert.match(G.notes[0].text, /^The splitter island of the North leg is built [\d.]+ ft long, not 20 ft, so that it runs 72 ft past where its entry and exit curves begin and its lanes have room to widen beside it\.$/);
});

test('a tight entry curve beside a wide island: the island meets the circle on its body line', () => {
  // A 30 ft entry curb radius beside a 40 ft island: the island's body line reaches the circle before the
  // curve begins, so the island meets the circle at its body width and the curb is straight beside it there.
  const r = defaultRoundabout();
  r.legs = [0, 120, 240].map((b) => defaultLeg(b));
  Object.assign(r.legs[0], { entryRadius: 30, entryWidth: 26, splitterWidth: 40 });
  const G = build(r);
  assert.ok(G.ok, String(G.problems));
  const L = G.legs[0];
  assert.equal(L.entrySide.kind, 'body');
  assert.ok(Math.abs(L.lat(L.Se) - 20) < 1e-9);
  assert.ok(L.st(L.Se) > L.st(L.T1));
  assert.equal(L.islandEntryRadius, null);
  assert.ok(dist(L.islandEntryJoin, L.Se) < 1e-9);
  assert.ok(Math.abs(L.entryWidthBuilt - 26) < 1e-9);
  assert.ok(Math.abs(walkedWidth(L.Se, L.entryCurb) - 26) < 0.01);
  checkChain(G, L.splitter, 'body line island');
  checkChain(G, L.entryChain, 'body line entry');
});

test('ordinary curb radii build on ordinary circles: entry 30 to 150 ft, exit 40 to 400 ft, circles 110 to 200 ft', () => {
  for (const icd of [110, 130, 150, 180, 200]) {
    for (const er of [30, 40, 50, 65, 80, 100, 120, 150]) {
      for (const xr of [40, 65, 100, 150, 200, 300, 400]) {
        const r = defaultRoundabout();
        r.icd = icd;
        r.legs.forEach((l) => Object.assign(l, { entryRadius: er, exitRadius: xr }));
        const G = build(r);
        const label = `icd ${icd} radii ${er} ${xr}`;
        assert.ok(G.ok, `${label}: ${G.problems}`);
        for (const w of G.warnings) assert.match(w, /meet with no circle between them/, label);
        for (const L of G.legs) {
          assert.ok(Math.abs(L.entryWidthBuilt - 16) < 1e-6 && Math.abs(L.exitWidthBuilt - 17) < 1e-6, label);
          assert.ok(L.entryRadiusBuilt <= er && L.exitRadiusBuilt <= xr, label);
        }
      }
    }
  }
});

test('turning one leg 40 degrees either way: radii as asked to 2 degrees, then shortened smoothly, then refused at 19', () => {
  // The stated limit: with the default sizes a leg turns 2 degrees either way before a corner needs shorter
  // radii, and 18 degrees before even the smallest allowed radii (30 ft entry, 40 ft exit) do not fit.
  for (const k of [0, 1]) {
    let prev = null;
    for (let d = -40; d <= 40; d++) {
      const r = defaultRoundabout();
      r.legs[k].bearing = (r.legs[k].bearing + d + 360) % 360;
      const G = build(r);
      if (Math.abs(d) >= 19) {
        assert.equal(G.ok, false, `leg ${k} turned ${d}`);
        assert.match(G.problems[0], /are too close together\. Even with the smallest curb radii allowed \(30 ft at the entry and 40 ft at the exit\).* Spread the two legs about \d+ degrees? further apart/);
        prev = null;
        continue;
      }
      assert.ok(G.ok, `leg ${k} turned ${d}: ${G.problems}`);
      const radii = G.legs.flatMap((L) => [L.entryRadiusBuilt, L.exitRadiusBuilt]);
      if (Math.abs(d) <= 2) {
        assert.deepEqual(radii, G.legs.flatMap(() => [60, 80]), `leg ${k} turned ${d}`);
        assert.deepEqual(G.warnings, []);
      } else {
        assert.equal(G.warnings.length, 1, `leg ${k} turned ${d}`);
        assert.ok(G.corners.some((c) => c.touching));
      }
      for (const v of radii) assert.ok(v >= 30 - 1e-9 && v <= 80);
      // No jumps while dragging: at most 4 ft per degree.
      if (prev) radii.forEach((v, i) => assert.ok(Math.abs(v - prev[i]) <= 4, `leg ${k} turned ${d}: ${prev[i]} to ${v}`));
      prev = radii;
    }
  }
});

test('a shortened corner: both curves meet on the circle at one point, tangent, and the warning names them', () => {
  const G = build(shapes().turned);
  assert.ok(G.ok, String(G.problems));
  const E = G.legs[1], N = G.legs[0];
  assert.deepEqual(G.warnings, [
    `The East leg's entry curve and the North leg's exit curve meet with no circle between them, so they are built at ${Math.round(E.entryRadiusBuilt)} ft and ${Math.round(N.exitRadiusBuilt)} ft, not 60 ft and 80 ft.`,
  ]);
  // One common factor for both.
  assert.ok(Math.abs(E.entryRadiusBuilt / 60 - N.exitRadiusBuilt / 80) < 1e-9);
  assert.ok(E.entryRadiusBuilt < 60 && N.exitRadiusBuilt < 80);
  assert.ok(dist(E.T2, N.T2x) < 1e-6);
  const corner = G.corners.find((c) => c.from === 1 && c.to === 0);
  assert.ok(corner.touching);
  assert.ok(!corner.chain.some((p) => p.type === 'arc' && p.c.x === 0 && p.c.y === 0), 'no circle between the two curves');
  checkChain(G, corner.chain, 'turned corner');
  // The built curves are the ones drawn, the ones the island's edges follow, and the ones the fastest paths
  // are kept clear of.
  assert.equal(E.entryArc.r, E.entryRadiusBuilt);
  assert.equal(N.exitArc.r, N.exitRadiusBuilt);
  assert.equal(E.islandEntryRadius, E.entryRadiusBuilt + E.entryWidth);
  assert.equal(N.islandExitRadius, N.exitRadiusBuilt + N.exitWidth);
  assert.ok(Math.abs(E.entryWidthBuilt - 16) < 1e-9 && Math.abs(N.exitWidthBuilt - 17) < 1e-9);
  const right = movementChains(G, 1, 0).right;
  assert.ok(right.includes(E.entryArc) && right.includes(N.exitArc));
  // The other legs keep their radii.
  assert.equal(G.legs[2].entryRadiusBuilt, 60);
  assert.equal(G.legs[3].exitRadiusBuilt, 80);
});

test('shapes that cannot be built are reported in plain words, not drawn', () => {
  const cases = [];
  const r1 = defaultRoundabout(); r1.icd = 70; r1.circWidth = 40;
  cases.push([r1, /no room for a central island/]);
  const r2 = defaultRoundabout(); r2.apronWidth = 30; r2.icd = 80; r2.circWidth = 18;
  cases.push([r2, /truck apron/]);
  const r3 = defaultRoundabout(); r3.legs = [0, 50, 180, 230].map((b) => defaultLeg(b));
  cases.push([r3, /The Northeast leg and the North leg are too close together\..* Spread the two legs about \d+ degrees further apart/]);
  const r4 = defaultRoundabout(); r4.legs[1].bearing = 0.5;
  cases.push([r4, /point the same way|too close together|overlap|crosses/]);
  // An outer curb too far out to turn onto the circle.
  const r5 = defaultRoundabout(); r5.icd = 70; r5.circWidth = 14; r5.apronWidth = 0;
  Object.assign(r5.legs[0], { splitterWidth: 40 });
  cases.push([r5, /^The entry curb of the North leg cannot turn onto the circle: it runs 36 ft from the leg's centre line \(half the splitter island and the entry width\), too far out for a 70 ft circle\. Make the circle bigger, or the splitter island or the entry narrower\. The exit curb of the North leg cannot turn onto the circle: it runs 37 ft/]);
  // Wide entries and exits on a small circle crowd the corners: no curb radius fits.
  const r6 = defaultRoundabout(); r6.icd = 90; r6.circWidth = 18; r6.apronWidth = 0;
  r6.legs.forEach((l) => Object.assign(l, { entryWidth: 20, exitWidth: 21 }));
  cases.push([r6, /too close together\..* or make that entry or exit narrower\.$/]);
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
