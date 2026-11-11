// The sample site against the state plane conversion: its centre is its latitude and longitude in its zone (to 0.01 ft),
// the zone is the county's, the page and the server agree on the leg bearings too, and the sample builds with its legs
// along the roads in the photo (bearings from the photo, opposite legs in line).
import test from 'node:test';
import assert from 'node:assert/strict';
import { SAMPLE_SITE, sampleProject } from '../../public/js/app/sample.js';
import { SAMPLE, newDoc } from '../../src/worker/store/projects.js';
import { fromLatLon, toLatLon, zoneFor } from '../../public/js/engine/crs.js';
import { evaluate } from '../../public/js/engine/evaluate.js';

test('the sample centre is the sample site in its zone, to 0.01 ft', () => {
  for (const s of [SAMPLE, SAMPLE_SITE]) {
    assert.equal(zoneFor(s.site.lat, s.site.lon), s.epsg);
    const p = fromLatLon(s.epsg, s.site.lat, s.site.lon);
    assert.ok(Math.abs(p.x - s.center.x) < 0.01 && Math.abs(p.y - s.center.y) < 0.01, `${p.x}, ${p.y} against ${s.center.x}, ${s.center.y}`);
    const g = toLatLon(s.epsg, s.center.x, s.center.y);
    assert.ok(Math.abs(g.lat - s.site.lat) < 1e-7 && Math.abs(g.lon - s.site.lon) < 1e-7);
  }
});

test('page and server samples have the same legs, turned along the roads', () => {
  assert.deepEqual(SAMPLE_SITE.bearings, SAMPLE.bearings);
  const page = sampleProject().options[0].round;
  const server = newDoc({ sample: true }).options[0].round;
  assert.deepEqual(page.legs.map((l) => [l.id, l.bearing]), server.legs.map((l) => [l.id, l.bearing]));
  assert.deepEqual(page.legs.map((l) => l.bearing), [SAMPLE.bearings.N, SAMPLE.bearings.E, SAMPLE.bearings.S, SAMPLE.bearings.W]);
  // Each road runs straight through: opposite legs in line.
  assert.ok(Math.abs(SAMPLE.bearings.S - SAMPLE.bearings.N - 180) < 1e-9);
  assert.ok(Math.abs(SAMPLE.bearings.W - SAMPLE.bearings.E - 180) < 1e-9);
  assert.deepEqual(server.center, SAMPLE.center);
});

test('the sample builds on its site', () => {
  const r = evaluate(sampleProject().options[0].round, {});
  assert.equal(r.ok, true, (r.problems || []).join(' '));
  assert.deepEqual(r.geometry.center, SAMPLE.center);
  // The engine works the bearings through radians, so compare to a millionth of a degree.
  const built = r.geometry.legs.map((l) => l.bearing), asked = [0.7, 90.6, 180.7, 270.6];
  built.forEach((b, i) => assert.ok(Math.abs(b - asked[i]) < 1e-6, `${b} against ${asked[i]}`));
});
