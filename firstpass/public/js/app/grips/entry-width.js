// Grip: the entry width where the engine measures it, at entryWidthPoint on the right curb, square to that curb from
// Se (where the splitter island's edge meets the circle). Dragging it along that line makes the entry wider or narrower.
import { legGeom, dot, sub, unit } from './frame.js';

export default {
  id: 'entry-width',
  on: 'leg',
  path: 'legs.*.entryWidth',
  points(g) {
    const L = legGeom(g.result, g.leg.id);
    return L && L.entryWidthPoint ? [L.entryWidthPoint] : [];
  },
  start(g) {
    const L = legGeom(g.result, g.leg.id);
    if (!L || !L.entryWidthPoint || !L.Se) return null;
    const v = sub(L.entryWidthPoint, L.Se);
    return { base: L.Se, dir: unit(v), drawn: Math.hypot(v.x, v.y), asked: g.leg.entryWidth };
  },
  value: (g, P, s) => (s ? s.asked + dot(sub(P, s.base), s.dir) - s.drawn : g.leg.entryWidth),
};
