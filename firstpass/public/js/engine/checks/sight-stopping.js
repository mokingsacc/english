// Stopping sight distance (for information): the distance a driver needs to see ahead to stop, on each
// approach at its approach speed, on the circulating roadway and on the exit at the fastest path speeds.

import { mph, ft, theLeg, sentence, listing } from '../format.js';

export default {
  id: 'sight-stopping',
  title: 'Stopping sight distance',
  order: 50,
  unit: 'ft',
  run(ctx) {
    const items = [];
    let worst = null;
    for (const L of ctx.legs) {
      const s = L.ssd;
      const parts = [`${ft(s.approach.distance)} on the approach at ${mph(s.approach.speed)}`];
      if (s.circulating) parts.push(`${ft(s.circulating.distance)} on the circulating roadway at ${mph(s.circulating.speed)}`);
      if (s.exit) parts.push(`${ft(s.exit.distance)} on the exit at ${mph(s.exit.speed)}`);
      if (worst === null || s.approach.distance > worst) worst = s.approach.distance;
      items.push({ leg: L.id, status: 'info', value: s.approach.distance, text: sentence(`${theLeg(L.name)} needs ${listing(parts)}.`) });
    }
    return {
      status: 'info',
      value: worst,
      unit: 'ft',
      limit: null,
      items,
      explain: 'The distance a driver must be able to see ahead to stop for something in the road, from the reaction time and braking rate in the AASHTO Green Book. The tool cannot tell what blocks the view, so it lists the distances to keep clear.',
      fix: null,
      where: {},
    };
  },
};
