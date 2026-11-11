// Aerial tiles: the image service's address for a known tile, the 30-day cache, the zoom range and plain errors. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.mjs';
import { naipUrl, tileBox } from '../../src/worker/api/tiles.js';

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
  const a = await t.call('GET', '/tiles/naip/16/10605/25142', { key: null });
  assert.equal(a.status, 200);
  assert.equal(a.headers.get('content-type'), 'image/jpeg');
  assert.equal(a.headers.get('x-tile-cache'), 'miss');
  assert.match(a.headers.get('cache-control'), /max-age=2592000/);
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0], naipUrl(16, 10605, 25142));
  await t.settle();
  const b = await t.call('GET', '/tiles/naip/16/10605/25142.jpg', { key: null });
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
  const low = await t.call('GET', '/tiles/naip/11/0/0', { key: null });
  assert.equal(low.status, 400);
  assert.match(low.json.error, /zoom 12 to 20 only/);
  assert.equal((await t.call('GET', '/tiles/naip/21/0/0', { key: null })).status, 400);
  assert.match((await t.call('GET', '/tiles/naip/12/4096/0', { key: null })).json.error, /outside the map/);
  assert.equal((await t.call('GET', '/tiles/naip/12/a/b', { key: null })).status, 400);
  const down = await t.call('GET', '/tiles/naip/16/10605/25142', { key: null });
  assert.equal(down.status, 502);
  assert.match(down.json.error, /aerial photo service did not give that tile \(the service answered 502/);
  assert.equal(down.headers.get('cache-control'), 'no-store');
  const notImage = await t.call('GET', '/tiles/naip/16/10606/25142', { key: null });
  assert.equal(notImage.status, 502);
  assert.equal(fetch.calls.length, 2, 'bad zooms never reach the service');
});

test('a tile the service cannot be reached for, and a timeout, are 502 too', async () => {
  const t = await setup({ vars: { TILE_FETCH: async () => { throw new TypeError('fetch failed'); }, TILE_CACHE: fakeCache() } });
  const r = await t.call('GET', '/tiles/naip/15/5302/12571', { key: null });
  assert.equal(r.status, 502);
  assert.match(r.json.error, /could not be reached/);
});
