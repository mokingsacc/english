// The drawing area's mouse, trackpad and touch, as in the CAD original: a mouse wheel zooms about the cursor; a middle
// drag pans, and so does a left drag with Space held; a double middle click zooms to extents; a click selects (Shift
// click takes away); dragging or clicking out a window selects, left to right a window (inside only), right to left a
// crossing (anything it touches); square grips on the selection edit live when dragged (or clicked, moved and clicked
// again), with the value in a dynamic input box by the cursor, and commit one change on release; right click opens the
// shortcut menu; a running command takes picked points and legs. The cursor is the crosshair with its pick box, drawn by
// the canvas.
// A trackpad: a pinch (the wheel with Ctrl) zooms at a comfortable rate and two fingers pan. Which is a mouse wheel and
// which a trackpad is told from the events (wheelKind); Settings, Scrolling on the drawing (Auto, Zoom, Pan), decides
// when the guess is wrong. Touch: one finger taps, drags a grip or drags out a window; two fingers pinch-zoom and pan and
// never select; hit boxes are larger for a finger; a cancelled touch puts a grip back.
import { nearest, selectionWindow, windowSelect } from '../draw/hit.js';
import { wheelFactor, pinchFactor } from '../draw/camera.js';
import { GRIP } from '../draw/colors.js';
import { paramFor, setAt } from '../engine/index.js';
import { gripPaths } from '../app/grips/index.js';
import { indexOf, legIdOf } from '../app/model-index.js';
import { prefs } from '../app/prefs.js';
import { openMenu, closeMenu } from './menu.js';

const PICK_PX = 5, MOVE_PX = 4, DBL_MS = 420;
const TOUCH_PICK_PX = 14, TOUCH_GRIP_PX = 14, TOUCH_SLOP = 8;   // a finger is larger and less steady than a mouse
const GESTURE_MS = 250;                                       // wheel events closer than this are one gesture
const BUILT = { entryRadius: 'entryRadiusBuilt', exitRadius: 'exitRadiusBuilt' };   // radii stored as built at the end of a drag
const RADII = [['entryRadiusBuilt', 'entry curb radius'], ['exitRadiusBuilt', 'exit curb radius']];

/**
 * A mouse wheel or a trackpad, from one wheel event: 'zoom' for a wheel (steps in lines or pages, or steps of about 100 px
 * or more with no sideways part), 'pan' for a trackpad's two fingers (small pixel steps, often sideways). Events less than
 * GESTURE_MS apart keep the kind the gesture started with, so a trackpad's quick flick is not taken for a wheel half way.
 * memo is { kind, at } kept between events.
 */
export function wheelKind(e, memo, now) {
  if (memo.kind && now - memo.at < GESTURE_MS) { memo.at = now; return memo.kind; }
  const wheel = e.deltaMode !== 0 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 60);
  memo.kind = wheel ? 'zoom' : 'pan';
  memo.at = now;
  return memo.kind;
}

/** The leg's name for a sentence: "the West leg", "the North leg". */
const legName = (name) => (/\bleg$/i.test(name) ? `The ${name}` : `The ${name} leg`);

