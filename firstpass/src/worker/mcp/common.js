// What the connector's tools share: the project a call is about, the engine's results in compact form (numbers to one
// place, no drawing geometry), and the shapes of their answers ({text, data} or a refusal).
import { HttpError } from '../http.js';
import { evaluate } from '../engine.js';
import { needRow, latestRow, parseDoc } from '../store/projects.js';

export const UNDO_SAY = 'Say "undo" to put it back.';
export const PROJECT_ARG = { type: 'string', maxLength: 64, description: 'Project id. Leave out for the project changed most recently.' };
export const OPTION_ARG = { type: 'string', maxLength: 8, description: 'Option id, such as "A".' };
export const REASON_ARG = { type: 'string', minLength: 1, maxLength: 200, description: 'Why, in a few plain words from what she asked. It is the step name she sees in her history.' };

/** A refusal she or Claude can act on: {refused: message}. */
export class Refusal extends Error {}
export const refuse = message => { throw new Refusal(message); };

/** The project row a call is about: the one named, else the newest-changed one of this user's. */
export async function projectFor(ctx, args) {
  if (args.project) {
    try { return await needRow(ctx.db, ctx.user.id, args.project); } catch (e) {
      if (e instanceof HttpError) refuse('There is no project with that id. get_project lists the projects.');
      throw e;
    }
  }
  const row = await latestRow(ctx.db, ctx.user.id);
  if (!row) refuse('There are no projects yet. Ask her to open First Pass, which makes a sample project.');
  return row;
}

export function optionOf(doc, id) {
  const opt = doc.options.find(o => o.id === id);
  if (!opt) refuse(`There is no option ${String(id).slice(0, 8)}. This project has ${doc.options.map(o => o.id).join(', ')}.`);
  return opt;
}

export { parseDoc, evaluate };

export const r1 = v => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

/** The headline numbers: worst entry speed, worst speed difference, land take, fails and warns, and its sentence. */
export function headlineView(h) {
  if (!h) return null;
  return { text: h.text, worst_entry_mph: r1(h.worstEntrySpeed && h.worstEntrySpeed.value), worst_entry_leg: (h.worstEntrySpeed && h.worstEntrySpeed.leg) || null,
    worst_speed_difference_mph: r1(h.worstSpeedDrop && h.worstSpeedDrop.value), worst_speed_difference_leg: (h.worstSpeedDrop && h.worstSpeedDrop.leg) || null,
    land_sqft: h.landTake ? Math.round(h.landTake.sqft) : null, land_acres: h.landTake ? Math.round(h.landTake.acres * 100) / 100 : null,
    fails: h.fails, warns: h.warns };
}

/** The checks. detail: explain on each, the fix and each leg's words where it warns or fails. */
export function checksView(checks, { detail = false } = {}) {
  return (checks || []).map(c => {
    const out = { id: c.id, status: c.status, value: r1(c.value), unit: c.unit ?? null, limit: c.limit ?? null };
    if (!detail) return out;
    out.title = c.title;
    out.explain = c.explain || null;
    if (c.fix && c.status !== 'pass') out.fix = c.fix;
    if ((c.items || []).length) out.legs = c.items.map(i => ({ leg: i.leg, status: i.status, value: r1(i.value), ...(i.status === 'warn' || i.status === 'fail' ? { text: i.text } : {}) }));
    return out;
  });
}

/** Each leg's fastest path radii (ft) and speeds (mph). null means the path does not curve there or is not drawn. */
export function legsView(legs) {
  const round = o => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, r1(v)]));
  return (legs || []).map(l => ({ id: l.id, name: l.name, bearing: l.bearing, R: round(l.R), V: round(l.V) }));
}

/** One option worked out: {ok, problems, headline, checks}. */
export function evaluateOption(doc, opt) {
  return evaluate(opt.round, doc.rules || {});
}

/** The answer of a changing tool when the store refused: the store's own words. */
export function storeRefusal(r) {
  refuse(r.conflict ? `${r.error} Call get_option again to see the drawing as it is now.` : r.error);
}
