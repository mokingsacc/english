// The change log: every op applied, refused in plain words, inverted exactly; undo (and undo of an undo) through the store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';
import { applyChange, undoChange } from '../../src/worker/store/change.js';
import { resolveAndApply, applyResolved, invertOps, OpError, freeBearing, overlaps } from '../../src/worker/store/ops.js';
import { PARAMS, LEG_PARAMS, legField } from '../../src/worker/engine.js';
import { newDoc } from '../../src/worker/store/projects.js';

const docText = (t, id) => t.row('SELECT doc FROM projects WHERE id = ?', id).doc;
const seqOf = (t, id) => t.row('SELECT seq FROM projects WHERE id = ?', id).seq;

async function fresh() {
  const t = await setup();
  const p = await t.newProject();
  return { t, p, ref: { id: p.id, user_id: t.alice.id } };
}

/** Apply ops by the user, then undo; the stored project must be byte-identical to before. */
async function roundTrip(t, ref, ops) {
  const before = docText(t, ref.id);
  const r = await applyChange(t.DB, ref, { ops, actor: 'user' });
  assert.equal(r.ok, true, r.error);
  assert.notEqual(docText(t, ref.id), before, 'the change changed nothing');
  const u = await undoChange(t.DB, ref, { actor: 'user', seq: r.seq });
  assert.equal(u.ok, true, u.error);
  assert.equal(docText(t, ref.id), before);
  return r;
}

test('every op, applied then undone, gives back the byte-identical project', async () => {
  const { t, ref } = await fresh();
  await roundTrip(t, ref, [{ op: 'set', option: 'A', path: 'icd', value: 150 }]);
  await roundTrip(t, ref, [{ op: 'set', option: 'A', path: 'center.x', value: 6636100 }, { op: 'set', option: 'A', path: 'center.y', value: 1976800 }]);
  await roundTrip(t, ref, [{ op: 'set', option: 'A', path: 'legs.0.entryRadius', value: 55 }]);
  await roundTrip(t, ref, [{ op: 'set', option: 'A', path: 'legs.*.exitRadius', value: 200 }]);
  await roundTrip(t, ref, [{ op: 'set', option: 'A', path: 'legs.E.name', value: 'Main Street' }]);
  await roundTrip(t, ref, [{ op: 'add_option', from: 'A' }]);
  await roundTrip(t, ref, [{ op: 'add_option' }]);
  await roundTrip(t, ref, [{ op: 'rename_option', option: 'A', name: 'Smaller circle' }]);
  await roundTrip(t, ref, [{ op: 'add_leg', option: 'A', bearing: 45 }]);
  await roundTrip(t, ref, [{ op: 'remove_leg', option: 'A', leg: 'S' }]);
  await roundTrip(t, ref, [{ op: 'set_rule', rule: 'speed.entry.max', value: 20 }]);
  // Options and rules that exist already: remove one from the middle, reset a rule.
  await applyChange(t.DB, ref, { ops: [{ op: 'add_option', from: 'A' }, { op: 'add_option', from: 'A' }, { op: 'set_rule', rule: 'speed.entry.max', value: 22 },
    { op: 'set_rule', rule: 'fp.offset.curb', value: 4 }], actor: 'user' });
  await roundTrip(t, ref, [{ op: 'remove_option', option: 'B' }]);
  await roundTrip(t, ref, [{ op: 'set_rule', rule: 'fp.offset.curb', value: null }]);
  await roundTrip(t, ref, [{ op: 'remove_option', option: 'B' }, { op: 'set', option: 'A', path: 'icd', value: 160 }, { op: 'add_leg', option: 'C' }, { op: 'rename_option', option: 'C', name: 'Five legs' }]);
});

