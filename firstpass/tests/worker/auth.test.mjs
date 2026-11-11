// Keys, tokens and scoping: a wrong key or token gets nowhere, and one user can never reach another's project.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';
import { sha256Hex, sameText } from '../../src/worker/http.js';

test('the health check needs no key; everything else under /api does', async () => {
  const t = await setup();
  assert.equal((await t.call('GET', '/api/health', { key: null })).status, 200);
  const none = await t.call('GET', '/api/projects', { key: null });
  assert.equal(none.status, 401);
  assert.match(none.json.error, /#k=/);
  assert.equal(none.headers.get('cache-control'), 'no-store');
});

test('a wrong key is refused, a right one names its user', async () => {
  const t = await setup();
  assert.equal((await t.call('GET', '/api/me', { key: 'x'.repeat(43) })).status, 401);
  assert.equal((await t.call('GET', '/api/me', { key: `${t.alice.key.slice(0, -1)}A` })).status, 401);
  assert.equal((await t.call('GET', '/api/me', { key: 'short' })).status, 401);
  const me = await t.call('GET', '/api/me');
  assert.equal(me.status, 200);
  assert.deepEqual(me.json, { user: { id: t.alice.id, name: 'Alice' }, connector: true });
  // The page key is not a connector token and the token is not a page key.
  assert.equal((await t.call('GET', '/api/me', { key: t.alice.token })).status, 401);
  assert.equal((await t.mcp('tools/list', {}, { token: t.alice.key })).status, 404);
});

test('a wrong connector token gets 404, and so does no token', async () => {
  const t = await setup();
  assert.equal((await t.mcp('tools/list', {}, { token: 'y'.repeat(43) })).status, 404);
  assert.equal((await t.call('POST', '/mcp/', { key: null, body: { jsonrpc: '2.0', id: 1, method: 'ping' } })).status, 404);
  assert.equal((await t.mcp('ping')).status, 200);
});

test('only hashes are stored', async () => {
  const t = await setup();
  const row = t.row('SELECT * FROM users WHERE id = ?', t.alice.id);
  assert.equal(row.key_hash, await sha256Hex(t.alice.key));
  assert.equal(row.mcp_token_hash, await sha256Hex(t.alice.token));
  assert.ok(!JSON.stringify(t.rows('SELECT * FROM users')).includes(t.alice.key));
  assert.ok(sameText('abc', 'abc') && !sameText('abc', 'abd') && !sameText('abc', 'abcd'));
});

test("one user cannot read, change, poll, undo or export another's project", async () => {
  const t = await setup();
  const p = await t.newProject();
  const bob = { key: t.bob.key };
  assert.equal((await t.call('GET', `/api/projects/${p.id}`, bob)).status, 404);
  assert.equal((await t.call('POST', `/api/projects/${p.id}/changes`, { ...bob, body: { ops: [{ op: 'set', option: 'A', path: 'icd', value: 140 }] } })).status, 404);
  assert.equal((await t.call('GET', `/api/projects/${p.id}/changes?since=0`, bob)).status, 404);
  assert.equal((await t.call('POST', `/api/projects/${p.id}/undo`, { ...bob, body: {} })).status, 404);
  assert.equal((await t.call('GET', `/api/projects/${p.id}/export/A.dxf`, bob)).status, 404);
  assert.deepEqual((await t.call('GET', '/api/projects', bob)).json.projects, []);
  // Nothing changed for Alice.
  assert.equal((await t.call('GET', `/api/projects/${p.id}`)).json.project.seq, 0);
});

test("one user's connector cannot reach another's project", async () => {
  const t = await setup();
  const p = await t.newProject();
  const asBob = { token: t.bob.token };
  const got = await t.tool('get_option', { project: p.id, option: 'A' }, asBob);
  assert.equal(got.isError, true);
  assert.match(got.summary, /no project with that id/);
  const changed = await t.tool('change_option', { project: p.id, option: 'A', changes: [{ path: 'icd', value: 150 }], reason: 'bigger' }, asBob);
  assert.equal(changed.isError, true);
  // With no project named, Bob's connector sees only his own (none).
  const mine = await t.tool('get_project', {}, asBob);
  assert.equal(mine.isError, true);
  assert.match(mine.summary, /no projects yet/);
});

test("one user cannot read or close another's problem report", async () => {
  const t = await setup();
  const r = await t.call('POST', '/api/bugs', { body: { id: 'report-0001', note: 'The circle looks wrong' } });
  assert.equal(r.status, 200);
  assert.equal((await t.call('GET', '/api/bugs/report-0001', { key: t.bob.key })).status, 404);
  assert.equal((await t.call('POST', '/api/bugs/report-0001/close', { key: t.bob.key, body: { fix: 'x' } })).status, 404);
  assert.equal((await t.call('GET', '/api/bugs', { key: t.bob.key })).json.open, 0);
});
