// applyChange: the one gate for every change to a project, from the page or from Claude (ported in pattern from
// practice-hub's map/change.js and undo.js). It resolves the ops against the project (store/ops.js checks each value
// against the engine's tables), writes the new project, the ops and their exact inverse, and bumps seq, all in one D1
// batch. Undo applies a change's stored inverse as a new change, so an undo can itself be undone (a redo).
//
//   applyChange(db, project, {ops, actor, summary?, base_seq?, batch_id?})
//   undoChange(db, project, {seq?, actor, only_actor?, batch_id?})
//     -> {ok: true, seq, change, doc} | {ok: true, nothing: true, seq, summary, doc} | {ok: false, status, error, conflict?, seq?}
//        undoChange's answer also names the change it undid: undone: {seq, actor, summary}
//   changesSince(db, userId, projectId, since)   the poll: one indexed read; an empty list when nothing is new
//
// project is {id, user_id} (a loaded row works). Two writers at the same moment cannot both win: the change row's key
// (project, seq) is taken first in the batch, so the slower one fails, rolls back, re-reads and tries again.
import { OpError, CHANGED_AGAIN, resolveAndApply, applyResolved, overlaps, summarize } from './ops.js';
import { loadRow, parseDoc, DOC_MAX } from './projects.js';
import { newId, isObj } from '../http.js';

export const ACTORS = ['user', 'claude'];
export const POLL_MAX = 50;          // more changes than this since a poll's seq: the whole project instead
export const HISTORY_MAX = 30;
const TRIES = 4;
const BATCH_ID = /^[A-Za-z0-9_-]{6,64}$/;

const refuse = (status, error, extra = {}) => ({ ok: false, status, error, ...(status === 409 ? { conflict: true } : {}), ...extra });
const isUnique = e => /UNIQUE constraint failed/i.test(String(e && e.message));
const parse = (s, fallback = null) => { try { return JSON.parse(s); } catch { return fallback; } };

/** A change row as the API and the connector hand it out. ops are left out unless asked for. */
export function changeOut(r, { ops = true } = {}) {
  return { seq: r.seq, batch_id: r.batch_id, at: new Date(r.at).toISOString(), actor: r.actor, summary: r.summary,
    ...(ops && r.ops != null ? { ops: parse(r.ops, []) } : {}), undone: r.undone ?? null, undo_of: r.undo_of ?? null };
}

function checkReq(req, { undo = false } = {}) {
  if (!isObj(req)) return 'The change is malformed.';
  if (!ACTORS.includes(req.actor)) return 'Who made the change? actor is user or claude.';
  if (!undo && !Array.isArray(req.ops)) return 'Send the changes as a list in ops.';
  if (req.summary != null && (typeof req.summary !== 'string' || req.summary.length > 300)) return 'summary is a sentence of at most 300 characters.';
  if (req.base_seq != null && (!Number.isInteger(req.base_seq) || req.base_seq < 0)) return 'base_seq is the seq your copy of the project was at.';
  if (req.batch_id != null && (typeof req.batch_id !== 'string' || !BATCH_ID.test(req.batch_id))) return 'The change id must be 6 to 64 letters, digits, dashes or underscores.';
  return null;
}

const cleanSummary = s => String(s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);

async function byBatch(db, projectId, batchId) {
  return db.prepare('SELECT * FROM changes WHERE project_id = ?1 AND batch_id = ?2').bind(projectId, batchId).first();
}

/** One write: the change row first (its key is the lock), then the project, then the undo marks. */
async function commit(db, row, { doc, ops, inverse, actor, summary, batchId, undoOf = null, redoOf = null, now = Date.now() }) {
  const text = JSON.stringify(doc);
  if (text.length > DOC_MAX) return refuse(400, 'The project would be too large to keep. Remove an option first.');
  const seq = row.seq + 1;
  const batch_id = batchId || newId('c_', 16);
  const stmts = [
    db.prepare(`INSERT INTO changes (project_id, seq, batch_id, at, actor, summary, ops, inverse, undone, undo_of)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL, ?9)`).bind(row.id, seq, batch_id, now, actor, summary, JSON.stringify(ops), JSON.stringify(inverse), undoOf),
    db.prepare('UPDATE projects SET doc = ?1, seq = ?2, updated_at = ?3 WHERE id = ?4 AND seq = ?5').bind(text, seq, now, row.id, row.seq),
  ];
  if (undoOf != null) stmts.push(db.prepare('UPDATE changes SET undone = ?1 WHERE project_id = ?2 AND seq = ?3 AND undone IS NULL').bind(seq, row.id, undoOf));
  // A redo (undoing an undo): the change the undo had undone counts as live again, so "undo" can reach it once more.
  if (redoOf != null) stmts.push(db.prepare('UPDATE changes SET undone = NULL WHERE project_id = ?1 AND seq = ?2 AND undone = ?3').bind(row.id, redoOf, undoOf));
  await db.batch(stmts);
  return { ok: true, seq, doc, change: { seq, batch_id, at: new Date(now).toISOString(), actor, summary, ops, undone: null, undo_of: undoOf } };
}

