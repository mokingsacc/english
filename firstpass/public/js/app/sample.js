// The first-run sample project, used when the page has no key or no server: the server's own sample (a rural four-way
// crossing of two paved county roads between Davis and Woodland, CCS83 zone 2 US survey feet, its centre and leg bearings
// taken from the aerial photo; src/worker/store/projects.js SAMPLE says how) with the engine's default roundabout.
// Keep the numbers here the same as the server's (tests/page/ops.test.mjs and sample-site.test.mjs check).
import { defaultRoundabout } from '../engine/index.js';

export const SAMPLE_SITE = {
  name: 'Sample roundabout', epsg: 2226, site: { lat: 38.618855, lon: -121.729697 }, center: { x: 6638894.89, y: 1987310.58 },
  bearings: { N: 0.7, E: 90.6, S: 180.7, W: 270.6 },
};

export function sampleProject() {
  const round = defaultRoundabout();
  round.center = { ...SAMPLE_SITE.center };
  for (const leg of round.legs) if (SAMPLE_SITE.bearings[leg.id] !== undefined) leg.bearing = SAMPLE_SITE.bearings[leg.id];
  return {
    id: null, name: SAMPLE_SITE.name, epsg: SAMPLE_SITE.epsg, site: { ...SAMPLE_SITE.site }, rules: {}, seq: 0,
    options: [{ id: 'A', name: 'Option A', kind: 'roundabout', round }],
  };
}

// California state plane zones (CCS83, US survey feet), for the status bar.
const ZONES = { 2225: 1, 2226: 2, 2227: 3, 2228: 4, 2229: 5, 2230: 6 };
export function zoneText(epsg) {
  const z = ZONES[epsg];
  return z ? `CCS83 Zone ${z}, US survey feet` : `EPSG ${epsg}`;
}
