// GET /api/selfcheck: the server checks itself and answers in her words, one line each: the database answers, people
// have keys, the engine works out the default roundabout, aerial photos load, her connector link is set up.
//   -> {ok, lines: [{id, ok, text}]}   each text says what is fine, or what is wrong and who can put it right
// A line that fails keeps its raw error in the request's trace (kept because it failed), never in the words she reads.
import { json } from '../http.js';
import { evaluate, defaultRoundabout, CHECKS } from '../engine.js';
import { cachedTile, tileAt } from './tiles.js';
import { SAMPLE } from '../store/projects.js';
import { noteTrace } from '../debug/trace.js';

// The photo tile over the sample site (zoom 16), fetched through the tile cache like any tile the page draws.
export const PROBE_TILE = tileAt(16, SAMPLE.site.lat, SAMPLE.site.lon);
export const PROBE_TIMEOUT_MS = 6000;
const OWNER = 'Tell the person who runs First Pass.';
const failed = (e, where) => noteTrace(t => t.fail(Object.assign(new Error(`${where}: ${(e && e.message) || e}`), { stack: e && e.stack })));

async function database(env, user) {
  try {
    const n = await env.DB.prepare('SELECT count(*) AS n FROM projects WHERE user_id = ?1').bind(user.id).first('n');
    return { id: 'database', ok: true, text: `The database answers. You have ${n} project${Number(n) === 1 ? '' : 's'}.` };
  } catch (e) {
    failed(e, 'selfcheck database');
    return { id: 'database', ok: false, text: `The database is not set up. ${OWNER}` };
  }
}

async function users(env) {
  try {
    const n = Number(await env.DB.prepare('SELECT count(*) AS n FROM users').first('n'));
    return n > 0 ? { id: 'users', ok: true, text: `${n} ${n === 1 ? 'person has' : 'people have'} a key, and yours works.` }
      : { id: 'users', ok: false, text: `No one has a key yet. ${OWNER}` };
  } catch (e) {
    failed(e, 'selfcheck users');
    return { id: 'users', ok: false, text: `The list of people with keys could not be read. ${OWNER}` };
  }
}

/** The engine on the default roundabout: it must build, run every check, and break none. */
export function engineLine() {
  const broke = `The maths engine could not work out the default roundabout. Use Report a problem so it can be fixed.`;
  try {
    const t0 = Date.now();
    const r = evaluate(defaultRoundabout(), {});
    const ms = Date.now() - t0;
    const broken = (r.checks || []).filter(c => c.internalError);
    if (!r.ok) { failed(new Error(r.problems[0] || 'no reason given'), 'selfcheck engine'); return { id: 'engine', ok: false, text: broke }; }
    if (r.internalError || broken.length || (r.checks || []).length !== CHECKS.length) {
      failed(new Error(broken.length ? `the ${broken[0].id} check broke` : 'checks missing'), 'selfcheck engine');
      return { id: 'engine', ok: false, text: broke };
    }
    // (Workers hold the clock still while code runs, so the time can read 0 there; it is left out then.)
    return { id: 'engine', ok: true, text: `The maths engine works out the default roundabout: ${r.checks.length} checks${ms > 0 ? ` in ${ms} ms` : ''}.` };
  } catch (e) {
    failed(e, 'selfcheck engine');
    return { id: 'engine', ok: false, text: broke };
  }
}

async function photos(env, ctx, origin) {
  const got = await cachedTile(env, ctx, origin, PROBE_TILE, PROBE_TIMEOUT_MS);
  if (got.error) {
    failed(new Error(got.error), 'selfcheck photo tile');
    return { id: 'tiles', ok: false, text: 'The aerial photo service did not answer just now. The drawing works without photos; try again later.' };
  }
  return { id: 'tiles', ok: true, text: 'Aerial photos load (USGS NAIP).' };
}

function connector(user) {
  return user.connector ? { id: 'connector', ok: true, text: 'Your Claude connector link is set up.' }
    : { id: 'connector', ok: false, text: 'You have no Claude connector link yet. Ask the person who runs First Pass for one, then add it in Claude under Settings, Connectors.' };
}

async function selfcheck(request, env, ctx, params, url, user) {
  const lines = await Promise.all([database(env, user), users(env), Promise.resolve(engineLine()), photos(env, ctx, url.origin), Promise.resolve(connector(user))]);
  return json({ ok: lines.every(l => l.ok), lines });
}

export const routes = [
  { method: 'GET', pattern: '/api/selfcheck', handler: selfcheck },
];
