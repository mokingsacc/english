// Users and their two secrets: the page key (X-Key header, from the link's #k=<key>) and the connector token (the
// address /mcp/<token>). Only SHA-256 hashes are stored; a lookup hashes what was given, finds the row by its hash and
// compares the hashes in constant time. A found user is kept for a minute per isolate, so the 1.5 s poll costs one read.
// admin marks the person who runs First Pass (migrations/0002_admin.sql): they see everyone's problem reports.
import { sha256Hex, sameText, newId } from '../http.js';
import { rawDb } from '../debug/trace.js';

const CACHE_MS = 60_000;
let caches = new WeakMap();   // database binding -> Map(hash -> {user, at})
const KEY_RE = /^[A-Za-z0-9_-]{16,128}$/;

/** Forgets every cached user (tests; a user removed by hand is forgotten within a minute anyway). */
export function _clearUserCache() { caches = new WeakMap(); }

async function byHash(db, column, given, now) {
  if (typeof given !== 'string' || !KEY_RE.test(given)) return null;
  const hash = await sha256Hex(given);
  const raw = rawDb(db);
  let cache = caches.get(raw);
  if (!cache) { cache = new Map(); caches.set(raw, cache); }
  const hit = cache.get(`${column}:${hash}`);
  if (hit && now - hit.at < CACHE_MS) return hit.user;
  const row = await db.prepare(`SELECT id, name, key_hash, mcp_token_hash, admin FROM users WHERE ${column} = ?1`).bind(hash).first();
  if (!row || !sameText(row[column], hash)) return null;
  const user = { id: row.id, name: row.name, connector: !!row.mcp_token_hash, admin: Number(row.admin) === 1 };
  if (cache.size > 500) cache.clear();
  cache.set(`${column}:${hash}`, { user, at: now });
  return user;
}

/** The user whose page key this is, or null. */
export const userByKey = (db, key, now = Date.now()) => byHash(db, 'key_hash', key, now);
/** The user whose connector token this is, or null. */
export const userByToken = (db, token, now = Date.now()) => byHash(db, 'mcp_token_hash', token, now);

/** A new random secret: 32 random bytes as base64url (43 characters). */
export function newSecret() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A new user's row and secrets: {id, name, admin, key, token, key_hash, token_hash}. The secrets are shown once, never stored. */
export async function makeUser(name, { key = newSecret(), token = newSecret(), id = newId('u_'), admin = false } = {}) {
  const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!clean) throw new Error('A user needs a name.');
  return { id, name: clean, admin: !!admin, key, token, key_hash: await sha256Hex(key), token_hash: await sha256Hex(token) };
}

/** The SQL that adds a user (for wrangler d1 execute). Holds only hashes. */
export function userSql(u, now = Date.now()) {
  const q = s => `'${String(s).replace(/'/g, "''")}'`;
  return `INSERT INTO users (id, name, key_hash, mcp_token_hash, created_at, admin) VALUES (${q(u.id)}, ${q(u.name)}, ${q(u.key_hash)}, ${q(u.token_hash)}, ${now}, ${u.admin ? 1 : 0});`;
}

/** Adds a user straight into a database (the dev server and the tests). */
export async function insertUser(db, u, now = Date.now()) {
  await db.prepare('INSERT INTO users (id, name, key_hash, mcp_token_hash, created_at, admin) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(u.id, u.name, u.key_hash, u.token_hash, now, u.admin ? 1 : 0).run();
}
