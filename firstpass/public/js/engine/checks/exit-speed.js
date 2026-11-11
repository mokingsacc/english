// Exit speed (for information): the fastest speed of cars leaving by each leg (V3), which matters for people
// crossing the exit.

import { mph, theLeg, sentence } from '../format.js';

export default {
  id: 'exit-speed',
  title: 'Exit speed',
  order: 40,
  unit: 'mph',
  run(ctx) {
    const items = [];
    let worst = null;
    const byId = new Map(ctx.movements.map((m) => [m.id, m]));
    const nameOf = new Map(ctx.legs.map((L) => [L.id, L.name]));
    for (const L of ctx.legs) {
      if (L.exitSpeed === null) {
        items.push({ leg: L.id, status: 'info', value: null, text: sentence(`No path leaves by ${theLeg(L.name)}.`) });
        continue;
      }
      const m = byId.get(L.exitMovement);
      if (worst === null || L.exitSpeed > worst) worst = L.exitSpeed;
      items.push({
        leg: L.id, status: 'info', value: L.exitSpeed,
        text: sentence(`Cars leave by ${theLeg(L.name)} at up to ${mph(L.exitSpeed)}, on the path from ${theLeg(nameOf.get(m.from))}.`),
      });
    }
    return {
      status: 'info',
      value: worst,
      unit: 'mph',
      limit: null,
      items,
      explain: 'The fastest speed of cars leaving by each leg, from the exit curve of their fastest path. It is shown for information: a slower exit is kinder to people crossing there.',
      fix: null,
      where: { legs: [], movements: ctx.legs.map((L) => L.exitMovement).filter(Boolean) },
    };
  },
};