/** Changes after `since`, ops parsed: {ops: [...all their ops], last: summary}, or null when there are more than max. */
async function opsSince(db, projectId, since, max = POLL_MAX) {
  const rows = (await db.prepare('SELECT seq, summary, ops FROM changes WHERE project_id = ?1 AND seq > ?2 ORDER BY seq LIMIT ?3').bind(projectId, since, max + 1).all()).results || [];
  if (rows.length > max) return null;
  return { ops: rows.flatMap(r => parse(r.ops, [])), last: rows.length ? rows[rows.length - 1].summary : null };
}

/** Applies one change of ops to the project. See the file's head for the answer's shape. */
export async function applyChange(db, project, req) {
  const bad = checkReq(req);
  if (bad) return refuse(400, bad);
  for (let attempt = 0; attempt < TRIES; attempt++) {
    const row = await loadRow(db, project.user_id, project.id);
    if (!row) return refuse(404, 'There is no project with that id.');
    if (req.batch_id) {
      const prev = await byBatch(db, row.id, req.batch_id);
      if (prev) return { ok: true, replay: true, seq: row.seq, change: changeOut(prev), doc: parseDoc(row) };
    }
    const doc = parseDoc(row);
    let r;
    try { r = resolveAndApply(doc, req.ops); } catch (e) {
      if (e instanceof OpError) return refuse(e.conflict ? 409 : 400, e.message, e.conflict ? { seq: row.seq } : {});
      throw e;
    }
    if (!r.ops.length) return { ok: true, nothing: true, seq: row.seq, summary: 'Nothing changed: the drawing already has those values.', doc };
    if (req.base_seq != null && req.base_seq < row.seq) {
      const since = await opsSince(db, row.id, req.base_seq);
      if (!since || overlaps(since.ops, r.ops)) {
        const what = since && since.last ? ` ("${since.last}")` : '';
        return refuse(409, `That part was changed meanwhile${what}. Bring the drawing up to date and make the change again.`, { seq: row.seq });
      }
    }
    const summary = req.summary && cleanSummary(req.summary) ? cleanSummary(req.summary) : summarize(doc, r.ops);
    try {
      return await commit(db, row, { doc: r.doc, ops: r.ops, inverse: r.inverse, actor: req.actor, summary, batchId: req.batch_id });
    } catch (e) {
      if (isUnique(e)) continue;   // another change took this seq (or this batch id) first: read again
      throw e;
    }
  }
  return refuse(409, 'Several changes arrived at the same moment. Send it once more.');
}

/** The change an undo took back, as its answer names it: {seq, actor, summary}. */
const undoneOf = c => ({ seq: c.seq, actor: c.actor, summary: c.summary });

/**
 * Undoes one change by applying its stored inverse as a new change. seq: that change; without it, the newest change
 * that is neither undone nor an undo (only_actor: only that actor's, as the connector's undo does for Claude's own).
 */
