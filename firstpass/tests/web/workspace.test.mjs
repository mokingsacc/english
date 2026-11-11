// The workspace in a real browser against the real routes: it opens clean, typing goes to the command line without a
// click (ICD 110, then U), the wheel zooms about the cursor, Esc clears, a grip drag works out the checks live and
// commits one change on release, OPTION and COMPARE, Properties editing, window and crossing selection, a change made
// through the connector arriving in the history, EXPORT's plain answer, and the frame budget while dragging.
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
    assert.match((await history(page, 1))[0], /^Undo: /);
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

test('dragging a grip works the checks out live, shows the value by the cursor, and commits one change on release', { skip }, async () => {
  const { page, close, project } = await fresh();
  try {
    const c = await pointOn(page, 'round');
    await page.mouse.click(c.x, c.y);
    await settle(page);
    const g = await gripAt(page, 'quadrant::0');   // the east quadrant
    assert.ok(g, 'the circle has quadrant grips');
    const icd0 = icdOf(await state(page));
    const values0 = await page.locator('.ck-row:not(.ck-head) .ck-v').allTextContents();
    const seq0 = (await serverProject(project.id)).seq;
    await page.mouse.move(g.x, g.y);
    await page.mouse.down();
    // In toward the centre, a little at a time, as a hand does.
    for (let i = 1; i <= 20; i++) await page.mouse.move(g.x + ((c.x - g.x) * 0.55 * i) / 20, g.y + ((c.y - g.y) * 0.55 * i) / 20);
    await settle(page);
    assert.ok(await page.locator('.dyn').isVisible(), 'the dynamic input box shows');
    assert.match(await page.locator('.dyn-label').first().textContent(), /diameter/i);
    assert.equal((await state(page)).draft, true);
    const red = await page.locator('.ck-row.st-fail, .ck-banner:not([hidden])').count();
    assert.ok(red > 0, 'a check turned red');
    const values1 = await page.locator('.ck-row:not(.ck-head) .ck-v').allTextContents();
    assert.notDeepEqual(values1, values0, 'the checks changed while dragging');
    await page.mouse.up();
    await settle(page);
    const st = await state(page);
    assert.equal(st.draft, false);
    assert.ok(icdOf(st) < icd0, 'the diameter got smaller');
    await until(page, async () => (await serverProject(project.id)).seq === seq0 + 1, 'one change reached the server');
    assert.match((await history(page, 1))[0], /^\*\* STRETCH \*\* /);
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

test('EXPORT says in plain words that DXF export is not built yet', { skip }, async () => {
  const { page, close } = await fresh();
  try {
    await page.mouse.move(700, 400);
    await page.keyboard.type('EXPORT');
    await page.keyboard.press('Enter');
    await until(page, async (p) => (await history(p, 1))[0].startsWith('Not exported'), 'export answers');
    const line = (await history(page, 1))[0];
    assert.match(line, /^Not exported: DXF export is not built yet\. .* Nothing was saved\.$/);
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
