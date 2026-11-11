// Grips and the drawing index, against whatever evaluate gives today (no engine numbers here): every grip sits on a
// point the engine drew, dragging a grip by a known amount changes its value by that amount, and the index gives each
// leg and the roundabout their own lines, snaps and boxes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, defaultRoundabout, primPoint } from '../../public/js/engine/index.js';
import { GRIPS, gripPoints, gripPaths } from '../../public/js/app/grips/index.js';
import { curbArc, curveGrip, gripPlace, NEAR_END, radiusFromDrag, along, bearingOf, gearedAlong, MAX_PER_PX } from '../../public/js/app/grips/frame.js';
import { BEYOND_NOSE } from '../../public/js/app/grips/bearing.js';
import { indexOf, legIdOf, whereBox, roughExtents } from '../../public/js/app/model-index.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, msg || `${a} is not within ${tol} of ${b}`);
const round = defaultRoundabout();
const result = evaluate(round, {});
const grip = (id) => GRIPS.find((g) => g.id === id);
const legG = (id) => result.geometry.legs.find((l) => l.id === id);

test('the default roundabout builds (the grips below need a drawing)', () => {
  assert.ok(result.ok, result.problems && result.problems[0]);
});

test('selecting the roundabout and a leg gives each of their grips once, with unique keys', () => {
  const leg = round.legs[0];
  const pts = gripPoints(round, result, ['round', `leg:${leg.id}`]);
  const roundGrips = GRIPS.filter((g) => g.on === 'round').reduce((n, g) => n + g.points({ round, result }).length, 0);
  const legGrips = GRIPS.filter((g) => g.on === 'leg').length;
  assert.equal(pts.length, roundGrips + legGrips);
  assert.equal(new Set(pts.map((p) => p.key)).size, pts.length);
  assert.deepEqual(gripPaths(grip('entry-width'), leg), [`legs.${leg.id}.entryWidth`]);
  assert.deepEqual(gripPoints(round, null, ['round']), [], 'no drawing, no grips');
});

test('the round grips sit on the drawn centre and circle and give back the drawn size', () => {
  const G = result.geometry;
  const [c] = grip('center').points({ round, result });
  assert.deepEqual(c, { x: G.center.x, y: G.center.y });
  const q = grip('quadrant');
  const s = q.start({ round, result });
  for (const p of q.points({ round, result })) {
    close(Math.hypot(p.x - G.center.x, p.y - G.center.y), G.radii.inscribed, 1e-9);
    close(q.value({ round, result }, p, s), 2 * G.radii.inscribed, 1e-9);
  }
  const out = { x: G.center.x + G.radii.inscribed + 5, y: G.center.y };
  close(q.value({ round, result }, out, s), 2 * G.radii.inscribed + 10, 1e-9);
});

test('the width grips sit where the engine measures the width and keep the asked width where they are', () => {
  for (const leg of round.legs) {
    const L = legG(leg.id);
    for (const [id, at, base, field] of [['entry-width', 'entryWidthPoint', 'Se', 'entryWidth'], ['exit-width', 'exitWidthPoint', 'Sx', 'exitWidth']]) {
      const g = grip(id), ctx = { round, leg, result };
      const [p] = g.points(ctx);
      assert.deepEqual(p, L[at], `${id} of ${leg.id}`);
      close(Math.hypot(L[at].x - L[base].x, L[at].y - L[base].y), L[`${field}Built`], 1e-6, `${id} of ${leg.id}: the grip is the built width from where the island meets the circle`);
      const s = g.start(ctx);
      close(g.value(ctx, p, s), leg[field], 1e-6, `${id} at its own place gives the asked width`);
      const u = { x: (L[at].x - L[base].x) / L[`${field}Built`], y: (L[at].y - L[base].y) / L[`${field}Built`] };
      assert.ok(g.value(ctx, { x: p.x + 2 * u.x, y: p.y + 2 * u.y }, s) > leg[field], 'out is wider');
      assert.ok(g.value(ctx, { x: p.x - 2 * u.x, y: p.y - 2 * u.y }, s) < leg[field], 'in is narrower');
    }
  }
});

