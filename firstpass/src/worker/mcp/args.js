// checkArgs: the connector's own check of a tool call's arguments against the tool's inputSchema, before the tool runs
// (ported from practice-hub's mcp/args.js). Covers type, enum, required, properties, additionalProperties false, items,
// minItems/maxItems, minLength/maxLength, minimum/maximum and pattern. Returns short sentences, [] when fine.
const MAX_PROBLEMS = 8;

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const typeOf = v => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const fits = (v, t) => (t === 'number' ? typeof v === 'number' && Number.isFinite(v) : t === 'integer' ? Number.isInteger(v) : typeOf(v) === t);
const show = v => (typeof v === 'string' ? `"${v.length > 40 ? `${v.slice(0, 37)}...` : v}"` : JSON.stringify(v));
const words = t => (t === 'integer' ? 'a whole number' : t === 'array' ? 'a list' : t === 'object' ? 'an object' : t === 'string' ? 'text' : t);

function walk(schema, v, where, out) {
  if (out.length >= MAX_PROBLEMS || !isObj(schema)) return;
  const types = schema.type == null ? null : [].concat(schema.type);
  if (types && !types.some(t => fits(v, t))) { out.push(`${where} must be ${types.map(words).join(' or ')}.`); return; }
  if (schema.enum && !schema.enum.some(e => e === v)) { out.push(`${where} must be one of ${schema.enum.map(e => JSON.stringify(e)).join(', ')} (got ${show(v)}).`); return; }
  if (typeof v === 'string') {
    if (schema.minLength != null && v.length < schema.minLength) out.push(`${where} is empty.`);
    if (schema.maxLength != null && v.length > schema.maxLength) out.push(`${where} is ${v.length} characters; at most ${schema.maxLength}.`);
    if (schema.pattern && !new RegExp(schema.pattern).test(v)) out.push(`${where} is not one of the names listed in the tool's description (got ${show(v)}).`);
  }
  if (typeof v === 'number') {
    if (schema.minimum != null && v < schema.minimum) out.push(`${where} must be at least ${schema.minimum}.`);
    if (schema.maximum != null && v > schema.maximum) out.push(`${where} must be at most ${schema.maximum}.`);
  }
  if (Array.isArray(v)) {
    if (schema.minItems != null && v.length < schema.minItems) out.push(`${where} needs at least ${schema.minItems} item${schema.minItems === 1 ? '' : 's'}.`);
    if (schema.maxItems != null && v.length > schema.maxItems) out.push(`${where} holds at most ${schema.maxItems} items (got ${v.length}).`);
    if (schema.items) v.forEach((x, i) => walk(schema.items, x, `${where}[${i}]`, out));
  }
  if (isObj(v)) {
    const props = schema.properties || {};
    for (const k of schema.required || []) if (v[k] === undefined) out.push(`${where === 'arguments' ? '' : `${where}.`}${k} is needed.`);
    for (const [k, x] of Object.entries(v)) {
      // An optional field sent as null counts as left out (Claude often sends null for "none").
      if (x === undefined || (x === null && !(schema.required || []).includes(k))) continue;
      if (props[k]) walk(props[k], x, where === 'arguments' ? k : `${where}.${k}`, out);
      else if (schema.additionalProperties === false) out.push(where === 'arguments' ? `Unknown argument ${k}.` : `${where} has no field ${k}.`);
    }
  }
}

/** The problems with args for schema, as sentences ([] when fine). */
export function checkArgs(schema, args) {
  if (!isObj(args)) return ['arguments must be an object.'];
  const out = [];
  walk(schema || { type: 'object' }, args, 'arguments', out);
  return out.slice(0, MAX_PROBLEMS);
}

/** The arguments without the optional fields sent as null. */
export function dropNulls(args) {
  return Object.fromEntries(Object.entries(args || {}).filter(([, v]) => v !== null && v !== undefined));
}
