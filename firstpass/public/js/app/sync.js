// Changes, undo and the 1.5 s poll. change(ops) applies the ops on the page at once (app/ops.js) and sends them to
// POST /api/projects/:id/changes; the answer's project (the server's whole copy) replaces the page's. Changes wait in
// an outbox while the server cannot be reached and go, in order, when it answers again (each has an id, so a resend
// is never applied twice). After any change, and every 1.5 s while the page is visible, the poll asks for changes
// since the newest one it has seen; changes made through Claude (or another window) come in as named lines in the
// command history and the drawing updates without a reload.
//
// With no key, or no server when the page opened, everything stays on the page: change and undo work on a local
// history, and the status bar says the changes are not being saved.
//   const sync = createSync({ api, store, echo });  await sync.start();  sync.change(ops, summary);  sync.undo()
import { applyOps, sameDrawing, describe, OpRefused } from './ops.js';
import { newChangeId } from './api.js';
import { sampleProject } from './sample.js';
import { currentOption } from './store.js';

export const POLL_MS = 1500;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function createSync({ api, store, echo = () => {}, onProject = () => {}, doc = globalThis.document }) {
  let mode = 'local';
  let confirmed = null;            // the server's copy, as last answered
  let seen = 0;                    // the newest change seq the history has shown
  const outbox = [];               // [{ id, ops, summary, before }] not yet answered
  const mine = new Set();          // change ids sent from this page
  let localUndo = [], localRedo = [];
  let redoSeqs = [];
  let flushing = null, timer = 0, stopped = false, polling = false;

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
    let got = projectId ? await api.getProject(projectId) : null;
    if (got && got.offline) return goLocal(sampleProject(), 'Not saved: the server cannot be reached. Reload when it is back.');
    if (!got || !got.ok) {
      if (got && !got.ok && got.status !== 404) echo(got.error, 'error');
      if (got && got.status === 404) echo('That project is not one of yours, so your newest project is open instead.', 'note');
      const list = await api.listProjects();
      if (list.offline) return goLocal(sampleProject(), 'Not saved: the server cannot be reached. Reload when it is back.');
      if (!list.ok) { echo(list.error, 'error'); return goLocal(sampleProject(), `Not saved: ${list.error}`); }
      let id = list.data.projects[0] && list.data.projects[0].id;
      if (!id) {
        const made = await api.createProject({ sample: true });
        if (!made.ok) { echo(made.error, 'error'); return goLocal(sampleProject(), `Not saved: ${made.error}`); }
        id = made.data.project.id;
      }
      got = await api.getProject(id);
      if (!got.ok) { echo(got.error, 'error'); return goLocal(sampleProject(), `Not saved: ${got.error}`); }
    }
    mode = 'server';
    confirmed = got.data.project;
    seen = confirmed.seq;
    setProject(confirmed, 'load');
    net('saved', savedText());
    schedule();
    return got.data;
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
      while (outbox.length && !stopped) {
        const e = outbox[0];
        net('saving', `Saving ${plural(outbox.length, 'change')}...`);
        const r = await api.postChange(pid(), { ops: e.ops, ...(e.summary ? { summary: e.summary } : {}), base_seq: confirmed.seq, id: e.id });
        if (r.offline) {
          net('offline', `Offline: ${plural(outbox.length, 'change')} not saved yet. They are sent when the server answers.`);
          break;
        }
        outbox.shift();
        mine.add(e.id);
        if (r.ok) {
          if (!r.data.nothing && r.data.project) {
            if (r.data.seq === seen + 1) seen = r.data.seq;
            confirmed = r.data.project;
          }
        } else {
          echo(`Not saved: ${r.error}`, 'error');
          if (r.status === 409) await refetch();
        }
        rebase();
      }
      if (!outbox.length) net('saved', savedText());
      flushing = null;
      schedule(outbox.length ? POLL_MS * 2 : 50);
    })();
    return flushing;
  }

  async function refetch() {
    const got = await api.getProject(pid());
    if (got.ok) { confirmed = got.data.project; seen = Math.max(seen, confirmed.seq); }
  }

  function schedule(ms = POLL_MS) {
    clearTimeout(timer);
    if (stopped || mode !== 'server') return;
    timer = setTimeout(tick, ms);
  }

  async function tick() {
    if (outbox.length) { await flush(); return; }
    if (!doc || doc.visibilityState !== 'hidden') await poll();
    schedule();
  }

  /** Asks for changes since the newest one seen; takes the server's project when something is new. */
  async function poll() {
    if (mode !== 'server' || polling || flushing || outbox.length) return;
    polling = true;
    try {
      const r = await api.poll(pid(), seen);
      if (r.offline) { net('offline', 'Offline: the server cannot be reached. Changes are not being saved until it answers.'); return; }
      if (!r.ok) { if (r.status === 400 || r.status === 404) echo(r.error, 'error'); return; }
      if (store.get().net.state === 'offline') net('saved', savedText());
      const d = r.data;
      if (!d.project) { seen = d.seq; return; }
      for (const c of d.changes || []) {
        if (mine.has(c.batch_id)) continue;
        const who = c.actor === 'claude' ? 'Claude' : 'Changed in another window';
        const opt = optionOf(c, d.project);
        echo(`${who}: ${c.summary}${opt ? `, on ${opt}` : ''}.`, c.actor === 'claude' ? 'claude' : 'note');
      }
      if (d.reset) echo('The drawing was brought up to date with the server.', 'note');
      seen = d.seq;
      if (outbox.length || flushing) return;
      const fresh = d.project;
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
      return { ok: true, summary: `Undo: ${e.summary}` };
    }
    if (outbox.length && store.get().net.state === 'offline') {
      const e = outbox.pop();
      localRedo.push(e);
      rebase();
      return { ok: true, summary: `Undo: ${e.words} (it had not been saved yet)` };
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
    if (r.data.nothing) return { ok: true, summary: r.data.summary };
    mine.add(r.data.change.batch_id);
    if (r.data.seq === seen + 1) seen = r.data.seq;
    confirmed = r.data.project;
    if (isUndo) redoSeqs.push(r.data.seq);
    setProject(confirmed, isUndo ? 'undo' : 'redo');
    schedule(50);
    return { ok: true, summary: r.data.change.summary };
  }

  /** Opens another of her projects (OPEN, NEW). */
  async function open(id) {
    if (mode !== 'server') return { ok: false, error: 'Opening projects needs the server. Open First Pass from your link.' };
    if (flushing) await flushing;
    const got = await api.getProject(id);
    if (!got.ok) return { ok: false, error: got.error };
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

  if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') schedule(30); });

  return {
    start, change, undo, redo, poll, flush, open, resetLocal,
    mode: () => mode,
    waiting: () => outbox.length,
    projectId: pid,
    stop() { stopped = true; clearTimeout(timer); },
    option: () => currentOption(store.get()),
  };
}