test('the radius grips sit where each curve starts on the road curb, on the built curve, and keep the asked radius there', () => {
  for (const leg of round.legs) {
    const L = legG(leg.id);
    for (const [id, a, b, field] of [['entry-radius', 'T1', 'T2', 'entryRadius'], ['exit-radius', 'T1x', 'T2x', 'exitRadius']]) {
      const g = grip(id), ctx = { round, leg, result };
      const arc = curbArc(result, L[a], L[b]);
      assert.ok(arc, `${leg.id} has its ${id} curve in the curb layer`);
      const [p] = g.points(ctx);
      assert.deepEqual(p, L[a], `${id} of ${leg.id} is where the curve leaves the road curb`);
      close(Math.hypot(p.x - arc.c.x, p.y - arc.c.y), arc.r, 1e-6);
      close(arc.r, L[`${field}Built`], 1e-6, 'the curve is the built radius');
      const w = L[id === 'entry-radius' ? 'entryWidthPoint' : 'exitWidthPoint'];
      assert.ok(Math.hypot(p.x - w.x, p.y - w.y) > 10, `${id} of ${leg.id} is clear of the width grip`);
      const s = g.start(ctx);
      close(g.value(ctx, p, s), leg[field], 1e-6);
      // Out along the road curb is bigger, in toward the circle smaller.
      const u = { x: s.J.x / Math.hypot(s.J.x, s.J.y), y: s.J.y / Math.hypot(s.J.x, s.J.y) };
      const c = curveGrip(result, L[a], L[b]).corner;
      assert.ok((p.x - c.x) * u.x + (p.y - c.y) * u.y > 0, 'a bigger radius moves the grip away from the corner');
      assert.ok(g.value(ctx, { x: p.x + 3 * u.x, y: p.y + 3 * u.y }, s) > leg[field] && g.value(ctx, { x: p.x - 3 * u.x, y: p.y - 3 * u.y }, s) < leg[field], `${id} of ${leg.id}`);
    }
  }
  close(radiusFromDrag(50, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 5 }), 100, 1e-12);
  // The place on a curve: the middle unless the point to avoid is near it, then near the road end, always the same one.
  const arc = result.geometry.layers.curb.find((q) => q.type === 'arc');
  const mid = primPoint(arc, 0.5);
  assert.deepEqual(gripPlace(arc, null), mid);
  assert.deepEqual(gripPlace(arc, { x: mid.x + 1e6, y: mid.y }), mid);
  assert.deepEqual(gripPlace(arc, mid, arc.a), primPoint(arc, NEAR_END));
  assert.deepEqual(gripPlace(arc, mid, arc.b), primPoint(arc, 1 - NEAR_END));
});

// Where the grip lands, once the shape is worked out again for the value a hand at P gives.
function landing(id, rnd, legId, P) {
  const res = evaluate(rnd, {});
  const leg = rnd.legs.find((l) => l.id === legId);
  const g = grip(id), ctx = { round: rnd, leg, result: res };
  const s = g.start(ctx);
  const v = g.value(ctx, P(g.points(ctx)[0], s), s);
  const field = g.path.split('.').pop();
  const r2 = { ...rnd, legs: rnd.legs.map((l) => (l.id === legId ? { ...l, [field]: v } : l)) };
  const res2 = evaluate(r2, {});
  if (!res2.ok) return null;
  return g.points({ round: r2, leg: r2.legs.find((l) => l.id === legId), result: res2 })[0];
}

// Shapes found by changing one value until the engine reports the case, so no engine number is written here.
function shortenedCorner() {
  for (let turn = 1; turn < 40; turn++) {
    const r = structuredClone(round);
    r.legs[1].bearing += turn;
    const res = evaluate(r, {});
    if (!res.ok) return null;
    if (res.geometry.legs.some((L) => L.entryRadiusBuilt < r.legs.find((l) => l.id === L.id).entryRadius - 0.5)) return r;
  }
  return null;
}
function longerIsland() {
  for (let w = round.legs[0].entryWidth; w < round.legs[0].entryWidth + 12; w += 0.5) {
    const r = structuredClone(round);
    r.legs[0].entryWidth = w;
    const res = evaluate(r, {});
    if (res.ok && res.geometry.legs[0].splitterLengthBuilt > r.legs[0].splitterLength + 1) return r;
  }
  return null;
}

test('each leg grip follows the hand: moved a little, the grip lands near the hand, on a plain, a shortened and a lengthened leg', () => {
  const cases = [['default', round], ['a turned leg with a shortened corner', shortenedCorner()], ['a wide entry with a longer island', longerIsland()]];
  for (const [name, rnd] of cases) {
    assert.ok(rnd, `the engine gives ${name}`);
    for (const leg of rnd.legs) {
      for (const id of ['entry-radius', 'exit-radius', 'entry-width', 'exit-width', 'splitter-tip']) {
        // The hand moves 1 ft the way the grip moves when its value grows.
        let dir = null;
        const hand = (p0, s) => {
          const J = s.J || s.u || s.dir;
          const n = Math.hypot(J.x, J.y);
          dir = { x: J.x / n, y: J.y / n };
          return { x: p0.x + dir.x, y: p0.y + dir.y };
        };
        const res = evaluate(rnd, {});
        const [p0] = grip(id).points({ round: rnd, leg, result: res });
        const p1 = landing(id, rnd, leg.id, hand);
        assert.ok(p1, `${name}: ${id} of ${leg.id} still builds`);
        const moved = (p1.x - p0.x) * dir.x + (p1.y - p0.y) * dir.y;
        assert.ok(moved > 0.6 && moved < 1.4, `${name}: ${id} of ${leg.id} moved ${moved.toFixed(2)} ft for 1 ft of hand`);
      }
    }
  }
});

