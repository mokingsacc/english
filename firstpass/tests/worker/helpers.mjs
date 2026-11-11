// Shared helpers for the Worker tests: a fresh in-memory database with two users (Alice, Bob), and calls through the real
// Worker fetch handler (the same one the dev server and Cloudflare run), the keyed API and the connector alike.
import worker from '../../src/worker/index.js';
import { createD1 } from './d1-fake.mjs';
import { makeUser, insertUser, _clearUserCache } from '../../src/worker/store/users.js';
import { _resetSwitch } from '../../src/worker/debug/trace.js';

export const ORIGIN = 'https://fp.test';

export async function setup({ vars = {} } = {}) {
  _clearUserCache();
  _resetSwitch();
  const d1 = createD1({ vars });
  const alice = await makeUser('Alice');
  const bob = await makeUser('Bob');
  await insertUser(d1.DB, alice);
  await insertUser(d1.DB, bob);
  const waits = [];
  const ctx = { waitUntil: p => { waits.push(p); } };

  /** One request: {status, headers, json, text}. key defaults to Alice's; key: null sends none. */
  async function call(method, path, { body, key = alice.key, headers = {} } = {}) {
    const h = { ...headers };
    if (key) h['X-Key'] = key;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const res = await worker.fetch(new Request(`${ORIGIN}${path}`, { method, headers: h, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) }), d1.env, ctx);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, headers: res.headers, json, text };
  }

  /** One JSON-RPC message to the connector. */
  async function mcp(method, params = {}, { token = alice.token, id = 1 } = {}) {
    return call('POST', `/mcp/${token}`, { key: null, body: { jsonrpc: '2.0', id, method, params } });
  }

  /** One tool call: the MCP result with summary (the first text block) and data (the JSON block) read out. */
  async function tool(name, args = {}, opts = {}) {
    const r = await mcp('tools/call', { name, arguments: args }, opts);
    const res = r.json.result;
    let data = null;
    try { data = res.content[1] ? JSON.parse(res.content[1].text) : null; } catch { data = null; }
    return { ...res, summary: res.content[0].text, data };
  }

  /** Alice's new project (the sample unless a body is given). */
  async function newProject(body = { sample: true }, key = alice.key) {
    const r = await call('POST', '/api/projects', { body, key });
    if (r.status !== 201) throw new Error(`project not made: ${r.status} ${r.text}`);
    return r.json.project;
  }

  const settle = () => Promise.all(waits.splice(0));
  return { ...d1, alice, bob, call, mcp, tool, newProject, settle, ctx };
}
