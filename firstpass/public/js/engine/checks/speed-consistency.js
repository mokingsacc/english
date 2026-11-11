// Speed consistency: on each leg, the entry speed V1 against the leg's own circulating speed (V2, or V4 when
// the leg's main path is a left turn), and against the speed of the left turn circulating across the entry
// (the conflicting V4). Large differences make crashes between entering and circulating cars more likely.

import { mph, theLeg, sentence } from '../format.js';

export default {
  id: 'speed-consistency',
  title: 'Speed consistency',
  order: 30,
  unit: 'mph',
  run(ctx) {
    const warnAt = ctx.rule('speed.consistency.warn');
    const failAt = ctx.rule('speed.consistency.fail');
    const items = [];
    const flagged = [];
    let worst = null;
    for (const L of ctx.legs) {
      const v1 = L.V.V1;
      const parts = [];
      let leg = null;
      if (v1 !== null && L.Vcirc !== null) {
        const d = Math.abs(v1 - L.Vcirc);
        leg = Math.max(leg ?? 0, d);
        parts.push(`the speed changes by ${mph(d)} from entry (${mph(v1)}) to the circulating curve (${mph(L.Vcirc)})`);
      }
      if (v1 !== null && L.Vconf !== null) {
        const d = Math.abs(v1 - L.Vconf);
        leg = Math.max(leg ?? 0, d);
        const who = L.conflictingKind === 'left' ? 'left turn' : 'through traffic';
        parts.push(`the entry differs by ${mph(d)} from the ${who} from ${theLeg(L.upstreamName)} circulating across it (${mph(L.Vconf)})`);
      }
      if (leg === null) {
        items.push({ leg: L.id, status: 'info', value: null, text: sentence(`${theLeg(L.name)} has no pair of speeds to compare.`) });
        continue;
      }
      const st = leg > failAt ? 'fail' : leg > warnAt ? 'warn' : 'pass';
      if (st !== 'pass') flagged.push(L);
      if (worst === null || leg > worst) worst = leg;
      items.push({ leg: L.id, status: st, value: leg, text: sentence(`On ${theLeg(L.name)} ${parts.join(', and ')}.`) });
    }
    const status = worst === null ? 'info' : worst > failAt ? 'fail' : worst > warnAt ? 'warn' : 'pass';
    return {
      status,
      value: worst,
      unit: 'mph',
      limit: warnAt,
      items,
      explain: `Speeds on curves that follow one another, and of streams that meet, should be close: a difference above ${mph(warnAt)} gets a warning and above ${mph(failAt)} fails (NCHRP Report 672).`,
      fix: flagged.length
        ? 'Bring the speeds closer: slow the entry with a smaller entry curb radius or a shift of the approach to the left, or speed up circulating traffic with a smaller central island or a bigger circle.'
        : null,
      where: {
        legs: flagged.map((L) => L.id),
        movements: flagged.flatMap((L) => [L.main, L.conflicting].filter(Boolean)),
      },
    };
  },
};
