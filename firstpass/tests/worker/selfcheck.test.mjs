// GET /api/selfcheck: one line per part in her words, each ok or saying what is wrong and who can put it right; no file
// names, commands or raw errors (those stay in the request's trace); the photo probe goes through the tile cache. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';
import { makeUser } from '../../src/worker/store/users.js';
import { PROBE_TILE } from '../../src/worker/api/selfcheck.js';

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
  assert.equal(by.tiles.text, 'The aerial photo service did not answer just now. The drawing works without photos; try again later.');
  assert.equal(by.connector.ok, false);
  assert.match(by.connector.text, /no Claude connector link/);
});

test('a database without its tables: her words on the line, the raw error only in the kept trace', async () => {
  const t = await setup({ vars: { TILE_FETCH: jpeg } });
  await t.call('GET', '/api/me');   // the key is known now
  t.db.exec('DROP TABLE projects');
  const r = await t.call('GET', '/api/selfcheck');
  const db = r.json.lines.find(l => l.id === 'database');
  assert.equal(db.ok, false);
  assert.equal(db.text, 'The database is not set up. Tell the person who runs First Pass.');
  assert.doesNotMatch(JSON.stringify(r.json), /no such table|SQLITE|D1_ERROR/);
  await t.settle();
  const kept = t.rows("SELECT why, error FROM debug_traces WHERE route = 'GET /api/selfcheck'");
  assert.equal(kept.length, 1);
  assert.equal(kept[0].why, 'error');
  assert.match(kept[0].error, /selfcheck database: .*no such table/);
});

test('no line names a file, a command or a setting she cannot see, whatever fails', async () => {
  const t = await setup({ vars: { TILE_FETCH: async () => { throw new TypeError('fetch failed'); } } });
  const u = await makeUser('Dan');
  t.run('INSERT INTO users (id, name, key_hash, mcp_token_hash, created_at) VALUES (?, ?, ?, NULL, 0)', u.id, u.name, u.key_hash);
  await t.call('GET', '/api/me', { key: u.key });
  t.db.exec('DROP TABLE projects');
  const r = await t.call('GET', '/api/selfcheck', { key: u.key });
  for (const l of r.json.lines) {
    assert.doesNotMatch(l.text, /\.(js|mjs|toml|md|sql|json)\b|npm |node |wrangler|scripts\/|CLAUDE\.md|migration|binding|\(|\)/i, l.text);
  }
});

test('the photo line goes through the tile cache: a second check asks the service nothing', async () => {
  const calls = [];
  const store = new Map();
  const cache = {
    async match(req) { const h = store.get(req.url); return h ? new Response(h.body.slice(0), { headers: h.headers }) : undefined; },
    async put(req, res) { store.set(req.url, { body: await res.arrayBuffer(), headers: [...res.headers] }); },
  };
  const t = await setup({ vars: { TILE_FETCH: async (url) => { calls.push(url); return jpeg(); }, TILE_CACHE: cache } });
  assert.equal((await t.call('GET', '/api/selfcheck')).json.lines[3].ok, true);
  await t.settle();
  assert.equal((await t.call('GET', '/api/selfcheck')).json.lines[3].ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual([...store.keys()], [`https://fp.test/tiles/naip/${PROBE_TILE.z}/${PROBE_TILE.x}/${PROBE_TILE.y}`]);
});
