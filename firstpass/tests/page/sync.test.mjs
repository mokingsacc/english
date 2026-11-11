// Saving and the poll against answers that are not First Pass's (a network sign-in page answering 200 with HTML), the
// poll's pace on a fake clock (1.5 s, then 5 s after two quiet minutes, then 15 s after ten, back to 1.5 s on input or a
// change), and the undo line naming whose change went. The page's real api.js runs here on a fake fetch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi, NOT_FIRST_PASS } from '../../public/js/app/api.js';
import { createSync, pollDelay, undidWords, POLL_MS, POLL_QUIET_MS, POLL_AWAY_MS, QUIET_AFTER_MS, AWAY_AFTER_MS } from '../../public/js/app/sync.js';
import { createStore, initialState, currentOption } from '../../public/js/app/store.js';
import { applyOps, op } from '../../public/js/app/ops.js';
import { sampleProject } from '../../public/js/app/sample.js';
import { paramFor } from '../../public/js/engine/index.js';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const html = () => new Response('<html><body>Please sign in to the wifi</body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });

/** A First Pass server behind a fake fetch, with the page's own apply standing in for the server's. srv.once(kind) makes
 * the next answer of that kind ('save' or 'poll') an HTML page. */
function fakeFetchServer() {
  let doc = { ...sampleProject(), id: 'p_1', seq: 1 };
  const changes = [];
  const seen = new Set();
  const odd = new Set();
  const log = [];
  const srv = {
    get doc() { return doc; },
    log,
    once(kind) { odd.add(kind); },
    claude(ops, summary) {
      doc = { ...applyOps(doc, ops), id: 'p_1', seq: doc.seq + 1 };
      changes.push({ seq: doc.seq, ops, summary, actor: 'claude', batch_id: `c${doc.seq}` });
    },
    undone: null,
  };
  srv.fetch = async (url, init = {}) => {
    const u = new URL(url, 'http://fp.test');
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    if (method === 'POST' && u.pathname.endsWith('/changes')) {
      log.push(['save', body.id]);
      if (odd.delete('save')) return html();
      if (seen.has(body.id)) return json({ ok: true, nothing: true });
      seen.add(body.id);
      doc = { ...applyOps(doc, body.ops), id: 'p_1', seq: doc.seq + 1 };
      changes.push({ seq: doc.seq, ops: body.ops, summary: 'page', actor: 'user', batch_id: body.id });
      return json({ ok: true, seq: doc.seq, change: { batch_id: body.id }, project: doc });
    }
    if (method === 'GET' && u.pathname.endsWith('/changes')) {
      log.push(['poll', Number(u.searchParams.get('since'))]);
      if (odd.delete('poll')) return html();
      const fresh = changes.filter((c) => c.seq > Number(u.searchParams.get('since')));
      return json(fresh.length ? { seq: doc.seq, changes: fresh, project: doc } : { seq: doc.seq, changes: [] });
    }
    if (method === 'POST' && u.pathname.endsWith('/undo')) {
      const last = changes[changes.length - 1];
      const before = doc;
      doc = { ...doc, seq: doc.seq + 1 };
      void before;
      const change = { batch_id: body.id, summary: `Undo: ${last.summary}` };
      return json({ ok: true, seq: doc.seq, change, project: doc, ...(srv.undone ? { undone: srv.undone } : {}) });
    }
    if (method === 'GET' && /^\/api\/projects\/[^/]+$/.test(u.pathname)) return json({ project: doc });
    return json({ error: 'Not in this fake.' }, 404);
  };
  return srv;
}

/** The page's api.js on the fake fetch, with a key. */
function apiOn(srv) {
  const real = createApi({ base: 'http://fp.test' });
  void srv;
  return { ...real, hasKey: () => true };
}

/** A clock whose timers run only when advanced; each timer's work (and the promises it starts) finishes first. */
function fakeClock() {
  let now = 1_000_000, n = 0;
  const timers = new Map();
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
  return {
    now: () => now,
    setTimeout: (fn, ms) => { const id = ++n; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        let next = null;
        for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].fn();
        await settle();
      }
      now = end;
      await settle();
    },
    settle,
  };
}

async function withFetch(f, fn) {
  const before = globalThis.fetch;
  globalThis.fetch = f;
  try { return await fn(); } finally { globalThis.fetch = before; }
}

