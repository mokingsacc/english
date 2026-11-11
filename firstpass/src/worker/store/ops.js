// The change ops (docs/design.md, Server): each op is resolved against the project, applied, and inverted. Pure, no
// database (store/change.js writes). A resolved op is explicit and carries `was`, the state it replaces, so its inverse
// is exact and applying any resolved op first checks that the drawing still holds `was` (otherwise it is a conflict:
// "changed again since"). Values are checked against the engine's parameters and rules tables, by label.
//
//   set           {option, path, value}        path 'icd', 'center.x', 'legs.<leg id or index>.<field>', 'legs.*.<field>'
//                                              (every leg), or 'legs.<leg>.name' (text)
//   add_option    {from?, id?, name?, index?} or {option: {id, name, round}, index?}
//   remove_option {option}
//   rename_option {option, name}
//   add_leg       {option, bearing?, id?, name?, leg?: {fields}, index?}
//   remove_leg    {option, leg}                 leg id or index
//   set_rule      {rule, value}                 value null puts the standard value back
//   set_site      {lat, lon, epsg?, option?}    places the drawing at a place in California: the site and its zone, and
//                                              every option's centre moved by one shift so the option named (the first
//                                              when none is) lands there; resolved as {site, epsg, centers, was}
import { LEG_PARAMS, ROUND_PARAMS, LEG_COUNT, paramFor, legField, defaultRoundabout, defaultLeg, validate, ruleById } from '../engine.js';
import { fmt, isObj } from '../http.js';
// The site placement is the page's own (public/js/app/ops.js), so a site change shown at once on the page is the one kept.
import { placeSite, siteWords, OpRefused } from '../../../public/js/app/ops.js';

export const OPS = ['set', 'add_option', 'remove_option', 'rename_option', 'add_leg', 'remove_leg', 'set_rule', 'set_site'];
export const LIMITS = { options: 12, opsPerChange: 60, nameMax: 60, legNameMax: 40 };
export const CHANGED_AGAIN = 'That was changed again since; undo the later change first.';

/** A refused op: message is a plain sentence she reads. conflict: the drawing moved on (409), not bad input (400). */
export class OpError extends Error {
  constructor(message, { conflict = false } = {}) {
    super(message);
    this.conflict = conflict;
  }
}

const clone = v => JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const conflict = () => new OpError(CHANGED_AGAIN, { conflict: true });
const OPTION_ID = /^[A-Za-z0-9_-]{1,8}$/;
const LEG_ID = /^[A-Za-z][A-Za-z0-9_-]{0,7}$/;
const LEG_NAME = { path: 'legs.*.name', label: 'Leg name', unit: null, text: true };

// ---------------------------------------------------------------- canonical shapes

/** The roundabout in the stored key order: center, the circle values, legs (id, name, then the table's order). */
export function canonicalRound(round) {
  const out = { center: { x: round.center.x, y: round.center.y } };
  for (const p of ROUND_PARAMS) if (!p.path.startsWith('center.')) out[p.path] = round[p.path];
  out.legs = round.legs.map(l => {
    const o = { id: l.id, name: l.name };
    for (const p of LEG_PARAMS) o[legField(p)] = l[legField(p)];
    return o;
  });
  return out;
}

/** A roundabout from outside (the page, a new project): checked by the engine's model, then put in stored order. */
export function cleanRound(raw, where = 'The roundabout') {
  const v = validate(raw);
  if (!v.ok) throw new OpError(`${where} cannot be used: ${v.problems.slice(0, 3).join(' ')}`);
  for (const l of v.value.legs) {
    if (!LEG_ID.test(l.id)) throw new OpError(`The leg id "${String(l.id).slice(0, 20)}" cannot be used. A leg id starts with a letter and has at most 8 letters, digits, dashes or underscores.`);
  }
  return canonicalRound(v.value);
}

/** Rule overrides with their keys sorted, so a rule set and then put back gives the same JSON. */
export const sortKeys = o => Object.fromEntries(Object.keys(o || {}).sort().map(k => [k, o[k]]));

/** The project document in stored key order (no id, no seq). */
export function canonicalDoc(doc) {
  return {
    name: doc.name, epsg: doc.epsg, site: doc.site ?? null, rules: sortKeys(doc.rules),
    options: doc.options.map(o => ({ id: o.id, name: o.name, kind: o.kind || 'roundabout', round: o.round })),
  };
}

