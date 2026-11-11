// Connector tool change_option: sets one or more parameters of an option as one change (one step in her history, with
// Claude's reason as its name), then answers with the checks before and after. The paths come from the engine's table.
import { PROJECT_ARG, OPTION_ARG, REASON_ARG, UNDO_SAY, projectFor, parseDoc, optionOf, evaluateOption, headlineView, checksView, storeRefusal } from '../common.js';
import { UNDOABLE_WRITE } from '../annotations.js';
import { PATH_ARG } from '../schema.js';
import { applyChange } from '../../store/change.js';
import { summarize } from '../../store/ops.js';

export default {
  name: 'change_option',
  title: 'Change an option',
  description: 'Set parameters of one option as one change she can undo, with your reason as its name. Answers with what changed and the checks before and after. Check values against the ranges below; never guess one she did not give.',
  inputSchema: {
    type: 'object',
    properties: {
      project: PROJECT_ARG,
      option: OPTION_ARG,
      changes: { type: 'array', minItems: 1, maxItems: 20, items: { type: 'object', properties: { path: PATH_ARG, value: { type: 'number' } }, required: ['path', 'value'], additionalProperties: false } },
      reason: REASON_ARG,
    },
    required: ['option', 'changes', 'reason'],
    additionalProperties: false,
  },
  annotations: UNDOABLE_WRITE,
  async run(ctx, args) {
    const row = await projectFor(ctx, args);
    const doc = parseDoc(row);
    const opt = optionOf(doc, args.option);
    const before = evaluateOption(doc, opt);
    const r = await applyChange(ctx.db, row, { ops: args.changes.map(c => ({ op: 'set', option: opt.id, path: c.path, value: c.value })), actor: 'claude', summary: args.reason });
    if (!r.ok) storeRefusal(r);
    if (r.nothing) return { text: `Nothing changed: ${opt.name} already has those values.`, data: { project: { id: row.id, seq: r.seq }, nothing: true } };
    const what = summarize(doc, r.change.ops);
    const after = evaluateOption(r.doc, r.doc.options.find(o => o.id === opt.id));
    const result = after.ok ? after.headline.text : `The shape cannot be built now: ${after.problems[0]}`;
    return {
      text: `Changed ${opt.name}: ${what}. ${result} ${UNDO_SAY}`,
      data: { project: { id: row.id, seq: r.seq }, change: { seq: r.change.seq, summary: r.change.summary, what }, option: opt.id,
        ok: after.ok, problems: after.problems, before: headlineView(before.headline), after: headlineView(after.headline), checks: checksView(after.checks) },
    };
  },
};
