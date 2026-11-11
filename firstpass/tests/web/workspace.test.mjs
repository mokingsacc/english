// The workspace in a real browser against the real routes: it opens clean, a short window folds the ribbon and a narrow
// one keeps Check myself on screen, typing goes to the command line without a click (ICD 110, then U), the wheel zooms about the cursor, Esc clears, pulling an entry curve grip out works out the
// checks live until Entry speed fails and commits one change on release, turning a leg shows the corner warning under
// its check and on the tree, OPTION and COMPARE, Properties editing, window and crossing selection, a change made
// through the connector arriving in the history, a sign-in page answering a save and a poll, EXPORT's plain answer,
// and the frame budget while dragging.
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
const icdOf = (st) => st.project.options.find((o) => o.id === st.optionId).round.icd;

test('the page opens with the drawing, every part in place, and no errors', { skip }, async () => {
  const { page, errors, close, project } = await fresh();
  try {
    for (const sel of ['.titlebar .appbtn', '.ribbon .rb-tab.active', '#toolspace .tree .tr', '#properties .pr-head', '.doctabs .dt-tab.active', '#canvas', '.panorama .ck-row', '.cmdline .cl-input', '.statusbar .sb-coords']) {
      assert.ok(await page.locator(sel).first().isVisible(), `${sel} is visible`);
    }
    assert.equal(await page.title(), `First Pass - ${project.name}`);
    const st = await state(page);
    assert.equal(st.net.state, 'saved');
    const info = await page.evaluate(() => ({ ok: !!window.fpPage.info().shown, hash: location.hash }));
    assert.ok(info.ok, 'a shape is drawn');
    assert.doesNotMatch(info.hash, /k=/, 'the key is not left in the address');
    assert.match(info.hash, new RegExp(`p=${project.id}`));
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('a short window folds the ribbon to its tabs and keeps the drawing large; a narrow one keeps Check myself on screen', { skip }, async () => {
  const short = await fresh({ width: 1280, height: 633 });
  try {
    const { page } = short;
    assert.match(await page.locator('#ribbon').getAttribute('class'), /\bfolded\b/);
    const h0 = await page.evaluate(() => window.fpPage.camera.h);
    assert.ok(h0 > 300, `the drawing is ${h0} px high`);
    const fits = await page.evaluate(() => {
      const c = window.fpPage.camera, G = window.fpPage.info().shown.geometry, R = G.radii.inscribed;
      return [c.sx(G.center.x - R), c.sy(G.center.y + R), c.sx(G.center.x + R), c.sy(G.center.y - R)].every((v, i) => v > 0 && v < (i % 2 ? c.h : c.w));
    });
    assert.ok(fits, 'the first view shows the whole circle');
    // A tab opens its panels over the drawing; a button runs and closes them.
    await page.locator('.rb-tab[data-tab="roundabout"]').click();
    assert.ok(await page.locator('.rb-pane[data-tab="roundabout"] .rb-btn').first().isVisible());
    assert.equal(await page.evaluate(() => window.fpPage.camera.h), h0, 'the drawing did not move down');
    await page.locator('.rb-pane[data-tab="roundabout"] .rb-btn[data-cmd="ICD"]').click();
    assert.doesNotMatch(await page.locator('#ribbon').getAttribute('class'), /\bpeek\b/);
    assert.match(await page.locator('.cl-prompt').textContent(), /^ICD /);
    assert.deepEqual(short.errors, []);
  } finally { await short.close(); }
  const narrow = await fresh({ width: 768, height: 950 });
  try {
    const r = await narrow.page.evaluate(() => { const b = document.querySelector('.sb-self').getBoundingClientRect(); return { left: b.left, right: b.right, w: innerWidth, scroll: document.documentElement.scrollWidth }; });
    assert.ok(r.left >= 0 && r.right <= r.w, `Check myself is at ${r.left} to ${r.right} of ${r.w}`);
    assert.equal(r.scroll, r.w, 'no sideways scroll');
    assert.match(await narrow.page.locator('#ribbon').getAttribute('class'), /^ribbon$/, 'a tall window keeps the ribbon open');
  } finally { await narrow.close(); }
});

test('typing ICD 110 with no click sets the diameter on the page and the server, and U undoes it', { skip }, async () => {
  const { page, close, project } = await fresh();
  try {
    const before = icdOf(await state(page));
    await page.mouse.move(700, 400);
    await page.keyboard.type('ICD 110');
    // The space ended the command name as Enter does, so ICD is already asking and 110 is its answer so far.
    assert.equal(await page.locator('.cl-input').inputValue(), '110');
    assert.match(await page.locator('.cl-prompt').textContent(), /^ICD Specify inscribed circle diameter <\d+\.\d\d>:$/);
    await page.keyboard.press('Enter');
    await until(page, async (p) => icdOf(await state(p)) === 110, 'the diameter is 110');
    await until(page, async () => (await serverProject(project.id)).options[0].round.icd === 110, 'the server has 110');
    const lines = await history(page, 4);
    assert.ok(lines.some((l) => l === 'Command: ICD'));
    assert.ok(lines.some((l) => /<\d+\.\d\d>: 110$/.test(l)), lines.join(' | '));
    await page.keyboard.type('U');
    await page.keyboard.press('Enter');
    await until(page, async (p) => icdOf(await state(p)) === before, 'undo puts it back');
    await until(page, async () => (await serverProject(project.id)).options[0].round.icd === before, 'the server has it back');
    assert.match((await history(page, 1))[0], /^Undid your change: /);
  } finally { await close(); }
});

test('the wheel zooms about the cursor', { skip }, async () => {
  const { page, close } = await fresh();
  try {
    const box = await canvasBox(page);
    const at = { x: Math.round(box.x + box.width * 0.3), y: Math.round(box.y + box.height * 0.6) };   // whole pixels, as mouse events carry
    await page.mouse.move(at.x, at.y);
    const world = () => page.evaluate(([x, y]) => window.fpPage.camera.toWorld(x, y), [at.x - box.x, at.y - box.y]);
    const k0 = await page.evaluate(() => window.fpPage.camera.k);
    const w0 = await world();
    await page.mouse.wheel(0, -300);
    await settle(page);
    const k1 = await page.evaluate(() => window.fpPage.camera.k);
    const w1 = await world();
    assert.ok(k1 > k0 * 1.5, 'zoomed in');
    assert.ok(Math.hypot(w1.x - w0.x, w1.y - w0.y) < 0.01, 'the point under the cursor stays put');
  } finally { await close(); }
});

test('Esc cancels a command and clears the selection', { skip }, async () => {
  const { page, close } = await fresh();
  try {
    const p = await pointOn(page, 'leg:N');
    await page.mouse.click(p.x, p.y);
    assert.deepEqual((await state(page)).selection, ['leg:N']);
    await settle(page);
    assert.match(await page.locator('.rb-tab.ctx:not([hidden])').textContent(), /^Leg: /, 'the leg tab shows');
    await page.keyboard.type('MOVE');
    await page.keyboard.press('Enter');
    assert.ok(await page.locator('.cmdline.asking').isVisible());
    await page.mouse.move(p.x + 40, p.y + 40);
    await page.keyboard.press('Escape');
    await settle(page);
    assert.deepEqual((await state(page)).selection, []);
    assert.equal(await page.locator('.cmdline.asking').count(), 0);
    assert.ok((await history(page, 3)).includes('*Cancel*'));
  } finally { await close(); }
});

test('pulling an entry curve grip out works the checks out live, turns Entry speed red, and commits one change on release', { skip }, async () => {
  const { page, close, project } = await fresh();
  try {
    // The project's limits are left as they are: the drag alone takes the entry over its speed limit.
    assert.deepEqual((await serverProject(project.id)).rules, {});
    const legPoint = await pointOn(page, 'leg:N');
    await page.mouse.click(legPoint.x, legPoint.y);
    await settle(page);
    const g = await gripAt(page, 'entry-radius:N:0');
    assert.ok(g, 'the selected leg shows its entry curve grip');
    const c = await pointOn(page, 'round');
    const r0 = (await state(page)).project.options[0].round.legs.find((l) => l.id === 'N').entryRadius;
    const entryRed = () => page.locator('.ck-row.st-fail[data-check="entry-speed"]').count();
    assert.equal(await entryRed(), 0, 'Entry speed passes before the drag');
    const values0 = await page.locator('.ck-row:not(.ck-head) .ck-v').allTextContents();
    const seq0 = (await serverProject(project.id)).seq;
    // Out, away from the circle, a little at a time as a hand does, until Entry speed turns red.
    const d = Math.hypot(g.x - c.x, g.y - c.y), ux = (g.x - c.x) / d, uy = (g.y - c.y) / d;
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    let red = false, i = 0;
    while (!red && i < 80) {
      i++;
      await page.mouse.move(Math.round(g.x + ux * 4 * i), Math.round(g.y + uy * 4 * i));
      if (i % 3 === 0) { await settle(page); red = (await entryRed()) > 0; }
    }
    await settle(page);
    assert.ok(red, 'Entry speed turned red while dragging');
    assert.ok(await page.locator('.dyn').isVisible(), 'the dynamic input box shows');
    assert.match(await page.locator('.dyn-label').first().textContent(), /entry curb radius/i);
    assert.equal((await state(page)).draft, true);
    const values1 = await page.locator('.ck-row:not(.ck-head) .ck-v').allTextContents();
    assert.notDeepEqual(values1, values0, 'the checks changed while dragging');
    await page.mouse.up();
    await settle(page);
    const st = await state(page);
    assert.equal(st.draft, false);
    assert.ok(st.project.options[0].round.legs.find((l) => l.id === 'N').entryRadius > r0, 'the entry curb radius got bigger');
    assert.ok((await entryRed()) > 0, 'Entry speed stays red once the change is made');
    await until(page, async () => (await serverProject(project.id)).seq === seq0 + 1, 'one change reached the server');
    // The change's line, then one line for each other curb radius the drag made smaller in its corner.
    assert.ok((await history(page, 4)).some((l) => /^\*\* STRETCH \*\* /.test(l)), (await history(page, 4)).join(' | '));
  } finally { await close(); }
});

test('turning a leg a few degrees builds a tighter corner, and the warning shows under its check and on the tree', { skip }, async () => {
  const { page, close } = await fresh();
  try {
    const legPoint = await pointOn(page, 'leg:E');
    await page.mouse.click(legPoint.x, legPoint.y);
    await settle(page);
    const g = await gripAt(page, 'bearing:E:0');
    assert.ok(g, 'the selected leg shows its turn grip');
    const c = await pointOn(page, 'round');
    const notes = () => page.locator('.ck-wrap:has(.ck-row[data-check="geometry"]) .ck-notes:not([hidden]) .ck-item').count();
    assert.equal(await notes(), 0, 'no notes before the turn');
    // Round the centre, a few pixels at a time, until the shape check warns.
    const R = Math.hypot(g.x - c.x, g.y - c.y), a0 = Math.atan2(g.y - c.y, g.x - c.x);
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    let warn = false, i = 0;
    while (!warn && i < 40) {
      i++;
      const a = a0 + (i * 0.6 * Math.PI) / 180;
      await page.mouse.move(Math.round(c.x + R * Math.cos(a)), Math.round(c.y + R * Math.sin(a)));
      if (i % 2 === 0) { await settle(page); warn = (await page.locator('.ck-row.st-warn[data-check="geometry"]').count()) > 0; }
    }
    await page.mouse.up();
    await settle(page);
    assert.ok(warn, 'the shape check warns once a corner is built tighter');
    assert.ok(await notes() > 0, 'the warning shows under the check without opening it');
    const note = await page.locator('.ck-wrap:has(.ck-row[data-check="geometry"]) .ck-notes .ck-it').first().textContent();
    const tree = await page.locator('.tree .tr .tl').allTextContents();
    assert.ok(tree.includes(note), 'the tree lists the note under the check');
  } finally { await close(); }
});

test('OPTION copies the option and COMPARE shows both side by side', { skip }, async () => {
  const { page, close } = await fresh();
  try {
    await page.mouse.move(700, 400);
    await page.keyboard.type('OPTION');
    await page.keyboard.press('Enter');
    await until(page, async (p) => (await state(p)).optionId === 'B', 'option B is on screen');
    await page.keyboard.type('ICD 120');
    await page.keyboard.press('Enter');
    await page.keyboard.type('COMPARE');
    await page.keyboard.press('Enter');
    await settle(page);
    assert.equal(await page.locator('.cmp th.cmp-opt').count(), 2);
    assert.deepEqual(await page.locator('.dt-tab .dt-name').allTextContents(), ['Option A', 'Option B']);
    assert.ok(await page.locator('.cmp td.best').count() > 0, 'the best value in a row is marked');
    await page.locator('.cmp th.cmp-opt button', { hasText: 'Option A' }).click();
    assert.equal((await state(page)).optionId, 'A');
  } finally { await close(); }
});

test('Properties edits the selected leg in place', { skip }, async () => {
  const { page, close, project } = await fresh();
  try {
    const p = await pointOn(page, 'leg:E');
    await page.mouse.dblclick(p.x, p.y);
    await settle(page);
    assert.equal(await page.locator('.pr-pick option:checked').textContent(), 'Leg (1)');
    const row = page.locator('.pr-row[data-key="p-legs.*.splitterLength"] .pr-val');
    const was = parseFloat(await row.textContent());
    const want = was + 5;
    await row.click();
    await page.locator('.pr-input').fill(String(want));
    await page.keyboard.press('Enter');
    await settle(page);
    const leg = (await state(page)).project.options[0].round.legs.find((l) => l.id === 'E');
    assert.equal(leg.splitterLength, want);
    assert.match(await row.textContent(), new RegExp(`^${want.toFixed(2)}`));
    await until(page, async () => (await serverProject(project.id)).options[0].round.legs.find((l) => l.id === 'E').splitterLength === want, 'saved');
  } finally { await close(); }
});

test('a window takes what is inside it; a crossing window takes what it touches', { skip }, async () => {
  const { page, close } = await fresh();
  try {
    // Zoom out so the whole drawing, lead-in lines too, is on screen.
    await page.mouse.move(700, 400);
    await page.keyboard.type('Z .3x');
    await page.keyboard.press('Enter');
    await settle(page);
    const box = await canvasBox(page);
    // Left to right around the whole drawing: everything.
    await page.mouse.move(box.x + 4, box.y + 4);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
    await page.mouse.move(box.x + box.width - 4, box.y + box.height - 4, { steps: 4 });
    await page.mouse.up();
    let sel = (await state(page)).selection;
    const legs = (await state(page)).project.options[0].round.legs.map((l) => `leg:${l.id}`);
    for (const k of legs) assert.ok(sel.includes(k), `${k} in ${sel}`);
    await page.keyboard.press('Escape');
    // Right to left, a small box across the North leg only: just that leg.
    const n = await pointOn(page, 'leg:N');
    await page.mouse.move(n.x + 6, n.y - 4);
    await page.mouse.down();
    await page.mouse.move(n.x - 6, n.y + 4, { steps: 3 });
    await page.mouse.up();
    sel = (await state(page)).selection;
    assert.deepEqual(sel, ['leg:N']);
  } finally { await close(); }
});

test('a change made through the connector arrives on the page and in the history', { skip }, async () => {
  const { page, close, project } = await fresh();
  try {
    const r = await server.tool('change_option', { project: project.id, option: 'A', changes: [{ path: 'icd', value: 125 }], reason: 'Made the circle a little smaller' });
    assert.ok(r.result && !r.result.isError, JSON.stringify(r).slice(0, 300));
    await until(page, async (p) => icdOf(await state(p)) === 125, 'the page has the new diameter', 6000);
    assert.ok((await history(page, 3)).some((l) => l.startsWith('Claude: Made the circle a little smaller')));
  } finally { await close(); }
});

test('a save and a poll answered by a sign-in page (200, HTML) wait and carry on: the change is saved and Claude\'s next one arrives', { skip }, async () => {
  const { page, close, project } = await fresh();
  try {
    const html = { status: 200, contentType: 'text/html', body: '<!doctype html><title>Sign in to this network</title><p>Accept the terms to go on.</p>' };
    let saves = 0, polls = 0;
    await page.route(/\/api\/projects\/[^/?]+\/changes$/, (route) => (route.request().method() === 'POST' && saves++ === 0 ? route.fulfill(html) : route.continue()));
    await page.mouse.move(700, 400);
    await page.keyboard.type('ICD 115');
    await page.keyboard.press('Enter');
    await until(page, async (p) => (await state(p)).net.state === 'offline', 'the status bar says the change waits');
    assert.match((await state(page)).net.text, /^Offline: 1 change not saved yet\. A sign-in page on this network may be in the way\.$/);
    await until(page, async () => (await serverProject(project.id)).options[0].round.icd === 115, 'the change reaches the server on the next try', 8000);
    await until(page, async (p) => (await state(p)).net.state === 'saved', 'all changes saved');
    // A poll answered the same way: the poll carries on, and a change made through the connector still arrives.
    await page.route(/\/api\/projects\/[^/?]+\/changes\?since=/, (route) => (polls++ === 0 ? route.fulfill(html) : route.continue()));
    await until(page, async () => polls > 0, 'a poll was answered by the sign-in page', 6000);
    const r = await server.tool('change_option', { project: project.id, option: 'A', changes: [{ path: 'icd', value: 118 }], reason: 'Tried a slightly larger circle' });
    assert.ok(r.result && !r.result.isError, JSON.stringify(r).slice(0, 300));
    await until(page, async (p) => icdOf(await state(p)) === 118, 'Claude\'s change arrives after the broken poll', 8000);
    assert.ok(polls > 1, 'the poll asked again');
    assert.equal((await state(page)).net.state, 'saved');
  } finally { await close(); }
});

test('EXPORT answers in plain words: the DXF file it saved, or why it could not', { skip }, async () => {
  const { page, close } = await fresh();
  try {
    await page.mouse.move(700, 400);
    await page.keyboard.type('EXPORT');
    await page.keyboard.press('Enter');
    // Either answer is plain words on one line: the file, its units and zone, and how to insert it; or why not.
    await until(page, async (p) => /^(Saved|Not exported)/.test((await history(p, 1))[0]), 'export answers');
    const line = (await history(page, 1))[0];
    assert.match(line, /^(Saved \S+\.dxf in US survey feet, California zone \d \(EPSG \d{4}\)\. Insert it at 0,0 with scale 1\.|Not exported: .+\.)$/);
  } finally { await close(); }
});

test('with no key the page still works on a sample and says changes are not saved', { skip }, async () => {
  const { page, close, errors } = await openPage(server, null, { browser, key: null });
  try {
    const st = await state(page);
    assert.equal(st.net.state, 'local');
    assert.match(st.net.text, /^Not saved/);
    await page.mouse.move(700, 400);
    await page.keyboard.type('ICD 120');
    await page.keyboard.press('Enter');
    await until(page, async (p) => icdOf(await state(p)) === 120, 'changed locally');
    assert.deepEqual(errors, []);
  } finally { await close(); }
});

test('a drag frame (evaluate and redraw) stays under 16 ms', { skip }, async () => {
  const { page, close } = await fresh();
  try {
    const p = await pointOn(page, 'leg:N');
    await page.mouse.click(p.x, p.y);
    await settle(page);
    const g = await gripAt(page, 'splitter-tip');
    await page.evaluate(() => window.fpPage.meter.reset());
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    // Out along the leg half a pixel at a time, so every frame is a new shape to work out.
    for (let i = 0; i < 90; i++) {
      await page.mouse.move(g.x + Math.sin(i / 9) * 4, g.y - 3 - i * 0.5);
      await settle(page);
    }
    const s = await page.evaluate(() => window.fpPage.meter.summary());
    const w = await page.evaluate(() => window.fpPage.evaluator.workerTimes.slice());
    await page.keyboard.press('Escape');
    await page.mouse.up();
    const q = (list, f) => { const t = list.slice().sort((a, b) => a - b); return t.length ? Math.round(t[Math.min(t.length - 1, Math.ceil(f * t.length) - 1)] * 10) / 10 : null; };
    console.log(`main thread frame work p50 ${s.work.p50} p90 ${s.work.p90} p99 ${s.work.p99} ms (evaluate here p50 ${s.evaluate.p50}); `
      + `evaluate in the worker p50 ${q(w, 0.5)} p90 ${q(w, 0.9)} ms over ${w.length} shapes; frames every ${s.frames && s.frames.p50} ms`);
    assert.ok(s.work.n >= 30, 'frames were measured');
    assert.ok(w.length >= 20, 'the worker kept working the shape out as it moved');
    assert.ok(s.work.p90 < 16, `frame work p90 ${s.work.p90} ms`);
  } finally { await close(); }
});
