// Aerial photo tiles: standard XYZ tiles at /tiles/naip/:z/:x/:y from the USGS NAIP Plus image service (public
// domain), cut to the tile's Web Mercator box, kept in the Cache API for 30 days, zoom 12 to 20 only. No key needed:
// the page draws them as images. The fetch and the cache can be handed in through env (TILE_FETCH, TILE_CACHE), so
// tests need no network.
import { errorResponse } from '../http.js';

export const TILES = { zMin: 12, zMax: 20, maxAge: 30 * 86_400, timeoutMs: 8000 };
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

async function tile(request, env, ctx, params, url) {
  const t = parseTile(params);
  if (t.error) return errorResponse(400, t.error);
  const cache = cacheOf(env);
  const key = new Request(`${url.origin}/tiles/naip/${t.z}/${t.x}/${t.y}`);
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) { const r = new Response(hit.body, hit); r.headers.set('X-Tile-Cache', 'hit'); return r; }
    } catch { /* a cache that cannot be read is skipped */ }
  }
  const got = await fetchNaip(env, t.z, t.x, t.y);
  if (got.error) return errorResponse(502, `The aerial photo service did not give that tile (${got.error}). The drawing works without it; try again in a minute.`);
  const headers = { 'Content-Type': got.type || 'image/jpeg', 'Cache-Control': `public, max-age=${TILES.maxAge}, immutable` };
  if (cache) {
    const put = Promise.resolve().then(() => cache.put(key, new Response(got.bytes.slice(0), { headers }))).catch(() => {});
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(put); else await put;
  }
  return new Response(got.bytes, { headers: { ...headers, 'X-Tile-Cache': 'miss' } });
}

export const routes = [
  { method: 'GET', pattern: '/tiles/naip/:z/:x/:y', handler: tile, auth: 'none' },
];
