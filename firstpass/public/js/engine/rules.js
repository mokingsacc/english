// Design limits and constants. Every number the engine uses to judge or build a design lives here,
// and nowhere else. A project can override any value by id (project.rules = { [id]: value }).
//
// Row shape: { id, value, unit, label, source, verify, min, max }
//   verify: true means the value has been carried from a secondary reference and must be checked
//   against the source document (NCHRP Research Report 1043, which replaces Report 672) before the
//   tool is relied on. min and max bound what a project override may set.

const NCHRP = 'NCHRP Report 672, section 6.7.1 (carried into NCHRP Research Report 1043)';
const NCHRP_SIGHT = 'NCHRP Report 672, section 6.7.3 (carried into NCHRP Research Report 1043)';
const AASHTO = 'AASHTO A Policy on Geometric Design of Highways and Streets, stopping sight distance (Equation 3-2)';
const METHOD = 'First Pass method setting, not a design standard';

export const RULES = [
  // Fastest path clearances
  { id: 'fp.offset.curb', value: 5, unit: 'ft', min: 0, max: 15, verify: true, source: NCHRP,
    label: 'Clearance from the centre of the car to a curb face on the fastest path' },
  { id: 'fp.offset.centerline', value: 5, unit: 'ft', min: 0, max: 15, verify: true, source: NCHRP,
    label: 'Clearance from the centre of the car to a painted centre line on the fastest path' },
  { id: 'fp.offset.paint', value: 3, unit: 'ft', min: 0, max: 15, verify: true, source: NCHRP,
    label: 'Clearance from the centre of the car to a painted edge line on the fastest path' },
  { id: 'fp.window', value: 65, unit: 'ft', min: 20, max: 200, verify: true, source: NCHRP,
    label: 'Length of path over which each fastest path radius is measured' },
  { id: 'fp.window.min', value: 20, unit: 'ft', min: 4, max: 100, verify: false, source: METHOD,
    label: 'Shortest length of path a radius is ever fitted over' },
  { id: 'fp.station', value: 4, unit: 'ft', min: 1, max: 10, verify: false, source: METHOD,
    label: 'Spacing of the points along each fastest path through the roundabout' },
  { id: 'fp.station.fine', value: 60, unit: 'ft', min: 0, max: 1000, verify: false, source: METHOD,
    label: 'Distance past each splitter island nose that keeps the close point spacing' },
  { id: 'fp.station.far', value: 20, unit: 'ft', min: 1, max: 50, verify: false, source: METHOD,
    label: 'Widest spacing of the points on the straight approach and departure, at the far ends' },
  { id: 'fp.passes', value: 3, unit: 'passes', min: 1, max: 6, verify: false, source: METHOD,
    label: 'Number of times each fastest path is solved, each time about the previous answer' },
  { id: 'geom.leadLength', value: 250, unit: 'ft', min: 100, max: 1000, verify: false, source: METHOD,
    label: 'Length of approach and departure road drawn and modelled beyond each splitter island nose' },

  // Fastest path speeds
  { id: 'speed.eq.pos.k', value: 3.4415, unit: 'mph', min: 0.1, max: 20, verify: true, source: NCHRP + ', Equation 6-1',
    label: 'Speed equation factor for a curve with a 2 percent cross slope toward the inside' },
  { id: 'speed.eq.pos.p', value: 0.3861, unit: 'power', min: 0.1, max: 1, verify: true, source: NCHRP + ', Equation 6-1',
    label: 'Speed equation power for a curve with a 2 percent cross slope toward the inside' },
  { id: 'speed.eq.neg.k', value: 3.4614, unit: 'mph', min: 0.1, max: 20, verify: true, source: NCHRP + ', Equation 6-2',
    label: 'Speed equation factor for a curve with a 2 percent cross slope toward the outside' },
  { id: 'speed.eq.neg.p', value: 0.3673, unit: 'power', min: 0.1, max: 1, verify: true, source: NCHRP + ', Equation 6-2',
    label: 'Speed equation power for a curve with a 2 percent cross slope toward the outside' },
  { id: 'speed.decel', value: 4.2, unit: 'ft/s2', min: 0.5, max: 20, verify: true, source: NCHRP + ', Equation 6-3',
    label: 'Deceleration assumed between the entry curve and the circulating curve' },
  { id: 'speed.accel', value: 6.9, unit: 'ft/s2', min: 0.5, max: 20, verify: true, source: NCHRP + ', Equation 6-4',
    label: 'Acceleration assumed between the circulating curve and the exit curve' },
  { id: 'speed.fpsPerMph', value: 1.47, unit: 'ft/s per mph', min: 1.4, max: 1.5, verify: true, source: NCHRP + ', Equations 6-3 and 6-4',
    label: 'Feet per second in one mile per hour, as written in the speed equations' },
  { id: 'speed.entry.max', value: 25, unit: 'mph', min: 10, max: 50, verify: true, source: NCHRP,
    label: 'Highest entry speed recommended for a single-lane roundabout' },
  { id: 'speed.consistency.warn', value: 10, unit: 'mph', min: 0, max: 40, verify: true, source: NCHRP,
    label: 'Speed difference between linked curves above which the design gets a warning' },
  { id: 'speed.consistency.fail', value: 15, unit: 'mph', min: 0, max: 40, verify: true, source: NCHRP,
    label: 'Speed difference between linked curves above which the design fails' },

  // Stopping sight distance
  { id: 'sight.ssd.reactionTime', value: 2.5, unit: 's', min: 0.5, max: 5, verify: false, source: AASHTO,
    label: 'Brake reaction time used for stopping sight distance' },
  { id: 'sight.ssd.decel', value: 11.2, unit: 'ft/s2', min: 3, max: 30, verify: false, source: AASHTO,
    label: 'Deceleration used for stopping sight distance' },
  { id: 'sight.ssd.reactionFactor', value: 1.468, unit: 'ft/s per mph', min: 1.4, max: 1.5, verify: false, source: AASHTO,
    label: 'Feet per second in one mile per hour, used for the reaction distance' },
  // The design text gave 1.087 here. AASHTO Equation 3-2 uses 1.075 (half the square of 1.4667), and only 1.075
  // reproduces the published design values of 360 ft at 45 mph and 425 ft at 50 mph.
  { id: 'sight.ssd.brakeFactor', value: 1.075, unit: 'ft per (mph squared per ft/s2)', min: 1, max: 1.2, verify: true, source: AASHTO,
    label: 'Factor turning speed squared over deceleration into braking distance' },
  { id: 'sight.ssd.roundTo', value: 5, unit: 'ft', min: 0, max: 50, verify: false, source: AASHTO,
    label: 'Stopping sight distances are rounded up to a multiple of this length' },

  // Intersection sight distance
  { id: 'sight.isd.criticalHeadway', value: 5.0, unit: 's', min: 2, max: 10, verify: true, source: NCHRP_SIGHT,
    label: 'Critical headway used for intersection sight distance at an entry' },
  { id: 'sight.isd.factor', value: 1.468, unit: 'ft/s per mph', min: 1.4, max: 1.5, verify: true, source: NCHRP_SIGHT,
    label: 'Feet per second in one mile per hour, used for intersection sight distance' },
  { id: 'sight.isd.eyeBack', value: 50, unit: 'ft', min: 0, max: 200, verify: true, source: NCHRP_SIGHT,
    label: 'Distance of the entering driver\'s eye back from the entrance line' },

  // Units
  { id: 'units.sqftPerAcre', value: 43560, unit: 'sq ft', min: 43560, max: 43560, verify: false, source: 'Definition of the acre',
    label: 'Square feet in one acre' },
];

