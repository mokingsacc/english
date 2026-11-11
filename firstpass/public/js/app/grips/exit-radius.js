// Grip: a point on a leg's exit curb curve as built (its middle, or near its road end when the width grip sits at
// the middle). Dragging it away from the corner the curve rounds makes the exit curb radius bigger; toward
// the corner, smaller; the rate comes from the engine (frame.js gripRate), so the built curve follows the hand even where
// the corner is shortened. The curve runs from T1x (on the departure curb) to T2x (on the circle).
import { legGeom, curveGrip, radiusFromDrag, gripRate, valueAlong } from './frame.js';

const curve = (g) => { const L = legGeom(g.result, g.leg.id); return L ? curveGrip(g.result, L.T1x, L.T2x, L.exitWidthPoint) : null; };

const grip = {
  id: 'exit-radius',
  on: 'leg',
  path: 'legs.*.exitRadius',
  points(g) { const c = curve(g); return c ? [c.mid] : []; },
  start(g) {
    const c = curve(g);
    return c ? { corner: c.corner, grip: c.mid, asked: g.leg.exitRadius, J: gripRate(grip, g, 'exitRadius') } : null;
  },
  value(g, P, s) {
    if (!s) return g.leg.exitRadius;
    return s.J ? valueAlong(s.asked, s.grip, s.J, P) : radiusFromDrag(s.asked, s.corner, s.grip, P);
  },
};
export default grip;
