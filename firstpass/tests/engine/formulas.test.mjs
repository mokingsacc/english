import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRules } from '../../public/js/engine/rules.js';
import { speedFromRadius, speedAfter } from '../../public/js/engine/roundabout/speeds.js';
import { stoppingSightDistance, stoppingSightDistanceRaw, intersectionSightLength } from '../../public/js/engine/sight.js';

const rr = resolveRules({});

test('fastest path speed from radius (NCHRP Report 672 Equations 6-1 and 6-2)', () => {
  // V = 3.4415 R^0.3861 with the cross slope toward the inside, V = 3.4614 R^0.3673 toward the outside.
  assert.ok(Math.abs(speedFromRadius(100, 1, rr) - 20.37) < 0.01, String(speedFromRadius(100, 1, rr)));
  assert.ok(Math.abs(speedFromRadius(200, 1, rr) - 26.62) < 0.01, String(speedFromRadius(200, 1, rr)));
  assert.ok(Math.abs(speedFromRadius(100, -1, rr) - 18.78) < 0.01, String(speedFromRadius(100, -1, rr)));
  assert.ok(Math.abs(speedFromRadius(200, -1, rr) - 24.23) < 0.01, String(speedFromRadius(200, -1, rr)));
  assert.equal(speedFromRadius(Infinity, 1, rr), Infinity);
  assert.equal(speedFromRadius(0, 1, rr), 0);
});

test('speed after accelerating or braking over a distance (Equations 6-3 and 6-4)', () => {
  // sqrt((1.47 * 15)^2 + 2 * 4.2 * 100) / 1.47
  const v = Math.sqrt((1.47 * 15) ** 2 + 2 * 4.2 * 100) / 1.47;
  assert.ok(Math.abs(speedAfter(15, 4.2, 100, rr) - v) < 1e-12);
  assert.equal(speedAfter(15, 4.2, 0, rr), 15);
  assert.equal(speedAfter(15, 4.2, -5, rr), 15);
});

test('stopping sight distances match the published design values after rounding up to 5 ft', () => {
  const want = { 25: 155, 30: 200, 35: 250, 45: 360, 50: 425 };
  for (const [v, d] of Object.entries(want)) {
    assert.equal(stoppingSightDistance(Number(v), rr), d, `${v} mph`);
  }
  // Rounding only ever goes up, and never by a whole step.
  for (let v = 10; v <= 70; v += 0.5) {
    const raw = stoppingSightDistanceRaw(v, rr), d = stoppingSightDistance(v, rr);
    assert.ok(d >= raw - 1e-9 && d - raw < 5, `${v} mph`);
    assert.equal(d % 5, 0);
  }
});

test('the braking factor in the design (1.087) would not give the published values, 1.075 does', () => {
  const wrong = resolveRules({ 'sight.ssd.brakeFactor': 1.087 });
  assert.equal(stoppingSightDistance(50, wrong), 430); // the published value is 425 ft
  assert.equal(stoppingSightDistance(50, rr), 425);
});

test('intersection sight distance length is 1.468 V tc', () => {
  assert.ok(Math.abs(intersectionSightLength(20, rr) - 1.468 * 20 * 5) < 1e-12);
  assert.equal(intersectionSightLength(0, rr), 0);
});
