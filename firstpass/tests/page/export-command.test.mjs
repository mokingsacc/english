// The page's EXPORT (public/js/commands/export.js) without a browser: the file it builds for the option on screen is
// the DXF writer's text for that option's result with her local date, named <project>-<option>.dxf; a shape that
// cannot be built and an empty screen answer in plain words; the command echoes what it saved and hands the text to
// the download step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExport, localDate } from '../../public/js/commands/export.js';
import exportCommand from '../../public/js/commands/export.js';
import { sampleProject } from '../../public/js/app/sample.js';
import { evaluate } from '../../public/js/engine/evaluate.js';
import { toDxf, checkDxf } from '../../public/js/engine/export/dxf.js';
import { EXPORTS } from '../../public/js/engine/export/index.js';

function fakeApp(project, optionId = 'A') {
  return {
    project: () => project,
    option: () => (project ? project.options.find((o) => o.id === optionId) : null),
    evaluateOption: (o) => evaluate(o.round, project.rules || {}),
  };
}

test('localDate is her own calendar day as YYYY-MM-DD', () => {
  assert.equal(localDate(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(localDate(new Date(2026, 10, 11, 0, 1)), '2026-11-11');
  assert.match(localDate(), /^\d{4}-\d{2}-\d{2}$/);
});

test('buildExport: the writer\'s text for the option on screen, its name, and the DXF type', () => {
  const p = sampleProject();
  const opt = p.options[0];
  const r = buildExport(fakeApp(p));
  assert.equal(r.ok, true, r.error);
  assert.equal(r.file, 'Sample-roundabout-A.dxf');
  assert.equal(r.mime, 'application/dxf');
  const want = toDxf(evaluate(opt.round, p.rules || {}), { name: p.name, epsg: p.epsg, option: { id: opt.id, name: opt.name }, date: localDate() });
  assert.equal(r.text, want);
  assert.deepEqual(checkDxf(r.text).problems, []);
});

test('buildExport refuses in plain words: nothing on screen, or a shape that cannot be built', () => {
  assert.deepEqual(buildExport(fakeApp(null)), { ok: false, error: 'There is no option on screen to export.' });
  const p = sampleProject();
  p.options[0].round.icd = 5000;
  const r = buildExport(fakeApp(p));
  assert.equal(r.ok, false);
  assert.match(r.error, /^This option cannot be built, so there is no drawing to export\. /);
  assert.doesNotMatch(r.error, /undefined|NaN|Error:/);
});

test('EXPORT echoes the file it saved, with the option and the zone, and asks nothing while DXF is the only export', async () => {
  assert.equal(EXPORTS.length, 1);
  const p = sampleProject();
  const echoes = [];
  let asked = false;
  const saved = [];
  const g = globalThis;
  const had = { document: g.document, URL: g.URL };
  // A stand-in for the browser's download: an anchor that records its file name.
  g.document = { createElement: () => ({ style: {}, click() { saved.push(this.download); }, remove() {} }), body: { appendChild() {} } };
  const realURL = g.URL;
  g.URL = Object.assign(function U(...a) { return new realURL(...a); }, { createObjectURL: () => 'blob:x', revokeObjectURL() {} });
  try {
    const app = fakeApp(p);
    await exportCommand.run({ app, option: app.option, project: app.project, keyword: async () => { asked = true; return 'DXF'; }, echo: (t, kind) => echoes.push([t, kind]) });
  } finally {
    g.document = had.document;
    g.URL = had.URL;
  }
  assert.equal(asked, false);
  assert.deepEqual(saved, ['Sample-roundabout-A.dxf']);
  assert.equal(echoes.length, 1);
  assert.match(echoes[0][0], /^Saved Sample-roundabout-A\.dxf: Option A, CCS83 Zone 2, US survey feet\.$/);
  assert.equal(echoes[0][1], 'done');
});