test('property: random valid changes, applied then undone, give back the byte-identical project', async () => {
  const { t, ref } = await fresh();
  await applyChange(t.DB, ref, { ops: [{ op: 'add_option', from: 'A' }], actor: 'user' });
  let s = 20261111;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const pick = a => a[Math.floor(rnd() * a.length)];
  const valueFor = p => Math.round((p.min + rnd() * (p.max - p.min)) / p.step) * p.step;
  for (let i = 0; i < 60; i++) {
    const n = 1 + Math.floor(rnd() * 3);
    const ops = [];
    for (let k = 0; k < n; k++) {
      const p = pick(PARAMS);
      const option = pick(['A', 'B']);
      const path = p.path.startsWith('legs.') ? `legs.${pick(['N', 'E', 'S', 'W', '0', '*'])}.${legField(p)}` : p.path;
      ops.push({ op: 'set', option, path, value: valueFor(p) });
    }
    if (rnd() < 0.2) ops.push({ op: 'set_rule', rule: pick(['speed.entry.max', 'fp.window', 'sight.isd.eyeBack']), value: pick([20, 30, 60, 100, null]) });
    const before = docText(t, ref.id);
    const r = await applyChange(t.DB, ref, { ops, actor: pick(['user', 'claude']) });
    assert.equal(r.ok, true, r.error);
    if (r.nothing) continue;
    const u = await undoChange(t.DB, ref, { actor: 'user', seq: r.seq });
    assert.equal(u.ok, true, u.error);
    assert.equal(docText(t, ref.id), before, `round ${i}: ${JSON.stringify(ops)}`);
  }
});

test('the resolved ops and their inverse are exact, in the store and in memory', () => {
  const doc = newDoc({ sample: true });
  const r = resolveAndApply(doc, [{ op: 'add_option', from: 'A' }, { op: 'set', option: 'B', path: 'legs.*.entryRadius', value: 70 }, { op: 'remove_leg', option: 'B', leg: 'W' }]);
  assert.equal(r.ops.length, 1 + 4 + 1);
  assert.equal(JSON.stringify(applyResolved(r.doc, r.inverse)), JSON.stringify(doc));
  assert.equal(JSON.stringify(applyResolved(doc, invertOps(r.inverse))), JSON.stringify(r.doc));
  assert.deepEqual(r.ops[1], { op: 'set', option: 'B', path: 'legs.N.entryRadius', value: 70, was: 65 });
});

