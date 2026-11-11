// The page's modulepreload list: every module the page loads, found by following the imports from the scripts that
// public/index.html starts (js/shared/report.js and js/app/main.js), written into index.html between two marker
// comments, so the browser asks for them all at once instead of one level of imports at a time. The evaluate worker
// (js/app/eval-worker.js, started with new Worker) is not an import and keeps its own graph; the Report a problem sheet
// (ON_DEMAND) loads only when she opens it, so it is left out too. `npm run build` runs this;
// run it by hand after changing an import: `node scripts/module-graph.mjs`. tests/page/module-graph.test.mjs fails when
// the list in index.html is stale.
//   moduleGraph() -> ['js/app/main.js', ...]   preloadBlock() -> the lines   writeIndex() -> true when it changed
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const INDEX = path.join(PUBLIC, 'index.html');
export const BEGIN = '<!-- modulepreload: every module the page loads, written by scripts/module-graph.mjs; do not edit by hand -->';
export const END = '<!-- end of modulepreload -->';
const ON_DEMAND = new Set(['js/shared/report-sheet.js']);   // loaded when opened, not at the start

/** The module scripts index.html starts, as paths under public/ ("js/app/main.js"). */
export function entries(html = fs.readFileSync(INDEX, 'utf8')) {
  return [...html.matchAll(/<script\s+type="module"\s+src="([^"]+)"/g)].map((m) => m[1].replace(/^\.?\//, ''));
}

/** The specifiers a module imports: static imports and re-exports, and dynamic imports of a fixed string. */
export function importsOf(src) {
  const out = [];
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
  for (const m of code.matchAll(/(?:^|[;\s])(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of code.matchAll(/(?:^|[;\s])import\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of code.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  return [...new Set(out)];
}

/** Every module reachable from the entries, entries first, then in the order found; paths under public/. */
export function moduleGraph(starts = entries()) {
  const seen = new Set(), order = [];
  const queue = [...starts];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel) || ON_DEMAND.has(rel)) continue;
    seen.add(rel);
    const file = path.join(PUBLIC, rel);
    if (!fs.existsSync(file)) throw new Error(`${rel} is imported but is not in public/.`);
    order.push(rel);
    for (const spec of importsOf(fs.readFileSync(file, 'utf8'))) {
      if (!spec.startsWith('.')) continue;   // only the page's own files; there are no others
      const next = path.relative(PUBLIC, fileURLToPath(new URL(spec, pathToFileURL(file)))).split(path.sep).join('/');
      if (!seen.has(next)) queue.push(next);
    }
  }
  return order;
}

/** The block of lines that goes into index.html's head. */
export function preloadBlock(list = moduleGraph()) {
  return [BEGIN, ...list.map((m) => `<link rel="modulepreload" href="${m}">`), END].join('\n');
}

/** index.html with the block written in place of the one there (or of the single main.js preload line before it). */
export function withBlock(html, block = preloadBlock()) {
  const a = html.indexOf(BEGIN), b = html.indexOf(END);
  if (a >= 0 && b > a) return html.slice(0, a) + block + html.slice(b + END.length);
  const single = /<link rel="modulepreload" href="[^"]+">\n/;
  if (single.test(html)) return html.replace(single, `${block}\n`);
  return html.replace('</head>', `${block}\n</head>`);
}

/** Writes the block into public/index.html; true when the file changed. */
export function writeIndex() {
  const html = fs.readFileSync(INDEX, 'utf8');
  const next = withBlock(html);
  if (next === html) return false;
  fs.writeFileSync(INDEX, next);
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const changed = writeIndex();
  console.log(`${changed ? 'wrote' : 'kept'} the modulepreload list in public/index.html (${moduleGraph().length} modules)`);
}
