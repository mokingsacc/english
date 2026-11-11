// The connector's description of a parameter path, built from the engine's parameters table, so a new parameter there
// reaches change_option and sweep without an edit here.
import { ROUND_PARAMS, LEG_PARAMS, legField } from '../engine.js';
import { fmt } from '../http.js';

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const range = p => `${p.label}, ${fmt(p.min)} to ${fmt(p.max)} ${p.unit}`;

/** A pattern every parameter path matches: a whole-roundabout path, or legs.<leg id, index or *>.<field>. */
export const PATH_PATTERN = `^(${ROUND_PARAMS.map(p => esc(p.path)).join('|')}|legs\\.[A-Za-z0-9_*-]+\\.(${LEG_PARAMS.map(p => esc(legField(p))).join('|')}))$`;

/** The paths with their labels and ranges, for the tool description. */
export const PATH_HELP = `${ROUND_PARAMS.map(p => `${p.path} (${range(p)})`).join('; ')}. Per leg, legs.<leg id>.<field>, or legs.*.<field> for every leg: ${LEG_PARAMS.map(p => `${legField(p)} (${range(p)})`).join('; ')}.`;

export const PATH_ARG = { type: 'string', maxLength: 60, pattern: PATH_PATTERN, description: `The parameter: ${PATH_HELP}` };
