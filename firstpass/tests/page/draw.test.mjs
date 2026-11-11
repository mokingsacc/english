// The page's drawing maths: the camera (screen and world, zoom about the cursor, fit), a mouse wheel told from a
// trackpad and a pinch's rate, hit testing on true lines and arcs, selection windows (window takes what is inside,
// crossing what it touches), the speed colours, and the zoomed-out R labels agreeing with the checks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCamera, boxOf, wheelFactor, pinchFactor, MIN_K, MAX_K } from '../../public/js/draw/camera.js';
import { wheelKind } from '../../public/js/ui/viewport.js';
import { overviewArcs } from '../../public/js/draw/paint-model.js';
import { evaluate } from '../../public/js/engine/index.js';
import { sampleProject } from '../../public/js/app/sample.js';
import { distToSegment, distToArc, arcSweep, nearest, selectionWindow, windowSelect, primBox } from '../../public/js/draw/hit.js';
import { speedBucket, SPEED_BUCKETS, speedColor, DISPLAY, defaultDisplay } from '../../public/js/draw/colors.js';

const close = (a, b, tol = 1e-9, msg) => assert.ok(Math.abs(a - b) <= tol, msg || `${a} is not ${b}`);

test('the camera turns world feet into screen pixels and back, with north up', () => {
  const cam = createCamera({ cx: 1000, cy: 2000, k: 2, w: 800, h: 600 });
  const s = cam.toScreen(1010, 2005);
  assert.deepEqual(s, { x: 420, y: 290 });
  const w = cam.toWorld(s.x, s.y);
  close(w.x, 1010); close(w.y, 2005);
  assert.equal(cam.sx(1000), 400);
  assert.equal(cam.sy(2000), 300);
});

test('zooming keeps the world point under the cursor where it is', () => {
  const cam = createCamera({ cx: 6636071.5, cy: 1976790.3, k: 0.8, w: 1000, h: 700 });
  const before = cam.toWorld(123, 456);
  const v = cam.version;
  assert.ok(cam.zoomAt(123, 456, 1.25));
  const after = cam.toWorld(123, 456);
  close(after.x, before.x, 1e-6); close(after.y, before.y, 1e-6);
  assert.ok(cam.version > v);
  close(cam.k, 1.0, 1e-12);
});

test('zoom stops at its limits and a wheel notch zooms the same amount in and out', () => {
  const cam = createCamera({ k: MAX_K });
  assert.equal(cam.zoomAt(10, 10, 2), false);
  cam.k = MIN_K;
  assert.equal(cam.zoomAt(10, 10, 0.5), false);
  close(wheelFactor(-100) * wheelFactor(100), 1, 1e-12);
  assert.ok(wheelFactor(-100) > 1.2 && wheelFactor(-100) < 1.3);
  close(wheelFactor(3, 1), wheelFactor(99), 1e-12);
});

test('pan moves the drawing with the hand; fit shows the whole box', () => {
  const cam = createCamera({ cx: 0, cy: 0, k: 2, w: 400, h: 300 });
  const p = cam.toWorld(100, 100);
  cam.panBy(30, -20);
  const q = cam.toScreen(p.x, p.y);
  close(q.x, 130); close(q.y, 80);
  const box = { x0: 100, y0: 50, x1: 300, y1: 150 };
  cam.fit(box, 10);
  const vis = cam.visible();
  assert.ok(vis.x0 <= box.x0 && vis.x1 >= box.x1 && vis.y0 <= box.y0 && vis.y1 >= box.y1);
  close(cam.k, 380 / 200);
  assert.deepEqual(boxOf([{ x: 1, y: 5 }, { x: -2, y: 3 }, null], 1), { x0: -3, y0: 2, x1: 2, y1: 6 });
  assert.equal(boxOf([]), null);
});

test('save and restore give back the same view', () => {
  const cam = createCamera({ cx: 5, cy: 6, k: 3 });
  const v = cam.save();
  cam.zoomAt(0, 0, 2); cam.panBy(10, 10);
  assert.ok(cam.restore(v));
  assert.deepEqual(cam.save(), v);
  assert.equal(cam.restore({ cx: NaN, cy: 0, k: 1 }), false);
});

const line = (ax, ay, bx, by) => ({ type: 'line', a: { x: ax, y: ay }, b: { x: bx, y: by } });
// A quarter circle of radius 10 about the origin from east to north, counter-clockwise.
const quarter = { type: 'arc', a: { x: 10, y: 0 }, b: { x: 0, y: 10 }, c: { x: 0, y: 0 }, r: 10, ccw: true };

test('distances to lines and arcs are measured to the true shape', () => {
  close(distToSegment(5, 3, { x: 0, y: 0 }, { x: 10, y: 0 }), 3);
  close(distToSegment(13, 4, { x: 0, y: 0 }, { x: 10, y: 0 }), 5);
  close(arcSweep(quarter), Math.PI / 2);
  close(distToArc(Math.SQRT1_2 * 12, Math.SQRT1_2 * 12, quarter), 2, 1e-9);
  // Outside the arc's span the nearest point is an end.
  close(distToArc(10, -4, quarter), 4);
  const cw = { ...quarter, a: quarter.b, b: quarter.a, ccw: false };
  close(arcSweep(cw), Math.PI / 2);
  close(distToArc(0, -10, quarter), Math.hypot(10, 10));
});

test('nearest picks within tolerance and prefers a leg over the circle it touches', () => {
  const items = [{ prim: line(0, 0, 10, 0), key: 'leg:N', rank: 0 }, { prim: line(0, 0.3, 10, 0.3), key: 'round', rank: 1 }];
  assert.equal(nearest(items, 5, 0.2, 1).key, 'leg:N');
  assert.equal(nearest(items, 5, 5, 1), null);
  assert.equal(nearest(items, 5, 0.9, 1).key, 'round');
});

