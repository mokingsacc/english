// Grip: the entry width, square to the leg from the end of the splitter island at the circle. Dragging it sideways
// makes the entry wider or narrower.
import { legFrame, dot, sub } from './frame.js';

export default {
  id: 'entry-width',
  on: 'leg',
  path: 'legs.*.entryWidth',
  points(g) {
    const f = legFrame(g.round, g.leg);
    const w = g.leg.entryWidth;
    return [{ x: f.Se.x + w * f.rIn.x, y: f.Se.y + w * f.rIn.y }];
  },
  value(g, P) {
    const f = legFrame(g.round, g.leg);
    return dot(sub(P, f.Se), f.rIn);
  },
};
