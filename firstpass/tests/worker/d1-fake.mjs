// A D1 binding on node:sqlite, for Worker tests and the dev server without wrangler (ported from practice-hub).
// It follows the D1 Worker API the server uses: prepare().bind().first(col?) / all() / run() / raw(), batch() as one
// transaction, exec(). It counts queries the way Cloudflare does (a batch is one query) so a test can hold a route to a
// budget, and refuses what D1 refuses (more than 100 bound values, undefined or object values).
//
//   const { env, DB, stats } = createD1();                     // in memory, every migration applied
//   const { DB } = createD1({ file: '.dev/dev.sqlite' });       // on disk, only the migrations not applied yet
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const MIGRATIONS_DIR = path.join(ROOT, 'migrations');
export const D1_BIND_MAX = 100;

/** The migration files in apply order. */
export function migrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR).filter(f => /^\d{4}_.+\.sql$/.test(f)).sort().map(f => path.join(MIGRATIONS_DIR, f));
}

// D1 refuses undefined and plain objects; booleans go in as 1 and 0.
function toSql(v, i) {
  if (v === undefined) throw new Error(`D1_TYPE_ERROR: Type 'undefined' not supported for value 'undefined' (parameter ${i + 1})`);
  if (v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'bigint') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  throw new Error(`D1_TYPE_ERROR: Type '${typeof v}' not supported for value '${String(v)}' (parameter ${i + 1})`);
}

const plain = row => (row ? { ...row } : row);
const d1Error = e => Object.assign(new Error(`D1_ERROR: ${e.message}`), { cause: e });

class Statement {
  constructor(d1, sql, params = []) { this.d1 = d1; this.sql = sql; this.params = params; }
  bind(...values) {
    if (values.length > D1_BIND_MAX) throw new Error(`D1_ERROR: too many SQL variables (${values.length} > ${D1_BIND_MAX}): SQLITE_ERROR`);
    return new Statement(this.d1, this.sql, values.map(toSql));
  }
  _prepared() {
    try { return this.d1.db.prepare(this.sql); } catch (e) { throw d1Error(e); }
  }
  _all() {
    const st = this._prepared();
    try {
      if (st.columns().length === 0) {
        const r = st.run(...this.params);
        return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid), rows_read: 0, rows_written: Number(r.changes), duration: 0 } };
      }
      const results = st.all(...this.params).map(plain);
      return { results, success: true, meta: { changes: 0, last_row_id: 0, rows_read: results.length, rows_written: 0, duration: 0 } };
    } catch (e) { throw d1Error(e); }
  }
  async first(col) {
    this.d1.count(1);
    const r = this._all().results[0];
    if (r === undefined) return null;
    if (col === undefined) return r;
    if (!(col in r)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${col})`);
    return r[col];
  }
  async all() { this.d1.count(1); return this._all(); }
  async run() { this.d1.count(1); return this._all(); }
  async raw({ columnNames = false } = {}) {
    this.d1.count(1);
    const { results } = this._all();
    const rows = results.map(r => Object.values(r));
    if (columnNames) rows.unshift(this._prepared().columns().map(c => c.name));
    return rows;
  }
}

export class FakeD1 {
  constructor(db, stats) { this.db = db; this.stats = stats; }
  count(n) {
    this.stats.queries += n;
    if (this.stats.limit && this.stats.queries > this.stats.limit) {
      throw new Error(`Too many API requests by single worker invocation (${this.stats.queries} > ${this.stats.limit})`);
    }
  }
  prepare(sql) { return new Statement(this, sql); }
  // One transaction: every statement or none. One query against the budget, as on Cloudflare.
  async batch(statements) {
    if (!Array.isArray(statements)) throw new Error('D1_ERROR: batch() needs a list of statements');
    this.count(1);
    this.stats.batches++;
    this.db.exec('BEGIN');
    try {
      const out = statements.map(s => s._all());
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  async exec(sql) {
    this.count(1);
    try { this.db.exec(sql); } catch (e) { throw d1Error(e); }
    return { count: sql.split(';').filter(s => s.trim()).length, duration: 0 };
  }
}

/** Applies the migrations this database has not had yet (tracked in d1_migrations, as wrangler does). Returns their names. */
export function applyMigrations(db) {
  db.exec('CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT NOT NULL)');
  const done = new Set(db.prepare('SELECT name FROM d1_migrations').all().map(r => r.name));
  const applied = [];
  for (const file of migrationFiles()) {
    const name = path.basename(file);
    if (done.has(name)) continue;
    db.exec('BEGIN');
    try {
      db.exec(fs.readFileSync(file, 'utf8'));
      db.prepare('INSERT INTO d1_migrations (name, applied_at) VALUES (?, ?)').run(name, new Date().toISOString());
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${name} failed: ${e.message}`);
    }
    applied.push(name);
  }
  return applied;
}

/**
 * A D1. Options: file (a path; default in memory), migrations (default true), sql (extra SQL after them),
 * limit (throw like Cloudflare past this many queries), vars (extra env fields).
 * Returns {env, DB, db (the raw DatabaseSync), stats, run, rows, row, close}.
 */
export function createD1({ file = ':memory:', migrations = true, sql = '', limit = 0, vars = {} } = {}) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (migrations) applyMigrations(db);
  if (sql) db.exec(sql);
  const stats = { queries: 0, batches: 0, limit, reset() { this.queries = 0; this.batches = 0; } };
  const DB = new FakeD1(db, stats);
  return {
    env: { DB, ...vars }, DB, db, stats,
    run: (q, ...params) => db.prepare(q).run(...params.map(toSql)),
    rows: (q, ...params) => db.prepare(q).all(...params.map(toSql)).map(plain),
    row: (q, ...params) => plain(db.prepare(q).get(...params.map(toSql))) ?? null,
    close: () => db.close(),
  };
}
