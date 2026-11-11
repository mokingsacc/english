// Roundabout data: defaults, validation and clamping against the parameters table, and path access.
//
// roundabout = { center: { x, y }, icd, circWidth, apronWidth, legs: [leg] }
// leg = { id, name, bearing, offsetLeft, approachSpeed, approachWidth, entryWidth, entryRadius,
//         exitWidth, exitRadius, departWidth, splitterLength, splitterWidth }

import { PARAMS, LEG_PARAMS, ROUND_PARAMS, LEG_COUNT, legField, paramFor } from './params.js';

const COMPASS = [
  [0, 'N', 'North'], [45, 'NE', 'Northeast'], [90, 'E', 'East'], [135, 'SE', 'Southeast'],
  [180, 'S', 'South'], [225, 'SW', 'Southwest'], [270, 'W', 'West'], [315, 'NW', 'Northwest'],
];

function compassName(bearing) {
  let best = COMPASS[0], bd = Infinity;
  for (const c of COMPASS) {
    const d = Math.abs(((bearing - c[0] + 540) % 360) - 180);
    if (d < bd) { bd = d; best = c; }
  }
  return best;
}

/** A leg with every value at its default, pointing along `bearing`. */
export function defaultLeg(bearing = 0, id, name) {
  const c = compassName(bearing);
  const leg = { id: id || c[1], name: name || `${c[2]} leg` };
  for (const p of LEG_PARAMS) leg[legField(p)] = p.default;
  leg.bearing = bearing;
  return leg;
}

/** The default single-lane, four-leg roundabout. */
export function defaultRoundabout() {
  const round = { center: { x: defaultOf('center.x'), y: defaultOf('center.y') } };
  for (const p of ROUND_PARAMS) if (!p.path.startsWith('center.')) round[p.path] = p.default;
  round.legs = [0, 90, 180, 270].map((b) => defaultLeg(b));
  return round;
}

function defaultOf(path) {
  return PARAMS.find((p) => p.path === path).default;
}

function describeValue(v) {
  if (v === null) return 'empty';
  if (typeof v === 'string') return v.trim() === '' ? 'empty' : `"${v.length > 20 ? v.slice(0, 20) + '...' : v}"`;
  if (typeof v === 'number') return Number.isNaN(v) ? 'not a number' : 'endless';
  return 'not a number';
}

function fmt(v) {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

/**
 * Check a roundabout against the parameters table without changing it.
 * Missing values are filled with their defaults (reported in `filled`); values that are not finite
 * numbers, or lie outside the table's range, are reported in `problems` in plain words.
 * Returns { ok, problems, filled, value } where value is a clean copy (bearings wrapped to 0 to 360).
 */
export function validate(round) {
  const problems = [];
  const filled = [];
  if (!round || typeof round !== 'object' || Array.isArray(round)) {
    return { ok: false, problems: ['There is no roundabout to check.'], filled, value: null };
  }
  const value = { center: { x: 0, y: 0 }, legs: [] };

  for (const p of ROUND_PARAMS) {
    const [obj, key] = p.path.startsWith('center.')
      ? [round.center && typeof round.center === 'object' ? round.center : undefined, p.path.slice(7)]
      : [round, p.path];
    const raw = obj ? obj[key] : undefined;
    const target = p.path.startsWith('center.') ? value.center : value;
    target[key] = checkNumber(p, raw, p.label, problems, filled);
  }

  const legs = Array.isArray(round.legs) ? round.legs : [];
  if (!Array.isArray(round.legs)) problems.push('The roundabout has no list of legs.');
  else if (legs.length < LEG_COUNT.min) problems.push(`A roundabout needs at least ${LEG_COUNT.min} legs; this one has ${legs.length}.`);
  else if (legs.length > LEG_COUNT.max) problems.push(`This tool handles at most ${LEG_COUNT.max} legs; this roundabout has ${legs.length}.`);

  const seen = new Set();
  legs.forEach((lg, i) => {
    if (!lg || typeof lg !== 'object') {
      problems.push(`Leg ${i + 1} is empty.`);
      return;
    }
    const out = {};
    const rawBearing = lg.bearing;
    const fallback = compassName(typeof rawBearing === 'number' && Number.isFinite(rawBearing) ? rawBearing : 0);
    out.id = typeof lg.id === 'string' && lg.id.trim() !== '' ? lg.id.trim() : `L${i + 1}`;
    out.name = typeof lg.name === 'string' && lg.name.trim() !== '' ? lg.name.trim() : `${fallback[2]} leg`;
    if (seen.has(out.id)) problems.push(`Two legs share the id "${out.id}". Give each leg its own id.`);
    seen.add(out.id);
    for (const p of LEG_PARAMS) {
      const key = legField(p);
      let v = lg[key];
      if (key === 'bearing' && typeof v === 'number' && Number.isFinite(v)) v = ((v % 360) + 360) % 360;
      out[key] = checkNumber(p, v, `${p.label.toLowerCase()} of the ${out.name}`, problems, filled, true);
    }
    value.legs.push(out);
  });

  return { ok: problems.length === 0, problems, filled, value };
}

function checkNumber(p, raw, what, problems, filled, lower) {
  const name = lower ? `The ${what}` : `The ${what.charAt(0).toLowerCase()}${what.slice(1)}`;
  if (raw === undefined) {
    filled.push(p.path);
    return p.default;
  }
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    problems.push(`${name} is ${describeValue(raw)}. Enter a number in ${p.unit}.`);
    return p.default;
  }
  if (raw < p.min || raw > p.max) {
    problems.push(`${name} is ${fmt(raw)} ${p.unit}, outside the allowed range of ${fmt(p.min)} to ${fmt(p.max)} ${p.unit}.`);
    return raw < p.min ? p.min : p.max;
  }
  return raw;
}

