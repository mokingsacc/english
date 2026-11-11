// Grip: the nose (tip) of a leg's splitter island as built, which can be further out than the asked length when the
// lanes need room to widen. Dragging it out along the leg puts the nose where the hand is (the length as built plus the
// distance moved); in toward the circle shortens the asked length by the distance moved.
import { legGeom, dot, sub, unit } from './frame.js';

export default {
  id: 'splitter-tip',
  on: 'leg',
  path: 'legs.*.splitterLength',
  points(g) { const L = legGeom(g.result, g.leg.id); return L && L.nose ? [L.nose] : []; },
  start(g) {
    const L = legGeom(g.result, g.leg.id);
    if (!L || !L.nose || !L.far) return null;
    const asked = g.leg.splitterLength;
    const built = typeof L.splitterLengthBuilt === 'number' ? L.splitterLengthBuilt : asked;
    return { nose: L.nose, u: unit(sub(L.far, L.nose)), asked, built };
  },
  value: (g, P, s) => {
    if (!s) return g.leg.splitterLength;
    const d = dot(sub(P, s.nose), s.u);
    return d > 0 ? Math.max(s.asked, s.built) + d : s.asked + d;
  },
};
