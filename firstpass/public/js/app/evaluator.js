// evaluate() with a small cache and a stopwatch: the same roundabout and rules give the same answer without working it
// out again (the Compare window asks for every option on every change), and each real run is timed for Check myself
// and the frame meter. Keyed by the roundabout's JSON text, so a copy of the same drawing is a cache hit too.
// While a grip is dragged the page asks a worker instead (app/eval-worker.js): ask() sends the newest shape, at most
// one at a time, and onReady() fires when its answer is in the cache, so the main thread only draws.
//   const ev = createEvaluator(evaluate, { worker, onReady });  ev.run(round, rules) -> result;  ev.peek(...);  ev.ask(...)
export function createEvaluator(evaluate, { size = 24, now = () => performance.now(), worker = null, onReady = () => {} } = {}) {
  const cache = new Map();
  const times = [], workerTimes = [];
  let busy = null, next = null;
  const keyOf = (round, rules) => JSON.stringify(round) + '|' + JSON.stringify(rules || {});
  const keep = (list, v) => { list.push(v); if (list.length > 400) list.splice(0, list.length - 400); };
  const put = (key, res) => {
    cache.set(key, res);
    if (cache.size > size) cache.delete(cache.keys().next().value);
  };
  const hit = (key) => {
    const res = cache.get(key);
    if (res) { cache.delete(key); cache.set(key, res); }
    return res || null;
  };

  function send(job) {
    busy = job;
    try { worker.postMessage({ id: job.key, round: job.round, rules: job.rules || {} }); } catch { stopWorker(); }
  }
  function stopWorker() {
    if (worker) try { worker.terminate(); } catch { /* gone already */ }
    worker = null; busy = null; next = null;
  }
  if (worker) {
    worker.onmessage = (e) => {
      const { id, result, ms, error } = e.data || {};
      if (!error && result && id !== 'warm') { put(id, result); keep(workerTimes, ms); ev.workerMs = ms; }
      busy = null;
      if (next) { const j = next; next = null; if (!cache.has(j.key)) send(j); }
      onReady();
    };
    worker.onerror = () => { stopWorker(); onReady(); };
  }

  const ev = {
    lastMs: 0,
    workerMs: 0,
    total: 0,      // every main-thread run's ms added up, so a frame can tell how long the work since the last one took
    times,
    workerTimes,
    /** The answer now, worked out here if it is not in the cache. */
    run(round, rules) {
      if (!round) return null;
      const key = keyOf(round, rules);
      const got = hit(key);
      if (got) return got;
      const t0 = now();
      const res = evaluate(round, rules || {});
      ev.lastMs = now() - t0;
      ev.total += ev.lastMs;
      keep(times, ev.lastMs);
      put(key, res);
      return res;
    },
    /** The answer if it is already known, or null. */
    peek(round, rules) { return round ? hit(keyOf(round, rules)) : null; },
    /** Asks the worker for this shape (the newest ask wins); without a worker it is worked out here at once. */
    ask(round, rules) {
      if (!round) return;
      const key = keyOf(round, rules);
      if (cache.has(key)) return;
      if (!worker) { ev.run(round, rules); return; }
      const job = { key, round, rules };
      if (busy) { if (busy.key !== key) next = job; return; }
      send(job);
    },
    /** Gives the worker a first shape to work out, so its first answer during a drag is not a cold start. */
    warm(round, rules) { if (worker && !busy && round) send({ key: 'warm', round, rules }); },
    /** True while the worker can take asks. */
    async: () => !!worker,
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
