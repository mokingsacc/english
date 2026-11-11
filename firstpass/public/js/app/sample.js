// The first-run sample project, used when the page has no key or no server: the server's own sample (a rural crossroads
// east of Davis, CCS83 zone 2 US survey feet; src/worker/store/projects.js SAMPLE) with the engine's default roundabout.
// Keep the numbers here the same as the server's.
import { defaultRoundabout } from '../engine/index.js';

export const SAMPLE_SITE = { name: 'Sample roundabout', epsg: 2226, site: { lat: 38.58999, lon: -121.73968 }, center: { x: 6636071.5, y: 1976790.3 } };

export function sampleProject() {
  const round = defaultRoundabout();
  round.center = { ...SAMPLE_SITE.center };
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