const BY_ID = new Map(RULES.map((r) => [r.id, r]));

export function ruleById(id) {
  return BY_ID.get(id) || null;
}

/**
 * Apply a project's overrides to the rules table.
 * Returns { values, get(id), problems, overridden }. Unknown ids are ignored (a rule may have been retired).
 * A value that is not a finite number, or lies outside the rule's min and max, is reported in problems and
 * the standard value is kept; evaluate() then answers ok: false, so a bad setting is never silently used.
 */
export function resolveRules(overrides) {
  const values = Object.create(null);
  for (const r of RULES) values[r.id] = r.value;
  const problems = [];
  const overridden = [];
  if (overrides && typeof overrides === 'object') {
    for (const id of Object.keys(overrides)) {
      const r = BY_ID.get(id);
      if (!r) continue;
      const v = overrides[id];
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        problems.push(`The project setting for the ${lowerFirst(r.label)} is not a number.`);
        continue;
      }
      if (v < r.min || v > r.max) {
        problems.push(`The project setting for the ${lowerFirst(r.label)} is ${v} ${r.unit}, which is outside the allowed range of ${r.min} to ${r.max} ${r.unit}.`);
        continue;
      }
      values[id] = v;
      if (v !== r.value) overridden.push(id);
    }
  }
  return {
    values,
    problems,
    overridden,
    get(id) {
      const v = values[id];
      if (v === undefined) throw new Error(`Unknown rule ${id}`);
      return v;
    },
  };
}

function lowerFirst(s) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
