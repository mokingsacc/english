// index.html's modulepreload list (scripts/module-graph.mjs) matches the page's import graph, so the browser asks for
// every module at once. It fails when an import changed and the list was not written again.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BEGIN, END, entries, importsOf, moduleGraph, preloadBlock, withBlock } from '../../scripts/module-graph.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const html = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');

test('index.html preloads every module the page loads at the start, and no other', () => {
  const block = preloadBlock();
  assert.ok(html.includes(block), 'The modulepreload list in public/index.html is stale. Run: node scripts/module-graph.mjs');
  assert.equal(html.split(BEGIN).length, 2, 'one list');
  assert.equal(html.split(END).length, 2, 'one list');
  const list = moduleGraph();
  for (const e of entries(html)) assert.ok(list.includes(e), `${e} is preloaded`);
  assert.ok(!list.includes('js/shared/report-sheet.js'), 'the Report a problem sheet loads only when opened');
  assert.ok(!list.includes('js/app/eval-worker.js'), 'the evaluate worker keeps its own graph');
  for (const m of list) assert.ok(fs.existsSync(path.join(ROOT, 'public', m)), `${m} is in public/`);
  assert.equal(withBlock(html), html, 'writing the list again changes nothing');
});

test('the import reader finds static imports, re-exports and fixed dynamic imports, and skips comments', () => {
  const src = [
    "import { a } from './a.js';",
    "import * as b from \"../b.js\";",
    "export { c } from './c.js';",
    "export * from './d.js';",
    "import './e.js';",
    "const f = await import('./f.js');",
    '// import { g } from "./g.js";',
    "/* import h from './h.js'; */",
    "const url = 'https://example.com/x.js';",
    'import {',
    '  i,',
    "} from './i.js';",
  ].join('\n');
  assert.deepEqual(importsOf(src).sort(), ['../b.js', './a.js', './c.js', './d.js', './e.js', './f.js', './i.js']);
});

test('a page with only the old single preload line gets the whole list in its place', () => {
  const old = '<head>\n<link rel="modulepreload" href="js/app/main.js">\n<script type="module" src="js/app/main.js"></script>\n</head>';
  const out = withBlock(old, preloadBlock(['js/app/main.js', 'js/app/api.js']));
  assert.equal(out.split('rel="modulepreload"').length - 1, 2);
  assert.ok(out.indexOf(BEGIN) < out.indexOf('<script'));
});
