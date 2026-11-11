// The browser tests' setup: a First Pass server of their own on a free port (the real Worker routes on an in-memory
// database, the page from public/, photo tiles answered 404 so nothing reaches the internet), one fresh user, Chromium
// from the Playwright already installed (found through NODE_PATH; never installed here), and helpers to drive the page.
//   const s = await startServer();  const { browser, page, errors } = await openPage(s, await s.newProject());
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from '../../src/worker/index.js';
import { createD1 } from '../worker/d1-fake.mjs';
import { makeUser, insertUser } from '../../src/worker/store/users.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PUBLIC = path.join(ROOT, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };
export const SHOTS = process.env.FP_SHOTS || '';   // a folder for screenshots, when set

/** Chromium through the installed Playwright (NODE_PATH), or null with the reason. */
export function playwright() {
  try { return { chromium: createRequire(import.meta.url)('playwright').chromium }; } catch (e) { return { chromium: null, why: e.message }; }
}

export async function startServer() {
  const d1 = createD1();
  const user = await makeUser('Web test');
  await insertUser(d1.DB, user);
  const cache = new Map();
  const env = {
    DB: d1.DB,
    ASSETS: { fetch: (r) => staticFile(new URL(r.url).pathname) },
    TILE_CACHE: { match: async (k) => cache.get(typeof k === 'string' ? k : k.url), put: async (k, v) => { cache.set(typeof k === 'string' ? k : k.url, v); } },
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let answer;
      if (url.pathname.startsWith('/tiles/')) answer = new Response('No photos in tests', { status: 404 });
      else if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/mcp/')) {
        const headers = new Headers();
        for (const [k, v] of Object.entries(req.headers)) if (v != null) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks);
        answer = await worker.fetch(new Request(new URL(req.url, `http://${req.headers.host}`), { method: req.method, headers, body }), env, { waitUntil: () => {} });
      } else answer = staticFile(url.pathname);
      const out = {};
      answer.headers.forEach((v, k) => { out[k] = v; });
      res.writeHead(answer.status, out);
      res.end(Buffer.from(await answer.arrayBuffer()));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end(`Test server failed: ${e.message}`);
    }
  });
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, p, body) => {
    const r = await fetch(base + p, { method, headers: { 'X-Key': user.key, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return r.json();
  };
  let n = 0;
  return {
    base, key: user.key, token: user.token, api, d1,
    /** A fresh sample project for one test. */
    async newProject(name = `Web test ${++n}`) { return (await api('POST', '/api/projects', { sample: true, name })).project; },
    /** One connector tool call, as Claude would make it. */
    async tool(name, args) {
      const r = await fetch(`${base}/mcp/${user.token}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++n, method: 'tools/call', params: { name, arguments: args } }) });
      return r.json();
    },
    close: () => new Promise((ok) => { server.close(ok); server.closeAllConnections && server.closeAllConnections(); }),
  };
}

function staticFile(pathname) {
  let p;
  try { p = decodeURIComponent(pathname); } catch { return new Response('Bad address', { status: 400 }); }
  if (p.endsWith('/')) p += 'index.html';
  const full = path.normalize(path.join(PUBLIC, p));
  if (!full.startsWith(PUBLIC) || path.basename(full).startsWith('_')) return new Response('Not found', { status: 404 });
  try {
    return new Response(fs.readFileSync(full), { headers: { 'Content-Type': TYPES[path.extname(full)] || 'application/octet-stream', 'Cache-Control': 'no-cache' } });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

// crs.js is not written yet (docs/design.md, part 4): its 404 is the expected, quiet photo fallback.
const EXPECTED = [/\/js\/engine\/crs\.js/, /\/tiles\/naip\//];

/** A page on the project (fresh browser storage), with console errors collected. */
export async function openPage(server, project, { width = 1440, height = 900, dsf = 1, key = server.key, browser = null, touch = false } = {}) {
  const { chromium } = playwright();
  const b = browser || await chromium.launch();
  const context = await b.newContext({ viewport: { width, height }, deviceScaleFactor: dsf, hasTouch: touch });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const where = (m.location() && m.location().url) || '';
    if (EXPECTED.some((re) => re.test(where) || re.test(m.text()))) return;
    errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`${e.message}`));
  const hash = key ? `#k=${key}${project ? `&p=${project.id}` : ''}` : '';
  await page.goto(`${server.base}/${hash}`);
  await page.waitForFunction(() => window.fpPage && window.fpPage.ready);
  await page.evaluate(() => window.fpPage.ready);
  await settle(page);
  return { browser: b, context, page, errors, close: async () => { await context.close(); if (!browser) await b.close(); } };
}

/** Two animation frames: whatever was asked for has been drawn. */
export const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

/** The canvas's box on the page. */
export const canvasBox = (page) => page.locator('#canvas').boundingBox();

/** A screen point (page px) on an object of the drawing: 'round' (its centre) or 'leg:<id>' (the middle of a curb line). */
export async function pointOn(page, key) {
  const box = await canvasBox(page);
  const p = await page.evaluate((k) => {
    const f = window.fpPage.info(), c = window.fpPage.camera;
    if (k === 'round') return { x: c.sx(f.shown.geometry.center.x), y: c.sy(f.shown.geometry.center.y) };
    const it = f.index.items.find((i) => i.key === k && i.layer === 'curb' && i.prim.type === 'line') || f.index.items.find((i) => i.key === k && i.prim.type === 'line');
    return { x: c.sx((it.prim.a.x + it.prim.b.x) / 2), y: c.sy((it.prim.a.y + it.prim.b.y) / 2) };
  }, key);
  return { x: box.x + p.x, y: box.y + p.y };
}

/** The screen point (page px) of a grip by its key ('entry-width:N:0') or grip id. */
export async function gripAt(page, id) {
  const box = await canvasBox(page);
  const g = await page.evaluate((k) => {
    const f = window.fpPage.info(), c = window.fpPage.camera;
    const q = f.grips.find((x) => x.key === k) || f.grips.find((x) => x.grip.id === k);
    return q ? { x: c.sx(q.x), y: c.sy(q.y) } : null;
  }, id);
  return g ? { x: box.x + g.x, y: box.y + g.y } : null;
}

/** The command line's history, last n lines. */
export const history = (page, n = 12) => page.evaluate((k) => [...document.querySelectorAll('.cl-line')].slice(-k).map((l) => l.textContent), n);

/** The page's store state. */
export const state = (page) => page.evaluate(() => { const s = window.fpPage.state(); return { selection: s.selection, optionId: s.optionId, draft: !!s.draft, project: s.project, net: s.net }; });

/** Saves a screenshot to SHOTS when it is set. */
export async function shot(page, name) {
  if (!SHOTS) return null;
  fs.mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, name);
  await page.screenshot({ path: file });
  return file;
}

/** Waits until fn(page) is true (polling), or fails with msg. */
export async function until(page, fn, msg, ms = 5000) {
  const t0 = Date.now();
  for (;;) {
    if (await fn(page)) return;
    if (Date.now() - t0 > ms) throw new Error(`Timed out: ${msg}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
