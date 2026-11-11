// The page's side of the change ops (docs/design.md, Server; the server's own copy is src/worker/store/ops.js): builders
// for every op, and a local apply that checks each value against the engine's parameters and rules tables in the same
// plain words. The page applies a change at once with applyOps and sends the same ops to the server, which answers with
// the project as it now stands. With no server, applyOps is the whole story (undo is then held on the page).
//
//   op.set(option, path, value)  op.addOption(from?)  op.removeOption(option)  op.renameOption(option, name)
//   op.addLeg(option, bearing?)  op.removeLeg(option, leg)  op.setRule(rule, value | null)
//   op.setSite(lat, lon, epsg?, option?)  places the drawing at a place in California (see placeSite)
//   applyOps(project, ops) -> new project (the input is not changed), throws OpRefused with a sentence she reads
// A new op: a builder here, a case in APPLY, and the same op on the server (store/ops.js). placeSite, inCalifornia and
// siteWords are shared with the server, which imports them from here, so both place a site to the same hundredth of a foot.

import { paramFor, LEG_COUNT, defaultLeg, defaultRoundabout } from '../engine/index.js';
import { ruleById } from '../engine/rules.js';
import { fromLatLon, zoneFor } from '../engine/crs.js';

export class OpRefused extends Error {}

export const MAX_OPTIONS = 12;

export const op = {
  set: (option, path, value) => ({ op: 'set', option, path, value }),
  addOption: (from, id) => ({ op: 'add_option', ...(from ? { from } : {}), ...(id ? { id } : {}) }),
  removeOption: (option) => ({ op: 'remove_option', option }),
  renameOption: (option, name) => ({ op: 'rename_option', option, name }),
  addLeg: (option, bearing) => ({ op: 'add_leg', option, ...(bearing == null ? {} : { bearing }) }),
  removeLeg: (option, leg) => ({ op: 'remove_leg', option, leg }),
  setRule: (rule, value) => ({ op: 'set_rule', rule, value }),
  setSite: (lat, lon, epsg, option) => ({ op: 'set_site', lat, lon, ...(epsg == null ? {} : { epsg }), ...(option == null ? {} : { option }) }),
};

// ---------------------------------------------------------------- the site: a place in California

/** California's state plane zones, CCS83 zones 1 to 6 in US survey feet. */
export const CA_ZONES = [2225, 2226, 2227, 2228, 2229, 2230];
/**
 * California's outline, roughly, as [lon, lat] corners a little outside the state line (a few miles at most), so every
 * place in the state is in and Reno, Las Vegas, Tijuana, Oregon and the open sea far out are not.
 */
export const CALIFORNIA = [[-124.6, 42.02], [-119.9, 42.02], [-119.9, 39.0], [-114.5, 35.0], [-114.0, 34.3], [-114.4, 34.0],
  [-114.4, 33.0], [-114.6, 32.68], [-117.13, 32.51], [-117.5, 32.4], [-118.6, 32.4], [-121.5, 34.0], [-124.6, 40.0]];

