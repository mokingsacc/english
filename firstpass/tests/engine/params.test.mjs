import test from 'node:test';
import assert from 'node:assert/strict';
import { PARAMS, LEG_PARAMS, ROUND_PARAMS, paramFor, legField, LEG_COUNT } from '../../public/js/engine/roundabout/params.js';
import { defaultRoundabout, defaultLeg, validate, clamp, getAt, setAt } from '../../public/js/engine/roundabout/model.js';

test('every parameter row is complete and its default lies within its range', () => {
  const paths = new Set();
  for (const p of PARAMS) {
    assert.ok(!paths.has(p.path), p.path);
    paths.add(p.path);
    for (const k of ['min', 'max', 'step', 'default']) assert.ok(Number.isFinite(p[k]), `${p.path} ${k}`);
    assert.ok(p.min <= p.default && p.default <= p.max, p.path);
    assert.ok(p.step > 0);
    for (const k of ['label', 'unit', 'group', 'help']) assert.ok(typeof p[k] === 'string' && p[k].length, `${p.path} ${k}`);
  }
  assert.equal(LEG_PARAMS.length + ROUND_PARAMS.length, PARAMS.length);
  assert.equal(legField(paramFor('legs.*.entryRadius')), 'entryRadius');
});

test('the data model fields are exactly the parameters in the table', () => {
  const r = defaultRoundabout();
  assert.deepEqual(Object.keys(r).sort(), ['apronWidth', 'center', 'circWidth', 'icd', 'legs']);
  assert.equal(r.legs.length, 4);
  const legKeys = Object.keys(r.legs[0]).filter((k) => k !== 'id' && k !== 'name').sort();
  assert.deepEqual(legKeys, LEG_PARAMS.map(legField).sort());
  assert.deepEqual(r.legs.map((l) => l.id), ['N', 'E', 'S', 'W']);
  assert.deepEqual(r.legs.map((l) => l.name), ['North leg', 'East leg', 'South leg', 'West leg']);
  assert.equal(r.icd, 130); assert.equal(r.circWidth, 18); assert.equal(r.legs[0].entryRadius, 50);
  // The default sizes (second engine pass): see the geometry tests for the slack they leave at every corner.
  assert.deepEqual([r.legs[0].entryWidth, r.legs[0].exitWidth, r.legs[0].exitRadius], [16.5, 18, 65]);
});

test('paths name parameters by leg position or leg id', () => {
  assert.equal(paramFor('icd').path, 'icd');
  assert.equal(paramFor('legs.2.entryRadius').path, 'legs.*.entryRadius');
  assert.equal(paramFor('legs.N.entryRadius').path, 'legs.*.entryRadius');
  assert.equal(paramFor('legs.N.colour'), null);
  assert.equal(paramFor(7), null);
  const r = defaultRoundabout();
  assert.equal(getAt(r, 'legs.E.bearing'), 90);
  assert.equal(getAt(r, 'legs.3.bearing'), 270);
  assert.equal(getAt(r, 'center.x'), 6000000);
  const r2 = setAt(r, 'legs.S.entryRadius', 80);
  assert.equal(getAt(r2, 'legs.2.entryRadius'), 80);
  assert.equal(getAt(r, 'legs.2.entryRadius'), 50, 'the original is unchanged');
  assert.equal(setAt(r, 'legs.Q.entryRadius', 80), null);
  assert.equal(setAt(r, 'nonsense', 1), null);
});

test('validation fills gaps, reports bad values in plain words and never throws', () => {
  const v = validate(defaultRoundabout());
  assert.ok(v.ok);
  assert.deepEqual(v.problems, []);

  const r = defaultRoundabout();
  delete r.icd;
  r.legs[0].entryRadius = 'big';
  r.legs[1].exitRadius = 9999;
  r.legs[2].bearing = -90;
  const w = validate(r);
  assert.equal(w.ok, false);
  assert.ok(w.filled.includes('icd'));
  assert.equal(w.value.icd, 130);
  assert.equal(w.value.legs[2].bearing, 270);
  assert.equal(w.problems.length, 2);
  assert.match(w.problems[0], /entry curb radius of the North leg/);
  assert.match(w.problems[1], /outside the allowed range/);

  for (const junk of [null, undefined, 1, 'x', [], { legs: 'none' }, { legs: [null, 1, 'a'] }]) {
    const out = validate(junk);
    assert.equal(out.ok, false);
    assert.ok(out.problems.length > 0);
  }
  const few = defaultRoundabout();
  few.legs = few.legs.slice(0, 2);
  assert.match(validate(few).problems[0], new RegExp(`at least ${LEG_COUNT.min} legs`));
  const many = defaultRoundabout();
  many.legs = [0, 50, 100, 150, 200, 250, 300].map((b, i) => defaultLeg(b, `L${i}`));
  assert.match(validate(many).problems[0], /at most 6 legs/);
  const dup = defaultRoundabout();
  dup.legs[1].id = 'N';
  assert.match(validate(dup).problems.join(' '), /share the id/);
});

test('clamping pulls values into range and fills broken ones', () => {
  const r = defaultRoundabout();
  r.icd = 5000; r.circWidth = NaN; r.legs[0].entryRadius = -3;
  const c = clamp(r);
  assert.equal(c.icd, 300);
  assert.equal(c.circWidth, 18);
  assert.equal(c.legs[0].entryRadius, 30);
  assert.ok(validate(c).ok);
  assert.doesNotThrow(() => clamp(null));
});
