import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, defaultRoundabout, defaultLeg, PARAMS, LEG_PARAMS, legField, CHECKS } from '../../public/js/engine/index.js';
import { rng } from './helpers.mjs';

function assertSane(e, label) {
  assert.equal(typeof e.ok, 'boolean', label);
  assert.ok(Array.isArray(e.problems), label);
  assert.equal(e.internalError, undefined, `${label}: ${e.internalError}`);
  for (const c of e.checks) assert.equal(c.internalError, undefined, `${label} ${c.id}: ${c.internalError}`);
  assert.equal(e.checks.length, CHECKS.length, label);
  if (e.ok) {
    assert.deepEqual(e.problems, [], label);
    assert.ok(e.geometry && e.movements.length && e.legs.length, label);
  } else {
    assert.ok(e.problems.length > 0, label);
    for (const p of e.problems) assert.equal(typeof p, 'string');
    assert.equal(e.geometry, null);
  }
  assert.doesNotThrow(() => JSON.stringify(e));
}

test('bad input never throws and always says what is wrong', () => {
  const junk = [undefined, null, 0, 42, 'roundabout', [], {}, { legs: 'none' }, { legs: [] }, { legs: [null, 1, 'a'] },
    { icd: NaN, legs: [{}, {}, {}] }, { icd: Infinity }, { icd: '130' }];
  for (const j of junk) assertSane(evaluate(j, {}), JSON.stringify(j) ?? String(j));

  const r = defaultRoundabout();
  const variants = [
    (x) => { x.icd = -5; }, (x) => { x.icd = 1e300; }, (x) => { x.circWidth = null; }, (x) => { x.legs[0].bearing = NaN; },
    (x) => { x.legs[1].entryRadius = '65'; }, (x) => { x.legs[2] = 7; }, (x) => { x.legs.length = 2; },
    (x) => { x.legs.push(defaultLeg(45), defaultLeg(135), defaultLeg(225)); }, (x) => { x.legs[1].id = 'N'; },
    (x) => { x.legs[1].bearing = 0; }, (x) => { x.legs[1].bearing = 0.2; }, (x) => { x.center = 'here'; },
    (x) => { x.center = { x: 1e9, y: -1e9 }; }, (x) => { x.legs[0].offsetLeft = 30; x.legs[0].splitterWidth = 40; },
    (x) => { x.icd = 70; x.circWidth = 40; x.apronWidth = 30; },
  ];
  variants.forEach((f, i) => {
    const x = JSON.parse(JSON.stringify(r));
    f(x);
    assertSane(evaluate(x, {}), `variant ${i}`);
  });
  for (const rules of [null, undefined, 3, 'x', [], { 'fp.offset.curb': -1 }, { 'fp.window': 'wide' }, { 'fp.passes': 1 }, { 'fp.station': 10 }]) {
    assertSane(evaluate(defaultRoundabout(), rules), `rules ${JSON.stringify(rules)}`);
  }
});

test('random shapes from anywhere in the parameter ranges never throw', () => {
  const rand = rng(2026);
  const pick = (p) => {
    const t = rand();
    if (t < 0.15) return p.min;
    if (t < 0.3) return p.max;
    return p.min + (p.max - p.min) * rand();
  };
  let built = 0;
  for (let trial = 0; trial < 120; trial++) {
    const r = defaultRoundabout();
    for (const p of PARAMS) if (!p.path.startsWith('legs.') && !p.path.startsWith('center.') && rand() < 0.5) r[p.path] = pick(p);
    const n = 3 + Math.floor(rand() * 4);
    const start = rand() * 360;
    r.legs = [];
    for (let i = 0; i < n; i++) {
      const leg = defaultLeg(0, `L${i}`, `Leg ${i}`);
      leg.bearing = (start + (360 * i) / n + (rand() - 0.5) * 20 + 360) % 360;
      leg.exitRadius = 40 + rand() * 70;
      for (const p of LEG_PARAMS) if (legField(p) !== 'bearing' && rand() < 0.3) leg[legField(p)] = pick(p);
      r.legs.push(leg);
    }
    const e = evaluate(r, {});
    assertSane(e, `trial ${trial}`);
    if (e.ok) built++;
  }
  // Values picked from anywhere in their ranges seldom fit together (an 18 ft exit on a 70 ft circle, a 250 ft
  // entry radius with a 16 ft entry), so nearly all of these are refused in words, which is what this tests.
  assert.ok(built < 120);
});

test('random plausible shapes mostly build, and never throw', () => {
  const rand = rng(7);
  let built = 0;
  for (let trial = 0; trial < 60; trial++) {
    const r = defaultRoundabout();
    r.icd = 110 + rand() * 90;
    r.circWidth = 16 + rand() * 6;
    const n = 3 + Math.floor(rand() * 3);
    const start = rand() * 360;
    r.legs = [];
    for (let i = 0; i < n; i++) {
      r.legs.push(Object.assign(defaultLeg(0, `L${i}`, `Leg ${i}`), {
        bearing: (start + (360 * i) / n + (rand() - 0.5) * 16 + 360) % 360,
        offsetLeft: (rand() - 0.5) * 8, approachSpeed: 25 + Math.round(rand() * 30),
        entryRadius: 30 + rand() * 30, exitRadius: 40 + rand() * 30, entryWidth: 18 + rand() * 4, exitWidth: 20 + rand() * 4,
        splitterWidth: 8 + rand() * 6, splitterLength: 60 + rand() * 60,
      }));
    }
    const e = evaluate(r, {});
    assertSane(e, `trial ${trial}`);
    if (e.ok) built++;
  }
  assert.ok(built >= 40, `only ${built} of 60 plausible shapes could be built`);
});

test('random project settings within their ranges never throw', () => {
  const rand = rng(99);
  const ids = ['fp.offset.curb', 'fp.offset.centerline', 'fp.offset.paint', 'fp.window', 'fp.window.min', 'fp.station',
    'fp.passes', 'speed.decel', 'speed.accel', 'speed.entry.max', 'sight.isd.criticalHeadway', 'sight.ssd.roundTo'];
  for (let trial = 0; trial < 25; trial++) {
    const rules = {};
    for (const id of ids) if (rand() < 0.3) rules[id] = undefined;
    const id = ids[Math.floor(rand() * ids.length)];
    const lim = { 'fp.offset.curb': [0, 6], 'fp.offset.centerline': [0, 6], 'fp.offset.paint': [0, 4], 'fp.window': [20, 200],
      'fp.window.min': [4, 100], 'fp.station': [2, 10], 'fp.passes': [1, 6], 'speed.decel': [0.5, 20], 'speed.accel': [0.5, 20],
      'speed.entry.max': [10, 50], 'sight.isd.criticalHeadway': [2, 10], 'sight.ssd.roundTo': [0, 50] }[id];
    rules[id] = lim[0] + (lim[1] - lim[0]) * rand();
    assertSane(evaluate(defaultRoundabout(), rules), `${id} ${rules[id]}`);
  }
});
