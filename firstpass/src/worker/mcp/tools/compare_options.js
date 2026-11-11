// Connector tool compare_options: the options side by side, headline numbers and each check's status, in a table.
import { PROJECT_ARG, projectFor, parseDoc, optionOf, evaluateOption, headlineView, refuse } from '../common.js';
import { READ_ONLY } from '../annotations.js';

const MAX = 6;

export default {
  name: 'compare_options',
  title: 'Compare options',
  description: 'The options side by side: worst entry speed, worst speed difference, land take, fails and warns, and each check\'s status. All options when none are named (at most 6).',
  inputSchema: {
    type: 'object',
    properties: { project: PROJECT_ARG, options: { type: 'array', minItems: 1, maxItems: MAX, items: { type: 'string', maxLength: 8 }, description: 'Option ids.' } },
    additionalProperties: false,
  },
  annotations: READ_ONLY,
  async run(ctx, args) {
    const row = await projectFor(ctx, args);
    const doc = parseDoc(row);
    const opts = args.options ? args.options.map(id => optionOf(doc, id)) : doc.options.slice(0, MAX);
    if (!opts.length) refuse('Name at least one option.');
    const rows = opts.map(o => {
      const r = evaluateOption(doc, o);
      const h = headlineView(r.headline);
      return { option: o.id, name: o.name, ok: r.ok, worst_entry_mph: h.worst_entry_mph, worst_speed_difference_mph: h.worst_speed_difference_mph,
        land_sqft: h.land_sqft, fails: h.fails, warns: h.warns, checks: Object.fromEntries(r.checks.map(c => [c.id, c.status])), ...(r.ok ? {} : { problem: r.problems[0] }) };
    });
    const line = x => (x.ok ? `${x.name}: entry ${x.worst_entry_mph} mph, speed difference ${x.worst_speed_difference_mph} mph, ${x.land_sqft} sq ft, ${x.fails} fail, ${x.warns} warn`
      : `${x.name}: cannot be built (${x.problem})`);
    return { text: rows.map(line).join('\n'), data: { project: { id: row.id, seq: row.seq }, rows } };
  },
};
