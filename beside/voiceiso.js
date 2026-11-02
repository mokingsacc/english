/* Voice isolation for Voice focus: removes typing, fans and other sounds, keeps the voice.
   RNNoise (a small learned noise remover, vendor/rnnoise/) runs on the audio thread in an AudioWorklet.
   This one file is both halves: on the page it is window.BesideIso, and inside the worklet it is the processor.
   Use:  const iso = await BesideIso.load(ctx);  if (iso.ok) { mic.connect(iso.node); iso.node.connect(rest); }
   Or, once load(ctx) has run for that context:  const n = BesideIso.node(ctx);  (a new node at once, or null).
   Only at 48 kHz (RNNoise's own rate): any other rate gives ok:false, so make the context with
   { sampleRate: 48000 } or keep the plain chain. It never lifts or lowers the voice; the app's chain does that.
   Library: @jitsi/rnnoise-wasm 0.2.1's rnnoise.wasm (RNNoise 0.1), used without its loader. */
(() => {
  'use strict';
  const RATE = 48000;
  const FRAME = 480; // RNNoise's 10 ms frame
  // 128-sample render quanta fill a 480-sample frame unevenly; 448 samples of lead mean the next frame is
  // always ready in time. RNNoise itself answers one frame late (its window overlaps the frame before).
  const LEAD = 448;
  const DELAY = LEAD + FRAME; // 928 samples, 19.3 ms in all

  // ---------- THE WORKLET (audio thread) ----------
  if (typeof registerProcessor === 'function') {
    let MOD = null; // compiled once per audio context
    // How sure RNNoise must be. At OPEN or above it is speech, and the gate stays open for HOLD frames after
    // (word endings and soft sounds like f, s and th often score low). It closes only when the score
    // stays under SHUT. Closed is FLOOR on top of RNNoise's own clean-up.
    const OPEN = 0.5, SHUT = 0.2, HOLD = 25, FLOOR = 0.0316; // 250 ms; -30 dB
    // A word's first sounds can score low, but RNNoise keeps most of them: keeping KEEP (-6 dB) or more of a
    // frame opens the gate for SOFT frames (30 ms) too. Clicks and fans are cut far more than that.
    const KEEP = 0.25, SOFT = 3;
    // The gate's own movement: opens in about 2 ms, closes in about 30 ms, never a jump.
    const UP = 1 - Math.exp(-1 / (0.002 * RATE)), DOWN = 1 - Math.exp(-1 / (0.03 * RATE));
    const RING = 2048, MASK = RING - 1;
    class Iso extends AudioWorkletProcessor {
      constructor(o) {
        super();
        this.live = true; this.seen = false; this.idle = 0;
        this.x = null;
        this.fin = new Float32Array(FRAME); this.nin = 0;
        this.ring = new Float32Array(RING);
        this.h = { frames: 0, underruns: 0, late: 0, lateMs: 0, vad: 0, busy: null };
        this.vsum = 0; this.vn = 0; this.q = 0; this.wall = 0; this.audio = 0; this.last = 0; this.spent = 0;
        this.clock = typeof performance !== 'undefined' && performance.now ? () => performance.now() : null;
        this.port.onmessage = (e) => { if (e.data && e.data.type === 'close') this.end(); };
        try {
          if (!MOD) MOD = new WebAssembly.Module(o && o.processorOptions && o.processorOptions.wasm);
          this.wake();
          this.port.postMessage({ type: 'ready', latency: DELAY / RATE });
        } catch (e) {
          this.x = null;
          this.port.postMessage({ type: 'error', message: String(e && e.message || e) });
        }
      }
      // A fresh RNNoise (its own 16 MB of memory), and a fresh start for the gate and the buffers.
      wake() {
        let mem = null;
        // The two things the compiled code asks of us: grow its memory, and a big copy.
        const inst = new WebAssembly.Instance(MOD, { a: {
          a: (n) => { try { mem.grow(((n >>> 0) - mem.buffer.byteLength + 65535) >>> 16); return 1; } catch (e) { return 0; } },
          b: (d, s, n) => { new Uint8Array(mem.buffer).copyWithin(d, s, s + n); },
        } });
        const x = inst.exports; mem = x.c; x.d();
        // e init, f create, g malloc, h destroy, i free, j process frame (from the library's own loader).
        this.x = { mem, run: x.j, kill: x.h, free: x.i, st: x.f(0), pin: x.g(FRAME * 4), pout: x.g(FRAME * 4) };
        this.ring.fill(0); this.r = 0; this.w = LEAD; this.nin = 0;
        this.g = FLOOR; this.ein = 0; this.keep = 0; this.hold = 0; this.prev = 0; this.shut = true;
      }
      sleep() {
        const x = this.x; this.x = null;
        if (x) { try { x.free(x.pin); x.free(x.pout); x.kill(x.st); } catch (e) {} }
      }
      end() {
        if (!this.live) return;
        this.live = false;
        this.sleep();
        this.port.postMessage({ type: 'ended' });
      }
      // One 10 ms frame: clean it, then the gate from RNNoise's speech score. The cleaned frame is the one before
      // this input, so this frame's score is a 10 ms look ahead: a word's start opens the gate before it plays.
      frame() {
        const x = this.x, t0 = this.clock ? this.clock() : 0;
        // Views into RNNoise's memory, made again only if its memory grew (no garbage on the audio thread).
        if (x.buf !== x.mem.buffer) { x.buf = x.mem.buffer; x.fi = new Float32Array(x.buf, x.pin, FRAME); x.fo = new Float32Array(x.buf, x.pout, FRAME); }
        const fi = x.fi;
        let ein = 0;
        for (let i = 0; i < FRAME; i++) { const a = this.fin[i]; ein += a * a; fi[i] = a * 32768; }
        let v = x.run(x.st, x.pout, x.pin);
        if (!(v >= 0)) v = 1;
        if (x.buf !== x.mem.buffer) { x.buf = x.mem.buffer; x.fi = new Float32Array(x.buf, x.pin, FRAME); x.fo = new Float32Array(x.buf, x.pout, FRAME); }
        const fo = x.fo;
        let eout = 0;
        for (let i = 0; i < FRAME; i++) eout += fo[i] * fo[i];
        eout /= 1073741824;
        // How much of the sound RNNoise kept. It keeps most of a word's first sounds before its score catches up.
        this.keep = eout / (this.ein + 1e-12);
        this.ein = ein;
        const s = Math.max(v, this.prev);
        this.prev = v;
        if (s >= OPEN) { this.hold = HOLD; this.shut = false; }
        else if (this.keep > KEEP && eout > 1e-7 * FRAME) { if (this.hold < SOFT) this.hold = SOFT; this.shut = false; }
        else if (this.hold > 0) this.hold--;
        else if (s < SHUT) this.shut = true;
        const want = this.shut ? FLOOR : 1;
        let g = this.g, w = this.w;
        for (let i = 0; i < FRAME; i++) {
          g += (want - g) * (want > g ? UP : DOWN);
          this.ring[w & MASK] = fo[i] / 32768 * g; w++;
        }
        this.g = g; this.w = w;
        this.vsum += v; this.vn++; this.h.frames++;
        if (this.clock) this.spent += this.clock() - t0;
      }
      process(inputs, outputs) {
        if (!this.live) return false;
        const out = outputs[0][0];
        const inp = inputs[0] && inputs[0][0];
        const n = out.length;
        // Nothing connected: silence. After a second RNNoise's memory is let go (it comes back with the input,
        // as when a mic is swapped); after a minute the node ends, so a rebuilt chain leaves nothing running.
        if (!inp) {
          if (this.seen) {
            this.idle++;
            if (this.idle === 375) this.sleep();
            if (this.idle > 22500) { this.end(); return false; }
          }
          return true;
        }
        if (this.idle >= 375 && MOD) { try { this.wake(); } catch (e) { this.x = null; } }
        this.seen = true; this.idle = 0;
        if (!this.x) { out.set(inp); return true; } // no RNNoise: the plain sound
        for (let i = 0; i < n; i++) {
          this.fin[this.nin++] = inp ? inp[i] : 0;
          if (this.nin === FRAME) { this.frame(); this.nin = 0; }
        }
        if (this.w - this.r < n) { this.h.underruns++; this.w = this.r + n; } // should never happen; counted
        for (let i = 0; i < n; i++) out[i] = this.ring[(this.r + i) & MASK];
        this.r += n;
        this.tick(n);
        return true;
      }
      // About once a second: is the audio thread keeping up with the wall clock? More than 30 ms behind in a
      // second means sound was lost (the computer couldn't keep up). A stop (a paused engine, a new output) isn't counted.
      tick(n) {
        const now = Date.now();
        // A stop of over 100 ms (the engine paused, or the sound moved to AirPods or the speaker) starts the
        // count again: that is the system, not the computer falling behind.
        if (!this.last || now - this.last > 100) { this.wall = now; this.audio = 0; this.spent = 0; }
        this.last = now;
        this.audio += n;
        if (++this.q < 375) return;
        this.q = 0;
        const wallMs = now - this.wall, audioMs = this.audio * 1000 / RATE;
        if (wallMs - audioMs > 30) { this.h.late++; this.h.lateMs += Math.round(wallMs - audioMs); }
        this.h.vad = this.vn ? Math.round(this.vsum / this.vn * 100) / 100 : 0;
        this.h.busy = this.clock && audioMs > 0 ? Math.round(this.spent / audioMs * 1000) / 1000 : null;
        this.vsum = 0; this.vn = 0; this.wall = now; this.audio = 0; this.spent = 0;
        this.port.postMessage({ type: 'health', ...this.h });
      }
    }
    registerProcessor('beside-iso', Iso);
    return;
  }

  // ---------- THE PAGE ----------
  if (typeof window === 'undefined' || window.BesideIso) return;
  const SELF = (document.currentScript && document.currentScript.src) || new URL('voiceiso.js', location.href).href;
  const WASM = new URL('vendor/rnnoise/rnnoise.wasm', SELF).href;
  let bytes = null; // the library's file, fetched once
  const per = new WeakMap(); // context: { p: its warm-up, ready, bad: why RNNoise failed there }
  const AC = window.AudioContext || window.webkitAudioContext;
  function supported() {
    return !!(typeof WebAssembly === 'object' && WebAssembly.Instance && window.AudioWorkletNode && AC &&
      'audioWorklet' in AC.prototype);
  }
  function why(ctx) {
    if (!supported() || !ctx || !ctx.audioWorklet) return 'no AudioWorklet or WebAssembly here';
    if (ctx.sampleRate !== RATE) return 'needs a 48 kHz audio context, this one is ' + ctx.sampleRate;
    return '';
  }
  // Fetch the library once, and add the worklet to this context once.
  function warm(ctx) {
    let st = per.get(ctx);
    if (!st) { st = { p: null, ready: false, bad: '', b: null }; per.set(ctx, st); }
    if (!st.p) {
      st.p = (async () => {
        if (!bytes) bytes = fetch(WASM).then((r) => { if (!r.ok) throw new Error('rnnoise.wasm ' + r.status); return r.arrayBuffer(); });
        st.b = await bytes.catch((e) => { bytes = null; throw e; });
        await ctx.audioWorklet.addModule(SELF);
        st.ready = true;
      })().catch((e) => { st.p = null; throw e; });
    }
    return st.p;
  }
  // A new node (each chain needs its own). Its health comes in about once a second.
  function make(ctx, st) {
    const node = new AudioWorkletNode(ctx, 'beside-iso', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      channelCount: 1, channelCountMode: 'explicit', channelInterpretation: 'speakers',
      processorOptions: { wasm: st.b.slice(0) },
    });
    const res = { node, ok: true, reason: '', latency: DELAY / RATE, health: { frames: 0, underruns: 0, late: 0, lateMs: 0, vad: 0, busy: null }, onhealth: null,
      close() { try { node.port.postMessage({ type: 'close' }); } catch (e) {} try { node.disconnect(); } catch (e) {} res.ok = false; } };
    // The worklet says ready, or that RNNoise failed (then it passes the sound through unchanged).
    res.answer = new Promise((done) => {
      node.port.onmessage = (e) => {
        const d = e.data || {};
        if (d.type === 'health') { res.health = d; if (res.onhealth) { try { res.onhealth(d); } catch (x) {} } }
        if (d.type === 'error') { st.bad = d.message || 'RNNoise failed'; res.ok = false; res.reason = st.bad; }
        if (d.type === 'ended') { res.ok = false; res.reason = 'ended'; }
        if (d.type === 'ready' || d.type === 'error') done(d);
      };
    });
    node.iso = res;
    return res;
  }
  const off = (reason) => ({ node: null, ok: false, reason, latency: 0, health: null, onhealth: null, close() {} });
  // Returns { node, ok, close(), latency, health, onhealth, reason }. node: 1 in, 1 out, mono; put it first.
  // health: { frames, underruns, late, lateMs, vad, busy }, updated each second; onhealth(h) is called then too.
  // The second time for the same context it is quick: the library and the worklet are already there.
  async function load(ctx) {
    const no = why(ctx);
    if (no) return off(no);
    try {
      await warm(ctx);
      const st = per.get(ctx);
      if (st.bad) return off(st.bad);
      const res = make(ctx, st);
      let t = 0;
      const late = new Promise((done) => { t = setTimeout(() => done({ type: 'error', message: 'the audio thread did not answer' }), 3000); });
      const first = await Promise.race([res.answer, late]);
      clearTimeout(t);
      if (first.type !== 'ready') { res.close(); return off(first.message); }
      return res;
    } catch (e) {
      return off(String(e && e.message || e));
    }
  }
  // For a chain built in one go: a new node at once if this context is ready, else null, and it gets ready in
  // the background; then(), if given, is called once when it is (to build the chain again). node.iso has the
  // same health, onhealth and close(). A node left with no input frees RNNoise after a second and ends after
  // a minute (or call node.iso.close()).
  function node(ctx, then) {
    if (why(ctx)) return null;
    const st = per.get(ctx);
    if (!st || !st.ready) {
      const p = warm(ctx), s2 = per.get(ctx);
      if (then && !s2.then) { s2.then = then; p.then(() => { if (!s2.bad) { try { then(); } catch (e) {} } }, () => { s2.then = null; }); }
      return null;
    }
    if (st.bad) return null;
    try { return make(ctx, st).node; } catch (e) { return null; }
  }
  // Resolves true once node(ctx) can give nodes for this context (false if it never can), without making one.
  async function ready(ctx) {
    if (why(ctx)) return false;
    try { await warm(ctx); return !per.get(ctx).bad; } catch (e) { return false; }
  }
  window.BesideIso = { supported, load, node, ready, RATE, latency: DELAY / RATE };
})();
