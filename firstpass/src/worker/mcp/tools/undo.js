// Connector tool undo: undoes Claude's own newest change (or the change with the seq given, hers too), as a new change,
// so the undo can itself be undone by its seq (a redo).
import { PROJECT_ARG, projectFor, storeRefusal } from '../common.js';
import { UNDOABLE_WRITE } from '../annotations.js';
import { undoChange } from '../../store/change.js';

export default {
  name: 'undo',
  title: 'Undo a change',
  description: 'Undo your newest change, or the change with this seq (get_project lists them, hers too). To put an undone change back, undo the undo by its seq. Its step name is "Undo: <the change>".',
  inputSchema: {
    type: 'object',
    properties: { project: PROJECT_ARG, seq: { type: 'integer', minimum: 1, description: 'The change to undo.' } },
    additionalProperties: false,
  },
  annotations: UNDOABLE_WRITE,
  async run(ctx, args) {
    const row = await projectFor(ctx, args);
    const r = await undoChange(ctx.db, row, { seq: args.seq, actor: 'claude', only_actor: args.seq == null ? 'claude' : null });
    if (!r.ok) storeRefusal(r);
    return {
      text: `${r.change.summary} (change ${r.change.undo_of}). To put it back, call undo with seq ${r.change.seq}.`,
      data: { project: { id: row.id, seq: r.seq }, change: { seq: r.change.seq, summary: r.change.summary, undo_of: r.change.undo_of } },
    };
  },
};
