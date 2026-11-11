// Entry speed: the fastest path speed on entry (V1, from the entry curve R1) and on the right turn (V5, from
// R5) on every leg, against the highest entry speed recommended for a single-lane roundabout.

import { mph, num, theLeg, sentence } from '../format.js';

// A speed beside the limit: whole miles per hour, or with decimals when the whole numbers would read the same
// ("25.2 mph, above the limit of 25 mph", never "25 mph, above the limit of 25 mph").
function against(v, limit) {
  if (Math.round(v) !== Math.round(limit)) return mph(v);
  const one = v.toFixed(1);
  return `${one === num(limit, 1) || one === limit.toFixed(1) ? v.toFixed(2) : one} mph`;
}

export default {
  id: 'entry-speed',
  title: 'Entry speed',
  order: 20,
  unit: 'mph',
  run(ctx) {
    const limit = ctx.rule('speed.entry.max');
    const items = [];
    const bad = [];
    let worst = null;
    for (const L of ctx.legs) {
      const v1 = L.V.V1, v5 = L.V.V5;
      const parts = [];
      if (v1 !== null) parts.push(`${against(v1, limit)} on the ${L.mainKind === 'through' ? 'through path' : 'left turn path'}`);
      if (v5 !== null) parts.push(`${against(v5, limit)} on the right turn`);
      const vals = [v1, v5].filter((v) => v !== null);
      if (!vals.length) {
        items.push({ leg: L.id, status: 'info', value: null, text: sentence(`${theLeg(L.name)} has no path to measure an entry speed on.`) });
        continue;
      }
      const v = Math.max(...vals);
      const over = v > limit;
      if (over) bad.push(L);
      if (worst === null || v > worst) worst = v;
      items.push({
        leg: L.id, status: over ? 'fail' : 'pass', value: v,
        text: sentence(`${theLeg(L.name)} enters at ${parts.join(' and ')}${over ? `, above the limit of ${num(limit, 1)} mph` : ''}.`),
      });
    }
    return {
      status: worst === null ? 'info' : bad.length ? 'fail' : 'pass',
      value: worst,
      unit: 'mph',
      limit,
      items,
      explain: `The fastest speed a car can enter at, worked out from the tightest curve on its fastest path through the entry (NCHRP Report 672). A single-lane entry should be ${mph(limit)} or slower.`,
      fix: bad.length
        ? 'To slow an entry, make its entry curb radius smaller, shift the approach to the left so the path has to bend more, or make the circle bigger.'
        : null,
      where: {
        legs: bad.map((L) => L.id),
        movements: bad.flatMap((L) => [L.main, L.right].filter(Boolean)),
      },
    };
  },
};
