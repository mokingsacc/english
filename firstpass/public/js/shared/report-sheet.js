// Report a problem: the sheet, loaded only when opened (ported from practice-hub). One text box, Add a screenshot, and
// Copy for Claude: a short ready prompt goes on the clipboard at once (the report's id, her words, the page, and how to
// read it in full with the First Pass connector's bugs tool and this repo's fix-bugs skill), and the report is saved in
// the background:
//   1. the last few read-only GETs are asked again with X-Trace-Keep: 1, so the server keeps their traces;
//   2. POST /api/bugs with an id made here (a resend is the same report): her words, the page and fpState() (with the
//      full current project), the last 10 calls (address, status, time, trace id, an error's first 2 KB), the last 30
//      breadcrumbs, the errors, the device, the screenshot (made smaller here first);
//   3. no connection or a failure: it waits in this browser (fp.bugq) and goes on the next load.
// The page keeps her key in localStorage 'fp.key' (from the link's #k=); it goes only in the X-Key header.
import { crumbs } from './report.js';

const QUEUE = 'fp.bugq', KEY = 'fp.key';
const SHOT = { side: 1600, maxBytes: 700_000 };
const RETRACE_OK = /^\/api\/(projects(\/[^/?]+)?|me|settings)$/;
const SKILL = 'firstpass/claude/skills/fix-bugs/SKILL.md';
const ls = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { return null; } };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const CSS = `.rp-sheet{width:min(30rem,calc(100vw - 32px));max-height:calc(100dvh - 32px);margin:auto;padding:0;border:1px solid var(--fp-line,#4a5563);border-radius:4px;
background:var(--fp-panel,#2b333d);color:var(--fp-ink,#d8dee6);font:13px/1.4 var(--fp-font,system-ui,sans-serif);color-scheme:dark}
.rp-sheet::backdrop{background:#0008}.rp-sheet form{display:grid;gap:10px;padding:14px}.rp-sheet h2{margin:0;font-size:15px;font-weight:600}
.rp-shot{display:grid;place-items:center;gap:4px;min-height:80px;padding:10px;border:1px dashed var(--fp-line,#4a5563);border-radius:3px;background:transparent;color:inherit;font:inherit;cursor:pointer}
.rp-shot img{max-width:100%;max-height:30vh}.rp-shot small{opacity:.75}
.rp-sheet textarea{box-sizing:border-box;width:100%;min-height:80px;padding:8px;border:1px solid var(--fp-line,#4a5563);border-radius:3px;background:var(--fp-field,#1e252d);color:inherit;font:inherit;resize:vertical}
.rp-row{display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end;align-items:center}.rp-row .rp-gap{margin-right:auto;opacity:.8}
.rp-btn{min-height:28px;padding:0 12px;border:1px solid var(--fp-line,#4a5563);border-radius:3px;background:var(--fp-button,#36404c);color:inherit;font:inherit;cursor:pointer}
.rp-btn.go{background:var(--fp-accent,#2f6db5);border-color:transparent;color:#fff}
.rp-recent summary{cursor:pointer}.rp-recent ul{list-style:none;margin:6px 0 0;padding:0;display:grid;gap:4px}
.rp-recent li{display:flex;gap:6px;align-items:center}.rp-recent li span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`;

/** A picture made smaller here: {mime, data (base64)}, longest side SHOT.side, under SHOT.maxBytes when it can be. */
export async function shrink(file, { side = SHOT.side, maxBytes = SHOT.maxBytes } = {}) {
  const img = await createImageBitmap(file);
  let scale = Math.min(1, side / Math.max(img.width, img.height)), blob = null;
  for (let tries = 0; tries < 6; tries++) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * scale)); c.height = Math.max(1, Math.round(img.height * scale));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const q = tries < 3 ? 0.82 - tries * 0.12 : 0.6;
    blob = await new Promise(ok => c.toBlob(b => ok(b), 'image/webp', q));
    if (!blob || blob.type !== 'image/webp') blob = await new Promise(ok => c.toBlob(b => ok(b), 'image/jpeg', q));
    if (blob && blob.size <= maxBytes) break;
    if (tries >= 2) scale *= 0.8;
  }
  if (img.close) img.close();
  if (!blob) throw new Error('no picture');
  const data = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, '')); r.onerror = bad; r.readAsDataURL(blob); });
  return { mime: blob.type || 'image/jpeg', data };
}

const fpState = () => { try { return typeof window.fpState === 'function' ? window.fpState() : {}; } catch (e) { return {}; } };
const pageNow = () => `${location.pathname}${location.hash.replace(/k=[^&]*/, 'k=<key>')}`.slice(0, 200);
const newId = () => crypto.randomUUID();

