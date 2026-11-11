// Problem reports and request traces: create, list, get (with the traces it names and both copies of the project), close,
// the connector's bugs tool, scrubbing of secrets, and the kill switch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';
import { makeUser, insertUser } from '../../src/worker/store/users.js';
import { scrubBundle, cleanUrl, reportOf } from '../../src/worker/debug/bugs.js';
import { _hooks } from '../../src/worker/debug/trace.js';

// A 1 x 1 PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('a report round trip: saved with its traces and the project, listed, read in full, closed', async () => {
  const t = await setup();
  const p = await t.newProject();
  // A call the page made, kept because the report sheet asks again with X-Trace-Keep.
  const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
  const call = await t.call('GET', `/api/projects/${p.id}`, { headers: { traceparent: `00-${traceId}-00f067aa0ba902b7-01`, 'X-Trace-Keep': '1' } });
  assert.equal(call.headers.get('x-trace-id'), traceId);
  await t.settle();
  const body = {
    id: 'rep-00000001', note: 'The north entry radius will not take 80', page: `/#k=${t.alice.key}&p=${p.id}`,
    state: { project_id: p.id, option: 'A', project: p, key: t.alice.key },
    calls: [{ t: 'fetch', u: `/api/projects/${p.id}`, m: 'GET', s: 200, ms: 12, id: traceId }],
    crumbs: [{ t: 'tap', name: 'ICD' }], errors: [], app: { ua: 'test', w: 1200, h: 800, 'X-Key': t.alice.key },
    shot: { mime: 'image/png', data: PNG },
  };
  const r = await t.call('POST', '/api/bugs', { body });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { id: 'rep-00000001', duplicate: false, traces: 1 });
  assert.equal((await t.call('POST', '/api/bugs', { body })).json.duplicate, true);

  const list = await t.call('GET', '/api/bugs');
  assert.equal(list.json.open, 1);
  assert.deepEqual(list.json.reports.map(x => [x.id, x.shot, x.traces, x.state]), [['rep-00000001', true, 1, 'open']]);

  const got = await t.call('GET', '/api/bugs/rep-00000001');
  assert.equal(got.status, 200);
  const stored = JSON.stringify(got.json);
  assert.ok(!stored.includes(t.alice.key), 'the key never reaches a report');
  assert.equal(got.json.bundle.page, '/#k=<key>&p=' + p.id);
  assert.equal(got.json.bundle.state.option, 'A');
  assert.equal(got.json.bundle.server_project.doc.options[0].round.icd, 130);
  assert.deepEqual(got.json.bundle.project, { same_as_server_project: true });
  assert.equal(got.json.traces.length, 1);
  assert.equal(got.json.traces[0].route, 'GET /api/projects/:id');
  assert.ok(got.json.traces[0].trace.db.length >= 1);
  assert.ok(!JSON.stringify(got.json.traces[0].trace.db).includes(p.id), 'bound values are never noted');
  assert.equal(got.json.shot.url, 'https://fp.test/api/bugs/rep-00000001/shot');
  const shot = await t.call('GET', '/api/bugs/rep-00000001/shot');
  assert.equal(shot.headers.get('content-type'), 'image/png');

  const close = await t.call('POST', '/api/bugs/rep-00000001/close', { body: { fix: 'https://github.com/x/y/pull/7' } });
  assert.deepEqual(close.json, { id: 'rep-00000001', state: 'fixed', fix: 'https://github.com/x/y/pull/7', was: 'open', reporter: 'Alice' });
  assert.equal((await t.call('GET', '/api/bugs')).json.open, 0);
  assert.equal((await t.call('POST', '/api/bugs/rep-00000001/close', { body: {} })).status, 400);
});

test('a report keeps the page\'s own project when it differs from the server\'s', async () => {
  const t = await setup();
  const p = await t.newProject();
  const mine = JSON.parse(JSON.stringify(p));
  mine.options[0].round.icd = 133;   // mid-drag, not saved
  await t.call('POST', '/api/bugs', { body: { id: 'rep-00000002', note: 'drag went odd', state: { project_id: p.id, project: mine } } });
  const got = (await t.call('GET', '/api/bugs/rep-00000002')).json;
  assert.equal(got.bundle.project.options[0].round.icd, 133);
  assert.equal(got.bundle.server_project.doc.options[0].round.icd, 130);
});

