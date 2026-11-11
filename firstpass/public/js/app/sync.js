// Changes, undo and the poll. change(ops) applies the ops on the page at once (app/ops.js) and sends them to
// POST /api/projects/:id/changes; the answer's project (the server's whole copy) replaces the page's. Changes wait in
// an outbox while the server cannot be reached and go, in order, when it answers again (each has an id, so a resend
// is never applied twice). After any change, and while the page is visible, the poll asks for changes since the newest
// one it has seen; changes made through Claude (or another window) come in as named lines in the command history and
// the drawing updates without a reload. The poll runs every 1.5 s for two minutes after her last input or the last
// change, then every 5 s, then every 15 s after ten quiet minutes; any input, the window's focus, the tab showing again,
// or a poll that brings a change puts it back to 1.5 s at once. A hidden tab does not poll. An answer that is not
// First Pass's (api.js counts it as no server) never stops saving or polling: both always carry on.
//
// With no key, or no server when the page opened, everything stays on the page: change and undo work on a local
// history, and the status bar says the changes are not being saved.
//   const sync = createSync({ api, store, echo });  await sync.start();  sync.change(ops, summary);  sync.undo()
//   sync.active() on her input; sync.wake() when the window gets focus or shows again
import { applyOps, sameDrawing, describe, OpRefused } from './ops.js';
import { newChangeId, NOT_FIRST_PASS } from './api.js';
import { sampleProject } from './sample.js';
import { currentOption } from './store.js';

export const POLL_MS = 1500, POLL_QUIET_MS = 5000, POLL_AWAY_MS = 15000;
export const QUIET_AFTER_MS = 2 * 60 * 1000, AWAY_AFTER_MS = 10 * 60 * 1000;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const BROKEN = 'The server\'s answer was not complete. Try again.';
// An answer that came from something else on the network (api.js NOT_FIRST_PASS): her status bar says what it may be.
const SIGN_IN = 'A sign-in page on this network may be in the way.';
const notOurs = (r) => !!r && r.error === NOT_FIRST_PASS;

/** How long the poll waits when her last input or the last change was `quietMs` ago. */
export function pollDelay(quietMs) {
  return quietMs < QUIET_AFTER_MS ? POLL_MS : quietMs < AWAY_AFTER_MS ? POLL_QUIET_MS : POLL_AWAY_MS;
}

const realClock = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (t) => clearTimeout(t) };