/** The report as POST /api/bugs takes it (pure apart from reading the page). */
export function buildReport({ note = '', shot = null, id = newId(), list = crumbs, state = fpState() } = {}) {
  const all = list.slice(-30).map(c => { const o = { ...c }; delete o.t0; return o; });
  return { id, source: 'page', note: String(note || '').trim().slice(0, 2000), page: pageNow(), state,
    calls: all.filter(c => c.t === 'fetch').slice(-10), crumbs: all, errors: all.filter(c => /^(error|rejection|console)$/.test(c.t)).slice(-10),
    app: { ua: String(navigator.userAgent || '').slice(0, 160), w: innerWidth, h: innerHeight }, ...(shot ? { shot } : {}) };
}

const headers = () => { const h = { 'Content-Type': 'application/json' }; const k = ls(KEY); if (k) h['X-Key'] = k; return h; };

/** The last few read-only GETs asked again with X-Trace-Keep, so their traces are kept: [{u, retrace_id}]. Never throws. */
export async function retrace(calls, f = fetch) {
  const seen = new Set(), out = [];
  for (const c of [...calls].reverse()) {
    if (out.length >= 5) break;
    if (c.m !== 'GET' || !RETRACE_OK.test(c.u) || seen.has(c.u)) continue;
    seen.add(c.u);
    try {
      const res = await f(c.u, { headers: { ...headers(), 'X-Trace-Keep': '1' }, signal: AbortSignal.timeout(8000) });
      const id = res.headers.get('X-Trace-Id');
      if (id) out.push({ u: c.u, retrace_id: id });
    } catch (e) { /* left as it was */ }
  }
  return out;
}

function queue(rep) {
  try {
    const q = JSON.parse(ls(QUEUE) || '[]').filter(x => x && x.id !== rep.id);
    q.push(rep);
    if (ls(QUEUE, JSON.stringify(q.slice(-5))) === null && rep.shot) ls(QUEUE, JSON.stringify(q.slice(-5).map(x => (x.id === rep.id ? { ...rep, shot: undefined } : x))));
  } catch (e) { /* never */ }
}
function dequeue(id) {
  try { const q = JSON.parse(ls(QUEUE) || '[]').filter(x => x && x.id !== id); ls(QUEUE, q.length ? JSON.stringify(q) : null); } catch (e) { /* never */ }
}
export async function send(rep, f = fetch) {
  try { return (await f('/api/bugs', { method: 'POST', headers: headers(), body: JSON.stringify(rep) })).ok; } catch (e) { return false; }
}
/** Retraces, sends, and queues the report when it cannot go now. Never throws. */
export async function submit(rep, f = fetch) {
  try {
    for (const a of await retrace(rep.calls || [], f)) { const c = [...rep.calls].reverse().find(x => x.u === a.u); if (c) c.retrace_id = a.retrace_id; }
  } catch (e) { /* never */ }
  queue(rep);
  if (await send(rep, f)) { dequeue(rep.id); return true; }
  return false;
}
/** The reports waiting in this browser, sent now. */
export async function flushQueue(f = fetch) {
  let q = [];
  try { q = JSON.parse(ls(QUEUE) || '[]'); } catch (e) { q = []; }
  let sent = 0;
  for (const rep of q) if (rep && rep.id && (await send(rep, f))) { dequeue(rep.id); sent++; }
  return sent;
}
addEventListener('online', () => { flushQueue(); });

const one = (t, n) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, n);
/** The prompt Copy for Claude puts on the clipboard (pure). */
export function claudePrompt({ id, note = '', page = '', state = null } = {}) {
  const words = one(note, 600);
  const open = Object.entries(state || {}).filter(([k, v]) => k !== 'hash' && v != null && v !== '' && typeof v !== 'object').slice(0, 6).map(([k, v]) => `${k}: ${one(v, 60)}`).join(', ');
  return `In Claude Code: fix this First Pass problem. Report ${id}: ${words ? `"${words}"` : '(a screenshot, no words)'}. Page: ${one(page, 200) || 'not known'}${open ? ` (${open})` : ''}. `
    + `Read it in full (traces, screenshot and the project) with the First Pass connector's bugs tool {action: "get", id: "${id}"}, follow ${SKILL}, then tell me what you understood before changing anything.`;
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* the fallback below */ }
  try {
    const t = document.createElement('textarea');
    t.value = text; t.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(t); t.select();
    const ok = document.execCommand && document.execCommand('copy');
    t.remove();
    return !!ok;
  } catch (e) { return false; }
}
async function recentReports(f = fetch) {
  try { const r = await f('/api/bugs?state=open&limit=5', { headers: headers() }); return r.ok ? ((await r.json()).reports || []).slice(0, 5) : []; } catch (e) { return []; }
}

