// The aerial photo underlay's tile maths against a fake coordinate converter: tile numbers and corners, the zoom for a
// scale, which tiles cover a view, the affine transform that puts a tile on its corners, the quiet fallback line
// "Photo not available" when crs.js is missing, a tile drawn exactly on its square with its edges under the next one, a
// failed tile asked for again, and a coarser tile standing in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tileXY, tileLatLon, zoomFor, tilesFor, tileWorld, affineFor, createUnderlay, ancestorOf, drawSquare, RETRY_MS, ZMIN, ZMAX, TILE } from '../../public/js/draw/underlay.js';
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
  const ctx = { save() {}, restore() {}, setTransform: (...m) => log.push(['t', ...m]), drawImage: (img, ...r) => { if (r[6] === TILE && r[7] === TILE) log.push(['img', img._src]); }, set globalAlpha(v) { log.push(['alpha', v]); }, fillRect: (...r) => log.push(['veil', ...r]) };
  u.paint(ctx, cam, 2, { lat: LAT0 });
  assert.ok(images.length > 0);
  assert.ok(images.every((i) => /^\/tiles\/naip\/\d+\/\d+\/\d+$/.test(i._src)));
  assert.equal(log.filter((l) => l[0] === 'img').length, 0, 'nothing drawn before a tile loads');
  assert.equal(log.filter((l) => l[0] === 'veil').length, 0, 'and no veil');
  images[0].onload();
  assert.ok(changed >= 2);
  log.length = 0;
  u.paint(ctx, cam, 2, { lat: LAT0 });
  assert.equal(log.filter((l) => l[0] === 'img').length, 1);
  // The tile itself is drawn at full strength; one veil of the background over everything dims it.
  const veil = log.findIndex((l) => l[0] === 'veil');
  assert.ok(veil > log.findIndex((l) => l[0] === 'img'));
  assert.deepEqual(log[veil].slice(1), [0, 0, 600, 400]);
  assert.equal(log.slice(0, veil).filter((l) => l[0] === 'alpha').at(-1)[1], 1 - 0.6);
  assert.equal(u.busy(), true, 'a tile that just arrived is still fading in');
  u.paint(ctx, cam, 2, { on: false });
  assert.equal(u.busy(), false);
});

test('the zone is read on every paint, and tile corners worked out for another zone are not used again', async () => {
  // A converter whose state plane shifts with the zone, so a tile placed in zone 2 lands elsewhere in zone 3.
  const zoned = {
    toLatLon: (epsg, x, y) => fakeCrs.toLatLon(epsg, x - (epsg - 2226) * 1000, y),
    fromLatLon: (epsg, lat, lon) => { const p = fakeCrs.fromLatLon(epsg, lat, lon); return { x: p.x + (epsg - 2226) * 1000, y: p.y }; },
  };
  let epsg = 2226;
  const images = [];
  const makeImage = () => { const img = { set src(v) { this._src = v; images.push(this); } }; return img; };
  const u = createUnderlay({ tileUrl: (z, x, y) => `${z}/${x}/${y}`, epsgOf: () => epsg, importCrs: async () => zoned, makeImage, now: () => 1e9 });
  await new Promise((r) => setTimeout(r, 0));
  const transforms = [];
  const ctx = { save() {}, restore() {}, setTransform: (...m) => transforms.push(m), drawImage() {}, set globalAlpha(v) { void v; }, fillRect() {} };
  const at = (x0) => createCamera({ cx: x0, cy: Y0, k: 1, w: 300, h: 200 });
  u.paint(ctx, at(X0), 1, { lat: LAT0 });
  for (const img of images) img.onload();
  transforms.length = 0;
  u.paint(ctx, at(X0), 1, { lat: LAT0 });
  assert.equal(u.zone(), 2226);
  const inZone2 = transforms.find((m) => m.length === 6 && m[0] !== 1);
  // Her site moves to zone 3: the same place on the ground is 1000 ft further east there, and so is the tile.
  epsg = 2227;
  transforms.length = 0;
  u.paint(ctx, at(X0 + 1000), 1, { lat: LAT0 });
  assert.equal(u.zone(), 2227, 'the new zone is read');
  const inZone3 = transforms.find((m) => m.length === 6 && m[0] !== 1);
  assert.ok(inZone2 && inZone3);
  close(inZone3[4], inZone2[4], 1e-6, 'the tile sits on the same screen spot, placed in the new zone');
  close(inZone3[5], inZone2[5], 1e-6);
});

