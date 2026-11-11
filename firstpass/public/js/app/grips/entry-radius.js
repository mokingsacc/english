// Grip: a point on a leg's entry curb curve as drawn. Dragging it away from the corner the curve rounds makes the
// entry curb radius bigger; toward the corner, smaller. The curve runs from T1 (on the approach curb) to T2 (on the circle).
import { legGeom, curveGrip, radiusFromDrag } from './frame.js';

const curve = (g) => { const L = legGeom(g.result, g.leg.id); return L ? curveGrip(g.result, L.T1, L.T2, L.entryWidthPoint) : null; };

export default {
  id: 'entry-radius',
  on: 'leg',
  path: 'legs.*.entryRadius',
  points(g) { const c = curve(g); return c ? [c.mid] : []; },
  start(g) { const c = curve(g); return c ? { corner: c.corner, grip: c.mid, r0: c.r } : null; },
  value: (g, P, s) => (s ? radiusFromDrag(s.r0, s.corner, s.grip, P) : g.leg.entryRadius),
};
