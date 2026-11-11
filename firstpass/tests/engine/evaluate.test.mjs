import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, defaultRoundabout, defaultLeg, CHECKS, RULES } from '../../public/js/engine/index.js';
import { shapes } from './helpers.mjs';

const STATUS = new Set(['pass', 'warn', 'fail', 'info']);

function assertCheckShape(c) {
  assert.ok(typeof c.id === 'string' && typeof c.title === 'string' && Number.isFinite(c.order));
  assert.ok(STATUS.has(c.status), `${c.id} status ${c.status}`);
  assert.ok('value' in c && 'unit' in c && 'limit' in c);
  assert.ok(Array.isArray(c.items));
  for (const it of c.items) {
    assert.ok('leg' in it && 'value' in it);
    assert.ok(STATUS.has(it.status));
    assert.ok(typeof it.text === 'string' && it.text.length);
  }
  assert.ok(typeof c.explain === 'string' && c.explain.length);
  assert.ok(c.fix === null || typeof c.fix === 'string');
  for (const k of ['legs', 'movements', 'points', 'polygons']) assert.ok(Array.isArray(c.where[k]), `${c.id} where.${k}`);
}

test('evaluate returns the design shape for the default roundabout', () => {
  const e = evaluate(defaultRoundabout(), {});
  assert.equal(e.ok, true);
  assert.deepEqual(e.problems, []);
  assert.deepEqual(Object.keys(e).sort(), ['checks', 'geometry', 'headline', 'legs', 'movements', 'ok', 'problems']);
  // Geometry is in state plane coordinates, about the centre.
  assert.deepEqual(e.geometry.center, { x: 6000000, y: 2000000 });
  for (const layer of ['curb', 'edge', 'centerline', 'splitter', 'island', 'apron', 'entrance', 'exit', 'landtake']) {
    assert.ok(Array.isArray(e.geometry.layers[layer]) && e.geometry.layers[layer].length, layer);
    for (const p of e.geometry.layers[layer]) {
      assert.ok(p.type === 'line' || p.type === 'arc');
      assert.ok(Math.abs(p.a.x - 6000000) < 1000 && Math.abs(p.a.y - 2000000) < 1000);
      if (p.type === 'arc') assert.ok(p.r > 0 && typeof p.ccw === 'boolean' && p.c);
    }
  }
  assert.ok(Math.abs(e.geometry.landTake.acres - e.geometry.landTake.sqft / 43560) < 1e-12);
  assert.equal(e.geometry.sightTriangles.length, 8);
  // Movements carry paths coloured by speed, radii and speeds.
  assert.equal(e.movements.length, 12);
  for (const m of e.movements) {
    assert.ok(m.ok);
    assert.equal(m.path.x.length, m.path.n);
    assert.equal(m.path.speed.length, m.path.n);
    for (const v of m.path.speed) assert.ok(v > 0 && v <= 45 + 1e-9);
    for (let k = 1; k < m.path.n; k++) assert.ok(m.path.s[k] > m.path.s[k - 1]);
  }
  // Legs carry R1 to R5 and V1 to V5.
  assert.equal(e.legs.length, 4);
  for (const L of e.legs) {
    for (const k of ['R1', 'R2', 'R3', 'R4', 'R5']) assert.ok(Number.isFinite(L.R[k]) && L.R[k] > 0, `${L.id} ${k}`);
    for (const k of ['V1', 'V2', 'V3', 'V4', 'V5']) assert.ok(Number.isFinite(L.V[k]) && L.V[k] > 0, `${L.id} ${k}`);
    assert.equal(L.ssd.approach.distance, 360);
  }
  // Checks: one per registry entry, in order.
  assert.deepEqual(e.checks.map((c) => c.id), CHECKS.map((c) => c.id));
  e.checks.forEach(assertCheckShape);
  const byId = Object.fromEntries(e.checks.map((c) => [c.id, c]));
  assert.equal(byId.geometry.status, 'pass');
  assert.equal(byId['entry-speed'].status, 'pass');
  assert.equal(byId['entry-speed'].limit, 25);
  assert.equal(byId['speed-consistency'].status, 'pass');
  assert.equal(byId['truck-turns'].status, 'info');
  assert.match(byId['truck-turns'].explain, /not built yet/);
  assert.equal(byId['sight-intersection'].where.polygons.length, 8);
  // Headline.
  const h = e.headline;
  assert.ok(h.worstEntrySpeed.value > 18 && h.worstEntrySpeed.value < 30);
  assert.equal(h.worstEntrySpeed.leg, 'N', 'ties go to the first leg');
  assert.ok(h.worstSpeedDrop.value > 0);
  assert.ok(h.landTake.sqft > 0);
  assert.equal(h.fails, 0);
  assert.equal(h.warns, 0);
  assert.match(h.text, /No check fails or warns\./);
});

