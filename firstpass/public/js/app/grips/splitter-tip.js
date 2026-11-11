// Grip: the nose (tip) of a leg's splitter island as drawn. Dragging it out along the leg makes the island longer;
// in toward the circle, shorter (by the distance moved along the leg).
import { legGeom, dot, sub, unit } from './frame.js';

export default {
  id: 'splitter-tip',
  on: 'leg',
  path: 'legs.*.splitterLength',
  points(g) { const L = legGeom(g.result, g.leg.id); return L && L.nose ? [L.nose] : []; },
  start(g) {
    const L = legGeom(g.result, g.leg.id);
    return L && L.nose && L.far ? { nose: L.nose, u: unit(sub(L.far, L.nose)), asked: g.leg.splitterLength } : null;
  },
  value: (g, P, s) => (s ? s.asked + dot(sub(P, s.nose), s.u) : g.leg.splitterLength),
};
