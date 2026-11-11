// Connector tool sweep: one parameter of an option stepped over a range on a copy, with the headline numbers at each
// value. Changes nothing. Values outside the parameter's range are refused by the store's own check, by label.
import { PROJECT_ARG, OPTION_ARG, projectFor, parseDoc, optionOf, evaluate, headlineView, refuse } from '../common.js';
import { READ_ONLY } from '../annotations.js';
import { PATH_PATTERN } from '../schema.js';
import { resolveAndApply, OpError, parsePath } from '../../store/ops.js';

export const SWEEP_MAX = 25;

export default {
  name: 'sweep',
  title: 'Try a range of values',
  description: `Try one parameter from \`from\` to \`to\` in steps on a copy of an option (at most ${SWEEP_MAX} values) and get a table of the headline numbers at each. Changes nothing.`,
  inputSchema: {
    type: 'object',
    properties: {
      project: PROJECT_ARG,
      option: OPTION_ARG,
      path: { type: 'string', maxLength: 60, pattern: PATH_PATTERN, description: 'The parameter, named as in change_option.' },
      from: { type: 'number' }, to: { type: 'number' }, step: { type: 'number', description: 'Greater than 0.' },
    },
    required: ['option', 'path', 'from', 'to', 'step'],
    additionalProperties: false,
  },
  annotations: READ_ONLY,
  async run(ctx, args) {
    const row = await projectFor(ctx, args);
    const doc = parseDoc(row);
    const opt = optionOf(doc, args.option);
    if (!(args.step > 0)) refuse('step must be greater than 0.');
    const n = Math.floor(Math.abs(args.to - args.from) / args.step + 1e-9) + 1;
    if (n > SWEEP_MAX) refuse(`That is ${n} values; at most ${SWEEP_MAX}. Use a larger step.`);
    const dir = args.to >= args.from ? 1 : -1;
    const rows = [];
    for (let i = 0; i < n; i++) {
      const value = Math.round((args.from + dir * i * args.step) * 1e6) / 1e6;
      let work;
      try { work = resolveAndApply(doc, [{ op: 'set', option: opt.id, path: args.path, value }]).doc; } catch (e) {
        if (e instanceof OpError) refuse(e.message);
        throw e;
      }
      const r = evaluate(work.options.find(o => o.id === opt.id).round, work.rules || {});
      const h = headlineView(r.headline);
      rows.push({ value, ok: r.ok, worst_entry_mph: h.worst_entry_mph, worst_speed_difference_mph: h.worst_speed_difference_mph, land_sqft: h.land_sqft,
        fails: h.fails, warns: h.warns, ...(r.ok ? {} : { problem: r.problems[0] }) });
    }
    const ok = rows.filter(x => x.ok);
    const p = parsePath(args.path);
    const text = `${p ? p.param.label : args.path}${/^legs\.\*\./.test(args.path) ? ' of every leg' : ''} of ${opt.name} from ${args.from} to ${args.to}: ${rows.length} values, ${ok.length} buildable.`
      + (ok.length ? ` Entry speed ${Math.min(...ok.map(x => x.worst_entry_mph))} to ${Math.max(...ok.map(x => x.worst_entry_mph))} mph.` : '') + ' Nothing was changed.';
    return { text, data: { project: { id: row.id, seq: row.seq }, option: opt.id, path: args.path, rows } };
  },
};