// ---------------------------------------------------------------- lookups

const optionIndex = (doc, id) => doc.options.findIndex(o => o.id === id);
function needOption(doc, id) {
  if (typeof id !== 'string' || !id) throw new OpError('Say which option: its id, such as "A".');
  const index = optionIndex(doc, id);
  if (index < 0) throw new OpError(`There is no option ${id.slice(0, 20)} in this project.`);
  return { opt: doc.options[index], index };
}
function legIndexOf(round, key) {
  if (typeof key === 'number' || /^\d+$/.test(String(key))) {
    const i = Number(key);
    return Number.isInteger(i) && i < round.legs.length ? i : -1;
  }
  return round.legs.findIndex(l => l.id === key);
}
/** "the North leg", "the Main Street leg". */
export const legWords = name => (/\bleg$/i.test(name) ? `the ${name}` : `the ${name} leg`);
const optWords = opt => opt.name || `Option ${opt.id}`;

/** {leg, field, param} for a path, or null: 'icd', 'center.x', 'legs.N.entryRadius', 'legs.*.bearing', 'legs.0.name'. */
export function parsePath(path) {
  if (typeof path !== 'string' || !path || path.length > 80) return null;
  const m = /^legs\.([^.]+)\.([A-Za-z]+)$/.exec(path);
  if (m) {
    if (m[2] === 'name') return { leg: m[1], field: 'name', param: LEG_NAME };
    const p = paramFor(`legs.*.${m[2]}`);
    return p ? { leg: m[1], field: m[2], param: p } : null;
  }
  const p = paramFor(path);
  return p && !p.path.startsWith('legs.') ? { leg: null, field: path, param: p } : null;
}

/** {obj, key} for a resolved path (legs by id) in a roundabout, or null. */
function locate(round, path) {
  if (path.startsWith('center.')) return round.center ? { obj: round.center, key: path.slice(7) } : null;
  const m = /^legs\.([^.]+)\.([A-Za-z]+)$/.exec(path);
  if (!m) return { obj: round, key: path };
  const leg = round.legs.find(l => l.id === m[1]);
  return leg ? { obj: leg, key: m[2] } : null;
}

// ---------------------------------------------------------------- value checks (plain words, by label)

function checkNumber(param, value, whose) {
  const name = whose ? `${param.label} of ${whose}` : param.label;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new OpError(`${name} must be a number${param.unit ? ` in ${param.unit}` : ''}.`);
  if (value < param.min || value > param.max) {
    throw new OpError(`${name} must be between ${fmt(param.min)} and ${fmt(param.max)} ${param.unit}; ${fmt(value)} ${param.unit} is outside that range.`);
  }
  return value;
}
function cleanText(v, what, max) {
  if (typeof v !== 'string') throw new OpError(`${what} must be text.`);
  const s = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) throw new OpError(`${what} cannot be empty.`);
  if (s.length > max) throw new OpError(`${what} can be at most ${max} characters.`);
  return s;
}
function intIn(v, lo, hi, what) {
  if (!Number.isInteger(v) || v < lo || v > hi) throw new OpError(`${what} must be a whole number from ${lo} to ${hi}.`);
  return v;
}

// ---------------------------------------------------------------- resolve: raw op -> resolved ops (with was)

function resolveSet(doc, raw) {
  const { opt } = needOption(doc, raw.option);
  const parsed = parsePath(raw.path);
  if (!parsed) throw new OpError(`There is no setting called "${String(raw.path ?? '').slice(0, 40)}". Settings are named like icd, circWidth or legs.N.entryRadius.`);
  const round = opt.round;
  if (parsed.leg === null) {
    const value = checkNumber(parsed.param, raw.value, null);
    const at = locate(round, parsed.param.path);
    return same(at.obj[at.key], value) ? [] : [{ op: 'set', option: opt.id, path: parsed.param.path, value, was: at.obj[at.key] }];
  }
  let idx;
  if (parsed.leg === '*') idx = round.legs.map((_, i) => i);
  else {
    const i = legIndexOf(round, parsed.leg);
    if (i < 0) throw new OpError(`${optWords(opt)} has no leg "${String(parsed.leg).slice(0, 20)}".`);
    idx = [i];
  }
  const value = parsed.param.text ? cleanText(raw.value, 'A leg name', LIMITS.legNameMax)
    : checkNumber(parsed.param, raw.value, parsed.leg === '*' ? 'every leg' : legWords(round.legs[idx[0]].name));
  const out = [];
  for (const i of idx) {
    const leg = round.legs[i];
    if (!same(leg[parsed.field], value)) out.push({ op: 'set', option: opt.id, path: `legs.${leg.id}.${parsed.field}`, value, was: leg[parsed.field] });
  }
  return out;
}