// A fake clock and timers, images that load or fail when told, and a canvas that logs what is drawn.
function rig() {
  let t = 1000;
  const timers = [], images = [];
  const makeImage = () => { const img = { set src(v) { this._src = v; images.push(this); } }; return img; };
  const seen = [];
  let changed = 0;
  const u = createUnderlay({ tileUrl: (z, x, y) => `${z}/${x}/${y}`, epsgOf: () => 2226, onChange: () => changed++, onStatus: (s) => seen.push(s), importCrs: async () => fakeCrs,
    makeImage, now: () => t, later: (fn, ms) => timers.push({ fn, at: t + ms }) });
  const log = [];
  // drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh): the tile's own square is logged as [src, sx, sy, sw]; the thin
  // edge strips under the next tile are left out.
  const ctx = { save() {}, restore() {}, setTransform() {}, drawImage: (img, ...r) => { if (r[6] === TILE && r[7] === TILE) log.push([img._src, r[0], r[1], r[2]]); }, set globalAlpha(v) { log.push(['alpha', v]); }, fillRect: () => log.push(['veil']) };
  return { u, images, timers, seen, log, ctx, tick: (ms) => { t += ms; for (const x of timers.splice(0)) if (x.at <= t) x.fn(); else timers.push(x); }, changed: () => changed };
}

test('a tile the service did not give is asked for again after 2, 6 and 20 s, then left', async () => {
  const r = rig();
  await new Promise((ok) => setTimeout(ok, 0));
  const cam = createCamera({ cx: X0, cy: Y0, k: 2, w: 200, h: 200 });
  r.u.paint(r.ctx, cam, 1, { lat: LAT0 });
  const first = r.images[0]._src;
  const asks = () => r.images.filter((i) => i._src === first);
  for (let n = 0; n < RETRY_MS.length; n++) {
    asks().at(-1).onerror();
    assert.equal(r.timers.length >= 1, true, 'a repaint is asked for when the wait is over');
    r.u.paint(r.ctx, cam, 1, { lat: LAT0 });
    assert.equal(asks().length, n + 1, 'not asked again before the wait');
    r.tick(RETRY_MS[n]);
    r.u.paint(r.ctx, cam, 1, { lat: LAT0 });
    assert.equal(asks().length, n + 2, `asked again after ${RETRY_MS[n]} ms`);
  }
  asks().at(-1).onerror();
  r.tick(60000);
  r.u.paint(r.ctx, cam, 1, { lat: LAT0 });
  assert.equal(asks().length, RETRY_MS.length + 1, 'three tries after the first, no more');
});

test('the photo comes back on when a tile arrives after the service failed', async () => {
  const r = rig();
  await new Promise((ok) => setTimeout(ok, 0));
  const cam = createCamera({ cx: X0, cy: Y0, k: 2, w: 600, h: 400 });
  r.u.paint(r.ctx, cam, 1, { lat: LAT0 });
  assert.ok(r.images.length >= 3);
  for (const i of r.images.slice(0, 3)) i.onerror();
  assert.equal(r.u.state(), 'off');
  assert.equal(r.seen.at(-1).text, 'Photo not available');
  r.tick(RETRY_MS[0]);
  r.u.paint(r.ctx, cam, 1, { lat: LAT0 });
  r.images.at(-1).onload();
  assert.equal(r.u.state(), 'on');
});

