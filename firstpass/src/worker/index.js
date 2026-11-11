// First Pass Worker entry (Cloudflare Pages, advanced mode; scripts/build.mjs bundles it to public/_worker.js): the
// keyed API under /api/* (X-Key header), the connector at /mcp/<token>, aerial tiles at /tiles/*, static files otherwise.
// public/_routes.json sends only those three prefixes to the Worker, so static files never invoke it.
import * as account from './api/account.js';
import * as projects from './api/projects.js';
import * as changes from './api/changes.js';
import * as selfcheck from './api/selfcheck.js';
import * as tiles from './api/tiles.js';
import * as bugs from './debug/bugs.js';
import { handleMcp } from './mcp/server.js';
import { traceRequest, noteTrace } from './debug/trace.js';
import { userByKey } from './store/users.js';
import { HttpError, errorResponse } from './http.js';

export const KEY_HEADER = 'X-Key';
/** The address prefixes the Worker answers; public/_routes.json includes exactly these (a test holds them in step). */
export const WORKER_PREFIXES = ['/api/', '/mcp/', '/tiles/'];

// Every route module exports routes: [{method, pattern, handler, auth?}]; auth is 'key' (the default) or 'none'.
const MODULES = [account, projects, changes, selfcheck, bugs, tiles];

function compile(r) {
  const keys = [];
  const re = new RegExp(`^${r.pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
  return { ...r, auth: r.auth || 'key', re, keys };
}
const ROUTES = MODULES.flatMap(m => m.routes).map(compile);

/** Every route as {method, pattern, auth, handler}, plus the connector's address (for the agent map and the tests). */
export function routeTable() {
  return ROUTES.map(r => ({ method: r.method, pattern: r.pattern, auth: r.auth, handler: r.handler }))
    .concat([{ method: 'POST', pattern: '/mcp/:token', auth: 'token', handler: handleMcp }]);
}

const SERVER_FAULT = 'Something went wrong on the server. Try again in a moment; if it keeps happening, use Report a problem.';

async function serve(request, env, ctx, url) {
  const p = url.pathname;
  if (p.startsWith('/mcp/')) return handleMcp(request, env, url);
  let route = null, match = null, pathMatched = false;
  for (const r of ROUTES) {
    const m = r.re.exec(p);
    if (!m) continue;
    pathMatched = true;
    if (r.method === request.method) { route = r; match = m; break; }
  }
  if (!route) {
    if (pathMatched) return errorResponse(405, 'That action is not available at this address.');
    if (WORKER_PREFIXES.some(x => p.startsWith(x))) return errorResponse(404, 'There is nothing at that address.');
    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Not found', { status: 404 });
  }
  noteTrace(t => { t.route = `${route.method} ${route.pattern}`; });
  let user = null;
  if (route.auth === 'key') {
    user = await userByKey(env.DB, request.headers.get(KEY_HEADER));
    if (!user) return errorResponse(401, 'This needs your First Pass link, the one with #k= in it. Open First Pass from that link again.');
    noteTrace(t => { t.user = user.id; });
  }
  const params = {};
  try { route.keys.forEach((k, i) => { params[k] = decodeURIComponent(match[i + 1]); }); } catch {
    return errorResponse(400, 'That address is not valid.');
  }
  try {
    return await route.handler(request, env, ctx, params, url, user);
  } catch (e) {
    if (e instanceof HttpError) return errorResponse(e.status, e.message, e.extra);
    noteTrace(t => t.fail(e));
    console.error('server error', request.method, route.pattern, e && e.message);
    return errorResponse(500, SERVER_FAULT);
  }
}

const traced = p => (p.startsWith('/api/') && p !== '/api/health') || p.startsWith('/mcp/');

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      const res = traced(url.pathname) ? await traceRequest(request, env, ctx, url, serve) : await serve(request, env, ctx, url);
      if (WORKER_PREFIXES.some(x => url.pathname.startsWith(x))) {
        try { res.headers.set('X-Robots-Tag', 'noindex, nofollow'); } catch { /* fixed headers: left as they are */ }
      }
      return res;
    } catch (e) {
      console.error('server error', request.method, url.pathname.startsWith('/mcp/') ? '/mcp/<token>' : url.pathname, e && e.message);
      return errorResponse(500, SERVER_FAULT);
    }
  },
};
