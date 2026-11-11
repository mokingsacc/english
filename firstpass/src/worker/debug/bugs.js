// Problem reports (ported from practice-hub's debug/bugs.js). The page's Report a problem sheet (public/js/shared/
// report-sheet.js) sends one bundle here; Claude Code reads it with the connector's bugs tool (mcp/tools/bugs.js) and
// closes it once fixed (claude/skills/fix-bugs/SKILL.md). Nothing here calls any AI.
//
//   POST /api/bugs              {id (made by the page, so a resend is the same report), note, page, state, calls, crumbs,
//                                errors, app, shot?: {mime, data (base64)}, extra?} -> {id, duplicate, traces}
//   GET  /api/bugs?state=open   the reports, short (bugList)
//   GET  /api/bugs/:id          one report: its bundle, the traces it names, shot url (bugGet)
//   GET  /api/bugs/:id/shot     the screenshot itself
//   POST /api/bugs/:id/close    {fix, state?: fixed | dropped}
//
// What the server adds: the build and commit, and for the open project (state.project_id) the project as the server
// holds it and its last 10 changes, so a geometry problem replays as a test fixture. The page's own copy of the project
// (state.project, from window.fpState()) is kept whole in bundle.project. Each named call's trace is pinned to the report.
// Scrubbed before it is stored: no header, key, token, cookie or password field; addresses lose their query string, the
// link's #k= key and the connector's token.
import { HttpError, json, readJson } from '../http.js';
import { BUILD } from '../version.js';
import { fromRing, persistTrace, rawDb, TRACE_ID_RE } from './trace.js';
import { history } from '../store/change.js';

export const BUG = { noteMax: 2000, pageMax: 200, callsMax: 30, crumbsMax: 30, errorsMax: 10, bundleMax: 64_000, projectMax: 400_000,
  shotMax: 1_000_000, listMax: 30, strMax: 2000, tracesMax: 12 };
export const SOURCES = ['page', 'claude'];
export const SHOT_MIMES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const SECRET_KEY = /^(authorization|cookie|set-cookie|x-key|key|fp-key|fp\.key|token|mcp_token|password|passphrase|secret|api_key|apikey|bearer)$/i;
const noTable = e => /no such table|no such column/i.test(String(e && e.message));

