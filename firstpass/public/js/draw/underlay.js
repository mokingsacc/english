// The aerial photo under the drawing: standard Web Mercator XYZ tiles from /tiles/naip/{z}/{x}/{y} (zoom 10 to 18),
// each placed by sending its corners through crs.js fromLatLon and drawing the image with the affine transform those
// corners give (a tile is small enough that this is exact to well under a pixel). Each tile is drawn exactly on its
// square, and its last row and column are stretched a little under the next tile so no seam shows (stretching the whole
// tile instead would move the picture by up to half a photo pixel). Tiles are kept in memory, fade in, are dimmed by
// one veil of the background colour, and never hold up the drawing. While a tile is missing (still loading, or the
// photo service was slow) the part of a coarser tile already in memory is drawn in its place, and a tile that failed is
// asked for again after 2, 6 and 20 s (the service sometimes takes over 8 s to answer). crs.js is loaded with a dynamic
// import; when it is missing, or no tile has come at all, the drawing goes on without the photo and the status bar says
// "Photo not available". The tile maths is pure and tested (tests/page/underlay.test.mjs) against a fake crs; the
// placement was measured in Chromium against the service's own picture to 0.05 screen pixel (CONTRACT.md, the photo).
// The project's zone is read on every paint (epsgOf), since her site can move to another zone while the page is open;
// each tile's corners are kept for the zone they were worked out in, and all of them are dropped when the zone changes.
// The layers keep the photo in a bitmap of its own (draw/layers.js), so a grip drag does not draw the tiles again.
// Speed (11 Nov 2026, Mo: "the map takes so long to load", "the map only loads the top bit"): zoom 18 is the finest
// asked for, since the photo's own pixels are about 0.6 m and finer tiles only enlarge them (four to sixteen times the
// tiles for nothing). Under finer tiles the zoom 16 tiles of the same view are always asked for first: the server takes
// those from a ready-made tile service that answers in well under a second, so the whole view has a photo at once and
// sharpens as the slower zoom 17 and 18 tiles come. Tiles are asked for from the middle of the view outwards, and a view
// that would need more than MAX_TILES at its zoom takes a coarser zoom instead of leaving rows out; a view wider than
// zoom 10 shows no photo and the status bar says to zoom in.

import { MODEL_BG } from './colors.js';

export const ZMIN = 10, ZMAX = 18, TILE = 256;
export const COVER_Z = 16;   // the ready-made service's finest zoom: asked for first under finer tiles
const FT_PER_M = 3.2808333333;   // US survey foot
export const MAX_TILES = 80;
const  FADE_MS = 250, KEEP = 400, ALPHA = 0.6;   // ALPHA: how strongly the photo shows
export const RETRY_MS = [2000, 6000, 20000];   // waits before asking again for a tile that failed
const UP = 4;                                  // how many zoom levels up a stand-in tile may come from
const SEAM = 0.75;                             // tile pixels a tile's last row and column reach under the next one

/** A tile's picture (the square sx, sy, sw of img) exactly on the tile's square 0 to TILE, then its last column, row and
 * corner pixel stretched SEAM outwards. Tiles are drawn west to east and north to south, so the next tile's
 * anti-aliased edge has this picture under it, not the background. */
export function drawSquare(ctx, img, sx, sy, sw) {
  const px = sw / TILE, e = sx + sw - px, f = sy + sw - px;
  ctx.drawImage(img, sx, sy, sw, sw, 0, 0, TILE, TILE);
  ctx.drawImage(img, e, sy, px, sw, TILE, 0, SEAM, TILE);
  ctx.drawImage(img, sx, f, sw, px, 0, TILE, TILE, SEAM);
  ctx.drawImage(img, e, f, px, px, TILE, TILE, SEAM, SEAM);
}

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

