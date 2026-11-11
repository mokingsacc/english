// The Worker's route table: every route module's routes, compiled once, plus the names the router and the tests share
// (the key header, the address prefixes the Worker answers). Kept out of index.js because a Pages Worker's entry file
// may export only its handler: workerd refuses to start one that exports anything else.
import * as account from './api/account.js';
import * as projects from './api/projects.js';
import * as changes from './api/changes.js';
import * as selfcheck from './api/selfcheck.js';
import * as tiles from './api/tiles.js';
import * as exporting from './api/export.js';
import * as bugs from './debug/bugs.js';
import { handleMcp } from './mcp/server.js';

export const KEY_HEADER = 'X-Key';
/** The address prefixes the Worker answers; public/_routes.json includes exactly these (a test holds them in step). */
export const WORKER_PREFIXES = ['/api/', '/mcp/', '/tiles/'];

// Every route module exports routes: [{method, pattern, handler, auth?}]; auth is 'key' (the default) or 'none'.
const MODULES = [account, projects, changes, exporting, selfcheck, bugs, tiles];

function compile(r) {
  const keys = [];
  const re = new RegExp(`^${r.pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
  return { ...r, auth: r.auth || 'key', re, keys };
}
export const ROUTES = MODULES.flatMap(m => m.routes).map(compile);

/** Every route as {method, pattern, auth, handler}, plus the connector's address (for the agent map and the tests). */
export function routeTable() {
  return ROUTES.map(r => ({ method: r.method, pattern: r.pattern, auth: r.auth, handler: r.handler }))
    .concat([{ method: 'POST', pattern: '/mcp/:token', auth: 'token', handler: handleMcp }]);
}

/** The route for a path and method: {route, match} | {pathMatched: true} (another method) | {} (no route). */
export function findRoute(path, method) {
  let pathMatched = false;
  for (const r of ROUTES) {
    const m = r.re.exec(path);
    if (!m) continue;
    pathMatched = true;
    if (r.method === method) return { route: r, match: m };
  }
  return pathMatched ? { pathMatched } : {};
}
