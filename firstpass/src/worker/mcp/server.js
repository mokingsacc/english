// The connector for Claude (MCP over Streamable HTTP, tools only, stateless: each request is one JSON-RPC POST answered
// with JSON; ported from practice-hub's mcp.js). The address is /mcp/<token>; the token names the user, whose own
// Claude plan runs the conversation (the Worker holds no AI key). This file is the transport: the token, the user, the
// argument check, and the reply: a short plain-text summary first, then the compact JSON.
import { HttpError } from '../http.js';
import { userByToken } from '../store/users.js';
import { noteTrace } from '../debug/trace.js';
import { INSTRUCTIONS } from './instructions.js';
import { LIST, toolByName } from './registry.js';
import { checkArgs, dropNulls } from './args.js';
import { Refusal } from './common.js';

export const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export const SERVER_INFO = { name: 'first-pass', title: 'First Pass', version: '1.0.0' };

const result = (id, r) => ({ jsonrpc: '2.0', id, result: r });
const error = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const DB_RAW = /D1_ERROR|SQLITE_|constraint failed|no such (?:table|column)/i;

/** A tool's answer as an MCP result: the summary, then the JSON (and any extra blocks, such as a screenshot). */
export function toolResult({ text, data = null, content = [] }, isError = false) {
  const blocks = [{ type: 'text', text: String(text || '') }];
  if (data != null) blocks.push({ type: 'text', text: JSON.stringify(data) });
  return { content: blocks.concat(content), isError };
}

/** A failure inside a tool, in words Claude can pass on. The database's own words never reach Claude. */
export function failure(name, e) {
  if (e instanceof Refusal || (e instanceof HttpError && e.status < 500)) return toolResult({ text: e.message, data: { refused: true, reason: e.message } }, true);
  console.error('connector tool failed', name, e && e.message);
  noteTrace(t => t.fail(e));
  const msg = e && e.message ? String(e.message) : 'unknown error';
  const text = DB_RAW.test(msg) ? 'The First Pass database could not do that just now. Call it once more; if it fails again, tell her the server had a database error.'
    : 'First Pass could not do that because of a fault on the server. Tell her, and suggest Report a problem on the page.';
  return toolResult({ text, data: { error: text } }, true);
}

/** One tools/call: the argument check, then the tool. ctx = {db, env, user, origin}. */
export async function callTool(ctx, name, args) {
  const tool = toolByName(name);
  if (!tool) return toolResult({ text: `There is no tool called ${String(name).slice(0, 40)}.` }, true);
  const problems = checkArgs(tool.inputSchema, args);
  if (problems.length) return toolResult({ text: `Fix these and call ${name} again: ${problems.join(' ')}`, data: { problems } }, true);
  try {
    return toolResult(await tool.run(ctx, dropNulls(args)));
  } catch (e) {
    return failure(name, e);
  }
}

async function dispatch(ctx, msg) {
  if (!isObj(msg)) return error(null, -32600, 'Invalid request');
  const { method, id } = msg;
  const params = isObj(msg.params) ? msg.params : {};
  if (id === undefined || id === null) return null;   // a notification
  if (method === 'initialize') {
    const v = VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[0];
    return result(id, { protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: SERVER_INFO, instructions: INSTRUCTIONS });
  }
  if (method === 'ping') return result(id, {});
  if (method === 'tools/list') return result(id, { tools: LIST });
  if (method === 'tools/call') {
    const args = params.arguments == null ? {} : params.arguments;
    if (!isObj(args)) return error(id, -32602, 'arguments must be an object');
    const name = String(params.name || '').slice(0, 60);
    noteTrace(t => { t.noteTool(name); t.route = `mcp ${name}`; });
    return result(id, await callTool(ctx, name, args));
  }
  if (method === 'resources/list') return result(id, { resources: [] });
  if (method === 'resources/templates/list') return result(id, { resourceTemplates: [] });
  if (method === 'prompts/list') return result(id, { prompts: [] });
  return error(id, -32601, `Method not found: ${method}`);
}

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** /mcp/<token>: 404 for an unknown token (nothing says whether the address exists), else the JSON-RPC exchange. */
export async function handleMcp(request, env, url) {
  const token = url.pathname.replace(/^\/mcp\/?/, '').replace(/\/+$/, '');
  const user = await userByToken(env.DB, token);
  if (!user) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  noteTrace(t => { t.user = user.id; });
  if (request.method === 'DELETE') return new Response(null, { status: 200 });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST, DELETE' } });
  let body;
  try { body = await request.json(); } catch { return jsonResponse(error(null, -32700, 'Parse error'), 400); }
  const ctx = { db: env.DB, env, user, origin: url.origin };
  if (Array.isArray(body)) {
    const out = [];
    for (const m of body.slice(0, 20)) { const r = await dispatch(ctx, m); if (r) out.push(r); }
    return out.length ? jsonResponse(out) : new Response(null, { status: 202 });
  }
  const r = await dispatch(ctx, body);
  return r ? jsonResponse(r) : new Response(null, { status: 202 });
}
