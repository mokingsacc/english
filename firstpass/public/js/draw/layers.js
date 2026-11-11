// The drawing's one face: createLayers(canvas, { onFrame }) -> { resize, request, draw(scene, camera), stats, destroy }.
// Phase 1 fills it with Canvas 2D; a WebGL drawer can replace this file behind the same face (docs/design.md).
// The canvas is sized for the screen's pixel ratio. request() asks for one animation frame (many requests in one frame
// are one frame); in it onFrame(now) runs, which works out the scene and calls draw(). There is no idle loop: nothing
// is drawn until something asks. The model (photo, grid, roundabout, paths, labels) is kept in a second bitmap and
// only painted again when the scene's modelVersion or the camera changes; the cursor, grips and windows go on top each
// frame. A new pass: paint it in paintModel (changes with the drawing) or paintOverlay (changes with the mouse).

import { MODEL_BG } from './colors.js';
import { paintModel, paintLegend } from './paint-model.js';
import { paintOverlay, paintGrid } from './paint-overlay.js';

export function createLayers(canvas, { onFrame = null, maxDpr = 3 } = {}) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const model = document.createElement('canvas');
  const mctx = model.getContext('2d', { alpha: false });
  let w = 1, h = 1, dpr = 1, needSize = true, raf = 0, alive = true;
  let last = { scene: null, camera: null }, modelKey = '';
  const stats = { frames: 0, modelPaints: 0, lastDrawMs: 0, lastModelMs: 0, draws: [] };

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { needSize = true; api.request(); }) : null;
  if (ro) ro.observe(canvas);

  function size(camera) {
    needSize = false;
    const r = canvas.getBoundingClientRect();
    const nw = Math.max(1, Math.round(r.width)), nh = Math.max(1, Math.round(r.height));
    const nd = Math.min(maxDpr, Math.max(1, globalThis.devicePixelRatio || 1));
    if (nw !== w || nh !== h || nd !== dpr || canvas.width !== Math.round(nw * nd)) {
      w = nw; h = nh; dpr = nd;
      canvas.width = model.width = Math.round(w * dpr);
      canvas.height = model.height = Math.round(h * dpr);
      modelKey = '';
    }
    if (camera) camera.resize(w, h);
  }

  function frame(now) {
    raf = 0;
    if (!alive) return;
    stats.frames++;
    if (onFrame) onFrame(now);
    else if (last.scene) api.draw(last.scene, last.camera);
  }

  const api = {
    /** Read the canvas size again at the next frame (the window or a palette changed size). */
    resize() { needSize = true; api.request(); },
    request() { if (alive && !raf) raf = requestAnimationFrame(frame); },
    /** The size in CSS px, read again now if it may have changed. */
    size(camera) { if (needSize || (globalThis.devicePixelRatio || 1) !== dpr) size(camera); return { w, h, dpr }; },
    draw(scene, camera) {
      const t0 = performance.now();
      if (needSize || Math.min(maxDpr, globalThis.devicePixelRatio || 1) !== dpr) size(camera);
      else camera.resize(w, h);
      last = { scene, camera };
      scene.dpr = dpr;
      const key = `${scene.modelVersion}|${camera.version}|${w}x${h}@${dpr}`;
      if (key !== modelKey) {
        const m0 = performance.now();
        mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        mctx.fillStyle = MODEL_BG;
        mctx.fillRect(0, 0, w, h);
        if (scene.underlay) scene.underlay.paint(mctx, camera, dpr);
        paintGrid(mctx, camera, scene);
        paintModel(mctx, camera, scene);
        paintLegend(mctx, camera, scene);
        modelKey = key;
        stats.modelPaints++;
        stats.lastModelMs = performance.now() - m0;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(model, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintOverlay(ctx, camera, scene);
      stats.lastDrawMs = performance.now() - t0;
      stats.draws.push(stats.lastDrawMs);
      if (stats.draws.length > 300) stats.draws.splice(0, stats.draws.length - 300);
      // Photo tiles still fading in ask for another frame until they are fully drawn.
      if (scene.underlay && scene.underlay.busy()) { modelKey = ''; api.request(); }
    },
    stats,
    /** Paints the last scene again from scratch n times (after a few to warm up) and gives each time in ms, for Check myself. */
    bench(n = 15) {
      if (!last.scene) return [];
      const out = [];
      for (let i = 0; i < n + 3; i++) { modelKey = ''; api.draw(last.scene, last.camera); if (i >= 3) out.push(stats.lastDrawMs); }
      return out;
    },
    destroy() {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
    },
  };
  return api;
}
