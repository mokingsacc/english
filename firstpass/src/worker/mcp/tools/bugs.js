// Connector tool bugs: her problem reports, for Claude Code's fix loop (claude/skills/fix-bugs/SKILL.md). One tool for
// the three actions (as practice-hub's hub_bugs): list, get {id} (the report in full and its screenshot as an image),
// close {id, fix} (or state dropped with a reason in fix).
import { READ_ONLY } from '../annotations.js';
import { refuse } from '../common.js';
import { bugList, bugGet, bugClose, shotOf } from '../../debug/bugs.js';

const SHOT_INLINE_MAX = 1_400_000;

export default {
  name: 'bugs',
  title: 'Problem reports',
  description: 'Her problem reports (fix-bugs skill). list {state?}; get {id}: the report in full (traces, the project) and its screenshot; close {id, fix: commit or PR link}, or state "dropped" with the reason in fix.',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'get', 'close'] },
      id: { type: 'string', maxLength: 64 },
      fix: { type: 'string', maxLength: 300 },
      state: { type: 'string', enum: ['open', 'fixed', 'dropped', 'all'] },
    },
    required: ['action'],
    additionalProperties: false,
  },
  annotations: { ...READ_ONLY, readOnlyHint: false, destructiveHint: false },
  async run(ctx, args) {
    const env = { DB: ctx.db };
    if (args.action === 'list') {
      const r = await bugList(env, ctx.user.id, { state: args.state || 'open' });
      return { text: `${r.open} open report${r.open === 1 ? '' : 's'}; ${r.reports.length} listed.`, data: r };
    }
    if (!args.id) refuse('Give the report id.');
    if (args.action === 'close') {
      const r = await bugClose(env, ctx.user.id, args.id, { fix: args.fix, state: args.state === 'dropped' ? 'dropped' : 'fixed' });
      return { text: `Report ${r.id} is now ${r.state}.`, data: r };
    }
    const r = await bugGet(env, ctx.user.id, args.id, { origin: ctx.origin });
    const extra = [];
    if (r.shot) {
      const s = await shotOf(env, ctx.user.id, r.id).catch(() => null);
      if (s && s.base64.length <= SHOT_INLINE_MAX) extra.push({ type: 'image', data: s.base64, mimeType: s.mime });
    }
    return { text: `Report ${r.id} (${r.state}) on ${r.page || 'an unknown page'}: "${r.note || 'a screenshot, no words'}". ${r.traces.length} trace${r.traces.length === 1 ? '' : 's'}.`, data: r, content: extra };
  },
};
