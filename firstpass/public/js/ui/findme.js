// "Show the roundabout": a button over the top of the drawing that appears only when the roundabout is off the screen
// or too small to see (under 24 px across), and puts it back in view as the first view frames it (app.zoomFirst).
// Mo, 11 Nov 2026: "now im lost, like i cant get back to the roundabout". ZOOM Extents still works as in a CAD program;
// this is for anyone who does not know it. update() runs every frame and touches the page only when the answer changes.
//   const findMe = createFindMe(app, viewportEl);  findMe.update(camera, index)
import { h } from './dom.js';

const TOO_SMALL_PX = 24;

/** Whether a world box is out of the camera's view or under TOO_SMALL_PX across on screen. Pure. */
export function lostFrom(cam, box) {
  if (!box) return false;
  const v = cam.visible();
  const out = box.x1 < v.x0 || box.x0 > v.x1 || box.y1 < v.y0 || box.y0 > v.y1;
  const across = Math.max(box.x1 - box.x0, box.y1 - box.y0) * cam.k;
  return out || across < TOO_SMALL_PX;
}

export function createFindMe(app, host) {
  const btn = h('button', { type: 'button', class: 'findme', hidden: true, 'data-tip': 'Show the roundabout', 'data-tip-text': 'Zooms back to the roundabout. ZOOM Extents (Z, then E) does the same with the roads around it.' }, 'Show the roundabout');
  btn.addEventListener('click', () => { app.zoomFirst(); const c = document.getElementById('canvas'); if (c) c.focus({ preventScroll: true }); });
  host.append(btn);
  let shown = false;
  return {
    update(cam, index) {
      const lost = lostFrom(cam, index && index.firstView);
      if (lost !== shown) { shown = lost; btn.hidden = !lost; }
    },
    shown: () => shown,
  };
}
