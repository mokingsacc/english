// The drawing's input in a real browser: two fingers pinch-zoom and pan and never select, a finger taps a leg, a
// cancelled touch puts a grip back; a trackpad's two-finger scroll pans and its pinch zooms gently, Settings' Scrolling
// choice turns the wheel to panning; Space with a left drag pans without running a command; and a curb radius grip sits
// at the curve's start, shows the radius as built, and stores the built value on release.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, openPage, playwright, settle, pointOn, gripAt, history, state, canvasBox, until } from './helpers.mjs';

const pw = playwright();
const skip = pw.chromium ? false : `Playwright is not installed here (${pw.why})`;
let server, browser;

before(async () => {
  if (skip) return;
  server = await startServer();
  browser = await pw.chromium.launch();
});
after(async () => {
  if (browser) await browser.close();
  if (server) await server.close();
});

async function fresh(opts = {}) {
  const project = await server.newProject();
  const p = await openPage(server, project, { browser, ...opts });
  return { ...p, project };
}
const serverProject = async (id) => (await server.api('GET', `/api/projects/${id}`)).project;
const camera = (page) => page.evaluate(() => ({ k: window.fpPage.camera.k, x: window.fpPage.camera.toWorld(0, 0).x, y: window.fpPage.camera.toWorld(0, 0).y }));
const worldAt = (page, box, p) => page.evaluate(([x, y]) => window.fpPage.camera.toWorld(x, y), [p.x - box.x, p.y - box.y]);
const near = (a, b, tol) => Math.hypot(a.x - b.x, a.y - b.y) < tol;

/** Fingers through the browser's touch input: each step is a list of {x, y} (page px), one per finger. */
async function fingers(page, steps, { cancel = false } = {}) {
  const cdp = await page.context().newCDPSession(page);
  const pts = (list) => list.map((p, id) => ({ x: p.x, y: p.y, id }));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(steps[0]) });
  for (const s of steps.slice(1)) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(s) });
    await settle(page);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
  await settle(page);
  await cdp.detach();
}