test('values are checked against the parameters table and refused by label, in plain words', async () => {
  const { t, ref } = await fresh();
  const refused = async (ops, re, status = 400) => {
    const r = await applyChange(t.DB, ref, { ops, actor: 'user' });
    assert.equal(r.ok, false);
    assert.equal(r.status, status);
    assert.match(r.error, re);
  };
  await refused([{ op: 'set', option: 'A', path: 'icd', value: 400 }], /^Inscribed circle diameter must be between 70 and 300 ft; 400 ft is outside that range\.$/);
  await refused([{ op: 'set', option: 'A', path: 'legs.N.entryRadius', value: 10 }], /^Entry curb radius of the North leg must be between 30 and 250 ft/);
  await refused([{ op: 'set', option: 'A', path: 'legs.*.approachSpeed', value: 90 }], /^Approach speed of every leg must be between 15 and 70 mph/);
  await refused([{ op: 'set', option: 'A', path: 'circWidth', value: '20' }], /^Circulatory roadway width must be a number in ft\.$/);
  await refused([{ op: 'set', option: 'A', path: 'icd', value: Number.NaN }], /must be a number/);
  await refused([{ op: 'set', option: 'A', path: 'radius', value: 3 }], /no setting called "radius"/);
  await refused([{ op: 'set', option: 'A', path: 'legs.Q.entryRadius', value: 60 }], /has no leg "Q"/);
  await refused([{ op: 'set', option: 'Z', path: 'icd', value: 140 }], /no option Z/);
  await refused([{ op: 'set', option: 'A', path: 'legs.N.name', value: '   ' }], /cannot be empty/);
  await refused([{ op: 'fly' }], /no change called "fly"/);
  await refused([], /at least one change/);
  await refused([{ op: 'remove_option', option: 'A' }], /at least one option/);
  await refused([{ op: 'remove_leg', option: 'A', leg: 'N' }, { op: 'remove_leg', option: 'A', leg: 'E' }], /at least 3 legs, so the East leg cannot be removed/);
  await refused([{ op: 'add_leg', option: 'A' }, { op: 'add_leg', option: 'A' }, { op: 'add_leg', option: 'A' }], /at most 6 legs/);
  await refused([{ op: 'add_leg', option: 'A', id: 'N' }], /already has a leg "N"/);
  await refused([{ op: 'add_leg', option: 'A', id: '7' }], /leg id starts with a letter/);
  await refused([{ op: 'add_leg', option: 'A', leg: { entryRadius: 999 } }], /Entry curb radius of the new leg must be between/);
  await refused([{ op: 'add_option', id: 'A' }], /already an option A/);
  await refused([{ op: 'add_option', option: { id: 'B', round: { legs: [] } } }], /Option B cannot be used: .*at least 3 legs/);
  await refused([{ op: 'set_rule', rule: 'speed.entry.max', value: 99 }], /^Highest entry speed recommended for a single-lane roundabout must be between 10 and 50 mph/);
  await refused([{ op: 'set_rule', rule: 'nope', value: 1 }], /no design limit called "nope"/);
  await refused([{ op: 'rename_option', option: 'A', name: 'x'.repeat(61) }], /at most 60 characters/);
  // A refused change leaves nothing behind, even when earlier ops in it were fine.
  await refused([{ op: 'set', option: 'A', path: 'icd', value: 140 }, { op: 'set', option: 'A', path: 'icd', value: 999 }], /outside that range/);
  assert.equal(seqOf(t, ref.id), 0);
  assert.equal(t.row('SELECT count(*) AS n FROM changes').n, 0);
});

test('a change records who, what, the ops, the inverse and a plain summary; one that changes nothing is not recorded', async () => {
  const { t, ref } = await fresh();
  const r = await applyChange(t.DB, ref, { ops: [{ op: 'set', option: 'A', path: 'legs.N.entryRadius', value: 80 }], actor: 'claude', summary: 'Try a bigger entry radius' });
  assert.equal(r.ok, true);
  assert.equal(r.seq, 1);
  const row = t.row('SELECT * FROM changes WHERE project_id = ?', ref.id);
  assert.equal(row.actor, 'claude');
  assert.equal(row.summary, 'Try a bigger entry radius');
  assert.deepEqual(JSON.parse(row.ops), [{ op: 'set', option: 'A', path: 'legs.N.entryRadius', value: 80, was: 65 }]);
  assert.deepEqual(JSON.parse(row.inverse), [{ op: 'set', option: 'A', path: 'legs.N.entryRadius', value: 65, was: 80 }]);
  const own = await applyChange(t.DB, ref, { ops: [{ op: 'set', option: 'A', path: 'icd', value: 140 }], actor: 'user' });
  assert.equal(own.change.summary, 'Inscribed circle diameter set to 140 ft (was 130 ft)');
  const all = await applyChange(t.DB, ref, { ops: [{ op: 'set', option: 'A', path: 'legs.*.exitRadius', value: 180 }], actor: 'user' });
  assert.equal(all.change.summary, 'Exit curb radius of 4 legs set to 180 ft');
  const same = await applyChange(t.DB, ref, { ops: [{ op: 'set', option: 'A', path: 'icd', value: 140 }], actor: 'user' });
  assert.equal(same.nothing, true);
  assert.equal(seqOf(t, ref.id), 3);
});

