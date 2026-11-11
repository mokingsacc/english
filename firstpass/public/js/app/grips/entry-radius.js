// Grip: the middle of a leg's entry curb curve. Dragging it away from the corner the curve rounds makes the entry curb
// radius bigger; toward the corner, smaller.
import { legGeom, curbArc, arcMid, rayCircle, radiusFromDrag } from './frame.js';

export default {
  id: 'entry-radius',
  on: 'leg',
  path: 'legs.*.entryRadius',
  points(g) {
    const L = legGeom(g.result, g.leg.id);
    const arc = L && curbArc(g.result, L.T1, L.T2);
    return arc ? [arcMid(arc)] : [];
  },
  start(g) {
    const L = legGeom(g.result, g.leg.id);
    const arc = L && curbArc(g.result, L.T1, L.T2);
    if (!arc) return null;
    const corner = rayCircle(L.F, L.T1, g.round.center, g.round.icd / 2) || L.T2;
    return { corner, grip: arcMid(arc), r0: g.leg.entryRadius };
  },
  value: (g, P, s) => (s ? radiusFromDrag(s.r0, s.corner, s.grip, P) : g.leg.entryRadius),
};
