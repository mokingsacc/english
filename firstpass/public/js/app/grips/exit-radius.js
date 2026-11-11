// Grip: the middle of a leg's exit curb curve. Dragging it away from the corner the curve rounds makes the exit curb
// radius bigger; toward the corner, smaller.
import { legGeom, curbArc, arcMid, rayCircle, radiusFromDrag } from './frame.js';

export default {
  id: 'exit-radius',
  on: 'leg',
  path: 'legs.*.exitRadius',
  points(g) {
    const L = legGeom(g.result, g.leg.id);
    const arc = L && curbArc(g.result, L.T2x, L.T1x);
    return arc ? [arcMid(arc)] : [];
  },
  start(g) {
    const L = legGeom(g.result, g.leg.id);
    const arc = L && curbArc(g.result, L.T2x, L.T1x);
    if (!arc) return null;
    const corner = rayCircle(L.Fx, L.T1x, g.round.center, g.round.icd / 2) || L.T2x;
    return { corner, grip: arcMid(arc), r0: g.leg.exitRadius };
  },
  value: (g, P, s) => (s ? radiusFromDrag(s.r0, s.corner, s.grip, P) : g.leg.exitRadius),
};
