// The Worker under real workerd: builds, starts `wrangler pages dev` on a local D1 (migrations applied, one test user)
// and checks /api/health, a keyed project write and read, the connector's tools/list and one tools/call, a tile outside
// California (404), and that / is served without the Worker. Run: npm run test:workerd (not part of npm test).
//   FP_WRANGLER   the wrangler to run (default "npx --yes wrangler@4")
//   FP_PORT       the port for pages dev (default 8791; the inspector takes the next one)
// pages dev runs with no directory and no --d1: it reads wrangler.toml (pages_build_output_dir and the D1 binding), as
// `wrangler pages deploy` does, so a pass shows the config binds DB on its own. Its state lives in
// .wrangler/test-workerd (git-ignored), made fresh each run. The test user's key and token are never printed.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeUser, userSql } from '../src/worker/store/users.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE = path.join(ROOT, '.wrangler', 'test-workerd');
const PORT = Number(process.env.FP_PORT || 8791);
const BASE = `http://127.0.0.1:${PORT}`;
const WRANGLER = (process.env.FP_WRANGLER || 'npx --yes wrangler@4').split(/\s+/).filter(Boolean);
const ENV = { ...process.env, WRANGLER_SEND_METRICS: 'false', NO_COLOR: '1', FORCE_COLOR: '0' };
const STATE_ARG = path.relative(ROOT, STATE);

function fail(message, output = '') {
  console.error(`\nnot ok - ${message}`);
  if (output) console.error(output.trim().split('\n').slice(-40).join('\n'));
  process.exit(1);
}

