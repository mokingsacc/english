// Check myself: one plain line each, green or red with what to do when red, for the data service, the Claude connector,
// the maths engine (a self-test on the page), the DXF export, the aerial photos, and the speed measured on this
// machine. The server's lines come from GET /api/selfcheck. A new line: one function that answers { id, ok, title,
// text } and one entry in runSelfCheck.
import { evaluate, defaultRoundabout, CHECKS, speedFromRadius, stoppingSightDistance, resolveRules } from '../engine/index.js';
import { toDxf, checkDxf } from '../engine/export/dxf.js';
import { buildExport } from '../commands/export.js';
import { percentiles } from './evaluator.js';

const NO_KEY = 'This page has no key, so it works on its own and saves nothing. Open First Pass from your link (the one with #k= in it).';

/** The engine's self-test: formula values that never change, and the default roundabout built, checked and symmetric. */
export function engineSelfTest() {
  const problems = [];
  const rr = resolveRules({});
  const v100 = speedFromRadius(100, 1, rr);
  if (Math.abs(v100 - 20.37) > 0.05) problems.push(`the speed on a 100 ft curve came out ${v100.toFixed(2)} mph instead of 20.37 mph`);
  const ssd = [[25, 155], [45, 360]].filter(([v, d]) => stoppingSightDistance(v, rr) !== d);
  if (ssd.length) problems.push(`the stopping sight distance at ${ssd[0][0]} mph is not ${ssd[0][1]} ft`);
  const t0 = performance.now();
  const r = evaluate(defaultRoundabout(), {});
  const ms = performance.now() - t0;
  if (!r.ok) problems.push(`the default roundabout could not be built (${r.problems[0]})`);
  else {
    if (r.checks.length !== CHECKS.length || r.checks.some((c) => c.internalError)) problems.push('a check broke on the default roundabout');
    const v1 = r.legs.map((L) => L.V.V1).filter((v) => v !== null);
    if (v1.length !== r.legs.length || Math.max(...v1) - Math.min(...v1) > 0.5) problems.push('the four equal legs of the default roundabout gave different entry speeds');
    const again = evaluate(defaultRoundabout(), {});
    if (JSON.stringify(again.headline) !== JSON.stringify(r.headline)) problems.push('two runs on the same roundabout gave different answers');
  }
  return { ok: !problems.length, problems, ms };
}

export async function runSelfCheck(app) {
  const lines = [];
  const has = app.api.hasKey();
  const sc = has ? await app.api.selfcheck() : null;
  const server = (id) => (sc && sc.ok && sc.data ? sc.data.lines.find((l) => l.id === id) : null);
  const down = sc && sc.offline;

  // 1. The data service.
  if (!has) lines.push({ id: 'data', ok: false, title: 'Data service', text: NO_KEY });
  else if (down) lines.push({ id: 'data', ok: false, title: 'Data service', text: 'The First Pass server cannot be reached, so changes are not being saved. Check the internet connection; if it is fine, the server needs starting (npm run dev on the dev machine).' });
  else if (!sc.ok) lines.push({ id: 'data', ok: false, title: 'Data service', text: `The server answered with a problem: ${sc.error}` });
  else {
    const db = server('database'), us = server('users');
    const ok = !!(db && db.ok && (!us || us.ok));
    lines.push({ id: 'data', ok, title: 'Data service', text: ok ? `${db.text} Changes are saved as you make them.` : (db && !db.ok ? db.text : us.text) });
  }
  // 2. The connector.
  const cn = server('connector');
  lines.push(cn ? { id: 'connector', ok: cn.ok, title: 'Claude connector', text: cn.text }
    : { id: 'connector', ok: false, title: 'Claude connector', text: has ? 'Could not ask the server whether your connector link is set up. Try again when the data service answers.' : NO_KEY });
  // 3. The engine, on this page (and on the server when it answers).
  const eng = engineSelfTest();
  const se = server('engine');
  lines.push({ id: 'engine', ok: eng.ok && (!se || se.ok), title: 'Maths engine',
    text: eng.ok ? `The maths engine passes its self-test on this page (formula values, the default roundabout built and checked, the same answer twice) in ${eng.ms.toFixed(1)} ms.${se ? (se.ok ? ' The server\'s copy works too.' : ` On the server: ${se.text}`) : ''}`
      : `The maths engine failed its self-test: ${eng.problems.join('; ')}. Use Report a problem so it can be fixed.` });
  // 4. The export, built on this page (it needs no server).
  lines.push(exportLine(app));
  // 5. The aerial photo.
  const tl = server('tiles');
  const ph = app.store.get().photo;
  const pageOk = ph.state === 'on' || ph.state === 'loading';
  lines.push({ id: 'photo', ok: !!(tl && tl.ok && pageOk), title: 'Aerial photo',
    text: [tl ? tl.text : 'The photo service could not be asked (it needs the server).',
      pageOk ? 'The page places the photo under the drawing.' : `The page cannot place the photo yet: ${ph.why || 'the coordinate converter is not loaded'}. The drawing works without it.`].join(' ') });
  // 6. Speed on this machine.
  lines.push(speedLine(app));
  return lines;
}

