/* Beside's call server. It speaks the PeerJS server protocol, so the PeerJS client in Beside works
   unchanged: each browser keeps one WebSocket open with its id, and OFFER / ANSWER / CANDIDATE / LEAVE
   messages are passed to the browser they're addressed to. One Durable Object holds every socket, so
   two browsers anywhere in the world always meet in the same place. It never sees the picture or sound.

   /peerjs/health   is it up (Beside checks this before choosing a server)
   /peerjs/turn     short-lived relay passwords (Cloudflare TURN) for networks that block direct calls
   .../peerjs/id    a fresh random id (PeerJS asks for one when it isn't given one)
   .../peerjs?id=   the WebSocket */

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
