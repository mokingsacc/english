// The aerial photo under the drawing: standard Web Mercator XYZ tiles from /tiles/naip/{z}/{x}/{y} (zoom 12 to 20),
// each placed by sending its corners through crs.js fromLatLon and drawing the image with the affine transform those
// corners give (a tile is small enough that this is exact to well under a pixel). Tiles are kept in memory, fade in,
// and never hold up the drawing. crs.js (public/js/engine/crs.js) is loaded with a dynamic import; when it or the tile
// route is missing the drawing goes on without the photo and the status bar says "Photo not available".
// The tile maths is pure and tested (tests/page/underlay.test.mjs) against a fake crs.

export const ZMIN = 12, ZMAX = 20, TILE = 256;
const FT_PER_M = 3.2808333333;   // US survey foot
const MAX_TILES = 48, FADE_MS = 250, KEEP = 400;

/** Fractional tile x, y of a point at zoom z. */
export function tileXY(lat, lon, z) {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
}

/** The latitude and longitude of a tile corner (x, y whole or fractional). */
export function tileLatLon(x, y, z) {
  const n = 2 ** z;
  const lon = (x / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  return { lat, lon };
}

/** The zoom whose photo pixels are about the size of a screen pixel at k screen px per ft, at latitude lat. */
export function zoomFor(k, lat) {
  const ftPerPx0 = 156543.03392 * Math.cos((lat * Math.PI) / 180) * FT_PER_M;
  const z = Math.log2(ftPerPx0 * k);
  return Math.max(ZMIN, Math.min(ZMAX, Math.round(z + 0.25)));
}

/** The tiles that cover a world box (state plane ft), as [{ z, x, y }], at most MAX_TILES. */
export function tilesFor(box, crs, epsg, z) {
  const corners = [[box.x0, box.y0], [box.x1, box.y0], [box.x0, box.y1], [box.x1, box.y1]].map(([x, y]) => crs.toLatLon(epsg, x, y));
  const ts = corners.map((c) => tileXY(c.lat, c.lon, z));
  const x0 = Math.floor(Math.min(...ts.map((t) => t.x))), x1 = Math.floor(Math.max(...ts.map((t) => t.x)));
  const y0 = Math.floor(Math.min(...ts.map((t) => t.y))), y1 = Math.floor(Math.max(...ts.map((t) => t.y)));
  const out = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (out.length < MAX_TILES) out.push({ z, x, y });
  return out;
}

/** A tile's corners in world coordinates: { nw, ne, sw, se }. */
export function tileWorld(t, crs, epsg) {
  const at = (dx, dy) => { const g = tileLatLon(t.x + dx, t.y + dy, t.z); return crs.fromLatLon(epsg, g.lat, g.lon); };
  return { nw: at(0, 0), ne: at(1, 0), sw: at(0, 1), se: at(1, 1) };
}

/** The canvas transform [a, b, c, d, e, f] that puts a 256 px tile image on its screen corners (nw, ne, sw in px). */
export function affineFor(nw, ne, sw, size = TILE) {
  return [(ne.x - nw.x) / size, (ne.y - nw.y) / size, (sw.x - nw.x) / size, (sw.y - nw.y) / size, nw.x, nw.y];
}

export function createUnderlay({ tileUrl, epsgOf, onChange = () => {}, onStatus = () => {}, importCrs = () => import('../engine/crs.js'), makeImage = () => new Image() }) {
  let crs = null, state = 'loading', fading = false, oks = 0, errs = 0;
  const tiles = new Map();
  const status = (s, text, why) => { state = s; onStatus({ state: s, text, why }); };

  importCrs().then((m) => {
    if (!m || typeof m.fromLatLon !== 'function' || typeof m.toLatLon !== 'function') throw new Error('crs.js has no fromLatLon');
    crs = m;
    status('on', '', '');
    onChange();
  }).catch(() => status('off', 'Photo not available', 'the coordinate converter (crs.js) is not there yet'));

  function get(t) {
    const key = `${t.z}/${t.x}/${t.y}`;
    let e = tiles.get(key);
    if (e) { tiles.delete(key); tiles.set(key, e); return e; }
    e = { img: makeImage(), ok: false, err: false, t: 0 };
    e.img.decoding = 'async';
    e.img.onload = () => { e.ok = true; e.t = performance.now(); oks++; if (state !== 'on') status('on', '', ''); onChange(); };
    e.img.onerror = () => { e.err = true; errs++; if (!oks && errs >= 3) status('off', 'Photo not available', 'the photo service did not answer'); };
    e.img.src = tileUrl(t.z, t.x, t.y);
    tiles.set(key, e);
    while (tiles.size > KEEP) tiles.delete(tiles.keys().next().value);
    return e;
  }

  return {
    state: () => state,
    busy: () => fading,
    paint(ctx, cam, dpr, { on = true, lat = 38.5 } = {}) {
      fading = false;
      if (!on || !crs || state === 'off') return;
      const epsg = epsgOf();
      let list;
      try { list = tilesFor(cam.visible(), crs, epsg, zoomFor(cam.k, lat)); } catch { return; }
      const now = performance.now();
      ctx.save();
      for (const t of list) {
        const e = get(t);
        if (!e.ok) continue;
        let c;
        try { c = tileWorld(t, crs, epsg); } catch { continue; }
        const s = (p) => ({ x: cam.sx(p.x), y: cam.sy(p.y) });
        const m = affineFor(s(c.nw), s(c.ne), s(c.sw));
        const a = Math.min(1, (now - e.t) / FADE_MS);
        if (a < 1) fading = true;
        ctx.globalAlpha = 0.6 * a;
        ctx.setTransform(m[0] * dpr, m[1] * dpr, m[2] * dpr, m[3] * dpr, m[4] * dpr, m[5] * dpr);
        ctx.drawImage(e.img, 0, 0, TILE + 0.5, TILE + 0.5);
      }
      ctx.restore();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
  };
}
