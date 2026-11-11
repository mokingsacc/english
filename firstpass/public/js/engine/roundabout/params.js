// The single table of every roundabout parameter. The Properties palette, the command line, validation
// and the connector's tool schema all read this table.
//
// Row shape: { path, label, unit, min, max, step, default, group, help }
// Paths: 'icd' for the whole roundabout, 'legs.*.entryRadius' for a value every leg has. A concrete leg
// path names the leg by its position or its id: 'legs.0.entryRadius' or 'legs.N.entryRadius'.

export const LEG_COUNT = { min: 3, max: 6 };

export const PARAMS = [
  { path: 'center.x', label: 'Centre easting', unit: 'ft', min: -100000000, max: 100000000, step: 1, default: 6000000,
    group: 'Location', help: 'The easting of the centre of the roundabout, in state plane feet.' },
  { path: 'center.y', label: 'Centre northing', unit: 'ft', min: -100000000, max: 100000000, step: 1, default: 2000000,
    group: 'Location', help: 'The northing of the centre of the roundabout, in state plane feet.' },

  { path: 'icd', label: 'Inscribed circle diameter', unit: 'ft', min: 70, max: 300, step: 1, default: 130,
    group: 'Circle', help: 'The diameter of the outer curb of the circulatory roadway, measured across the circle.' },
  { path: 'circWidth', label: 'Circulatory roadway width', unit: 'ft', min: 12, max: 40, step: 0.5, default: 18,
    group: 'Circle', help: 'The width of the roadway that runs around the central island, from the outer curb to the edge of the truck apron.' },
  { path: 'apronWidth', label: 'Truck apron width', unit: 'ft', min: 0, max: 30, step: 0.5, default: 10,
    group: 'Circle', help: 'The width of the mountable truck apron around the central island. Cars stay off it; long trucks may run over it.' },

  { path: 'legs.*.bearing', label: 'Bearing', unit: 'degrees', min: 0, max: 360, step: 0.5, default: 0,
    group: 'Leg position', help: 'The compass direction of the leg, measured clockwise from north, looking from the centre outward along the leg.' },
  { path: 'legs.*.offsetLeft', label: 'Approach offset to the left', unit: 'ft', min: -30, max: 30, step: 0.5, default: 0,
    group: 'Leg position', help: 'How far the centre line of the leg is shifted to the left of the centre of the circle, as seen by a driver entering. A shift to the left slows entering traffic; a shift to the right speeds it up.' },
  { path: 'legs.*.approachSpeed', label: 'Approach speed', unit: 'mph', min: 15, max: 70, step: 1, default: 45,
    group: 'Leg approach', help: 'The speed of traffic on the road before the roundabout. It sets stopping sight distance and is the highest speed any path can reach.' },
  { path: 'legs.*.approachWidth', label: 'Approach lane width', unit: 'ft', min: 10, max: 20, step: 0.5, default: 12,
    group: 'Leg approach', help: 'The width of the entering lane on the road before the splitter island.' },
  { path: 'legs.*.entryWidth', label: 'Entry width', unit: 'ft', min: 12, max: 26, step: 0.5, default: 16,
    group: 'Leg entry', help: 'The width of the entering roadway where the splitter island meets the circle, measured square to the leg from the island to where the outer curb line would run. The curb curve cuts that corner, so the entry as built (the shortest distance from the end of the island to the curb) comes out wider; the tool reports that width as well.' },
  { path: 'legs.*.entryRadius', label: 'Entry curb radius', unit: 'ft', min: 30, max: 250, step: 1, default: 65,
    group: 'Leg entry', help: 'The radius of the curb that turns entering traffic onto the circle. A larger radius allows faster entries.' },
  { path: 'legs.*.exitWidth', label: 'Exit width', unit: 'ft', min: 12, max: 26, step: 0.5, default: 16,
    group: 'Leg exit', help: 'The width of the exiting roadway where the splitter island meets the circle, measured square to the leg from the island to where the outer curb line would run. The curb curve cuts that corner, so the exit as built (the shortest distance from the end of the island to the curb) comes out wider; the tool reports that width as well.' },
  { path: 'legs.*.exitRadius', label: 'Exit curb radius', unit: 'ft', min: 40, max: 500, step: 1, default: 150,
    group: 'Leg exit', help: 'The radius of the curb that turns exiting traffic off the circle. Exits are usually given a larger radius than entries.' },
  { path: 'legs.*.departWidth', label: 'Departure lane width', unit: 'ft', min: 10, max: 20, step: 0.5, default: 12,
    group: 'Leg exit', help: 'The width of the exiting lane on the road beyond the splitter island.' },
  { path: 'legs.*.splitterLength', label: 'Splitter island length', unit: 'ft', min: 20, max: 300, step: 1, default: 80,
    group: 'Leg splitter island', help: 'The length of the splitter island, measured along the leg from the circle out to its nose.' },
  { path: 'legs.*.splitterWidth', label: 'Splitter island width', unit: 'ft', min: 4, max: 40, step: 0.5, default: 14,
    group: 'Leg splitter island', help: 'The width of the splitter island where it meets the circle. It narrows to a point at its nose.' },
];

const BY_PATH = new Map(PARAMS.map((p) => [p.path, p]));

export const LEG_PARAMS = PARAMS.filter((p) => p.path.startsWith('legs.*.'));
export const ROUND_PARAMS = PARAMS.filter((p) => !p.path.startsWith('legs.*.'));

/** The leg field name of a leg parameter row: 'legs.*.entryRadius' gives 'entryRadius'. */
export function legField(param) {
  return param.path.slice('legs.*.'.length);
}

/**
 * The table row for a path. Accepts 'icd', 'legs.*.entryRadius', 'legs.2.entryRadius' or 'legs.N.entryRadius'.
 * Returns null for a path that is not in the table.
 */
export function paramFor(path) {
  if (typeof path !== 'string') return null;
  const direct = BY_PATH.get(path);
  if (direct) return direct;
  const m = /^legs\.([^.]+)\.([A-Za-z]+)$/.exec(path);
  if (!m) return null;
  return BY_PATH.get(`legs.*.${m[2]}`) || null;
}
