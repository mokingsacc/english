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
  let F = null, modelVersion = 0, modelKey = '', panelsDirty = true, lastEvalTotal = 0;

  function compute() {
    const st = app.store.get();
    const option = currentOption(st);
    if (!option) return null;
    const round = st.draft || option.round;
    const rules = st.project.rules;
    let result = null, fresh = true;
    if (st.draft && app.evaluator.async()) {
      // While dragging, the worker works the shape out; until it answers, the last answer for this option stands.
      result = app.evaluator.peek(round, rules);
      if (!result) {
        app.evaluator.ask(round, rules);
        fresh = false;
        result = F && F.option.id === option.id && F.result ? F.result : app.evaluator.run(option.round, rules);
      }
    } else result = app.evaluator.run(round, rules);
    if (result.ok) lastGood.set(option.id, result);
    const shown = result.ok ? result : lastGood.get(option.id) || null;
    const grips = gripPoints(round, result.ok ? result : shown, st.selection);
    return { st, option, round, result, fresh, shown, dim: !result.ok, grips, index: indexOf(shown), problem: result.ok ? null : result.problems[0] };
  }

  function focusOf(st, shown) {
    if (!st.focusCheck || !shown || st.focusCheck.option !== st.optionId) return null;
    const c = shown.checks.find((x) => x.id === st.focusCheck.id);
    return c ? { where: c.where, status: c.status } : null;
  }

  function frame() {
    const t0 = performance.now();
    // Evaluate time since the last frame: some runs happen as the mouse moves (grips and snaps ask), the rest in here.
    const evalBefore = app.evaluator.total - lastEvalTotal;
    const evalStart = app.evaluator.total;
    F = compute();
    if (!F) return;
    const st = F.st;
    const vs = app.viewport.state();
    const focus = focusOf(st, F.shown);
    // The photo is not in this key: the layers keep it in its own bitmap and paint it again when it changes.
    const key = [st.display.photo, st.display.curbs, st.display.edges, st.display.islands, st.display.paths, st.display.speeds, st.display.sight,
      st.display.landtake, st.toggles.grid, st.focusCheck && st.focusCheck.id, F.dim,
      st.selection.join(',')].join('|');   // the selection's grips are kept clear of the speed labels
    if (key !== modelKey || F.shown !== app._lastShown) { modelVersion++; modelKey = key; app._lastShown = F.shown; }
    const cursor = vs.cursor ? { ...vs.cursor, mode: app.viewport.cursorMode() } : null;
    const scene = {
      modelVersion, shown: F.shown, dim: F.dim, display: st.display, toggles: st.toggles, index: F.index,
      selection: st.selection, hover: vs.hover, grips: F.grips, hotGrip: vs.hotGrip, hoverGrip: vs.hoverGrip,
      band: vs.band, cursor, problem: F.dim && cursor && cursor.visible ? F.problem : null, focus,
      underlay: app.underlayFace,
    };
    app.layers.draw(scene, app.camera);
    if (app.ui.findMe) app.ui.findMe.update(app.camera, F.index);
    app.ui.statusbar.update(st, vs.cursor && vs.cursor.visible ? vs.cursor : null);
    if (app.viewport.dragging() && vs.cursor) app.dyn.place(vs.cursor.sx, vs.cursor.sy, dragShown());
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
    // The frame's work as the meter counts it: evaluate, then everything else (drawing and the panels).
    app.stats.lastFrameMs = performance.now() - t0;
    const evalInside = app.evaluator.total - evalStart;
    lastEvalTotal = app.evaluator.total;
    app.meter.work(evalBefore + evalInside, app.stats.lastFrameMs - evalInside);
  }

  /**
   * What the dynamic input box shows while a grip is dragged: each value, a radius as it is built, and when the radius
   * asked for and the one built differ, both ("asked 250.00 ft, built 132.00 ft"). Null while the worker has not yet
   * answered for the shape under the hand, so the box keeps what it showed rather than mixing two shapes.
   */
  function dragShown() {
    const d = app.viewport.dragInfo();
    if (!d) return null;
    const res = F.result && F.result.ok ? F.result : null;
    if (d.built.some(Boolean) && (!F.fresh || !res)) return null;
    let note = '';
    const values = d.values.map((v, i) => {
      const b = d.built[i];
      const L = b ? res.geometry.legs.find((l) => l.id === b.leg) : null;
      const built = L ? L[b.field] : null;
      if (!Number.isFinite(built)) return v.toFixed(2);
      if (Math.abs(built - v) > 0.005) note = `asked ${v.toFixed(2)} ft, built ${built.toFixed(2)} ft`;
      return built.toFixed(2);
    });
    return { values, note };
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
