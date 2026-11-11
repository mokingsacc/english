// The connector: initialize, tools/list (built from the registry and the parameters table), and one call to each tool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setup } from './helpers.mjs';
import { INSTRUCTIONS, INSTRUCTIONS_MAX } from '../../src/worker/mcp/instructions.js';
import { TOOLS, LIST, LIST_MAX } from '../../src/worker/mcp/registry.js';
import { PARAMS } from '../../src/worker/engine.js';
import { PATH_PATTERN } from '../../src/worker/mcp/schema.js';

const TOOLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src/worker/mcp/tools');

test('initialize: the protocol version, the server and the instructions (under 2,000 characters)', async () => {
  const t = await setup();
  const r = await t.mcp('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.result.protocolVersion, '2025-06-18');
  assert.equal(r.json.result.serverInfo.name, 'first-pass');
  assert.deepEqual(r.json.result.capabilities, { tools: { listChanged: false } });
  assert.equal(r.json.result.instructions, INSTRUCTIONS);
  assert.ok(INSTRUCTIONS.length <= INSTRUCTIONS_MAX, `${INSTRUCTIONS.length} characters`);
  for (const w of ['get_project', 'change_option', 'sweep', 'undo', 'Never invent numbers', 'concept checks']) assert.ok(INSTRUCTIONS.includes(w), w);
  const odd = await t.mcp('initialize', { protocolVersion: '1999-01-01' });
  assert.equal(odd.json.result.protocolVersion, '2025-11-25');
  assert.equal((await t.mcp('ping')).json.result && true, true);
  assert.equal((await t.mcp('nothing/here')).json.error.code, -32601);
  // A notification has no answer.
  const n = await t.call('POST', `/mcp/${t.alice.token}`, { key: null, body: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  assert.equal(n.status, 202);
  assert.equal((await t.call('GET', `/mcp/${t.alice.token}`, { key: null })).status, 405);
  assert.equal((await t.call('POST', `/mcp/${t.alice.token}`, { key: null, body: '{oops' })).json.error.code, -32700);
});

test('tools/list: one file per tool, listed by the registry, small, and change_option built from the parameters table', async () => {
  const t = await setup();
  const r = await t.mcp('tools/list');
  const tools = r.json.result.tools;
  assert.deepEqual(tools.map(x => x.name), ['get_project', 'get_option', 'change_option', 'add_option', 'compare_options', 'sweep', 'undo', 'export_link', 'bugs']);
  assert.deepEqual(tools, LIST);
  assert.ok(JSON.stringify(tools).length < LIST_MAX, `${JSON.stringify(tools).length} characters`);
  assert.deepEqual(fs.readdirSync(TOOLS_DIR).sort(), TOOLS.map(x => `${x.name}.js`).sort());
  for (const x of tools) {
    assert.ok(x.description.length <= 400, x.name);
    assert.equal(x.inputSchema.type, 'object');
    assert.equal(typeof x.annotations.readOnlyHint, 'boolean');
  }
  const change = tools.find(x => x.name === 'change_option');
  const pathArg = change.inputSchema.properties.changes.items.properties.path;
  for (const p of PARAMS) {
    assert.ok(pathArg.description.includes(p.label), p.label);
    const example = p.path.replace('*', 'N');
    assert.ok(new RegExp(PATH_PATTERN).test(example), example);
  }
  assert.ok(!new RegExp(PATH_PATTERN).test('legs.N.colour'));
  for (const name of ['change_option', 'add_option']) assert.ok(tools.find(x => x.name === name).inputSchema.required.includes('reason'), name);
});

test('get_project and get_option: a summary first, then compact JSON', async () => {
  const t = await setup();
  const p = await t.newProject();
  const gp = await t.tool('get_project', {});
  assert.equal(gp.isError, false);
  assert.equal(gp.content.length, 2);
  assert.match(gp.summary, /^Project "Sample roundabout" \(p_\w+\), change 0, 1 option\.\nOption A \(A\): The fastest entry is \d+ mph/);
  assert.equal(gp.data.project.id, p.id);
  assert.equal(gp.data.options[0].headline.fails, 0);
  assert.ok(!gp.content[1].text.includes('\n'), 'the JSON is compact');
  const go = await t.tool('get_option', { option: 'A' });
  assert.equal(go.isError, false);
  assert.equal(go.data.parameters.icd, 130);
  assert.equal(go.data.checks.length, 8);
  assert.ok(go.data.checks.every(c => c.id && c.status && 'explain' in c));
  assert.ok(go.data.legs[0].V.V1 > 0);
  assert.ok(JSON.stringify(go.data).length < 12_000, `${JSON.stringify(go.data).length} characters`);
  const none = await t.tool('get_option', { option: 'Q' });
  assert.equal(none.isError, true);
  assert.match(none.summary, /no option Q/);
});

test('change_option: a change with her reason as its name, seen through the API, refused by label when out of range', async () => {
  const t = await setup();
  const p = await t.newProject();
  const c = await t.tool('change_option', { option: 'A', changes: [{ path: 'icd', value: 150 }, { path: 'legs.N.entryRadius', value: 55 }], reason: 'Bigger circle, tighter north entry' });
  assert.equal(c.isError, false, c.summary);
  assert.match(c.summary, /^Changed Option A: Inscribed circle diameter set to 150 ft \(was 130 ft\) and 1 more change\. .*Say "undo" to put it back\.$/);
  assert.equal(c.data.change.summary, 'Bigger circle, tighter north entry');
  assert.ok(c.data.before && c.data.after && c.data.checks.length === 8);
  const api = await t.call('GET', `/api/projects/${p.id}/changes?since=0`);
  assert.equal(api.json.changes[0].actor, 'claude');
  assert.equal(api.json.changes[0].summary, 'Bigger circle, tighter north entry');
  assert.equal(api.json.project.options[0].round.icd, 150);
  const out = await t.tool('change_option', { option: 'A', changes: [{ path: 'icd', value: 500 }], reason: 'huge' });
  assert.equal(out.isError, true);
  assert.match(out.summary, /^Inscribed circle diameter must be between 70 and 300 ft; 500 ft is outside that range\.$/);
  const noReason = await t.tool('change_option', { option: 'A', changes: [{ path: 'icd', value: 140 }] });
  assert.equal(noReason.isError, true);
  assert.match(noReason.summary, /reason is needed/);
  const badPath = await t.tool('change_option', { option: 'A', changes: [{ path: 'legs.N.colour', value: 1 }], reason: 'x' });
  assert.equal(badPath.isError, true);
  const extra = await t.tool('change_option', { option: 'A', changes: [{ path: 'icd', value: 140 }], reason: 'x', confirm: true });
  assert.match(extra.summary, /Unknown argument confirm/);
});

test('add_option, compare_options, sweep, undo, export_link', async () => {
  const t = await setup();
  const p = await t.newProject();
  const a = await t.tool('add_option', { from: 'A', name: 'Wider circle', reason: 'Try a wider circle beside the first' });
  assert.equal(a.isError, false, a.summary);
  assert.deepEqual(a.data.option, { id: 'B', name: 'Wider circle' });
  await t.tool('change_option', { option: 'B', changes: [{ path: 'icd', value: 160 }], reason: 'Wider' });

  const cmp = await t.tool('compare_options', {});
  assert.equal(cmp.isError, false);
  assert.deepEqual(cmp.data.rows.map(r => r.option), ['A', 'B']);
  assert.ok(cmp.data.rows[1].land_sqft > cmp.data.rows[0].land_sqft);
  assert.equal(cmp.summary.split('\n').length, 2);

  const before = (await t.call('GET', `/api/projects/${p.id}`)).json.project.seq;
  const sw = await t.tool('sweep', { option: 'A', path: 'legs.*.entryRadius', from: 40, to: 70, step: 10 });
  assert.equal(sw.isError, false, sw.summary);
  assert.deepEqual(sw.data.rows.map(r => r.value), [40, 50, 60, 70]);
  assert.match(sw.summary, /^Entry curb radius of every leg of Option A from 40 to 70: 4 values/);
  assert.match(sw.summary, /Nothing was changed\.$/);
  assert.equal((await t.call('GET', `/api/projects/${p.id}`)).json.project.seq, before);
  const tooMany = await t.tool('sweep', { option: 'A', path: 'icd', from: 70, to: 300, step: 1 });
  assert.match(tooMany.summary, /at most 25/);
  const outOfRange = await t.tool('sweep', { option: 'A', path: 'icd', from: 250, to: 350, step: 50 });
  assert.match(outOfRange.summary, /^Inscribed circle diameter must be between 70 and 300 ft/);

  // Her own change after Claude's: Claude's undo still takes Claude's own newest change.
  await t.call('POST', `/api/projects/${p.id}/changes`, { body: { ops: [{ op: 'set', option: 'A', path: 'apronWidth', value: 12 }] } });
  const u = await t.tool('undo', {});
  assert.equal(u.isError, false, u.summary);
  assert.match(u.summary, /^Undo: Wider \(change 2\)\. To put it back, call undo with seq 4\.$/);
  const redo = await t.tool('undo', { seq: 4 });
  assert.match(redo.summary, /^Redo: Wider/);
  const project = (await t.call('GET', `/api/projects/${p.id}`)).json.project;
  assert.equal(project.options[1].round.icd, 160);
  assert.equal(project.options[0].round.apronWidth, 12);

  const link = await t.tool('export_link', { option: 'B' });
  assert.equal(link.data.link, `https://fp.test/#p=${p.id}&o=B&do=export-dxf`);
  assert.ok(!link.data.link.includes(t.alice.key));
});

test('a tool that fails inside says so plainly, and the database\'s own words never reach Claude', async () => {
  const t = await setup();
  await t.newProject();
  t.db.exec('DROP TABLE changes');
  const r = await t.tool('change_option', { option: 'A', changes: [{ path: 'icd', value: 140 }], reason: 'x' });
  assert.equal(r.isError, true);
  assert.match(r.summary, /database could not do that just now/);
  assert.ok(!/SQLITE|D1_ERROR|no such table/.test(JSON.stringify(r)));
  const unknown = await t.tool('fly', {});
  assert.equal(unknown.isError, true);
});
