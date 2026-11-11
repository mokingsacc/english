// Grip: the entry width where the engine measures it, at entryWidthPoint on the outer curb, square to that curb from Se
// (where the splitter island meets the circle). Dragging it out along that line makes the entry wider, in narrower. A
// wider entry moves the island's edge as well as the curb, so the rate comes from the engine (frame.js gripRate) and the
// grip stays under the hand.
import { legGeom, dot, sub, unit, gripRate, valueAlong } from './frame.js';

const grip = {
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
    return { p0: L.entryWidthPoint, dir: unit(v), asked: g.leg.entryWidth, J: gripRate(grip, g, 'entryWidth', 0.5) };
  },
  value(g, P, s) {
    if (!s) return g.leg.entryWidth;
    return s.J ? valueAlong(s.asked, s.p0, s.J, P) : s.asked + dot(sub(P, s.p0), s.dir);
  },
};
export default grip;
