// The shape can be built: every curb meets the circle as drawn, and a car can follow every movement with the
// required clearances from curbs and lines.

import { num, whole, theLeg, sentence } from '../format.js';

// The check's value reads as what it counts: "1 problem", "2 problems", or, when it only warns, "1 warning".
const count = (n, word) => ({ value: n, unit: n === 1 ? word : `${word}s` });

export default {
  id: 'geometry',
  title: 'The shape can be built',
  order: 10,
  needsShape: false,
  unit: 'problems',
  run(ctx) {
    if (!ctx.ok) {
      return {
        status: 'fail', ...count(ctx.problems.length, 'problem'), limit: 0,
        items: ctx.problems.map((text) => ({ leg: null, status: 'fail', value: null, text })),
        explain: 'The roundabout cannot be built as it is set out, so nothing else can be checked yet.',
        fix: 'Change the settings named in each problem. Each one says which leg or value is the cause.',
        where: {},
      };
    }
    const items = [];
    const failedMoves = ctx.movements.filter((m) => !m.ok);
    for (const m of failedMoves) {
      items.push({ leg: m.from, status: 'fail', value: null, text: m.problems[0] });
    }
    for (const w of ctx.warnings || []) items.push({ leg: null, status: 'warn', value: null, text: w });
    for (const n of ctx.notes || []) items.push({ leg: n.leg, status: 'info', value: null, text: n.text });
    for (const L of ctx.geometry.legs) {
      items.push({
        leg: L.id, status: 'pass', value: L.entryWidthBuilt,
        text: sentence(`${theLeg(L.name)} is ${num(L.entryWidthBuilt)} ft wide at the entry and ${num(L.exitWidthBuilt)} ft wide at the exit as built, measured square to the outer curb from where the splitter island meets the circle. Its curb radii are ${whole(L.entryRadiusBuilt)} ft at the entry and ${whole(L.exitRadiusBuilt)} ft at the exit. Its splitter island is ${num(L.splitterWidthAtCircle)} ft wide where it meets the circle and ${num(L.splitterLengthBuilt)} ft long.`),
      });
    }
    const status = failedMoves.length ? 'fail' : (ctx.warnings || []).length ? 'warn' : 'pass';
    const n = ctx.movements.length;
    return {
      status,
      ...(status === 'warn' ? count(ctx.warnings.length, 'warning') : count(failedMoves.length, 'problem')),
      limit: 0,
      items,
      explain: failedMoves.length
        ? `The curbs and islands fit together, but ${failedMoves.length} of the ${n} movements cannot be driven by a car keeping the required clearances.`
        : `The curbs and islands fit together, every curb meets the circle on a tangent, and a car can drive all ${n} movements keeping the required clearances from curbs and lines.`,
      fix: failedMoves.length
        ? 'Widen the entry or exit named in the problem, make the circulatory roadway wider, or reduce the splitter island width there.'
        : (ctx.warnings || []).length
          ? 'Each warning says which legs and values are involved and what to change.'
          : null,
      where: {
        legs: [...new Set(failedMoves.map((m) => m.from))],
        movements: failedMoves.map((m) => m.id),
        points: failedMoves.filter((m) => m.place).map((m) => ({ x: m.place.x, y: m.place.y, label: 'The path cannot fit here' })),
      },
    };
  },
};
