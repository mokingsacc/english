// Grip: the nose (tip) of a leg's splitter island. Dragging it along the leg changes the splitter island length.
import { legFrame, dot, sub } from './frame.js';

export default {
  id: 'splitter-tip',
  on: 'leg',
  path: 'legs.*.splitterLength',
  points: (g) => [legFrame(g.round, g.leg).nose],
  value(g, P) {
    const f = legFrame(g.round, g.leg);
    const s = dot(sub(P, f.C), f.u);
    return Math.sqrt(s * s + f.o * f.o) - f.Ri;
  },
};