function nextOptionId(doc) {
  const taken = new Set(doc.options.map(o => o.id));
  for (let n = 1; ; n++) {
    for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') { const id = n === 1 ? c : `${c}${n}`; if (!taken.has(id)) return id; }
  }
}
function cleanOptionId(v) {
  if (typeof v !== 'string' || !OPTION_ID.test(v)) throw new OpError('An option id is 1 to 8 letters or digits, such as "B".');
  return v;
}

function resolveAddOption(doc, raw) {
  if (doc.options.length >= LIMITS.options) throw new OpError(`A project holds at most ${LIMITS.options} options. Remove one first.`);
  let option;
  if (isObj(raw.option)) {
    const id = cleanOptionId(raw.option.id);
    option = { id, name: raw.option.name == null ? `Option ${id}` : cleanText(raw.option.name, 'An option name', LIMITS.nameMax),
      kind: 'roundabout', round: cleanRound(raw.option.round, `Option ${id}`) };
  } else {
    const idIn = raw.id ?? (typeof raw.option === 'string' ? raw.option : null);
    const id = idIn != null ? cleanOptionId(idIn) : nextOptionId(doc);
    let round;
    if (raw.from != null) round = clone(needOption(doc, raw.from).opt.round);
    else {
      round = cleanRound(defaultRoundabout());
      if (doc.options[0]) round.center = { ...doc.options[0].round.center };
    }
    option = { id, name: raw.name == null ? `Option ${id}` : cleanText(raw.name, 'An option name', LIMITS.nameMax), kind: 'roundabout', round };
  }
  if (optionIndex(doc, option.id) >= 0) throw new OpError(`There is already an option ${option.id}. Give the new one another id.`);
  const index = raw.index == null ? doc.options.length : intIn(raw.index, 0, doc.options.length, 'The place of the new option');
  return [{ op: 'add_option', option, index, ...(raw.from != null ? { from: raw.from } : {}) }];
}

function resolveRemoveOption(doc, raw) {
  const { opt, index } = needOption(doc, raw.option);
  if (doc.options.length <= 1) throw new OpError('A project needs at least one option, so the last one cannot be removed.');
  return [{ op: 'remove_option', option: opt.id, index, was: clone(opt) }];
}

function resolveRenameOption(doc, raw) {
  const { opt } = needOption(doc, raw.option);
  const name = cleanText(raw.name, 'An option name', LIMITS.nameMax);
  return name === opt.name ? [] : [{ op: 'rename_option', option: opt.id, name, was: opt.name }];
}

/** The middle of the widest gap between the legs, to the nearest half degree. */
export function freeBearing(legs) {
  if (!legs.length) return 0;
  const b = legs.map(l => l.bearing).sort((x, y) => x - y);
  let best = -1, at = 0;
  for (let i = 0; i < b.length; i++) {
    const next = i + 1 < b.length ? b[i + 1] : b[0] + 360;
    if (next - b[i] > best) { best = next - b[i]; at = (b[i] + best / 2) % 360; }
  }
  return Math.round(at * 2) / 2 % 360;
}

function resolveAddLeg(doc, raw) {
  const { opt } = needOption(doc, raw.option);
  const round = opt.round;
  if (round.legs.length >= LEG_COUNT.max) throw new OpError(`A roundabout here has at most ${LEG_COUNT.max} legs; ${optWords(opt)} already has ${round.legs.length}.`);
  const src = { ...(isObj(raw.leg) ? raw.leg : {}) };
  for (const k of ['bearing', 'id', 'name']) if (raw[k] != null) src[k] = raw[k];
  const bearing = src.bearing == null ? freeBearing(round.legs) : checkNumber(paramFor('legs.*.bearing'), src.bearing, 'the new leg');
  const base = defaultLeg(bearing);
  let id = src.id;
  if (id == null) {
    id = base.id;
    for (let n = 2; round.legs.some(l => l.id === id); n++) id = `${base.id}${n}`;
  } else if (typeof id !== 'string' || !LEG_ID.test(id)) {
    throw new OpError('A leg id starts with a letter and has at most 8 letters, digits, dashes or underscores, such as "NE".');
  }
  if (round.legs.some(l => l.id === id)) throw new OpError(`${optWords(opt)} already has a leg "${id}". Give the new one another id.`);
  let name = src.name == null ? base.name : cleanText(src.name, 'A leg name', LIMITS.legNameMax);
  if (src.name == null) for (let n = 2; round.legs.some(l => l.name === name); n++) name = `${base.name} ${n}`;
  const leg = { id, name };
  for (const p of LEG_PARAMS) {
    const k = legField(p);
    leg[k] = k === 'bearing' ? bearing : src[k] == null ? p.default : checkNumber(p, src[k], 'the new leg');
  }
  const index = raw.index == null ? round.legs.length : intIn(raw.index, 0, round.legs.length, 'The place of the new leg');
  return [{ op: 'add_leg', option: opt.id, leg, index }];
}