test('a radius grip asks at most a foot of radius for each screen pixel; zoomed in, it stays under the hand', () => {
  const ix = indexOf(result);
  // The first view of a laptop's drawing area: the roundabout framed in about 800 by 420 px.
  const k = Math.min(800 / (ix.firstView.x1 - ix.firstView.x0), 420 / (ix.firstView.y1 - ix.firstView.y0));
  for (const leg of round.legs) {
    for (const [id, field] of [['entry-radius', 'entryRadius'], ['exit-radius', 'exitRadius']]) {
      const g = grip(id);
      const ctx = { round, leg, result, k };
      const s = g.start(ctx);
      const [p] = g.points(ctx);
      const n = Math.hypot(s.J.x, s.J.y);
      const u = { x: s.J.x / n, y: s.J.y / n };
      const onePx = 1 / k;   // feet of hand for one screen pixel
      const dv = g.value(ctx, { x: p.x + u.x * onePx, y: p.y + u.y * onePx }, s) - leg[field];
      assert.ok(dv > 0 && dv <= 1 + 1e-9, `${id} of ${leg.id}: ${dv.toFixed(2)} ft of radius for a pixel at the first view`);
      // Zoomed in far enough, the value is the one that puts the curve's start under the hand.
      const near = { ...ctx, k: 40 / n };
      close(g.value(near, { x: p.x + u.x, y: p.y + u.y }, s), g.value({ round, leg, result }, { x: p.x + u.x, y: p.y + u.y }, s), 1e-9);
    }
  }
  close(gearedAlong(10, { x: 0, y: 0 }, { x: 0, y: 0.5 }, { x: 0, y: 4 }), 18, 1e-12, 'with no screen, the grip follows the hand');
  close(gearedAlong(10, { x: 0, y: 0 }, { x: 0, y: 0.5 }, { x: 0, y: 4 }, 0.5), 12, 1e-12, 'at half a pixel a foot, a foot of radius a pixel');
  assert.equal(MAX_PER_PX, 1);
});

test('the nose and bearing grips sit on the drawn leg; the nose moves the island length by the distance dragged', () => {
  const leg = round.legs[1];
  const L = legG(leg.id), ctx = { round, leg, result };
  const tip = grip('splitter-tip');
  const [n] = tip.points(ctx);
  assert.deepEqual(n, L.nose);
  const s = tip.start(ctx);
  close(tip.value(ctx, n, s), leg.splitterLength, 1e-9);
  close(tip.value(ctx, along(L, 7), s), leg.splitterLength + 7, 1e-9);
  const b = grip('bearing');
  const [p] = b.points(ctx);
  const q = along(L, BEYOND_NOSE);
  assert.deepEqual(p, q);
  close(b.value(ctx, p, b.start(ctx)), bearingOf(result.geometry.center, q), 1e-9);
  close(((b.value(ctx, p, b.start(ctx)) - L.bearing + 540) % 360) - 180, 0, 1e-6, 'the grip lies on the leg axis');
});

test('the index gives every leg and the roundabout their own pickable lines, snaps and boxes', () => {
  const ix = indexOf(result);
  assert.equal(indexOf(result), ix, 'built once per result');
  const keys = new Set(ix.items.map((i) => i.key));
  assert.ok(keys.has('round'));
  for (const leg of round.legs) {
    assert.ok(keys.has(`leg:${leg.id}`), leg.id);
    const b = ix.legBox(leg.id);
    assert.ok(b && b.x1 > b.x0 && b.y1 > b.y0);
  }
  assert.equal(legIdOf('leg:N'), 'N');
  assert.equal(legIdOf('round'), null);
  assert.ok(ix.snaps.some((s) => s.kind === 'center'));
  assert.ok(ix.snaps.some((s) => s.kind === 'quadrant'));
  const C = result.geometry.center;
  assert.ok(ix.extents.x0 < C.x && ix.extents.x1 > C.x && ix.extents.y0 < C.y && ix.extents.y1 > C.y);
  assert.equal(indexOf({ ok: false, problems: ['x'] }), null);
  const r = roughExtents(round);
  assert.ok(r.x0 < round.center.x && r.x1 > round.center.x);
});

test('a check\'s place gives a box to zoom to', () => {
  const leg = round.legs[0];
  const b = whereBox(result, { legs: [leg.id] });
  assert.ok(b && b.x1 > b.x0);
  const m = result.movements.find((x) => x.path);
  if (m) assert.ok(whereBox(result, { movements: [m.id] }));
  assert.equal(whereBox(result, null), null);
});