test('a window drawn left to right takes what is wholly inside; right to left, what it touches', () => {
  const items = [
    { prim: line(0, 0, 10, 0), key: 'leg:A' },
    { prim: line(20, 0, 30, 0), key: 'leg:B' },
    { prim: quarter, key: 'round' },
  ];
  const win = selectionWindow({ x: -1, y: -1 }, { x: 12, y: 12 }, 100, 300);
  assert.equal(win.crossing, false);
  assert.deepEqual(windowSelect(items, win.box, false).sort(), ['leg:A', 'round']);
  const cross = selectionWindow({ x: 25, y: -1 }, { x: 5, y: 1 }, 300, 100);
  assert.equal(cross.crossing, true);
  // The arc's east end (10, 0) is inside this crossing window too.
  assert.deepEqual(windowSelect(items, cross.box, true).sort(), ['leg:A', 'leg:B', 'round']);
  assert.deepEqual(windowSelect(items, cross.box, false), []);
  const onlyB = selectionWindow({ x: 35, y: -1 }, { x: 25, y: 1 }, 300, 100);
  assert.deepEqual(windowSelect(items, onlyB.box, true), ['leg:B']);
  const b = primBox(quarter);
  close(b.x0, 0, 1e-6); close(b.y1, 10, 1e-6);
});

test('speed colours run blue to red in buckets, and the display layers are named once', () => {
  assert.equal(speedBucket(0), 0);
  assert.equal(speedBucket(1000), SPEED_BUCKETS - 1);
  assert.ok(speedBucket(15) < speedBucket(25));
  assert.match(speedColor(20), /^(#|rgb)/);
  const keys = DISPLAY.map((d) => d.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(new Set(DISPLAY.map((d) => d.kw.toUpperCase())).size, keys.length);
  const def = defaultDisplay();
  for (const k of keys) assert.equal(typeof def[k], 'boolean');
});

test('a mouse wheel zooms and a trackpad pans, told from the events; one gesture keeps its kind', () => {
  const memo = { kind: null, at: 0 };
  assert.equal(wheelKind({ deltaMode: 0, deltaX: 0, deltaY: 100 }, memo, 0), 'zoom', 'a wheel notch in pixels');
  assert.equal(wheelKind({ deltaMode: 1, deltaX: 0, deltaY: 3 }, memo, 1000), 'zoom', 'a wheel in lines');
  assert.equal(wheelKind({ deltaMode: 0, deltaX: 0.5, deltaY: 4.25 }, memo, 2000), 'pan', 'small steps from two fingers');
  // The same flick gathering speed is still the trackpad, even when one step is large.
  assert.equal(wheelKind({ deltaMode: 0, deltaX: 0, deltaY: 140 }, memo, 2100), 'pan');
  assert.equal(wheelKind({ deltaMode: 0, deltaX: 0, deltaY: 120 }, memo, 2300), 'pan');
  // After a pause the next notch is a wheel again; a sideways step is never a wheel.
  assert.equal(wheelKind({ deltaMode: 0, deltaX: 0, deltaY: -100 }, memo, 4000), 'zoom');
  assert.equal(wheelKind({ deltaMode: 0, deltaX: 30, deltaY: 100 }, memo, 6000), 'pan');
});

test('a pinch zooms as far as the fingers spread; a wheel notch about 1.25', () => {
  close(pinchFactor(-100 * Math.log(1.1)), 1.1, 1e-9, 'spreading by a tenth zooms in by a tenth');
  close(pinchFactor(100 * Math.log(1.1)), 1 / 1.1, 1e-9);
  assert.ok(pinchFactor(3) < 1 && pinchFactor(3) > 0.95, 'one small pinch step is a small zoom');
  close(1 / wheelFactor(100), 1.25, 0.01);
});

test('zoomed out, R1 is labelled from the movement the Entry speed check reads, not the fastest left turn', () => {
  const p = sampleProject();
  const res = evaluate(p.options[0].round, p.rules);
  const arcs = overviewArcs(res);
  assert.deepEqual(arcs.map((a) => a.name), ['R1', 'R2', 'R3', 'R4', 'R5']);
  const r1 = arcs.find((a) => a.name === 'R1').a;
  const maxV1 = Math.max(...res.legs.map((L) => L.V.V1));
  close(r1.speed, maxV1, 1e-9, 'R1 on the drawing is the fastest leg\'s V1');
  const entry = res.checks.find((c) => c.id === 'entry-speed');
  const fastestV5 = Math.max(...res.legs.map((L) => L.V.V5 ?? -Infinity));
  if (maxV1 >= fastestV5) close(entry.value, r1.speed, 1e-9, 'and the Entry speed check gives the same speed');
  // The fastest R1 over every movement can be another one (a left turn's): that is not the one labelled.
  const any = Math.max(...res.movements.filter((m) => m.ok && m.arcs.R1).map((m) => m.arcs.R1.speed));
  assert.ok(any >= r1.speed);
  for (const { name, a } of arcs) {
    const [which, vk] = { R1: ['main', 'V1'], R2: ['main', 'V2'], R3: ['main', 'V3'], R4: ['left', 'V4'], R5: ['right', 'V5'] }[name];
    const L = res.legs.find((l) => res.movements.find((m) => m.id === l[which] && m.arcs[name] === a));
    assert.ok(L, `${name} comes from a leg's ${which} movement`);
    close(a.speed, Math.max(...res.legs.map((l) => l.V[vk] ?? -Infinity)), 1e-9, `${name} is the highest ${vk}`);
  }
});
