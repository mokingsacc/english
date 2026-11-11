// Aerial photo tiles: standard XYZ tiles at /tiles/naip/:z/:x/:y from the USGS NAIP Plus image service (public
// domain), cut to the tile's Web Mercator box, kept in the Cache API for 30 days, zoom 12 to 20 only, and only over
// California (404 elsewhere). No key is needed, since the page draws them as images, but only First Pass's own page
// gets them: a request must come from the same site (Sec-Fetch-Site same-origin, or an Origin or Referer on this host),
// or it is refused (403), so the route cannot be used as anyone's free photo service. The fetch and the cache can be
// handed in through env (TILE_FETCH, TILE_CACHE), so tests need no network.
import { errorResponse } from '../http.js';

export const TILES = { zMin: 12, zMax: 20, maxAge: 30 * 86_400, timeoutMs: 20_000 };
/** The box tiles are served in: California with a little margin, in degrees. */
export const CALIFORNIA_BOX = { south: 32.4, north: 42.1, west: -124.6, east: -114.0 };
export const NAIP = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage';
const EDGE = 20037508.342789244;   // half the Web Mercator world, metres

/** The tile's Web Mercator box [minx, miny, maxx, maxy] in metres. */
export function tileBox(z, x, y) {
  const size = (2 * EDGE) / 2 ** z;
  const minx = -EDGE + x * size, maxy = EDGE - y * size;
  return [minx, maxy - size, minx + size, maxy];
}

/** The image service's address for one 256 px tile. */
export function naipUrl(z, x, y) {
  const bbox = tileBox(z, x, y).map(v => v.toFixed(3)).join(',');
  return `${NAIP}?bbox=${bbox}&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&f=image`;
}

/** The whole tile {z, x, y} holding a point. */
export function tileAt(z, lat, lon) {
  const n = 2 ** z, phi = (lat * Math.PI) / 180;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(phi) + 1 / Math.cos(phi)) / Math.PI) / 2) * n);
  return { z, x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}

/** Whether a tile touches California's box (CALIFORNIA_BOX) at its zoom. */
export function inCalifornia({ z, x, y }) {
  const nw = tileAt(z, CALIFORNIA_BOX.north, CALIFORNIA_BOX.west), se = tileAt(z, CALIFORNIA_BOX.south, CALIFORNIA_BOX.east);
  return x >= nw.x && x <= se.x && y >= nw.y && y <= se.y;
}

/** Whether a request comes from a page on this same site (the browser says so in Sec-Fetch-Site, Origin or Referer). */
export function sameSite(request, url) {
  const h = request.headers;
  const site = h.get('Sec-Fetch-Site');
  if (site) return site === 'same-origin';
  for (const v of [h.get('Origin'), h.get('Referer')]) {
    if (!v || v === 'null') continue;
    try { if (new URL(v).host === url.host) return true; } catch { /* not an address */ }
  }
  return false;
}

/** {z, x, y} from the route's params, or an error sentence. */
export function parseTile(params) {
  const z = Number(params.z), x = Number(params.x), y = Number(String(params.y || '').replace(/\.(jpe?g|png)$/i, ''));
  if (![z, x, y].every(Number.isInteger)) return { error: 'A tile address is /tiles/naip/<zoom>/<x>/<y>, all whole numbers.' };
  if (z < TILES.zMin || z > TILES.zMax) return { error: `Aerial photos are served for zoom ${TILES.zMin} to ${TILES.zMax} only.` };
  const n = 2 ** z;
  if (x < 0 || y < 0 || x >= n || y >= n) return { error: 'That tile is outside the map.' };
  return { z, x, y };
}

const cacheOf = env => env.TILE_CACHE || (typeof caches !== 'undefined' && caches.default) || null;
const fetchOf = env => env.TILE_FETCH || fetch;

/** The image from the service as bytes, or {error}. Never throws. */
export async function fetchNaip(env, z, x, y, timeoutMs = TILES.timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchOf(env)(naipUrl(z, x, y), { signal: ac.signal, headers: { Accept: 'image/jpeg' } });
    const type = res.headers.get('Content-Type') || '';
    if (!res.ok || !/^image\//i.test(type)) return { error: `the service answered ${res.status}${type ? ` (${type.split(';')[0]})` : ''}` };
    return { bytes: await res.arrayBuffer(), type: type.split(';')[0] };
  } catch (e) {
    return { error: e && e.name === 'AbortError' ? `no answer within ${Math.round(timeoutMs / 1000)} s` : 'it could not be reached' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A tile from the cache, or from the service and then kept (the route and Check myself both come here).
 * Returns {response, hit} or {error}. Never throws.
 */
export async function cachedTile(env, ctx, origin, t, timeoutMs = TILES.timeoutMs) {
  const cache = cacheOf(env);
  const key = new Request(`${origin}/tiles/naip/${t.z}/${t.x}/${t.y}`);
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) return { response: hit, hit: true };
    } catch { /* a cache that cannot be read is skipped */ }
  }
  const got = await fetchNaip(env, t.z, t.x, t.y, timeoutMs);
  if (got.error) return { error: got.error };
  const headers = { 'Content-Type': got.type || 'image/jpeg', 'Cache-Control': `public, max-age=${TILES.maxAge}, immutable` };
  if (cache) {
    const put = Promise.resolve().then(() => cache.put(key, new Response(got.bytes.slice(0), { headers }))).catch(() => {});
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(put); else await put;
  }
  return { response: new Response(got.bytes, { headers }), hit: false };
}

async function tile(request, env, ctx, params, url) {
  const t = parseTile(params);
  if (t.error) return errorResponse(400, t.error);
  if (!sameSite(request, url)) return errorResponse(403, 'Aerial photos are served to First Pass\'s own page only.');
  if (!inCalifornia(t)) return errorResponse(404, 'Aerial photos are served over California only.');
  const got = await cachedTile(env, ctx, url.origin, t);
  if (got.error) return errorResponse(502, `The aerial photo service did not give that tile (${got.error}). The drawing works without it; try again in a minute.`);
  const r = new Response(got.response.body, got.response);
  r.headers.set('X-Tile-Cache', got.hit ? 'hit' : 'miss');
  return r;
}

export const routes = [
  { method: 'GET', pattern: '/tiles/naip/:z/:x/:y', handler: tile, auth: 'none' },
];
