// Grip: out along a leg, past its splitter island nose as drawn. Dragging it turns the leg (its bearing, clockwise from
// north, from the centre of the circle to the cursor). With polar tracking on (F10) it snaps to 15 degree steps.
import { legGeom, geomOf, along, bearingOf } from './frame.js';

export const BEYOND_NOSE = 110;   // ft past the nose, so the grip sits on the approach road

export default {
  id: 'bearing',
  on: 'leg',
  path: 'legs.*.bearing',
  points(g) { const L = legGeom(g.result, g.leg.id); return L && L.nose && L.far ? [along(L, BEYOND_NOSE)] : []; },
  start(g) { const G = geomOf(g.result); return G ? { C: G.center } : null; },
  value: (g, P, s) => bearingOf(s ? s.C : g.round.center, P),
  angle: true,
};
