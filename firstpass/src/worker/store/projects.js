// Projects in D1, always scoped to their owner: create (the only write outside the change log, since a new project has
// no history), load, list, and the sample project on a real California site.
import { HttpError, newId, isObj } from '../http.js';
import { defaultRoundabout } from '../engine.js';
import { canonicalDoc, cleanRound, OpError, LIMITS } from './ops.js';
import { placeSite, OpRefused, CA_ZONES } from '../../../public/js/app/ops.js';

export const DEFAULT_EPSG = 2226;   // CCS83 zone 2, US survey feet (docs/design.md, Data model)
export const PROJECTS_MAX = 500;
export const DOC_MAX = 400_000;     // characters of project JSON

// The sample site: a rural four-way crossing of two paved two-lane county roads in Yolo County, between Davis and
// Woodland, open fields on three corners and a house on the fourth. The centre is the middle of the crossing as the USGS
// NAIP photo shows it (each road's centre line fitted from its pavement edges, 25 to 140 m out on both sides, 11 Nov
// 2026); the bearings are those roads' directions on the zone 2 grid. Easting and northing are fromLatLon(2226, site) in
// public/js/engine/crs.js (CCS83 zone 2, US survey feet), to 0.01 ft; tests/page/sample-site.test.mjs holds them to it.
// Keep public/js/app/sample.js the same.
export const SAMPLE = {
  name: 'Sample roundabout', epsg: 2226, site: { lat: 38.618855, lon: -121.729697 }, center: { x: 6638894.89, y: 1987310.58 },
  bearings: { N: 0.7, E: 90.6, S: 180.7, W: 270.6 },
};

/** The project as the API and the connector hand it out: {id, name, epsg, site, rules, options, seq, updated_at?}. */
export function projectOut(row, doc = parseDoc(row)) {
  return { id: row.id, ...doc, seq: row.seq, ...(row.updated_at != null ? { updated_at: new Date(row.updated_at).toISOString() } : {}) };
}

export function parseDoc(row) {
  try { return JSON.parse(row.doc); } catch { throw new Error(`project ${row.id} holds JSON that cannot be read`); }
}

/** One project row of this user's, or null. */
export async function loadRow(db, userId, projectId) {
  if (typeof projectId !== 'string' || !projectId || projectId.length > 64) return null;
  return db.prepare('SELECT id, user_id, doc, seq, created_at, updated_at FROM projects WHERE id = ?1 AND user_id = ?2').bind(projectId, userId).first();
}

/** The row, or 404 in plain words (another user's project is "not there" too, never "not yours"). */
export async function needRow(db, userId, projectId) {
  const row = await loadRow(db, userId, projectId);
  if (!row) throw new HttpError(404, 'There is no project with that id.');
  return row;
}

/** This user's projects, newest change first: [{id, name, seq, updated_at, options: [{id, name}]}]. */
export async function listProjects(db, userId) {
  const rows = (await db.prepare('SELECT id, doc, seq, updated_at FROM projects WHERE user_id = ?1 ORDER BY updated_at DESC LIMIT ?2').bind(userId, PROJECTS_MAX).all()).results || [];
  return rows.map(r => {
    let doc = { name: '(unreadable)', options: [] };
    try { doc = JSON.parse(r.doc); } catch { /* listed by name only */ }
    return { id: r.id, name: doc.name, seq: r.seq, updated_at: new Date(r.updated_at).toISOString(), options: (doc.options || []).map(o => ({ id: o.id, name: o.name })) };
  });
}

/** The newest-changed project of this user's, or null (the connector's default when no project is named). */
export async function latestRow(db, userId) {
  return db.prepare('SELECT id, user_id, doc, seq, created_at, updated_at FROM projects WHERE user_id = ?1 ORDER BY updated_at DESC LIMIT 1').bind(userId).first();
}

/**
 * The document of a new project from a request body {name?, epsg?, site?, round?, sample?}. Throws OpError.
 * A site without a round places the sample (or the default roundabout) there, in the site's zone (or epsg's), as the
 * set_site op does; a site with a round keeps the round's centre as given.
 */
export function newDoc(body = {}) {
  const sample = body.sample === true;
  let name = body.name ?? (sample ? SAMPLE.name : 'Untitled project');
  if (typeof name !== 'string' || !name.trim() || name.trim().length > LIMITS.nameMax) throw new OpError(`A project name is 1 to ${LIMITS.nameMax} characters.`);
  name = name.trim().replace(/\s+/g, ' ');
  const zoneOk = v => Number.isInteger(v) && CA_ZONES.includes(v);
  if (body.epsg != null && !zoneOk(body.epsg)) throw new OpError('epsg is a California state plane zone in US survey feet, 2225 to 2230 (zones 1 to 6), such as 2226 for zone 2.');
  const place = body.site == null ? null : isObj(body.site) ? body.site : { lat: NaN, lon: NaN };
  const placed = place ? placed0(place, body.epsg) : null;
  const epsg = placed ? placed.epsg : body.epsg ?? (sample ? SAMPLE.epsg : DEFAULT_EPSG);
  const site = placed ? placed.site : sample ? { ...SAMPLE.site } : null;
  let round;
  if (body.round != null) round = cleanRound(body.round, 'That roundabout');
  else {
    round = cleanRound(defaultRoundabout());
    if (sample) {
      round.center = { ...SAMPLE.center };
      for (const leg of round.legs) if (SAMPLE.bearings[leg.id] !== undefined) leg.bearing = SAMPLE.bearings[leg.id];
    }
  }
  if (placed && body.round == null) round.center = { ...placed.center };
  return canonicalDoc({ name, epsg, site, rules: {}, options: [{ id: 'A', name: 'Option A', kind: 'roundabout', round }] });
}

/** A site checked and placed as set_site places it: {site, epsg, center}. Throws OpError in plain words. */
function placed0(place, epsg) {
  const probe = { options: [{ id: 'A', round: { center: { x: 0, y: 0 } } }] };
  try {
    const p = placeSite(probe, { lat: place.lat, lon: place.lon, epsg: epsg ?? null });
    return { site: p.site, epsg: p.epsg, center: p.centers.A };
  } catch (e) {
    if (e instanceof OpRefused) throw new OpError(e.message);
    throw e;
  }
}

/** Creates a project for this user. Returns its row. */
export async function createProject(db, userId, body = {}, now = Date.now()) {
  let doc;
  try { doc = newDoc(body); } catch (e) { if (e instanceof OpError) throw new HttpError(400, e.message); throw e; }
  const n = await db.prepare('SELECT count(*) AS n FROM projects WHERE user_id = ?1').bind(userId).first('n');
  if (Number(n) >= PROJECTS_MAX) throw new HttpError(400, `You have ${PROJECTS_MAX} projects, the most one person can keep.`);
  const id = newId('p_');
  const text = JSON.stringify(doc);
  await db.prepare('INSERT INTO projects (id, user_id, doc, seq, created_at, updated_at) VALUES (?1, ?2, ?3, 0, ?4, ?4)').bind(id, userId, text, now).run();
  return { id, user_id: userId, doc: text, seq: 0, created_at: now, updated_at: now };
}