/** The range of tiles at zoom z that covers a world box (state plane ft): { x0, x1, y0, y1, count }. */
export function tileRange(box, crs, epsg, z) {
  const corners = [[box.x0, box.y0], [box.x1, box.y0], [box.x0, box.y1], [box.x1, box.y1]].map(([x, y]) => crs.toLatLon(epsg, x, y));
  const ts = corners.map((c) => tileXY(c.lat, c.lon, z));
  const x0 = Math.floor(Math.min(...ts.map((t) => t.x))), x1 = Math.floor(Math.max(...ts.map((t) => t.x)));
  const y0 = Math.floor(Math.min(...ts.map((t) => t.y))), y1 = Math.floor(Math.max(...ts.map((t) => t.y)));
  return { x0, x1, y0, y1, count: (x1 - x0 + 1) * (y1 - y0 + 1) };
}

/** The tiles that cover a world box (state plane ft), as [{ z, x, y }], the middle of the view first, at most MAX_TILES
 * (only a view too wide for its zoom has more, and fitZoom picks a coarser zoom for that). */
export function tilesFor(box, crs, epsg, z) {
  const r = tileRange(box, crs, epsg, z);
  const mx = (r.x0 + r.x1) / 2, my = (r.y0 + r.y1) / 2;
  const out = [];
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) out.push({ z, x, y });
  out.sort((a, b) => ((a.x - mx) ** 2 + (a.y - my) ** 2) - ((b.x - mx) ** 2 + (b.y - my) ** 2));
  return out.slice(0, MAX_TILES);
}

