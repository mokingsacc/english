// The set_site op through the API and the connector: the drawing placed at a place in California, in that place's state
// plane zone (Los Angeles is zone 5, San Francisco zone 3), every option moved by one shift, bearings kept, undone
// exactly; places outside California and zones that are not California's refused in plain words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';
import { fromLatLon, zoneFor } from '../../public/js/engine/crs.js';

const LA = { lat: 34.0522, lon: -118.2437 };
const SF = { lat: 37.7749, lon: -122.4194 };
const docOf = (t, id) => t.row('SELECT doc FROM projects WHERE id = ?', id).doc;
const near = (a, b, tol = 0.006) => Math.abs(a - b) <= tol;

test('Los Angeles: zone 5, the option on screen lands on the site, the others keep their places, bearings stay', async () => {
  const t = await setup();
  const p = await t.newProject();
  const a0 = p.options[0].round;
  await t.call('POST', `/api/projects/${p.id}/changes`, { body: { ops: [{ op: 'add_option', from: 'A' }, { op: 'set', option: 'B', path: 'center.x', value: a0.center.x + 250 }, { op: 'set', option: 'B', path: 'center.y', value: a0.center.y - 40 }] } });
  const before = docOf(t, p.id);
  const r = await t.call('POST', `/api/projects/${p.id}/changes`, { body: { ops: [{ op: 'set_site', ...LA, option: 'B' }] } });
  assert.equal(r.status, 200, r.text);
  const q = r.json.project;
  assert.equal(zoneFor(LA.lat, LA.lon), 2229);
  assert.equal(q.epsg, 2229);
  assert.deepEqual(q.site, LA);
  const want = fromLatLon(2229, LA.lat, LA.lon);
  const [A, B] = q.options.map(o => o.round);
  assert.ok(near(B.center.x, want.x) && near(B.center.y, want.y), 'option B is on the site');
  assert.ok(near(B.center.x - A.center.x, 250, 0.011) && near(B.center.y - A.center.y, -40, 0.011), 'the options keep their places to one another');
  assert.deepEqual(A.legs.map(l => l.bearing), a0.legs.map(l => l.bearing));
  assert.equal(r.json.change.summary, 'Placed the drawing at 34.0522, -118.2437 in California zone 5 (EPSG 2229), was zone 2');
  // Undo puts back the very same text.
  const u = await t.call('POST', `/api/projects/${p.id}/undo`, { body: {} });
  assert.equal(u.status, 200);
  assert.equal(docOf(t, p.id), before);
  assert.equal(u.json.project.epsg, 2226);
});

test('a zone change from Los Angeles to San Francisco (zone 5 to zone 3), undone step by step', async () => {
  const t = await setup();
  const p = await t.newProject();
  const start = docOf(t, p.id);
  await t.call('POST', `/api/projects/${p.id}/changes`, { body: { ops: [{ op: 'set_site', ...LA }] } });
  const atLa = docOf(t, p.id);
  const r = await t.call('POST', `/api/projects/${p.id}/changes`, { body: { ops: [{ op: 'set_site', ...SF }] } });
  assert.equal(zoneFor(SF.lat, SF.lon), 2227);
  assert.equal(r.json.project.epsg, 2227);
  const want = fromLatLon(2227, SF.lat, SF.lon);
  assert.ok(near(r.json.project.options[0].round.center.x, want.x) && near(r.json.project.options[0].round.center.y, want.y));
  assert.match(r.json.change.summary, /in California zone 3 \(EPSG 2227\), was zone 5$/);
  await t.call('POST', `/api/projects/${p.id}/undo`, { body: {} });
  assert.equal(docOf(t, p.id), atLa);
  await t.call('POST', `/api/projects/${p.id}/undo`, { body: {} });
  assert.equal(docOf(t, p.id), start);
  // The same site again changes nothing.
  const same = await t.call('POST', `/api/projects/${p.id}/changes`, { body: { ops: [{ op: 'set_site', lat: 38.618855, lon: -121.729697 }] } });
  assert.equal(same.json.nothing, true);
  // A zone named by hand wins over the county's.
  const forced = await t.call('POST', `/api/projects/${p.id}/changes`, { body: { ops: [{ op: 'set_site', ...SF, epsg: 2226 }] } });
  assert.equal(forced.json.project.epsg, 2226);
});

