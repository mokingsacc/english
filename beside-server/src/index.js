/* Beside's call server. It speaks the PeerJS server protocol, so the PeerJS client in Beside works
   unchanged: each browser keeps one WebSocket open with its id, and OFFER / ANSWER / CANDIDATE / LEAVE
   messages are passed to the browser they're addressed to. One Durable Object holds every socket, so
   two browsers anywhere in the world always meet in the same place. It never sees the picture or sound.

   /peerjs/health   is it up (Beside checks this before choosing a server)
   /peerjs/turn     short-lived relay passwords (Cloudflare TURN) for networks that block direct calls
   .../peerjs/id    a fresh random id (PeerJS asks for one when it isn't given one)
   .../peerjs?id=   the WebSocket
   /peerjs/board/<room>   the Together board: GET it, or POST one change ({op, ...}); one Durable Object per room
   /peerjs/board/<room>/photo/<id>   a "thinking of you" photo
   /peerjs/board/<room>/push   POST: let this device ring ({role, name, open, web|voip}), or {off} to stop
   /peerjs/board/<room>/ring   POST {role, name}: ring the other person's devices; GET: the last ring
   /peerjs/board/<room>/talk   POST {text, by, zone}: one sentence becomes to-dos, events or a countdown (Claude reads it)
   /peerjs/push/key            the public key browsers need to say yes to rings */

import { sendWeb, sendVoip, vapidPublic, pushHostOk } from './push.js';
import { understand, toOps, TalkError, TALK_ZONES, TALK_MAX } from './talk.js';

const STALE_MS = 120000; // PeerJS beats every 5 s (up to ~60 s in a hidden, throttled tab); silent longer = a dead line
const QUEUE_MS = 5000; // like peerjs-server: hold a message for a browser that's reconnecting, then EXPIRE
const TURN_TTL = 12 * 3600;
const JSON_H = { 'content-type': 'application/json', 'cache-control': 'no-store' };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (p === '/peerjs/health') return new Response('{"ok":true}', { headers: { ...JSON_H, 'access-control-allow-origin': '*' } });
    if (p === '/peerjs/turn') return turn(req, env);
    if (p.startsWith('/peerjs/board/')) return board(req, env, p);
    if (p === '/peerjs/push/key') return new Response(JSON.stringify({ key: vapidPublic(env) }), { headers: { ...JSON_H, ...CORS } });
    if (/\/peerjs\/id$/.test(p)) return new Response(crypto.randomUUID(), { headers: { 'cache-control': 'no-store', 'access-control-allow-origin': '*' } });
    if (/\/peerjs$/.test(p) && req.headers.get('upgrade') === 'websocket') {
      return env.LOBBY.get(env.LOBBY.idFromName('lobby')).fetch(req);
    }
    return new Response('Not found', { status: 404 });
  },
};

// Only Beside's own pages get relay passwords (a page elsewhere can't set these headers).
function ownPage(req) {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  const o = req.headers.get('origin') || req.headers.get('referer') || '';
  if (!o) return !!site;
  try { return new URL(o).host === new URL(req.url).host; } catch (e) { return false; }
}

async function turn(req, env) {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_TOKEN) return new Response('{"iceServers":[]}', { headers: JSON_H });
  if (!ownPage(req)) return new Response('{"iceServers":[]}', { status: 403, headers: JSON_H });
  const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { authorization: 'Bearer ' + env.TURN_KEY_TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ ttl: TURN_TTL }),
  });
  if (!r.ok) return new Response('{"iceServers":[]}', { status: 502, headers: JSON_H });
  const j = await r.json();
  // Browsers block port 53, so those addresses would only time out.
  const iceServers = (j.iceServers || []).map((s) => ({
    ...s,
    urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)),
  })).filter((s) => s.urls.length);
  return new Response(JSON.stringify({ iceServers, ttl: TURN_TTL }), { headers: JSON_H });
}