test('an answer that says ok but is not JSON counts as no server, and nothing is read from it', async () => {
  const api = createApi({ base: 'http://fp.test' });
  await withFetch(async () => html(), async () => {
    const r = await api.getProject('p_1');
    assert.equal(r.ok, false);
    assert.equal(r.offline, true);
    assert.equal(r.data, null);
    assert.equal(r.error, NOT_FIRST_PASS);
  });
  await withFetch(async () => new Response('null', { status: 200 }), async () => {
    assert.equal((await api.getProject('p_1')).offline, true, 'JSON with no object in it is not an answer either');
  });
  await withFetch(async () => json({ error: 'That project is not one of yours.' }, 404), async () => {
    const r = await api.getProject('p_1');
    assert.deepEqual([r.ok, r.offline, r.error], [false, false, 'That project is not one of yours.']);
  });
  assert.equal(typeof api.exportDxf, 'undefined', 'the export is built on the page, not fetched');
});

test('a save answered with an HTML page waits, and the next save goes through', async () => {
  const srv = fakeFetchServer();
  const clock = fakeClock();
  await withFetch(srv.fetch, async () => {
    const store = createStore(initialState());
    const lines = [];
    const sync = createSync({ api: apiOn(srv), store, echo: (t, k) => lines.push([k, t]), doc: null, clock });
    try {
      await sync.start({ projectId: 'p_1' });
      const icd = paramFor('icd');
      srv.once('save');
      sync.change([op.set('A', 'icd', icd.min + 3)]);
      await clock.settle();
      assert.equal(sync.waiting(), 1, 'the change waits in the outbox');
      assert.equal(store.get().net.state, 'offline');
      assert.match(store.get().net.text, /^Offline: 1 change not saved yet\. A sign-in page on this network may be in the way\.$/);
      assert.equal(srv.doc.options[0].round.icd === icd.min + 3, false);
      // She goes on working; the waiting change and the new one both reach the server.
      sync.change([op.set('A', 'icd', icd.min + 4)]);
      await clock.settle();
      await clock.advance(POLL_MS * 2 + 10);
      assert.equal(sync.waiting(), 0);
      assert.equal(srv.doc.options[0].round.icd, icd.min + 4);
      assert.equal(store.get().net.text, 'All changes saved.');
      assert.ok(srv.log.filter((l) => l[0] === 'save').length >= 3, 'the first change was sent again');
      assert.equal(lines.filter((l) => l[0] === 'error').length, 0, JSON.stringify(lines));
      // And the poll still runs after the saves.
      const polls = srv.log.filter((l) => l[0] === 'poll').length;
      await clock.advance(POLL_MS * 3);
      assert.ok(srv.log.filter((l) => l[0] === 'poll').length > polls, 'polling carries on');
    } finally { sync.stop(); }
  });
});

test('a poll answered with an HTML page does not stop the poll: Claude\'s next change still arrives', async () => {
  const srv = fakeFetchServer();
  const clock = fakeClock();
  await withFetch(srv.fetch, async () => {
    const store = createStore(initialState());
    const lines = [];
    const sync = createSync({ api: apiOn(srv), store, echo: (t, k) => lines.push([k, t]), doc: null, clock });
    try {
      await sync.start({ projectId: 'p_1' });
      srv.once('poll');
      await clock.advance(POLL_MS + 10);
      assert.equal(srv.log.filter((l) => l[0] === 'poll').length, 1, 'the odd answer came');
      const icd = paramFor('icd');
      srv.claude([op.set('A', 'icd', icd.min + 6)], 'Inscribed circle diameter set to something');
      await clock.advance(POLL_MS * 2);
      assert.equal(currentOption(store.get()).round.icd, icd.min + 6);
      assert.ok(lines.some((l) => l[0] === 'claude'), JSON.stringify(lines));
      assert.equal(store.get().net.state, 'saved');
    } finally { sync.stop(); }
  });
});

