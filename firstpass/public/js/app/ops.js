// The page's side of the change ops (docs/design.md, Server; the server's own copy is src/worker/store/ops.js): builders
// for every op, and a local apply that checks each value against the engine's parameters and rules tables in the same
// plain words. The page applies a change at once with applyOps and sends the same ops to the server, which answers with
// the project as it now stands. With no server, applyOps is the whole story (undo is then held on the page).
//
//   op.set(option, path, value)  op.addOption(from?)  op.removeOption(option)  op.renameOption(option, name)
//   op.addLeg(option, bearing?)  op.removeLeg(option, leg)  op.setRule(rule, value | null)
//   applyOps(project, ops) -> new project (the input is not changed), throws OpRefused with a sentence she reads
// A new op: a builder here, a case in APPLY, and the same op on the server (store/ops.js).

import { paramFor, LEG_COUNT, defaultLeg, defaultRoundabout } from '../engine/index.js';
import { ruleById } from '../engine/rules.js';

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
};

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

/** True when two projects hold the same drawing (names, options, rules), whatever their seq. */
export function sameDrawing(a, b) {
  const strip = (p) => JSON.stringify({ name: p.name, rules: p.rules || {}, options: p.options });
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
  } else if (o.op === 'set_rule') {
    const r = ruleById(o.rule);
    text = o.value == null ? `${r ? r.label : o.rule} put back to the standard value` : `${r ? r.label : o.rule} set to ${fmt(o.value)} ${r ? r.unit : ''} for this project`.trim();
  } else text = 'Changed the drawing';
  if (ops.length > 1 && text !== 'Moved the centre') text += ` and ${ops.length - 1} more change${ops.length === 2 ? '' : 's'}`;
  return text;
}
