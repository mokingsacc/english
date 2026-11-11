// The Checks tab's words and notes and the first view, against whatever evaluate gives today (no engine numbers here):
// "No problems" with a blank limit for the shape check, a value that would read the same as its limit gets another
// decimal, the engine's warning and information lines are the notes shown under a check, and the first view is framed
// on the roundabout, inside the extents.
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, defaultRoundabout } from '../../public/js/engine/index.js';
import { checkNotes, valueAndLimit, fmtCheckValue } from '../../public/js/ui/checks-view.js';
import { indexOf, FIRST_VIEW_MARGIN } from '../../public/js/app/model-index.js';

const geometryOf = (res) => res.checks.find((c) => c.id === 'geometry');

test('the shape check reads "No problems" with a blank limit, and counts problems when there are some', () => {
  const g = geometryOf(evaluate(defaultRoundabout(), {}));
  assert.equal(g.unit, 'problems');
  assert.deepEqual(valueAndLimit({ ...g, value: 0 }), ['No problems', '']);
  assert.deepEqual(valueAndLimit({ ...g, value: 1 }), ['1 problem', '']);
  assert.deepEqual(valueAndLimit({ ...g, value: 3 }), ['3 problems', '']);
});

test('a value that would read the same as its limit is written with another decimal', () => {
  assert.deepEqual(valueAndLimit({ value: 25.03, limit: 25, unit: 'mph' }), ['25.03 mph', '25.0 mph']);
  assert.deepEqual(valueAndLimit({ value: 25, limit: 25, unit: 'mph' }), ['25.0 mph', '25.0 mph']);
  assert.deepEqual(valueAndLimit({ value: 23.71, limit: 25, unit: 'mph' }), ['23.7 mph', '25.0 mph']);
  assert.equal(fmtCheckValue(null, 'mph'), '-');
});

test('counts read as whole numbers with no limit: no problems, 1 problem, 1 warning, 2 warnings', () => {
  assert.deepEqual(valueAndLimit({ value: 0, limit: 0, unit: 'problems' }), ['No problems', '']);
  assert.deepEqual(valueAndLimit({ value: 1, limit: 0, unit: 'problem' }), ['1 problem', '']);
  assert.deepEqual(valueAndLimit({ value: 1, limit: 0, unit: 'warning' }), ['1 warning', '']);
  assert.deepEqual(valueAndLimit({ value: 2, limit: 0, unit: 'warnings' }), ['2 warnings', '']);
  assert.deepEqual(valueAndLimit({ value: 3, limit: null, unit: 'problems' }), ['3 problems', '']);
});

test('the notes under a check are its warning and information lines, and an information-only check has none', () => {
  // A leg turned until a corner is built with shorter curves, and an entry widened until its island is built longer:
  // both found by stepping one value, so no engine number is written here.
  let turned = null;
  for (let t = 1; t < 40 && !turned; t++) {
    const r = defaultRoundabout(); r.legs[1].bearing += t;
    const res = evaluate(r, {});
    if (res.ok && geometryOf(res).status === 'warn') turned = res;
  }
  assert.ok(turned, 'turning a leg makes the shape check warn');
  const notes = checkNotes(geometryOf(turned));
  assert.ok(notes.some((n) => n.status === 'warn'), 'the warning is a note');
  assert.ok(notes.every((n) => n.status === 'warn' || n.status === 'info'));
  let wide = null;
  for (let w = 16; w < 30 && !wide; w += 0.5) {
    const r = defaultRoundabout(); r.legs[0].entryWidth = w;
    const res = evaluate(r, {});
    if (res.ok && res.geometry.legs[0].splitterLengthBuilt > r.legs[0].splitterLength + 0.5) wide = res;
  }
  assert.ok(wide, 'a wider entry builds a longer island');
  assert.ok(checkNotes(geometryOf(wide)).some((n) => n.status === 'info' && n.leg === wide.geometry.legs[0].id), 'the longer island is an information note');
  const plain = evaluate(defaultRoundabout(), {});
  for (const c of plain.checks.filter((x) => x.status === 'info')) assert.deepEqual(checkNotes(c), [], `${c.id} only informs`);
  assert.deepEqual(checkNotes(null), []);
});

test('the first view frames the circle, the islands as built and the curb curves with a margin, inside the extents', () => {
  const res = evaluate(defaultRoundabout(), {});
  const ix = indexOf(res);
  const v = ix.firstView, e = ix.extents, G = res.geometry;
  const inside = (p, b) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
  for (const L of G.legs) {
    assert.ok(inside(L.nose, v), `${L.id}: the island's nose as built is in the first view`);
    assert.ok(!inside(L.far, v), `${L.id}: the far end of the road is not`);
  }
  assert.ok(v.x0 <= G.center.x - G.radii.inscribed - FIRST_VIEW_MARGIN + 1e-6 && v.x1 >= G.center.x + G.radii.inscribed + FIRST_VIEW_MARGIN - 1e-6);
  assert.ok(v.x1 - v.x0 < e.x1 - e.x0 && v.y1 - v.y0 < e.y1 - e.y0, 'smaller than the extents');
});
