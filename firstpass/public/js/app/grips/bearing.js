// Grip: out along a leg, past its splitter island nose as drawn. Dragging it turns the leg (its bearing, clockwise from
// north) by the angle the hand sweeps about the centre of the circle. With polar tracking on (F10) it snaps to 15 degree steps.
import { legGeom, geomOf, along, bearingOf } from './frame.js';

export const BEYOND_NOSE = 110;   // ft past the nose, so the grip sits on the approach road

export default {
  id: 'bearing',
  on: 'leg',
  path: 'legs.*.bearing',
  points(g) { const L = legGeom(g.result, g.leg.id); return L && L.nose && L.far ? [along(L, BEYOND_NOSE)] : []; },
  start(g) {
    const G = geomOf(g.result), L = legGeom(g.result, g.leg.id);
    return G && L && L.nose && L.far ? { C: G.center, from: bearingOf(G.center, along(L, BEYOND_NOSE)), asked: g.leg.bearing } : null;
  },
  // Turned by the angle the hand sweeps about the centre, so a leg set off to one side does not jump when taken.
  value: (g, P, s) => {
    if (!s) return g.leg.bearing;
    const b = (s.asked + bearingOf(s.C, P) - s.from) % 360;
    return b < 0 ? b + 360 : b;
  },
  angle: true,
};
