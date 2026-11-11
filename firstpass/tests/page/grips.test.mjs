// Grips and the drawing index, against whatever evaluate gives today (no engine numbers here): every grip sits on a
// point the engine drew, dragging a grip by a known amount changes its value by that amount, and the index gives each
// leg and the roundabout their own lines, snaps and boxes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, defaultRoundabout, primPoint } from '../../public/js/engine/index.js';
import { GRIPS, gripPoints, gripPaths } from '../../public/js/app/grips/index.js';
import { curbArc, curveGrip, gripPlace, radiusFromDrag, along, bearingOf } from '../../public/js/app/grips/frame.js';
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

test('the width grips sit where the engine measures the width and move it by what they are dragged', () => {
  for (const leg of round.legs) {
    const L = legG(leg.id);
    for (const [id, at, base, field] of [['entry-width', 'entryWidthPoint', 'Se', 'entryWidth'], ['exit-width', 'exitWidthPoint', 'Sx', 'exitWidth']]) {
      const g = grip(id), ctx = { round, leg, result };
      const [p] = g.points(ctx);
      assert.deepEqual(p, L[at], `${id} of ${leg.id}`);
      const s = g.start(ctx);
      close(g.value(ctx, p, s), leg[field], 1e-6, `${id} at its own place gives the asked width`);
      const u = { x: (L[at].x - L[base].x) / Math.hypot(L[at].x - L[base].x, L[at].y - L[base].y), y: (L[at].y - L[base].y) / Math.hypot(L[at].x - L[base].x, L[at].y - L[base].y) };
      close(g.value(ctx, { x: p.x + 2 * u.x, y: p.y + 2 * u.y }, s), leg[field] + 2, 1e-6);
      // Sideways along the curb does not change it.
      close(g.value(ctx, { x: p.x - 3 * u.y, y: p.y + 3 * u.x }, s), leg[field], 1e-6);
    }
  }
});

test('the radius grips sit on the drawn curb curve, clear of the width grip, and keep the drawn radius where they are', () => {
  for (const leg of round.legs) {
    const L = legG(leg.id);
    for (const [id, a, b] of [['entry-radius', 'T1', 'T2'], ['exit-radius', 'T1x', 'T2x']]) {
      const g = grip(id), ctx = { round, leg, result };
      const arc = curbArc(result, L[a], L[b]);
      assert.ok(arc, `${leg.id} has its ${id} curve in the curb layer`);
      const [p] = g.points(ctx);
      const on = [0.25, 0.5, 0.75].map((t) => primPoint(arc, t));
      assert.ok(on.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-9), `${id} of ${leg.id} is at the middle or a quarter of its curve`);
      close(Math.hypot(p.x - arc.c.x, p.y - arc.c.y), arc.r, 1e-6);
      const w = L[id === 'entry-radius' ? 'entryWidthPoint' : 'exitWidthPoint'];
      const chord = Math.hypot(arc.a.x - arc.b.x, arc.a.y - arc.b.y);
      assert.ok(Math.hypot(p.x - w.x, p.y - w.y) > 0.2 * chord, `${id} of ${leg.id} is clear of the width grip`);
      const s = g.start(ctx);
      close(g.value(ctx, p, s), arc.r, 1e-6);
      // Away from the corner the curve rounds is bigger, toward it smaller.
      const c = curveGrip(result, L[a], L[b]).corner;
      const away = { x: p.x + (p.x - c.x) * 0.5, y: p.y + (p.y - c.y) * 0.5 };
      const toward = { x: p.x - (p.x - c.x) * 0.5, y: p.y - (p.y - c.y) * 0.5 };
      assert.ok(g.value(ctx, away, s) > arc.r && g.value(ctx, toward, s) < arc.r, `${id} of ${leg.id}`);
    }
  }
  close(radiusFromDrag(50, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 5 }), 100, 1e-12);
  // The place on a curve: the middle unless the point to avoid is near it, then the quarter farther from that point.
  const arc = result.geometry.layers.curb.find((q) => q.type === 'arc');
  const mid = primPoint(arc, 0.5), q1 = primPoint(arc, 0.25), q3 = primPoint(arc, 0.75);
  assert.deepEqual(gripPlace(arc, null), mid);
  assert.deepEqual(gripPlace(arc, { x: mid.x + 1e6, y: mid.y }), mid);
  const nearQ1 = { x: mid.x + (q1.x - mid.x) * 0.1, y: mid.y + (q1.y - mid.y) * 0.1 };
  assert.deepEqual(gripPlace(arc, nearQ1), q3);
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