test('reports need words or a screenshot, an id, and a real picture', async () => {
  const t = await setup();
  assert.equal((await t.call('POST', '/api/bugs', { body: { id: 'rep-00000003' } })).status, 400);
  assert.equal((await t.call('POST', '/api/bugs', { body: { note: 'x' } })).status, 400);
  const bad = await t.call('POST', '/api/bugs', { body: { id: 'rep-00000004', shot: { mime: 'image/gif', data: 'AAAA' } } });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /JPEG, PNG or WebP/);
  assert.equal((await t.call('POST', '/api/bugs', { body: { id: 'rep-00000005', shot: { mime: 'image/png', data: PNG } } })).status, 200);
});

test('scrubbing: secret fields dropped, keys and tokens cut out of addresses and text', () => {
  const key = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG';
  assert.equal(cleanUrl(`https://fp.test/#k=${key}&p=p_1`), 'https://fp.test/#k=<key>&p=p_1');
  assert.equal(cleanUrl('/api/projects?since=4'), '/api/projects');
  assert.equal(cleanUrl(`https://fp.test/mcp/${key}`), 'https://fp.test/mcp/<token>');
  const s = scrubBundle({ headers: { Authorization: 'Bearer x', 'X-Key': key, cookie: 'c' }, token: key, password: 'p', note: `see /mcp/${key} and #k=${key}`, deep: { a: { b: { c: 1 } } } });
  assert.deepEqual(s, { headers: {}, note: 'see /mcp/<token> and #k=<key>', deep: { a: { b: { c: 1 } } } });
  const { bundle } = reportOf({ id: 'rep-00000006', note: 'x', calls: Array.from({ length: 50 }, (_, i) => ({ u: `/api/x?k=${i}` })) });
  assert.equal(bundle.calls.length, 30);
  assert.equal(bundle.calls[0].u, '/api/x');
});

test('the connector\'s bugs tool: list, get with the screenshot as an image, close', async () => {
  const t = await setup();
  await t.call('POST', '/api/bugs', { body: { id: 'rep-00000007', note: 'Sweep table empty', shot: { mime: 'image/png', data: PNG } } });
  const list = await t.tool('bugs', { action: 'list' });
  assert.equal(list.isError, false);
  assert.match(list.summary, /^1 open report;/);
  const get = await t.tool('bugs', { action: 'get', id: 'rep-00000007' });
  assert.equal(get.isError, false);
  assert.match(get.summary, /"Sweep table empty"/);
  assert.equal(get.content[2].type, 'image');
  assert.equal(get.content[2].data, PNG);
  const missing = await t.tool('bugs', { action: 'get', id: 'rep-nothere1' });
  assert.equal(missing.isError, true);
  assert.match(missing.summary, /no report with that id/);
  const drop = await t.tool('bugs', { action: 'close', id: 'rep-00000007', state: 'dropped', fix: 'Not a bug: the option had no legs selected' });
  assert.equal(drop.data.state, 'dropped');
});

