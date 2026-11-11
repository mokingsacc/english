// The page's change ops: the builders, the local apply (checked against the parameters and rules tables in plain
// words), and that they stay in step with the server's ops (src/worker/store/ops.js) on the same changes, so a change
// shown at once on the page is the change the server keeps. Also the sample project matches the server's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { op, applyOps, OpRefused, nextOptionId, freeBearing, sameDrawing, describe, MAX_OPTIONS } from '../../public/js/app/ops.js';
import { sampleProject, SAMPLE_SITE, zoneText } from '../../public/js/app/sample.js';
import { paramFor, ruleById, RULES } from '../../public/js/engine/index.js';
import { resolveAndApply, canonicalDoc, LIMITS } from '../../src/worker/store/ops.js';
import { SAMPLE } from '../../src/worker/store/projects.js';

const project = () => ({ ...sampleProject(), id: 'p_test', seq: 3 });
const serverApply = (doc, ops) => canonicalDoc(resolveAndApply(canonicalDoc(doc), ops).doc);
const pageApply = (doc, ops) => canonicalDoc(applyOps(doc, ops));

test('the builders make the ops the server reads', () => {
  assert.deepEqual(op.set('A', 'icd', 120), { op: 'set', option: 'A', path: 'icd', value: 120 });
  assert.deepEqual(op.addOption('A', 'B'), { op: 'add_option', from: 'A', id: 'B' });
  assert.deepEqual(op.addOption(), { op: 'add_option' });
  assert.deepEqual(op.addLeg('A'), { op: 'add_leg', option: 'A' });
  assert.deepEqual(op.setRule('x', null), { op: 'set_rule', rule: 'x', value: null });
});

test('applying ops leaves the input alone and gives the changed project', () => {
  const p = project();
  const before = JSON.stringify(p);
  const icd = paramFor('icd');
  const want = Math.min(icd.max, p.options[0].round.icd + 10);
  const q = applyOps(p, [op.set('A', 'icd', want), op.addOption('A', 'B'), op.renameOption('B', 'Bigger')]);
  assert.equal(JSON.stringify(p), before);
  assert.equal(q.options[0].round.icd, want);
  assert.equal(q.options[1].name, 'Bigger');
  assert.deepEqual(q.options[1].round, q.options[0].round);
  assert.ok(!sameDrawing(p, q));
  assert.ok(sameDrawing(p, { ...p, seq: 99 }));
});

test('page and server give the same project for the same changes', () => {
  const p = project();
  const leg = p.options[0].round.legs[0];
  const ew = paramFor('legs.*.entryWidth');
  const rule = RULES.find((r) => r.max > r.min);
  const sequences = [
    [op.set('A', 'icd', paramFor('icd').min + 1)],
    [op.set('A', 'center.x', p.options[0].round.center.x + 12.5), op.set('A', 'center.y', p.options[0].round.center.y - 3)],
    [op.set('A', `legs.${leg.id}.entryWidth`, ew.min + 0.5)],
    [op.set('A', 'legs.*.splitterLength', paramFor('legs.*.splitterLength').min)],
    [op.set('A', `legs.${leg.id}.name`, 'Main Street')],
    [op.addOption('A', 'B'), op.set('B', 'icd', paramFor('icd').max)],
    [op.addOption()],
    [op.addLeg('A')],
    [op.addLeg('A', 45)],
    [op.removeLeg('A', leg.id)],
    [op.addOption('A', 'B'), op.removeOption('A')],
    [op.setRule(rule.id, rule.min), op.setRule(rule.id, null)],
    [op.setRule(rule.id, rule.max)],
  ];
  for (const ops of sequences) assert.deepEqual(pageApply(p, ops), serverApply(p, ops), JSON.stringify(ops));
});

test('page and server refuse the same changes, and the page says why in plain words', () => {
  const p = project();
  const icd = paramFor('icd');
  const refused = [
    [op.set('A', 'icd', icd.max + 1)],
    [op.set('A', 'icd', 'big')],
    [op.set('Z', 'icd', icd.min)],
    [op.set('A', 'legs.Q.entryWidth', 16)],
    [op.set('A', 'nonsense', 1)],
    [op.removeOption('A')],
    [op.renameOption('A', '   ')],
    [op.removeLeg('A', 'nope')],
    [op.setRule('no-such-rule', 1)],
  ];
  for (const ops of refused) {
    assert.throws(() => applyOps(p, ops), OpRefused, JSON.stringify(ops));
    assert.throws(() => resolveAndApply(canonicalDoc(p), ops), undefined, `server accepted ${JSON.stringify(ops)}`);
  }
  try { applyOps(p, [op.set('A', 'icd', icd.max + 1)]); } catch (e) {
    assert.match(e.message, new RegExp(`^${icd.label} must be between ${icd.min} and ${icd.max} ${icd.unit}`));
    assert.doesNotMatch(e.message, /->|=>|[<>]/);
  }
});

test('a roundabout keeps its smallest number of legs and a project its last option', () => {
  let p = project();
  const legs = p.options[0].round.legs;
  let refusedAt = null;
  for (let i = 0; i < legs.length; i++) {
    try { p = applyOps(p, [op.removeLeg('A', p.options[0].round.legs[0].id)]); } catch (e) { refusedAt = e; break; }
  }
  assert.ok(refusedAt instanceof OpRefused);
  assert.match(refusedAt.message, /^A roundabout needs at least \d+ legs/);
});

test('option ids run A, B, C and options stop at the limit', () => {
  let p = project();
  assert.equal(nextOptionId(p), 'B');
  for (let i = 1; i < MAX_OPTIONS; i++) p = applyOps(p, [op.addOption('A')]);
  assert.equal(p.options.length, MAX_OPTIONS);
  assert.equal(MAX_OPTIONS, LIMITS.options);
  assert.throws(() => applyOps(p, [op.addOption('A')]), /at most/);
});

test('a new leg goes in the middle of the widest gap', () => {
  assert.equal(freeBearing([{ bearing: 0 }, { bearing: 90 }, { bearing: 180 }]), 270);
  assert.equal(freeBearing([{ bearing: 10 }, { bearing: 20 }]), 195);
  assert.equal(freeBearing([]), 0);
});

test('a change is named in the words the history uses', () => {
  const p = project();
  const icd = paramFor('icd');
  assert.equal(describe(p, [op.set('A', 'icd', 120)]), `${icd.label} set to 120 ${icd.unit}`);
  assert.equal(describe(p, [op.set('A', 'center.x', 1), op.set('A', 'center.y', 2)]), 'Moved the centre');
  assert.match(describe(p, [op.removeLeg('A', p.options[0].round.legs[0].id)]), /^Removed the .+ from Option A$/);
  const r = RULES[0];
  assert.equal(describe(p, [op.setRule(r.id, null)]), `${ruleById(r.id).label} put back to the standard value`);
});

test('the page sample is the server sample', () => {
  assert.equal(SAMPLE_SITE.name, SAMPLE.name);
  assert.equal(SAMPLE_SITE.epsg, SAMPLE.epsg);
  assert.deepEqual(SAMPLE_SITE.site, SAMPLE.site);
  assert.deepEqual(SAMPLE_SITE.center, SAMPLE.center);
  const p = sampleProject();
  assert.deepEqual(p.options[0].round.center, SAMPLE.center);
  assert.equal(zoneText(2226), 'CCS83 Zone 2, US survey feet');
});
