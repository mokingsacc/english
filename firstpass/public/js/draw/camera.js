// The drawing's camera: world (state plane feet, y north) to screen (CSS px, y down) and back, zoom about a point, pan,
// fit to a box. Pure maths, no DOM, so tests/page/camera.test.mjs can check it. Coordinates are worked in doubles here
// and only small screen numbers reach the canvas (state plane numbers near 6.6 million lose the inch in float32).
//
//   const cam = createCamera();  cam.resize(w, h);  cam.fit(box);  cam.zoomAt(sx, sy, factor);  cam.panBy(dx, dy)
//   cam.toScreen(x, y) -> {x, y}   cam.toWorld(sx, sy) -> {x, y}   cam.k (px per ft)   cam.save() / cam.restore(v)
// To add a view operation, add a method that changes cx, cy or k, then call bump() so the drawing knows it changed.

export const MIN_K = 0.002;   // px per ft: about 100 miles across a laptop screen
export const MAX_K = 400;     // px per ft: a few inches across

export function createCamera({ cx = 0, cy = 0, k = 2, w = 800, h = 600 } = {}) {
  const cam = {
    cx, cy, k, w, h,
    version: 0,
    resize(nw, nh) {
      if (nw === cam.w && nh === cam.h) return false;
      cam.w = Math.max(1, nw); cam.h = Math.max(1, nh);
      bump();
      return true;
    },
    toScreen(x, y) {
      return { x: (x - cam.cx) * cam.k + cam.w / 2, y: cam.h / 2 - (y - cam.cy) * cam.k };
    },
    sx(x) { return (x - cam.cx) * cam.k + cam.w / 2; },
    sy(y) { return cam.h / 2 - (y - cam.cy) * cam.k; },
    toWorld(sx, sy) {
      return { x: cam.cx + (sx - cam.w / 2) / cam.k, y: cam.cy - (sy - cam.h / 2) / cam.k };
    },
    /** Zoom by factor (above 1 zooms in) keeping the world point under (sx, sy) where it is. */
    zoomAt(sx, sy, factor) {
      const before = cam.toWorld(sx, sy);
      const nk = clamp(cam.k * factor, MIN_K, MAX_K);
      if (nk === cam.k) return false;
      cam.k = nk;
      cam.cx = before.x - (sx - cam.w / 2) / nk;
      cam.cy = before.y + (sy - cam.h / 2) / nk;
      bump();
      return true;
    },
    /** Move the drawing by (dx, dy) screen pixels, as a hand drag does. */
    panBy(dx, dy) {
      if (!dx && !dy) return false;
      cam.cx -= dx / cam.k;
      cam.cy += dy / cam.k;
      bump();
      return true;
    },
    /** Show a world box {x0, y0, x1, y1} as large as fits with `pad` px each side. */
    fit(box, pad = 24) {
      if (!box || !Number.isFinite(box.x0) || !Number.isFinite(box.x1)) return false;
      const bw = Math.max(1e-3, box.x1 - box.x0), bh = Math.max(1e-3, box.y1 - box.y0);
      const aw = Math.max(1, cam.w - 2 * pad), ah = Math.max(1, cam.h - 2 * pad);
      cam.k = clamp(Math.min(aw / bw, ah / bh), MIN_K, MAX_K);
      cam.cx = (box.x0 + box.x1) / 2;
      cam.cy = (box.y0 + box.y1) / 2;
      bump();
      return true;
    },
    /** The world box the screen shows. */
    visible() {
      const a = cam.toWorld(0, cam.h), b = cam.toWorld(cam.w, 0);
      return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
    },
    save() { return { cx: cam.cx, cy: cam.cy, k: cam.k }; },
    restore(v) {
      if (!v || !Number.isFinite(v.cx) || !Number.isFinite(v.cy) || !(v.k > 0)) return false;
      cam.cx = v.cx; cam.cy = v.cy; cam.k = clamp(v.k, MIN_K, MAX_K);
      bump();
      return true;
    },
  };
  function bump() { cam.version++; }
  return cam;
}

/** A world box around a list of points, or null when there are none. */
export function boxOf(points, grow = 0) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  if (x0 === Infinity) return null;
  return { x0: x0 - grow, y0: y0 - grow, x1: x1 + grow, y1: y1 + grow };
}

/** The wheel's zoom factor for one event: a notch of a mouse wheel (deltaY 100) zooms by about 1.25. */
export function wheelFactor(deltaY, deltaMode = 0) {
  const px = deltaMode === 1 ? deltaY * 33 : deltaMode === 2 ? deltaY * 400 : deltaY;
  return Math.exp(-clamp(px, -600, 600) * 0.00223);
}

/** A trackpad pinch's zoom factor for one event (the wheel with Ctrl, in small pixel steps): the browser gives
 * deltaY as 100 times the log of the pinch's scale, so this follows the fingers. */
export function pinchFactor(deltaY) {
  return Math.exp(-clamp(deltaY, -50, 50) * 0.01);
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
