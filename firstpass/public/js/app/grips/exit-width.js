// Grip: the exit width where the engine measures it, at exitWidthPoint on the outer curb, square to that curb from Sx
// (where the splitter island meets the circle). Dragging it out along that line makes the exit wider, in narrower. A
// wider exit moves the island's edge as well as the curb, so the rate comes from the engine (frame.js gripRate) and the
// grip stays under the hand.
import { legGeom, dot, sub, unit, gripRate, valueAlong } from './frame.js';

const grip = {
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
    return { p0: L.exitWidthPoint, dir: unit(v), asked: g.leg.exitWidth, J: gripRate(grip, g, 'exitWidth', 0.5) };
  },
  value(g, P, s) {
    if (!s) return g.leg.exitWidth;
    return s.J ? valueAlong(s.asked, s.p0, s.J, P) : s.asked + dot(sub(P, s.p0), s.dir);
  },
};
export default grip;
