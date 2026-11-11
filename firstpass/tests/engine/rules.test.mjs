import test from 'node:test';
import assert from 'node:assert/strict';
import { RULES, ruleById, resolveRules } from '../../public/js/engine/rules.js';

test('every rule row is complete and its value lies within its own range', () => {
  const ids = new Set();
  for (const r of RULES) {
    assert.ok(typeof r.id === 'string' && /^[a-z]+(\.[A-Za-z]+)+$/.test(r.id), r.id);
    assert.ok(!ids.has(r.id), `duplicate ${r.id}`);
    ids.add(r.id);
    for (const k of ['value', 'min', 'max']) assert.ok(Number.isFinite(r[k]), `${r.id} ${k}`);
    assert.ok(r.min <= r.value && r.value <= r.max, r.id);
    assert.equal(typeof r.verify, 'boolean', r.id);
    assert.ok(typeof r.unit === 'string' && r.unit.length, r.id);
    assert.ok(typeof r.label === 'string' && r.label.length > 10, r.id);
    assert.ok(typeof r.source === 'string' && r.source.length > 5, r.id);
    assert.equal(ruleById(r.id), r);
  }
});

test('every constant taken from NCHRP Report 672 is marked to be checked against the source', () => {
  for (const r of RULES) {
    if (/NCHRP Report 672/.test(r.source)) assert.equal(r.verify, true, r.id);
  }
  for (const id of ['speed.eq.pos.k', 'speed.eq.pos.p', 'speed.eq.neg.k', 'speed.eq.neg.p', 'speed.decel', 'speed.accel',
    'speed.entry.max', 'speed.consistency.warn', 'speed.consistency.fail', 'fp.offset.curb', 'fp.offset.centerline',
    'fp.offset.paint', 'fp.window', 'sight.isd.criticalHeadway']) {
    assert.equal(ruleById(id).verify, true, id);
  }
});

test('project overrides are applied, and bad ones are reported without being used', () => {
  const ok = resolveRules({ 'speed.entry.max': 20 });
  assert.equal(ok.get('speed.entry.max'), 20);
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.overridden, ['speed.entry.max']);

  const bad = resolveRules({ 'speed.entry.max': 500, 'fp.offset.curb': 'five', 'no.such.rule': 3 });
  assert.equal(bad.get('speed.entry.max'), 25);
  assert.equal(bad.get('fp.offset.curb'), 5);
  assert.equal(bad.problems.length, 2);
  for (const p of bad.problems) assert.match(p, /^The project setting for the /);

  for (const junk of [null, undefined, 3, 'x', []]) {
    const r = resolveRules(junk);
    assert.equal(r.get('fp.window'), 65);
    assert.deepEqual(r.problems, []);
  }
  assert.throws(() => resolveRules({}).get('not.a.rule'));
});
