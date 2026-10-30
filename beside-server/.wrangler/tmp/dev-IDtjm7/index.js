var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.js
var STALE_MS = 3e4;
var QUEUE_MS = 5e3;
var TURN_TTL = 12 * 3600;
var JSON_H = { "content-type": "application/json", "cache-control": "no-store" };
var src_default = {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (p === "/peerjs/health") return new Response('{"ok":true}', { headers: { ...JSON_H, "access-control-allow-origin": "*" } });
    if (p === "/peerjs/turn") return turn(req, env);
    if (/\/peerjs\/id$/.test(p)) return new Response(crypto.randomUUID(), { headers: { "cache-control": "no-store", "access-control-allow-origin": "*" } });
    if (/\/peerjs$/.test(p) && req.headers.get("upgrade") === "websocket") {
      return env.LOBBY.get(env.LOBBY.idFromName("lobby")).fetch(req);
    }
    return new Response("Not found", { status: 404 });
  }
};
function ownPage(req) {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  const o = req.headers.get("origin") || req.headers.get("referer") || "";
  if (!o) return !!site;
  try {
    return new URL(o).host === new URL(req.url).host;
  } catch (e) {
    return false;
  }
}
__name(ownPage, "ownPage");
async function turn(req, env) {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_TOKEN) return new Response('{"iceServers":[]}', { headers: JSON_H });
  if (!ownPage(req)) return new Response('{"iceServers":[]}', { status: 403, headers: JSON_H });
  const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
    method: "POST",
    headers: { authorization: "Bearer " + env.TURN_KEY_TOKEN, "content-type": "application/json" },
    body: JSON.stringify({ ttl: TURN_TTL })
  });
  if (!r.ok) return new Response('{"iceServers":[]}', { status: 502, headers: JSON_H });
  const j = await r.json();
  const iceServers = (j.iceServers || []).map((s) => ({
    ...s,
    urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u))
  })).filter((s) => s.urls.length);
  return new Response(JSON.stringify({ iceServers, ttl: TURN_TTL }), { headers: JSON_H });
}
__name(turn, "turn");
var Lobby = class {
  static {
    __name(this, "Lobby");
  }
  constructor(ctx) {
    this.ctx = ctx;
    this.queue = /* @__PURE__ */ new Map();
  }
  sockets(id) {
    return this.ctx.getWebSockets(id).filter((s) => s.readyState === 1);
  }
  info(ws) {
    try {
      return ws.deserializeAttachment() || {};
    } catch (e) {
      return {};
    }
  }
  async fetch(req) {
    const url = new URL(req.url);
    const id = url.searchParams.get("id") || "";
    const token = url.searchParams.get("token") || "";
    const pair = new WebSocketPair();
    const [client, ws] = Object.values(pair);
    if (!id || id.length > 64 || !/^[A-Za-z0-9_-]+$/.test(id) || !token) {
      ws.accept();
      ws.send(JSON.stringify({ type: "ERROR", payload: { msg: "No id, token, or key supplied to websocket server" } }));
      ws.close(1008, "bad id");
      return new Response(null, { status: 101, webSocket: client });
    }
    const now = Date.now();
    const old = this.sockets(id).filter((o) => {
      if (now - (this.info(o).seen || 0) < STALE_MS) return true;
      try {
        o.close(1001, "stale");
      } catch (e) {
      }
      return false;
    });
    if (old.some((o) => this.info(o).token !== token)) {
      ws.accept();
      ws.send(JSON.stringify({ type: "ID-TAKEN", payload: { msg: "ID is taken" } }));
      ws.close(1008, "id taken");
      return new Response(null, { status: 101, webSocket: client });
    }
    old.forEach((o) => {
      try {
        o.close(1e3, "replaced");
      } catch (e) {
      }
    });
    this.ctx.acceptWebSocket(ws, [id]);
    ws.serializeAttachment({ id, token, seen: now });
    ws.send(JSON.stringify({ type: "OPEN" }));
    const waiting = this.queue.get(id);
    if (waiting) {
      this.queue.delete(id);
      waiting.forEach((q) => {
        try {
          ws.send(q.msg);
        } catch (e) {
        }
      });
    }
    return new Response(null, { status: 101, webSocket: client });
  }
  webSocketMessage(ws, raw) {
    const me = this.info(ws);
    if (!me.id || typeof raw !== "string" || raw.length > 256 * 1024) return;
    me.seen = Date.now();
    ws.serializeAttachment(me);
    let m;
    try {
      m = JSON.parse(raw);
    } catch (e) {
      return;
    }
    if (!m || typeof m.type !== "string" || m.type === "HEARTBEAT") return;
    const dst = typeof m.dst === "string" ? m.dst : "";
    if (m.type === "LEAVE" && !dst) {
      try {
        ws.close(1e3, "leave");
      } catch (e) {
      }
      return;
    }
    if (!dst) return;
    const out = JSON.stringify({ type: m.type, src: me.id, dst, payload: m.payload });
    const to = this.sockets(dst).filter((s) => s !== ws);
    if (to.length) {
      to.forEach((s) => {
        try {
          s.send(out);
        } catch (e) {
        }
      });
      return;
    }
    if (m.type === "LEAVE" || m.type === "EXPIRE") return;
    this.hold(dst, out, me.id);
  }
  hold(dst, msg, src) {
    const list = this.queue.get(dst) || [];
    if (list.length >= 50) return;
    list.push({ msg, src, at: Date.now() });
    this.queue.set(dst, list);
    this.ctx.storage.getAlarm().then((a) => {
      if (a == null) this.ctx.storage.setAlarm(Date.now() + QUEUE_MS);
    });
  }
  // Messages nobody collected: tell each sender the other browser isn't there (PeerJS: "peer-unavailable").
  async alarm() {
    const now = Date.now();
    const told = /* @__PURE__ */ new Set();
    for (const [dst, list] of this.queue) {
      const keep = list.filter((q) => now - q.at < QUEUE_MS);
      list.filter((q) => now - q.at >= QUEUE_MS).forEach((q) => {
        const key = q.src + ">" + dst;
        if (told.has(key)) return;
        told.add(key);
        const exp = JSON.stringify({ type: "EXPIRE", src: dst, dst: q.src });
        this.sockets(q.src).forEach((s) => {
          try {
            s.send(exp);
          } catch (e) {
          }
        });
      });
      if (keep.length) this.queue.set(dst, keep);
      else this.queue.delete(dst);
    }
    if (this.queue.size) await this.ctx.storage.setAlarm(Date.now() + 1e3);
  }
  webSocketClose(ws) {
    try {
      ws.close(1e3, "bye");
    } catch (e) {
    }
  }
  webSocketError(ws) {
    try {
      ws.close(1011, "error");
    } catch (e) {
    }
  }
};

// ../../../../root/.npm/_npx/7f3444e3cc855b0c/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../../../root/.npm/_npx/7f3444e3cc855b0c/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-H7shTT/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../../../root/.npm/_npx/7f3444e3cc855b0c/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-H7shTT/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  Lobby,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