export function createSync({ api, store, echo = () => {}, onProject = () => {}, doc = globalThis.document, clock = realClock }) {
  let mode = 'local';
  let confirmed = null;            // the server's copy, as last answered
  let seen = 0;                    // the newest change seq the history has shown
  const outbox = [];               // [{ id, ops, summary, before }] not yet answered
  const mine = new Set();          // change ids sent from this page
  let localUndo = [], localRedo = [];
  let redoSeqs = [];
  let flushing = null, timer = 0, dueAt = 0, stopped = false, polling = false;
  let lastActive = clock.now();    // her last input, or the last change made by anyone

  const net = (state, text) => {
    const cur = store.get().net;
    if (cur.state !== state || cur.text !== text) store.set({ net: { state, text } }, 'net');
  };
  const savedText = () => 'All changes saved.';
  const pid = () => (confirmed ? confirmed.id : null);

  function setProject(project, why) {
    const st = store.get();
    const ids = new Set(project.options.map((o) => o.id));
    const optionId = ids.has(st.optionId) ? st.optionId : project.options[0].id;
    const opt = project.options.find((o) => o.id === optionId);
    const legIds = new Set(opt.round.legs.map((l) => l.id));
    const selection = st.selection.filter((k) => k === 'round' || legIds.has(k.slice(4)));
    store.set({ project, optionId, selection }, why);
    onProject(project, why);
  }

  function goLocal(project, text) {
    mode = 'local';
    setProject(project, 'load');
    net('local', text);
  }

  /** Opens the project named in the link, her newest one, or a new sample; local when there is no key or server. */
  async function start({ projectId = null, optionId = null } = {}) {
    if (optionId) store.set({ optionId }, 'option');
    if (!api.hasKey()) return goLocal(sampleProject(), 'Not saved: there is no key. Open First Pass from your link to save changes.');
    const away = 'Not saved: the server cannot be reached. Reload when it is back.';
    let got = projectId ? await api.getProject(projectId) : null;
    if (got && got.offline) return goLocal(sampleProject(), away);
    if (!got || !got.ok || !projectOf(got)) {
      if (got && !got.ok && got.status !== 404) echo(got.error, 'error');
      if (got && got.status === 404) echo('That project is not one of yours, so your newest project is open instead.', 'note');
      const list = await api.listProjects();
      if (list.offline) return goLocal(sampleProject(), away);
      if (!list.ok || !list.data || !Array.isArray(list.data.projects)) { const why = list.error || BROKEN; echo(why, 'error'); return goLocal(sampleProject(), `Not saved: ${why}`); }
      let id = list.data.projects[0] && list.data.projects[0].id;
      if (!id) {
        const made = await api.createProject({ sample: true });
        if (made.offline) return goLocal(sampleProject(), away);
        if (!made.ok || !projectOf(made)) { const why = made.error || BROKEN; echo(why, 'error'); return goLocal(sampleProject(), `Not saved: ${why}`); }
        id = made.data.project.id;
      }
      got = await api.getProject(id);
      if (got.offline) return goLocal(sampleProject(), away);
      if (!got.ok || !projectOf(got)) { const why = got.error || BROKEN; echo(why, 'error'); return goLocal(sampleProject(), `Not saved: ${why}`); }
    }
    mode = 'server';
    confirmed = got.data.project;
    seen = confirmed.seq;
    setProject(confirmed, 'load');
    net('saved', savedText());
    lastActive = clock.now();
    schedule();
    return got.data;
  }

  /** The project in an answer, or null when the answer has none (it is then not used). */
  function projectOf(r) {
    const p = r && r.data && r.data.project;
    return p && typeof p === 'object' && Array.isArray(p.options) && p.options.length ? p : null;
  }

  /** Applies ops on the page now and sends them. Answers { ok, nothing?, error? } at once; saving goes on behind. */
  function change(ops, summary) {
    const before = store.get().project;
    let after;
    try { after = applyOps(before, ops); } catch (e) {
      if (e instanceof OpRefused) return { ok: false, error: e.message };
      throw e;
    }
    if (sameDrawing(before, after)) return { ok: true, nothing: true };
    const words = summary || describe(before, ops);
    if (mode === 'local') {
      localUndo.push({ before, after, summary: words });
      if (localUndo.length > 200) localUndo.shift();
      localRedo = [];
      setProject(after, 'change');
      return { ok: true, summary: words };
    }
    outbox.push({ id: newChangeId(), ops, summary: summary || null, words, before });
    redoSeqs = [];
    localRedo = [];
    lastActive = clock.now();
    setProject(after, 'change');
    flush();
    return { ok: true, summary: words };
  }

  /** The page's copy: the server's, with the changes still waiting applied on top (a waiting change that no longer applies is dropped and said). */
  function rebase() {
    let doc = confirmed;
    for (let i = 0; i < outbox.length; i++) {
      try { doc = { ...applyOps(doc, outbox[i].ops), id: confirmed.id, seq: confirmed.seq }; } catch (e) {
        echo(`Not saved: ${outbox[i].words}. ${e.message}`, 'error');
        outbox.splice(i--, 1);
      }
    }
    setProject(doc, 'sync');
  }

  function flush() {
    if (flushing || mode !== 'server') return flushing;
    flushing = (async () => {
      try {
        while (outbox.length && !stopped) {
          const e = outbox[0];
          net('saving', `Saving ${plural(outbox.length, 'change')}...`);
          const r = await api.postChange(pid(), { ops: e.ops, ...(e.summary ? { summary: e.summary } : {}), base_seq: confirmed.seq, id: e.id });
          if (r.offline) {
            net('offline', `Offline: ${plural(outbox.length, 'change')} not saved yet. ${notOurs(r) ? SIGN_IN : 'They are sent when the server answers.'}`);
            break;
          }
          outbox.shift();
          mine.add(e.id);
          if (r.ok) {
            const d = r.data;
            const p = projectOf(r);
            if (d && !d.nothing && p) {
              if (d.seq === seen + 1) seen = d.seq;
              confirmed = p;
            }
          } else {
            echo(`Not saved: ${r.error}`, 'error');
            if (r.status === 409) await refetch();
          }
          rebase();
        }
      } catch (e) {
        // Something broke while saving: the change stays in the outbox and goes with the next try.
        echo(`Saving stopped for a moment (${(e && e.message) || e}). It tries again by itself.`, 'error');
      } finally {
        flushing = null;
        if (!outbox.length) net('saved', savedText());
        schedule(outbox.length ? POLL_MS * 2 : 50);
      }
    })();
    return flushing;
  }

  async function refetch() {
    const got = await api.getProject(pid());
    const p = projectOf(got);
    if (got.ok && p) { confirmed = p; seen = Math.max(seen, confirmed.seq); }
  }

  const hidden = () => !!doc && doc.visibilityState === 'hidden';

  /** The next tick in ms (the poll's pace when not given). A hidden tab with nothing to save waits for wake(). */
  function schedule(ms) {
    clock.clearTimeout(timer);
    timer = 0;
    if (stopped || mode !== 'server') return;
    if (hidden() && !outbox.length) return;
    const wait = ms === undefined ? pollDelay(clock.now() - lastActive) : ms;
    dueAt = clock.now() + wait;
    timer = clock.setTimeout(tick, wait);
  }

  async function tick() {
    timer = 0;
    if (outbox.length) {
      try { await flush(); } catch { /* flush schedules the next tick itself, whatever happens */ }
      return;
    }
    try {
      if (!hidden()) await poll();
    } catch (e) {
      // A broken answer never stops the poll: the next one is asked for as usual.
      void e;
    } finally {
      if (!timer && !flushing) schedule();
    }
  }

  /** Her input (a click, a key, the wheel): the poll goes back to its quick pace at once. */
  function active() {
    const now = clock.now();
    lastActive = now;
    if (timer && dueAt - now > POLL_MS) schedule(POLL_MS);
  }

  /** The window got focus or the tab shows again: ask the server now. */
  function wake() {
    lastActive = clock.now();
    if (!flushing && !polling) schedule(30);
  }

  /** Asks for changes since the newest one seen; takes the server's project when something is new. */
  async function poll() {
    if (mode !== 'server' || polling || flushing || outbox.length) return;
    polling = true;
    try {
      const r = await api.poll(pid(), seen);
      if (r.offline) { net('offline', notOurs(r) ? `Offline: ${SIGN_IN} Changes are not saved until the server answers.` : 'Offline: the server cannot be reached. Changes are not being saved until it answers.'); return; }
      if (!r.ok) { if (r.status === 400 || r.status === 404) echo(r.error, 'error'); return; }
      const d = r.data;
      if (!d || typeof d !== 'object' || !Number.isFinite(d.seq)) return;
      if (store.get().net.state === 'offline') net('saved', savedText());
      const fresh = projectOf(r);
      if (!fresh) { seen = d.seq; return; }
      for (const c of Array.isArray(d.changes) ? d.changes : []) {
        if (!c || mine.has(c.batch_id)) continue;
        const who = c.actor === 'claude' ? 'Claude' : 'Changed in another window';
        const opt = optionOf(c, fresh);
        echo(`${who}: ${c.summary}${opt ? `, on ${opt}` : ''}.`, c.actor === 'claude' ? 'claude' : 'note');
      }
      if (d.reset) echo('The drawing was brought up to date with the server.', 'note');
      if (d.seq > seen) lastActive = clock.now();   // something changed: the poll keeps its quick pace
      seen = d.seq;
      if (outbox.length || flushing) return;
      if (!confirmed || fresh.seq >= confirmed.seq) {
        confirmed = fresh;
        if (!sameDrawing(store.get().project, fresh) || store.get().project.seq !== fresh.seq) setProject(fresh, 'remote');
      }
    } finally {
      polling = false;
    }
  }

  function optionOf(c, project) {
    const ids = [...new Set((c.ops || []).map((o) => (typeof o.option === 'string' ? o.option : o.option && o.option.id)).filter(Boolean))];
    if (ids.length !== 1 || project.options.length < 2) return null;
    const o = project.options.find((x) => x.id === ids[0]);
    return o ? o.name : `Option ${ids[0]}`;
  }

  async function undo() {
    if (mode === 'local') {
      const e = localUndo.pop();
      if (!e) return { ok: false, error: 'There is nothing to undo.' };
      localRedo.push(e);
      setProject(e.before, 'undo');
      return { ok: true, summary: undidWords('user', e.summary) };
    }
    if (outbox.length && store.get().net.state === 'offline') {
      const e = outbox.pop();
      localRedo.push(e);
      rebase();
      return { ok: true, summary: `${undidWords('user', e.words)} (it had not been saved yet)` };
    }
    if (flushing) await flushing;
    const r = await api.undo(pid(), { id: newChangeId() });
    return afterUndo(r, true);
  }

  async function redo() {
    if (mode === 'local' || (localRedo.length && !redoSeqs.length)) {
      const e = localRedo.pop();
      if (!e) return { ok: false, error: 'There is nothing to redo.' };
      if (mode === 'local') { localUndo.push(e); setProject(e.after, 'redo'); return { ok: true, summary: `Redo: ${e.summary}` }; }
      outbox.push(e);
      rebase();
      flush();
      return { ok: true, summary: `Redo: ${e.words}` };
    }
    const seq = redoSeqs.pop();
    if (seq == null) return { ok: false, error: 'There is nothing to redo.' };
    if (flushing) await flushing;
    const r = await api.undo(pid(), { seq, id: newChangeId() });
    return afterUndo(r, false);
  }

  function afterUndo(r, isUndo) {
    if (r.offline) { net('offline', 'Offline: undo needs the server. Try again when it answers.'); return { ok: false, error: 'Undo needs the server, and it cannot be reached just now.' }; }
    if (!r.ok) return { ok: false, error: r.error };
    const d = r.data;
    if (d && d.nothing) return { ok: true, summary: d.summary };
    const p = projectOf(r);
    if (!d || !d.change || !p) return { ok: false, error: BROKEN };
    mine.add(d.change.batch_id);
    if (d.seq === seen + 1) seen = d.seq;
    confirmed = p;
    if (isUndo) redoSeqs.push(d.seq);
    lastActive = clock.now();
    setProject(confirmed, isUndo ? 'undo' : 'redo');
    schedule(50);
    // The answer names the change that went (undone: {seq, actor, summary}); an older server leaves it out.
    const u = d.undone;
    if (isUndo && u && typeof u === 'object' && typeof u.summary === 'string' && u.summary) return { ok: true, summary: undidWords(u.actor, u.summary), actor: u.actor };
    return { ok: true, summary: d.change.summary };
  }

  /** Opens another of her projects (OPEN, NEW). */
  async function open(id) {
    if (mode !== 'server') return { ok: false, error: 'Opening projects needs the server. Open First Pass from your link.' };
    if (flushing) await flushing;
    const got = await api.getProject(id);
    if (!got.ok || !projectOf(got)) return { ok: false, error: got.error || BROKEN };
    confirmed = got.data.project;
    seen = confirmed.seq;
    redoSeqs = []; localRedo = []; outbox.length = 0;
    store.set({ selection: [], optionId: confirmed.options[0].id }, 'option');
    setProject(confirmed, 'load');
    net('saved', savedText());
    schedule();
    return { ok: true, project: confirmed };
  }

  /** Back to a fresh sample on the page (NEW with no server). */
  function resetLocal() {
    localUndo = []; localRedo = [];
    setProject(sampleProject(), 'load');
  }

  if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') wake(); });

  return {
    start, change, undo, redo, poll, flush, open, resetLocal, active, wake,
    mode: () => mode,
    waiting: () => outbox.length,
    projectId: pid,
    /** When the next tick is due, in ms from now (null when none is waiting). */
    nextIn: () => (timer ? dueAt - clock.now() : null),
    stop() { stopped = true; clock.clearTimeout(timer); timer = 0; },
    option: () => currentOption(store.get()),
  };
}

/** The line for an undo: whose change went, and what it was. */
export function undidWords(actor, summary) {
  const what = String(summary || '').replace(/^(Undo|Redo): /, '');
  return `${actor === 'claude' ? 'Undid Claude\'s change' : 'Undid your change'}: ${what}`;
}
