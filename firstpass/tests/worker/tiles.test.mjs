// Aerial tiles: the image service's address for a known tile, the 30-day cache, the zoom range, California only, First
// Pass's own page only, and plain errors. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';
import { naipUrl, tileBox, tileAt, inCalifornia, CALIFORNIA_BOX, TILES } from '../../src/worker/api/tiles.js';

// What a browser sends for an image on its own page.
const PAGE = { key: null, headers: { 'Sec-Fetch-Site': 'same-origin' } };

function fakeCache() {
  const store = new Map();
  return {
    store,
    async match(req) { const h = store.get(req.url); return h ? new Response(h.body.slice(0), { headers: h.headers }) : undefined; },
    async put(req, res) { store.set(req.url, { body: await res.arrayBuffer(), headers: [...res.headers] }); },
  };
}
function fakeFetch(answer = () => new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), { headers: { 'Content-Type': 'image/jpeg' } })) {
  const calls = [];
  const f = async (url, init) => { calls.push(url); return answer(url, init); };
  f.calls = calls;
  return f;
}

test('the Web Mercator box and the service address for a known tile', () => {
  assert.deepEqual(tileBox(0, 0, 0).map(v => Math.round(v)), [-20037508, -20037508, 20037508, 20037508]);
  assert.equal(naipUrl(16, 10605, 25142),
    'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage?bbox=-13552590.863,4662658.725,-13551979.367,4663270.222&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&f=image');
});

test('the first request goes to the service, the second is served from the cache', async () => {
  const fetch = fakeFetch();
  const cache = fakeCache();
  const t = await setup({ vars: { TILE_FETCH: fetch, TILE_CACHE: cache } });
  const a = await t.call('GET', '/tiles/naip/16/10605/25142', PAGE);
  assert.equal(a.status, 200);
  assert.equal(a.headers.get('content-type'), 'image/jpeg');
  assert.equal(a.headers.get('x-tile-cache'), 'miss');
  assert.match(a.headers.get('cache-control'), /max-age=2592000/);
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0], naipUrl(16, 10605, 25142));
  await t.settle();
  const b = await t.call('GET', '/tiles/naip/16/10605/25142.jpg', PAGE);
  assert.equal(b.status, 200);
  assert.equal(b.headers.get('x-tile-cache'), 'hit');
  assert.equal(fetch.calls.length, 1);
  assert.deepEqual([...cache.store.keys()], ['https://fp.test/tiles/naip/16/10605/25142']);
});

