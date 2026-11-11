// Connector tool add_option: a new option beside the others, as a copy of one (from) or the standard roundabout, as one
// change she can undo. Variants are tried this way so the original stays as it was.
import { PROJECT_ARG, REASON_ARG, UNDO_SAY, projectFor, parseDoc, evaluateOption, headlineView, storeRefusal } from '../common.js';
import { UNDOABLE_WRITE } from '../annotations.js';
import { applyChange } from '../../store/change.js';

export default {
  name: 'add_option',
  title: 'Add an option',
  description: 'Add an option to compare: a copy of option `from`, or the standard four-leg roundabout. Then change the copy with change_option. Answers with its id.',
  inputSchema: {
    type: 'object',
    properties: {
      project: PROJECT_ARG,
      from: { type: 'string', maxLength: 8, description: 'Option id to copy, such as "A".' },
      name: { type: 'string', maxLength: 60, description: 'Its name; default "Option <id>".' },
      reason: REASON_ARG,
    },
    required: ['reason'],
    additionalProperties: false,
  },
  annotations: UNDOABLE_WRITE,
  async run(ctx, args) {
    const row = await projectFor(ctx, args);
    const doc = parseDoc(row);
    const op = { op: 'add_option', ...(args.from != null ? { from: args.from } : {}), ...(args.name != null ? { name: args.name } : {}) };
    const r = await applyChange(ctx.db, row, { ops: [op], actor: 'claude', summary: args.reason });
    if (!r.ok) storeRefusal(r);
    const added = r.change.ops[0].option;
    const from = args.from != null ? doc.options.find(o => o.id === args.from) : null;
    const ev = evaluateOption(r.doc, r.doc.options.find(o => o.id === added.id));
    return {
      text: `Added ${added.name} (${added.id})${from ? ` as a copy of ${from.name}` : ', the standard four-leg roundabout'}. ${ev.ok ? ev.headline.text : ''} ${UNDO_SAY}`.replace(/\s+/g, ' ').trim(),
      data: { project: { id: row.id, seq: r.seq }, change: { seq: r.change.seq, summary: r.change.summary }, option: { id: added.id, name: added.name }, headline: headlineView(ev.headline) },
    };
  },
};
