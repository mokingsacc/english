// The worker that runs evaluate off the page's main thread while a grip is dragged, so the drawing keeps up with the
// mouse: it answers each { id, round, rules } with { id, result, ms } (or { id, error }). app/evaluator.js sends to it.
import { evaluate } from '../engine/index.js';

self.onmessage = (e) => {
  const { id, round, rules } = e.data || {};
  const t0 = performance.now();
  let result;
  try { result = evaluate(round, rules || {}); } catch (err) { self.postMessage({ id, error: err && err.message ? err.message : String(err) }); return; }
  self.postMessage({ id, result, ms: performance.now() - t0 });
};