// ---------- the Together board ----------
const CORS = { 'access-control-allow-origin': '*' };
const ROOM_RE = /^[A-Za-z0-9_]{4,40}$/;
const ID_RE = /^[A-Za-z0-9_-]{6,40}$/;
const TEXT_MAX = 300;
const NAME_MAX = 40;
const TODO_MAX = 200;
const EVENT_MAX = 300;
const THINK_KEEP = 20;
const PHOTO_MAX = 400 * 1024; // bytes, after the browser shrinks it
const BODY_MAX = 700 * 1024; // the photo as base64 plus the rest
const AT_MIN = Date.UTC(2000, 0, 1);
const AT_MAX = Date.UTC(2100, 0, 1);
const PHOTO_RE = /^data:image\/(jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

const plain = (msg, status = 400) => new Response(msg, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...CORS } });

function board(req, env, p) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' } });
  }
  const m = p.match(/^\/peerjs\/board\/([^/]*)(\/photo\/([^/]+)|\/(push|ring|talk))?\/?$/);
  if (!m) return plain('Not found', 404);
  if (!ROOM_RE.test(m[1])) return plain('That board name isn’t right: use 4 to 40 letters, numbers or _.');
  if (m[3] && !ID_RE.test(m[3])) return plain('Not found', 404);
  const post = req.method === 'POST' && !m[3], get = req.method === 'GET' && m[4] !== 'push' && m[4] !== 'talk';
  if (!post && !get) return plain('Only GET and POST work here.', 405);
  return env.BOARD.get(env.BOARD.idFromName(m[1])).fetch(req);
}

// Each check returns an error message, or the cleaned value.
class Bad extends Error {}
function text(v, what, max = TEXT_MAX, optional = false) {
  if (v == null || v === '') { if (optional) return ''; throw new Bad(`Please write the ${what}.`); }
  if (typeof v !== 'string') throw new Bad(`The ${what} must be text.`);
  const s = v.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s && !optional) throw new Bad(`Please write the ${what}.`);
  if (s.length > max) throw new Bad(`The ${what} is too long (at most ${max} characters).`);
  return s;
}
function when(v) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < AT_MIN || v > AT_MAX) throw new Bad('That date isn’t right.');
  return Math.round(v);
}
function newId(v) {
  if (v == null) return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  if (typeof v !== 'string' || !ID_RE.test(v)) throw new Bad('That id isn’t right.');
  return v;
}
function oldId(v) {
  if (typeof v !== 'string' || !ID_RE.test(v)) throw new Bad('That id isn’t right.');
  return v;
}

const SUBS_MAX = 12;
const RING_GAP = 8000; // one ring per room every 8 s at most
const RING_RE = /^(host|guest)$/;
const VOIP_RE = /^[0-9a-f]{64,200}$/;
const TALK_DAY = 60; // sentences per board per day
const TALK_ALL_DAY = 200; // sentences per day across every board, so made-up board names can't run up a bill