function resolveRemoveLeg(doc, raw) {
  const { opt } = needOption(doc, raw.option);
  const round = opt.round;
  const index = legIndexOf(round, raw.leg);
  if (index < 0) throw new OpError(`${optWords(opt)} has no leg "${String(raw.leg ?? '').slice(0, 20)}".`);
  const leg = round.legs[index];
  if (round.legs.length <= LEG_COUNT.min) throw new OpError(`A roundabout needs at least ${LEG_COUNT.min} legs, so ${legWords(leg.name)} cannot be removed.`);
  return [{ op: 'remove_leg', option: opt.id, leg: leg.id, index, was: clone(leg) }];
}

function resolveSetRule(doc, raw) {
  const rule = typeof raw.rule === 'string' ? ruleById(raw.rule) : null;
  if (!rule) throw new OpError(`There is no design limit called "${String(raw.rule ?? '').slice(0, 40)}".`);
  const was = doc.rules[rule.id] ?? null;
  let value = null;
  if (raw.value != null) value = checkNumber({ label: rule.label, unit: rule.unit, min: rule.min, max: rule.max }, raw.value, null);
  return same(was, value) ? [] : [{ op: 'set_rule', rule: rule.id, value, was }];
}

/** Where the drawing is now: its site, zone and every option's centre (a set_site op's `was`). */
const placeOf = doc => ({ site: doc.site ?? null, epsg: doc.epsg, centers: Object.fromEntries(doc.options.map(o => [o.id, { x: o.round.center.x, y: o.round.center.y }])) });

function resolveSetSite(doc, raw) {
  let p;
  try { p = placeSite(doc, { lat: raw.lat, lon: raw.lon, epsg: raw.epsg ?? null, option: raw.option ?? null }); } catch (e) {
    if (e instanceof OpRefused) throw new OpError(e.message);
    throw e;
  }
  const was = placeOf(doc);
  return same(was, p) ? [] : [{ op: 'set_site', site: p.site, epsg: p.epsg, centers: p.centers, was }];
}

const RESOLVE = { set: resolveSet, add_option: resolveAddOption, remove_option: resolveRemoveOption, rename_option: resolveRenameOption,
  add_leg: resolveAddLeg, remove_leg: resolveRemoveLeg, set_rule: resolveSetRule, set_site: resolveSetSite };

/** One raw op resolved against doc: a list of resolved ops ([] when it changes nothing). Throws OpError. */
export function resolveOp(doc, raw) {
  if (!isObj(raw)) throw new OpError('Each change must be an object with an op, such as {"op": "set", ...}.');
  const fn = RESOLVE[raw.op];
  if (!fn) throw new OpError(`There is no change called "${String(raw.op ?? '').slice(0, 30)}". The changes are ${OPS.join(', ')}.`);
  return fn(doc, raw);
}

// ---------------------------------------------------------------- apply (checks was) and invert