let dlg = null;
/** Opens the sheet (one per page). */
export function openSheet() {
  if (!document.getElementById('rp-css')) { const st = document.createElement('style'); st.id = 'rp-css'; st.textContent = CSS; document.head.appendChild(st); }
  if (dlg && document.body.contains(dlg)) { dlg.showModal(); return dlg; }
  dlg = document.createElement('dialog');
  dlg.className = 'rp-sheet';
  dlg.innerHTML = `<form method="dialog"><h2>Report a problem</h2>
    <button type="button" class="rp-shot" data-rp-shot><b>Add a screenshot</b><small>Choose a file or paste one. A screenshot alone is enough.</small></button>
    <input type="file" accept="image/*" hidden data-rp-file>
    <textarea data-rp-note placeholder="What went wrong?" aria-label="What went wrong"></textarea>
    <div class="rp-row"><span class="rp-gap" data-rp-msg role="status"></span><button type="button" class="rp-btn" data-rp-cancel>Cancel</button><button type="submit" class="rp-btn go">Copy for Claude</button></div>
    <details class="rp-recent" hidden data-rp-recent><summary>Open reports</summary><ul data-rp-list></ul></details></form>`;
  document.body.appendChild(dlg);
  let shot = null, shrinking = null;
  const $ = s => dlg.querySelector(s);
  const msg = t => { $('[data-rp-msg]').textContent = t; };
  const take = file => {
    if (!file || !/^image\//.test(file.type)) return;
    msg('Making the picture smaller...');
    shrinking = shrink(file).then(s => { shot = s; $('[data-rp-shot]').innerHTML = `<img alt="Your screenshot" src="data:${esc(s.mime)};base64,${s.data}">`; msg(''); },
      () => { shot = null; msg('That picture could not be read. Try another.'); }).finally(() => { shrinking = null; });
  };
  $('[data-rp-shot]').addEventListener('click', () => $('[data-rp-file]').click());
  $('[data-rp-file]').addEventListener('change', e => take(e.target.files && e.target.files[0]));
  dlg.addEventListener('paste', e => { const it = [...((e.clipboardData && e.clipboardData.items) || [])].find(x => x.kind === 'file' && /^image\//.test(x.type)); if (it) { e.preventDefault(); take(it.getAsFile()); } });
  $('[data-rp-cancel]').addEventListener('click', () => dlg.close());
  recentReports().then(list => {
    if (!list.length || !dlg) return;
    $('[data-rp-list]').innerHTML = list.map((r, i) => `<li><span>${esc(r.note || 'A screenshot, no words')}</span><button type="button" class="rp-btn" data-rp-copy="${i}">Copy</button></li>`).join('');
    dlg.querySelectorAll('[data-rp-copy]').forEach(b => b.addEventListener('click', async () => {
      const r = list[Number(b.dataset.rpCopy)];
      b.textContent = (await copyText(claudePrompt({ id: r.id, note: r.note, page: r.page }))) ? 'Copied' : 'Not copied';
    }));
    $('[data-rp-recent]').hidden = false;
  });
  $('form').addEventListener('submit', async e => {
    e.preventDefault();
    const note = $('[data-rp-note]').value;
    if (!note.trim() && !shot && !shrinking) { msg('Say what went wrong, or add a screenshot.'); return; }
    const pending = shrinking, state = fpState(), list = crumbs.slice(), id = newId();
    const text = claudePrompt({ id, note, page: pageNow(), state });
    const copied = await copyText(text);   // inside the click, where browsers allow it
    (async () => { try { if (pending) await pending; } catch (err) { /* saved without the picture */ } submit(buildReport({ note, shot, state, list, id })); })();
    $('form').innerHTML = `<h2>${copied ? 'Copied. Paste it into Claude.' : 'Copy this into Claude'}</h2>
      <p>${copied ? 'The report is saved on the server too; Claude reads it in full from there.' : 'Your browser would not copy it. Select the text and copy it.'}</p>
      <textarea readonly aria-label="The prompt for Claude">${esc(text)}</textarea>
      <div class="rp-row"><button type="button" class="rp-btn go" data-rp-done>Done</button></div>`;
    $('[data-rp-done]').addEventListener('click', () => { dlg.close(); dlg.remove(); dlg = null; });
  });
  dlg.showModal();
  return dlg;
}