test('evaluate is deterministic, whatever ran before it', () => {
  const a = JSON.stringify(evaluate(defaultRoundabout(), {}));
  evaluate(shapes().six, {});
  evaluate(shapes().big, {});
  const b = JSON.stringify(evaluate(defaultRoundabout(), {}));
  assert.equal(a, b);
});

test('a T shape and the literal skew evaluate; corners that close up warn; legs too close fail in words', () => {
  const t = evaluate(shapes().t, {});
  assert.ok(t.ok);
  assert.equal(t.movements.length, 6);
  const stem = t.legs.find((L) => L.id === 'N');
  assert.equal(stem.through, null);
  assert.equal(stem.mainKind, 'left');
  assert.equal(stem.R.R2, null);
  assert.ok(stem.V.V1 > 0);

  // The literal skew from the first brief (bearings 0, 75, 180, 255 at the default sizes) now builds, and
  // every movement fits, the right turns between the close legs included.
  const literal = defaultRoundabout();
  literal.legs = [0, 75, 180, 255].map((b) => defaultLeg(b));
  const skew = evaluate(literal, {});
  assert.ok(skew.ok, String(skew.problems));
  assert.equal(skew.movements.length, 12);
  assert.ok(skew.movements.every((m) => m.ok));
  assert.notEqual(skew.checks.find((c) => c.id === 'geometry').status, 'fail');

  // Closer still (the North leg turned 20 degrees): the corner is built with shorter radii and the geometry
  // check warns, naming the two legs and the radii.
  const turned = evaluate(shapes().turned, {});
  assert.ok(turned.ok, String(turned.problems));
  const geo = turned.checks.find((c) => c.id === 'geometry');
  assert.equal(geo.status, 'warn');
  const warn = geo.items.filter((i) => i.status === 'warn');
  assert.equal(warn.length, 1);
  assert.match(warn[0].text, /^The East leg's entry curve and the North leg's exit curve meet with no circle between them, so they are built at \d+ ft and \d+ ft, not 50 ft and 65 ft\.$/);
  assert.ok(geo.fix && geo.fix.length);
  assert.equal(turned.headline.warns, 1);
  assert.ok(turned.movements.every((m) => m.ok));
  const E = turned.geometry.legs.find((L) => L.id === 'E'), N = turned.geometry.legs.find((L) => L.id === 'N');
  assert.ok(E.entryRadiusBuilt < 50 && N.exitRadiusBuilt < 65);
  assert.equal(turned.legs.find((L) => L.id === 'E').entryRadiusBuilt, E.entryRadiusBuilt);

  // Too close for even the smallest radii: ok false, the two legs named and how far apart they need to be.
  const close = defaultRoundabout();
  close.legs[0].bearing = 30;
  const bad = evaluate(close, {});
  assert.equal(bad.ok, false);
  assert.match(bad.problems[0], /^The East leg and the North leg are too close together\. .* Spread the two legs about 8 degrees further apart, or make that entry or exit narrower\.$/);
  assert.equal(bad.geometry, null);
  assert.equal(bad.checks.length, CHECKS.length);
  bad.checks.forEach(assertCheckShape);
  assert.equal(bad.checks[0].status, 'fail');
  for (const c of bad.checks.slice(1)) assert.equal(c.status, 'info');
  assert.equal(bad.headline.fails, 1);
  assert.match(bad.headline.text, /cannot be built/);
  // The 8 degrees is right: 8 degrees back, it builds.
  close.legs[0].bearing = 22;
  assert.ok(evaluate(close, {}).ok);
});

