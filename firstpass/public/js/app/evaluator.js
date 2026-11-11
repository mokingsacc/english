// evaluate() with a small cache and a stopwatch: the same roundabout and rules give the same answer without working it
// out again (the Compare window asks for every option on every change), and each real run is timed for Check myself
// and the frame meter. Keyed by the roundabout's JSON text, so a copy of the same drawing is a cache hit too.
//   const ev = createEvaluator(evaluate);  ev.run(round, rules) -> result;  ev.lastMs;  ev.times (recent runs, ms)
export function createEvaluator(evaluate, { size = 24, now = () => performance.now() } = {}) {
  const cache = new Map();
  const times = [];
  const ev = {
    lastMs: 0,
    times,
    run(round, rules) {
      if (!round) return null;
      const key = JSON.stringify(round) + '|' + JSON.stringify(rules || {});
      const hit = cache.get(key);
      if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
      const t0 = now();
      const res = evaluate(round, rules || {});
      ev.lastMs = now() - t0;
      times.push(ev.lastMs);
      if (times.length > 400) times.splice(0, times.length - 400);
      cache.set(key, res);
      if (cache.size > size) cache.delete(cache.keys().next().value);
      return res;
    },
    clear() { cache.clear(); },
  };
  return ev;
}

/** p50, p90 and p99 of a list of numbers (ms), or null when it is empty. */
export function percentiles(list) {
  if (!list || !list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
  return { n: s.length, p50: q(0.5), p90: q(0.9), p99: q(0.99) };
}
