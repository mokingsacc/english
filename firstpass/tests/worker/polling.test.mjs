// The page's routes for changes: POST a change, poll it (one indexed read, an empty list when nothing is new), undo it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';
import { POLL_MAX } from '../../src/worker/store/change.js';
import { SAMPLE } from '../../src/worker/store/projects.js';

test('a change by the page, then polled, then undone, through the API', async () => {
  const t = await setup();
  const p = await t.newProject();
  const post = await t.call('POST', `/api/projects/${p.id}/changes`, { body: { ops: [{ op: 'set', option: 'A', path: 'icd', value: 140 }], summary: 'ICD 140', id: 'page-0001' } });
  assert.equal(post.status, 200);
  assert.equal(post.json.ok, true);
  assert.equal(post.json.seq, 1);
  assert.deepEqual(Object.keys(post.json.change), ['seq', 'batch_id', 'at', 'actor', 'summary', 'ops', 'undone', 'undo_of']);
  assert.equal(post.json.change.batch_id, 'page-0001');
  assert.equal(post.json.change.actor, 'user');
  assert.equal(post.json.project.options[0].round.icd, 140);
  assert.equal(post.headers.get('cache-control'), 'no-store');

  const poll = await t.call('GET', `/api/projects/${p.id}/changes?since=0`);
  assert.equal(poll.status, 200);
  assert.equal(poll.json.seq, 1);
  assert.equal(poll.json.changes.length, 1);
  assert.equal(poll.json.changes[0].summary, 'ICD 140');
  assert.equal(poll.json.project.seq, 1);
  assert.equal(poll.json.project.options[0].round.icd, 140);

  const undo = await t.call('POST', `/api/projects/${p.id}/undo`, { body: {} });
  assert.equal(undo.status, 200);
  assert.equal(undo.json.change.summary, 'Undo: ICD 140');
  assert.equal(undo.json.change.undo_of, 1);
  const after = await t.call('GET', `/api/projects/${p.id}/changes?since=1`);
  assert.equal(after.json.changes[0].undo_of, 1);
  assert.equal(after.json.project.options[0].round.icd, 130);

  const got = await t.call('GET', `/api/projects/${p.id}`);
  assert.deepEqual(got.json.history.map(h => [h.seq, h.summary, h.undone]), [[2, 'Undo: ICD 140', null], [1, 'ICD 140', 2]]);
});

test('nothing new: the smallest answer, from one database read', async () => {
  const t = await setup();
  const p = await t.newProject();
  await t.call('POST', `/api/projects/${p.id}/changes`, { body: { ops: [{ op: 'set', option: 'A', path: 'icd', value: 140 }] } });
  await t.call('GET', '/api/me');   // the key and the trace switch are known now (each kept a minute per isolate)
  await t.settle();
  t.stats.reset();
  const r = await t.call('GET', `/api/projects/${p.id}/changes?since=1`);
  assert.equal(r.status, 200);
  assert.equal(r.text, '{"seq":1,"changes":[]}');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(t.stats.queries, 1);
  // With news, still one read.
  await t.call('POST', `/api/projects/${p.id}/changes`, { body: { ops: [{ op: 'set', option: 'A', path: 'icd', value: 150 }] } });
  await t.settle();
  t.stats.reset();
  const news = await t.call('GET', `/api/projects/${p.id}/changes?since=1`);
  assert.equal(news.json.changes.length, 1);
  assert.equal(t.stats.queries, 1);
});

test('too many changes, or a seq ahead of the project: the whole project instead', async () => {
  const t = await setup();
  const p = await t.newProject();
  for (let i = 0; i < POLL_MAX + 2; i++) {
    const r = await t.call('POST', `/api/projects/${p.id}/changes`, { body: { ops: [{ op: 'set', option: 'A', path: 'icd', value: 100 + i }] } });
    assert.equal(r.status, 200);
  }
  const far = await t.call('GET', `/api/projects/${p.id}/changes?since=0`);
  assert.equal(far.json.reset, true);
  assert.deepEqual(far.json.changes, []);
  assert.equal(far.json.project.seq, POLL_MAX + 2);
  assert.equal(far.json.project.options[0].round.icd, 100 + POLL_MAX + 1);
  const ahead = await t.call('GET', `/api/projects/${p.id}/changes?since=999`);
  assert.equal(ahead.json.reset, true);
  const near = await t.call('GET', `/api/projects/${p.id}/changes?since=${POLL_MAX}`);
  assert.equal(near.json.changes.length, 2);
  assert.equal(near.json.reset, undefined);
});

