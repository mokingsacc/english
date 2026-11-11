// The drawing area's mouse, as in the CAD original: the wheel zooms about the cursor; a middle drag pans and a double
// middle click zooms to extents; a click selects (Shift click takes away); dragging or clicking out a window selects,
// left to right a window (inside only), right to left a crossing (anything it touches); square grips on the selection
// edit live when dragged (or clicked, moved and clicked again), with the value in a dynamic input box by the cursor,
// and commit one change on release; right click opens the shortcut menu; a running command takes picked points and
// legs. The cursor is the crosshair with its pick box, drawn by the canvas.
import { nearest, selectionWindow, windowSelect } from '../draw/hit.js';
import { wheelFactor } from '../draw/camera.js';
import { GRIP } from '../draw/colors.js';
import { paramFor, setAt } from '../engine/index.js';
import { gripPaths } from '../app/grips/index.js';
import { indexOf, legIdOf } from '../app/model-index.js';
import { openMenu, closeMenu } from './menu.js';

const PICK_PX = 5, MOVE_PX = 4, DBL_MS = 420;

export function createViewport(app, canvas) {
  const cam = app.camera;
  const st = { cursor: null, hover: null, hoverGrip: null, hotGrip: null, band: null, panMode: false };
  let drag = null;        // { kind: 'pan' | 'window' | 'grip', ... }
  let lastMiddle = 0;

  const local = (e) => { const r = canvas.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; };
  const tol = () => PICK_PX / cam.k;
  const index = () => indexOf(app.frameInfo().shown);

  function snapped(w, sx, sy) {
    const s = app.store.get();
    const spec = app.runner.waiting();
    // Object snap catches picked points and the centre grip (moving the roundabout onto a point); a grip that changes one
    // size follows the cursor freely, or the size would stick at whatever named point lies near.
    const moving = drag && drag.kind === 'grip' && drag.grip.id === 'center';
    if (!s.toggles.osnap || !(spec && spec.type === 'point') && !moving) return { p: w, snap: null };
    const ix = index();
    if (!ix) return { p: w, snap: null };
    let best = null, bd = 10;
    for (const q of ix.snaps) {
      const d = Math.hypot(cam.sx(q.x) - sx, cam.sy(q.y) - sy);
      if (d < bd) { bd = d; best = q; }
    }
    return best ? { p: { x: best.x, y: best.y }, snap: best } : { p: w, snap: null };
  }

  function gripAt(sx, sy) {
    const grips = app.frameInfo().grips || [];
    const h = GRIP.size / 2 + 3;
    let best = null, bd = Infinity;
    for (const g of grips) {
      const dx = Math.abs(cam.sx(g.x) - sx), dy = Math.abs(cam.sy(g.y) - sy);
      if (dx <= h && dy <= h && dx + dy < bd) { bd = dx + dy; best = g; }
    }
    return best;
  }

  function objectAt(w) {
    const ix = index();
    if (!ix) return null;
    const hit = nearest(ix.items, w.x, w.y, tol());
    if (hit) return hit.key;
    // Inside the central island counts as the roundabout, as a hatch is picked by its area.
    const res = app.frameInfo().shown;
    if (res && res.ok && Math.hypot(w.x - res.geometry.center.x, w.y - res.geometry.center.y) < res.geometry.radii.island) return 'round';
    return null;
  }

  function move(e) {
    const { sx, sy } = local(e);
    const w = cam.toWorld(sx, sy);
    const { p, snap } = snapped(w, sx, sy);
    st.cursor = { sx, sy, x: p.x, y: p.y, visible: true, snap };
    if (drag && drag.kind === 'pan') { cam.panBy(sx - drag.sx, sy - drag.sy); drag.sx = sx; drag.sy = sy; app.request('view'); return; }
    // A grip moves by the hand's motion from where it was taken (a snapped point is used as it is).
    if (drag && drag.kind === 'grip') { dragTo(snap ? p : { x: drag.g0.x + w.x - drag.w0.x, y: drag.g0.y + w.y - drag.w0.y }, sx, sy); return; }
    if (drag && drag.kind === 'window') {
      if (Math.abs(sx - drag.sx) > MOVE_PX || Math.abs(sy - drag.sy) > MOVE_PX) drag.moved = true;
      const win = selectionWindow(drag.w0, w, drag.sx, sx);
      st.band = { kind: 'window', x0: drag.sx, y0: drag.sy, x1: sx, y1: sy, crossing: win.crossing };
    } else {
      bandForPrompt(p);
    }
    const g = !drag && !app.runner.waiting() ? gripAt(sx, sy) : null;
    st.hoverGrip = g ? g.key : null;
    st.hover = g || drag ? null : objectAt(w);
    app.request('cursor');
  }

  function bandForPrompt(p) {
    const spec = app.runner.waiting();
    if (!spec || !spec.base || !spec.band) { st.band = null; return; }
    const b = { x: cam.sx(spec.base.x), y: cam.sy(spec.base.y) };
    if (spec.band === 'window') st.band = { kind: 'window', x0: b.x, y0: b.y, x1: st.cursor.sx, y1: st.cursor.sy, crossing: false };
    else st.band = { kind: 'line', x0: b.x, y0: b.y, x1: st.cursor.sx, y1: st.cursor.sy, label: spec.band === 'bearing' ? `Bearing ${app.bearingTo(p).toFixed(2)} degrees` : `${Math.hypot(p.x - spec.base.x, p.y - spec.base.y).toFixed(2)} ft` };
  }

  function down(e) {
    closeMenu();
    canvas.focus({ preventScroll: true });
    if (document.activeElement && document.activeElement !== canvas && document.activeElement.blur && !app.dyn.isOpen()) document.activeElement.blur();
    const { sx, sy } = local(e);
    const w = cam.toWorld(sx, sy);
    if (e.button === 1) {
      e.preventDefault();
      const now = performance.now();
      if (now - lastMiddle < DBL_MS) { lastMiddle = 0; app.zoomExtents(); return; }
      lastMiddle = now;
      drag = { kind: 'pan', sx, sy };
      canvas.setPointerCapture(e.pointerId);
      app.request('view');
      return;
    }
    if (e.button !== 0) return;
    if (st.panMode) { drag = { kind: 'pan', sx, sy }; canvas.setPointerCapture(e.pointerId); return; }
    if (drag && drag.kind === 'grip' && !drag.held) { commitDrag(); return; }
    const spec = app.runner.waiting();
    if (spec && spec.type === 'point') { const { p, snap } = snapped(w, sx, sy); app.runner.pick(p, snap ? `${snap.kind === 'center' ? 'centre' : snap.kind} point` : undefined); st.band = null; return; }
    if (spec && spec.type === 'leg') {
      const key = objectAt(w);
      const id = legIdOf(key);
      if (id) app.runner.pickLeg(id, (app.round().legs.find((l) => l.id === id) || {}).name);
      else app.echo('That is not a leg. Click on a leg\'s curb, splitter island or centre line.', 'error');
      return;
    }
    if (drag && drag.kind === 'window') { finishWindow(w, sx, e.shiftKey); return; }
    const g = gripAt(sx, sy);
    if (g) { startDrag(g, e); return; }
    const key = objectAt(w);
    if (key) {
      app.select(e.shiftKey ? app.store.get().selection.filter((k) => k !== key) : [...new Set([...app.store.get().selection, key])]);
      return;
    }
    if (e.shiftKey && !app.store.get().selection.length) return;
    drag = { kind: 'window', sx, sy, w0: w, moved: false, shift: e.shiftKey };
    canvas.setPointerCapture(e.pointerId);
  }

  function up(e) {
    const { sx, sy } = local(e);
    if (!drag) return;
    if (drag.kind === 'pan') { drag = null; app.request('view'); app.saveView(); return; }
    if (drag.kind === 'window' && drag.moved) { finishWindow(cam.toWorld(sx, sy), sx, drag.shift || e.shiftKey); return; }
    if (drag.kind === 'grip' && drag.held) {
      if (drag.moved) commitDrag();
      else { drag.held = false; app.echo(`** ${drag.word} ** Move the cursor and click to place, or type a value. Esc puts it back.`, 'prompt'); }
    }
  }

  function finishWindow(w1, sx1, shift) {
    const d = drag;
    drag = null;
    st.band = null;
    const ix = index();
    if (!ix) return;
    const win = selectionWindow(d.w0, w1, d.sx, sx1);
    const keys = windowSelect(ix.items, win.box, win.crossing);
    const cur = app.store.get().selection;
    app.select(shift ? cur.filter((k) => !keys.includes(k)) : [...new Set([...cur, ...keys])]);
  }

  // ---------------------------------------------------------------- grips

  function startDrag(g, e) {
    const s = app.store.get();
    const round = app.round();
    const result = app.frameInfo().shown;   // the shape on screen (the last one built while the current one cannot be)
    const leg = g.leg ? round.legs.find((l) => l.id === g.leg.id) : null;
    const ctx = { round, leg, result, rules: s.project.rules };
    const paths = gripPaths(g.grip, leg);
    const params = paths.map((p) => paramFor(p));
    drag = {
      kind: 'grip', grip: g.grip, key: g.key, leg, round, ctx, paths, params, held: true, moved: false,
      start: g.grip.start ? g.grip.start(ctx) : null, sx: local(e).sx, sy: local(e).sy,
      g0: { x: g.x, y: g.y }, w0: cam.toWorld(local(e).sx, local(e).sy),
      values: paths.map((p) => readPath(round, p)), word: g.grip.id === 'center' ? 'MOVE' : 'STRETCH',
    };
    st.hotGrip = g.key;
    canvas.setPointerCapture(e.pointerId);
    if (s.toggles.dyn) {
      app.dyn.open({
        fields: params.map((p, i) => ({ label: p.label, unit: p.unit, text: drag.values[i].toFixed(2) })),
        onEnter: (vals) => { if (drag && drag.kind === 'grip') { drag.values = vals.map((v, i) => clampTo(drag.params[i], v)); applyDraft(); commitDrag(); } },
      });
    }
    app.cmdPrompt(`** ${drag.word} ** Specify ${params.map((p) => p.label.toLowerCase()).join(' and ')}, or type it`);
    app.request('drag');
  }

  function readPath(round, path) {
    if (path.startsWith('center.')) return round.center[path.slice(7)];
    const m = /^legs\.([^.]+)\.([A-Za-z]+)$/.exec(path);
    if (m) return round.legs.find((l) => l.id === m[1])[m[2]];
    return round[path];
  }

  function clampTo(p, v) {
    const step = p.step || 0.01;
    const r = Math.round(v / step) * step;
    return Math.max(p.min, Math.min(p.max, Math.round(r * 1e6) / 1e6));
  }

  function dragTo(P, sx, sy) {
    if (Math.abs(sx - drag.sx) > 2 || Math.abs(sy - drag.sy) > 2) drag.moved = true;
    if (!drag.moved) return;
    let raw = drag.grip.value(drag.ctx, P, drag.start);
    if (!Array.isArray(raw)) raw = [raw];
    if (drag.grip.angle) raw = raw.map((b) => app.polarSnap(b));
    drag.values = raw.map((v, i) => (drag.params[i].path.startsWith('center.') ? Math.round(v * 100) / 100 : clampTo(drag.params[i], v)));
    applyDraft();
  }

  function applyDraft() {
    let r = drag.round;
    drag.paths.forEach((p, i) => { r = setAt(r, p, drag.values[i]) || r; });
    app.setDraft(r);
  }

  function commitDrag() {
    const d = drag;
    drag = null;
    st.hotGrip = null;
    app.dyn.close();
    app.cmdPrompt(null);
    const changed = d.paths.some((p, i) => Math.abs(readPath(d.round, p) - d.values[i]) > 1e-9);
    if (!changed) { app.setDraft(null); return; }
    const opt = app.option().id;
    const res = app.change(d.paths.map((p, i) => app.op.set(opt, p, d.values[i])));
    app.setDraft(null);
    if (res && !res.ok) app.echo(res.error, 'error');
    else if (res && res.summary) app.echo(`** ${d.word} ** ${res.summary}`, 'done');
  }

  function cancelDrag() {
    if (!drag) return false;
    const was = drag.kind;
    drag = null;
    st.hotGrip = null;
    st.band = null;
    if (was === 'grip') { app.dyn.close(); app.cmdPrompt(null); app.setDraft(null); app.echo('*Cancel*', 'cancel'); }
    app.request('drag');
    return true;
  }

  // ---------------------------------------------------------------- menu

  function contextMenu(e) {
    e.preventDefault();
    if (drag && drag.kind === 'grip') { cancelDrag(); return; }
    const spec = app.runner.waiting();
    const items = [];
    if (spec) {
      items.push({ label: 'Enter', run: () => app.runner.answer('') });
      items.push({ label: 'Cancel', run: () => app.escape() });
      if (spec.keywords && spec.keywords.length) {
        items.push({ sep: true });
        for (const k of spec.keywords) items.push({ label: k, run: () => app.runner.answer(k) });
      }
      const recent = app.runner.recent();
      if (recent.length) items.push({ sep: true }, { label: 'Recent input', sub: recent.map((r) => ({ label: r, run: () => app.runner.submit(r) })) });
    } else {
      const last = app.runner.last();
      if (last) items.push({ label: `Repeat ${last}`, run: () => app.runCommand(last) });
      const recent = app.cmdline.recentCommands();
      if (recent.length) items.push({ label: 'Recent input', sub: recent.map((r) => ({ label: r, run: () => app.runCommand(r) })) });
      items.push({ sep: true });
      const sel = app.store.get().selection;
      const when = new Set(['any']);
      if (sel.includes('round')) when.add('round');
      if (sel.some((k) => k.startsWith('leg:'))) when.add('leg');
      const scoped = app.commands.filter((c) => c.menu && when.has(c.menu.when) && c.menu.when !== 'any');
      const general = app.commands.filter((c) => c.menu && c.menu.when === 'any');
      for (const c of scoped) items.push({ label: c.menu.label, hint: c.name, run: () => app.runCommand(c.name, c.menu.args || []) });
      if (scoped.length) items.push({ sep: true });
      for (const c of general) items.push({ label: c.menu.label, hint: c.name, run: () => app.runCommand(c.name, c.menu.args || []) });
      if (sel.length) items.push({ sep: true }, { label: 'Deselect all', hint: 'Esc', run: () => app.select([]) });
    }
    openMenu(items, e.clientX, e.clientY, { className: 'ctx' });
  }

  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointerleave', () => { if (st.cursor) st.cursor.visible = false; st.hover = null; app.request('cursor'); });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const { sx, sy } = local(e);
    cam.zoomAt(sx, sy, wheelFactor(e.deltaY, e.deltaMode));
    if (st.cursor) Object.assign(st.cursor, cam.toWorld(sx, sy));
    app.request('view');
    app.saveViewSoon();
  }, { passive: false });
  canvas.addEventListener('contextmenu', contextMenu);
  canvas.addEventListener('dblclick', (e) => {
    const key = objectAt(cam.toWorld(local(e).sx, local(e).sy));
    if (key) { app.select([key]); app.ui.properties.open(); }
  });
  canvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

  return {
    state: () => st,
    dragging: () => !!(drag && drag.kind === 'grip'),
    dragInfo: () => (drag && drag.kind === 'grip' ? { values: drag.values, word: drag.word } : null),
    cancelDrag,
    panMode(on) { st.panMode = on; canvas.classList.toggle('hand', on); if (st.cursor) st.cursor.mode = on ? 'hand' : null; app.request('cursor'); },
    cursorMode() { const spec = app.runner.waiting(); return st.panMode ? 'hand' : spec && spec.type === 'point' ? 'point' : 'pick'; },
  };
}
