// GET /api/selfcheck: the server checks itself and answers in plain words, one line each: the database answers, a user
// exists, the engine works out the default roundabout, the aerial photo service answers, the connector link is set up.
//   -> {ok, lines: [{id, ok, text}]}   each text is either what is fine or what is wrong and what to do
import { json } from '../http.js';
import { evaluate, defaultRoundabout, CHECKS } from '../engine.js';
import { fetchNaip } from './tiles.js';

// A tile over the sample site (zoom 16), for the photo service line.
export const PROBE_TILE = { z: 16, x: 10605, y: 25142 };
const shortErr = e => String((e && e.message) || e || 'unknown').replace(/^D1_ERROR:\s*/, '').split('\n')[0].slice(0, 120);

async function database(env, user) {
  try {
    const n = await env.DB.prepare('SELECT count(*) AS n FROM projects WHERE user_id = ?1').bind(user.id).first('n');
    return { id: 'database', ok: true, text: `The database answers. You have ${n} project${Number(n) === 1 ? '' : 's'}.` };
  } catch (e) {
    return { id: 'database', ok: false, text: `The database did not answer (${shortErr(e)}). Check the DB binding in wrangler.toml and apply the migrations (CLAUDE.md, Commands).` };
  }
}

async function users(env) {
  try {
    const n = Number(await env.DB.prepare('SELECT count(*) AS n FROM users').first('n'));
    return n > 0 ? { id: 'users', ok: true, text: `${n} ${n === 1 ? 'person has' : 'people have'} a key, and yours works.` }
      : { id: 'users', ok: false, text: 'No one has a key yet. Make one with node scripts/add-user.mjs and run the SQL it prints.' };
  } catch (e) {
    return { id: 'users', ok: false, text: `The list of users could not be read (${shortErr(e)}). Apply the migrations (CLAUDE.md, Commands).` };
  }
}

/** The engine on the default roundabout: it must build, run every check, and break none. */
export function engineLine() {
  try {
    const t0 = Date.now();
    const r = evaluate(defaultRoundabout(), {});
    const ms = Date.now() - t0;
    const broken = (r.checks || []).filter(c => c.internalError);
    if (!r.ok) return { id: 'engine', ok: false, text: `The maths engine could not build the default roundabout: ${r.problems[0] || 'no reason given'} Run npm test to find the failing engine test, and report it.` };
    if (r.internalError || broken.length || (r.checks || []).length !== CHECKS.length) {
      return { id: 'engine', ok: false, text: `The maths engine broke on the default roundabout${broken.length ? ` in the ${broken[0].title.toLowerCase()} check` : ''}. Run npm test to find the failing engine test, and report it.` };
    }
    // (Workers hold the clock still while code runs, so the time can read 0 there; it is left out then.)
    return { id: 'engine', ok: true, text: `The maths engine works out the default roundabout: ${r.checks.length} checks${ms > 0 ? ` in ${ms} ms` : ''}.` };
  } catch (e) {
    return { id: 'engine', ok: false, text: `The maths engine could not be run (${shortErr(e)}). Run npm test, and report it.` };
  }
}

async function photos(env) {
  const t0 = Date.now();
  const got = await fetchNaip(env, PROBE_TILE.z, PROBE_TILE.x, PROBE_TILE.y, 6000);
  if (got.error) return { id: 'tiles', ok: false, text: `The aerial photo service did not answer (${got.error}). The drawing works without photos; try again later.` };
  return { id: 'tiles', ok: true, text: `The aerial photo service answers (USGS NAIP, ${((Date.now() - t0) / 1000).toFixed(1)} s).` };
}

function connector(user) {
  return user.connector ? { id: 'connector', ok: true, text: 'Your Claude connector link is set up.' }
    : { id: 'connector', ok: false, text: 'You have no Claude connector link. Ask for one (scripts/add-user.mjs makes a key and a link together), then add it in Claude under Settings, Connectors.' };
}

async function selfcheck(request, env, ctx, params, url, user) {
  const lines = await Promise.all([database(env, user), users(env), Promise.resolve(engineLine()), photos(env), Promise.resolve(connector(user))]);
  return json({ ok: lines.every(l => l.ok), lines });
}

export const routes = [
  { method: 'GET', pattern: '/api/selfcheck', handler: selfcheck },
];
