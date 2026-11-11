// Bundles the Worker (src/worker/index.js, with the engine files it imports from public/js/engine/) into
// public/_worker.js for Cloudflare Pages' advanced mode. `npm run build`. The output is not committed (.gitignore).
// It first brings index.html's modulepreload list up to date (scripts/module-graph.mjs).
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeIndex, moduleGraph } from './module-graph.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

console.log(`${writeIndex() ? 'wrote' : 'kept'} the modulepreload list in public/index.html (${moduleGraph().length} modules)`);

let esbuild;
try { esbuild = await import('esbuild'); } catch {
  console.error('esbuild is not installed. Run npm install in firstpass/ first.');
  process.exit(1);
}

let commit = null;
try { commit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null; } catch { commit = null; }
const build = { commit, at: new Date().toISOString() };

const result = await esbuild.build({
  entryPoints: [path.join(ROOT, 'src/worker/index.js')],
  outfile: path.join(ROOT, 'public/_worker.js'),
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  // AsyncLocalStorage comes from the runtime (wrangler.toml compatibility flag nodejs_als).
  external: ['node:async_hooks'],
  define: { __FP_BUILD__: JSON.stringify(build) },
  legalComments: 'none',
  metafile: true,
  logLevel: 'warning',
});
const out = Object.entries(result.metafile.outputs).find(([f]) => f.endsWith('_worker.js'));
console.log(`wrote public/_worker.js (${Math.round(out[1].bytes / 1024)} KB, ${Object.keys(result.metafile.inputs).length} files, build ${build.commit || 'no commit'} ${build.at})`);