test('zoom 12 to 20 only, tiles inside the map, and the service\'s failures in plain words', async () => {
  let n = 0;
  const fetch = fakeFetch(() => (n++ === 0 ? new Response('<html>502 Bad Gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } })
    : new Response('{"error":{"code":400}}', { status: 200, headers: { 'Content-Type': 'application/json' } })));
  const t = await setup({ vars: { TILE_FETCH: fetch, TILE_CACHE: fakeCache() } });
  const low = await t.call('GET', '/tiles/naip/11/0/0', PAGE);
  assert.equal(low.status, 400);
  assert.match(low.json.error, /zoom 12 to 20 only/);
  assert.equal((await t.call('GET', '/tiles/naip/21/0/0', PAGE)).status, 400);
  assert.match((await t.call('GET', '/tiles/naip/12/4096/0', PAGE)).json.error, /outside the map/);
  assert.equal((await t.call('GET', '/tiles/naip/12/a/b', PAGE)).status, 400);
  const down = await t.call('GET', '/tiles/naip/16/10605/25142', PAGE);
  assert.equal(down.status, 502);
  assert.match(down.json.error, /aerial photo service did not give that tile \(the service answered 502/);
  assert.equal(down.headers.get('cache-control'), 'no-store');
  const notImage = await t.call('GET', '/tiles/naip/16/10606/25142', PAGE);
  assert.equal(notImage.status, 502);
  assert.equal(fetch.calls.length, 2, 'bad zooms never reach the service');
});

test('a tile the service cannot be reached for, and a timeout, are 502 too', async () => {
  const t = await setup({ vars: { TILE_FETCH: async () => { throw new TypeError('fetch failed'); }, TILE_CACHE: fakeCache() } });
  const r = await t.call('GET', '/tiles/naip/15/5302/12571', PAGE);
  assert.equal(r.status, 502);
  assert.match(r.json.error, /could not be reached/);
});

test('only First Pass\'s own page gets tiles: same-origin, or an Origin or Referer on this host', async () => {
  const fetch = fakeFetch();
  const t = await setup({ vars: { TILE_FETCH: fetch, TILE_CACHE: fakeCache() } });
  const path = '/tiles/naip/16/10605/25142';
  const refused = [{}, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': 'same-site' }, { 'Sec-Fetch-Site': 'none' },
    { Origin: 'https://elsewhere.test' }, { Referer: 'https://elsewhere.test/map' }, { Origin: 'null' }];
  for (const headers of refused) {
    const r = await t.call('GET', path, { key: null, headers });
    assert.equal(r.status, 403, JSON.stringify(headers));
    assert.equal(r.json.error, 'Aerial photos are served to First Pass\'s own page only.');
  }
  assert.equal(fetch.calls.length, 0, 'a refused request never reaches the service');
  for (const headers of [{ 'Sec-Fetch-Site': 'same-origin' }, { Origin: 'https://fp.test' }, { Referer: 'https://fp.test/#p=x' }]) {
    assert.equal((await t.call('GET', path, { key: null, headers })).status, 200, JSON.stringify(headers));
  }
});

test('California only, at every zoom: a tile outside its box is 404 and never asked of the service', async () => {
  const fetch = fakeFetch();
  const t = await setup({ vars: { TILE_FETCH: fetch, TILE_CACHE: fakeCache() } });
  for (let z = TILES.zMin; z <= TILES.zMax; z++) {
    for (const [lat, lon] of [[34.0522, -118.2437], [37.7749, -122.4194], [41.75, -124.2], [32.7, -114.6]]) assert.ok(inCalifornia(tileAt(z, lat, lon)), `${lat}, ${lon} at ${z}`);
    for (const [lat, lon] of [[40.7128, -74.006], [45.5, -122.6], [31.5, -116], [36.1, -113.0], [37, -126]]) assert.ok(!inCalifornia(tileAt(z, lat, lon)), `${lat}, ${lon} at ${z}`);
    // The box's own corners are in; a tile just past each edge is out.
    const nw = tileAt(z, CALIFORNIA_BOX.north, CALIFORNIA_BOX.west), se = tileAt(z, CALIFORNIA_BOX.south, CALIFORNIA_BOX.east);
    assert.ok(inCalifornia(nw) && inCalifornia(se));
    for (const out of [{ z, x: nw.x - 1, y: nw.y }, { z, x: nw.x, y: nw.y - 1 }, { z, x: se.x + 1, y: se.y }, { z, x: se.x, y: se.y + 1 }]) assert.ok(!inCalifornia(out));
  }
  const ny = tileAt(16, 40.7128, -74.006);
  const r = await t.call('GET', `/tiles/naip/16/${ny.x}/${ny.y}`, PAGE);
  assert.equal(r.status, 404);
  assert.equal(r.json.error, 'Aerial photos are served over California only.');
  const la = tileAt(18, 34.0522, -118.2437);
  assert.equal((await t.call('GET', `/tiles/naip/18/${la.x}/${la.y}`, PAGE)).status, 200);
  assert.equal(fetch.calls.length, 1);
});

test('the service is given about 20 seconds before a tile counts as not answered', async () => {
  assert.equal(TILES.timeoutMs, 20_000);
  let seen = null;
  const t = await setup({ vars: { TILE_CACHE: fakeCache(), TILE_FETCH: (url, init) => new Promise((_, reject) => {
    seen = init.signal;
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  }) } });
  const { fetchNaip } = await import('../../src/worker/api/tiles.js');
  const r = await fetchNaip(t.env, 16, 10605, 25142, 20);
  assert.ok(seen && seen.aborted);
  assert.match(r.error, /^no answer within 0 s$/);
});