test('undo: the newest live change by default, its own actor for Claude, and an undo can be undone (redo)', async () => {
  const { t, ref } = await fresh();
  const base = docText(t, ref.id);
  await applyChange(t.DB, ref, { ops: [{ op: 'set', option: 'A', path: 'icd', value: 140 }], actor: 'claude', summary: 'Bigger circle' });
  const afterClaude = docText(t, ref.id);
  await applyChange(t.DB, ref, { ops: [{ op: 'set', option: 'A', path: 'circWidth', value: 20 }], actor: 'user' });
  // Claude's undo takes Claude's own change, not hers.
  const c = await undoChange(t.DB, ref, { actor: 'claude', only_actor: 'claude' });
  assert.equal(c.ok, true);
  assert.equal(c.change.summary, 'Undo: Bigger circle');
  assert.equal(c.change.undo_of, 1);
  assert.equal(t.row('SELECT undone FROM changes WHERE project_id = ? AND seq = 1', ref.id).undone, 3);
  // Her undo now takes her own change (the newest live one), then nothing is left.
  const u = await undoChange(t.DB, ref, { actor: 'user' });
  assert.equal(u.change.undo_of, 2);
  assert.equal(docText(t, ref.id), base);
  const none = await undoChange(t.DB, ref, { actor: 'user' });
  assert.equal(none.ok, false);
  assert.match(none.error, /nothing to undo/);
  // Undo the undo of change 1: a redo; change 1 counts as live again.
  const redo = await undoChange(t.DB, ref, { actor: 'user', seq: 3 });
  assert.equal(redo.ok, true);
  assert.equal(redo.change.summary, 'Redo: Bigger circle');
  assert.equal(t.row('SELECT undone FROM changes WHERE project_id = ? AND seq = 1', ref.id).undone, null);
  assert.equal(JSON.parse(docText(t, ref.id)).options[0].round.icd, 140);
  assert.equal(docText(t, ref.id), afterClaude.replace('"circWidth":20', '"circWidth":18'));
  // Undoing the redo takes it away again.
  const again = await undoChange(t.DB, ref, { actor: 'user', seq: redo.seq });
  assert.equal(again.change.summary, 'Undo: Bigger circle');
  assert.equal(docText(t, ref.id), base);
  // An undone change cannot be undone twice.
  const twice = await undoChange(t.DB, ref, { actor: 'user', seq: 2 });
  assert.equal(twice.status, 409);
  assert.match(twice.error, /already undone/);
});

test('undoing an older change that a later one changed again is refused, and nothing is written', async () => {
  const { t, ref } = await fresh();
  await applyChange(t.DB, ref, { ops: [{ op: 'set', option: 'A', path: 'icd', value: 140 }], actor: 'user' });
  await applyChange(t.DB, ref, { ops: [{ op: 'set', option: 'A', path: 'icd', value: 150 }], actor: 'user' });
  const before = docText(t, ref.id);
  const r = await undoChange(t.DB, ref, { actor: 'user', seq: 1 });
  assert.equal(r.status, 409);
  assert.match(r.error, /changed again since; undo the later change first/);
  assert.equal(docText(t, ref.id), before);
  // A removed option takes its later changes' undo with it.
  await applyChange(t.DB, ref, { ops: [{ op: 'add_option', from: 'A' }], actor: 'user' });
  await applyChange(t.DB, ref, { ops: [{ op: 'set', option: 'B', path: 'icd', value: 160 }], actor: 'user' });
  await applyChange(t.DB, ref, { ops: [{ op: 'remove_option', option: 'B' }], actor: 'user' });
  assert.equal((await undoChange(t.DB, ref, { actor: 'user', seq: 4 })).status, 409);
  // An undo of an unrelated older change still works.
  await applyChange(t.DB, ref, { ops: [{ op: 'set', option: 'A', path: 'apronWidth', value: 12 }], actor: 'user' });
  await applyChange(t.DB, ref, { ops: [{ op: 'set', option: 'A', path: 'circWidth', value: 20 }], actor: 'user' });
  assert.equal((await undoChange(t.DB, ref, { actor: 'user', seq: 6 })).ok, true);
});

