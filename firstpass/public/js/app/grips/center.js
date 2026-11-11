// Grip: the centre of the roundabout. Dragging it moves the whole roundabout (centre easting and northing).

export default {
  id: 'center',
  on: 'round',
  path: ['center.x', 'center.y'],
  points: (g) => [{ x: g.round.center.x, y: g.round.center.y }],
  value: (g, P) => [P.x, P.y],
};