test('the owner (admin) sees every user\'s reports with the reporter\'s name; everyone else only their own', async () => {
  const t = await setup();
  const owner = await makeUser('Owner', { admin: true });
  await insertUser(t.DB, owner);
  // Alice reports, with a kept trace; Bob reports too.
  const traceId = '0af7651916cd43dd8448eb211c80319c';
  const p = await t.newProject();
  await t.call('GET', `/api/projects/${p.id}`, { headers: { traceparent: `00-${traceId}-b7ad6b7169203331-01`, 'X-Trace-Keep': '1' } });
  await t.settle();
  await t.call('POST', '/api/bugs', { body: { id: 'rep-alice001', note: 'The circle jumped', state: { project_id: p.id }, calls: [{ u: `/api/projects/${p.id}`, id: traceId }], shot: { mime: 'image/png', data: PNG } } });
  await t.call('POST', '/api/bugs', { key: t.bob.key, body: { id: 'rep-bob00001', note: 'Export did nothing' } });

  // Alice sees only her own, cannot ask for all, and cannot read Bob's.
  const mine = (await t.call('GET', '/api/bugs')).json;
  assert.deepEqual(mine.reports.map(r => r.id), ['rep-alice001']);
  assert.equal(mine.reports[0].reporter, undefined);
  const refused = await t.call('GET', '/api/bugs?all=1');
  assert.equal(refused.status, 403);
  assert.equal(refused.json.error, 'Only the person who runs First Pass sees everyone\'s reports.');
  assert.equal((await t.call('GET', '/api/bugs/rep-bob00001')).status, 404);
  assert.equal((await t.call('POST', '/api/bugs/rep-bob00001/close', { body: { fix: 'x' } })).status, 404);
  assert.equal((await t.tool('bugs', { action: 'get', id: 'rep-bob00001' })).isError, true);

  // The owner: every report with its reporter's name, each read in full (its traces too) and closed.
  const all = (await t.call('GET', '/api/bugs?all=1', { key: owner.key })).json;
  assert.equal(all.open, 2);
  assert.deepEqual(all.reports.map(r => [r.id, r.reporter]).sort(), [['rep-alice001', 'Alice'], ['rep-bob00001', 'Bob']]);
  assert.deepEqual((await t.call('GET', '/api/bugs', { key: owner.key })).json.reports, [], 'without all=1, the owner\'s own list');
  const got = (await t.call('GET', '/api/bugs/rep-alice001', { key: owner.key })).json;
  assert.deepEqual(got.reporter, { id: t.alice.id, name: 'Alice' });
  assert.deepEqual(got.traces.map(x => x.id), [traceId]);
  assert.equal(got.bundle.server_project.doc.name, 'Sample roundabout');
  assert.equal((await t.call('GET', '/api/bugs/rep-alice001/shot', { key: owner.key })).headers.get('content-type'), 'image/png');

  const list = await t.tool('bugs', { action: 'list' }, { token: owner.token });
  assert.match(list.summary, /^2 open reports from everyone; 2 listed\.$/);
  const get = await t.tool('bugs', { action: 'get', id: 'rep-bob00001' }, { token: owner.token });
  assert.equal(get.isError, false, get.summary);
  assert.match(get.summary, /^Report rep-bob00001 \(open\) from Bob on /);
  const close = await t.tool('bugs', { action: 'close', id: 'rep-bob00001', fix: 'https://github.com/x/y/pull/9' }, { token: owner.token });
  assert.equal(close.summary, 'Report rep-bob00001 from Bob is now fixed.');
  const bobs = (await t.call('GET', '/api/bugs?state=all', { key: t.bob.key })).json.reports;
  assert.deepEqual(bobs.map(r => [r.id, r.state, r.fix]), [['rep-bob00001', 'fixed', 'https://github.com/x/y/pull/9']]);
  assert.equal((await t.call('GET', '/api/me', { key: owner.key })).json.admin, true);
});

test('traces: failures are kept, quick good calls are not, the kill switch turns it all off, and a broken recorder changes nothing', async () => {
  const t = await setup();
  const p = await t.newProject();
  await t.settle();
  const ok = await t.call('GET', `/api/projects/${p.id}`);
  assert.match(ok.headers.get('x-trace-id'), /^[0-9a-f]{32}$/);
  await t.settle();
  assert.equal(t.row('SELECT count(*) AS n FROM debug_traces').n, 0);
  // A failing call is kept with its error.
  t.db.exec('DROP TABLE changes');
  const bad = await t.call('POST', `/api/projects/${p.id}/changes`, { body: { ops: [{ op: 'set', option: 'A', path: 'icd', value: 140 }] } });
  assert.equal(bad.status, 500);
  assert.match(bad.json.error, /Something went wrong on the server/);
  await t.settle();
  const kept = t.rows('SELECT * FROM debug_traces');
  assert.equal(kept.length, 1);
  assert.equal(kept[0].why, 'error');
  assert.equal(kept[0].route, 'POST /api/projects/:id/changes');
  assert.equal(kept[0].user_id, t.alice.id);
  // A recorder that throws changes no answer.
  _hooks.record = () => { throw new Error('recorder broke'); };
  try {
    assert.equal((await t.call('GET', '/api/projects')).status, 200);
  } finally { _hooks.record = null; }
  // Off: no trace id at all.
  await t.call('PUT', '/api/settings', { body: { debug_capture: false } });
  assert.equal((await t.call('GET', '/api/projects')).headers.get('x-trace-id'), null);
  // A refused key cannot ask to keep a trace.
  await t.call('PUT', '/api/settings', { body: { debug_capture: true } });
  await t.call('GET', '/api/projects', { key: null, headers: { 'X-Trace-Keep': '1' } });
  await t.settle();
  assert.equal(t.row("SELECT count(*) AS n FROM debug_traces WHERE why = 'asked'").n, 0);
});
