// GET /api/selfcheck: one plain line per part, each ok or saying what is wrong and what to do. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';
import { makeUser } from '../../src/worker/store/users.js';

const jpeg = async () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { headers: { 'Content-Type': 'image/jpeg' } });

test('every line ok', async () => {
  const t = await setup({ vars: { TILE_FETCH: jpeg } });
  await t.newProject();
  const r = await t.call('GET', '/api/selfcheck');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.deepEqual(r.json.lines.map(l => [l.id, l.ok]), [['database', true], ['users', true], ['engine', true], ['tiles', true], ['connector', true]]);
  assert.match(r.json.lines[0].text, /^The database answers\. You have 1 project\.$/);
  assert.match(r.json.lines[2].text, /^The maths engine works out the default roundabout: 8 checks/);
  assert.equal((await t.call('GET', '/api/selfcheck', { key: null })).status, 401);
});

test('the photo service down, and no connector link: said plainly with what to do', async () => {
  const t = await setup({ vars: { TILE_FETCH: async () => new Response('busy', { status: 503, headers: { 'Content-Type': 'text/plain' } }) } });
  const u = await makeUser('Carol');
  t.run('INSERT INTO users (id, name, key_hash, mcp_token_hash, created_at) VALUES (?, ?, ?, NULL, 0)', u.id, u.name, u.key_hash);
  const r = await t.call('GET', '/api/selfcheck', { key: u.key });
  assert.equal(r.json.ok, false);
  const by = Object.fromEntries(r.json.lines.map(l => [l.id, l]));
  assert.equal(by.database.ok, true);
  assert.equal(by.tiles.ok, false);
  assert.match(by.tiles.text, /^The aerial photo service did not answer \(the service answered 503.*The drawing works without photos/);
  assert.equal(by.connector.ok, false);
  assert.match(by.connector.text, /no Claude connector link/);
});

test('a database without its tables says to apply the migrations', async () => {
  const t = await setup({ vars: { TILE_FETCH: jpeg } });
  await t.call('GET', '/api/me');   // the key is known now
  t.db.exec('DROP TABLE projects');
  const r = await t.call('GET', '/api/selfcheck');
  const db = r.json.lines.find(l => l.id === 'database');
  assert.equal(db.ok, false);
  assert.match(db.text, /apply the migrations/);
});
