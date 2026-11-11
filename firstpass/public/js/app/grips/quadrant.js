// Grips: the four quadrant points of the inscribed circle. Dragging one in or out changes the inscribed circle diameter.
export default {
  id: 'quadrant',
  on: 'round',
  path: 'icd',
  points(g) {
    const { x, y } = g.round.center, r = g.round.icd / 2;
    return [{ x: x + r, y }, { x, y: y + r }, { x: x - r, y }, { x, y: y - r }];
  },
  value: (g, P) => 2 * Math.hypot(P.x - g.round.center.x, P.y - g.round.center.y),
};