test('two fingers pinch-zoom and pan about their middle and never select; one finger taps a leg', { skip }, async () => {
  const { page, close, errors } = await fresh({ touch: true });
  try {
    const box = await canvasBox(page);
    const m = { x: Math.round(box.x + box.width * 0.45), y: Math.round(box.y + box.height * 0.5) };
    const k0 = (await camera(page)).k;
    const w0 = await worldAt(page, box, m);
    // Apart from 80 px to 200 px, and the middle moves 30 px right.
    const steps = [];
    for (let i = 0; i <= 12; i++) {
      const half = 40 + i * 5, dx = Math.round(i * 2.5);
      steps.push([{ x: m.x - half + dx, y: m.y }, { x: m.x + half + dx, y: m.y }]);
    }
    await fingers(page, steps);
    const k1 = (await camera(page)).k;
    assert.ok(k1 > k0 * 2.2 && k1 < k0 * 2.8, `zoomed by the fingers' spread: ${k0} to ${k1}`);
    const w1 = await worldAt(page, box, { x: m.x + 30, y: m.y });
    assert.ok(near(w0, w1, 2 / k1), 'the point between the fingers stays under them as they move');
    const st = await state(page);
    assert.deepEqual(st.selection, [], 'a pinch selects nothing');
    assert.equal(st.draft, false);
    // Then one finger: a tap on a leg's curb, where it is on screen now, selects the leg.
    const p = await page.evaluate(() => {
      const f = window.fpPage.info(), c = window.fpPage.camera;
      for (const it of f.index.items) {
        if (it.key !== 'leg:E' || it.prim.type !== 'line') continue;
        const x = c.sx((it.prim.a.x + it.prim.b.x) / 2), y = c.sy((it.prim.a.y + it.prim.b.y) / 2);
        if (x > 30 && y > 30 && x < c.w - 30 && y < c.h - 30) return { x, y };
      }
      return null;
    });
    assert.ok(p, 'the East leg is on screen');
    await page.touchscreen.tap(Math.round(box.x + p.x), Math.round(box.y + p.y));
    await settle(page);
    assert.deepEqual((await state(page)).selection, ['leg:E']);
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('a cancelled touch on a grip puts the drawing back and saves nothing', { skip }, async () => {
  const { page, close, project } = await fresh({ touch: true });
  try {
    const p = await pointOn(page, 'leg:N');
    await page.touchscreen.tap(Math.round(p.x), Math.round(p.y));
    await settle(page);
    const g = await gripAt(page, 'splitter-tip');
    assert.ok(g, 'the selected leg shows its grips');
    const seq0 = (await serverProject(project.id)).seq;
    const before = JSON.stringify((await state(page)).project.options[0].round);
    const steps = [];
    for (let i = 0; i <= 8; i++) steps.push([{ x: Math.round(g.x), y: Math.round(g.y - i * 6) }]);
    await fingers(page, steps, { cancel: true });
    const st = await state(page);
    assert.equal(st.draft, false, 'no drag is left open');
    assert.equal(JSON.stringify(st.project.options[0].round), before, 'the drawing is as it was');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await serverProject(project.id)).seq, seq0, 'nothing was sent');
  } finally { await close(); }
});

test('a trackpad: two-finger scroll pans, a pinch zooms gently, and Settings can make the wheel pan', { skip }, async () => {
  const { page, close } = await fresh();
  try {
    const box = await canvasBox(page);
    const at = { x: Math.round(box.x + box.width * 0.4), y: Math.round(box.y + box.height * 0.55) };
    await page.mouse.move(at.x, at.y);
    // Two fingers: small pixel steps with a sideways part.
    const k0 = (await camera(page)).k;
    const w0 = await worldAt(page, box, at);
    await page.mouse.wheel(24, 16);
    await settle(page);
    assert.equal((await camera(page)).k, k0, 'a two-finger scroll does not zoom');
    assert.ok(near(await worldAt(page, box, { x: at.x - 24, y: at.y - 16 }), w0, 0.01), 'the drawing moved with the fingers');
    await page.waitForTimeout(300);   // a new gesture
    // A pinch: the wheel with Ctrl and a small step, zooming about the pointer by a little.
    const w1 = await worldAt(page, box, at);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -10);
    await page.keyboard.up('Control');
    await settle(page);
    const k1 = (await camera(page)).k;
    assert.ok(k1 > k0 * 1.05 && k1 < k0 * 1.2, `a small pinch zooms a little: ${k0} to ${k1}`);
    assert.ok(near(await worldAt(page, box, at), w1, 0.01), 'about the pointer');
    await page.waitForTimeout(300);
    // Settings, Scrolling on the drawing: Pan. A wheel notch now pans.
    await page.locator('#toolspace .pal-vtab[data-tab="settings"]').click();
    await page.locator('select[data-pref="scroll"]').selectOption('pan');
    await page.mouse.move(at.x, at.y);
    const k2 = (await camera(page)).k;
    await page.mouse.wheel(0, 120);
    await settle(page);
    assert.equal((await camera(page)).k, k2, 'the wheel pans when Settings says Pan');
    assert.match((await history(page, 1))[0], /^Scrolling on the drawing: Pan\.$/);
  } finally { await close(); }
});