test('base_seq: a change on a part someone changed meanwhile is refused; on another part it lands', async () => {
  const { t, ref } = await fresh();
  await applyChange(t.DB, ref, { ops: [{ op: 'set', option: 'A', path: 'legs.N.entryRadius', value: 70 }], actor: 'claude', summary: 'Claude widened the north entry' });
  const clash = await applyChange(t.DB, ref, { ops: [{ op: 'set', option: 'A', path: 'legs.N.entryRadius', value: 60 }], actor: 'user', base_seq: 0 });
  assert.equal(clash.status, 409);
  assert.match(clash.error, /changed meanwhile \("Claude widened the north entry"\)/);
  assert.equal(clash.seq, 1);
  const other = await applyChange(t.DB, ref, { ops: [{ op: 'set', option: 'A', path: 'legs.S.entryRadius', value: 60 }], actor: 'user', base_seq: 0 });
  assert.equal(other.ok, true);
  // Removing a leg clashes with a change to any of its values.
  assert.ok(overlaps([{ op: 'remove_leg', option: 'A', leg: 'N' }], [{ op: 'set', option: 'A', path: 'legs.N.bearing' }]));
  assert.ok(!overlaps([{ op: 'remove_leg', option: 'A', leg: 'N' }], [{ op: 'set', option: 'A', path: 'legs.NE.bearing' }]));
  assert.ok(overlaps([{ op: 'remove_option', option: 'A' }], [{ op: 'set', option: 'A', path: 'icd' }]));
});

test('a resent change (same id) is applied once', async () => {
  const { t, ref } = await fresh();
  const req = { ops: [{ op: 'set', option: 'A', path: 'icd', value: 140 }], actor: 'user', batch_id: 'drag-0001-abc' };
  const a = await applyChange(t.DB, ref, req);
  const b = await applyChange(t.DB, ref, { ...req, ops: [{ op: 'set', option: 'A', path: 'icd', value: 145 }] });
  assert.equal(a.seq, 1);
  assert.equal(b.replay, true);
  assert.equal(b.change.seq, 1);
  assert.equal(seqOf(t, ref.id), 1);
  assert.equal(JSON.parse(docText(t, ref.id)).options[0].round.icd, 140);
});

test('two changes at the same moment both land, one after the other', async () => {
  const { t, ref } = await fresh();
  const [a, b] = await Promise.all([
    applyChange(t.DB, ref, { ops: [{ op: 'set', option: 'A', path: 'icd', value: 140 }], actor: 'user' }),
    applyChange(t.DB, ref, { ops: [{ op: 'set', option: 'A', path: 'circWidth', value: 20 }], actor: 'claude', summary: 'wider' }),
  ]);
  assert.ok(a.ok && b.ok);
  assert.deepEqual([a.seq, b.seq].sort(), [1, 2]);
  const round = JSON.parse(docText(t, ref.id)).options[0].round;
  assert.equal(round.icd, 140);
  assert.equal(round.circWidth, 20);
});

test('add_leg picks the widest gap, a free id and name; add_option a free letter', () => {
  assert.equal(freeBearing([{ bearing: 0 }, { bearing: 90 }, { bearing: 180 }, { bearing: 270 }]), 45);
  assert.equal(freeBearing([{ bearing: 0 }, { bearing: 120 }, { bearing: 200 }]), 280);
  const doc = newDoc({ sample: true });
  const r = resolveAndApply(doc, [{ op: 'add_leg', option: 'A', bearing: 0 }, { op: 'add_option' }, { op: 'add_option' }]);
  const legs = r.doc.options[0].round.legs;
  assert.deepEqual(legs.map(l => l.id), ['N', 'E', 'S', 'W', 'N2']);
  assert.equal(legs[4].name, 'North leg 2');
  for (const p of LEG_PARAMS) if (legField(p) !== 'bearing') assert.equal(legs[4][legField(p)], p.default);
  assert.deepEqual(r.doc.options.map(o => o.id), ['A', 'B', 'C']);
  assert.throws(() => resolveAndApply(doc, [{ op: 'set', option: 'A', path: 'legs.*', value: 1 }]), OpError);
});
