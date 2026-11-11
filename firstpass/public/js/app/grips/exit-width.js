// Grip: the exit width where the engine measures it, at exitWidthPoint on the right curb, square to that curb from Sx
// (where the splitter island's edge meets the circle). Dragging it along that line makes the exit wider or narrower.
import { legGeom, dot, sub, unit } from './frame.js';

export default {
  id: 'exit-width',
  on: 'leg',
  path: 'legs.*.exitWidth',
  points(g) {
    const L = legGeom(g.result, g.leg.id);
    return L && L.exitWidthPoint ? [L.exitWidthPoint] : [];
  },
  start(g) {
    const L = legGeom(g.result, g.leg.id);
    if (!L || !L.exitWidthPoint || !L.Sx) return null;
    const v = sub(L.exitWidthPoint, L.Sx);
    return { base: L.Sx, dir: unit(v), drawn: Math.hypot(v.x, v.y), asked: g.leg.exitWidth };
  },
  value: (g, P, s) => (s ? s.asked + dot(sub(P, s.base), s.dir) - s.drawn : g.leg.exitWidth),
};
