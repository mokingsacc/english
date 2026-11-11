// Grip: where a leg's entry curb curve starts, on the approach curb line (the curve as built runs from T1 there to T2 on the
// circle). Dragging it out along the curb makes the entry curb radius bigger; in, smaller. The rate comes from the engine
// (frame.js gripRate): the curve's start moves about half a foot for each foot of radius, so where that would ask more
// than a foot of radius for each screen pixel the value is geared down to that (frame.js gearedAlong) and the grip trails
// the hand; zoomed in, it stays under the hand. The value shown and stored at the end of the drag is the radius as built
// (ui/viewport.js).
import { legGeom, curveGrip, radiusFromDrag, gripRate, gearedAlong } from './frame.js';

const curve = (g) => { const L = legGeom(g.result, g.leg.id); return L ? curveGrip(g.result, L.T1, L.T2, L.entryWidthPoint) : null; };

const grip = {
  id: 'entry-radius',
  on: 'leg',
  path: 'legs.*.entryRadius',
  points(g) { const L = legGeom(g.result, g.leg.id); return L && curve(g) ? [L.T1] : []; },
  start(g) {
    const c = curve(g);
    const L = legGeom(g.result, g.leg.id);
    return c ? { corner: c.corner, grip: L.T1, asked: g.leg.entryRadius, J: gripRate(grip, g, 'entryRadius') } : null;
  },
  value(g, P, s) {
    if (!s) return g.leg.entryRadius;
    return s.J ? gearedAlong(s.asked, s.grip, s.J, P, g.k) : radiusFromDrag(s.asked, s.corner, s.grip, P);
  },
};
export default grip;
