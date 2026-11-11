// GET /api/projects/:id/export/<option>.dxf: the option as a DXF to save, the same text the page builds in her browser
// from the same project (public/js/engine/export/dxf.js), with a download header; refusals in plain words (an option or
// a file ending there is not, a shape that cannot be built, no key, another user's project).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';
import { evaluate } from '../../public/js/engine/evaluate.js';
import { toDxf, checkDxf } from '../../public/js/engine/export/dxf.js';
import { exportFileName } from '../../public/js/engine/export/index.js';

const today = () => new Date().toISOString().slice(0, 10);

test('an option as a DXF: the page\'s own text, a download header, and never cached', async () => {
  const t = await setup();
  const p = await t.newProject();
  const r = await t.call('GET', `/api/projects/${p.id}/export/A.dxf`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/dxf');
  assert.equal(r.headers.get('content-disposition'), `attachment; filename="${exportFileName(p.name, 'A', 'dxf')}"`);
  assert.equal(r.headers.get('content-disposition'), 'attachment; filename="Sample-roundabout-A.dxf"');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.ok(r.headers.get('x-trace-id'), 'traced like every /api call');
  const opt = p.options[0];
  const page = toDxf(evaluate(opt.round, p.rules), { name: p.name, epsg: p.epsg, option: { id: opt.id, name: opt.name }, date: today() });
  assert.equal(r.text, page, 'the same text as the page builds from the same project');
  assert.deepEqual(checkDxf(r.text).problems, []);
  assert.match(r.text, /CCS83 zone 2 \(EPSG 2226\)/);
});

test('the export follows the drawing: a change, then another option', async () => {
  const t = await setup();
  const p = await t.newProject();
  await t.call('POST', `/api/projects/${p.id}/changes`, { body: { ops: [{ op: 'set', option: 'A', path: 'icd', value: 150 }, { op: 'add_option', from: 'A' }] } });
  const proj = (await t.call('GET', `/api/projects/${p.id}`)).json.project;
  assert.deepEqual(proj.options.map(o => o.id), ['A', 'B']);
  const b = await t.call('GET', `/api/projects/${p.id}/export/B.dxf`);
  assert.equal(b.status, 200);
  assert.equal(b.headers.get('content-disposition'), 'attachment; filename="Sample-roundabout-B.dxf"');
  // The inscribed circle is written as true arcs of radius 75 ft about the centre.
  const c = proj.options[1].round.center;
  const arcs = [...b.text.matchAll(/  8\r\nFP-INSCRIBED\r\n100\r\nAcDbCircle\r\n 10\r\n([^\r]+)\r\n 20\r\n([^\r]+)\r\n 30\r\n0\.0\r\n 40\r\n([^\r]+)\r\n/g)];
  assert.ok(arcs.length >= 2);
  for (const m of arcs) {
    assert.ok(Math.abs(Number(m[1]) - c.x) < 1e-6 && Math.abs(Number(m[2]) - c.y) < 1e-6);
    assert.equal(Number(m[3]), 75);
  }
  assert.match(b.text, /Option B of Sample roundabout\./);
});

test('refusals in plain words: no such option, a file ending it does not make, a shape that cannot be built', async () => {
  const t = await setup();
  const p = await t.newProject();
  const none = await t.call('GET', `/api/projects/${p.id}/export/C.dxf`);
  assert.equal(none.status, 404);
  assert.equal(none.json.error, 'There is no option C in this project.');
  assert.equal(none.headers.get('cache-control'), 'no-store');
  const ending = await t.call('GET', `/api/projects/${p.id}/export/A.dwg`);
  assert.equal(ending.status, 404);
  assert.match(ending.json.error, /as <option id>\.dxf, such as A\.dxf/);
  assert.equal((await t.call('GET', `/api/projects/nope/export/A.dxf`)).status, 404);
  assert.equal((await t.call('GET', `/api/projects/${p.id}/export/A.dxf`, { key: null })).status, 401);
  assert.equal((await t.call('GET', `/api/projects/${p.id}/export/A.dxf`, { key: t.bob.key })).status, 404);
  assert.equal((await t.call('POST', `/api/projects/${p.id}/export/A.dxf`, { body: {} })).status, 405);

  // Three legs crowded together: stored (each number is in range) but not buildable.
  const bad = await t.newProject({ name: 'Crowded', round: { center: { x: 6e6, y: 2e6 }, icd: 80, legs: [{ id: 'N', bearing: 0 }, { id: 'E', bearing: 8 }, { id: 'S', bearing: 180 }] } });
  assert.equal(evaluate(bad.options[0].round, {}).ok, false, 'the engine cannot build it');
  const r = await t.call('GET', `/api/projects/${bad.id}/export/A.dxf`);
  assert.equal(r.status, 422);
  assert.match(r.json.error, /^This option cannot be built, so there is no drawing to export\. /);
});
