// The page's start: makes the store, the server link, the drawing and every panel, joins them in one `app` object that
// each part is handed, and opens the project named in the link (or her newest one, or a sample when there is no key
// or no server). The key is taken from the link (#k=) and the address bar is left without it.
// app is the one object every part is handed; each method here is named for what a part asks of it.
import { evaluate } from '../engine/index.js';
import { createStore, initialState, currentOption, selectedLegs } from './store.js';
import { createApi, linkFor } from './api.js';
import { createSync } from './sync.js';
import { op } from './ops.js';
import { createEvaluator, percentiles } from './evaluator.js';
import { createFrameMeter } from './frame-meter.js';
import { createFrames } from './frame.js';
import { prefs } from './prefs.js';
import { indexOf, roughExtents, whereBox } from './model-index.js';
import { createCamera, boxOf } from '../draw/camera.js';
import { createLayers } from '../draw/layers.js';
import { createUnderlay } from '../draw/underlay.js';
import { defaultDisplay, DISPLAY } from '../draw/colors.js';
import { COMMANDS, ribbonEntries } from '../commands/index.js';
import { createRunner } from '../commands/runner.js';
import { createTitlebar } from '../ui/titlebar.js';
import { createRibbon } from '../ui/ribbon.js';
import { createPalette } from '../ui/palettes.js';
import { createProspector } from '../ui/prospector.js';
import { createSettings } from '../ui/settings.js';
import { createProperties } from '../ui/properties.js';
import { createDocTabs } from '../ui/doctabs.js';
import { createViewport } from '../ui/viewport.js';
import { createDynInput } from '../ui/dyninput.js';
import { createPanorama } from '../ui/panorama.js';
import { createCmdline } from '../ui/cmdline.js';
import { createStatusbar } from '../ui/statusbar.js';
import { createDialogs } from '../ui/dialogs.js';
import { createTooltips } from '../ui/tooltip.js';
import { installKeys } from '../ui/keys.js';
import { closeMenu } from '../ui/menu.js';

const $ = (id) => document.getElementById(id);
const POLAR_STEP = 15, POLAR_NEAR = 4;
const TOGGLE_WORDS = { grid: 'Grid', polar: 'Polar tracking', osnap: 'Object snap', dyn: 'Dynamic input' };
const legWords = (leg) => (leg ? (/\bleg$/i.test(leg.name) ? `the ${leg.name}` : `the ${leg.name} leg`) : 'the leg');

