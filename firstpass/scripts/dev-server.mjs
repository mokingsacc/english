// The dev server on plain Node (no wrangler): static files from public/ first, and /api, /mcp, /tiles through the real
// Worker fetch handler, as public/_routes.json splits them on Cloudflare. env = {DB: the D1 fake on node:sqlite in
// .dev/dev.sqlite, ASSETS: a static shim, TILE_CACHE: an in-memory cache}. On start it applies new migrations, makes a
// dev user and a sample project when there are none, and prints the page link and the connector address.
//   npm run dev            port 8788; PORT=9000 npm run dev; HOST=0.0.0.0 to listen beyond this machine
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../src/worker/index.js';
import { createD1, migrationFiles } from '../tests/worker/d1-fake.mjs';
import { makeUser, insertUser } from '../src/worker/store/users.js';
import { createProject } from '../src/worker/store/projects.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const DEV = path.join(ROOT, '.dev');
const PORT = Number(process.env.PORT) || 8788;
const HOST = process.env.HOST || '127.0.0.1';

// The Worker's prefixes, read from public/_routes.json so the dev server splits requests exactly as Pages does.
const ROUTES = JSON.parse(fs.readFileSync(path.join(PUBLIC, '_routes.json'), 'utf8'));
const toWorker = p => ROUTES.include.some(r => (r.endsWith('/*') ? p.startsWith(r.slice(0, -1)) || p === r.slice(0, -2) : p === r))
  && !(ROUTES.exclude || []).some(r => (r.endsWith('/*') ? p.startsWith(r.slice(0, -1)) : p === r));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8', '.dxf': 'application/dxf' };
// Files Pages never serves as static files.
const HIDDEN = new Set(['/_worker.js', '/_routes.json', '/_headers', '/_redirects']);

/** A static file as Pages would serve it: / and folders give index.html, a bare name tries .html. */
function serveStatic(pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch { return new Response('Bad address', { status: 400 }); }
  if (HIDDEN.has(p)) return new Response('Not found', { status: 404 });
  const full = path.normalize(path.join(PUBLIC, p));
  if (!full.startsWith(PUBLIC)) return new Response('Not found', { status: 404 });
  const tries = [full, path.join(full, 'index.html'), `${full}.html`];
  for (const f of tries) {
    try {
      if (fs.statSync(f).isFile()) {
        return new Response(fs.readFileSync(f), { headers: { 'Content-Type': TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' } });
      }
    } catch { /* next */ }
  }
  return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

/** The Cache API's match and put, in memory (the tiles route's 30-day cache). */
function memoryCache(max = 2000) {
  const store = new Map();
  return {
    async match(req) {
      const hit = store.get(typeof req === 'string' ? req : req.url);
      return hit ? new Response(hit.body.slice(0), { status: hit.status, headers: hit.headers }) : undefined;
    },
    async put(req, res) {
      if (store.size >= max) store.delete(store.keys().next().value);
      store.set(typeof req === 'string' ? req : req.url, { body: await res.arrayBuffer(), status: res.status, headers: [...res.headers] });
    },
  };
}

/** The dev user (made once, its secrets kept in .dev/dev-user.json) and a sample project when it has none. */
async function seed(d1) {
  const file = path.join(DEV, 'dev-user.json');
  let saved = null;
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { saved = null; }
  if (!saved || !d1.row('SELECT id FROM users WHERE id = ?', saved.id)) {
    const u = await makeUser('Dev');
    await insertUser(d1.DB, u);
    saved = { id: u.id, key: u.key, token: u.token };
    fs.writeFileSync(file, JSON.stringify(saved, null, 2), { mode: 0o600 });
    console.log('Made the dev user.');
  }
  if (!d1.row('SELECT id FROM projects WHERE user_id = ?', saved.id)) {
    await createProject(d1.DB, saved.id, { sample: true });
    console.log('Made the sample project.');
  }
  return saved;
}

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

export async function start({ port = PORT, host = HOST, quiet = false } = {}) {
  fs.mkdirSync(DEV, { recursive: true });
  const d1 = createD1({ file: path.join(DEV, 'dev.sqlite') });
  const user = await seed(d1);
  const env = { DB: d1.DB, ASSETS: { fetch: r => serveStatic(new URL(r.url).pathname) }, TILE_CACHE: memoryCache() };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || `localhost:${port}`}`);
      let answer;
      if (toWorker(url.pathname)) {
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
        const b = req.method === 'GET' || req.method === 'HEAD' ? undefined : await body(req);
        const waits = [];
        answer = await worker.fetch(new Request(url, { method: req.method, headers, body: b }), env, { waitUntil: p => waits.push(Promise.resolve(p).catch(() => {})) });
        Promise.all(waits).catch(() => {});
      } else {
        answer = serveStatic(url.pathname);
      }
      const out = {};
      answer.headers.forEach((v, k) => { out[k] = v; });
      res.writeHead(answer.status, out);
      res.end(req.method === 'HEAD' || answer.body == null ? undefined : Buffer.from(await answer.arrayBuffer()));
    } catch (e) {
      console.error('dev server error', e && e.message);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('The dev server failed on that request.');
    }
  });
  await new Promise(ok => server.listen(port, host, ok));
  const base = `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`;
  if (!quiet) {
    console.log(`First Pass dev server on ${base} (migrations: ${migrationFiles().length}, database .dev/dev.sqlite)`);
    console.log(`Page:      ${base}/#k=${user.key}`);
    console.log(`Connector: ${base}/mcp/${user.token}`);
  }
  return { server, base, user, env, close: () => new Promise(ok => server.close(ok)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await start();
