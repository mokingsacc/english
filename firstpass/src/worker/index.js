// First Pass Worker entry (Cloudflare Pages, advanced mode; scripts/build.mjs bundles it to public/_worker.js): the
// keyed API under /api/* (X-Key header), the connector at /mcp/<token>, aerial tiles at /tiles/*, static files otherwise.
// public/_routes.json sends only those three prefixes to the Worker, so static files never invoke it. This file exports
// only the handler (workerd refuses an entry that exports anything else); the route table is routes.js.
import { handleMcp } from './mcp/server.js';
import { traceRequest, noteTrace } from './debug/trace.js';
import { userByKey } from './store/users.js';
import { HttpError, errorResponse } from './http.js';
import { KEY_HEADER, WORKER_PREFIXES, findRoute } from './routes.js';

const SERVER_FAULT = 'Something went wrong on the server. Try again in a moment; if it keeps happening, use Report a problem.';

async function serve(request, env, ctx, url) {
  const p = url.pathname;
  if (p.startsWith('/mcp/')) return handleMcp(request, env, url);
  const { route, match, pathMatched } = findRoute(p, request.method);
  if (!route) {
    if (pathMatched) return errorResponse(405, 'That action is not available at this address.');
    if (WORKER_PREFIXES.some(x => p.startsWith(x))) return errorResponse(404, 'There is nothing at that address.');
    return staticFile(request, env);
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

/**
 * A static file the Worker was asked for. _routes.json keeps static paths away from the Worker, so this runs only when
 * that list is wrong; the X-FP-Via header says so (npm run test:workerd checks that / never carries it).
 */
async function staticFile(request, env) {
  if (!env.ASSETS) return new Response('Not found', { status: 404 });
  const res = await env.ASSETS.fetch(request);
  const out = new Response(res.body, res);
  out.headers.set('X-FP-Via', 'worker');
  return out;
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
