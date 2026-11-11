// Grip: the exit width, square to the leg from the end of the splitter island at the circle. Dragging it sideways
// makes the exit wider or narrower.
import { legFrame, dot, sub } from './frame.js';

export default {
  id: 'exit-width',
  on: 'leg',
  path: 'legs.*.exitWidth',
  points(g) {
    const f = legFrame(g.round, g.leg);
    const w = g.leg.exitWidth;
    return [{ x: f.Sx.x - w * f.rIn.x, y: f.Sx.y - w * f.rIn.y }];
  },
  value(g, P) {
    const f = legFrame(g.round, g.leg);
    return -dot(sub(P, f.Sx), f.rIn);
  },
};