/** Runs a command to the end in firstpass/, failing with its output when it does not succeed. */
function run(what, cmd, args) {
  const r = spawnSync(cmd, args, { cwd: ROOT, env: ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) fail(`${what} failed`, `${r.stdout || ''}\n${r.stderr || ''}${r.error ? `\n${r.error.message}` : ''}`);
  console.log(`ok - ${what}`);
  return r.stdout;
}
const wrangler = (what, args) => run(what, WRANGLER[0], [...WRANGLER.slice(1), ...args]);

// 1. Build, a fresh local database with the migrations, and one test user (an owner, so the admin column is used).
run('build', process.execPath, ['scripts/build.mjs']);
fs.rmSync(STATE, { recursive: true, force: true });
fs.mkdirSync(STATE, { recursive: true });
wrangler('local migrations', ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', STATE_ARG]);
const user = await makeUser('Workerd check', { admin: true });
wrangler('test user', ['d1', 'execute', 'DB', '--local', '--persist-to', STATE_ARG, '--command', userSql(user)]);

// 2. pages dev, with no directory and no --d1 (wrangler.toml gives both).
let log = '';
// pages dev logs each request's path, and the connector's path holds the token: never print it.
const redact = s => s.split(user.token).join('<token>').split(user.key).join('<key>');
const server = spawn(WRANGLER[0], [...WRANGLER.slice(1), 'pages', 'dev', '--ip', '127.0.0.1', '--port', String(PORT),
  '--inspector-port', String(PORT + 1), '--persist-to', STATE_ARG, '--show-interactive-dev-session=false'],
{ cwd: ROOT, env: ENV, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
server.stdout.on('data', d => { log += d; });
server.stderr.on('data', d => { log += d; });
let exited = null;
server.on('exit', code => { exited = code ?? 'signal'; });

async function stopServer() {
  if (exited !== null) return;
  try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already gone */ }
  for (let i = 0; i < 50 && exited === null; i++) await new Promise(r => setTimeout(r, 100));
  if (exited === null) try { process.kill(-server.pid, 'SIGKILL'); } catch { /* already gone */ }
}
process.on('SIGINT', async () => { await stopServer(); process.exit(130); });

async function req(method, p, { key = null, body, headers = {} } = {}) {
  const h = { ...headers };
  if (key) h['X-Key'] = key;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, headers: res.headers, text, json };
}
const rpc = (method, params, id = 1) => req('POST', `/mcp/${user.token}`, { body: { jsonrpc: '2.0', id, method, params } });

let up = false;
for (let i = 0; i < 240 && exited === null; i++) {
  try { if ((await req('GET', '/api/health')).status === 200) { up = true; break; } } catch { /* not listening yet */ }
  await new Promise(r => setTimeout(r, 500));
}
if (!up) { await stopServer(); fail(`pages dev did not answer on ${BASE} within two minutes`, redact(log)); }
console.log(`ok - pages dev answers on ${BASE}`);

// 3. The checks.
const results = [];
async function check(name, fn) {
  try { await fn(); results.push(true); console.log(`ok - ${name}`); } catch (e) { results.push(false); console.log(`not ok - ${name}: ${e.message}`); }
}
function expect(cond, why) { if (!cond) throw new Error(why); }

let project = null;
await check('/api/health answers {ok: true} with no-store', async () => {
  const r = await req('GET', '/api/health');
  expect(r.status === 200 && r.json?.ok === true, `got ${r.status} ${r.text.slice(0, 200)}`);
  expect(/no-store/.test(r.headers.get('cache-control') || ''), 'no Cache-Control: no-store');
});
await check('the D1 binding DB comes from wrangler.toml (a keyed call finds the test user)', async () => {
  const r = await req('GET', '/api/me', { key: user.key });
  expect(r.status === 200, `got ${r.status} ${r.text.slice(0, 300)}`);
  expect(r.json.user?.id === user.id && r.json.admin === true, `wrong user: ${r.text.slice(0, 200)}`);
  expect((await req('GET', '/api/me')).status === 401, 'no key was let in');
});
await check('a keyed project write and read: make the sample, change it, read the change back', async () => {
  const made = await req('POST', '/api/projects', { key: user.key, body: { sample: true, name: 'Workerd check' } });
  expect(made.status === 201, `make: ${made.status} ${made.text.slice(0, 300)}`);
  project = made.json.project;
  const opt = project.options[0];
  const icd = opt.round.icd + 10;
  const ch = await req('POST', `/api/projects/${project.id}/changes`, { key: user.key,
    body: { ops: [{ op: 'set', option: opt.id, path: 'icd', value: icd }], summary: 'Workerd check', id: 'workerd-0001' } });
  expect(ch.status === 200 && ch.json.ok, `change: ${ch.status} ${ch.text.slice(0, 300)}`);
  const got = await req('GET', `/api/projects/${project.id}`, { key: user.key });
  expect(got.status === 200, `read: ${got.status}`);
  expect(got.json.project.options[0].round.icd === icd, 'the change is not in the project read back');
  expect(got.json.project.seq === ch.json.seq && got.json.history.some(h => h.summary === 'Workerd check'), 'the history lacks the change');
});
await check('the connector: initialize, tools/list, and tools/call get_project', async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'workerd-check', version: '1' } });
  expect(init.status === 200 && init.json?.result?.serverInfo, `initialize: ${init.status} ${init.text.slice(0, 200)}`);
  const list = await rpc('tools/list', {}, 2);
  const names = (list.json?.result?.tools || []).map(t => t.name);
  expect(names.includes('get_project') && names.includes('set_site'), `tools: ${names.join(', ')}`);
  const call = await rpc('tools/call', { name: 'get_project', arguments: { project: project?.id } }, 3);
  const res = call.json?.result;
  expect(res && !res.isError, `get_project: ${call.text.slice(0, 300)}`);
  const data = JSON.parse(res.content[1].text);
  expect(data.project.id === project.id && data.project.seq >= 1, 'get_project read another project');
});
await check('a tile outside California is 404, and one asked by another site is 403', async () => {
  const away = await req('GET', '/tiles/naip/16/0/0', { headers: { 'Sec-Fetch-Site': 'same-origin' } });
  expect(away.status === 404, `outside California: ${away.status} ${away.text.slice(0, 200)}`);
  const other = await req('GET', '/tiles/naip/16/0/0', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
  expect(other.status === 403, `another site: ${other.status}`);
});
await check('/ serves the page without invoking the Worker, and /api/* reaches it', async () => {
  const r = await req('GET', '/');
  expect(r.status === 200 && /<!doctype html>/i.test(r.text), `got ${r.status}`);
  expect(!r.headers.get('x-fp-via'), 'the Worker served / (X-FP-Via is set): _routes.json is not honoured');
  const none = await req('GET', '/api/no-such-thing', { key: user.key });
  expect(none.status === 404 && typeof none.json?.error === 'string', `unknown /api path: ${none.status} ${none.text.slice(0, 200)}`);
});

await stopServer();
const failed = results.filter(x => !x).length;
console.log(`\n${results.length - failed} of ${results.length} checks pass under workerd${failed ? '' : '.'}`);
if (failed) { console.log('\npages dev said:\n' + redact(log).trim().split('\n').slice(-40).join('\n')); process.exit(1); }
