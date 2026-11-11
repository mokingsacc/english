// Intersection sight distance (for information): at each entry, the two triangles a waiting driver must be
// able to see across, one along the path of cars entering from the next leg upstream and one along the path of
// cars already circulating (NCHRP Report 672 section 6.7.3).

import { mph, ft, theLeg, sentence } from '../format.js';

export default {
  id: 'sight-intersection',
  title: 'Intersection sight distance',
  order: 60,
  unit: 'ft',
  run(ctx) {
    const tc = ctx.rule('sight.isd.criticalHeadway');
    const back = ctx.rule('sight.isd.eyeBack');
    const items = [];
    const polygons = [];
    const points = [];
    let worst = null;
    for (const L of ctx.legs) {
      const parts = [];
      for (const tri of [L.isd.entering, L.isd.circulating]) {
        if (!tri) continue;
        polygons.push(tri.polygon);
        if (worst === null || tri.length > worst) worst = tri.length;
        const what = tri.stream === 'entering'
          ? `${ft(tri.length)} back along the path of cars entering from ${theLeg(nameOf(ctx, tri.from))} at ${mph(tri.speed)}`
          : `${ft(tri.length)} back along the path of cars circulating from ${theLeg(nameOf(ctx, tri.from))} at ${mph(tri.speed)}`;
        parts.push(tri.reached + 0.5 < tri.length ? `${what} (the path runs out after ${ft(tri.reached)})` : what);
      }
      if (L.eye) points.push({ x: L.eye.x, y: L.eye.y, label: `Driver's eye, ${L.name}` });
      items.push({
        leg: L.id, status: 'info', value: L.isd.circulating ? L.isd.circulating.length : null,
        text: parts.length
          ? sentence(`A driver waiting on ${theLeg(L.name)} must see ${parts.join(', and ')}.`)
          : sentence(`No conflicting path passes the entry of ${theLeg(L.name)}.`),
      });
    }
    return {
      status: 'info',
      value: worst,
      unit: 'ft',
      limit: null,
      items,
      explain: `Each entry has two sight triangles, drawn from a driver's eye ${ft(back)} back from the entrance line, using a critical headway of ${tc} seconds. The tool cannot tell what blocks the view, so keep the triangles clear of anything taller than about 2 ft, such as signs, walls, parked cars and planting. Too much sight distance encourages fast entries, so do not clear more than is needed.`,
      fix: null,
      where: { polygons, points },
    };
  },
};

function nameOf(ctx, id) {
  const L = ctx.legs.find((l) => l.id === id);
  return L ? L.name : id;
}
