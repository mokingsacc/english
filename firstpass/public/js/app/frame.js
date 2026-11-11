// One animation frame of the page: work out the roundabout on screen (the draft while a grip is dragged), keep the last
// shape that could be built for each option (shown dimmed while the current one cannot be), build the scene, draw it
// through the layers face, and let each panel write only what changed. Asked for by request(); never runs on its own.
//   const frames = createFrames(app);  frames.request('why');  frames.info()  (the last frame's facts, for picking)
import { currentOption, selectedLegs } from './store.js';
import { gripPoints } from './grips/index.js';
import { indexOf } from './model-index.js';

const QUIET = new Set(['cursor', 'view']);   // these redraw the canvas but leave the panels alone

export function createFrames(app) {
  const lastGood = new Map();
  let F = null, modelVersion = 0, modelKey = '', panelsDirty = true, lastEvalCount = 0;

  function compute() {
    const st = app.store.get();
    const option = currentOption(st);
    if (!option) return null;
    const round = st.draft || option.round;
    const result = app.evaluator.run(round, st.project.rules);
    if (result.ok) lastGood.set(option.id, result);
    const shown = result.ok ? result : lastGood.get(option.id) || null;
    const grips = gripPoints(round, result.ok ? result : shown, st.selection);
    return { st, option, round, result, shown, dim: !result.ok, grips, index: indexOf(shown), problem: result.ok ? null : result.problems[0] };
  }

  function focusOf(st, shown) {
    if (!st.focusCheck || !shown || st.focusCheck.option !== st.optionId) return null;
    const c = shown.checks.find((x) => x.id === st.focusCheck.id);
    return c ? { where: c.where, status: c.status } : null;
  }

  function frame() {
    const t0 = performance.now();
    F = compute();
    if (!F) return;
    const evals = app.evaluator.times.length;
    const evalMs = evals !== lastEvalCount ? app.evaluator.lastMs : 0;
    lastEvalCount = evals;
    const st = F.st;
    const vs = app.viewport.state();
    const focus = focusOf(st, F.shown);
    const key = [st.display.photo, st.display.curbs, st.display.edges, st.display.islands, st.display.paths, st.display.speeds, st.display.sight,
      st.display.landtake, st.toggles.grid, st.focusCheck && st.focusCheck.id, F.dim, app.photoVersion()].join('|');
    if (key !== modelKey || F.shown !== app._lastShown) { modelVersion++; modelKey = key; app._lastShown = F.shown; }
    const cursor = vs.cursor ? { ...vs.cursor, mode: app.viewport.cursorMode() } : null;
    const scene = {
      modelVersion, shown: F.shown, dim: F.dim, display: st.display, toggles: st.toggles, index: F.index,
      selection: st.selection, hover: vs.hover, grips: F.grips, hotGrip: vs.hotGrip, hoverGrip: vs.hoverGrip,
      band: vs.band, cursor, problem: F.dim && cursor && cursor.visible ? F.problem : null, focus,
      underlay: app.underlayFace,
    };
    app.layers.draw(scene, app.camera);
    const t1 = performance.now();
    app.meter.work(evalMs, t1 - t0 - evalMs);
    app.ui.statusbar.update(st, vs.cursor && vs.cursor.visible ? vs.cursor : null);
    if (app.viewport.dragging() && vs.cursor) app.dyn.place(vs.cursor.sx, vs.cursor.sy, dragValues(st));
    if (panelsDirty) {
      panelsDirty = false;
      const legs = selectedLegs(st);
      app.ui.titlebar.update(st.project);
      app.ui.ribbon.update(st, F.option, legs);
      app.ui.doctabs.update(st, F.option);
      if (app.ui.toolspace.state() === 'open') {
        if (app.ui.toolspace.tab() === 'prospector') app.ui.prospector.update(st, F.option);
        else app.ui.settings.update(st);
      }
      if (app.ui.properties.state() === 'open') app.ui.propertiesView.update(st, F.option, legs, F.result);
      app.ui.panorama.update(st, F.option, F.result);
    }
    app.stats.lastFrameMs = performance.now() - t0;
  }

  function dragValues(st) {
    const d = app.viewport.dragInfo ? app.viewport.dragInfo() : null;
    void st;
    return d ? d.values.map((v) => v.toFixed(2)) : [];
  }

  return {
    frame,
    request(why = 'state') {
      if (!QUIET.has(why)) panelsDirty = true;
      app.layers.request();
    },
    /** The facts of the drawing as the store now stands (worked out again when it changed since the last frame). */
    info() { if (!F || F.st !== app.store.get()) F = compute() || F; return F || {}; },
    forget(optionId) { if (optionId) lastGood.delete(optionId); else lastGood.clear(); },
  };
}