test('checks read the rules through the project settings', () => {
  const strict = evaluate(defaultRoundabout(), { 'speed.entry.max': 20 });
  assert.ok(strict.ok);
  const es = strict.checks.find((c) => c.id === 'entry-speed');
  assert.equal(es.status, 'fail');
  assert.equal(es.limit, 20);
  assert.deepEqual(es.where.legs, ['N', 'E', 'S', 'W']);
  assert.ok(es.fix && es.fix.length);

  const warn = evaluate(defaultRoundabout(), { 'speed.consistency.warn': 5 });
  assert.equal(warn.checks.find((c) => c.id === 'speed-consistency').status, 'warn');
  assert.equal(warn.headline.warns, 1);

  // A bigger curb clearance pulls the left turn further off the island. (At 6 ft a 12 ft approach lane no
  // longer fits past the splitter island nose: 6 ft from the nose and 6 ft from the outer curb.)
  const wide = evaluate(defaultRoundabout(), { 'fp.offset.curb': 5.5 });
  assert.ok(Math.abs(wide.legs[0].R.R4 - 52.5) < 0.5, String(wide.legs[0].R.R4));
  const tooWide = evaluate(defaultRoundabout(), { 'fp.offset.curb': 6 });
  assert.equal(tooWide.checks.find((c) => c.id === 'geometry').status, 'fail');

  const bad = evaluate(defaultRoundabout(), { 'speed.entry.max': 'fast' });
  assert.equal(bad.ok, false);
  assert.match(bad.problems[0], /project setting/);
});

test('every rule the engine reads is in the rules table', () => {
  // Reading an unknown rule throws inside evaluate, which would turn into ok false; so a clean run of every
  // shape with every rule overridden to its own value proves the reads are all known ids.
  const all = Object.fromEntries(RULES.map((r) => [r.id, r.value]));
  for (const [name, r] of Object.entries(shapes())) {
    const e = evaluate(r, all);
    assert.ok(e.ok, `${name}: ${e.problems}`);
    assert.ok(!e.checks.some((c) => c.internalError), name);
  }
});

test('sight triangles start at the eye in the entry lane and run back along the conflicting paths', () => {
  const e = evaluate(defaultRoundabout(), {});
  const C = e.geometry.center;
  for (const L of e.legs) {
    // The north leg's eye is west of the axis (the entry side) and about 50 ft beyond the circle.
    for (const tri of [L.isd.entering, L.isd.circulating]) {
      assert.ok(tri.polygon.length >= 3);
      assert.deepEqual(tri.polygon[0], L.eye);
      assert.ok(Math.abs(tri.reached - tri.length) < 1e-6);
    }
  }
  const N = e.legs.find((L) => L.id === 'N');
  assert.ok(N.eye.x < C.x && N.eye.y - C.y > 100 && N.eye.y - C.y < 125, JSON.stringify(N.eye));
  assert.equal(N.upstream, 'E');
  assert.equal(N.conflicting, 'E-S');
});

test('legs, movements and checks are plain data that survive JSON', () => {
  const e = evaluate(shapes().offset, {});
  const back = JSON.parse(JSON.stringify(e));
  assert.equal(back.movements.length, e.movements.length);
  assert.equal(back.checks.length, e.checks.length);
});
