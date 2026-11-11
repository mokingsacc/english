// Grip: the centre of the roundabout as drawn. Dragging it moves the whole roundabout (centre easting and northing).
import { geomOf } from './frame.js';

export default {
  id: 'center',
  on: 'round',
  path: ['center.x', 'center.y'],
  points(g) { const G = geomOf(g.result); return G ? [{ x: G.center.x, y: G.center.y }] : []; },
  value: (g, P) => [P.x, P.y],
};