export class Board {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env || {};
    this.b = null;
    this.subs = [];
    this.ring = null;
    ctx.blockConcurrencyWhile(async () => {
      this.b = (await ctx.storage.get('board')) || { v: 0, countdown: null, todos: [], events: [], thinks: [] };
      this.subs = (await ctx.storage.get('subs')) || [];
      this.ring = (await ctx.storage.get('ring')) || null;
    });
  }

  // Where a ring should open on this device: Beside's own address only.
  openLink(v, req) {
    try {
      const u = new URL(String(v || ''));
      const own = new URL(req.url);
      const okHost = u.host === 'sitbeside.pages.dev' || u.host === own.host || /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(u.host);
      if ((u.protocol === 'https:' || u.hostname === 'localhost' || u.hostname === '127.0.0.1') && okHost && String(v).length < 300) return u.href;
    } catch (e) {}
    throw new Bad('That link isn’t Beside’s.');
  }

  async push(o, req) {
    const role = typeof o.role === 'string' && RING_RE.test(o.role) ? o.role : null;
    const key = o.voip ? 'voip:' + o.voip : o.web && o.web.endpoint ? 'web:' + o.web.endpoint : o.endpoint ? 'web:' + o.endpoint : null;
    if (!key) throw new Bad('Nothing to ring.');
    let subs = this.subs.filter((s) => s.key !== key);
    if (o.off) {
      if (subs.length === this.subs.length) return { on: false };
      this.subs = subs;
      await this.ctx.storage.put('subs', subs);
      return { on: false };
    }
    if (!role) throw new Bad('Say who this device belongs to.');
    const s = { key, role, name: text(o.name, 'name', NAME_MAX, true), open: this.openLink(o.open, req), at: Date.now() };
    if (o.voip) {
      if (typeof o.voip !== 'string' || !VOIP_RE.test(o.voip)) throw new Bad('That device code isn’t right.');
      s.kind = 'voip'; s.token = o.voip; s.env = o.env === 'sandbox' ? 'sandbox' : 'production';
    } else {
      const w = o.web || {};
      if (typeof w.endpoint !== 'string' || w.endpoint.length > 1000 || !pushHostOk(w.endpoint, this.env)) throw new Bad('This browser’s ring address isn’t one Beside knows.');
      if (!w.keys || typeof w.keys.p256dh !== 'string' || typeof w.keys.auth !== 'string' || w.keys.p256dh.length > 200 || w.keys.auth.length > 100) throw new Bad('This browser’s ring keys are missing.');
      s.kind = 'web'; s.endpoint = w.endpoint; s.keys = { p256dh: w.keys.p256dh, auth: w.keys.auth };
    }
    subs = [s].concat(subs).slice(0, SUBS_MAX);
    this.subs = subs;
    await this.ctx.storage.put('subs', subs);
    return { on: true, devices: subs.filter((x) => x.role === role).length };
  }

  async sendRing(o) {
    if (typeof o.role !== 'string' || !RING_RE.test(o.role)) throw new Bad('Say who is ringing.');
    const now = Date.now();
    if (this.ring && now - this.ring.at < RING_GAP && this.ring.role === o.role) return { sent: this.ring.sent || 0, again: true };
    const name = text(o.name, 'name', NAME_MAX, true) || (o.role === 'host' ? 'Your person' : 'Your guest');
    const id = newId();
    const to = this.subs.filter((s) => s.role !== o.role);
    this.ring = { id, role: o.role, name, at: now, sent: 0 };
    const results = await Promise.all(to.map((s) => {
      const ring = { id, name, from: o.role, link: s.open };
      return (s.kind === 'voip'
        ? sendVoip(this.env, s, { ring })
        : sendWeb(this.env, s, { title: name + ' is calling', body: 'Tap to join on Beside.', url: s.open, id, tag: 'beside-ring' })
      ).catch(() => 'fail');
    }));
    const gone = new Set(to.filter((s, i) => results[i] === 'gone').map((s) => s.key));
    if (gone.size) this.subs = this.subs.filter((s) => !gone.has(s.key));
    this.ring.sent = results.filter((r) => r === 'ok').length;
    await this.ctx.storage.put({ subs: this.subs, ring: this.ring });
    const names = [...new Set(to.filter((s) => !gone.has(s.key) && s.name).map((s) => s.name))];
    return { sent: this.ring.sent, devices: to.length - gone.size, gone: gone.size, names };
  }

  // One sentence: Claude reads it, then every change is checked and saved together, with how to undo them.
  async talk(req) {
    const raw = await req.text();
    if (raw.length > 4000) return plain('That’s too long.');
    let o, sentence, by;
    try { o = JSON.parse(raw); } catch (e) { return plain('That couldn’t be read.'); }
    if (!o || typeof o !== 'object') return plain('That couldn’t be read.');
    try { sentence = text(o.text, 'sentence', TALK_MAX); by = text(o.by, 'name', NAME_MAX, true); } catch (e) {
      if (e instanceof Bad) return plain(e.message);
      throw e;
    }
    const zone = TALK_ZONES.includes(o.zone) ? o.zone : TALK_ZONES[0];
    if (!this.env.ANTHROPIC_API_KEY) return plain('Say it isn’t switched on yet.', 503);
    const full = 'The board has heard enough for today. Please add the rest by hand.';
    if (!(await this.count(1, TALK_DAY))) return plain(full, 429);
    const meter = this.env.BOARD.get(this.env.BOARD.idFromName('meter:talk'));
    const take = (n) => meter.fetch('https://meter/meter', { method: 'POST', body: String(n) }).then((r) => r.ok);
    if (!(await take(1))) { await this.count(-1); return plain(full, 429); }
    let got;
    try { got = await understand(this.env, sentence, by, zone); } catch (e) {
      // A sentence that failed doesn't count.
      await this.count(-1);
      await take(-1);
      if (e instanceof TalkError) return plain(e.message, 503);
      throw e;
    }
    // From here to this.b = ... there is no await (the board may have changed while Claude was reading).
    let b = this.b;
    const added = [], undo = [];
    let why = '';
    for (const op of toOps(got.items, zone)) {
      op.by = by;
      if (op.op !== 'countdown.set') op.id = newId();
      let next;
      try { next = this.apply(b, op); } catch (e) {
        if (e instanceof Bad) { why = why || e.message; continue; }
        throw e;
      }
      if (!next) continue;
      if (op.op === 'todo.add') { added.push({ kind: 'todo', id: op.id, text: op.text }); undo.push({ op: 'todo.delete', id: op.id }); }
      if (op.op === 'event.add') { added.push({ kind: 'event', id: op.id, title: op.title, at: op.at, allDay: op.allDay }); undo.push({ op: 'event.delete', id: op.id }); }
      if (op.op === 'countdown.set') {
        added.push({ kind: 'countdown', title: op.title, at: op.at });
        undo.push(b.countdown ? { op: 'countdown.set', title: b.countdown.title, at: b.countdown.at } : { op: 'countdown.clear' });
      }
      b = next.board;
    }
    if (!added.length) return this.reply({ board: this.b, added, reply: why || got.reply || 'Nothing in that could go on the board.' });
    b.v = this.b.v + 1;
    this.b = b;
    await this.ctx.storage.put('board', b);
    return this.reply({ board: b, added, undo: undo.reverse() });
  }

  // Today's count of sentences in this object, moved by n; false when that would pass max.
  async count(n, max = Infinity) {
    const day = new Date().toISOString().slice(0, 10);
    const use = (await this.ctx.storage.get('talk')) || {};
    const now = use.day === day ? use.n : 0;
    if (n > 0 && now + n > max) return false;
    await this.ctx.storage.put('talk', { day, n: Math.max(0, now + n) });
    return true;
  }

  reply(b) { return new Response(JSON.stringify(b), { headers: { ...JSON_H, ...CORS } }); }

  async fetch(req) {
    const url = new URL(req.url);
    const ph = url.pathname.match(/\/photo\/([^/]+)\/?$/);
    if (ph) {
      const d = await this.ctx.storage.get('photo:' + ph[1]);
      const m = typeof d === 'string' && d.match(PHOTO_RE);
      if (!m) return plain('That photo is no longer kept.', 404);
      const bin = atob(m[2]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Response(bytes, { headers: { 'content-type': 'image/' + m[1], 'cache-control': 'private, max-age=31536000, immutable', ...CORS } });
    }
    if (url.pathname === '/meter') { // the one shared count for Say it (only this Worker can reach it)
      const n = Number(await req.text()) === -1 ? -1 : 1;
      return new Response(null, { status: (await this.count(n, TALK_ALL_DAY)) ? 204 : 429 });
    }
    if (/\/talk\/?$/.test(url.pathname)) return this.talk(req);
    const sub = url.pathname.match(/\/(push|ring)\/?$/);
    if (sub && req.method === 'GET') return this.reply({ ring: this.ring && Date.now() - this.ring.at < 120000 ? this.ring : null });
    if (sub) {
      const raw = await req.text();
      if (raw.length > 4000) return plain('That’s too big.');
      let o;
      try { o = JSON.parse(raw); } catch (e) { return plain('That couldn’t be read.'); }
      if (!o || typeof o !== 'object') return plain('That couldn’t be read.');
      try { return this.reply(sub[1] === 'push' ? await this.push(o, req) : await this.sendRing(o)); } catch (e) {
        if (e instanceof Bad) return plain(e.message);
        throw e;
      }
    }
    if (req.method === 'GET') {
      const b = this.b;
      // ?v= the version the page already has: answer briefly when nothing changed (it asks every 5 s).
      if (url.searchParams.get('v') === String(b.v)) return this.reply({ v: b.v, same: true });
      return this.reply(b);
    }
    const raw = await req.text(); // read in full even when too big: answering mid-upload breaks the connection
    if (raw.length > BODY_MAX) return plain('That’s too big to save. Try a smaller photo.');
    let o;
    try { o = JSON.parse(raw); } catch (e) { return plain('That change couldn’t be read.'); }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return plain('That change couldn’t be read.');
    // From here to this.b = ... there is no await, so two changes at once can't overwrite each other.
    const b = this.b;
    let next;
    try { next = this.apply(b, o); } catch (e) {
      if (e instanceof Bad) return plain(e.message);
      throw e;
    }
    if (!next) return this.reply(b); // nothing to do (already done, or already gone)
    next.board.v = b.v + 1;
    this.b = next.board;
    const puts = { board: next.board };
    if (next.photo) puts['photo:' + next.photo.id] = next.photo.data;
    // Not awaited one by one: the Durable Object holds the answer until both are written.
    const writes = [this.ctx.storage.put(puts)];
    if (next.drop && next.drop.length) writes.push(this.ctx.storage.delete(next.drop.map((id) => 'photo:' + id)));
    await Promise.all(writes);
    return this.reply(next.board);
  }

  // Checks everything first, then returns the new board (the old one is left alone), or null for "no change".
  apply(b, o) {
    const by = text(o.by, 'name', NAME_MAX, true);
    const nb = { ...b };
    const now = Date.now();
    switch (o.op) {
      case 'countdown.set':
        nb.countdown = { title: text(o.title, 'title'), at: when(o.at), by, set: now };
        return { board: nb };
      case 'countdown.clear':
        if (!b.countdown) return null;
        nb.countdown = null;
        return { board: nb };
      case 'todo.add': {
        const id = newId(o.id);
        const t = text(o.text, 'to-do');
        if (b.todos.some((x) => x.id === id)) return null;
        if (b.todos.length >= TODO_MAX) throw new Bad(`The list is full (${TODO_MAX}). Delete a few done ones first.`);
        nb.todos = b.todos.concat({ id, text: t, done: false, by, at: now });
        return { board: nb };
      }
      case 'todo.toggle': {
        const id = oldId(o.id);
        if (o.done != null && typeof o.done !== 'boolean') throw new Bad('“done” must be true or false.');
        const i = b.todos.findIndex((x) => x.id === id);
        if (i < 0) return null;
        const done = o.done == null ? !b.todos[i].done : o.done;
        if (done === b.todos[i].done) return null;
        nb.todos = b.todos.slice();
        nb.todos[i] = { ...b.todos[i], done, doneAt: done ? now : undefined };
        return { board: nb };
      }
      case 'todo.delete': {
        const id = oldId(o.id);
        if (!b.todos.some((x) => x.id === id)) return null;
        nb.todos = b.todos.filter((x) => x.id !== id);
        return { board: nb };
      }
      case 'event.add': {
        const id = newId(o.id);
        const ev = { id, title: text(o.title, 'title'), at: when(o.at), allDay: o.allDay === true, by };
        if (o.allDay != null && typeof o.allDay !== 'boolean') throw new Bad('“allDay” must be true or false.');
        if (b.events.some((x) => x.id === id)) return null;
        if (b.events.length >= EVENT_MAX) throw new Bad(`The calendar is full (${EVENT_MAX}). Delete a few old ones first.`);
        nb.events = b.events.concat(ev).sort((x, y) => x.at - y.at);
        return { board: nb };
      }
      case 'event.delete': {
        const id = oldId(o.id);
        if (!b.events.some((x) => x.id === id)) return null;
        nb.events = b.events.filter((x) => x.id !== id);
        return { board: nb };
      }
      case 'think': {
        const id = newId(o.id);
        const from = text(o.from, 'name', NAME_MAX);
        const note = text(o.note, 'note', TEXT_MAX, true);
        let photo = null;
        if (o.photo != null && o.photo !== '') {
          const m = typeof o.photo === 'string' && o.photo.match(PHOTO_RE);
          if (!m) throw new Bad('The photo must be a JPEG or WebP picture.');
          const b64 = m[2];
          const bytes = Math.floor(b64.length * 3 / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
          if (bytes > PHOTO_MAX) throw new Bad('That photo is too big (at most 400 KB).');
          photo = { id, data: o.photo };
        }
        if (b.thinks.some((x) => x.id === id)) return null;
        const all = [{ id, from, note, at: now, photo: !!photo }].concat(b.thinks);
        nb.thinks = all.slice(0, THINK_KEEP);
        return { board: nb, photo, drop: all.slice(THINK_KEEP).filter((x) => x.photo).map((x) => x.id) };
      }
      default:
        throw new Bad('Unknown change.');
    }
  }
}

export class Lobby {
  constructor(ctx) {
    this.ctx = ctx;
    this.queue = new Map(); // id -> [{ msg, at }]
  }

  sockets(id) { return this.ctx.getWebSockets(id).filter((s) => s.readyState === 1); }
  info(ws) { try { return ws.deserializeAttachment() || {}; } catch (e) { return {}; } }

  async fetch(req) {
    const url = new URL(req.url);
    const id = url.searchParams.get('id') || '';
    const token = url.searchParams.get('token') || '';
    const pair = new WebSocketPair();
    const [client, ws] = Object.values(pair);
    if (!id || id.length > 64 || !/^[A-Za-z0-9_-]+$/.test(id) || !token) {
      ws.accept();
      ws.send(JSON.stringify({ type: 'ERROR', payload: { msg: 'No id, token, or key supplied to websocket server' } }));
      ws.close(1008, 'bad id');
      return new Response(null, { status: 101, webSocket: client });
    }
    const now = Date.now();
    const old = this.sockets(id).filter((o) => {
      if (now - (this.info(o).seen || 0) < STALE_MS) return true;
      try { o.close(1001, 'stale'); } catch (e) {}
      return false;
    });
    if (old.some((o) => this.info(o).token !== token)) {
      // Someone else holds this id (Beside reads this as "your link is busy").
      ws.accept();
      ws.send(JSON.stringify({ type: 'ID-TAKEN', payload: { msg: 'ID is taken' } }));
      ws.close(1008, 'id taken');
      return new Response(null, { status: 101, webSocket: client });
    }
    // Same browser coming back (a reconnect): the new socket replaces the old one.
    old.forEach((o) => { try { o.close(1000, 'replaced'); } catch (e) {} });
    this.ctx.acceptWebSocket(ws, [id]);
    ws.serializeAttachment({ id, token, seen: now });
    ws.send(JSON.stringify({ type: 'OPEN' }));
    const waiting = this.queue.get(id);
    if (waiting) {
      this.queue.delete(id);
      waiting.forEach((q) => { try { ws.send(q.msg); } catch (e) {} });
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(ws, raw) {
    const me = this.info(ws);
    if (!me.id || typeof raw !== 'string' || raw.length > 256 * 1024) return;
    me.seen = Date.now();
    ws.serializeAttachment(me);
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m.type !== 'string' || m.type === 'HEARTBEAT') return;
    const dst = typeof m.dst === 'string' ? m.dst : '';
    if (m.type === 'LEAVE' && !dst) { try { ws.close(1000, 'leave'); } catch (e) {} return; }
    if (!dst) return;
    const out = JSON.stringify({ type: m.type, src: me.id, dst, payload: m.payload });
    const to = this.sockets(dst).filter((s) => s !== ws);
    if (to.length) {
      to.forEach((s) => { try { s.send(out); } catch (e) {} });
      return;
    }
    if (m.type === 'LEAVE' || m.type === 'EXPIRE') return;
    this.hold(dst, out, me.id);
  }

  hold(dst, msg, src) {
    const list = this.queue.get(dst) || [];
    if (list.length >= 50) return;
    list.push({ msg, src, at: Date.now() });
    this.queue.set(dst, list);
    this.ctx.storage.getAlarm().then((a) => { if (a == null) this.ctx.storage.setAlarm(Date.now() + QUEUE_MS); });
  }

  // Messages nobody collected: tell each sender the other browser isn't there (PeerJS: "peer-unavailable").
  async alarm() {
    const now = Date.now();
    const told = new Set();
    for (const [dst, list] of this.queue) {
      const keep = list.filter((q) => now - q.at < QUEUE_MS);
      list.filter((q) => now - q.at >= QUEUE_MS).forEach((q) => {
        const key = q.src + '>' + dst;
        if (told.has(key)) return;
        told.add(key);
        const exp = JSON.stringify({ type: 'EXPIRE', src: dst, dst: q.src });
        this.sockets(q.src).forEach((s) => { try { s.send(exp); } catch (e) {} });
      });
      if (keep.length) this.queue.set(dst, keep); else this.queue.delete(dst);
    }
    if (this.queue.size) await this.ctx.storage.setAlarm(Date.now() + 1000);
  }

  webSocketClose(ws) { try { ws.close(1000, 'bye'); } catch (e) {} }
  webSocketError(ws) { try { ws.close(1011, 'error'); } catch (e) {} }
}