test('poll and change answers in plain words when something is wrong', async () => {
  const t = await setup();
  const p = await t.newProject();
  assert.equal((await t.call('GET', `/api/projects/${p.id}/changes`)).status, 400);
  assert.equal((await t.call('GET', `/api/projects/${p.id}/changes?since=-1`)).status, 400);
  assert.equal((await t.call('GET', '/api/projects/p_nothere/changes?since=0')).status, 404);
  const bad = await t.call('POST', `/api/projects/${p.id}/changes`, { body: { ops: [{ op: 'set', option: 'A', path: 'icd', value: 20 }] } });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /^Inscribed circle diameter must be between 70 and 300 ft/);
  assert.equal((await t.call('POST', `/api/projects/${p.id}/changes`, { body: 'not json' })).status, 400);
  const nothing = await t.call('POST', `/api/projects/${p.id}/undo`, { body: {} });
  assert.equal(nothing.status, 400);
  assert.match(nothing.json.error, /nothing to undo/);
  await t.call('POST', `/api/projects/${p.id}/changes`, { body: { ops: [{ op: 'set', option: 'A', path: 'icd', value: 140 }] } });
  const clash = await t.call('POST', `/api/projects/${p.id}/changes`, { body: { ops: [{ op: 'set', option: 'A', path: 'icd', value: 150 }], base_seq: 0 } });
  assert.equal(clash.status, 409);
  assert.equal(clash.json.conflict, true);
  assert.equal(clash.json.seq, 1);
  const same = await t.call('POST', `/api/projects/${p.id}/changes`, { body: { ops: [{ op: 'set', option: 'A', path: 'icd', value: 140 }] } });
  assert.deepEqual(same.json, { ok: true, nothing: true, seq: 1, summary: 'Nothing changed: the drawing already has those values.' });
});

test('projects: create (sample, given round, refused round), list, read', async () => {
  const t = await setup();
  const sample = await t.newProject();
  assert.equal(sample.name, 'Sample roundabout');
  assert.equal(sample.epsg, 2226);
  assert.deepEqual(sample.site, SAMPLE.site);
  assert.deepEqual(Object.keys(sample), ['id', 'name', 'epsg', 'site', 'rules', 'options', 'seq', 'updated_at']);
  assert.deepEqual(Object.keys(sample.options[0].round), ['center', 'icd', 'circWidth', 'apronWidth', 'legs']);
  const plain = await t.newProject({ name: 'Elm and 5th' });
  assert.equal(plain.site, null);
  assert.equal(plain.options[0].round.legs.length, 4);
  const three = await t.newProject({ name: 'T junction', round: { center: { x: 1, y: 2 }, icd: 120, legs: [{ id: 'N', bearing: 0 }, { id: 'E', bearing: 90 }, { id: 'S', bearing: 180 }] } });
  assert.equal(three.options[0].round.legs.length, 3);
  assert.equal(three.options[0].round.circWidth, 18);
  const bad = await t.call('POST', '/api/projects', { body: { round: { icd: 900, legs: [] } } });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /That roundabout cannot be used/);
  const list = await t.call('GET', '/api/projects');
  assert.deepEqual(list.json.projects.map(x => x.name).sort(), ['Elm and 5th', 'Sample roundabout', 'T junction']);
  const one = await t.call('GET', `/api/projects/${sample.id}`);
  assert.equal(one.json.project.id, sample.id);
  assert.deepEqual(one.json.history, []);
  const dxf = await t.call('GET', `/api/projects/${sample.id}/export/A.dxf`);
  assert.equal(dxf.status, 200);
  assert.match(dxf.text, /^  0\r\nSECTION\r\n/);
  assert.equal((await t.call('DELETE', `/api/projects/${sample.id}`)).status, 405);
  assert.equal((await t.call('GET', '/api/nothing')).status, 404);
});

test('settings: debug_capture only, true or false', async () => {
  const t = await setup();
  assert.deepEqual((await t.call('GET', '/api/settings')).json, { settings: { debug_capture: true } });
  assert.equal((await t.call('PUT', '/api/settings', { body: { colour: 'red' } })).status, 400);
  assert.equal((await t.call('PUT', '/api/settings', { body: { debug_capture: 'no' } })).status, 400);
  assert.deepEqual((await t.call('PUT', '/api/settings', { body: { debug_capture: false } })).json, { settings: { debug_capture: false } });
});
