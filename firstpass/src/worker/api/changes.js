// Change routes: the page's changes, the 1.5 s poll, and undo. Every write goes through store/change.js.
//   POST /api/projects/:id/changes {ops, summary?, base_seq?, id?}  -> {ok, seq, change, project} | {ok, nothing, seq, summary}
//                                   400 {error} bad value, 404 {error}, 409 {error, conflict, seq} changed meanwhile
//   GET  /api/projects/:id/changes?since=<seq>  -> {seq, changes: []} | {seq, changes: [...], project} | {seq, reset, changes: [], project}
//   POST /api/projects/:id/undo {seq?, id?}     -> as POST changes, plus undone: {seq, actor, summary} (the change it took
//                                                back); without seq, the newest change by anyone not yet undone
import { json, readJson, HttpError } from '../http.js';
import { applyChange, undoChange, changesSince } from '../store/change.js';

/** The HTTP answer for an applyChange or undoChange result. */
export function changeAnswer(r, projectId) {
  if (!r.ok) return json({ error: r.error, ...(r.conflict ? { conflict: true } : {}), ...(r.seq != null ? { seq: r.seq } : {}) }, r.status || 400);
  if (r.nothing) return json({ ok: true, nothing: true, seq: r.seq, summary: r.summary });
  return json({ ok: true, ...(r.replay ? { replay: true } : {}), seq: r.seq, change: r.change, ...(r.undone ? { undone: r.undone } : {}),
    project: { id: projectId, ...r.doc, seq: r.seq } });
}

async function post(request, env, ctx, params, url, user) {
  const body = await readJson(request, 500_000);
  const r = await applyChange(env.DB, { id: params.id, user_id: user.id },
    { ops: body.ops, actor: 'user', summary: body.summary, base_seq: body.base_seq, batch_id: body.id ?? body.batch_id });
  return changeAnswer(r, params.id);
}

async function poll(request, env, ctx, params, url, user) {
  const s = url.searchParams.get('since');
  const since = s == null || s === '' ? NaN : Number(s);
  if (!Number.isInteger(since) || since < 0) throw new HttpError(400, 'Say which change you have: ?since=<seq>.');
  const r = await changesSince(env.DB, user.id, params.id, since);
  if (!r) throw new HttpError(404, 'There is no project with that id.');
  if (!r.project_doc) return json({ seq: r.seq, changes: r.changes });
  const project = { id: params.id, ...JSON.parse(r.project_doc), seq: r.seq };
  return json({ seq: r.seq, ...(r.reset ? { reset: true } : {}), changes: r.changes, project });
}

async function undo(request, env, ctx, params, url, user) {
  const body = await readJson(request, 10_000);
  const r = await undoChange(env.DB, { id: params.id, user_id: user.id }, { seq: body.seq, actor: 'user', batch_id: body.id ?? body.batch_id });
  return changeAnswer(r, params.id);
}

export const routes = [
  { method: 'POST', pattern: '/api/projects/:id/changes', handler: post },
  { method: 'GET', pattern: '/api/projects/:id/changes', handler: poll },
  { method: 'POST', pattern: '/api/projects/:id/undo', handler: undo },
];
