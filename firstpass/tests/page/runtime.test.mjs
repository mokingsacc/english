// The page's runtime parts without a browser: the frame meter and the evaluate cache, the store, the link (key kept
// out of the address), and sync against a fake server: local changes and undo with no key, the outbox and its order,
// conflicts, the poll naming Claude's changes, and offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameMeter } from '../../public/js/app/frame-meter.js';
import { createEvaluator, percentiles } from '../../public/js/app/evaluator.js';
import { createStore, initialState, currentOption, selectedLegs, shownRound } from '../../public/js/app/store.js';
import { parseLink, linkFor, newChangeId } from '../../public/js/app/api.js';
import { createSync } from '../../public/js/app/sync.js';
import { applyOps, op } from '../../public/js/app/ops.js';
import { sampleProject } from '../../public/js/app/sample.js';
import { paramFor } from '../../public/js/engine/index.js';

test('percentiles pick p50, p90 and p99 from the list', () => {
  const p = percentiles(Array.from({ length: 100 }, (_, i) => i + 1));
  assert.deepEqual(p, { n: 100, p50: 50, p90: 90, p99: 99 });
  assert.equal(percentiles([]), null);
});

test('the frame meter times frames only while she moves the drawing', () => {
  let t = 0, queued = null;
  const win = { requestAnimationFrame: (f) => { queued = f; return 1; } };
  const target = { listeners: {}, addEventListener(type, f) { this.listeners[type] = f; }, removeEventListener(type) { delete this.listeners[type]; } };
  const m = createFrameMeter({ target, win, now: () => t });
  target.listeners.pointermove();
  for (let i = 0; i < 20; i++) { t += 16; const f = queued; queued = null; f(t); m.work(3, 4); }
  const s = m.summary();
  assert.equal(s.frames.n, 19);
  assert.equal(s.frames.p50, 16);
  assert.equal(s.work.p99, 7);
  assert.equal(s.evaluate.p50, 3);
  t += 1000;
  const f = queued; queued = null; f(t);
  assert.equal(queued, null, 'stops when idle');
  m.work(50, 50);
  assert.equal(m.summary().work.n, 20, 'work after the input stops is not counted');
  m.stop();
  assert.deepEqual(target.listeners, {});
});

test('the evaluate cache answers the same roundabout without working it out again', () => {
  let calls = 0, t = 0;
  const ev = createEvaluator((r) => { calls++; t += 5; return { ok: true, r }; }, { size: 2, now: () => t });
  const a = { icd: 1 }, b = { icd: 2 }, c = { icd: 3 };
  const ra = ev.run(a, {});
  assert.equal(ev.run({ icd: 1 }, {}), ra);
  assert.equal(calls, 1);
  assert.equal(ev.lastMs, 5);
  ev.run(b, {}); ev.run(a, {}); ev.run(c, {});
  assert.equal(calls, 3);
  ev.run(a, {});
  assert.equal(calls, 3, 'a was used last, so b went first');
  ev.run(a, { 'speed.entry.max': 20 });
  assert.equal(calls, 4, 'other rules are another answer');
  assert.equal(ev.run(null), null);
});

test('while dragging, the worker gets the newest shape, one at a time, and its answers go in the cache', () => {
  const sent = [];
  const worker = { postMessage: (m) => sent.push(m), terminate() {} };
  let ready = 0, local = 0;
  const ev = createEvaluator(() => { local++; return { ok: true }; }, { worker, onReady: () => ready++ });
  assert.equal(ev.async(), true);
  ev.ask({ icd: 1 }, {});
  ev.ask({ icd: 2 }, {});
  ev.ask({ icd: 3 }, {});
  assert.deepEqual(sent.map((m) => m.round.icd), [1], 'one at a time');
  assert.equal(ev.peek({ icd: 1 }, {}), null);
  worker.onmessage({ data: { id: sent[0].id, result: { ok: true, n: 1 }, ms: 7 } });
  assert.deepEqual(ev.peek({ icd: 1 }, {}), { ok: true, n: 1 });
  assert.deepEqual(sent.map((m) => m.round.icd), [1, 3], 'the newest waiting shape goes next; 2 was passed over');
  assert.equal(ready, 1);
  assert.deepEqual(ev.workerTimes, [7]);
  assert.equal(local, 0, 'nothing was worked out on the main thread');
  worker.onerror();
  assert.equal(ev.async(), false, 'a worker that fails is dropped');
  ev.ask({ icd: 4 }, {});
  assert.equal(local, 1, 'and the page works it out itself');
});

