// Check myself on the page (public/js/app/selfcheck.js): every line it writes is in her words, with no command, file
// name or code in it, and the speed line is judged on the frames she sees (90 percent within about 34 ms), not on how
// long the maths takes beside the page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runSelfCheck, speedVerdict, FRAME_OK_MS, engineSelfTest, exportSelfTest } from '../../public/js/app/selfcheck.js';
import { evaluate } from '../../public/js/engine/index.js';
import { sampleProject } from '../../public/js/app/sample.js';

const DEV_WORDS = /npm|node |wrangler|\.js\b|\.mjs\b|\.dxf\b|\.md\b|#k=|EXPORT|CHECKMYSELF|CLAUDE|scripts\/|=>|->|\{|\}/;

function fakeApp({ hasKey = true, server = null, frames = null } = {}) {
  const p = sampleProject();
  return {
    api: { hasKey: () => hasKey, selfcheck: async () => server || { ok: false, offline: true, data: null } },
    store: { get: () => ({ photo: { state: 'off', text: 'Photo not available', why: 'the photo service did not answer' }, project: p }) },
    project: () => p, option: () => p.options[0], round: () => p.options[0].round,
    evaluateOption: (o) => evaluate(o.round, p.rules),
    meter: { summary: () => ({ frames }) },
    layers: { bench: () => [4, 5, 6, 7, 8], stats: { draws: [] } },
    evaluator: { async: () => true },
  };
}

test('every line Check myself writes on the page is in her words', async () => {
  for (const app of [fakeApp(), fakeApp({ hasKey: false }), fakeApp({ frames: { n: 50, p50: 16.7, p90: 18.2, p99: 30 } })]) {
    const lines = await runSelfCheck(app);
    assert.deepEqual(lines.map((l) => l.id), ['data', 'connector', 'engine', 'export', 'photo', 'speed']);
    for (const l of lines) {
      assert.doesNotMatch(l.text, DEV_WORDS, `${l.id}: "${l.text}"`);
      assert.match(l.text, /[.]$/, `${l.id} ends with a full stop`);
    }
    const data = lines.find((l) => l.id === 'data');
    assert.equal(data.ok, false);
    if (app.api.hasKey()) assert.match(data.text, /tell the person who runs First Pass\.$/);
  }
  assert.equal(engineSelfTest().ok, true);
  assert.equal(exportSelfTest().ok, true);
});

test('speed is judged on the frames she sees, not on the maths beside the page', () => {
  const slowMaths = { n: 15, p50: 40, p90: 45, p99: 50 };
  // Smooth frames with slow maths in the worker: green.
  const smooth = speedVerdict({ frames: { n: 60, p50: 16.7, p90: 20, p99: 33 }, draw: { p50: 4, p90: 6 }, evaluate: slowMaths, beside: true });
  assert.equal(smooth.ok, true, smooth.text);
  // Frames slower than FRAME_OK_MS: red, with what to do.
  const slow = speedVerdict({ frames: { n: 60, p50: 30, p90: FRAME_OK_MS + 5, p99: 80 }, draw: { p50: 4, p90: 6 }, evaluate: { p50: 2, p90: 3 }, beside: true });
  assert.equal(slow.ok, false);
  assert.match(slow.text, /Report a problem/);
  // Before she has moved the drawing: a frame's own work, with the maths counted only when it cannot run beside the page.
  assert.equal(speedVerdict({ draw: { p50: 10, p90: 12 }, evaluate: slowMaths, beside: true }).ok, true);
  assert.equal(speedVerdict({ draw: { p50: 10, p90: 12 }, evaluate: slowMaths, beside: false }).ok, false);
  assert.match(speedVerdict({ draw: { p50: 10, p90: 12 }, evaluate: slowMaths, beside: true }).text, /Move or zoom the drawing/);
});