const APPLY = {
  set(doc, op) {
    const i = optionIndex(doc, op.option);
    if (i < 0) throw conflict();
    const at = locate(doc.options[i].round, op.path);
    if (!at || !same(at.obj[at.key], op.was)) throw conflict();
    at.obj[at.key] = op.value;
  },
  add_option(doc, op) {
    if (optionIndex(doc, op.option.id) >= 0 || doc.options.length >= LIMITS.options) throw conflict();
    doc.options.splice(Math.min(op.index, doc.options.length), 0, clone(op.option));
  },
  remove_option(doc, op) {
    const i = optionIndex(doc, op.option);
    if (i < 0 || !same(doc.options[i], op.was) || doc.options.length <= 1) throw conflict();
    doc.options.splice(i, 1);
  },
  rename_option(doc, op) {
    const i = optionIndex(doc, op.option);
    if (i < 0 || doc.options[i].name !== op.was) throw conflict();
    doc.options[i].name = op.name;
  },
  add_leg(doc, op) {
    const i = optionIndex(doc, op.option);
    if (i < 0) throw conflict();
    const legs = doc.options[i].round.legs;
    if (legs.length >= LEG_COUNT.max || legs.some(l => l.id === op.leg.id)) throw conflict();
    legs.splice(Math.min(op.index, legs.length), 0, clone(op.leg));
  },
  remove_leg(doc, op) {
    const i = optionIndex(doc, op.option);
    if (i < 0) throw conflict();
    const legs = doc.options[i].round.legs;
    const j = legs.findIndex(l => l.id === op.leg);
    if (j < 0 || !same(legs[j], op.was) || legs.length <= LEG_COUNT.min) throw conflict();
    legs.splice(j, 1);
  },
  set_site(doc, op) {
    // Every option must still be where it was, and no option added or removed since, or the shift would split them up.
    if (!same(placeOf(doc), op.was)) throw conflict();
    doc.site = op.site == null ? null : { lat: op.site.lat, lon: op.site.lon };
    doc.epsg = op.epsg;
    for (const o of doc.options) o.round.center = { x: op.centers[o.id].x, y: op.centers[o.id].y };
  },
  set_rule(doc, op) {
    if (!same(doc.rules[op.rule], op.was)) throw conflict();
    const rules = { ...doc.rules };
    if (op.value === null) delete rules[op.rule]; else rules[op.rule] = op.value;
    doc.rules = sortKeys(rules);
  },
};

/** Applies one resolved op to doc in place. Throws OpError (conflict) when the drawing no longer holds op.was. */
export function applyOp(doc, op) {
  const fn = APPLY[op && op.op];
  if (!fn) throw new OpError('That change is not one the server knows.', { conflict: true });
  fn(doc, op);
}

/** The exact inverse of one resolved op. */
export function invertOp(op) {
  switch (op.op) {
    case 'set': return { op: 'set', option: op.option, path: op.path, value: op.was, was: op.value };
    case 'add_option': return { op: 'remove_option', option: op.option.id, index: op.index, was: op.option };
    case 'remove_option': return { op: 'add_option', option: op.was, index: op.index };
    case 'rename_option': return { op: 'rename_option', option: op.option, name: op.was, was: op.name };
    case 'add_leg': return { op: 'remove_leg', option: op.option, leg: op.leg.id, index: op.index, was: op.leg };
    case 'remove_leg': return { op: 'add_leg', option: op.option, leg: op.was, index: op.index };
    case 'set_rule': return { op: 'set_rule', rule: op.rule, value: op.was, was: op.value };
    case 'set_site': return { op: 'set_site', site: op.was.site, epsg: op.was.epsg, centers: op.was.centers, was: { site: op.site, epsg: op.epsg, centers: op.centers } };
    default: throw new Error(`no inverse for ${op && op.op}`);
  }
}

/** The inverse of a list of resolved ops: each inverted, in reverse order. */
export const invertOps = ops => ops.slice().reverse().map(invertOp);

/**
 * Raw ops resolved and applied one after another on a copy of doc (each sees the ones before).
 * Returns {doc, ops (resolved), inverse}. Throws OpError.
 */
export function resolveAndApply(doc, rawOps) {
  if (!Array.isArray(rawOps) || !rawOps.length) throw new OpError('Send at least one change in ops.');
  if (rawOps.length > LIMITS.opsPerChange) throw new OpError(`Send at most ${LIMITS.opsPerChange} changes at once.`);
  const work = clone(doc);
  const ops = [];
  for (const raw of rawOps) {
    for (const op of resolveOp(work, raw)) { applyOp(work, op); ops.push(op); }
  }
  return { doc: work, ops, inverse: invertOps(ops) };
}

/** Resolved ops applied on a copy of doc (undo and redo). Throws OpError (conflict). */
export function applyResolved(doc, ops) {
  const work = clone(doc);
  for (const op of ops) applyOp(work, op);
  return work;
}

// ---------------------------------------------------------------- what an op touches, and its words

