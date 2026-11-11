// Grip: where a leg's exit curb curve starts, on the departure curb line (the curve as built runs from T1x there to T2x on the
// circle). Dragging it out along the curb makes the exit curb radius bigger; in, smaller. The rate comes from the engine
// (frame.js gripRate): the curve's start moves about half a foot for each foot of radius, so where that would ask more
// than a foot of radius for each screen pixel the value is geared down to that (frame.js gearedAlong) and the grip trails
// the hand; zoomed in, it stays under the hand. The value shown and stored at the end of the drag is the radius as built
// (ui/viewport.js).
import { legGeom, curveGrip, radiusFromDrag, gripRate, gearedAlong } from './frame.js';

const curve = (g) => { const L = legGeom(g.result, g.leg.id); return L ? curveGrip(g.result, L.T1x, L.T2x, L.exitWidthPoint) : null; };

const grip = {
  id: 'exit-radius',
  on: 'leg',
  path: 'legs.*.exitRadius',
  points(g) { const L = legGeom(g.result, g.leg.id); return L && curve(g) ? [L.T1x] : []; },
  start(g) {
    const c = curve(g);
    const L = legGeom(g.result, g.leg.id);
    return c ? { corner: c.corner, grip: L.T1x, asked: g.leg.exitRadius, J: gripRate(grip, g, 'exitRadius') } : null;
  },
  value(g, P, s) {
    if (!s) return g.leg.exitRadius;
    return s.J ? gearedAlong(s.asked, s.grip, s.J, P, g.k) : radiusFromDrag(s.asked, s.corner, s.grip, P);
  },
};
export default grip;