test('the part of a coarser tile in memory stands in for a tile still loading', async () => {
  // ancestorOf: the tile two levels up and the quarter-sized square inside it.
  assert.deepEqual(ancestorOf({ z: 18, x: 4 * 100 + 3, y: 4 * 200 + 1 }, 2), { key: '16/100/200', sx: 3 * 64, sy: 1 * 64, size: 64 });
  assert.deepEqual(ancestorOf({ z: 18, x: 801, y: 400 }, 1), { key: '17/400/200', sx: 128, sy: 0, size: 128 });
  const r = rig();
  await new Promise((ok) => setTimeout(ok, 0));
  const coarse = createCamera({ cx: X0, cy: Y0, k: 0.5, w: 100, h: 100 });
  r.u.paint(r.ctx, coarse, 1, { lat: LAT0 });
  for (const i of r.images) i.onload();
  r.tick(1000);
  const zc = zoomFor(0.5, LAT0);
  const fine = createCamera({ cx: X0, cy: Y0, k: 4, w: 100, h: 100 });
  const zf = zoomFor(4, LAT0);
  assert.ok(zf - zc >= 1 && zf - zc <= 4, `${zc} to ${zf}`);
  r.log.length = 0;
  r.u.paint(r.ctx, fine, 1, { lat: LAT0 });
  const drawn = r.log.filter((l) => l[0] !== 'alpha' && l[0] !== 'veil');
  assert.ok(drawn.length >= 1, 'something is drawn before the fine tiles come');
  for (const d of drawn) {
    assert.equal(Number(d[0].split('/')[0]), zc, 'from the coarse tiles');
    assert.equal(d[3], TILE / 2 ** (zf - zc), 'a part of the image');
  }
  assert.equal(r.log.at(-1)[0], 'veil', 'dimmed like any tile');
  // A fine tile that just arrived fades in over its stand-in.
  for (const i of r.images.filter((i) => i._src.startsWith(`${zf}/`))) i.onload();
  r.log.length = 0;
  r.u.paint(r.ctx, fine, 1, { lat: LAT0 });
  const both = r.log.filter((l) => l[0] !== 'alpha' && l[0] !== 'veil');
  assert.ok(both.some((d) => d[0].startsWith(`${zc}/`)) && both.some((d) => d[0].startsWith(`${zf}/`) && d[3] === TILE));
  assert.equal(r.u.busy(), true);
  // Once faded in, only the fine tiles are drawn.
  r.tick(1000);
  r.log.length = 0;
  r.u.paint(r.ctx, fine, 1, { lat: LAT0 });
  const after = r.log.filter((l) => l[0] !== 'alpha' && l[0] !== 'veil');
  assert.ok(after.length >= 1 && after.every((d) => d[0].startsWith(`${zf}/`) && d.slice(1).join() === `0,0,${TILE}`));
  assert.equal(r.u.busy(), false);
});

test('a tile is drawn exactly on its square, its last column and row reaching under the next tile', () => {
  const calls = [];
  drawSquare({ drawImage: (img, ...r) => calls.push(r) }, {}, 0, 0, TILE);
  assert.deepEqual(calls[0], [0, 0, TILE, TILE, 0, 0, TILE, TILE], 'the picture itself is not stretched');
  assert.deepEqual(calls[1].slice(0, 6), [TILE - 1, 0, 1, TILE, TILE, 0]);
  assert.deepEqual(calls[2].slice(0, 7), [0, TILE - 1, TILE, 1, 0, TILE, TILE]);
  assert.deepEqual(calls[3].slice(0, 6), [TILE - 1, TILE - 1, 1, 1, TILE, TILE]);
  for (const c of calls.slice(1)) assert.ok(Math.min(c[6], c[7]) > 0 && Math.min(c[6], c[7]) < 1, 'less than a pixel');
  // A stand-in's quarter: the same, in its own pixels.
  calls.length = 0;
  drawSquare({ drawImage: (img, ...r) => calls.push(r) }, {}, 64, 128, 64);
  assert.deepEqual(calls[0], [64, 128, 64, 64, 0, 0, TILE, TILE]);
  assert.deepEqual(calls[1].slice(0, 6), [64 + 64 - 0.25, 128, 0.25, 64, TILE, 0]);
});
