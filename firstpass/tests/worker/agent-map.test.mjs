// docs/agent-map.md must match the code (run npm run map after adding a file, route or tool), and every source file of
// the server starts with a comment saying what it is for (the map shows that line).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expected, OUT, firstComment } from '../../scripts/agent-map.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('docs/agent-map.md is up to date (npm run map)', async () => {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  assert.ok(current === (await expected(current)), 'docs/agent-map.md is out of date: run npm run map');
});

test('every server file, script and test starts with a comment saying what it is for', () => {
  const files = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.m?js$/.test(e.name)) files.push(p); } };
  for (const d of ['src/worker', 'tests/worker']) walk(path.join(ROOT, d));
  for (const f of ['scripts/dev-server.mjs', 'scripts/build.mjs', 'scripts/agent-map.mjs', 'scripts/add-user.mjs', 'public/js/shared/report.js', 'public/js/shared/report-sheet.js']) files.push(path.join(ROOT, f));
  for (const f of files) {
    const first = fs.readFileSync(f, 'utf8').split('\n')[0];
    assert.match(first, /^\/\/ \S/, `${path.relative(ROOT, f)} does not start with a comment`);
    assert.ok(firstComment(fs.readFileSync(f, 'utf8')).length > 20, path.relative(ROOT, f));
  }
});
