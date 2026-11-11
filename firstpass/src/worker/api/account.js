// Small routes about the server and the person using it: health (no key), who am I, and the server settings (only
// debug_capture, the kill switch for request traces).
//   GET /api/health                          -> {ok: true}                       no key needed
//   GET /api/me                              -> {user: {id, name}, connector: true|false}
//   GET /api/settings                        -> {settings: {debug_capture: true|false}}
//   PUT /api/settings {debug_capture}        -> {settings}
import { json, readJson, HttpError } from '../http.js';
import { _resetSwitch } from '../debug/trace.js';

async function health() {
  return json({ ok: true });
}

async function me(request, env, ctx, params, url, user) {
  return json({ user: { id: user.id, name: user.name }, connector: !!user.connector });
}

async function readSettings(db) {
  const rows = (await db.prepare("SELECT key, value FROM settings WHERE key IN ('debug_capture')").all()).results || [];
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return { debug_capture: map.debug_capture !== 'false' };
}

async function getSettings(request, env) {
  return json({ settings: await readSettings(env.DB) });
}

async function putSettings(request, env) {
  const body = await readJson(request, 10_000);
  const keys = Object.keys(body);
  if (!keys.length || keys.some(k => k !== 'debug_capture')) throw new HttpError(400, 'The only setting is debug_capture (true or false).');
  if (typeof body.debug_capture !== 'boolean') throw new HttpError(400, 'debug_capture is true or false.');
  await env.DB.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
    .bind('debug_capture', String(body.debug_capture), Date.now()).run();
  _resetSwitch();
  return json({ settings: await readSettings(env.DB) });
}

export const routes = [
  { method: 'GET', pattern: '/api/health', handler: health, auth: 'none' },
  { method: 'GET', pattern: '/api/me', handler: me },
  { method: 'GET', pattern: '/api/settings', handler: getSettings },
  { method: 'PUT', pattern: '/api/settings', handler: putSettings },
];