test('the store tells its listeners and finds the option, selection and draft on screen', () => {
  const s = createStore(initialState());
  const heard = [];
  s.on((st, why) => heard.push(why));
  const p = sampleProject();
  s.set({ project: p, optionId: 'A', selection: ['round', `leg:${p.options[0].round.legs[0].id}`] }, 'load');
  assert.deepEqual(heard, ['load']);
  assert.equal(currentOption(s.get()).id, 'A');
  assert.equal(selectedLegs(s.get()).length, 1);
  assert.equal(shownRound(s.get()), p.options[0].round);
  const draft = { ...p.options[0].round, icd: 1 };
  s.set({ draft }, 'draft');
  assert.equal(shownRound(s.get()), draft);
});

test('links carry the project and option but never the key', () => {
  assert.deepEqual(parseLink('#k=abc&p=p_1&o=B&do=export-dxf'), { k: 'abc', p: 'p_1', o: 'B', do: 'export-dxf' });
  assert.equal(linkFor({ p: 'p_1', o: 'B' }), '#p=p_1&o=B');
  assert.equal(linkFor({}), '');
  assert.match(newChangeId(), /^pg_[0-9a-f]{20}$/);
});

// A fake server holding one project, with the page's own apply standing in for the server's.
function fakeServer() {
  let doc = { ...sampleProject(), id: 'p_1', seq: 1 };
  const log = [];
  const changes = [];
  const seen = new Set();
  const srv = {
    offline: false,
    get doc() { return doc; },
    log,
    claude(ops, summary) {
      doc = { ...applyOps(doc, ops), id: 'p_1', seq: doc.seq + 1 };
      changes.push({ seq: doc.seq, ops, summary, actor: 'claude', batch_id: `c${doc.seq}` });
    },
  };
  const answer = (data, status = 200) => ({ ok: status < 400, status, data, error: status < 400 ? null : data.error, offline: false });
  const down = () => ({ ok: false, status: 0, data: null, offline: true, error: 'The First Pass server could not be reached.' });
  srv.api = {
    hasKey: () => true,
    async getProject() { return srv.offline ? down() : answer({ project: doc }); },
    async listProjects() { return answer({ projects: [{ id: 'p_1' }] }); },
    async postChange(id, body) {
      log.push(['change', body]);
      if (srv.offline) return down();
      if (seen.has(body.id)) return answer({ ok: true, nothing: true });
      seen.add(body.id);
      try { doc = { ...applyOps(doc, body.ops), id: 'p_1', seq: doc.seq + 1 }; } catch (e) { return answer({ error: e.message }, 400); }
      changes.push({ seq: doc.seq, ops: body.ops, summary: 'page', actor: 'page', batch_id: body.id });
      return answer({ ok: true, seq: doc.seq, change: { batch_id: body.id }, project: doc });
    },
    async poll(id, since) {
      log.push(['poll', since]);
      if (srv.offline) return down();
      const fresh = changes.filter((c) => c.seq > since);
      return answer(fresh.length ? { seq: doc.seq, changes: fresh, project: doc } : { seq: doc.seq, changes: [] });
    },
    async undo() { return answer({ error: 'not in this fake' }, 400); },
  };
  return srv;
}
const flushAll = async (sync) => { await sync.flush(); await new Promise((r) => setTimeout(r, 0)); };

test('with no key every change and undo stays on the page', async (t) => {
  const store = createStore(initialState());
  const sync = createSync({ api: { hasKey: () => false }, store, doc: null });
  t.after(() => sync.stop());
  await sync.start();
  assert.equal(sync.mode(), 'local');
  assert.equal(store.get().net.state, 'local');
  const icd = store.get().project.options[0].round.icd;
  const want = icd === paramFor('icd').min ? icd + 1 : icd - 1;
  const r = sync.change([op.set('A', 'icd', want)]);
  assert.ok(r.ok && r.summary);
  assert.equal(currentOption(store.get()).round.icd, want);
  assert.ok(sync.change([op.set('A', 'icd', want)]).nothing);
  assert.equal((await sync.undo()).ok, true);
  assert.equal(currentOption(store.get()).round.icd, icd);
  assert.equal((await sync.redo()).ok, true);
  assert.equal(currentOption(store.get()).round.icd, want);
  const bad = sync.change([op.set('A', 'icd', 1e9)]);
  assert.equal(bad.ok, false);
  assert.match(bad.error, /must be between/);
  sync.stop();
});

