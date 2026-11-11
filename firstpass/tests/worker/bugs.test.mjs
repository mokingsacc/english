// Problem reports and request traces: create, list, get (with the traces it names and both copies of the project), close,
// the connector's bugs tool, scrubbing of secrets, and the kill switch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';
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
  assert.deepEqual(close.json, { id: 'rep-00000001', state: 'fixed', fix: 'https://github.com/x/y/pull/7', was: 'open' });
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
