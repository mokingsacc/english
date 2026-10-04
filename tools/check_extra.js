// Opens the app in a phone-sized headless browser and checks the photo lessons.
// Usage: node tools/check_extra.js http://127.0.0.1:8765/   (serve the repo folder first)
// Needs Playwright (NODE_PATH) and Chromium. Exit code 0 = all good.
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path');
const BASE = process.argv[2] || 'http://127.0.0.1:8765/';
const ROOT = path.dirname(__dirname);
const exe = ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find(p => fs.existsSync(p));
(async () => {
  const b = await chromium.launch(exe ? { executablePath: exe } : {});
  const ctx = await b.newContext({ ...devices['iPhone 14'], ignoreHTTPSErrors: true });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(BASE + 'index.html');
  const extra = JSON.parse(fs.readFileSync(path.join(ROOT, 'lessons/extra.json'), 'utf8'));
  await page.waitForFunction(n => window.APP && APP.LESSONS.length >= 10 + n, extra.lessons.length, { timeout: 8000 }).catch(() => {});
  const r = await page.evaluate(() => {
    const out = { ids: [], missing: [], dialog: [] };
    APP.LESSONS.filter(l => l.extra).forEach(l => {
      out.ids.push(l.id);
      l.phrases.map(p => p.en).concat([l.trap.example]).forEach(t => { if (!APP.clipUrl(t)) out.missing.push(t); else { out.dialog.push(APP.clipUrl(t)); out.dialog.push(APP.clipUrl(t, true)); } });
      if (l.dialog) l.dialog.lines.forEach(x => out.dialog.push(APP.lineUrl(x[1])));
    });
    return out;
  });
  const want = extra.lessons.map(l => l.id);
  const skipped = want.filter(id => !r.ids.includes(id));
  const files = r.dialog.filter(u => !fs.existsSync(path.join(ROOT, u)));
  for (const id of r.ids) {
    const i = await page.evaluate(id => APP.LESSONS.findIndex(l => l.id === id), id);
    await page.evaluate(i => APP.go('lesson', { li: i, steps: [{ t: 'intro' }, { t: 'complete' }], i: 0 }), i);
  }
  const problems = [];
  if (skipped.length) problems.push('App skipped these lessons (failed its checks): ' + skipped.join(', '));
  if (r.missing.length) problems.push('No recording for: ' + r.missing.join(' | '));
  if (files.length) problems.push('Missing audio files: ' + files.join(', '));
  if (errors.length) problems.push('Page errors: ' + errors.join(' | '));
  console.log(problems.length ? 'PROBLEMS:\n- ' + problems.join('\n- ') : `OK: ${r.ids.length} photo lesson(s) load, every line has audio.`);
  await b.close(); process.exit(problems.length ? 1 : 0);
})();