/** The parts of the drawing an op touches, as keys ('A/icd', 'A/legs.N', 'A', 'rules/speed.entry.max'). */
export function touchKeys(op) {
  switch (op.op) {
    case 'set': return [`${op.option}/${op.path}`];
    case 'add_option': return [op.option.id];
    case 'remove_option': return [op.option];
    case 'rename_option': return [`${op.option}/name`];
    case 'add_leg': return [`${op.option}/legs.${op.leg.id}`];
    case 'remove_leg': return [`${op.option}/legs.${op.leg}`];
    case 'set_rule': return [`rules/${op.rule}`];
    case 'set_site': return ['site', ...Object.keys(op.centers).map(id => `${id}/center`)];
    default: return ['*'];
  }
}
const within = (a, b) => a === b || a.startsWith(`${b}/`) || a.startsWith(`${b}.`);
/** Whether two lists of resolved ops touch the same part of the drawing. */
export function overlaps(opsA, opsB) {
  const a = opsA.flatMap(touchKeys), b = opsB.flatMap(touchKeys);
  return a.some(x => b.some(y => x === '*' || y === '*' || within(x, y) || within(y, x)));
}

const withUnit = (v, unit) => (unit ? `${fmt(v)} ${unit}` : fmt(v));
function setWords(doc, op) {
  const opt = doc.options.find(o => o.id === op.option);
  const m = /^legs\.([^.]+)\.([A-Za-z]+)$/.exec(op.path);
  const leg = m && opt ? opt.round.legs.find(l => l.id === m[1]) : null;
  if (m && m[2] === 'name') return `Renamed ${legWords(String(op.was))} to "${op.value}"`;
  const p = parsePath(op.path);
  const label = p ? p.param.label : op.path;
  const unit = p ? p.param.unit : null;
  const whose = m ? ` of ${legWords(leg ? leg.name : m[1])}` : '';
  return `${label}${whose} set to ${withUnit(op.value, unit)} (was ${withUnit(op.was, unit)})`;
}
function opWords(doc, op) {
  const opt = id => doc.options.find(o => o.id === id);
  const optName = id => (opt(id) ? optWords(opt(id)) : `Option ${id}`);
  switch (op.op) {
    case 'set': return setWords(doc, op);
    case 'add_option': return `Added ${optWords(op.option)}${op.from ? ` as a copy of ${optName(op.from)}` : ''}`;
    case 'remove_option': return `Removed ${optWords(op.was)}`;
    case 'rename_option': return `Renamed ${op.was} to "${op.name}"`;
    case 'add_leg': return `Added ${legWords(op.leg.name)} to ${optName(op.option)}`;
    case 'remove_leg': return `Removed ${legWords(op.was.name)} from ${optName(op.option)}`;
    case 'set_site': return op.site ? siteWords(op, op.was && op.was.epsg) : 'Took the drawing off its site';
    case 'set_rule': {
      const r = ruleById(op.rule);
      const label = r ? r.label : op.rule;
      return op.value === null ? `${label} put back to the standard ${withUnit(r ? r.value : '', r && r.unit)}` : `${label} set to ${withUnit(op.value, r && r.unit)} for this project`;
    }
    default: return 'Changed the drawing';
  }
}

/** A plain summary of resolved ops, read against the drawing before them. At most 300 characters. */
export function summarize(doc, ops) {
  if (!ops.length) return 'Nothing changed';
  const multi = doc.options.length > 1;
  const sets = ops.every(o => o.op === 'set' && o.option === ops[0].option);
  let text;
  if (sets && ops.length > 1 && ops.every(o => o.path.replace(/^legs\.[^.]+\./, '') === ops[0].path.replace(/^legs\.[^.]+\./, '') && same(o.value, ops[0].value))
      && /^legs\./.test(ops[0].path)) {
    const p = parsePath(ops[0].path);
    text = `${p ? p.param.label : ops[0].path} of ${ops.length} legs set to ${withUnit(ops[0].value, p && p.param.unit)}`;
  } else if (sets && ops.length === 2 && ops.every(o => o.path.startsWith('center.'))) {
    text = 'Moved the centre';
  } else {
    text = opWords(doc, ops[0]);
    if (ops.length > 1) text += ` and ${ops.length - 1} more change${ops.length === 2 ? '' : 's'}`;
  }
  if (multi && sets) {
    const o = doc.options.find(x => x.id === ops[0].option);
    if (o) text += ` in ${optWords(o)}`;
  }
  return text.slice(0, 300);
}