export function createViewport(app, canvas) {
  const cam = app.camera;
  const st = { cursor: null, hover: null, hoverGrip: null, hotGrip: null, band: null, panMode: false };
  let drag = null;        // { kind: 'pan' | 'window' | 'grip', ... }
  let lastMiddle = 0;
  let touchy = false;     // the last pointer put down was a finger
  const touches = new Map();          // fingers on the drawing: pointerId to { sx, sy }
  let pending = null;                 // one finger down, not yet a tap or a drag: { ev, sx, sy }
  let pinch = null;                   // two fingers: { d, mx, my } at the last move
  let afterPinch = false;             // the fingers of a pinch: nothing else until all are up
  const wheelMemo = { kind: null, at: 0 };
  const space = { held: false, used: false };

  const local = (e) => { const r = canvas.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; };
  const tol = () => (touchy ? TOUCH_PICK_PX : PICK_PX) / cam.k;
  const index = () => indexOf(app.frameInfo().shown);
  const capture = (id) => { try { canvas.setPointerCapture(id); } catch { /* the pointer is already up */ } };

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
    const h = GRIP.size / 2 + (touchy ? TOUCH_GRIP_PX : 3);
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

  function down(e, { tap = false } = {}) {
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
      capture(e.pointerId);
      app.request('view');
      return;
    }
    if (e.button !== 0) return;
    if (space.held) { space.used = true; drag = { kind: 'pan', sx, sy }; capture(e.pointerId); return; }
    if (st.panMode) { drag = { kind: 'pan', sx, sy }; capture(e.pointerId); return; }
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
    if (tap) return;   // a finger's tap on nothing starts no window (a finger drags one out instead)
    drag = { kind: 'window', sx, sy, w0: w, moved: false, shift: e.shiftKey };
    capture(e.pointerId);
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
    // k: the screen's px per ft, so a grip whose shape moves slowly under the hand can be geared to the screen (frame.js).
    const ctx = { round, leg, result, rules: s.project.rules, k: cam.k };
    const paths = gripPaths(g.grip, leg);
    const params = paths.map((p) => paramFor(p));
    drag = {
      kind: 'grip', grip: g.grip, key: g.key, leg, round, ctx, paths, params, held: true, moved: false,
      built: paths.map((p) => builtOf(p)),
      start: g.grip.start ? g.grip.start(ctx) : null, sx: local(e).sx, sy: local(e).sy,
      g0: { x: g.x, y: g.y }, w0: cam.toWorld(local(e).sx, local(e).sy),
      values: paths.map((p) => readPath(round, p)), word: g.grip.id === 'center' ? 'MOVE' : 'STRETCH',
    };
    st.hotGrip = g.key;
    capture(e.pointerId);
    if (s.toggles.dyn) {
      app.dyn.open({
        fields: params.map((p, i) => ({ label: p.label, unit: p.unit, text: drag.values[i].toFixed(2) })),
        onEnter: (vals) => { if (drag && drag.kind === 'grip') { drag.values = vals.map((v, i) => clampTo(drag.params[i], v)); applyDraft(); commitDrag(); } },
      });
    }
    app.cmdPrompt(`** ${drag.word} ** Specify ${params.map((p) => p.label.toLowerCase()).join(' and ')}, or type it`);
    app.request('drag');
  }

  /** For a radius path ('legs.N.entryRadius'): the leg and the built field the engine reports for it; else null. */
  function builtOf(path) {
    const m = /^legs\.([^.]+)\.([A-Za-z]+)$/.exec(path);
    return m && BUILT[m[2]] ? { leg: m[1], field: BUILT[m[2]] } : null;
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
    const rules = (app.store.get().project || {}).rules;
    // A radius is stored as it is built, so the drawing, the box and the checks all read one number. Where the curve
    // could not be built as large as the hand asked, the engine shrank it and the next leg's curve in that corner by
    // one factor until they met on the circle (derive.js fitCorner); both built values are stored, rounded down to a
    // whole step, so on release the stored and the built radii agree and the drawing stays as it was under the hand.
    let sets = d.paths.map((p, i) => [p, d.values[i]]);
    let after = d.built.some(Boolean) ? app.evaluator.run(roundWith(d.round, sets), rules) : null;
    if (after && after.ok) sets = asBuilt(d, sets, after);
    const changed = sets.some(([p, v]) => Math.abs(readPath(d.round, p) - v) > 1e-9);
    if (!changed) { app.setDraft(null); return; }
    const opt = app.option().id;
    const res = app.change(sets.map(([p, v]) => app.op.set(opt, p, v)));
    app.setDraft(null);
    if (res && !res.ok) { app.echo(res.error, 'error'); return; }
    if (res && res.summary) app.echo(`** ${d.word} ** ${res.summary}`, 'done');
    if (res && res.ok && !res.nothing) {
      after = app.evaluator.run(roundWith(d.round, sets), rules);
      for (const line of otherRadii(d, d.ctx.result, after)) app.echo(line, 'note');
    }
  }

  /** The values to store: each curb radius built smaller than asked as built, the dragged ones and any the drag shrank. */
  function asBuilt(d, sets, after) {
    const before = d.ctx.result && d.ctx.result.ok ? d.ctx.result : null;
    const draft = roundWith(d.round, sets);
    const out = sets.map((s) => s.slice());
    for (const L of after.geometry.legs) {
      for (const [field, builtField] of Object.entries(BUILT)) {
        const path = `legs.${L.id}.${field}`;
        const v = L[builtField];
        const i = out.findIndex(([p]) => p === path);
        const asked = i >= 0 ? out[i][1] : readPath(draft, path);
        if (!Number.isFinite(v) || !(asked - v > 0.005)) continue;   // built as asked
        if (i >= 0) { out[i][1] = floorTo(paramFor(path), v); continue; }
        const B = before && before.geometry.legs.find((l) => l.id === L.id);
        if (B && Math.abs(B[builtField] - v) > 0.005) out.push([path, floorTo(paramFor(path), v)]);   // this drag shrank it
      }
    }
    return out;
  }

  function floorTo(p, v) {
    const step = (p && p.step) || 0.01;
    const r = Math.round(Math.floor(v / step + 1e-9) * step * 1e6) / 1e6;
    return p ? Math.max(p.min, Math.min(p.max, r)) : r;
  }

  function roundWith(round, sets) {
    let r = round;
    for (const [p, v] of sets) r = setAt(r, p, v) || r;
    return r;
  }

  /** One line for each curb radius of another leg (or the other curve of this leg) that the drag changed by over 1 ft. */
  function otherRadii(d, before, after) {
    if (!before || !before.ok || !after || !after.ok) return [];
    const mine = new Set(d.built.filter(Boolean).map((b) => `${b.leg}:${b.field}`));
    const out = [];
    for (const L of after.geometry.legs) {
      const B = before.geometry.legs.find((l) => l.id === L.id);
      if (!B) continue;
      for (const [field, words] of RADII) {
        if (mine.has(`${L.id}:${field}`)) continue;
        const a = B[field], b = L[field];
        if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > 1) {
          out.push(`${legName(L.name)}'s ${words} is now built at ${b.toFixed(2)} ft, ${b < a ? 'down' : 'up'} from ${a.toFixed(2)} ft.`);
        }
      }
    }
    return out;
  }

  function cancelDrag(quiet = false) {
    if (!drag) return false;
    const was = drag.kind;
    drag = null;
    st.hotGrip = null;
    st.band = null;
    if (was === 'grip') { app.dyn.close(); app.cmdPrompt(null); app.setDraft(null); if (!quiet) app.echo('*Cancel*', 'cancel'); }
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

  // ---------------------------------------------------------------- touch: one finger acts, two fingers move the view

  const snap = (e) => ({ button: 0, shiftKey: false, pointerId: e.pointerId, pointerType: e.pointerType, clientX: e.clientX, clientY: e.clientY, preventDefault() {} });

  function onDown(e) {
    touchy = e.pointerType === 'touch';
    if (!touchy) { down(e); return; }
    e.preventDefault();
    touches.set(e.pointerId, local(e));
    if (touches.size === 1 && !afterPinch) { const p = local(e); pending = { ev: snap(e), sx: p.sx, sy: p.sy }; return; }
    if (touches.size === 2) startPinch();
  }

  function startPinch() {
    pending = null;
    // Whatever the first finger began stops: a window goes, a grip goes back as it was.
    if (drag) { if (drag.kind === 'grip') cancelDrag(true); else { drag = null; st.band = null; } }
    const [a, b] = [...touches.values()];
    pinch = { d: Math.hypot(a.sx - b.sx, a.sy - b.sy) || 1, mx: (a.sx + b.sx) / 2, my: (a.sy + b.sy) / 2 };
    afterPinch = true;
    if (st.cursor) st.cursor.visible = false;
    app.request('cursor');
  }

  function onMove(e) {
    if (e.pointerType !== 'touch') { move(e); return; }
    if (!touches.has(e.pointerId)) return;
    const p = local(e);
    touches.set(e.pointerId, p);
    if (pinch) {
      if (touches.size < 2) return;
      const [a, b] = [...touches.values()];
      const d = Math.hypot(a.sx - b.sx, a.sy - b.sy) || 1, mx = (a.sx + b.sx) / 2, my = (a.sy + b.sy) / 2;
      cam.panBy(mx - pinch.mx, my - pinch.my);
      cam.zoomAt(mx, my, d / pinch.d);
      pinch = { d, mx, my };
      app.request('view');
      app.saveViewSoon();
      return;
    }
    if (afterPinch) return;
    if (pending) {
      if (Math.hypot(p.sx - pending.sx, p.sy - pending.sy) < TOUCH_SLOP) return;
      const ev = pending.ev;
      pending = null;
      move(ev);
      down(ev);   // the finger's first place: a grip, a leg, or the start of a window
    }
    move(e);
  }

  function onUp(e) {
    if (e.pointerType !== 'touch') { up(e); return; }
    touches.delete(e.pointerId);
    if (afterPinch) {
      if (touches.size < 2 && pinch) { pinch = null; app.saveView(); }
      if (!touches.size) afterPinch = false;
      return;
    }
    if (pending) {   // a tap: as a click where the finger was
      const ev = pending.ev;
      pending = null;
      move(ev);
      down(ev, { tap: true });
    }
    up(e);
    if (st.cursor) st.cursor.visible = false;
    app.request('cursor');
  }

  /** The browser took the pointer away (a system gesture, a call): a grip goes back, a window or pan just ends. */
  function onCancel(e) {
    touches.delete(e.pointerId);
    if (touches.size < 2) pinch = null;
    if (!touches.size) afterPinch = false;
    pending = null;
    if (!drag) return;
    if (drag.kind === 'grip') cancelDrag();
    else { drag = null; st.band = null; app.request('drag'); }
  }

  // ---------------------------------------------------------------- wheel, trackpad and Space

  function onWheel(e) {
    e.preventDefault();
    const { sx, sy } = local(e);
    const choice = prefs.get('scroll', 'auto');
    const kind = e.ctrlKey ? 'zoom' : choice === 'zoom' ? 'zoom' : choice === 'pan' ? 'pan' : wheelKind(e, wheelMemo, e.timeStamp);
    if (kind === 'pan') {
      const f = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? cam.h : 1;
      cam.panBy(-e.deltaX * f, -e.deltaY * f);
    } else {
      // A pinch (Ctrl with small pixel steps) zooms by its own, gentler rate; a wheel's notch by about 1.25.
      const notch = e.deltaMode !== 0 || Math.abs(e.deltaY) >= 60;
      cam.zoomAt(sx, sy, notch ? wheelFactor(e.deltaY, e.deltaMode) : pinchFactor(e.deltaY));
    }
    if (st.cursor) Object.assign(st.cursor, cam.toWorld(sx, sy));
    app.request('view');
    app.saveViewSoon();
  }

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'touch') return; if (st.cursor) st.cursor.visible = false; st.hover = null; app.request('cursor'); });
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', contextMenu);
  canvas.addEventListener('dblclick', (e) => {
    const key = objectAt(cam.toWorld(local(e).sx, local(e).sy));
    if (key) { app.select([key]); app.ui.properties.open(); }
  });
  canvas.addEventListener('auxclick', (e) => { if (e.button === 1) e.preventDefault(); });

  return {
    state: () => st,
    dragging: () => !!(drag && drag.kind === 'grip'),
    dragInfo: () => (drag && drag.kind === 'grip' ? drag : null),
    cancelDrag,
    panMode(on) { st.panMode = on; canvas.classList.toggle('hand', on || space.held); if (st.cursor) st.cursor.mode = on ? 'hand' : null; app.request('cursor'); },
    cursorMode() { const spec = app.runner.waiting(); return st.panMode || space.held ? 'hand' : spec && spec.type === 'point' ? 'point' : 'pick'; },
    /** Space held: a left drag pans (keys.js). spaceUp answers whether it panned, so a plain Space still repeats. */
    spaceDown() { space.held = true; space.used = false; canvas.classList.add('hand'); app.request('cursor'); },
    spaceUp() {
      const used = space.used;
      space.held = false; space.used = false;
      canvas.classList.toggle('hand', st.panMode);
      app.request('cursor');
      return used;
    },
    spaceHeld: () => space.held,
  };
}