export function boot() {
  const api = createApi();
  const link = api.link;
  // The key stays in this browser (fp.key), never in the address bar, history or a screenshot.
  if (link.k) history.replaceState(null, '', location.pathname + location.search + linkFor({ p: link.p, o: link.o, act: link.do }));

  const start = initialState();
  start.display = { ...defaultDisplay(), ...pick(prefs.get('display', {}), DISPLAY.map((d) => d.key)) };
  start.toggles = { ...start.toggles, ...pick(prefs.get('toggles', {}), Object.keys(start.toggles)) };
  if (api.hasKey()) start.net = { state: 'saving', text: 'Opening the project...' };
  start.photo = { state: 'loading', text: '' };
  const store = createStore(start);

  const canvas = $('canvas');
  const camera = createCamera();
  const evaluator = createEvaluator(evaluate, { worker: makeWorker(), onReady: () => app.request('eval') });
  const meter = createFrameMeter({ target: $('viewport') });
  const views = [];
  let frames = null, layers = null, cmdline = null, runner = null, viewport = null, lastPrompt = null, photoV = 0, viewTimer = 0;

  const app = {
    store, api, camera, evaluator, meter, op, commands: COMMANDS, stats: { lastFrameMs: 0 }, ui: {}, lastSelfCheck: null,
    _lastShown: null,

    // ---- what is on screen
    option: () => currentOption(store.get()),
    round: () => { const o = currentOption(store.get()); return o ? o.round : null; },
    project: () => store.get().project,
    selectedLegs: () => selectedLegs(store.get()),
    frameInfo: () => (frames ? frames.info() : {}),
    // The option on screen follows a grip drag (the draft's answer), so the tree, the tabs and Compare agree with the checks.
    evaluateOption: (o) => {
      if (!o) return null;
      const st = store.get();
      if (st.draft && o.id === st.optionId && frames) { const f = frames.info(); if (f.result) return f.result; }
      return evaluator.run(o.round, (st.project || {}).rules);
    },
    photoVersion: () => photoV,
    viewportRect: () => canvas.getBoundingClientRect(),

    // ---- changes
    change: (ops, summary) => sync.change(ops, summary),
    setDraft(round) { store.set({ draft: round }, 'draft'); },
    select(keys) {
      const cur = store.get().selection;
      if (keys.length === cur.length && keys.every((k, i) => k === cur[i])) return;
      store.set({ selection: keys }, 'selection');
    },
    selectAll() { const r = app.round(); if (r) app.select(['round', ...r.legs.map((l) => `leg:${l.id}`)]); },
    setOption(id) {
      const st = store.get();
      if (!st.project || !st.project.options.some((o) => o.id === id) || st.optionId === id) return;
      if (viewport) viewport.cancelDrag();
      store.set({ optionId: id, selection: [], draft: null, focusCheck: null }, 'option');
      writeHash();
    },
    findLeg(text) {
      const t = String(text || '').trim().toLowerCase();
      const r = app.round();
      if (!t || !r) return null;
      const bare = (s) => s.toLowerCase().replace(/\s+leg$/, '');
      const leg = r.legs.find((l) => l.id.toLowerCase() === t) || r.legs.find((l) => l.name.toLowerCase() === t)
        || r.legs.find((l) => bare(l.name) === bare(t)) || r.legs.find((l) => bare(l.name).startsWith(bare(t)));
      return leg ? leg.id : null;
    },

    // ---- drawing aids
    toggle(key) {
      const t = { ...store.get().toggles, [key]: !store.get().toggles[key] };
      prefs.set('toggles', t);
      store.set({ toggles: t }, 'toggle');
      app.echo(`${TOGGLE_WORDS[key] || key} ${t[key] ? 'on' : 'off'}.`, 'note');
      return t[key];
    },
    toggleDisplay(key) {
      const d = { ...store.get().display, [key]: !store.get().display[key] };
      prefs.set('display', d);
      store.set({ display: d }, 'display');
      if (key === 'photo' && d.photo && store.get().photo.state === 'off') app.echo(`${store.get().photo.text}: ${store.get().photo.why || 'the photo service did not answer'}.`, 'note');
      return d[key];
    },
    polarSnap(b) {
      if (!store.get().toggles.polar) return b;
      const n = Math.round(b / POLAR_STEP) * POLAR_STEP;
      return Math.abs(n - b) <= POLAR_NEAR ? ((n % 360) + 360) % 360 : b;
    },
    bearingTo(p) {
      const r = app.round();
      const c = r ? r.center : { x: 0, y: 0 };
      const b = ((Math.atan2(p.x - c.x, p.y - c.y) * 180) / Math.PI + 360) % 360;
      return app.polarSnap(Math.round(b * 100) / 100);
    },

    // ---- the view
    zoomExtents() {
      pushView();
      const shown = app.frameInfo().shown;
      const ix = indexOf(shown);
      fitBox(ix ? ix.extents : roughExtents(app.round()), 28);
    },
    /** The first view: framed on the roundabout itself (model-index.js firstView). */
    zoomFirst() {
      pushView();
      const ix = indexOf(app.frameInfo().shown);
      fitBox(ix ? ix.firstView : roughExtents(app.round()), 28);
    },
    zoomToKeys(keys) {
      const ix = indexOf(app.frameInfo().shown);
      if (!ix) return;
      const pts = [];
      for (const k of keys) {
        const b = k === 'round' ? ix.roundBox() : k.startsWith('leg:') ? ix.legBox(k.slice(4)) : null;
        if (b) pts.push({ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y1 });
      }
      const box = boxOf(pts);
      if (box) { pushView(); fitBox(box, 40); }
    },
    zoomToWhere(where) {
      const box = whereBox(app.frameInfo().shown, where);
      if (box) { pushView(); fitBox(box, 60); }
    },
    saveView() {
      const p = store.get().project;
      if (p) prefs.set(`view.${p.id || 'sample'}`, camera.save());
    },
    saveViewSoon() { clearTimeout(viewTimer); viewTimer = setTimeout(app.saveView, 400); },
    layout() { if (layers) layers.resize(); },
    request(why = 'state') { if (frames && layers) frames.request(why); },
    regen() { evaluator.clear(); if (frames) frames.forget(); photoV++; app.request('regen'); },
    focusCheck(id, zoom = false) {
      const st = store.get();
      store.set({ focusCheck: id ? { id, option: st.optionId } : null }, 'focus');
      if (!zoom || !id) return;
      const shown = app.frameInfo().shown;
      const c = shown && shown.checks.find((x) => x.id === id);
      if (c && c.where) app.zoomToWhere(c.where);
    },
    focusDrawing() { canvas.focus({ preventScroll: true }); },

    // ---- commands and the command line
    runCommand(name, args = []) {
      if (viewport && viewport.dragging()) viewport.cancelDrag();
      closeMenu();
      return runner.run(name, args);
    },
    echoCommand(name) { cmdline.echo(`Command: ${name}`, 'command'); },
    echo(text, kind = 'note') { if (cmdline && text) cmdline.echo(text, kind); },
    cmdPrompt(text) { cmdline.prompt(text ? { command: '', line: text } : lastPrompt); },
    cancelDrag() { return viewport ? viewport.cancelDrag() : false; },
    escape() {
      closeMenu();
      if (viewport && viewport.cancelDrag()) return;
      if (viewport) viewport.panMode(false);
      const cancelled = runner.cancel();
      cmdline.clearInput();
      const st = store.get();
      if (st.selection.length || st.focusCheck) {
        store.set({ selection: [], focusCheck: null }, 'selection');
        if (!cancelled && !runner.running()) cmdline.echo('*Cancel*', 'cancel');
      }
    },
    async openProject(id) {
      const r = await sync.open(id);
      if (r.ok) writeHash();
      return r;
    },
  };

  /** The evaluate worker (app/eval-worker.js), or null where module workers cannot start: then all runs stay here. */
  function makeWorker() {
    try { return new Worker(new URL('./eval-worker.js', import.meta.url), { type: 'module' }); } catch { return null; }
  }
  function pick(obj, keys) {
    const out = {};
    if (obj && typeof obj === 'object') for (const k of keys) if (typeof obj[k] === 'boolean') out[k] = obj[k];
    return out;
  }
  function pushView() { views.push(camera.save()); if (views.length > 30) views.shift(); }
  function fitBox(box, pad) {
    if (!box) return;
    layers.size(camera);
    camera.fit(box, pad);
    app.request('view');
    app.saveView();
  }
  function writeHash() {
    const st = store.get();
    if (!st.project || !st.project.id) return;
    const want = linkFor({ p: st.project.id, o: st.optionId });
    if (location.hash !== want) history.replaceState(null, '', location.pathname + location.search + want);
  }

  // ---- the drawing
  frames = createFrames(app);
  layers = createLayers(canvas, { onFrame: () => frames.frame() });
  app.layers = layers;
  app.frames = frames;
  const underlay = createUnderlay({
    tileUrl: api.tileUrl,
    epsgOf: () => (store.get().project ? store.get().project.epsg : 2226),
    onChange: () => { photoV++; app.request('view'); },
    onStatus: (s) => store.set({ photo: { state: s.state, text: s.text, why: s.why } }, 'photo'),
  });
  app.underlayFace = {
    paint: (c, cam, dpr) => {
      const p = store.get().project;
      underlay.paint(c, cam, dpr, { on: !!store.get().display.photo, lat: p && p.site ? p.site.lat : 38.5 });
    },
    busy: () => underlay.busy(),
  };

  // ---- the panels
  const ui = app.ui;
  ui.titlebar = createTitlebar(app, $('titlebar'));
  ui.ribbon = createRibbon(app, $('ribbon'), ribbonEntries(COMMANDS));
  // First widths follow the screen, so a 13 inch laptop keeps room for the drawing; her own widths are remembered.
  const firstWidth = (share, lo, hi) => Math.round(Math.max(lo, Math.min(hi, window.innerWidth * share)));
  ui.toolspace = createPalette(app, $('toolspace'), { id: 'toolspace', name: 'Toolspace', side: 'left', width: firstWidth(0.19, 220, 280), tabs: [{ id: 'prospector', label: 'Prospector' }, { id: 'settings', label: 'Settings' }] });
  ui.prospector = createProspector(app, ui.toolspace.bodies.prospector);
  ui.settings = createSettings(app, ui.toolspace.bodies.settings);
  ui.properties = createPalette(app, $('properties'), { id: 'properties', name: 'Properties', side: 'right', width: firstWidth(0.21, 240, 300), min: 220 });
  ui.propertiesView = createProperties(app, ui.properties.bodies.main);
  ui.doctabs = createDocTabs(app, $('doctabs'));
  ui.panorama = createPanorama(app, $('panorama'));
  cmdline = ui.cmdline = app.cmdline = createCmdline(app, $('cmdline'));
  ui.statusbar = createStatusbar(app, $('statusbar'));
  ui.dialogs = createDialogs(app);
  ui.layers = ui.dialogs.layers;
  app.dyn = createDynInput(app, $('viewport'));
  viewport = app.viewport = createViewport(app, canvas);
  createTooltips(document.body);

  runner = app.runner = createRunner({
    commands: COMMANDS,
    io: {
      echo: (t, kind) => app.echo(t, kind),
      prompt: (s) => { lastPrompt = s; cmdline.prompt(s); app.request('prompt'); },
    },
    context: (base) => commandContext(base),
  });

  function commandContext(base) {
    const ctx = {
      ...base,
      app, ui, op,
      option: app.option,
      round: app.round,
      project: app.project,
      selection: () => store.get().selection,
      selectedLegs: app.selectedLegs,
      select: app.select,
      findLeg: app.findLeg,
      bearingTo: app.bearingTo,
      legWords,
      toggleDisplay: app.toggleDisplay,
      leg: (spec) => base.leg({ findLeg: app.findLeg, ...spec }),
      /** Changes the drawing and says so on the command line (or why not). */
      change(ops, summary, { quiet = false } = {}) {
        const r = app.change(ops, summary);
        if (!r.ok) base.echo(r.error, 'error');
        else if (r.nothing) { if (!quiet) base.echo('Nothing changed: the drawing already has that value.'); }
        else if (!quiet) base.echo(r.summary, 'done');
        return r;
      },
      set: (path, value) => ctx.change([op.set(app.option().id, path, value)]),
      /** The one selected leg, or the leg she picks or names. */
      async oneLeg(text) {
        const legs = app.selectedLegs();
        if (legs.length === 1) return legs[0];
        const id = await ctx.leg({ text });
        return id ? app.round().legs.find((l) => l.id === id) || null : null;
      },
      view: {
        extents: () => app.zoomExtents(),
        object: (keys) => app.zoomToKeys(keys),
        window: (a, b) => { pushView(); fitBox(boxOf([a, b]), 8); },
        scale: (f) => { pushView(); camera.zoomAt(camera.w / 2, camera.h / 2, f); app.request('view'); app.saveView(); },
        previous: () => { const v = views.pop(); if (!v) return false; camera.restore(v); app.request('view'); app.saveView(); return true; },
        panMode: (on) => viewport.panMode(on),
      },
    };
    return ctx;
  }

  // ---- the server
  const sync = app.sync = createSync({
    api, store,
    echo: (t, kind) => app.echo(t, kind),
    onProject: (project, why) => {
      if (why === 'load') { frames.forget(); views.length = 0; restoreView(project); writeHash(); evaluator.warm(project.options[0].round, project.rules); }
    },
  });

  function restoreView(project) {
    layers.size(camera);
    const saved = prefs.get(`view.${project.id || 'sample'}`, null);
    if (!saved || !camera.restore(saved)) {
      const o = project.options[0];
      const res = evaluator.run(o.round, project.rules);
      const ix = indexOf(res && res.ok ? res : null);
      camera.fit(ix ? ix.firstView : roughExtents(o.round), 28);   // framed on the roundabout; ZOOM Extents takes in the roads
    }
    app.request('view');
  }

  store.on((s, why) => frames.request(why));
  installKeys(app);
  window.addEventListener('resize', () => layers.resize());
  window.addEventListener('beforeunload', (e) => { if (sync.waiting()) { e.preventDefault(); e.returnValue = ''; } });

  // What a problem report carries from this page (report.js merges the parts).
  const parts = (window.fpParts = window.fpParts || {});
  parts.page = () => {
    const st = store.get();
    return { project_id: st.project && st.project.id, option: st.optionId, selection: st.selection, project: st.project, sync: { mode: sync.mode(), waiting: sync.waiting(), net: st.net.text }, photo: st.photo.text || st.photo.state, command_lines: cmdline.lastLines(12) };
  };
  parts.perf = () => ({ perf: { frames: meter.summary(), evaluate_ms: percentiles(evaluator.times.slice(-60)), evaluate_worker_ms: percentiles(evaluator.workerTimes.slice(-60)), draw_ms: percentiles(layers.stats.draws.slice(-120)), last_frame_ms: app.stats.lastFrameMs } });
  // A small read-only face for the browser tests and for looking into the page from the console.
  window.fpPage = { state: () => store.get(), info: () => frames.info(), meter, layers: layers.stats, camera, evaluator, ready: null };

  app.echo('First Pass. Type a command, or click a button on the ribbon. F1 lists every command.', 'note');
  const ready = sync.start({ projectId: link.p || null, optionId: link.o || null }).then(() => {
    const st = store.get();
    app.echo(`${sync.mode() === 'server' ? 'Opened' : 'Showing'} "${st.project.name}". ${st.net.text}`, 'note');
    app.request('load');
    if (link.do === 'export-dxf') {
      writeHash();
      app.runCommand('EXPORT');
    }
    return true;
  }).catch((e) => { console.error(e); app.echo(`The page could not open the project: ${e.message}. Use Report a problem.`, 'error'); return false; });
  window.fpPage.ready = ready;
  return app;
}

boot();