test('outside California, a zone that is not California\'s, swapped numbers, no such option: refused in plain words', async () => {
  const t = await setup();
  const p = await t.newProject();
  const send = op => t.call('POST', `/api/projects/${p.id}/changes`, { body: { ops: [{ op: 'set_site', ...op }] } });
  const vegas = await send({ lat: 36.1699, lon: -115.1398 });
  assert.equal(vegas.status, 400);
  assert.equal(vegas.json.error, '36.1699, -115.1398 is outside California. First Pass draws on California\'s state plane grid, so give a place in California, such as 34.0522, -118.2437.');
  for (const place of [{ lat: 39.5296, lon: -119.8138 }, { lat: 32.5149, lon: -117.0382 }, { lat: 45.5, lon: -122.6 }, { lat: 40.7128, lon: -74.006 }]) {
    assert.match((await send(place)).json.error, /is outside California/);
  }
  assert.match((await send({ ...LA, epsg: 4326 })).json.error, /EPSG 2225 to 2230/);
  assert.match((await send({ lat: -118.2437, lon: 34.0522 })).json.error, /Give the latitude first, then the longitude/);
  assert.match((await send({ lat: '34', lon: -118 })).json.error, /^Give the site as a latitude and a longitude in degrees/);
  assert.equal((await send({ ...LA, option: 'Q' })).json.error, 'There is no option Q in this project.');
  assert.equal((await t.call('GET', `/api/projects/${p.id}`)).json.project.seq, 0);
});

test('an undo of a site change after an option was added since is refused, so the options are never split up', async () => {
  const t = await setup();
  const p = await t.newProject();
  await t.call('POST', `/api/projects/${p.id}/changes`, { body: { ops: [{ op: 'set_site', ...LA }] } });
  await t.call('POST', `/api/projects/${p.id}/changes`, { body: { ops: [{ op: 'add_option', from: 'A' }] } });
  const u = await t.call('POST', `/api/projects/${p.id}/undo`, { body: { seq: 1 } });
  assert.equal(u.status, 409);
  assert.match(u.json.error, /changed again since/);
});

test('a new project can start at her site; the connector\'s set_site places it and can be undone', async () => {
  const t = await setup();
  const made = await t.call('POST', '/api/projects', { body: { sample: true, name: 'Downtown LA', site: LA } });
  assert.equal(made.status, 201, made.text);
  assert.equal(made.json.project.epsg, 2229);
  const c = made.json.project.options[0].round.center, want = fromLatLon(2229, LA.lat, LA.lon);
  assert.ok(near(c.x, want.x) && near(c.y, want.y));
  assert.match((await t.call('POST', '/api/projects', { body: { sample: true, site: { lat: 36.1699, lon: -115.1398 } } })).json.error, /outside California/);
  assert.equal((await t.call('POST', '/api/projects', { body: { epsg: 4326 } })).status, 400);

  const r = await t.tool('set_site', { project: made.json.project.id, ...SF, reason: 'Her site in San Francisco' });
  assert.equal(r.isError, false, r.summary);
  assert.equal(r.summary, 'Placed the drawing at 37.7749, -122.4194 in California zone 3 (EPSG 2227); its coordinates were in zone 5. Say "undo" to put it back.');
  assert.equal(r.data.epsg, 2227);
  const hist = (await t.call('GET', `/api/projects/${made.json.project.id}`)).json.history;
  assert.deepEqual(hist.map(h => [h.actor, h.summary]), [['claude', 'Her site in San Francisco']]);
  const out = await t.tool('set_site', { project: made.json.project.id, lat: 36.1699, lon: -115.1398, reason: 'x' });
  assert.equal(out.isError, true);
  assert.match(out.summary, /outside California/);
  const u = await t.tool('undo', {});
  assert.equal(u.isError, false);
  assert.equal((await t.call('GET', `/api/projects/${made.json.project.id}`)).json.project.epsg, 2229);
});
