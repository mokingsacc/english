// Grip: a point on a leg's exit curb curve as drawn. Dragging it away from the corner the curve rounds makes the
// exit curb radius bigger; toward the corner, smaller. The curve runs from T2x (on the circle) to T1x (on the departure curb).
import { legGeom, curveGrip, radiusFromDrag } from './frame.js';

const curve = (g) => { const L = legGeom(g.result, g.leg.id); return L ? curveGrip(g.result, L.T1x, L.T2x, L.exitWidthPoint) : null; };

export default {
  id: 'exit-radius',
  on: 'leg',
  path: 'legs.*.exitRadius',
  points(g) { const c = curve(g); return c ? [c.mid] : []; },
  start(g) { const c = curve(g); return c ? { corner: c.corner, grip: c.mid, r0: c.r } : null; },
  value: (g, P, s) => (s ? radiusFromDrag(s.r0, s.corner, s.grip, P) : g.leg.exitRadius),
};
