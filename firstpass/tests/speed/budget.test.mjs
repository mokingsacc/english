import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, defaultRoundabout } from '../../public/js/engine/index.js';
import { median } from '../engine/helpers.mjs';

// The page calls evaluate on every drag frame, so four legs (twelve movements) must take under 15 ms once
// warmed up. This file sits in tests/speed/, which `npm test` runs on its own after the other files: run side by
// side with them, a laptop's mix of fast and slow cores gave 24 to 28 ms for the same 10 ms of work (11 Nov 2026).
// The best of three rounds is taken, so it measures the engine, not whatever else the machine is doing.
test('evaluate runs a four-leg roundabout in under 15 ms after warm-up', () => {
  const r = defaultRoundabout();
  for (let i = 0; i < 30; i++) evaluate(r, {});
  let best = Infinity;
  for (let round = 0; round < 3; round++) {
    const times = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      evaluate(r, {});
      times.push(performance.now() - t0);
    }
    best = Math.min(best, median(times));
    if (best < 15) break;
  }
  assert.ok(best < 15, `median ${best.toFixed(2)} ms`);
});