/** The zoom to ask for: z, or coarser until the view needs at most MAX_TILES; null when even ZMIN needs more. */
export function fitZoom(box, crs, epsg, z) {
  for (let zz = Math.min(z, ZMAX); zz >= ZMIN; zz--) if (tileRange(box, crs, epsg, zz).count <= MAX_TILES) return zz;
  return null;
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

/** The tile `up` zoom levels above t and the part of it (in its pixels) that covers t: { key, sx, sy, size }. */
export function ancestorOf(t, up) {
  const f = 2 ** up, size = TILE / f;
  return { key: `${t.z - up}/${Math.floor(t.x / f)}/${Math.floor(t.y / f)}`, sx: (t.x - Math.floor(t.x / f) * f) * size, sy: (t.y - Math.floor(t.y / f) * f) * size, size };
}

export function createUnderlay({ tileUrl, epsgOf, onChange = () => {}, onStatus = () => {}, importCrs = () => import('../engine/crs.js'), makeImage = () => new Image(),
  now = () => performance.now(), later = (fn, ms) => setTimeout(fn, ms) }) {
  let crs = null, state = 'loading', fading = false, oks = 0, errs = 0;
  const tiles = new Map();
  const placed = new Map();   // tile key to its corners in world feet, for the zone placedIn
  let placedIn = null;
  const status = (s, text, why) => { state = s; onStatus({ state: s, text, why }); };

  importCrs().then((m) => {
    if (!m || typeof m.fromLatLon !== 'function' || typeof m.toLatLon !== 'function') throw new Error('crs.js has no fromLatLon');
    crs = m;
    status('on', '', '');
    onChange();
  }).catch(() => status('off', 'Photo not available', 'the map coordinate converter did not load'));

  function load(t, e) {
    const img = makeImage();
    e.img = img; e.ok = false; e.err = false;
    img.decoding = 'async';
    img.onload = () => { if (e.img !== img) return; e.ok = true; e.t = now(); oks++; if (state !== 'on') status('on', '', ''); onChange(); };
    img.onerror = () => {
      if (e.img !== img) return;
      e.err = true; errs++;
      if (!oks && errs >= 3 && state !== 'off') status('off', 'Photo not available', 'the photo service did not answer');
      if (e.tries < RETRY_MS.length) { const wait = RETRY_MS[e.tries++]; e.retryAt = now() + wait; later(onChange, wait); }
    };
    img.src = tileUrl(t.z, t.x, t.y);
  }

  function get(t) {
    const key = `${t.z}/${t.x}/${t.y}`;
    let e = tiles.get(key);
    if (e) {
      tiles.delete(key); tiles.set(key, e);
      if (e.err && e.retryAt && now() >= e.retryAt) { e.retryAt = 0; load(t, e); }
      return e;
    }
    e = { img: null, ok: false, err: false, t: 0, tries: 0, retryAt: 0 };
    tiles.set(key, e);
    load(t, e);
    while (tiles.size > KEEP) tiles.delete(tiles.keys().next().value);
    return e;
  }

  /** A coarser tile already in memory that covers t, with the part of it to draw, or null. */
  function standIn(t) {
    for (let up = 1; up <= UP && t.z - up >= ZMIN; up++) {
      const a = ancestorOf(t, up), e = tiles.get(a.key);
      if (e && e.ok) return { ...a, img: e.img };
    }
    return null;
  }

  /** A tile's corners in the zone epsg, worked out once for that zone (all are dropped when the zone changes). */
  function cornersOf(t, epsg) {
    if (placedIn !== epsg) { placed.clear(); placedIn = epsg; }
    const key = `${t.z}/${t.x}/${t.y}`;
    let c = placed.get(key);
    if (!c) {
      c = tileWorld(t, crs, epsg);
      placed.set(key, c);
      while (placed.size > KEEP) placed.delete(placed.keys().next().value);
    }
    return c;
  }

  return {
    state: () => state,
    busy: () => fading,
    /** The zone the kept tile corners belong to (null before any paint). */
    zone: () => placedIn,
    paint(ctx, cam, dpr, { on = true, lat = 38.5, veil = MODEL_BG } = {}) {
      fading = false;
      if (!on || !crs) return;
      const epsg = epsgOf();
      let list, cover = [];
      try {
        const box = cam.visible();
        const z = fitZoom(box, crs, epsg, zoomFor(cam.k, lat));
        if (z === null) { if (state !== 'far') status('far', 'Zoom in to see the photo', 'the view is wider than the photo is served for'); return; }
        if (state === 'far') status('on', '', '');
        list = tilesFor(box, crs, epsg, z);
        if (z > COVER_Z) cover = tilesFor(box, crs, epsg, COVER_Z);
      } catch { return; }
      // The quick zoom 16 tiles are asked for before the finer ones, so they arrive first and stand in under them.
      for (const t of cover) get(t);
      const t0 = now();
      const s = (p) => ({ x: cam.sx(p.x), y: cam.sy(p.y) });
      const place = (t) => { const c = cornersOf(t, epsg); const m = affineFor(s(c.nw), s(c.ne), s(c.sw)); ctx.setTransform(m[0] * dpr, m[1] * dpr, m[2] * dpr, m[3] * dpr, m[4] * dpr, m[5] * dpr); };
      // Tiles are drawn at full strength (where one reaches under the next nothing shows twice), and one veil of the
      // background colour over them all dims the photo to ALPHA so the drawing stays easy to read.
      let drew = 0;
      ctx.save();
      for (const t of list) {
        const e = get(t);
        const a = e.ok ? Math.min(1, (t0 - e.t) / FADE_MS) : 0;
        try {
          if (a < 1) {
            // Not here yet, or fading in: the part of a coarser tile already in memory stands in under it.
            const st = standIn(t);
            if (st) { ctx.globalAlpha = 1; place(t); drawSquare(ctx, st.img, st.sx, st.sy, st.size); drew++; }
          }
          if (!e.ok) continue;
          if (a < 1) fading = true;
          ctx.globalAlpha = a;
          place(t);
          drawSquare(ctx, e.img, 0, 0, TILE);
          drew++;
        } catch { /* a tile that cannot be placed is left out */ }
      }
      if (drew) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalAlpha = 1 - ALPHA;
        ctx.fillStyle = veil;
        ctx.fillRect(0, 0, cam.w, cam.h);
      }
      ctx.restore();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
  };
}
