// The connector's leg view (src/worker/mcp/common.js legsView, in get_option): each leg's fastest path radii and speeds,
// and as_built, the curb radii, widths and splitter island the engine built where they differ from what was asked (the
// splitter width where it meets the circle as its own number, since it is another place than the body width asked). The
// expected values come from evaluate at the time of the test, never from the engine's default numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';
import { legsView, BUILT, r1 } from '../../src/worker/mcp/common.js';
import { evaluate } from '../../public/js/engine/evaluate.js';

/** What as_built should be for one leg of a result against the asked leg. */
function expected(builtLeg, askedLeg) {
  const out = {};
  for (const [b, p, key] of BUILT) {
    const v = builtLeg[b], q = askedLeg[p];
    if (typeof v === 'number' && Number.isFinite(v) && typeof q === 'number' && Math.abs(v - q) > 0.05) {
      if (key) out[key] = r1(v); else out[p] = { asked: q, built: r1(v) };
    }
  }
  return Object.keys(out).length ? out : undefined;
}

test('legsView: as_built only for the values that differ, rounded, and never without the asked values', () => {
  const legs = [
    { id: 'N', name: 'North', bearing: 0, R: { R1: 99.94 }, V: { V1: 20.26 }, entryRadiusBuilt: 52.34, exitRadiusBuilt: 80, entryWidthBuilt: 16.03, exitWidthBuilt: 18.26, splitterWidthAtCircle: 9.7, splitterLengthBuilt: 110 },
    { id: 'S', name: 'South', bearing: 180, R: {}, V: {}, entryRadiusBuilt: 60, exitRadiusBuilt: 80, entryWidthBuilt: 16, exitWidthBuilt: 17, splitterWidthAtCircle: 14, splitterLengthBuilt: 110 },
    { id: 'E', name: 'East', bearing: 90, R: {}, V: {} },
  ];
  const ask = { entryRadius: 60, exitRadius: 80, entryWidth: 16, exitWidth: 17, splitterWidth: 14, splitterLength: 110 };
  const round = { legs: [{ id: 'N', ...ask }, { id: 'S', ...ask }, { id: 'E', ...ask }] };
  const v = legsView(legs, round);
  assert.deepEqual(v[0], { id: 'N', name: 'North', bearing: 0, R: { R1: 99.9 }, V: { V1: 20.3 },
    as_built: { entryRadius: { asked: 60, built: 52.3 }, exitWidth: { asked: 17, built: 18.3 }, splitterWidthAtCircle: 9.7 } });
  assert.equal('as_built' in v[1], false, 'built as asked');
  assert.equal('as_built' in v[2], false, 'the engine reports no built values');
  assert.equal(legsView(legs).every(l => !('as_built' in l)), true, 'no asked values, nothing to compare');
  assert.deepEqual(legsView(null), []);
});

test('get_option shows each leg as the engine built it', async (tc) => {
  const t = await setup();
  const sample = await t.newProject();
  // Short splitter islands and a narrow entry: the kind of asking the engine may build otherwise.
  const round = structuredClone(sample.options[0].round);
  for (const l of round.legs) { l.splitterLength = 20; l.entryRadius = 30; }
  const p = await t.newProject({ name: 'Built check', round });
  const go = await t.tool('get_option', { project: p.id, option: 'A' });
  assert.ok(!go.isError, go.summary);
  const opt = p.options[0];
  const r = evaluate(opt.round, p.rules);
  assert.equal(go.data.legs.length, r.legs.length);
  let differing = 0;
  for (const [i, leg] of go.data.legs.entries()) {
    const want = expected(r.legs[i], opt.round.legs.find(l => l.id === leg.id));
    assert.deepEqual(leg.as_built, want, `leg ${leg.id}`);
    if (want) differing++;
    for (const k of Object.keys(leg.as_built || {})) assert.ok(BUILT.some(([, q, key]) => (key || q) === k));
  }
  // The sample asked as the engine builds it, or not: either way the tool says what evaluate says.
  const s = await t.tool('get_option', { project: sample.id, option: 'A' });
  const rs = evaluate(sample.options[0].round, sample.rules);
  for (const [i, leg] of s.data.legs.entries()) assert.deepEqual(leg.as_built, expected(rs.legs[i], sample.options[0].round.legs[i]));
  if (!differing) tc.diagnostic('the engine built every leg of the short-splitter project as asked');
});

test('get_option stays inside the connector\'s size limit with as_built on every leg', async () => {
  const t = await setup();
  const list = await t.mcp('tools/list');
  assert.ok(JSON.stringify(list.json.result.tools).length < 12000);
  const desc = list.json.result.tools.find(x => x.name === 'get_option').description;
  assert.match(desc, /as_built/);
});
