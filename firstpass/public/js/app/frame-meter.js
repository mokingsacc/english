// The frame meter (the idea of practice-hub's public/js/map/frame-meter.js): while she moves the drawing (a press, a
// drag, the wheel, a key) it times the gaps between animation frames, and the page reports how long each frame's work
// took (evaluate plus redraw). It stops half a second after the last input, so an idle page costs nothing. summary()
// gives p50, p90 and p99 in ms for Check myself and for every problem report. No server route.
//   const meter = createFrameMeter({ target });  meter.work(evalMs, drawMs);  meter.summary()
import { percentiles } from './evaluator.js';

const IDLE_MS = 500;
const MAX_GAP_MS = 1000;   // a longer gap is a hidden tab or a stall, not a frame
const KEEP = 600;

export function createFrameMeter({ target, win = globalThis, now = () => performance.now() } = {}) {
  const raf = win.requestAnimationFrame ? win.requestAnimationFrame.bind(win) : null;
  const gaps = [], evals = [], draws = [], works = [];
  let running = 0, last = 0, lastInput = 0;
  const push = (list, v) => { list.push(v); if (list.length > KEEP) list.splice(0, list.length - KEEP); };

  const tick = (t) => {
    running = 0;
    if (last) {
      const d = t - last;
      if (d > 0 && d < MAX_GAP_MS) push(gaps, d);
    }
    if (now() - lastInput > IDLE_MS) { last = 0; return; }
    last = t;
    running = raf(tick);
  };
  const poke = () => {
    if (!raf) return;
    lastInput = now();
    if (!running) { last = 0; running = raf(tick); }
  };
  const types = ['pointerdown', 'pointermove', 'wheel', 'keydown'];
  if (target) for (const t of types) target.addEventListener(t, poke, { passive: true });

  return {
    poke,
    /** One frame's work while she moves the drawing: evaluate ms (0 when nothing was worked out) and draw ms. */
    work(evalMs, drawMs) {
      if (now() - lastInput > IDLE_MS) return;
      push(evals, evalMs); push(draws, drawMs); push(works, evalMs + drawMs);
    },
    summary() {
      const r = (q) => (q ? { n: q.n, p50: round(q.p50), p90: round(q.p90), p99: round(q.p99) } : null);
      return { frames: r(percentiles(gaps)), work: r(percentiles(works)), evaluate: r(percentiles(evals)), draw: r(percentiles(draws)) };
    },
    reset() { gaps.length = evals.length = draws.length = works.length = 0; },
    stop() { if (target) for (const t of types) target.removeEventListener(t, poke); },
  };
}

const round = (v) => Math.round(v * 100) / 100;
