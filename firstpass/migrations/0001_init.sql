-- 0001_init.sql: First Pass's tables (docs/design.md, Server). Applied with `wrangler d1 migrations apply` at deploy
-- and by scripts/dev-server.mjs and tests/worker/d1-fake.mjs on Node.
--
-- users: one row per person. key_hash and mcp_token_hash are SHA-256 (hex) of the page key (sent as X-Key, given in the
--   link as #k=<key>) and of the connector token (the address /mcp/<token>). The secrets themselves are never stored.
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  mcp_token_hash TEXT UNIQUE,
  created_at INTEGER NOT NULL
);

-- projects: one drawing. doc is the project JSON without id and seq ({name, epsg, site, rules, options}); seq is the
--   number of the last change. Every write goes through src/worker/store/change.js, never straight from a route.
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id),
  doc TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX ix_projects_user ON projects (user_id, updated_at);

-- changes: the change log, one row per change (a change holds one or more ops). seq counts per project from 1.
--   batch_id: made by the sender when it gives one, so a resend is the same change, never a second one.
--   actor: user (the page) or claude (the connector). ops and inverse: JSON lists of resolved ops (store/ops.js).
--   undone: seq of the change that undid this one. undo_of: seq of the change this one undid.
CREATE TABLE changes (
  project_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  batch_id TEXT NOT NULL,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('user', 'claude')),
  summary TEXT NOT NULL,
  ops TEXT NOT NULL,
  inverse TEXT NOT NULL,
  undone INTEGER,
  undo_of INTEGER,
  PRIMARY KEY (project_id, seq)
);
CREATE UNIQUE INDEX ux_changes_batch ON changes (project_id, batch_id);

-- settings: server settings, key and value. debug_capture 'false' turns request traces off (debug/trace.js).
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- bug_reports: one problem report from the page's Report a problem sheet (debug/bugs.js). id: made by the page, so a
--   resend after a dropped connection is the same report. bundle_json: what was open, the last calls and their trace
--   ids, breadcrumbs, errors, versions, the project as the page had it and as the server has it. shot_data: the
--   screenshot as base64 (at most about 1 MB). state: open | fixed | dropped; fix: the commit or pull request.
CREATE TABLE bug_reports (
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  at INTEGER NOT NULL,
  source TEXT NOT NULL,
  page TEXT,
  note TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'fixed', 'dropped')),
  bundle_json TEXT NOT NULL DEFAULT '{}',
  trace_ids TEXT NOT NULL DEFAULT '[]',
  shot_mime TEXT,
  shot_data TEXT,
  fix TEXT,
  closed_at INTEGER,
  PRIMARY KEY (user_id, id)
);
CREATE INDEX ix_bug_reports_state ON bug_reports (user_id, state, at);

-- debug_traces: one API or connector call kept because it failed, ran slow, or a report asked for it (debug/trace.js).
--   id: the W3C trace-id (32 hex, the X-Trace-Id header). user_id: null when the call never got past the key check.
--   route: 'GET /api/projects/:id' or 'mcp <tool>'. trace_json: SQL text only, never bound values. bug_id: pinned to a
--   report and kept while it is open. expires_at: 7 days on.
CREATE TABLE debug_traces (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  route TEXT,
  status INTEGER,
  ms INTEGER,
  why TEXT NOT NULL,
  error TEXT,
  trace_json TEXT NOT NULL,
  bug_id TEXT,
  expires_at INTEGER NOT NULL
);
CREATE INDEX ix_debug_traces_expires ON debug_traces (expires_at);
CREATE INDEX ix_debug_traces_bug ON debug_traces (bug_id) WHERE bug_id IS NOT NULL;