/**
 * A copy of the roundabout with every value made usable: missing or broken values take their defaults and
 * values outside the table's range are pulled to the nearest limit. Never throws. Leg count is not changed.
 */
export function clamp(round) {
  const src = round && typeof round === 'object' ? round : {};
  const out = { center: { x: 0, y: 0 }, legs: [] };
  for (const p of ROUND_PARAMS) {
    if (p.path.startsWith('center.')) {
      const k = p.path.slice(7);
      out.center[k] = clampNumber(p, src.center && typeof src.center === 'object' ? src.center[k] : undefined);
    } else {
      out[p.path] = clampNumber(p, src[p.path]);
    }
  }
  const legs = Array.isArray(src.legs) ? src.legs : [];
  legs.forEach((lg, i) => {
    const l = lg && typeof lg === 'object' ? lg : {};
    const o = {
      id: typeof l.id === 'string' && l.id.trim() ? l.id.trim() : `L${i + 1}`,
      name: typeof l.name === 'string' && l.name.trim() ? l.name.trim() : `Leg ${i + 1}`,
    };
    for (const p of LEG_PARAMS) {
      const k = legField(p);
      let v = l[k];
      if (k === 'bearing' && typeof v === 'number' && Number.isFinite(v)) v = ((v % 360) + 360) % 360;
      o[k] = clampNumber(p, v);
    }
    out.legs.push(o);
  });
  return out;
}

function clampNumber(p, v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return p.default;
  return v < p.min ? p.min : v > p.max ? p.max : v;
}

function legIndex(round, key) {
  const legs = round && Array.isArray(round.legs) ? round.legs : [];
  if (/^\d+$/.test(key)) {
    const i = Number(key);
    return i < legs.length ? i : -1;
  }
  return legs.findIndex((l) => l && l.id === key);
}

/** Read the value at a parameter path ('icd', 'center.x', 'legs.0.entryRadius', 'legs.N.entryRadius'). */
export function getAt(round, path) {
  if (!paramFor(path) || !round) return undefined;
  if (path.startsWith('center.')) return round.center ? round.center[path.slice(7)] : undefined;
  const m = /^legs\.([^.]+)\.([A-Za-z]+)$/.exec(path);
  if (!m) return round[path];
  const i = legIndex(round, m[1]);
  return i >= 0 ? round.legs[i][m[2]] : undefined;
}

/**
 * A new roundabout with one value changed; the input is not modified. Returns null when the path does not
 * name a parameter or a leg that exists. The value is stored as given: call validate() to check it.
 */
export function setAt(round, path, value) {
  const p = paramFor(path);
  if (!p || !round || typeof round !== 'object') return null;
  const out = { ...round, center: { ...(round.center || {}) }, legs: Array.isArray(round.legs) ? round.legs.slice() : [] };
  if (path.startsWith('center.')) { out.center[path.slice(7)] = value; return out; }
  const m = /^legs\.([^.]+)\.([A-Za-z]+)$/.exec(path);
  if (!m) {
    if (path.includes('*')) return null;
    out[path] = value;
    return out;
  }
  if (m[1] === '*') return null;
  const i = legIndex(round, m[1]);
  if (i < 0) return null;
  out.legs[i] = { ...out.legs[i], [m[2]]: value };
  return out;
}
