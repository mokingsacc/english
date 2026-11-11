// Small shared helpers for the Worker: JSON answers (never cached), plain-word errors, body parsing, ids, hashing.

export class HttpError extends Error {
  constructor(status, message, extra = null) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };

/** A JSON answer. Every /api answer carries Cache-Control: no-store. */
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } });
}

export function errorResponse(status, message, extra = null) {
  return json({ error: message, ...(extra || {}) }, status);
}

/** The request body as an object; 400 with a plain sentence when it is not one, 413 when it is too large. */
export async function readJson(request, maxBytes = 1_000_000) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > maxBytes) throw new HttpError(413, 'That is too large to send in one go.');
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'That is too large to send in one go.');
  if (!text) return {};
  let data;
  try { data = JSON.parse(text); } catch { throw new HttpError(400, 'That request was not valid JSON.'); }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'That request must be a JSON object.');
  return data;
}

const ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789';
/** A random id with a prefix: 'p_' + 12 characters. */
export function newId(prefix, n = 12) {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `${prefix}${s}`;
}

const enc = new TextEncoder();
const hex = bytes => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');

/** SHA-256 of a text, as 64 hex characters. */
export async function sha256Hex(text) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(String(text))));
}

/** Two texts compared in constant time for their length (both are hashes of the same length here). */
export function sameText(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

/** A number for a message: whole numbers as they are, others to two places. */
export function fmt(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return String(v);
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 100) / 100);
}

export const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