test('with the server a change shows at once, is sent with an id, and the server copy is kept', async (t) => {
  const srv = fakeServer();
  const store = createStore(initialState());
  const sync = createSync({ api: srv.api, store, doc: null });
  t.after(() => sync.stop());
  await sync.start({ projectId: 'p_1' });
  assert.equal(sync.mode(), 'server');
  const icd = paramFor('icd');
  sync.change([op.set('A', 'icd', icd.min + 2)]);
  assert.equal(currentOption(store.get()).round.icd, icd.min + 2, 'shown before the server answers');
  await flushAll(sync);
  const sent = srv.log.filter((l) => l[0] === 'change');
  assert.equal(sent.length, 1);
  assert.match(sent[0][1].id, /^pg_/);
  assert.equal(sent[0][1].base_seq, 1);
  assert.equal(store.get().project.seq, 2);
  assert.equal(store.get().net.text, 'All changes saved.');
  sync.stop();
});

test('offline changes wait in order and go when the server answers again', async (t) => {
  const srv = fakeServer();
  const store = createStore(initialState());
  const sync = createSync({ api: srv.api, store, doc: null });
  t.after(() => sync.stop());
  await sync.start({ projectId: 'p_1' });
  srv.offline = true;
  const icd = paramFor('icd');
  sync.change([op.set('A', 'icd', icd.min + 3)]);
  await flushAll(sync);
  sync.change([op.set('A', 'icd', icd.min + 4)]);
  await flushAll(sync);
  assert.equal(store.get().net.state, 'offline');
  assert.equal(sync.waiting(), 2);
  assert.equal(currentOption(store.get()).round.icd, icd.min + 4);
  srv.offline = false;
  await flushAll(sync);
  assert.equal(sync.waiting(), 0);
  assert.equal(srv.doc.options[0].round.icd, icd.min + 4);
  const ids = srv.log.filter((l) => l[0] === 'change').map((l) => l[1].id);
  assert.equal(new Set(ids).size, 2, 'the same change resent keeps its id');
  sync.stop();
});

test('the poll brings in a change made through Claude and names it on the command line', async (t) => {
  const srv = fakeServer();
  const store = createStore(initialState());
  const lines = [];
  const sync = createSync({ api: srv.api, store, echo: (t, k) => lines.push([k, t]), doc: null });
  t.after(() => sync.stop());
  await sync.start({ projectId: 'p_1' });
  const icd = paramFor('icd');
  srv.claude([op.set('A', 'icd', icd.min + 5)], 'Inscribed circle diameter set to something');
  await sync.poll();
  assert.equal(currentOption(store.get()).round.icd, icd.min + 5);
  assert.deepEqual(lines.at(-1), ['claude', 'Claude: Inscribed circle diameter set to something.']);
  await sync.poll();
  assert.equal(lines.filter((l) => l[0] === 'claude').length, 1, 'each change is said once');
  sync.stop();
});

test('a change the server refuses is said and taken back on the page', async (t) => {
  const srv = fakeServer();
  const store = createStore(initialState());
  const lines = [];
  const sync = createSync({ api: srv.api, store, echo: (t, k) => lines.push([k, t]), doc: null });
  t.after(() => sync.stop());
  await sync.start({ projectId: 'p_1' });
  // Claude removes option B on the server before the page's change to B arrives.
  srv.claude([op.addOption('A', 'B')], 'Added Option B');
  await sync.poll();
  srv.claude([op.removeOption('B')], 'Removed Option B');
  const r = sync.change([op.renameOption('B', 'Wide')]);
  assert.ok(r.ok);
  await flushAll(sync);
  assert.ok(lines.some((l) => l[0] === 'error' && /^Not saved: /.test(l[1])), JSON.stringify(lines));
  assert.equal(store.get().project.options.some((o) => o.name === 'Wide'), false);
  sync.stop();
});