test('the poll slows when nothing happens and is quick again on her input or a change', async () => {
  assert.deepEqual([pollDelay(0), pollDelay(QUIET_AFTER_MS - 1), pollDelay(QUIET_AFTER_MS), pollDelay(AWAY_AFTER_MS - 1), pollDelay(AWAY_AFTER_MS)],
    [POLL_MS, POLL_MS, POLL_QUIET_MS, POLL_QUIET_MS, POLL_AWAY_MS]);
  const srv = fakeFetchServer();
  const clock = fakeClock();
  const visibility = { visibilityState: 'visible', on: null, addEventListener(t, fn) { this.on = fn; } };
  await withFetch(srv.fetch, async () => {
    const store = createStore(initialState());
    const sync = createSync({ api: apiOn(srv), store, doc: visibility, clock });
    const polls = () => srv.log.filter((l) => l[0] === 'poll').length;
    try {
      await sync.start({ projectId: 'p_1' });
      // The first two minutes: every 1.5 s.
      await clock.advance(QUIET_AFTER_MS - 1);
      const quick = polls();
      assert.ok(Math.abs(quick - QUIET_AFTER_MS / POLL_MS) <= 1, `${quick} polls in two minutes`);
      // Then every 5 s until ten quiet minutes.
      await clock.advance(AWAY_AFTER_MS - QUIET_AFTER_MS);
      const quiet = polls() - quick;
      assert.ok(Math.abs(quiet - (AWAY_AFTER_MS - QUIET_AFTER_MS) / POLL_QUIET_MS) <= 2, `${quiet} polls in the next eight minutes`);
      // Then every 15 s.
      let n = polls();
      await clock.advance(60_000);
      assert.ok(Math.abs(polls() - n - 60_000 / POLL_AWAY_MS) <= 1, `${polls() - n} polls in a quiet minute`);
      // Her input, just after a poll: the next one comes within 1.5 s, not 15 s.
      await clock.advance(sync.nextIn() + 1);
      assert.ok(sync.nextIn() > POLL_AWAY_MS - 10);
      sync.active();
      assert.ok(sync.nextIn() <= POLL_MS);
      n = polls();
      await clock.advance(POLL_MS + 1);
      assert.equal(polls(), n + 1);
      // Quiet again for ten minutes, then a poll brings Claude's change: quick again at once.
      await clock.advance(AWAY_AFTER_MS + 30_000);
      await clock.advance(sync.nextIn() + 1);
      assert.ok(sync.nextIn() > POLL_AWAY_MS - 10);
      srv.claude([op.set('A', 'icd', paramFor('icd').min + 7)], 'Inscribed circle diameter set');
      await clock.advance(POLL_AWAY_MS + 1);
      assert.ok(sync.nextIn() <= POLL_MS, 'a change keeps the poll quick');
      // A hidden tab does not poll at all; showing it again asks at once.
      visibility.visibilityState = 'hidden';
      await clock.advance(POLL_MS * 2);
      n = polls();
      await clock.advance(AWAY_AFTER_MS);
      assert.equal(polls(), n, 'no polls while hidden');
      visibility.visibilityState = 'visible';
      visibility.on();
      await clock.advance(100);
      assert.equal(polls(), n + 1, 'the tab showing again polls at once');
      assert.ok(sync.nextIn() <= POLL_MS);
    } finally { sync.stop(); }
  });
});

test('undo says whose change went, and copes with an answer that does not say', async () => {
  assert.equal(undidWords('claude', 'Inscribed circle diameter set to 140 ft'), 'Undid Claude\'s change: Inscribed circle diameter set to 140 ft');
  assert.equal(undidWords('user', 'Undo: Entry width set to 18 ft'), 'Undid your change: Entry width set to 18 ft');
  const srv = fakeFetchServer();
  const clock = fakeClock();
  await withFetch(srv.fetch, async () => {
    const store = createStore(initialState());
    const sync = createSync({ api: apiOn(srv), store, doc: null, clock });
    try {
      await sync.start({ projectId: 'p_1' });
      srv.claude([op.set('A', 'icd', paramFor('icd').min + 8)], 'Inscribed circle diameter set to something');
      srv.undone = { seq: srv.doc.seq, actor: 'claude', summary: 'Inscribed circle diameter set to something' };
      assert.equal((await sync.undo()).summary, 'Undid Claude\'s change: Inscribed circle diameter set to something');
      srv.undone = { seq: srv.doc.seq, actor: 'user', summary: 'Entry width set to 18 ft' };
      assert.equal((await sync.undo()).summary, 'Undid your change: Entry width set to 18 ft');
      srv.undone = null;
      assert.match((await sync.undo()).summary, /^Undo: /, 'without the field the server\'s own words are used');
    } finally { sync.stop(); }
  });
  // On the page alone, every change is hers.
  const local = createSync({ api: { hasKey: () => false }, store: createStore(initialState()), doc: null });
  await local.start();
  local.change([op.set('A', 'icd', paramFor('icd').min + 2)]);
  assert.match((await local.undo()).summary, /^Undid your change: /);
  local.stop();
});