/** The DXF export's self-test: the default roundabout's drawing built here and read back as well formed. */
export function exportSelfTest() {
  const t0 = performance.now();
  try {
    const r = evaluate(defaultRoundabout(), {});
    if (!r.ok) return { ok: false, problems: ['the default roundabout could not be built, so there was nothing to draw'], ms: 0 };
    const text = toDxf(r, { name: 'Check myself', epsg: 2226, option: { id: 'A', name: 'Option A' }, date: '2026-11-11' });
    const c = checkDxf(text);
    const problems = c.problems.map((p) => p.replace(/\.$/, '').toLowerCase());
    if (!c.counts.ARC || !c.counts.LWPOLYLINE) problems.push('the drawing came out without its arcs or outlines');
    return { ok: !problems.length, problems, counts: c.counts, bytes: text.length, ms: performance.now() - t0 };
  } catch (e) {
    return { ok: false, problems: [`writing it failed (${(e && e.message) || e})`], ms: performance.now() - t0 };
  }
}

function exportLine(app) {
  const t = exportSelfTest();
  if (!t.ok) return { id: 'export', ok: false, title: 'DXF export', text: `The DXF export failed its self-test: ${t.problems.join('; ')}. Use Report a problem so it can be fixed.` };
  const n = t.counts;
  const opt = app.option();
  const here = opt ? buildExport(app) : { ok: false, error: 'There is no option on screen.' };
  return {
    id: 'export', ok: true, title: 'DXF export',
    text: `The DXF export works on this page: the default roundabout made a well formed drawing (${n.LINE} lines, ${n.ARC} arcs, ${n.LWPOLYLINE} outlines and paths, ${n.TEXT} labels) in ${t.ms.toFixed(1)} ms.`
      + (here.ok ? ` EXPORT saves ${opt.name} as ${here.file}.` : ` ${opt ? opt.name : 'The option on screen'} cannot be saved yet: ${here.error}`),
  };
}

function speedLine(app) {
  const round = app.round();
  const rules = app.store.get().project.rules;
  for (let i = 0; i < 3; i++) evaluate(round, rules);
  const times = [];
  for (let i = 0; i < 15; i++) { const t0 = performance.now(); evaluate(round, rules); times.push(performance.now() - t0); }
  const ev = percentiles(times);
  const m = app.meter.summary();
  // A drag frame paints the whole model again, so the drawing is timed painting it from scratch, not from the quick frames
  // that only lay the cursor over a kept picture.
  const bench = app.layers.bench ? app.layers.bench(15) : [];
  const draws = percentiles(bench.length ? bench : app.layers.stats.draws.slice(-120));
  const drawMs = draws ? draws.p50 : 0;
  // With the worker, a drag frame draws the last answer while the next one is worked out beside the page, so each of
  // the two has the whole frame; without it they share one frame.
  const beside = app.evaluator.async();
  const ok = (beside ? Math.max(ev.p50, drawMs) < 16 : ev.p50 + drawMs < 16) && (!m.frames || m.frames.p90 < 34);
  const frames = m.frames && m.frames.n > 10 ? ` While you moved the drawing, frames came every ${m.frames.p50} ms (90 percent within ${m.frames.p90} ms, 99 percent within ${m.frames.p99} ms).` : ' Move or zoom the drawing for a few seconds, then run this again to measure the frames too.';
  const how = beside
    ? `Working out the drawing takes ${ev.p50.toFixed(1)} ms, done beside the page while you drag, and drawing it takes ${draws ? drawMs.toFixed(1) : '-'} ms, each against a budget of 16 ms a frame.`
    : `Working out the drawing takes ${ev.p50.toFixed(1)} ms and drawing it ${draws ? drawMs.toFixed(1) : '-'} ms, ${(ev.p50 + drawMs).toFixed(1)} ms a frame against a budget of 16 ms.`;
  return {
    id: 'speed', ok, title: 'Speed on this machine',
    text: `${how}${frames}${ok ? '' : ' That is slower than it should be: close other heavy tabs, or use Report a problem with these numbers.'}`,
  };
}
