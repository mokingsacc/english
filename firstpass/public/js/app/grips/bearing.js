// Grip: out along a leg, past its splitter island nose. Dragging it turns the leg (its bearing, clockwise from north,
// from the centre of the circle to the cursor). With polar tracking on (F10) it snaps to 15 degree steps.
import { legFrame } from './frame.js';

export const BEYOND_NOSE = 110;   // ft past the nose, so the grip sits on the approach road

export default {
  id: 'bearing',
  on: 'leg',
  path: 'legs.*.bearing',
  points(g) {
    const f = legFrame(g.round, g.leg);
    return [f.P(f.sNose + BEYOND_NOSE, 0)];
  },
  value(g, P) {
    const C = g.round.center;
    let b = (Math.atan2(P.x - C.x, P.y - C.y) * 180) / Math.PI;
    if (b < 0) b += 360;
    return b;
  },
  angle: true,
};