export async function undoChange(db, project, req = {}) {
  const bad = checkReq(req, { undo: true });
  if (bad) return refuse(400, bad);
  if (req.seq != null && (!Number.isInteger(req.seq) || req.seq < 1)) return refuse(400, 'seq is the number of a change in the history.');
  for (let attempt = 0; attempt < TRIES; attempt++) {
    const row = await loadRow(db, project.user_id, project.id);
    if (!row) return refuse(404, 'There is no project with that id.');
    if (req.batch_id) {
      const prev = await byBatch(db, row.id, req.batch_id);
      if (prev) {
        const was = prev.undo_of != null ? await db.prepare('SELECT seq, actor, summary FROM changes WHERE project_id = ?1 AND seq = ?2').bind(row.id, prev.undo_of).first() : null;
        return { ok: true, replay: true, seq: row.seq, change: changeOut(prev), doc: parseDoc(row), ...(was ? { undone: undoneOf(was) } : {}) };
      }
    }
    let target;
    if (req.seq != null) {
      target = await db.prepare('SELECT * FROM changes WHERE project_id = ?1 AND seq = ?2').bind(row.id, req.seq).first();
      if (!target) return refuse(404, 'No change has that number.');
    } else {
      const who = ACTORS.includes(req.only_actor) ? req.only_actor : null;
      target = await db.prepare(`SELECT * FROM changes WHERE project_id = ?1 AND undone IS NULL AND undo_of IS NULL
        AND (?2 IS NULL OR actor = ?2) ORDER BY seq DESC LIMIT 1`).bind(row.id, who).first();
      if (!target) return refuse(400, who === 'claude' ? 'There is no change of Claude\'s left to undo.' : 'There is nothing to undo.');
    }
    if (target.undone != null) return refuse(409, `"${target.summary}" was already undone.`, { seq: row.seq });
    const ops = parse(target.inverse, null);
    if (!Array.isArray(ops)) throw new Error(`change ${target.seq} of ${row.id} has no inverse`);
    let doc;
    try { doc = applyResolved(parseDoc(row), ops); } catch (e) {
      if (e instanceof OpError) return refuse(409, CHANGED_AGAIN, { seq: row.seq });
      throw e;
    }
    const redo = target.undo_of != null;
    // Undoing an undo puts the change back (Redo); undoing a redo takes it away again (Undo).
    const base = target.summary.replace(/^(Undo|Redo): /, '');
    const summary = (redo && target.summary.startsWith('Undo: ') ? `Redo: ${base}` : `Undo: ${base}`).slice(0, 300);
    try {
      const r = await commit(db, row, { doc, ops, inverse: parse(target.ops, []), actor: req.actor, summary, batchId: req.batch_id,
        undoOf: target.seq, redoOf: redo ? target.undo_of : null });
      return r.ok ? { ...r, undone: undoneOf(target) } : r;
    } catch (e) {
      if (isUnique(e)) continue;
      throw e;
    }
  }
  return refuse(409, 'Several changes arrived at the same moment. Send it once more.');
}

/**
 * The poll: what changed after `since`, in one indexed read. Answers
 *   {seq, changes: []}                       nothing new (the usual answer, every 1.5 s)
 *   {seq, changes: [...], project_doc}       the new changes with their ops, and the project as it now stands
 *   {seq, reset: true, changes: [], project_doc}  too many to list, or since is ahead of the project: take the whole project
 * or null when the project is not this user's.
 */
export async function changesSince(db, userId, projectId, since) {
  if (typeof projectId !== 'string' || !projectId || projectId.length > 64) return null;
  const rows = (await db.prepare(`SELECT p.seq AS head, CASE WHEN c.seq = p.seq THEN p.doc END AS doc,
      c.seq, c.batch_id, c.at, c.actor, c.summary, c.ops, c.undone, c.undo_of
    FROM projects p LEFT JOIN changes c ON c.project_id = p.id AND c.seq > ?2
    WHERE p.id = ?1 AND p.user_id = ?3 ORDER BY c.seq LIMIT ?4`).bind(projectId, since, userId, POLL_MAX + 1).all()).results || [];
  if (!rows.length) return null;
  const head = rows[0].head;
  if (since === head) return { seq: head, changes: [] };
  const changes = rows.filter(r => r.seq != null);
  const last = changes[changes.length - 1];
  if (since > head || changes.length > POLL_MAX || !last || last.doc == null) {
    const doc = await db.prepare('SELECT doc FROM projects WHERE id = ?1 AND user_id = ?2').bind(projectId, userId).first('doc');
    return { seq: head, reset: true, changes: [], project_doc: doc };
  }
  return { seq: head, changes: changes.map(r => changeOut(r)), project_doc: last.doc };
}

/** The newest changes, newest first, without their ops (the history list). */
export async function history(db, projectId, limit = HISTORY_MAX) {
  const rows = (await db.prepare('SELECT seq, batch_id, at, actor, summary, undone, undo_of FROM changes WHERE project_id = ?1 ORDER BY seq DESC LIMIT ?2')
    .bind(projectId, Math.min(Math.max(1, limit), 100)).all()).results || [];
  return rows.map(r => changeOut(r, { ops: false }));
}
