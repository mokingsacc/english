// Grips: the four quadrant points of the inscribed circle as drawn. Dragging one in or out changes the inscribed
// circle diameter (twice the distance from the centre to the cursor).
import { geomOf } from './frame.js';

export default {
  id: 'quadrant',
  on: 'round',
  path: 'icd',
  points(g) {
    const G = geomOf(g.result);
    if (!G) return [];
    const { x, y } = G.center, r = G.radii.inscribed;
    return [{ x: x + r, y }, { x, y: y + r }, { x: x - r, y }, { x, y: y - r }];
  },
  start(g) { const G = geomOf(g.result); return G ? { C: G.center } : null; },
  value: (g, P, s) => { const C = s ? s.C : g.round.center; return 2 * Math.hypot(P.x - C.x, P.y - C.y); },
};
