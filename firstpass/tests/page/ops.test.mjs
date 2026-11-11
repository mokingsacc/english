// The page's change ops: the builders, the local apply (checked against the parameters and rules tables in plain
// words), and that they stay in step with the server's ops (src/worker/store/ops.js) on the same changes, so a change
// shown at once on the page is the change the server keeps. Also the sample project matches the server's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { op, applyOps, OpRefused, nextOptionId, freeBearing, sameDrawing, describe, MAX_OPTIONS, inCalifornia, placeSite } from '../../public/js/app/ops.js';
import { fromLatLon } from '../../public/js/engine/crs.js';
import { sampleProject, SAMPLE_SITE, zoneText } from '../../public/js/app/sample.js';
import { paramFor, ruleById, RULES } from '../../public/js/engine/index.js';
import { resolveAndApply, canonicalDoc, LIMITS, summarize } from '../../src/worker/store/ops.js';
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
    [op.setSite(34.0522, -118.2437)],
    [op.addOption('A', 'B'), op.set('B', 'center.x', p.options[0].round.center.x + 300), op.setSite(37.7749, -122.4194, null, 'B')],
    [op.setSite(37.7749, -122.4194, 2226)],
    [op.setSite(34.0522, -118.2437), op.setSite(37.7749, -122.4194)],
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
    [op.setSite(36.1699, -115.1398)],
    [op.setSite(34.0522, -118.2437, 4326)],
    [op.setSite(-118.2437, 34.0522)],
    [op.setSite(34.0522, -118.2437, null, 'Q')],
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

test('a site in California places the drawing in its zone on the page as on the server: Los Angeles zone 5, San Francisco zone 3', () => {
  const p = project();
  const la = applyOps(p, [op.setSite(34.0522, -118.2437)]);
  assert.equal(la.epsg, 2229);
  assert.deepEqual(la.site, { lat: 34.0522, lon: -118.2437 });
  const want = fromLatLon(2229, 34.0522, -118.2437);
  assert.ok(Math.abs(la.options[0].round.center.x - want.x) < 0.006 && Math.abs(la.options[0].round.center.y - want.y) < 0.006);
  assert.deepEqual(la.options[0].round.legs, p.options[0].round.legs, 'legs and bearings stay');
  const sf = applyOps(la, [op.setSite(37.7749, -122.4194)]);
  assert.equal(sf.epsg, 2227);
  assert.ok(!sameDrawing(p, la) && !sameDrawing(la, sf));
  assert.ok(!sameDrawing(la, applyOps(la, [op.setSite(34.0522, -118.2437, 2228)])), 'a zone alone is a change too');
  // The page names it in the words the server keeps.
  assert.equal(describe(p, [op.setSite(34.0522, -118.2437)]), summarize(canonicalDoc(p), resolveAndApply(canonicalDoc(p), [op.setSite(34.0522, -118.2437)]).ops));
  assert.equal(describe(p, [op.setSite(34.0522, -118.2437)]), 'Placed the drawing at 34.0522, -118.2437 in California zone 5 (EPSG 2229), was zone 2');
  assert.throws(() => applyOps(p, [op.setSite(36.1699, -115.1398)]), /: 36\.1699, -115\.1398 is outside California\./);
});

test('California\'s outline takes its cities and its edges, and leaves out its neighbours', () => {
  const inside = [[34.0522, -118.2437], [37.7749, -122.4194], [32.7157, -117.1611], [40.8, -124.16], [41.756, -124.2], [41.49, -120.54],
    [38.94, -119.98], [39.33, -120.18], [33.61, -114.596], [34.85, -114.61], [36.46, -116.87], [34.45, -120.47], [32.9, -118.5], [32.68, -115.5]];
  const outside = [[36.1699, -115.1398], [39.5296, -119.8138], [32.5149, -117.0382], [42.05, -124.28], [45.5, -122.6], [33.45, -112.07], [40.71, -74.0], [35, -125]];
  for (const [lat, lon] of inside) assert.ok(inCalifornia(lat, lon), `${lat}, ${lon}`);
  for (const [lat, lon] of outside) assert.ok(!inCalifornia(lat, lon), `${lat}, ${lon}`);
  assert.throws(() => placeSite(project(), { lat: 34, lon: -118, epsg: 2231 }), /EPSG 2225 to 2230/);
});