test('Space with a left drag pans, selects nothing and runs no command', { skip }, async () => {
  const { page, close } = await fresh();
  try {
    const box = await canvasBox(page);
    const a = { x: Math.round(box.x + box.width * 0.3), y: Math.round(box.y + box.height * 0.4) };
    await page.mouse.move(a.x, a.y);
    const w0 = await worldAt(page, box, a);
    const lines0 = (await history(page, 400)).length;
    await page.keyboard.down('Space');
    await page.mouse.down();
    await page.mouse.move(a.x + 60, a.y + 40, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    await settle(page);
    assert.ok(near(await worldAt(page, box, { x: a.x + 60, y: a.y + 40 }), w0, 0.01), 'the drawing moved with the hand');
    assert.deepEqual((await state(page)).selection, []);
    assert.equal(await page.locator('.cl-input').inputValue(), '', 'the space did not go into the command line');
    assert.equal((await history(page, 400)).length, lines0, 'no command ran');
  } finally { await close(); }
});

test('a curb radius grip sits at the curve\'s start, shows the radius as built, and stores the built value on release', { skip }, async () => {
  const { page, close, project } = await fresh();
  try {
    const p = await pointOn(page, 'leg:N');
    await page.mouse.click(p.x, p.y);
    await settle(page);
    const g = await gripAt(page, 'entry-radius:N:0');
    assert.ok(g, 'the selected leg shows its entry curve grip');
    const at = await page.evaluate(() => {
      const f = window.fpPage.info(), c = window.fpPage.camera;
      const L = f.shown.geometry.legs.find((l) => l.id === 'N');
      return { x: c.sx(L.T1.x), y: c.sy(L.T1.y) };
    });
    const box = await canvasBox(page);
    assert.ok(Math.hypot(g.x - box.x - at.x, g.y - box.y - at.y) < 0.5, 'the grip is at the start of the entry curve');
    // Far out, a little at a time, until the corner has no more room and the box says both numbers.
    const c = await pointOn(page, 'round');
    const d = Math.hypot(g.x - c.x, g.y - c.y), ux = (g.x - c.x) / d, uy = (g.y - c.y) / d;
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    let note = '';
    for (let i = 1; i <= 120 && !note; i++) {
      await page.mouse.move(Math.round(g.x + ux * 5 * i), Math.round(g.y + uy * 5 * i));
      if (i % 4 === 0) {
        await until(page, async () => page.evaluate(() => window.fpPage.info().fresh), 'the worker answered', 3000);
        await settle(page);
        if (await page.locator('.dyn-note').isVisible()) note = await page.locator('.dyn-note').textContent();
      }
    }
    assert.match(note, /^asked (\d+\.\d\d) ft, built (\d+\.\d\d) ft$/, 'the box names the radius asked for and the one built');
    const [, asked, built] = note.match(/^asked (\S+) ft, built (\S+) ft$/);
    assert.ok(Number(asked) > Number(built));
    assert.equal(await page.locator('.dyn-in').first().inputValue(), built, 'the box shows the built value');
    await page.mouse.up();
    await settle(page);
    const stored = (await state(page)).project.options[0].round.legs.find((l) => l.id === 'N').entryRadius;
    const shown = await page.evaluate(() => window.fpPage.info().shown.geometry.legs.find((l) => l.id === 'N').entryRadiusBuilt);
    assert.ok(Math.abs(stored - shown) < 0.011, `stored ${stored}, built ${shown}`);
    assert.ok(Math.abs(stored - Number(asked)) > 1, 'not the value asked for');
    // The next leg's curve in that corner was shrunk with it: it is stored as built too, and the command line says so.
    const legs = (await state(page)).project.options[0].round.legs;
    const radii = await page.evaluate(() => window.fpPage.info().shown.geometry.legs.map((l) => ({ id: l.id, e: l.entryRadiusBuilt, x: l.exitRadiusBuilt })));
    for (const b of radii) {
      const L = legs.find((l) => l.id === b.id);
      assert.ok(Math.abs(L.entryRadius - b.e) < 0.011 && Math.abs(L.exitRadius - b.x) < 0.011, `${b.id}: stored ${L.entryRadius} and ${L.exitRadius}, built ${b.e} and ${b.x}`);
    }
    assert.ok((await history(page, 4)).some((l) => /^The \w+ leg's exit curb radius is now built at \d+\.\d\d ft, down from \d+\.\d\d ft\.$/.test(l)), (await history(page, 4)).join(' | '));
    await until(page, async () => (await serverProject(project.id)).options[0].round.legs.find((l) => l.id === 'N').entryRadius === stored, 'the server has the built value');
  } finally { await close(); }
});
