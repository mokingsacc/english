// Report a problem, loaded by the page (ported from practice-hub; report-sheet.js explains). Kept small: breadcrumbs, the
// W3C traceparent on the page's own /api calls, window.fpState() and the button hook. The sheet loads only when opened.
//
// The page adds what it knows: window.fpParts.<name> = () => ({project_id, option, selection, project, ...}); fpState()
// merges the parts with the address (the #k= key left out). `project` should be the full current project JSON, so a
// geometry problem replays as a test fixture. Any element with data-report-btn opens the sheet; so does window.fpReport().
const W = window, D = document, LS = 'fp.capture';
export const crumbs = [];
const ls = (k, v) => { try { return v === undefined ? localStorage.getItem(k) : v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { return null; } };
const cut = (s, n) => String(s == null ? '' : s).slice(0, n);
const hash = () => location.hash.replace(/k=[^&]*/, 'k=<key>');
export const crumb = c => { try { c.at = Date.now(); crumbs.push(c) > 30 && crumbs.shift(); } catch (e) { /* never */ } };
const hex = () => crypto.randomUUID().replace(/-/g, '');
const parts = W.fpParts = W.fpParts || {};
W.fpState = W.fpState || (() => { const o = { hash: hash() }; for (const k in parts) try { Object.assign(o, parts[k]()); } catch (e) { /* a part that breaks is left out */ } return o; });
const on = (t, ev, fn, c) => t.addEventListener(ev, e => { try { fn(e); } catch (x) { /* never */ } }, c);
// The 1.5 s poll is not a breadcrumb unless it fails, or it would push everything else out.
const POLL = /\/changes\?since=/;

if (!(+ls(LS) > Date.now()) && W.fetch && !W.fetch.fp) {
  const orig = W.fetch;
  let off = false;
  W.fetch = function (input, init) {
    let rec = null, args = arguments;
    try {
      const u = new URL(typeof input === 'string' ? input : String((input && input.url) || input), location.href);
      if (u.origin === location.origin && !u.pathname.indexOf('/api/') && !(input instanceof Request)) {
        const id = hex(), h = new Headers((init && init.headers) || undefined);
        h.has('traceparent') || h.set('traceparent', `00-${id}-${hex().slice(16)}-01`);
        args = [input, Object.assign({}, init, { headers: h })];
        rec = { t: 'fetch', u: cut(u.pathname + u.search, 200), m: cut((init && init.method) || 'GET', 8), id, t0: performance.now() };
      }
    } catch (e) { rec = null; args = arguments; }
    const p = orig.apply(this, args);
    rec && p.then(res => {
      try {
        const id = res.headers.get('X-Trace-Id');
        Object.assign(rec, { s: res.status, ms: Math.round(performance.now() - rec.t0), t0: undefined }, id && { id });
        // No X-Trace-Id: capture is off on the server; stop sending traceparent for an hour.
        if (res.status !== 401 && off !== !id) { off = !id; ls(LS, off ? String(Date.now() + 36e5) : null); }
        if (!(res.ok && POLL.test(rec.u))) crumb(rec);
        if (res.status >= 400 && /json|text/.test(res.headers.get('Content-Type'))) res.clone().text().then(t => { rec.sum = cut(t, 2048); }, () => {});
      } catch (e) { /* never */ }
    }, e => { rec.s = 0; rec.t0 = undefined; rec.err = cut(e && e.name, 40); crumb(rec); });
    return p;
  };
  W.fetch.fp = 1;
  const ce = console.error;
  console.error = function () { try { crumb({ t: 'console', msg: cut(Array.from(arguments, a => (a && a.message) || a).join(' '), 300) }); } catch (e) { /* never */ } return ce.apply(this, arguments); };
  on(W, 'error', e => crumb({ t: 'error', msg: cut(e.message, 300), src: `${cut(e.filename, 99)}:${e.lineno}` }));
  on(W, 'unhandledrejection', e => crumb({ t: 'rejection', msg: cut((e.reason && (e.reason.stack || e.reason.message)) || e.reason, 400) }));
  on(W, 'hashchange', () => crumb({ t: 'nav', to: cut(hash(), 120) }));
  on(D, 'click', e => {
    const el = e.target.closest && e.target.closest('button,a,[role=button]');
    const name = el && (el.getAttribute('aria-label') || el.title || el.id || el.textContent.trim());
    name && name.length < 41 && crumb({ t: 'tap', name });
  }, true);
}

const sheet = f => import('./report-sheet.js').then(m => m[f](), () => {});
/** Opens the Report a problem sheet (the page's button, a command, a menu). */
W.fpReport = () => sheet('openSheet');
on(D, 'click', e => { const b = e.target.closest && e.target.closest('[data-report-btn]'); if (b) { e.preventDefault(); W.fpReport(); } });
// Reports queued offline go once the page is idle.
ls('fp.bugq') && setTimeout(() => sheet('flushQueue'), 4000);