/** An address without its query string, its #k= key or the connector's token. */
export function cleanUrl(u) {
  const s = String(u || '').slice(0, 400);
  return s.replace(/([#&])k=[^&]*/g, '$1k=<key>').replace(/\?[^#]*/, '').replace(/\/mcp\/[A-Za-z0-9_-]{16,}/g, '/mcp/<token>');
}

/** The bundle scrubbed (pure): secret-named fields dropped, addresses cleaned, strings cut. */
export function scrubBundle(v, depth = 0, key = '') {
  if (depth > 14) return null;
  if (typeof v === 'string') {
    let s = /url|href|^u$|^page$|^to$/i.test(key) ? cleanUrl(v) : v.replace(/([#&])k=[A-Za-z0-9_-]{16,}/g, '$1k=<key>').replace(/\/mcp\/[A-Za-z0-9_-]{16,}/g, '/mcp/<token>');
    if (s.length > BUG.strMax) s = `${s.slice(0, BUG.strMax - 1)}…`;
    return s;
  }
  if (v == null || typeof v === 'number' || typeof v === 'boolean') return v ?? null;
  if (Array.isArray(v)) return v.slice(0, 60).map(x => scrubBundle(x, depth + 1, key));
  if (typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v).slice(0, 80)) if (!SECRET_KEY.test(k)) out[k] = scrubBundle(x, depth + 1, k);
    return out;
  }
  return null;
}

/** The trace ids a bundle names (each call's id, trace_id or retrace_id), unique, at most BUG.tracesMax. */
export function traceIdsOf(bundle) {
  const ids = new Set();
  for (const c of [...(bundle.calls || []), ...(bundle.extra && Array.isArray(bundle.extra.calls) ? bundle.extra.calls : [])]) {
    for (const k of ['id', 'trace_id', 'retrace_id']) if (c && TRACE_ID_RE.test(String(c[k] || ''))) ids.add(String(c[k]));
  }
  return [...ids].slice(-BUG.tracesMax);
}

const list = (v, max) => (Array.isArray(v) ? v.slice(-max) : []);

/** The versions a report carries: the build and the commit when the deploy set one. */
export function versionsOf(env = {}) {
  return { build: BUILD, commit: env.GIT_COMMIT ? String(env.GIT_COMMIT).slice(0, 40) : null };
}

/** The report as stored (pure apart from the versions): {row, bundle, shot}. Throws HttpError(400) on a bad report. */
export function reportOf(body, env = {}, now = Date.now()) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Nothing to report.');
  const id = String(body.id || '');
  if (!ID_RE.test(id)) throw new HttpError(400, 'A report needs its id.');
  const source = SOURCES.includes(body.source) ? body.source : 'page';
  const note = String(body.note || '').trim().slice(0, BUG.noteMax);
  const shot = body.shot && typeof body.shot === 'object' ? body.shot : null;
  if (!note && !shot) throw new HttpError(400, 'Say what went wrong, or add a screenshot.');
  const state = body.state && typeof body.state === 'object' && !Array.isArray(body.state) ? { ...body.state } : {};
  const pageProject = state.project && typeof state.project === 'object' ? state.project : null;
  delete state.project;
  const bundle = scrubBundle({
    page: String(body.page || '').slice(0, BUG.pageMax), state,
    calls: list(body.calls, BUG.callsMax), crumbs: list(body.crumbs, BUG.crumbsMax), errors: list(body.errors, BUG.errorsMax),
    app: body.app && typeof body.app === 'object' ? body.app : {}, extra: body.extra && typeof body.extra === 'object' ? body.extra : null,
  });
  bundle.server = versionsOf(env);
  // Held under bundleMax (the project is counted apart): the oldest breadcrumbs go first, then the calls' error texts.
  while (JSON.stringify(bundle).length > BUG.bundleMax && bundle.crumbs.length) bundle.crumbs.shift();
  if (JSON.stringify(bundle).length > BUG.bundleMax) bundle.calls = bundle.calls.map(c => ({ ...c, sum: undefined }));
  if (JSON.stringify(bundle).length > BUG.bundleMax) { bundle.state = { project_id: state.project_id ?? null }; bundle.extra = null; }
  if (pageProject) {
    const p = scrubBundle(pageProject);
    bundle.project = JSON.stringify(p).length <= BUG.projectMax ? p : { left_out: 'The page sent a project too large to keep.' };
  }
  return { row: { id, at: now, source, page: bundle.page || null, note }, bundle, shot };
}

/** The open project as the server holds it, and its last 10 changes (nothing when it cannot be read). */
export async function projectContext(db, user, projectId) {
  if (!projectId || typeof projectId !== 'string' || projectId.length > 64) return null;
  try {
    const raw = rawDb(db);
    const row = await raw.prepare('SELECT id, doc, seq, updated_at FROM projects WHERE id = ?1 AND user_id = ?2').bind(projectId, user).first();
    if (!row) return { project_id: projectId, error: 'not found for this user' };
    const doc = JSON.parse(row.doc);
    return { project_id: row.id, seq: row.seq, updated_at: new Date(row.updated_at).toISOString(), doc, changes: await history(raw, row.id, 10) };
  } catch (e) {
    return { project_id: projectId, error: String(e && e.message).slice(0, 160) };
  }
}

function checkShot(shot) {
  const mime = SHOT_MIMES[shot.mime] ? shot.mime : null;
  const data = typeof shot.data === 'string' ? shot.data.replace(/^data:[^,]*,/, '') : '';
  if (!mime || !data || data.length > BUG.shotMax || !B64_RE.test(data)) throw new HttpError(400, 'That screenshot is not a JPEG, PNG or WebP picture under about 700 KB.');
  return { mime, data };
}

/** Pins the named traces to the report: saved ones by bug_id, unsaved ones from this isolate's ring. Never throws. */
export async function pinTraces(db, user, bugId, ids) {
  if (!ids.length) return 0;
  try {
    const raw = rawDb(db);
    await raw.prepare('UPDATE debug_traces SET bug_id = ?1 WHERE user_id = ?2 AND id IN (SELECT value FROM json_each(?3))').bind(bugId, user, JSON.stringify(ids)).run();
    const have = new Set(((await raw.prepare('SELECT id FROM debug_traces WHERE user_id = ?1 AND id IN (SELECT value FROM json_each(?2))').bind(user, JSON.stringify(ids)).all()).results || []).map(r => r.id));
    let added = 0;
    for (const id of ids) {
      if (have.has(id)) continue;
      const t = fromRing(id);
      if (t && t.user === user && (await persistTrace(raw, t, 'report', { bugId }))) added++;
    }
    return have.size + added;
  } catch (e) {
    if (!noTable(e)) console.error('bug traces not pinned', e && e.message);
    return 0;
  }
}

/** Stores one report (idempotent on its id). */
export async function saveReport(env, user, body, { now = Date.now() } = {}) {
  const { row, bundle, shot } = reportOf(body, env, now);
  const db = rawDb(env.DB);
  const had = await db.prepare('SELECT id FROM bug_reports WHERE user_id = ?1 AND id = ?2').bind(user, row.id).first();
  if (had) return { id: row.id, duplicate: true };
  const s = shot ? checkShot(shot) : { mime: null, data: null };
  const pid = bundle.state && bundle.state.project_id;
  if (pid) {
    bundle.server_project = await projectContext(db, user, String(pid));
    // One copy when the page's project is the server's.
    if (bundle.project && bundle.server_project && bundle.server_project.doc
      && JSON.stringify(bundle.server_project.doc) === JSON.stringify(Object.fromEntries(Object.entries(bundle.project).filter(([k]) => !['id', 'seq', 'updated_at'].includes(k))))) {
      bundle.project = { same_as_server_project: true };
    }
  }
  const ids = traceIdsOf(bundle);
  const res = await db.prepare(`INSERT INTO bug_reports (user_id, id, at, source, page, note, state, bundle_json, trace_ids, shot_mime, shot_data)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'open', ?7, ?8, ?9, ?10) ON CONFLICT (user_id, id) DO NOTHING`)
    .bind(user, row.id, row.at, row.source, row.page, row.note, JSON.stringify(bundle), JSON.stringify(ids), s.mime, s.data).run();
  if (!(res && res.meta && Number(res.meta.changes))) return { id: row.id, duplicate: true };
  const traces = await pinTraces(db, user, row.id, ids);
  return { id: row.id, duplicate: false, traces };
}

const safeLen = t => { try { return JSON.parse(t || '[]').length; } catch { return 0; } };

/** The reports, newest first, short: {open, reports: [{id, at, source, page, note, shot, traces, state, fix}]}. */
export async function bugList(env, user, { state = 'open', limit = BUG.listMax } = {}) {
  const st = ['open', 'fixed', 'dropped', 'all'].includes(state) ? state : 'open';
  const db = rawDb(env.DB);
  const rows = (await db.prepare(`SELECT id, at, source, page, note, state, fix, trace_ids, shot_data IS NOT NULL AS shot
    FROM bug_reports WHERE user_id = ?1 AND (?2 = 'all' OR state = ?2) ORDER BY at DESC LIMIT ?3`).bind(user, st, Math.min(Math.max(1, Number(limit) || BUG.listMax), 100)).all()).results || [];
  const open = await db.prepare(`SELECT count(*) AS n FROM bug_reports WHERE user_id = ?1 AND state = 'open'`).bind(user).first('n');
  return { open: Number(open) || 0, reports: rows.map(r => ({ id: r.id, at: new Date(r.at).toISOString(), source: r.source, page: r.page,
    note: String(r.note || '').slice(0, 160), shot: !!r.shot, traces: safeLen(r.trace_ids), state: r.state, ...(r.fix ? { fix: r.fix } : {}) })) };
}

/** One report in full: its bundle, the traces pinned to it (each with its route), the screenshot's address. */
export async function bugGet(env, user, id, { origin = null } = {}) {
  const db = rawDb(env.DB);
  const r = await db.prepare('SELECT * FROM bug_reports WHERE user_id = ?1 AND id = ?2').bind(user, String(id || '')).first();
  if (!r) throw new HttpError(404, 'There is no report with that id.');
  let bundle = {};
  try { bundle = JSON.parse(r.bundle_json || '{}'); } catch { bundle = {}; }
  const traces = ((await db.prepare(`SELECT id, at, kind, route, status, ms, why, error, trace_json FROM debug_traces WHERE user_id = ?3 AND (bug_id = ?1
      OR id IN (SELECT value FROM json_each(?2))) ORDER BY at`).bind(r.id, r.trace_ids || '[]', user).all().catch(() => ({ results: [] }))).results || [])
    .map(t => { let j = null; try { j = JSON.parse(t.trace_json); } catch { j = null; } return { id: t.id, at: new Date(t.at).toISOString(), kind: t.kind, route: t.route, status: t.status, ms: t.ms, why: t.why, error: t.error, trace: j }; });
  let want = [];
  try { want = JSON.parse(r.trace_ids || '[]'); } catch { want = []; }
  return { id: r.id, at: new Date(r.at).toISOString(), source: r.source, page: r.page, note: r.note, state: r.state, fix: r.fix || null,
    closed_at: r.closed_at ? new Date(r.closed_at).toISOString() : null, bundle, traces, missing_traces: want.filter(x => !traces.some(t => t.id === x)),
    shot: r.shot_data ? { mime: r.shot_mime, url: `${origin || ''}/api/bugs/${encodeURIComponent(r.id)}/shot` } : null };
}

/** The screenshot's bytes and type, or null. */
export async function shotOf(env, user, id) {
  const r = await rawDb(env.DB).prepare('SELECT shot_mime, shot_data FROM bug_reports WHERE user_id = ?1 AND id = ?2').bind(user, String(id || '')).first();
  if (!r || !r.shot_data) return null;
  const bin = atob(r.shot_data), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { mime: r.shot_mime || 'image/jpeg', bytes, base64: r.shot_data };
}

/** Marks a report fixed (or dropped) with the commit or pull request that fixed it. */
export async function bugClose(env, user, id, { fix = '', state = 'fixed', now = Date.now() } = {}) {
  const st = state === 'dropped' ? 'dropped' : 'fixed';
  const f = String(fix || '').trim().slice(0, 300);
  if (st === 'fixed' && !f) throw new HttpError(400, 'Say what fixed it: the commit or the pull request.');
  const db = rawDb(env.DB);
  const r = await db.prepare('SELECT id, state FROM bug_reports WHERE user_id = ?1 AND id = ?2').bind(user, String(id || '')).first();
  if (!r) throw new HttpError(404, 'There is no report with that id.');
  await db.prepare('UPDATE bug_reports SET state = ?1, fix = ?2, closed_at = ?3 WHERE user_id = ?4 AND id = ?5').bind(st, f || null, now, user, r.id).run();
  return { id: r.id, state: st, fix: f || null, was: r.state };
}

// ---------------------------------------------------------------- routes

async function report(request, env, ctx, params, url, user) {
  const body = await readJson(request, BUG.shotMax + BUG.bundleMax * 2 + BUG.projectMax + 20_000);
  return json(await saveReport(env, user.id, body));
}
async function listRoute(request, env, ctx, params, url, user) {
  return json(await bugList(env, user.id, { state: url.searchParams.get('state') || 'open', limit: url.searchParams.get('limit') }));
}
async function getRoute(request, env, ctx, params, url, user) {
  return json(await bugGet(env, user.id, params.id, { origin: url.origin }));
}
async function shotRoute(request, env, ctx, params, url, user) {
  const s = await shotOf(env, user.id, params.id);
  if (!s) throw new HttpError(404, 'That report has no screenshot.');
  return new Response(s.bytes, { headers: { 'Content-Type': s.mime, 'Cache-Control': 'no-store' } });
}
async function closeRoute(request, env, ctx, params, url, user) {
  const body = await readJson(request);
  return json(await bugClose(env, user.id, params.id, { fix: body.fix, state: body.state }));
}

export const routes = [
  { method: 'POST', pattern: '/api/bugs', handler: report },
  { method: 'GET', pattern: '/api/bugs', handler: listRoute },
  { method: 'GET', pattern: '/api/bugs/:id', handler: getRoute },
  { method: 'GET', pattern: '/api/bugs/:id/shot', handler: shotRoute },
  { method: 'POST', pattern: '/api/bugs/:id/close', handler: closeRoute },
];