/** Whether a latitude and longitude lie in California (CALIFORNIA). */
export function inCalifornia(lat, lon) {
  let inside = false;
  for (let i = 0, j = CALIFORNIA.length - 1; i < CALIFORNIA.length; j = i++) {
    const [x1, y1] = CALIFORNIA[i], [x2, y2] = CALIFORNIA[j];
    if ((y1 > lat) !== (y2 > lat) && lon < ((x2 - x1) * (lat - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

const r2 = (v) => Math.round(v * 100) / 100;
const r6 = (v) => Math.round(v * 1e6) / 1e6;
/** "California zone 5 (EPSG 2229)". */
export const zoneWords = (epsg) => `California zone ${epsg - 2224} (EPSG ${epsg})`;
const EXAMPLE = 'such as 34.0522, -118.2437';

/**
 * Where a site puts the drawing: { site: {lat, lon}, epsg, centers: {optionId: {x, y}} }. The zone is the one the place
 * lies in (crs.js zoneFor) unless epsg names another California zone. Every option's centre moves by one shift, so the
 * option named (the one on screen; the first when none is named) lands on the site and the options keep their places
 * to one another; bearings are not changed. Throws OpRefused in plain words.
 */
export function placeSite(doc, { lat, lon, epsg = null, option = null } = {}) {
  const num = (v) => typeof v === 'number' && Number.isFinite(v);
  if (!num(lat) || !num(lon)) throw new OpRefused(`Give the site as a latitude and a longitude in degrees, ${EXAMPLE}.`);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new OpRefused(Math.abs(lon) <= 90 && Math.abs(lat) <= 180
      ? `A latitude is between -90 and 90 degrees. Give the latitude first, then the longitude, ${EXAMPLE}.`
      : `Give the site as a latitude and a longitude in degrees, ${EXAMPLE}.`);
  }
  if (!inCalifornia(lat, lon)) throw new OpRefused(`${r6(lat)}, ${r6(lon)} is outside California. First Pass draws on California's state plane grid, so give a place in California, ${EXAMPLE}.`);
  const zone = epsg == null ? zoneFor(lat, lon) : epsg;
  if (!CA_ZONES.includes(zone)) throw new OpRefused('The zone must be one of California\'s state plane zones, EPSG 2225 to 2230 (zones 1 to 6).');
  const focus = option == null ? doc.options[0] : doc.options.find((o) => o.id === option);
  if (!focus) throw new OpRefused(`There is no option ${option} in this project.`);
  const to = fromLatLon(zone, lat, lon);
  const dx = to.x - focus.round.center.x, dy = to.y - focus.round.center.y;
  const centers = {};
  for (const o of doc.options) centers[o.id] = { x: r2(o.round.center.x + dx), y: r2(o.round.center.y + dy) };
  return { site: { lat: r6(lat), lon: r6(lon) }, epsg: zone, centers };
}

/** The step name of a site change: "Placed the drawing at 34.0522, -118.2437 in California zone 5 (EPSG 2229), was zone 2". */
export function siteWords(placed, wasEpsg) {
  const moved = wasEpsg != null && wasEpsg !== placed.epsg ? `, was zone ${wasEpsg - 2224}` : '';
  return `Placed the drawing at ${placed.site.lat}, ${placed.site.lon} in ${zoneWords(placed.epsg)}${moved}`;
}

const clone = (v) => JSON.parse(JSON.stringify(v));
const fmt = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100));
const legWords = (name) => (/\bleg$/i.test(name) ? `the ${name}` : `the ${name} leg`);

/** The next free option id: A, B, ... Z, then A2. */
export function nextOptionId(project) {
  const taken = new Set(project.options.map((o) => o.id));
  for (let n = 1; ; n++) {
    for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') { const id = n === 1 ? c : `${c}${n}`; if (!taken.has(id)) return id; }
  }
}

/** The middle of the widest gap between the legs, to the nearest half degree (where LEG puts a new leg). */
export function freeBearing(legs) {
  if (!legs.length) return 0;
  const b = legs.map((l) => l.bearing).sort((x, y) => x - y);
  let best = -1, at = 0;
  for (let i = 0; i < b.length; i++) {
    const next = i + 1 < b.length ? b[i + 1] : b[0] + 360;
    if (next - b[i] > best) { best = next - b[i]; at = (b[i] + best / 2) % 360; }
  }
  return (Math.round(at * 2) / 2) % 360;
}

function needOption(doc, id) {
  const opt = doc.options.find((o) => o.id === id);
  if (!opt) throw new OpRefused(`There is no option ${id} in this project.`);
  return opt;
}

function checkValue(param, value, whose) {
  const name = whose ? `${param.label} of ${whose}` : param.label;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new OpRefused(`${name} must be a number${param.unit ? ` in ${param.unit}` : ''}.`);
  if (value < param.min || value > param.max) {
    throw new OpRefused(`${name} must be between ${fmt(param.min)} and ${fmt(param.max)} ${param.unit}; ${fmt(value)} ${param.unit} is outside that range.`);
  }
  return value;
}

function legsFor(round, key) {
  if (key === '*') return round.legs;
  const byId = round.legs.find((l) => l.id === key);
  if (byId) return [byId];
  if (/^\d+$/.test(key) && round.legs[Number(key)]) return [round.legs[Number(key)]];
  return [];
}

const APPLY = {
  set(doc, o) {
    const opt = needOption(doc, o.option);
    const round = opt.round;
    const m = /^legs\.([^.]+)\.([A-Za-z]+)$/.exec(o.path || '');
    if (m) {
      const legs = legsFor(round, m[1]);
      if (!legs.length) throw new OpRefused(`${opt.name} has no leg "${m[1]}".`);
      if (m[2] === 'name') {
        const name = String(o.value ?? '').replace(/\s+/g, ' ').trim();
        if (!name) throw new OpRefused('A leg name cannot be empty.');
        if (name.length > 40) throw new OpRefused('A leg name can be at most 40 characters.');
        for (const l of legs) l.name = name;
        return;
      }
      const p = paramFor(`legs.*.${m[2]}`);
      if (!p) throw new OpRefused(`There is no setting called "${o.path}".`);
      checkValue(p, o.value, m[1] === '*' ? 'every leg' : legWords(legs[0].name));
      for (const l of legs) l[m[2]] = o.value;
      return;
    }
    const p = paramFor(o.path);
    if (!p || p.path.startsWith('legs.')) throw new OpRefused(`There is no setting called "${o.path}".`);
    checkValue(p, o.value, null);
    if (o.path.startsWith('center.')) round.center[o.path.slice(7)] = o.value;
    else round[o.path] = o.value;
  },
  add_option(doc, o) {
    if (doc.options.length >= MAX_OPTIONS) throw new OpRefused(`A project holds at most ${MAX_OPTIONS} options. Remove one first.`);
    const id = o.id || nextOptionId(doc);
    if (doc.options.some((x) => x.id === id)) throw new OpRefused(`There is already an option ${id}. Give the new one another id.`);
    let round;
    if (o.from) round = clone(needOption(doc, o.from).round);
    else { round = defaultRoundabout(); if (doc.options[0]) round.center = { ...doc.options[0].round.center }; }
    doc.options.push({ id, name: o.name || `Option ${id}`, kind: 'roundabout', round });
  },
  remove_option(doc, o) {
    const i = doc.options.findIndex((x) => x.id === o.option);
    if (i < 0) throw new OpRefused(`There is no option ${o.option} in this project.`);
    if (doc.options.length <= 1) throw new OpRefused('A project needs at least one option, so the last one cannot be removed.');
    doc.options.splice(i, 1);
  },
  rename_option(doc, o) {
    const opt = needOption(doc, o.option);
    const name = String(o.name ?? '').replace(/\s+/g, ' ').trim();
    if (!name) throw new OpRefused('An option name cannot be empty.');
    if (name.length > 60) throw new OpRefused('An option name can be at most 60 characters.');
    opt.name = name;
  },
  add_leg(doc, o) {
    const opt = needOption(doc, o.option);
    const legs = opt.round.legs;
    if (legs.length >= LEG_COUNT.max) throw new OpRefused(`A roundabout here has at most ${LEG_COUNT.max} legs; ${opt.name} already has ${legs.length}.`);
    const bearing = o.bearing == null ? freeBearing(legs) : checkValue(paramFor('legs.*.bearing'), o.bearing, 'the new leg');
    const leg = defaultLeg(bearing);
    let id = leg.id;
    for (let n = 2; legs.some((l) => l.id === id); n++) id = `${leg.id}${n}`;
    let name = leg.name;
    for (let n = 2; legs.some((l) => l.name === name); n++) name = `${leg.name} ${n}`;
    legs.push({ ...leg, id, name });
  },
  remove_leg(doc, o) {
    const opt = needOption(doc, o.option);
    const legs = opt.round.legs;
    const i = legs.findIndex((l) => l.id === o.leg);
    if (i < 0) throw new OpRefused(`${opt.name} has no leg "${o.leg}".`);
    if (legs.length <= LEG_COUNT.min) throw new OpRefused(`A roundabout needs at least ${LEG_COUNT.min} legs, so ${legWords(legs[i].name)} cannot be removed.`);
    legs.splice(i, 1);
  },
  set_site(doc, o) {
    const p = placeSite(doc, { lat: o.lat, lon: o.lon, epsg: o.epsg ?? null, option: o.option ?? null });
    doc.site = p.site;
    doc.epsg = p.epsg;
    for (const opt of doc.options) opt.round.center = p.centers[opt.id];
  },
  set_rule(doc, o) {
    const r = ruleById(o.rule);
    if (!r) throw new OpRefused(`There is no design limit called "${o.rule}".`);
    const rules = { ...(doc.rules || {}) };
    if (o.value === null || o.value === undefined) delete rules[r.id];
    else rules[r.id] = checkValue({ label: r.label, unit: r.unit, min: r.min, max: r.max }, o.value, null);
    doc.rules = Object.fromEntries(Object.keys(rules).sort().map((k) => [k, rules[k]]));
  },
};

/** The project with the ops applied in order (each sees the ones before). Throws OpRefused. */
export function applyOps(project, ops) {
  if (!Array.isArray(ops) || !ops.length) throw new OpRefused('There is nothing to change.');
  const doc = clone(project);
  for (const o of ops) {
    const fn = APPLY[o && o.op];
    if (!fn) throw new OpRefused(`There is no change called "${o && o.op}".`);
    fn(doc, o);
  }
  return doc;
}

/** True when two projects hold the same drawing (names, site and zone, options, rules), whatever their seq. */
export function sameDrawing(a, b) {
  const strip = (p) => JSON.stringify({ name: p.name, epsg: p.epsg ?? null, site: p.site ?? null, rules: p.rules || {}, options: p.options });
  return strip(a) === strip(b);
}

/** A short step name for a local change, in the words the server uses. */
export function describe(project, ops) {
  const o = ops[0];
  if (!o) return 'Nothing changed';
  const opt = (id) => project.options.find((x) => x.id === id);
  const optName = (id) => (opt(id) ? opt(id).name : `Option ${id}`);
  let text;
  if (o.op === 'set') {
    const m = /^legs\.([^.]+)\.([A-Za-z]+)$/.exec(o.path);
    const leg = m && opt(o.option) ? opt(o.option).round.legs.find((l) => l.id === m[1]) : null;
    if (m && m[2] === 'name') text = `Renamed ${legWords(leg ? leg.name : m[1])} to "${o.value}"`;
    else if (ops.length === 2 && ops.every((x) => x.op === 'set' && x.path.startsWith('center.'))) text = 'Moved the centre';
    else {
      const p = paramFor(o.path);
      text = `${p ? p.label : o.path}${m ? ` of ${legWords(leg ? leg.name : m[1])}` : ''} set to ${fmt(o.value)} ${p ? p.unit : ''}`.trim();
    }
  } else if (o.op === 'add_option') text = `Added a new option${o.from ? ` as a copy of ${optName(o.from)}` : ''}`;
  else if (o.op === 'remove_option') text = `Removed ${optName(o.option)}`;
  else if (o.op === 'rename_option') text = `Renamed ${optName(o.option)} to "${o.name}"`;
  else if (o.op === 'add_leg') text = `Added a leg to ${optName(o.option)}`;
  else if (o.op === 'remove_leg') {
    const leg = opt(o.option) && opt(o.option).round.legs.find((l) => l.id === o.leg);
    text = `Removed ${legWords(leg ? leg.name : o.leg)} from ${optName(o.option)}`;
  } else if (o.op === 'set_site') {
    try { text = siteWords(placeSite(project, { lat: o.lat, lon: o.lon, epsg: o.epsg ?? null, option: o.option ?? null }), project.epsg); } catch { text = 'Placed the drawing at a new site'; }
  } else if (o.op === 'set_rule') {
    const r = ruleById(o.rule);
    text = o.value == null ? `${r ? r.label : o.rule} put back to the standard value` : `${r ? r.label : o.rule} set to ${fmt(o.value)} ${r ? r.unit : ''} for this project`.trim();
  } else text = 'Changed the drawing';
  if (ops.length > 1 && text !== 'Moved the centre') text += ` and ${ops.length - 1} more change${ops.length === 2 ? '' : 's'}`;
  return text;
}
