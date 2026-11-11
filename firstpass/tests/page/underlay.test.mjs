// The aerial photo underlay's tile maths against a fake coordinate converter: tile numbers and corners, the zoom for a
// scale, which tiles cover a view, the affine transform that puts a tile on its corners, and the quiet fallback line
// "Photo not available" when crs.js is missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tileXY, tileLatLon, zoomFor, tilesFor, tileWorld, affineFor, createUnderlay, ZMIN, ZMAX, TILE } from '../../public/js/draw/underlay.js';
import { createCamera } from '../../public/js/draw/camera.js';

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, msg || `${a} is not within ${tol} of ${b}`);

// A fake state plane: an equirectangular projection in feet about the sample site, good enough to test the plumbing.
const LAT0 = 38.58999, LON0 = -121.73968, X0 = 6636071.5, Y0 = 1976790.3;
const FT_PER_DEG = 364000;
const fakeCrs = {
  toLatLon: (epsg, x, y) => ({ lat: LAT0 + (y - Y0) / FT_PER_DEG, lon: LON0 + (x - X0) / (FT_PER_DEG * Math.cos((LAT0 * Math.PI) / 180)) }),
  fromLatLon: (epsg, lat, lon) => ({ x: X0 + (lon - LON0) * FT_PER_DEG * Math.cos((LAT0 * Math.PI) / 180), y: Y0 + (lat - LAT0) * FT_PER_DEG }),
};

test('tile numbers and tile corners are inverses (Web Mercator)', () => {
  for (const z of [12, 16, 20]) {
    const t = tileXY(LAT0, LON0, z);
    const g = tileLatLon(t.x, t.y, z);
    close(g.lat, LAT0, 1e-9); close(g.lon, LON0, 1e-9);
  }
  // Zoom 0 is one tile; the equator and the date line sit at its middle and edge.
  const c = tileXY(0, 0, 0);
  close(c.x, 0.5, 1e-12); close(c.y, 0.5, 1e-12);
});

test('the zoom follows the scale and stays from 12 to 20', () => {
  const zs = [0.01, 0.1, 0.5, 1, 2, 5, 50].map((k) => zoomFor(k, LAT0));
  for (let i = 1; i < zs.length; i++) assert.ok(zs[i] >= zs[i - 1]);
  assert.equal(zoomFor(1e-6, LAT0), ZMIN);
  assert.equal(zoomFor(1e6, LAT0), ZMAX);
  // About one photo pixel to a screen pixel: at zoom z a pixel is 156543 cos(lat) / 2^z metres.
  const z = zoomFor(1, LAT0);
  const ftPerPhotoPx = (156543.03392 * Math.cos((LAT0 * Math.PI) / 180) * 3.2808333333) / 2 ** z;
  assert.ok(ftPerPhotoPx > 0.35 && ftPerPhotoPx < 1.5, String(ftPerPhotoPx));
});

test('the tiles for a view cover it, and there are never too many', () => {
  const box = { x0: X0 - 300, y0: Y0 - 200, x1: X0 + 300, y1: Y0 + 200 };
  const z = 17;
  const list = tilesFor(box, fakeCrs, 2226, z);
  assert.ok(list.length >= 1 && list.length <= 48);
  for (const t of list) assert.equal(t.z, z);
  // The view's middle falls in one of them.
  const mid = tileXY(LAT0, LON0, z);
  assert.ok(list.some((t) => t.x === Math.floor(mid.x) && t.y === Math.floor(mid.y)));
  const huge = tilesFor({ x0: X0 - 1e5, y0: Y0 - 1e5, x1: X0 + 1e5, y1: Y0 + 1e5 }, fakeCrs, 2226, 20);
  assert.equal(huge.length, 48);
});

test('a tile is drawn by the transform that puts its corners where the converter says', () => {
  const t = { z: 18, x: Math.floor(tileXY(LAT0, LON0, 18).x), y: Math.floor(tileXY(LAT0, LON0, 18).y) };
  const w = tileWorld(t, fakeCrs, 2226);
  assert.ok(w.ne.x > w.nw.x && w.sw.y < w.nw.y);
  const cam = createCamera({ cx: X0, cy: Y0, k: 2, w: 800, h: 600 });
  const s = (p) => ({ x: cam.sx(p.x), y: cam.sy(p.y) });
  const [a, b, c, d, e, f] = affineFor(s(w.nw), s(w.ne), s(w.sw));
  const apply = (u, v) => ({ x: a * u + c * v + e, y: b * u + d * v + f });
  for (const [u, v, corner] of [[0, 0, 'nw'], [TILE, 0, 'ne'], [0, TILE, 'sw']]) {
    const got = apply(u, v), want = s(w[corner]);
    close(got.x, want.x, 1e-6); close(got.y, want.y, 1e-6);
  }
  // The fourth corner is within a pixel too (a tile is small enough for an affine fit).
  const se = apply(TILE, TILE), want = s(w.se);
  close(se.x, want.x, 1); close(se.y, want.y, 1);
});

test('with no coordinate converter the photo is quietly off and says so once', async () => {
  const seen = [];
  const u = createUnderlay({ tileUrl: () => '', epsgOf: () => 2226, onStatus: (s) => seen.push(s), importCrs: () => Promise.reject(new Error('404')) });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(u.state(), 'off');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].text, 'Photo not available');
  // Painting then does nothing and never throws.
  const calls = [];
  u.paint({ save: () => calls.push('save') }, createCamera(), 1);
  assert.deepEqual(calls, []);
});

test('with a converter, loaded tiles are drawn with their transform and fade in', async () => {
  const images = [];
  const makeImage = () => { const img = { set src(v) { this._src = v; images.push(this); } }; return img; };
  let changed = 0;
  const u = createUnderlay({ tileUrl: (z, x, y) => `/tiles/naip/${z}/${x}/${y}`, epsgOf: () => 2226, onChange: () => changed++, importCrs: async () => fakeCrs, makeImage });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(u.state(), 'on');
  const cam = createCamera({ cx: X0, cy: Y0, k: 1, w: 600, h: 400 });
  const log = [];
  const ctx = { save() {}, restore() {}, setTransform: (...m) => log.push(['t', ...m]), drawImage: (img) => log.push(['img', img._src]), set globalAlpha(v) { log.push(['alpha', v]); } };
  u.paint(ctx, cam, 2, { lat: LAT0 });
  assert.ok(images.length > 0);
  assert.ok(images.every((i) => /^\/tiles\/naip\/\d+\/\d+\/\d+$/.test(i._src)));
  assert.equal(log.filter((l) => l[0] === 'img').length, 0, 'nothing drawn before a tile loads');
  images[0].onload();
  assert.ok(changed >= 2);
  log.length = 0;
  u.paint(ctx, cam, 2, { lat: LAT0 });
  assert.equal(log.filter((l) => l[0] === 'img').length, 1);
  assert.equal(u.busy(), true, 'a tile that just arrived is still fading in');
  u.paint(ctx, cam, 2, { on: false });
  assert.equal(u.busy(), false);
});
