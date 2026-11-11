// The Worker bundle as Cloudflare loads it: built in memory with the options of scripts/build.mjs, it exports only its
// handler (workerd refuses to start an entry that exports anything else, and the Node tests cannot see that), it
// imports nothing but node:async_hooks, and its handler answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function bundle() {
  const r = await esbuild.build({
    entryPoints: [path.join(ROOT, 'src/worker/index.js')],
    outfile: 'out/_worker.js', write: false, bundle: true, format: 'esm', platform: 'neutral', target: 'es2022',
    external: ['node:async_hooks'], define: { __FP_BUILD__: JSON.stringify({ commit: null, at: null }) },
    legalComments: 'none', metafile: true, logLevel: 'silent',
  });
  const [out] = Object.values(r.metafile.outputs);
  return { text: r.outputFiles[0].text, exports: out.exports, imports: out.imports };
}

test('the bundle exports only its handler and imports only the runtime\'s AsyncLocalStorage', async () => {
  const b = await bundle();
  assert.deepEqual(b.exports, ['default']);
  assert.deepEqual(b.imports.map(i => i.path), ['node:async_hooks']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-bundle-'));
  try {
    const file = path.join(dir, '_worker.js');
    fs.writeFileSync(file, b.text);
    const mod = await import(pathToFileURL(file).href);
    assert.deepEqual(Object.keys(mod), ['default']);
    assert.equal(typeof mod.default.fetch, 'function');
    const res = await mod.default.fetch(new Request('https://fp.test/api/health'), {}, { waitUntil() {} });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
