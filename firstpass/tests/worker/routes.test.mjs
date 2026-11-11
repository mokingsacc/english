// public/_routes.json in step with the router: every path the Worker answers is sent to it, and nothing else is, so
// static files never invoke the Worker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeTable, WORKER_PREFIXES } from '../../src/worker/routes.js';

const ROUTES = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/_routes.json'), 'utf8'));
const covered = p => ROUTES.include.some(r => (r.endsWith('/*') ? p.startsWith(r.slice(0, -1)) : p === r))
  && !ROUTES.exclude.some(r => (r.endsWith('/*') ? p.startsWith(r.slice(0, -1)) : p === r));

test('every route the Worker handles is in _routes.json', () => {
  assert.equal(ROUTES.version, 1);
  for (const r of routeTable()) {
    const sample = r.pattern.replace(/:(\w+)/g, 'x');
    assert.ok(covered(sample), `${r.method} ${r.pattern} is not sent to the Worker by public/_routes.json`);
  }
});

test('_routes.json sends the Worker only its own prefixes', () => {
  assert.deepEqual(ROUTES.include.slice().sort(), WORKER_PREFIXES.map(p => `${p}*`).sort());
  for (const p of WORKER_PREFIXES) assert.ok(routeTable().some(r => r.pattern.startsWith(p)), `no route under ${p}`);
  for (const p of ['/', '/index.html', '/js/engine/index.js', '/css/app.css']) assert.ok(!covered(p), p);
});
