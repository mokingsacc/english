// The only place the page talks to the server (CONTRACT.md has every route). The key comes from the link (#k=<key>),
// is kept in localStorage as fp.key (the Report a problem sheet reads it there) and goes in the X-Key header on every
// call. Every call answers { ok, status, data, error, offline }: error is the server's plain sentence, offline is true
// when the server could not be reached at all, or answered ok with something that is not First Pass's JSON (data is
// then null and nothing is read from it). Nothing here throws.
//   const api = createApi();  api.hasKey();  await api.listProjects();  await api.postChange(id, body)
// A new route: one method here that calls call().

const KEY = 'fp.key';
export const NOT_FIRST_PASS = 'The answer did not come from the First Pass server. A sign-in page on this network may be in the way.';

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* the key then lives for this page only */ } },
};

/** The parts of a page link: #k=<key>&p=<project>&o=<option>&do=<action>. */
export function parseLink(hash) {
  const out = {};
  for (const part of String(hash || '').replace(/^#/, '').split('&')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try { out[part.slice(0, i)] = decodeURIComponent(part.slice(i + 1)); } catch { /* a broken part is left out */ }
    }
  }
  return out;
}

/** The link for a project and option, without the key (the key is kept out of the address bar). */
export function linkFor({ p, o, act } = {}) {
  const parts = [];
  if (p) parts.push(`p=${encodeURIComponent(p)}`);
  if (o) parts.push(`o=${encodeURIComponent(o)}`);
  if (act) parts.push(`do=${encodeURIComponent(act)}`);
  return parts.length ? `#${parts.join('&')}` : '';
}

export function createApi({ base = '', timeoutMs = 10000 } = {}) {
  let key = null;
  const link = parseLink(typeof location !== 'undefined' ? location.hash : '');
  if (link.k) { key = link.k; store.set(KEY, key); } else key = store.get(KEY);

  async function call(method, path, body, { raw = false, timeout = timeoutMs } = {}) {
    const headers = {};
    if (key) headers['X-Key'] = key;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), timeout) : 0;
      // window.fetch is read at call time: report.js wraps it to add a traceparent and keep breadcrumbs.
      res = await globalThis.fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: ctl ? ctl.signal : undefined });
      clearTimeout(timer);
    } catch {
      return { ok: false, status: 0, data: null, offline: true, error: 'The First Pass server could not be reached.' };
    }
    if (raw) return { ok: res.ok, status: res.status, data: res, error: res.ok ? null : await errorOf(res), offline: false };
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    // An answer that says ok but carries no JSON object did not come from First Pass: a sign-in page on a hotel or site
    // network, a proxy's notice, or an answer cut off on a weak line. It counts as no server, so a change waits and is
    // sent again, and nothing is read from it.
    if (res.ok && (data === null || typeof data !== 'object')) return { ok: false, status: res.status, data: null, offline: true, error: NOT_FIRST_PASS };
    const error = res.ok ? null : (data && data.error) || `The server answered ${res.status}.`;
    // 5xx from a proxy or a dev server that is not there behaves like no server.
    const offline = res.status === 502 || res.status === 503 || res.status === 504;
    return { ok: res.ok, status: res.status, data, error, offline };
  }

  return {
    hasKey: () => !!key,
    link,
    call,
    me: () => call('GET', '/api/me'),
    listProjects: () => call('GET', '/api/projects'),
    createProject: (body) => call('POST', '/api/projects', body),
    getProject: (id) => call('GET', `/api/projects/${encodeURIComponent(id)}`),
    postChange: (id, body) => call('POST', `/api/projects/${encodeURIComponent(id)}/changes`, body),
    poll: (id, since) => call('GET', `/api/projects/${encodeURIComponent(id)}/changes?since=${since}`, undefined, { timeout: 8000 }),
    undo: (id, body) => call('POST', `/api/projects/${encodeURIComponent(id)}/undo`, body),
    selfcheck: () => call('GET', '/api/selfcheck', undefined, { timeout: 15000 }),
    tileUrl: (z, x, y) => `${base}/tiles/naip/${z}/${x}/${y}`,
  };
}

async function errorOf(res) {
  try { const d = await res.clone().json(); if (d && d.error) return d.error; } catch { /* not JSON */ }
  return `The server answered ${res.status}.`;
}

/** A fresh change id (the server's batch id: a resend of the same change is answered, not applied twice). */
export function newChangeId() {
  const c = globalThis.crypto;
  if (c && c.randomUUID) return `pg_${c.randomUUID().replace(/-/g, '').slice(0, 20)}`;
  return `pg_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
