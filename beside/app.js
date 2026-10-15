/* Beside: share one tab or one app window and talk, with nothing in between.
   Audio and video go peer to peer (WebRTC, encrypted). PeerJS's free server
   (0.peerjs.com) only introduces the two browsers; it never sees the picture or sound. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const qs = new URLSearchParams(location.search);
  const PREFIX = 'beside-';
  const ICE = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];
  // ?srv=host:port points at a local PeerJS server. Only honoured on this computer (automated tests).
  const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const srv = LOCAL ? qs.get('srv') : null;
  const PEER_OPTS = srv
    ? { host: srv.split(':')[0], port: +srv.split(':')[1], path: '/', secure: false, config: { iceServers: [] }, debug: 0 }
    : { config: { iceServers: ICE }, debug: 0 };
  const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
  const NET_ERR = /^(network|server-error|socket-error|socket-closed)$/;
  const IS_CHROMIUM = !!navigator.userAgentData;
  // iPhone and iPad (an iPad says it's a Mac): Apple's "Screen Sharing" sheet opens but never hands the picture
  // to a web page, which left the page stuck. They watch and talk instead.
  const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const CAN_SHARE = !IS_IOS && !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  const NO_SHARE = IS_IOS
    ? 'iPhone and iPad can watch and talk, but can’t share. Open this page in Chrome on your Mac to share.'
    : 'This browser can’t share its screen, only watch. Open this page in Chrome on a computer to share.';

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  function code8() {
    const a = new Uint32Array(8);
    crypto.getRandomValues(a);
    return Array.from(a, (n) => ALPHA[n % ALPHA.length]).join('');
  }
  // Link looks like  .../beside/#k7m2abcd-Mo  : 8-letter room code, then the host's name.
  const hashM = location.hash.slice(1).match(/^([a-z0-9]{8})(?:-(.*))?$/);
  const guestCode = hashM ? hashM[1] : '';
  const isGuest = !!guestCode;
  function cleanName(n) { return String(n || '').replace(/[^\p{L}\p{N} .'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20); }
  let theirName = '';
  try { theirName = cleanName(decodeURIComponent((hashM && hashM[2]) || '')); } catch (e) { theirName = ''; }

  // ---------- UI helpers ----------
  const app = { state: '', log: [], states: [], guestPeers: 0, hostPeers: 0 };
  window.__beside = app; // for the automated tests
  function show(state) {
    if (app.state !== state) { app.states.push(state); if (app.states.length > 300) app.states.shift(); }
    app.state = state;
    document.body.dataset.app = state;
    document.querySelectorAll('[data-state]').forEach((el) => {
      if (el.dataset.state === 'check') return; // the check panel is an overlay
      el.hidden = !el.dataset.state.split(' ').includes(state);
    });
    if (state === 'live' || state === 'watching') { layout(); wakeControls(); }
    else { closeMore(); document.body.classList.remove('idle'); }
    if (!isGuest) hostTitle();
  }
  function text(id, s) { const el = $(id); if (el) el.textContent = s; }
  function on(id, ev, fn) { const el = $(id); if (el) el.addEventListener(ev, fn); }
  let noteTimer = 0;
  function note(msg, kind) {
    app.log.push(msg);
    const el = $('note');
    if (!el) return;
    clearTimeout(noteTimer);
    if (!msg) { el.hidden = true; return; }
    el.textContent = msg;
    const x = document.createElement('button');
    x.setAttribute('aria-label', 'Close');
    x.textContent = '×';
    x.onclick = () => { el.hidden = true; };
    el.appendChild(x);
    el.dataset.kind = kind || 'info';
    el.hidden = false;
    if (kind !== 'stay') noteTimer = setTimeout(() => { el.hidden = true; }, 7000);
  }
  function setLag(id, ms) {
    const el = $(id);
    if (!el) return;
    const tgt = el.querySelector('b') || el;
    const q = ms == null ? 'none' : ms < 80 ? 'calm' : ms < 200 ? 'ok' : 'bad';
    el.classList.remove('none', 'calm', 'ok', 'bad');
    el.classList.add(q);
    tgt.textContent = ms == null ? '–' : Math.round(ms) + ' ms';
    el.title = ms == null ? '' : 'Round trip between you: ' + Math.round(ms) + ' ms. Under 80 is great, under 200 is fine.';
  }
  function setPressed(id, pressed, onLabel, offLabel) {
    const el = $(id);
    if (!el) return;
    el.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    const lab = el.querySelector('.label-t');
    if (onLabel && lab) lab.textContent = pressed ? onLabel : offLabel;
    if (onLabel && !lab) el.setAttribute('aria-label', pressed ? onLabel : offLabel);
  }
  function peerLibOk() {
    if (window.Peer) return true;
    note('Part of the page did not load. Reload the page, and if that fails check your internet.', 'stay');
    return false;
  }

  let wakeLock = null;
  async function stayAwake(want) {
    try {
      if (!want) { if (wakeLock) await wakeLock.release(); wakeLock = null; return; }
      if (navigator.wakeLock && !wakeLock && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (e) { /* not supported or not allowed: harmless */ }
  }

  // ---------- CAMERA (both sides) ----------
  // Faces ride in a second, small video lane of the same call: 480×360, 15 fps, at most 300 kbit/s, and the
  // screen gets priority, so the shared screen stays as sharp and quick as without the camera.
  const CAM = { width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 15, max: 15 }, facingMode: 'user' };
  function blankTrack() {
    // Holds the camera lane open while the camera is off. It never draws, so it sends nothing.
    try {
      const c = document.createElement('canvas');
      c.width = 16; c.height = 12;
      c.getContext('2d').fillRect(0, 0, 16, 12);
      return c.captureStream(0).getVideoTracks()[0] || null;
    } catch (e) { return null; }
  }
  function tuneCam(s) {
    if (!s) return;
    const apply = (withPri) => {
      const p = s.getParameters();
      if (!p.encodings || !p.encodings.length) return Promise.resolve(); // not connected yet: onGood tunes it
      p.encodings[0].maxBitrate = 300000;
      p.encodings[0].maxFramerate = 15;
      if (withPri) { p.encodings[0].priority = 'low'; p.encodings[0].networkPriority = 'low'; }
      return s.setParameters(p);
    };
    try { apply(true).catch(() => { try { apply(false).catch(() => {}); } catch (e) {} }); } catch (e) {}
  }
  // The video lanes of a call, in the order its offer lists them: 0 is the shared screen, 1 the sharer's camera.
  // (The guest's camera comes back on lane 0, the only lane the guest sends on.)
  function lane(pc, i) {
    try {
      const offer = [pc.localDescription, pc.remoteDescription].find((d) => d && d.type === 'offer');
      if (!offer) return null;
      const mids = [];
      let kind = '';
      offer.sdp.split(/\r?\n/).forEach((l) => {
        if (l.startsWith('m=')) kind = l.slice(2).split(' ')[0];
        else if (kind === 'video' && l.startsWith('a=mid:')) mids.push(l.slice(6).trim());
      });
      if (mids[i] == null) return null;
      const t = pc.getTransceivers().find((x) => x.mid === mids[i]);
      return (t && t.receiver && t.receiver.track) || null;
    } catch (e) { return null; }
  }
  // Ask for a small camera picture; if this camera can't do that (or answers oddly), take any picture it gives:
  // the 300 kbit/s cap on the lane keeps it small either way.
  async function getCam() {
    try {
      return await navigator.mediaDevices.getUserMedia({ video: CAM });
    } catch (e) {
      if (!e || !/^(OverconstrainedError|NotFoundError|NotReadableError|AbortError|TypeError)$/.test(e.name)) throw e;
      const s = await navigator.mediaDevices.getUserMedia({ video: true });
      const t = s.getVideoTracks()[0];
      if (t) t.applyConstraints({ width: { ideal: 480 }, height: { ideal: 360 }, frameRate: { ideal: 15 } }).catch(() => {});
      return s;
    }
  }
  function camError(e) {
    const n = e && e.name;
    if (n === 'NotAllowedError' && /system/i.test((e && e.message) || '')) return 'Your Mac is blocking the camera for this browser. Open System Settings, Privacy & Security, Camera, turn your browser on, then reopen it.';
    if (n === 'NotAllowedError') return 'Your camera is blocked for this site. Click the icon at the left of the address bar (on iPhone: aA, then Website Settings), allow the camera, then press the camera button again.';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'Your browser can’t see a camera. On a MacBook with the lid closed the built-in camera is off: open the lid or plug in a webcam, then press Camera again.';
    if (n === 'NotReadableError') return 'Your camera is busy in another app. Close it there, then press the camera button again.';
    return 'The camera didn’t start (' + (n || 'unknown') + '). Try again.';
  }
  // PeerJS adds a stream's tracks in getTracks() order, and browsers order that differently: pin our order,
  // so the lanes of a call are always [audio, screen, camera] (offer) and [mic, camera, screen] (answer).
  function ordered(list) {
    const l = list.filter(Boolean);
    const s = new MediaStream(l);
    try { s.getTracks = () => l.slice(); } catch (e) { /* the default order is the next best thing */ }
    return s;
  }
  const VER = 2;
  function tell(conn, msg) { try { if (conn && conn.open) conn.send(msg); } catch (e) { /* the link is going anyway */ } }

  async function rtt(pc) {
    if (!pc) return null;
    try {
      const stats = await pc.getStats();
      let best = null;
      stats.forEach((r) => {
        if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.currentRoundTripTime != null) {
          if (r.nominated || best == null) best = r.currentRoundTripTime * 1000;
        }
      });
      return best;
    } catch (e) { return null; }
  }
  // onFail(neverConnected): true means the networks never let the call through.
  function iceProblem(pc, onFail, onShaky, onGood) {
    let was = false;
    pc.addEventListener('iceconnectionstatechange', () => {
      const s = pc.iceConnectionState;
      if (s === 'failed') onFail(!was);
      else if (s === 'disconnected') onShaky();
      else if (s === 'connected' || s === 'completed') { was = true; onGood(); }
    });
  }
  const NET_WHY = 'One of your networks blocks this kind of call (common on work, school and hospital Wi-Fi, and some mobile data). Try a different network for one of you, such as home Wi-Fi.';
  const NET_FAIL = 'Couldn’t connect you two directly. ' + NET_WHY;
  const KNOCK_FAIL = ' is trying to join but can’t connect. ';

  // Put H.264 first: Macs and iPhones encode and decode it in hardware (less lag, less battery). Others stay as fallback.
  function preferH264(sdp) {
    return sdp.replace(/^(m=video \d+ [A-Z/]+ )([\d ]+)(\r?)$/gm, (line, head, pts, cr) => {
      const ids = pts.trim().split(' ');
      const score = (id) => {
        const f = (sdp.match(new RegExp('^a=fmtp:' + id + ' (.*)$', 'm')) || [])[1] || '';
        return (/packetization-mode=1/.test(f) ? 0 : 2) + (/profile-level-id=42e0/i.test(f) ? 0 : 1);
      };
      const h264 = ids.filter((id) => new RegExp('^a=rtpmap:' + id + ' H264/', 'm').test(sdp)).sort((a, b) => score(a) - score(b));
      if (!h264.length) return line;
      return head + h264.concat(ids.filter((id) => !h264.includes(id))).join(' ') + cr;
    });
  }

  // ---------- VIEW (one call stage for both roles) ----------
  // One tile is big, the others float as bubbles. Big = the tile you tapped (while it's there), else the shared
  // screen, else the other person's face, else their initial. A host alone sees the invite card instead.
  const V = { pin: '' };
  const PERSON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
  function amSharing() { return isGuest ? !!G.screenTrack : !!H.video && !!H.me && H.sharer === H.me; }
  function sharerId() { return isGuest ? (G.room && G.room.sharer) || '' : H.sharer; }
  function screenSource() {
    if (!isGuest) return roomTrack();
    if (G.screenTrack) return G.screenTrack;
    const pc = G.call && G.call.peerConnection;
    const me = G.peer && G.peer.id;
    return pc && G.room && G.room.sharer && G.room.sharer !== me ? lane(pc, 0) : null;
  }
  function setTrack(tile, track) {
    const v = tile && tile.querySelector('video');
    if (!v) return;
    if (!track) { if (v.srcObject) v.srcObject = null; return; }
    if (!v.srcObject || v.srcObject.getVideoTracks()[0] !== track) v.srcObject = new MediaStream([track]);
    if (v.paused) v.play().catch(() => {});
  }
  function hostLabel() { return theirName || (G.hostName || ''); }
  function titleText() {
    const sid = sharerId();
    if (isGuest) {
      if (amSharing()) return 'You’re sharing';
      const n = hostLabel();
      if (sid && screenSource()) {
        const who = sid === hostId ? n : (G.room && G.room.name) || '';
        return who ? who + '’s screen' : 'Their screen';
      }
      return n ? 'With ' + n : 'In the call';
    }
    const live = watchers();
    const joining = H.guests.size - live.length;
    const who = live.length === 1 ? live[0].name || 'your guest' : live.length + ' people';
    if (amSharing()) return live.length ? 'You’re sharing with ' + who : 'You’re sharing';
    if (sid && roomTrack()) { const g = guestById(sid); return g && g.name ? g.name + '’s screen' : 'Their screen'; }
    if (live.length === 1) return 'With ' + who;
    if (live.length > 1) return live.length + ' people are here';
    if (joining === 1) { const j = [...H.guests.values()].find((g) => !g.live); return ((j && j.name) || 'Someone') + ' is joining…'; }
    if (joining) return joining + ' people are joining…';
    return 'Waiting for someone to open your link';
  }
  function layout() {
    const root = $('watchRoot'), bigSlot = $('bigSlot'), bub = $('bubbles'), park = $('parking');
    if (!root || !bigSlot || !bub || !park) return;
    const scr = screenSource();
    setTrack($('screenTile'), scr);
    const others = [];
    let alone = false, name = '', self = null;
    if (isGuest) {
      const pc = G.call && G.call.peerConnection;
      const face = G.camOn && app.state === 'watching' && pc ? lane(pc, 1) : null;
      setTrack($('camBubble'), face);
      if (face) others.push($('camBubble'));
      name = hostLabel();
      const mine = G.cam && G.cam.getVideoTracks()[0];
      setTrack($('gSelf'), mine || null);
      if (mine) self = $('gSelf');
    } else {
      const live = watchers();
      alone = !live.length;
      live.forEach((g) => { if (g.tile) others.push(g.tile); });
      name = live.length ? live[0].name || '' : '';
      setTrack($('selfFace'), H.cam ? H.camSlot : null);
      if (H.cam) self = $('selfFace');
    }
    const screen = scr ? $('screenTile') : null;
    const visible = [screen].concat(others, [self]).filter(Boolean);
    const auto = alone ? $('inviteTile') : screen || others[0] || $('avatarTile');
    V.auto = auto ? auto.dataset.key : '';
    let big = auto;
    if (!alone && V.pin) {
      const p = visible.find((el) => el !== self && el.dataset.key === V.pin);
      if (p) big = p; else V.pin = '';
    }
    const smalls = visible.filter((el) => el !== big);
    root.querySelectorAll('.tile').forEach((el) => {
      if (el === big || smalls.includes(el)) return;
      el.hidden = true;
      el.classList.remove('big', 'small');
      if (el.parentNode !== park) park.appendChild(el);
    });
    const put = (el, box, i) => {
      el.hidden = false;
      el.classList.toggle('big', box === bigSlot);
      el.classList.toggle('small', box !== bigSlot);
      if (box.children[i] !== el) {
        box.insertBefore(el, box.children[i] || null);
        const v = el.querySelector('video');
        if (v && v.srcObject) v.play().catch(() => {}); // iPhone can pause a moved video
      }
    };
    if (big) put(big, bigSlot, 0);
    smalls.forEach((el, i) => put(el, bub, i));
    // their initial (or a plain figure) while their camera is off
    const ini = $('avatarInitial');
    if (ini) { if (name) ini.textContent = name.charAt(0).toUpperCase(); else ini.innerHTML = PERSON; }
    text('avatarName', name || (isGuest ? 'Your host' : 'Your guest'));
    text('callTitle', titleText());
    const mine = isGuest ? G.screenTrack : H.video;
    text('shareLabel', amSharing() ? 'You’re sharing ' + surfaceName(mine) : titleText());
    document.body.dataset.alone = alone ? '1' : '';
    chatButton();
    docTitle();
    fitDots();
    pointTip();
    miniRender();
  }

  // Swap: tap a bubble and it becomes big; tap the small screen to swap back. Your own bubble never swaps.
  function swapTap(e) {
    const t = e.target && e.target.closest && e.target.closest('.tile.small');
    if (!t) return;
    const k = t.dataset.key;
    if (!k || k === 'self' || k === 'avatar' || k === 'invite') return;
    V.pin = k === V.auto ? '' : k;
    layout();
  }
  // More: a bottom sheet on phones, a small card on computers.
  function moreOpen() { const m = $('moreSheet'); return !!m && !m.hidden; }
  function openMore() {
    const m = $('moreSheet');
    if (!m) return;
    const ch = $('changeBtn');
    if (ch) ch.hidden = !amSharing() || isGuest;
    m.hidden = false;
    wakeControls();
    const x = $('moreClose');
    if (x) x.focus();
  }
  function closeMore() { const m = $('moreSheet'); if (m) m.hidden = true; }

  // ---------- POINT ----------
  // Anyone looking at someone else's screen can point: a click (mouse) or a 0.4 s hold (touch) puts a dot with
  // their initial on that spot for everyone, the sharer included. Positions are 0–1 inside the picture itself
  // (black bars left out), so a dot lands on the same word at any size.
  const P = { lastTick: 0, hold: 0, start: null, lastTouch: 0 };
  function contentRect(v) {
    const r = v.getBoundingClientRect();
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh || !r.width || !r.height) return null;
    const k = Math.min(r.width / vw, r.height / vh); // object-fit: contain
    const w = vw * k, h = vh * k;
    return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
  }
  function fitLayer(v, layer) {
    if (!v || !layer || !layer.parentElement) return;
    const c = contentRect(v);
    const t = layer.parentElement.getBoundingClientRect();
    if (!c) { layer.style.cssText = 'left:0;top:0;width:100%;height:100%'; return; }
    layer.style.cssText = 'left:' + (c.left - t.left) + 'px;top:' + (c.top - t.top) + 'px;width:' + c.width + 'px;height:' + c.height + 'px';
  }
  function fitDots() { fitLayer($('screenVideo'), $('dots')); }
  function canPoint() {
    const tile = $('screenTile');
    if (!tile || !tile.classList.contains('big') || amSharing() || !screenSource()) return false;
    return isGuest ? G.hostVer >= 2 : !!H.sharer && H.sharer !== H.me;
  }
  function dotColor(id) {
    if (id === (isGuest ? hostId : H.me)) return 'var(--clay)';
    let h = 0;
    for (const ch of String(id || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return ['var(--moss)', 'var(--amber)', 'var(--sky)'][h % 3];
  }
  function dotEl(doc, x, y, from, name) {
    const el = doc.createElement('div');
    el.className = 'dot';
    el.style.left = Math.round(x * 1000) / 10 + '%';
    el.style.top = Math.round(y * 1000) / 10 + '%';
    el.style.setProperty('--dc', dotColor(from));
    el.textContent = (name || '').charAt(0).toUpperCase();
    setTimeout(() => el.remove(), 2600);
    return el;
  }
  function showDot(x, y, from, name) {
    const d = $('dots');
    if (d) { fitDots(); d.appendChild(dotEl(document, x, y, from, name)); }
    miniDot(x, y, from, name);
  }
  function pointAt(cx, cy) {
    const v = $('screenVideo');
    const c = v && contentRect(v);
    if (!c) return;
    const r3 = (n) => Math.round(n * 1000) / 1000;
    const x = r3((cx - c.left) / c.width), y = r3((cy - c.top) / c.height);
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    store.set('beside.tip.point', '1');
    if (isGuest) {
      showDot(x, y, G.peer && G.peer.id, cleanName(store.get('beside.name')));
      tell(G.conn, { t: 'ping', x, y });
    } else {
      showDot(x, y, H.me, myName());
      toGuests({ t: 'ping', x, y, from: H.me, name: myName() });
    }
  }
  function okPing(d) { const x = +d.x, y = +d.y; return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? [x, y] : null; }
  // Someone pointed at your screen while Beside is hidden and there's no mini window: a soft tick.
  function maybeTick() { if (amSharing() && document.hidden && !mini.win) tick(); }
  function tick() {
    const now = Date.now();
    if (now - P.lastTick < 1500) return;
    const ctx = isGuest ? G.ctx : H.ctx;
    if (!ctx) return;
    P.lastTick = now;
    app.ticks = (app.ticks || 0) + 1;
    try {
      const t = ctx.currentTime;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 1180;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.07, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      o.connect(g);
      g.connect(ctx.destination); // the speakers only, never the call
      o.start(t);
      o.stop(t + 0.18);
    } catch (e) { /* no sound is fine */ }
  }
  function pointTip() {
    if (!canPoint() || store.get('beside.tip.point')) return;
    store.set('beside.tip.point', '1');
    const touch = matchMedia('(pointer: coarse)').matches;
    peekLine(touch ? 'Hold on the screen to point at something.' : 'Click on the screen to point at something.');
  }
  function wirePointing() {
    const tile = $('screenTile');
    if (!tile) return;
    const cancel = () => { clearTimeout(P.hold); P.start = null; };
    tile.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      P.lastTouch = Date.now();
      if (P.start) { cancel(); return; } // a second finger: pinch, not point
      if (!canPoint()) return;
      P.start = { x: e.clientX, y: e.clientY, id: e.pointerId };
      P.hold = setTimeout(() => { const s = P.start; P.start = null; if (s && canPoint()) pointAt(s.x, s.y); }, 400);
    });
    tile.addEventListener('pointermove', (e) => {
      if (P.start && e.pointerId === P.start.id && Math.hypot(e.clientX - P.start.x, e.clientY - P.start.y) > 12) cancel();
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => tile.addEventListener(ev, (e) => { if (P.start && e.pointerId === P.start.id) cancel(); }));
    tile.addEventListener('click', (e) => {
      if (Date.now() - P.lastTouch < 800 || !canPoint()) return; // a short tap only wakes the controls
      pointAt(e.clientX, e.clientY);
    });
    tile.addEventListener('contextmenu', (e) => { if (canPoint()) e.preventDefault(); });
    try { new ResizeObserver(fitDots).observe(tile); } catch (e) { addEventListener('resize', fitDots); }
    const v = $('screenVideo');
    if (v) ['resize', 'loadedmetadata'].forEach((ev) => v.addEventListener(ev, fitDots));
  }

  // ---------- MINI WINDOW ----------
  // Chrome and Edge, while you share: a small always-on-top window (Document Picture-in-Picture) over the shared
  // tab or any app, with a live miniature of what you share, the dots on it, the others' faces, Mic, Camera and
  // Stop sharing. It is its own window, so it never shows in the shared picture.
  const HAS_MINI = 'documentPictureInPicture' in window;
  const mini = { win: null, els: null, opening: false, sig: '', peekTimer: 0 };
  async function miniOpen() {
    if (!HAS_MINI || mini.win || mini.opening || !amSharing()) return;
    mini.opening = true;
    let win;
    try {
      win = await window.documentPictureInPicture.requestWindow({ width: 360, height: 225 });
    } catch (e) {
      mini.opening = false;
      note('The mini window didn’t open. Press Mini window to try again.', 'info');
      return;
    }
    mini.opening = false;
    if (!amSharing()) { try { win.close(); } catch (e) {} return; }
    const d = win.document;
    const css = document.querySelector('style');
    const st = d.createElement('style');
    st.textContent = css ? css.textContent : '';
    const meta = d.createElement('meta');
    meta.name = 'color-scheme';
    meta.content = 'light dark';
    d.head.append(meta, st);
    d.title = 'Beside';
    d.body.className = 'mini-body';
    const root = d.createElement('div');
    root.className = 'mini';
    const stage = d.createElement('div');
    stage.className = 'mini-stage';
    const v = d.createElement('video');
    v.muted = true; v.autoplay = true; v.setAttribute('playsinline', '');
    const dots = d.createElement('div');
    dots.className = 'dots';
    stage.append(v, dots);
    const peek = d.createElement('div');
    peek.className = 'mini-peek';
    peek.hidden = true;
    const bar = d.createElement('div');
    bar.className = 'mini-bar';
    const faces = d.createElement('div');
    faces.className = 'mini-faces';
    const btn = (actName, label, from, cls) => {
      const b = d.createElement('button');
      b.className = 'mini-btn ' + (cls || '');
      b.dataset.act = actName;
      b.title = label;
      b.setAttribute('aria-label', label);
      const svg = document.querySelector(from + ' svg');
      if (svg) b.appendChild(d.importNode(svg, true));
      return b;
    };
    const stop = d.createElement('button');
    stop.className = 'mini-btn stop';
    stop.dataset.act = 'unshare';
    stop.textContent = 'Stop sharing';
    bar.append(faces, btn('mute', 'Mic', isGuest ? '#gMuteBtn' : '#muteBtn'), btn('cam', 'Camera', isGuest ? '#gCamBtn' : '#camBtn', 'cam'), stop);
    root.append(stage, peek, bar);
    d.body.appendChild(root);
    bar.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) act(b.dataset.act); });
    const fit = () => fitLayer(v, dots);
    win.addEventListener('resize', fit);
    ['resize', 'loadedmetadata'].forEach((ev) => v.addEventListener(ev, fit));
    win.addEventListener('pagehide', () => { if (mini.win === win) { mini.win = null; mini.els = null; layout(); } });
    mini.win = win;
    mini.els = { v, dots, faces, peek, bar };
    mini.sig = '';
    layout();
  }
  // The mini window's buttons do what the same buttons in the dock do.
  function act(name) {
    if (name === 'mute') { if (isGuest) guestMute(); else hostMute(); }
    else if (name === 'cam') { if (isGuest) guestCam(); else hostCam(); }
    else if (name === 'unshare') { if (isGuest) guestUnshare(); else hostUnshare(); }
    miniRender();
  }
  function miniClose() {
    const w = mini.win;
    mini.win = null;
    mini.els = null;
    if (w) { try { w.close(); } catch (e) {} }
  }
  function miniRender() {
    const btn = $('miniBtn');
    if (btn) { btn.hidden = !(HAS_MINI && amSharing()); btn.setAttribute('aria-pressed', mini.win ? 'true' : 'false'); }
    if (!mini.win || !mini.els) return;
    if (!amSharing()) { miniClose(); return; }
    const { v, faces, bar } = mini.els;
    const t = screenSource();
    if (t && (!v.srcObject || v.srcObject.getVideoTracks()[0] !== t)) { v.srcObject = new MediaStream([t]); v.play().catch(() => {}); }
    let people;
    if (isGuest) {
      const pc = G.call && G.call.peerConnection;
      people = [{ key: 'host', name: hostLabel(), track: G.camOn && pc ? lane(pc, 1) : null }];
    } else {
      people = watchers().map((g) => ({ key: g.id, name: g.name, track: g.tile && g.call && g.call.peerConnection ? lane(g.call.peerConnection, 0) : null }));
    }
    const sig = people.map((p) => p.key + ':' + (p.track ? p.track.id : '') + ':' + p.name).join('|');
    if (sig !== mini.sig) {
      mini.sig = sig;
      const d = mini.win.document;
      faces.textContent = '';
      people.slice(0, 4).forEach((p) => {
        const f = d.createElement('div');
        f.className = 'mini-face';
        f.title = p.name || '';
        if (p.track) {
          const fv = d.createElement('video');
          fv.muted = true; fv.autoplay = true; fv.setAttribute('playsinline', '');
          fv.srcObject = new MediaStream([p.track]);
          f.appendChild(fv);
          fv.play().catch(() => {});
        } else f.textContent = (p.name || '•').charAt(0).toUpperCase();
        faces.appendChild(f);
      });
    }
    const muted = isGuest ? G.muted : H.muted;
    const camOn = isGuest ? !!G.cam : !!H.cam;
    const m = bar.querySelector('[data-act=mute]');
    if (m) m.setAttribute('aria-pressed', muted ? 'true' : 'false');
    const c = bar.querySelector('[data-act=cam]');
    if (c) c.setAttribute('aria-pressed', camOn ? 'true' : 'false');
  }
  function miniDot(x, y, from, name) {
    if (!mini.win || !mini.els) return;
    fitLayer(mini.els.v, mini.els.dots);
    mini.els.dots.appendChild(dotEl(mini.win.document, x, y, from, name));
  }
  function miniPeek(line) {
    if (!mini.win || !mini.els) return;
    const p = mini.els.peek;
    p.textContent = line;
    p.hidden = false;
    clearTimeout(mini.peekTimer);
    mini.peekTimer = setTimeout(() => { p.hidden = true; }, 6000);
  }
  // Chrome can open the mini window by itself when you switch to the shared tab (it may ask once to allow it).
  function autoPip(on) {
    try { navigator.mediaSession.setActionHandler('enterpictureinpicture', on && HAS_MINI ? () => { miniOpen(); } : null); } catch (e) { /* not offered here */ }
  }

  // ---------- CHAT AND FILES ----------
  // Messages and files ride the call's data link, straight between the browsers; the host passes them on to
  // everyone else (guests only have a link to the host). Nothing is kept: a reload or the end of the call clears it.
  const C = { open: false, unread: 0, urls: [], recv: new Map(), peekTimer: 0 };
  const PART = 16000; // under PeerJS's own 16 300-byte chunking, so parts are never split twice
  const MAX_FILE = 25 * 1024 * 1024;
  const MAX_FILES = 5;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function rid() { return code8(); }
  function rate(obj, key, perSec) {
    const now = Date.now();
    const a = (obj[key] = (obj[key] || []).filter((x) => now - x < 1000));
    if (a.length >= perSec) return false;
    a.push(now);
    return true;
  }
  function chatAvailable() {
    if (isGuest) return app.state === 'watching' && G.hostVer >= 2;
    return app.state === 'live' && watchers().some((g) => g.ver >= 2);
  }
  function chatButton() {
    const b = $('chatBtn');
    const okNow = chatAvailable();
    if (b) b.hidden = !okNow;
    if (!okNow && C.open) chatOpen(false);
  }
  function unreadPrefix() { return C.unread ? '(' + C.unread + ') ' : ''; }
  function docTitle() {
    if (!isGuest) { hostTitle(); return; }
    const n = hostLabel();
    document.title = unreadPrefix() + (n ? n + ' · Beside' : 'Beside');
  }
  function badge() {
    const b = $('chatBadge');
    if (b) { b.hidden = !C.unread; b.textContent = C.unread > 9 ? '9+' : String(C.unread); }
    const cb = $('chatBtn');
    if (cb) cb.setAttribute('aria-label', C.unread ? 'Chat, ' + C.unread + ' new' : 'Chat');
    docTitle();
  }
  function chatOpen(on) {
    C.open = !!on;
    const el = $('chat');
    if (el) el.hidden = !C.open;
    document.body.classList.toggle('chat-open', C.open);
    if (C.open) {
      C.unread = 0;
      badge();
      const p = $('peek');
      if (p) p.hidden = true;
      const l = $('chatList');
      if (l) l.scrollTop = l.scrollHeight;
      const inp = $('chatInput');
      if (inp && !matchMedia('(pointer: coarse)').matches) inp.focus();
    }
    wakeControls();
  }
  function linkify(el, t) {
    // Text nodes and plain links only: nothing a peer sends is ever read as HTML.
    String(t).split(/(https?:\/\/[^\s<>"']+)/g).forEach((part, i) => {
      if (!part) return;
      if (i % 2 === 0) { el.appendChild(document.createTextNode(part)); return; }
      const tail = (part.match(/[.,!?;:)\]]+$/) || [''])[0];
      const url = tail ? part.slice(0, -tail.length) : part;
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = url;
      el.appendChild(a);
      if (tail) el.appendChild(document.createTextNode(tail));
    });
  }
  function chatRow(mine, name) {
    const list = $('chatList');
    const empty = $('chatEmpty');
    if (empty) empty.hidden = true;
    const row = document.createElement('div');
    row.className = 'msg' + (mine ? ' mine' : '');
    if (!mine) { const w = document.createElement('div'); w.className = 'who'; w.textContent = name || 'Someone'; row.appendChild(w); }
    const body = document.createElement('div');
    body.className = 'body';
    row.appendChild(body);
    if (list) {
      const stick = list.scrollHeight - list.scrollTop - list.clientHeight < 80;
      list.appendChild(row);
      if (stick || mine) list.scrollTop = list.scrollHeight;
    }
    return body;
  }
  function chatAdd(mine, name, t) {
    linkify(chatRow(mine, name), t);
    if (!mine) incoming(name, ': ' + t);
  }
  // Something arrived: count it while the chat is closed, and show one line above the dock for 4 s.
  function incoming(name, rest) {
    miniPeek((name || 'Someone') + rest);
    if (C.open) return;
    C.unread++;
    badge();
    peekLine(rest, name || 'Someone');
  }
  function peekLine(rest, name) {
    const p = $('peek');
    if (!p) return;
    p.textContent = '';
    if (name) { const b = document.createElement('b'); b.textContent = name; p.appendChild(b); }
    p.append(rest);
    p.hidden = false;
    clearTimeout(C.peekTimer);
    C.peekTimer = setTimeout(() => { p.hidden = true; }, 4000);
  }
  function toGuests(msg, except) { for (const g of H.guests.values()) if (g !== except && g.ver >= 2) tell(g.conn, msg); }
  function sendText() {
    const inp = $('chatInput');
    if (!inp) return;
    const t = inp.value.trim().slice(0, 2000);
    if (!t || !chatAvailable()) return;
    inp.value = '';
    const msg = { t: 'chat', id: rid(), text: t };
    if (isGuest) tell(G.conn, msg);
    else toGuests({ ...msg, from: H.me, name: myName() });
    chatAdd(true, '', t);
  }
  function chatReset() {
    if (C.open) chatOpen(false);
    C.unread = 0;
    badge();
    const p = $('peek');
    if (p) p.hidden = true;
    const l = $('chatList');
    if (l) l.querySelectorAll('.msg').forEach((m) => m.remove());
    const empty = $('chatEmpty');
    if (empty) empty.hidden = false;
    C.recv.forEach((r) => { clearTimeout(r.timer); r.failed = true; r.waiters.forEach((w) => w()); });
    C.recv.clear();
    Q.clear();
    C.urls.forEach((u) => URL.revokeObjectURL(u));
    C.urls = [];
    const vw = $('viewer');
    if (vw) vw.hidden = true;
  }

  // ----- files: 16 000-byte parts, one file at a time per link, paced so the screen keeps priority -----
  const Q = new Map(); // data link -> { conn, jobs, busy, nextAt }
  function enqueue(conn, job) {
    if (!conn) return;
    let q = Q.get(conn);
    if (!q) { q = { conn, jobs: [], busy: false, nextAt: 0 }; Q.set(conn, q); }
    q.jobs.push(job);
    pump(q);
  }
  function someoneShares() { return isGuest ? !!(G.room && G.room.sharer) || !!G.screenTrack : !!H.sharer; }
  // Wait until little is queued on the link (64 KB), so chat and pings never sit behind a file.
  async function windowOpen(conn) {
    for (;;) {
      const dc = conn.dataChannel;
      if (!conn.open || !dc) return;
      if (dc.bufferedAmount < 65536 && !conn.bufferSize) return;
      await new Promise((res) => {
        const t = setTimeout(res, 250);
        try { dc.bufferedAmountLowThreshold = 32768; dc.addEventListener('bufferedamountlow', () => { clearTimeout(t); res(); }, { once: true }); } catch (e) {}
      });
    }
  }
  async function pump(q) {
    if (q.busy) return;
    q.busy = true;
    try {
      while (q.jobs.length && Q.get(q.conn) === q) {
        const job = q.jobs[0];
        if (q.conn.open) {
          tell(q.conn, job.head);
          const n = Math.ceil(job.size / PART);
          for (let i = 0; i < n; i++) {
            const b = await job.part(i);
            if (!b || !q.conn.open || Q.get(q.conn) !== q) break;
            await windowOpen(q.conn);
            const wait = q.nextAt - Date.now();
            if (wait > 0) await sleep(wait);
            if (!q.conn.open || Q.get(q.conn) !== q) break;
            try { q.conn.send({ t: 'part', id: job.head.id, i, b }); } catch (e) { break; }
            // at most 250 KB/s while someone shares (the screen comes first), 1 MB/s otherwise
            q.nextAt = Math.max(Date.now(), q.nextAt) + (b.byteLength / (someoneShares() ? 250000 : 1000000)) * 1000;
            if (job.sent) job.sent(b.byteLength);
          }
        }
        q.jobs.shift();
      }
    } catch (e) { /* the link is going anyway */ } finally { q.busy = false; }
  }
  function isImage(mime) { return /^image\/(jpeg|png|gif|webp)$/.test(mime || ''); }
  // Only pictures and PDFs open in the browser; anything else (HTML and SVG included) can only be saved.
  function safeType(mime) { return isImage(mime) ? mime : mime === 'application/pdf' ? mime : 'application/octet-stream'; }
  function sizeText(n) { return n >= 1048576 ? (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  // Big photos and iPhone HEIC pictures go as a JPEG of at most 2560 px: faster, and every browser can show it.
  async function shrinkImage(f) {
    const heic = /hei[cf]/i.test(f.type || '') || /\.hei[cf]$/i.test(f.name || '');
    if (!heic && !(/^image\/(jpeg|png|webp)$/.test(f.type || '') && f.size > 3 * 1024 * 1024)) return f;
    try {
      const bmp = await createImageBitmap(f);
      const k = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k);
      c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
      if (!blob) return f;
      return new File([blob], (f.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
    } catch (e) { return f; }
  }
  function fileCard(mine, name, f) {
    const body = chatRow(mine, name);
    const card = document.createElement('div');
    card.className = 'filecard';
    const fn = document.createElement('div');
    fn.className = 'fname';
    fn.textContent = f.fname;
    const meta = document.createElement('div');
    meta.className = 'fmeta';
    const bar = document.createElement('div');
    bar.className = 'bar';
    const fill = document.createElement('i');
    bar.appendChild(fill);
    const acts = document.createElement('div');
    acts.className = 'acts';
    card.append(fn, meta, bar, acts);
    body.appendChild(card);
    let last = 0;
    const verb = mine ? 'Sending' : 'Receiving';
    const api = {
      progress(p) {
        const now = Date.now();
        if (p < 1 && now - last < 100) return; // at most 10 updates a second
        last = now;
        const pct = Math.min(100, Math.floor(p * 100));
        card.dataset.pct = String(pct);
        fill.style.width = pct + '%';
        meta.textContent = sizeText(f.size) + ' · ' + (pct >= 100 ? (mine ? 'Sent' : 'Arrived') : verb + '… ' + pct + '%');
        if (pct >= 100) bar.hidden = true;
      },
      photo(url) {
        const img = document.createElement('img');
        img.className = 'photo';
        img.alt = f.fname;
        img.src = url;
        body.classList.add('photo');
        body.insertBefore(img, card);
        fn.hidden = true;
      },
      finish(url, type) {
        api.progress(1);
        if (isImage(type)) { api.photo(url); return; }
        if (type === 'application/pdf') {
          const o = document.createElement('a');
          o.href = url; o.target = '_blank'; o.rel = 'noopener'; o.textContent = 'Open'; o.className = 'open';
          acts.appendChild(o);
        }
        const s = document.createElement('a');
        s.href = url; s.download = f.fname; s.textContent = 'Save'; s.className = 'save';
        acts.appendChild(s);
      },
      fail(msg) {
        card.dataset.pct = 'failed';
        bar.hidden = true;
        meta.textContent = msg || (mine ? 'Didn’t send. Try again.' : 'Didn’t arrive. Ask them to send it again.');
      },
    };
    api.progress(0);
    return api;
  }
  async function sendFiles(list) {
    const files = [...(list || [])];
    if (!files.length) return;
    if (!chatAvailable()) { note('Files can be sent once someone with the latest Beside is in the call.', 'info'); return; }
    if (files.length > MAX_FILES) note('You can send up to 5 files at a time. The first 5 are on their way.', 'info');
    for (const f0 of files.slice(0, MAX_FILES)) {
      if (f0.size > MAX_FILE) { note('“' + String(f0.name).slice(0, 60) + '” is too big. You can send files up to 25 MB.', 'info'); continue; }
      const f = await shrinkImage(f0);
      const head = { t: 'file', id: rid(), fname: String(f.name || 'file').slice(0, 120), size: f.size, mime: String(f.type || '').slice(0, 100) };
      const card = fileCard(true, '', head);
      if (isImage(head.mime)) { const u = URL.createObjectURL(f); C.urls.push(u); card.photo(u); }
      const part = (i) => f.slice(i * PART, (i + 1) * PART).arrayBuffer();
      const conns = isGuest ? [G.conn] : [...H.guests.values()].filter((g) => g.ver >= 2).map((g) => g.conn);
      const want = f.size * conns.length;
      let sent = 0;
      if (!want) card.progress(1);
      conns.forEach((conn) => enqueue(conn, {
        head: isGuest ? head : { ...head, from: H.me, name: myName() },
        size: f.size,
        part,
        sent: (n) => { sent += n; card.progress(sent / want); },
      }));
    }
  }
  function watchdog(r) {
    clearTimeout(r.timer);
    r.timer = setTimeout(() => fileFail(r), 20000); // nothing for 20 s: it isn't coming
  }
  function fileStart(key, d, name) {
    const size = +d.size;
    if (C.recv.has(key) || typeof d.fname !== 'string' || !(size >= 0 && size <= MAX_FILE)) return null;
    const r = {
      key, id: String(d.id).slice(0, 12), fname: d.fname.slice(0, 120) || 'file', size, mime: String(d.mime || '').slice(0, 100),
      parts: [], got: 0, done: false, failed: false, waiters: [], timer: 0, card: null,
    };
    r.card = fileCard(false, name, r);
    C.recv.set(key, r);
    incoming(name, isImage(r.mime) ? ' sent a photo' : ' sent a file');
    if (!size) fileDone(r); else watchdog(r);
    return r;
  }
  function filePart(key, d) {
    const r = C.recv.get(key);
    if (!r || r.done || r.failed) return;
    const b = d.b instanceof ArrayBuffer || ArrayBuffer.isView(d.b) ? d.b : null;
    if (!b || b.byteLength > PART || d.i !== r.parts.length || r.got + b.byteLength > r.size) { fileFail(r); return; }
    r.parts.push(b);
    r.got += b.byteLength;
    r.waiters.splice(0).forEach((w) => w());
    r.card.progress(r.got / r.size);
    if (r.got === r.size) fileDone(r); else watchdog(r);
  }
  function fileDone(r) {
    r.done = true;
    clearTimeout(r.timer);
    const type = safeType(r.mime);
    const url = URL.createObjectURL(new Blob(r.parts, { type }));
    C.urls.push(url);
    r.card.finish(url, type);
  }
  function fileFail(r) {
    if (r.done || r.failed) return;
    r.failed = true;
    clearTimeout(r.timer);
    r.parts = [];
    r.card.fail();
    r.waiters.splice(0).forEach((w) => w());
  }
  // The host passes a file on part by part as it arrives, so the others don't wait for the whole file.
  function relayPart(r) {
    return (i) => new Promise((res) => {
      const look = () => { if (r.parts[i]) res(r.parts[i]); else if (r.failed || r.done) res(null); else r.waiters.push(look); };
      look();
    });
  }
  function hostFile(g, d) {
    const busy = [...C.recv.values()].filter((r) => r.key.startsWith(g.id + ':') && !r.done && !r.failed).length;
    if (busy >= MAX_FILES) return;
    const name = g.name || 'Guest';
    const r = fileStart(g.id + ':' + String(d.id).slice(0, 12), d, name);
    if (!r) return;
    for (const o of H.guests.values()) {
      if (o === g || o.ver < 2) continue;
      enqueue(o.conn, { head: { t: 'file', id: r.id, fname: r.fname, size: r.size, mime: r.mime, from: g.id, name }, size: r.size, part: relayPart(r) });
    }
  }
  function showPhoto(src) {
    const v = $('viewer'), im = $('viewerImg');
    if (!v || !im) return;
    im.src = src;
    v.hidden = false;
  }

  // ---------- HOST ----------
  // Mo starts a call with one tap; nothing is shared until Share screen. Every lane of the call exists from the
  // first offer ([audio, screen, camera]); a blank track holds a lane while it has nothing to carry.
  const H = {
    peer: null, code: '', me: '', video: null, display: null, mic: null, ctx: null, dest: null,
    micGain: null, tabSrc: null, guests: new Map(), knocks: new Map(), muted: false, mode: 'detail',
    lagTimer: 0, idRetries: 0, stopping: false, starting: false, changing: false, otherTabLive: false,
    blank: null, blankScreen: null, camSlot: null, cam: null, camBusy: false, sharer: '',
  };
  // Tabs of this browser tell each other when one is in a call, so a second tab can say so at once.
  const bc = (() => { try { return new BroadcastChannel('beside'); } catch (e) { return null; } })();
  if (bc) {
    bc.onmessage = (e) => {
      if (isGuest) return;
      if (e.data === 'live?' && app.state === 'live') bc.postMessage('live!');
      else if (e.data === 'live!') H.otherTabLive = true;
      else if (e.data === 'off') H.otherTabLive = false;
    };
  }
  const OTHER_TAB = 'Beside is already in a call in another tab or window. Use that one, or press End there first.';

  function hostCode() {
    let c = store.get('beside.room');
    if (!c || !/^[a-z0-9]{8}$/.test(c)) { c = code8(); store.set('beside.room', c); }
    return c;
  }
  function myName() { return cleanName(store.get('beside.name.host') || ''); }
  function hostLink() {
    const n = myName();
    return location.origin + location.pathname + '#' + H.code + (n ? '-' + encodeURIComponent(n) : '');
  }
  function renderLink() {
    ['linkText', 'moreLinkText'].forEach((id) => {
      const el = $(id);
      if (!el) return;
      const parts = (location.host + location.pathname).replace(/[^/]*$/, '').replace(/\/$/, '').split('/');
      const last = parts.pop();
      const n = myName();
      el.textContent = '';
      const dim = document.createElement('span');
      dim.className = 'dim';
      dim.textContent = parts.length ? parts.join('/') + '/' : '';
      const em = document.createElement('em');
      em.textContent = '#' + H.code + (n ? '-' + n : '');
      el.append(dim, (last ? last + '/' : ''), em);
    });
  }
  function hostTitle() {
    if (app.state !== 'live') { document.title = unreadPrefix() + 'Beside'; return; }
    const n = watchers().length;
    document.title = unreadPrefix() + '● ' + (n ? n + ' in call' : 'Waiting') + (amSharing() ? ' · sharing' : '') + ' · Beside';
  }

  async function getDisplay(withAudio) {
    const v = { frameRate: { ideal: 30, max: 60 }, width: { max: 1920 }, height: { max: 1080 } };
    // Safari and Firefox: a plain request, made straight inside the click as Safari requires.
    if (!IS_CHROMIUM) return navigator.mediaDevices.getDisplayMedia({ video: v });
    // Chrome/Edge: open on the Tab list, hide "Entire screen", never offer this page itself,
    // and don't pop "Share this tab instead" whenever you switch tabs.
    const opts = {
      video: { ...v, displaySurface: 'browser' }, audio: !!withAudio, preferCurrentTab: false,
      selfBrowserSurface: 'exclude', surfaceSwitching: 'exclude', monitorTypeSurfaces: 'exclude',
    };
    if (withAudio) opts.systemAudio = 'exclude';
    try {
      return await navigator.mediaDevices.getDisplayMedia(opts);
    } catch (e) {
      if (e && e.name === 'TypeError') return navigator.mediaDevices.getDisplayMedia({ video: v });
      throw e;
    }
  }
  function isWholeScreen(stream) {
    const t = stream && stream.getVideoTracks()[0];
    try { return !!t && t.getSettings().displaySurface === 'monitor'; } catch (e) { return false; }
  }
  const WHOLE_SCREEN = 'Pick one tab or one app window, not the whole screen, so nothing else on your screen (like notifications) can be seen. Press Share screen again.';
  function displayError(e) {
    const browser = IS_CHROMIUM ? 'Chrome' : 'your browser';
    if (e && /system/i.test(e.message || '')) {
      return 'Your Mac is blocking ' + browser + ' from sharing windows. Open System Settings, Privacy & Security, Screen & System Audio Recording, turn ' + browser + ' on, then quit and reopen it. Sharing a tab works without this.';
    }
    if (e && e.name === 'NotAllowedError') {
      return IS_CHROMIUM
        ? 'Nothing was shared. Press Share screen and pick a tab or a window.'
        : 'Nothing was shared. Press Share screen, choose Allow, then pick a window.';
    }
    return 'Screen sharing didn’t start (' + ((e && e.name) || 'unknown') + '). Try again, or use Chrome.';
  }
  // The screen lane: sharp, up to 30 fps, and first in line on the network.
  function tuneScreen(s) {
    if (!s) return;
    const mode = isGuest ? 'detail' : H.mode;
    const apply = (withPref) => {
      const p = s.getParameters(); // always fresh: browsers reject a stale parameters object
      if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      p.encodings[0].maxBitrate = mode === 'detail' ? 6000000 : 4000000;
      p.encodings[0].maxFramerate = 30;
      if (withPref) {
        p.degradationPreference = mode === 'detail' ? 'maintain-resolution' : 'maintain-framerate';
        p.encodings[0].priority = 'high';
        p.encodings[0].networkPriority = 'high';
      }
      return s.setParameters(p);
    };
    try { apply(true).catch(() => { try { apply(false).catch(() => {}); } catch (e) {} }); } catch (e) { /* defaults are fine */ }
  }
  function useVideoTrack(track) {
    track.contentHint = H.mode;
    track.addEventListener('ended', () => {
      if (H.video === track) hostUnshare('Sharing stopped (the tab or window closed, or Stop was pressed in the browser). You’re still in the call.');
    });
    H.video = track;
  }
  function useTabAudio(stream) {
    if (H.tabSrc) { try { H.tabSrc.disconnect(); } catch (e) {} H.tabSrc = null; }
    const a = stream && stream.getAudioTracks()[0];
    if (a && H.ctx) { H.tabSrc = H.ctx.createMediaStreamSource(new MediaStream([a])); H.tabSrc.connect(H.dest); }
  }
  function setStartBusy(b) { ['startBtn', 'endedAction'].forEach((id) => { const el = $(id); if (el) el.disabled = b; }); }

  async function hostStart() {
    if (H.starting || app.state === 'live') return; // double click
    if (!peerLibOk()) return;
    if (H.otherTabLive) {
      H.otherTabLive = false; // ask again, in case that tab has gone
      if (bc) bc.postMessage('live?');
      note(OTHER_TAB, 'stay');
      return;
    }
    H.starting = true;
    setStartBusy(true);
    try {
      // Audio engine first, inside the click, so Safari lets it run. Mic and tab sound are mixed into one lane.
      H.ctx = new (window.AudioContext || window.webkitAudioContext)();
      H.ctx.resume().catch(() => {});
      H.dest = H.ctx.createMediaStreamDestination();
      H.micGain = H.ctx.createGain();
      H.micGain.connect(H.dest);
      const wantMic = !$('micStartToggle') || $('micStartToggle').getAttribute('aria-pressed') !== 'false';
      if (wantMic) {
        try {
          H.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
          H.ctx.createMediaStreamSource(H.mic).connect(H.micGain);
        } catch (e) {
          note('Your microphone is blocked, so they can’t hear you. Click the icon at the left of the address bar, allow the microphone, then press End and start the call again.', 'stay');
        }
      }
      H.muted = !H.mic;
      H.micGain.gain.value = H.muted ? 0 : 1;
      setPressed('muteBtn', H.muted, 'Unmute my mic', 'Mute my mic');
      H.blank = blankTrack();
      H.blankScreen = blankTrack(); // a second one: one track can't ride two lanes of a call
      if (!H.blank || !H.blankScreen) {
        hostCleanup();
        show('idle');
        note('This browser can’t make calls. Use Chrome or Safari.', 'stay');
        return;
      }
      H.camSlot = H.blank;
      H.sharer = '';
      H.code = hostCode();
      H.me = PREFIX + H.code;
      V.pin = '';
      renderLink();
      show('live');
      guestStatus();
      setLag('lag', null);
      stayAwake(true);
      autoPip(true);
      H.idRetries = 0;
      openHostPeer();
    } finally {
      H.starting = false;
      setStartBusy(false);
    }
  }

  function openHostPeer() {
    if (H.peer && !H.peer.destroyed) { try { H.peer.destroy(); } catch (e) {} }
    H.stopping = false;
    let wasOpen = false;
    text('liveHint', 'Getting your link ready…');
    const peer = new Peer(PREFIX + H.code, PEER_OPTS);
    app.hostPeers++;
    H.peer = peer;
    peer.on('open', () => {
      if (H.peer !== peer) return;
      wasOpen = true;
      H.idRetries = 0;
      app.hostReady = true;
      text('liveHint', '');
      if (bc) bc.postMessage('live!');
    });
    peer.on('connection', (conn) => {
      if (H.peer !== peer) { try { conn.close(); } catch (e) {} return; }
      // A guest whose last knock never opened, knocking again 10 to 40 s later, waited out its 15 s and
      // couldn't get through: the networks are blocking it. (Someone who just left never knocks again.)
      const prev = H.knocks.get(conn.peer);
      const at = Date.now();
      H.knocks.set(conn.peer, at);
      if (prev && at - prev >= 10000 && at - prev <= 40000 && ![...H.guests.values()].some((g) => g.conn.peer === conn.peer)) {
        note((cleanName(conn.metadata && conn.metadata.name) || 'Someone') + KNOCK_FAIL + NET_WHY, 'stay');
      }
      conn.on('open', () => { H.knocks.delete(conn.peer); hostAddGuest(conn); });
      conn.on('close', () => hostDropGuest(conn.connectionId));
      conn.on('error', () => hostDropGuest(conn.connectionId));
    });
    peer.on('disconnected', () => {
      if (H.peer !== peer || H.stopping || peer.destroyed) return;
      setTimeout(() => {
        if (H.peer === peer && !H.stopping && !peer.destroyed && peer.disconnected) { try { peer.reconnect(); } catch (e) {} }
      }, 1500);
    });
    peer.on('error', (e) => {
      if (H.peer !== peer || H.stopping) return;
      const t = e && e.type;
      if (t === 'unavailable-id') {
        // Our own session after a Wi-Fi blip: PeerJS keeps the calls and 'disconnected' retries.
        if (wasOpen) { text('liveHint', 'Reconnecting to the call server…'); return; }
        if (H.otherTabLive) { note(OTHER_TAB, 'stay'); hostStop(); return; }
        if (H.idRetries < 30) {
          // A reload or a sleeping Mac still holds the link for a moment; it frees itself.
          H.idRetries++;
          text('liveHint', 'Getting your link ready… After a reload this can take up to a minute.');
          try { peer.destroy(); } catch (e2) {}
          setTimeout(() => { if (H.peer === peer && !H.stopping && app.state === 'live') openHostPeer(); }, 2500);
          return;
        }
        note('Your link is busy. If Beside is in a call on another computer or browser, end it there, then press Start a call again.', 'stay');
        hostStop();
      } else if (t === 'browser-incompatible') {
        note('This browser can’t make calls. Use Chrome or Safari.', 'stay');
      } else if (NET_ERR.test(t || '')) {
        text('liveHint', 'Can’t reach the call server. Trying again… Anyone already in the call stays connected.');
        // A server that never answered leaves PeerJS destroyed: start a fresh one.
        setTimeout(() => { if (H.peer === peer && !H.stopping && app.state === 'live' && peer.destroyed) openHostPeer(); }, 3000);
      }
    });
  }

  function guestById(id) { for (const g of H.guests.values()) if (g.id === id) return g; return null; }
  // What this guest's screen lane carries: the room's screen, except its own (no echo), else blank.
  function screenFor(g) { return (g.id === H.sharer ? null : roomTrack()) || H.blankScreen; }
  function hostAddGuest(conn) {
    if (!H.peer || H.peer.destroyed || !H.dest || !H.blankScreen || H.guests.has(conn.connectionId)) return;
    for (const [k, old] of H.guests) if (old.conn.peer === conn.peer) hostDropGuest(k); // same guest reconnecting
    const g = {
      id: conn.peer, conn, call: null, audio: null, live: false, ver: 0, canShare: false, tile: null,
      screenSender: null, camSender: null, name: cleanName(conn.metadata && conn.metadata.name),
    };
    const n = $('note');
    if (n && !n.hidden && n.textContent.includes(KNOCK_FAIL.trim())) note(''); // they got through after all
    const screen = screenFor(g);
    let call = null;
    try { call = H.peer.call(conn.peer, ordered([H.dest.stream.getAudioTracks()[0], screen, H.camSlot]), { sdpTransform: preferH264 }); } catch (e) { call = null; }
    if (!call) { try { conn.close(); } catch (e) {} return; }
    g.call = call;
    H.guests.set(conn.connectionId, g);
    const pc = call.peerConnection;
    if (pc) {
      // Senders are kept by role: a relayed screen is someone else's track, never look them up by track again.
      const vids = pc.getSenders().filter((s) => s.track && s.track.kind === 'video');
      g.screenSender = pc.getSenders().find((s) => s.track === screen) || vids[0] || null;
      g.camSender = pc.getSenders().find((s) => s.track === H.camSlot) || vids[1] || null;
      iceProblem(pc,
        (never) => {
          if (never) note((g.name || 'Your guest') + ' couldn’t connect. ' + NET_WHY, 'stay');
          hostDropGuest(conn.connectionId); // after a drop the guest reconnects by itself
        },
        () => { text('liveHint', 'Connection is shaky. Reconnecting…'); },
        () => {
          tuneScreen(g.screenSender);
          tuneCam(g.camSender);
          text('liveHint', '');
          tell(conn, { cam: !!H.cam });
          if (!g.live) { g.live = true; guestStatus(); }
          hostFace(g);
        });
    }
    conn.on('data', (d) => { if (H.guests.get(conn.connectionId) === g) hostData(g, d); });
    tell(conn, { cam: !!H.cam });
    tell(conn, { t: 'hello', v: VER, name: myName(), share: CAN_SHARE });
    tell(conn, roomMsg());
    // A guest on the old Beside never says hello: it can watch and talk, nothing more.
    setTimeout(() => {
      if (H.guests.get(conn.connectionId) === g && !g.ver) note((g.name || 'Someone') + ' has an older Beside open. Ask them to reload the page.', 'info');
    }, 3000);
    // Joined but the picture never connected (a lost message, or they vanished): let them knock again.
    setTimeout(() => { if (H.guests.get(conn.connectionId) === g && !g.live) hostDropGuest(conn.connectionId); }, 25000);
    call.on('stream', (s) => {
      if (pc) {
        pc.getReceivers().forEach((r) => {
          if (!r.track || r.track.kind !== 'video') return;
          try { r.jitterBufferTarget = 0; } catch (e) {}
          try { r.playoutDelayHint = 0; } catch (e) {}
        });
      }
      if (!g.audio) {
        g.audio = new Audio();
        g.audio.autoplay = true;
        g.audio.setAttribute('playsinline', '');
        document.body.appendChild(g.audio);
      }
      if (g.audio.srcObject !== s) g.audio.srcObject = s;
      g.audio.play().catch(() => note('Click anywhere on this page to hear ' + (g.name || 'them') + '.', 'stay'));
      hostFace(g);
    });
    call.on('close', () => hostDropGuest(conn.connectionId));
    guestStatus();
    startHostLag();
  }
  // Everything a guest sends on the data link. Unknown or broken messages are ignored.
  function hostData(g, d) {
    try {
      if (!d || typeof d !== 'object') return;
      if (!d.t && 'cam' in d) { g.camOn = !!d.cam; hostFace(g); return; }
      if (d.t === 'hello') { g.ver = +d.v || 0; g.canShare = !!d.share; guestStatus(); return; }
      if (g.ver < 2) return;
      if (d.t === 'chat') {
        if (typeof d.text !== 'string' || !rate(g, 'chatT', 10)) return;
        const t = d.text.slice(0, 2000).trim();
        if (!t) return;
        const name = g.name || 'Guest';
        chatAdd(false, name, t);
        toGuests({ t: 'chat', id: String(d.id || '').slice(0, 12), text: t, from: g.id, name }, g);
      } else if (d.t === 'ping') {
        const xy = okPing(d);
        if (!xy || !rate(g, 'pingT', 5)) return;
        const name = g.name || '';
        showDot(xy[0], xy[1], g.id, name);
        toGuests({ t: 'ping', x: xy[0], y: xy[1], from: g.id, name }, g);
        maybeTick();
      } else if (d.t === 'file') hostFile(g, d);
      else if (d.t === 'part') filePart(g.id + ':' + String(d.id).slice(0, 12), d);
    } catch (e) { /* a bad message never breaks the call */ }
  }
  function hostDropGuest(id) {
    const g = H.guests.get(id);
    if (!g) return;
    H.guests.delete(id);
    try { if (g.call) g.call.close(); } catch (e) {}
    try { g.conn.close(); } catch (e) {}
    if (g.audio) { g.audio.srcObject = null; g.audio.remove(); }
    if (g.tile) { const v = g.tile.querySelector('video'); if (v) v.srcObject = null; g.tile.remove(); g.tile = null; }
    if (H.sharer && H.sharer === g.id) { H.sharer = ''; V.pin = ''; roomScreen(); }
    guestStatus();
  }
  // A guest's camera becomes a face tile; layout() decides whether it is big or a bubble.
  function hostFace(g) {
    const pc = g.call && g.call.peerConnection;
    const track = g.camOn && g.live && pc ? lane(pc, 0) : null;
    if (track && !g.tile) {
      g.tile = faceTile(g.name || 'Guest', g.id);
      const park = $('parking');
      if (park) park.appendChild(g.tile);
    } else if (!track && g.tile) {
      const v = g.tile.querySelector('video');
      if (v) v.srcObject = null;
      g.tile.remove();
      g.tile = null;
    }
    if (g.tile) setTrack(g.tile, track);
    layout();
  }
  function faceTile(name, key) {
    const d = document.createElement('div');
    d.className = 'tile face peer';
    d.dataset.key = key;
    const v = document.createElement('video');
    v.muted = true; v.autoplay = true; v.setAttribute('playsinline', '');
    const lab = document.createElement('span');
    lab.className = 'label';
    lab.textContent = name;
    d.append(v, lab);
    return d;
  }
  async function hostCam() {
    if (H.camBusy || app.state !== 'live') return;
    if (!H.blank) { note('This browser can’t send your camera. Use Chrome or Safari.', 'info'); return; }
    if (H.cam) { const s = H.cam; H.cam = null; hostSlot(H.blank); s.getTracks().forEach((t) => t.stop()); return; }
    H.camBusy = true;
    try {
      let s;
      try { s = await getCam(); } catch (e) { note(camError(e), 'stay'); return; }
      if (app.state !== 'live' || H.cam) { s.getTracks().forEach((t) => t.stop()); return; }
      H.cam = s;
      const t = s.getVideoTracks()[0];
      t.addEventListener('ended', () => { if (H.cam === s) { H.cam = null; hostSlot(H.blank); } }); // camera unplugged
      hostSlot(t);
    } finally { H.camBusy = false; }
  }
  function hostSlot(track) {
    H.camSlot = track;
    for (const g of H.guests.values()) {
      if (g.camSender) g.camSender.replaceTrack(track).then(() => tuneCam(g.camSender)).catch(() => {});
      tell(g.conn, { cam: !!H.cam });
    }
    setPressed('camBtn', !!H.cam, 'Turn my camera off', 'Turn my camera on');
    layout();
  }

  // ----- who is sharing (only the host decides: one screen for the room, the newest share wins) -----
  function roomTrack() {
    if (!H.sharer) return null;
    if (H.sharer === H.me) return H.video || null;
    const g = guestById(H.sharer);
    const pc = g && g.call && g.call.peerConnection;
    const t = pc ? lane(pc, 1) : null;
    if (t) { try { t.contentHint = 'detail'; } catch (e) {} }
    return t;
  }
  function roomMsg() {
    const g = H.sharer && H.sharer !== H.me ? guestById(H.sharer) : null;
    return { t: 'room', sharer: H.sharer || '', name: H.sharer === H.me ? myName() : (g && g.name) || '', n: H.shareN || 0 };
  }
  function roomScreen() {
    const t = roomTrack();
    for (const g of H.guests.values()) {
      const want = (g.id === H.sharer ? null : t) || H.blankScreen;
      const s = g.screenSender;
      if (s && want && s.track !== want) s.replaceTrack(want).then(() => tuneScreen(s)).catch(() => {});
      if (g.ver >= 2) tell(g.conn, roomMsg());
    }
    setPressed('screenBtn', amSharing(), 'Stop sharing', 'Share screen');
    guestStatus();
  }
  function takeOver(id) {
    const was = H.sharer;
    if (was && was !== id) {
      const by = id === H.me ? (myName() || 'Your host') : ((guestById(id) || {}).name || 'Someone');
      if (was === H.me) hostUnshare(by + ' is sharing now, so your sharing stopped.', true);
      else { const og = guestById(was); if (og) tell(og.conn, { t: 'share', on: false, name: by }); }
    }
    V.pin = ''; // a new share always shows big
    H.shareN = (H.shareN || 0) + 1;
    H.sharer = id;
    roomScreen();
  }
  async function hostShare() {
    if (H.changing || app.state !== 'live') return;
    if (!CAN_SHARE) { note(NO_SHARE, 'info'); return; }
    H.changing = true;
    let s;
    try {
      s = await getDisplay(true);
    } catch (e) {
      // Cancelling the picker is fine; a Mac that blocks sharing needs the steps.
      if (e && /system/i.test(e.message || '')) note(displayError(e), 'stay');
      else if (!H.video) note(displayError(e), 'info');
      return;
    } finally {
      H.changing = false;
    }
    if (isWholeScreen(s)) { s.getTracks().forEach((t) => t.stop()); note(WHOLE_SCREEN, 'stay'); return; }
    if (app.state !== 'live') { s.getTracks().forEach((t) => t.stop()); return; }
    const prev = H.display;
    H.display = s;
    useVideoTrack(s.getVideoTracks()[0]);
    useTabAudio(s);
    if (prev) prev.getTracks().forEach((t) => t.stop()); // video and tab sound of the old choice
    if (H.sharer === H.me) { V.pin = ''; H.shareN = (H.shareN || 0) + 1; roomScreen(); } else takeOver(H.me);
  }
  const hostChange = hostShare;
  function hostUnshare(msg, keepSharer) {
    const d = H.display;
    H.display = null;
    H.video = null;
    if (H.tabSrc) { try { H.tabSrc.disconnect(); } catch (e) {} H.tabSrc = null; }
    if (d) d.getTracks().forEach((t) => t.stop());
    miniClose();
    if (H.sharer === H.me && !keepSharer) { H.sharer = ''; V.pin = ''; roomScreen(); }
    setPressed('screenBtn', false, 'Stop sharing', 'Share screen');
    layout();
    if (msg) note(msg, 'info');
  }

  function surfaceName(track) {
    let d = '';
    try { d = track && track.getSettings ? track.getSettings().displaySurface : ''; } catch (e) { d = ''; }
    return d === 'window' ? 'one window' : d === 'browser' ? 'one tab' : d === 'monitor' ? 'your whole screen' : 'your screen';
  }
  function watchers() { return [...H.guests.values()].filter((g) => g.live); }
  function guestStatus() {
    if (isGuest) return;
    const live = watchers();
    const joining = [...H.guests.values()].filter((g) => !g.live);
    text('inviteStatus', joining.length === 1 ? (joining[0].name || 'Someone') + ' is joining…'
      : joining.length > 1 ? joining.length + ' people are joining…'
        : 'Send this link to the person you want to talk to.');
    document.body.dataset.guests = String(live.length);
    if (!live.length) setLag('lag', null);
    layout();
  }
  function startHostLag() {
    clearInterval(H.lagTimer);
    H.lagTimer = setInterval(async () => {
      let worst = null;
      for (const g of H.guests.values()) {
        const r = await rtt(g.call && g.call.peerConnection);
        if (r != null && (worst == null || r > worst)) worst = r;
      }
      app.lag = worst;
      setLag('lag', worst);
    }, 2000);
  }
  function hostMute() {
    if (!H.mic) { note('No microphone yet. Allow the microphone for this site, then press End and start the call again.', 'info'); return; }
    H.muted = !H.muted;
    H.micGain.gain.value = H.muted ? 0 : 1;
    setPressed('muteBtn', H.muted, 'Unmute my mic', 'Mute my mic');
  }
  function hostMode(mode) {
    if (mode === H.mode) return;
    H.mode = mode;
    store.set('beside.mode', H.mode);
    if (H.video) H.video.contentHint = H.mode;
    for (const g of H.guests.values()) tuneScreen(g.screenSender);
    modeLabel();
  }
  function modeLabel() {
    document.querySelectorAll('#modeToggle [data-mode]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === H.mode ? 'true' : 'false'));
  }
  function hostCleanup() {
    const wasLive = app.state === 'live';
    H.stopping = true;
    clearInterval(H.lagTimer);
    for (const id of [...H.guests.keys()]) hostDropGuest(id);
    if (H.peer) { try { H.peer.destroy(); } catch (e) {} H.peer = null; }
    [H.display, H.mic, H.cam].forEach((s) => s && s.getTracks().forEach((t) => t.stop()));
    [H.video, H.blank, H.blankScreen].forEach((t) => t && t.stop());
    if (H.ctx) H.ctx.close().catch(() => {});
    H.display = H.mic = H.video = H.ctx = H.tabSrc = H.cam = H.camSlot = H.blank = H.blankScreen = null;
    H.sharer = '';
    V.pin = '';
    miniClose();
    autoPip(false);
    chatReset();
    setPressed('camBtn', false, 'Turn my camera off', 'Turn my camera on');
    setPressed('screenBtn', false, 'Stop sharing', 'Share screen');
    app.hostReady = false;
    stayAwake(false);
    if (wasLive && bc) bc.postMessage('off');
  }
  function ended(title, body, action) {
    text('endedTitle', title);
    text('endedText', body);
    text('endedAction', action);
    show('ended');
  }
  function hostStop(msg) {
    hostCleanup();
    ended('Call ended.', msg || 'Your link stays the same for next time.', 'Start a call');
  }
  async function copyLink(btn) {
    const link = hostLink();
    try {
      await navigator.clipboard.writeText(link);
    } catch (e) {
      const el = $('linkText');
      if (el) { const r = document.createRange(); r.selectNodeContents(el); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
      try { document.execCommand('copy'); } catch (e2) {}
    }
    const lab = btn && btn.querySelector('.label-t');
    if (lab) { lab.textContent = 'Copied'; setTimeout(() => { lab.textContent = 'Copy'; }, 1500); }
  }
  async function shareLink(btn) {
    const link = hostLink();
    if (navigator.share) {
      try { await navigator.share({ title: 'Beside', text: 'Open this to join my call on Beside:', url: link }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    copyLink(btn);
  }
  function newLink() {
    if (!confirm('Make a new link? The old link will stop working.')) return;
    closeMore();
    hostCleanup();
    H.code = code8();
    store.set('beside.room', H.code);
    renderLink();
    ended('New link ready.', 'The old link no longer works. Start a call, then send the new link.', 'Start a call');
  }
  function setHostName(v) {
    store.set('beside.name.host', cleanName(v));
    renderLink();
  }

  // ---------- GUEST ----------
  const G = {
    peer: null, conn: null, spare: null, call: null, mic: null, muted: false, retry: 0, lagTimer: 0, left: true,
    openTimer: 0, picTimer: 0, tries: 0, quiet: 0, reopenedAt: 0, waitSince: 0,
    lost: false, dropped: false, joining: false, serverDown: false,
    cam: null, blank: null, camSender: null, camOn: false, camBusy: false, view: null, viewFor: null, hostVer: 0, room: null,
    hostName: '', ctx: null, display: null, screenTrack: null, screenBlank: null, screenSender: null,
  };
  const hostId = PREFIX + guestCode;
  const MIC_BLOCKED = 'Your microphone is blocked, so you can watch and listen but they can’t hear you. Allow the microphone for this site to talk. If this link opened inside another app (WhatsApp, Instagram…), open it in Safari or Chrome instead.';

  function setJoinBusy(b) { ['joinBtn', 'joinNoMicBtn'].forEach((id) => { const el = $(id); if (el) el.disabled = b; }); }
  async function guestJoin(withMic) {
    if (!peerLibOk() || G.joining || (G.peer && !G.peer.destroyed)) return; // double tap
    G.joining = true;
    setJoinBusy(true);
    try {
      G.left = false;
      G.lost = G.dropped = false;
      G.tries = G.quiet = G.reopenedAt = 0;
      // Unlock sound inside the tap (iPhone): their voice plays in its own element.
      const vo = $('voice');
      if (vo) { vo.muted = false; vo.play().catch(() => {}); }
      if (G.mic) { G.mic.getTracks().forEach((t) => t.stop()); G.mic = null; }
      if (withMic && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          G.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        } catch (e) {
          note(MIC_BLOCKED, 'stay');
        }
      }
      G.muted = !G.mic;
      setPressed('gMuteBtn', G.muted, 'Unmute my mic', 'Mute my mic');
      if (!G.blank) G.blank = blankTrack();
      if ($('nameInput')) store.set('beside.name', cleanName($('nameInput').value));
      wait('Connecting…', 'Looking for ' + (theirName || 'them') + '…', '');
      openGuestPeer();
    } finally {
      G.joining = false;
      setJoinBusy(false);
    }
  }
  // Forget any knocks in flight (closing them quietly, so they don't count as losing the call).
  function dropKnocks() {
    clearTimeout(G.openTimer);
    clearTimeout(G.picTimer);
    const list = [G.conn, G.spare];
    G.conn = G.spare = null;
    list.forEach((c) => { if (c) { try { c.close(); } catch (e) {} } });
  }
  function openGuestPeer() {
    dropKnocks();
    if (G.call) { const c = G.call; G.call = null; try { c.close(); } catch (e) {} }
    if (G.peer && !G.peer.destroyed) { try { G.peer.destroy(); } catch (e) {} }
    const peer = new Peer(PEER_OPTS);
    app.guestPeers++;
    G.peer = peer;
    // 'open' also fires after a call-server blip; an existing link to them must be left alone.
    peer.on('open', () => {
      if (G.peer !== peer || G.left || (G.conn && G.conn.open) || app.state === 'watching') return;
      if (G.serverDown) { G.serverDown = false; if (G.lost) lostText(); else wait('Connecting…', 'Looking for ' + (theirName || 'them') + '…', ''); }
      guestConnect();
    });
    peer.on('call', (call) => guestOnCall(peer, call));
    peer.on('disconnected', () => {
      if (G.left || G.peer !== peer || peer.destroyed) return;
      setTimeout(() => { if (!G.left && G.peer === peer && !peer.destroyed && peer.disconnected) { try { peer.reconnect(); } catch (e) {} } }, 1500);
    });
    peer.on('error', (e) => {
      if (G.left || G.peer !== peer) return;
      const t = e && e.type;
      if (t === 'peer-unavailable') {
        G.quiet = 0; // the call server is answering us
        // An earlier knock found nobody. If a later one got through or was answered, they're live: ignore it.
        if (app.state === 'watching' || answered(G.conn) || answered(G.spare) || (G.conn && G.conn.open)) return;
        clearTimeout(G.openTimer);
        notLiveYet();
        guestRetry();
      } else if (t === 'browser-incompatible') {
        note('This browser can’t join calls. Try Safari or Chrome.', 'stay');
      } else if (NET_ERR.test(t || '')) {
        if (app.state !== 'watching') {
          G.serverDown = true;
          wait('Can’t reach the call server.', 'Trying again…', 'Check your internet connection. On work or hospital Wi-Fi, try mobile data.');
          guestRetry();
        }
      }
    });
  }
  function guestOnCall(peer, call) {
    if (G.peer !== peer || G.left || call.peer !== hostId) { try { call.close(); } catch (e) {} return; }
    if (G.call) { const old = G.call; G.call = null; try { old.close(); } catch (e) {} }
    G.call = call;
    // Answer with the mic and the camera lane (the camera, or the blank that holds its place).
    const slot = G.cam ? G.cam.getVideoTracks()[0] : G.blank;
    const out = (G.mic ? G.mic.getAudioTracks() : []).concat(slot ? [slot] : []);
    call.answer(out.length ? ordered(out) : undefined);
    const pc = call.peerConnection;
    G.camSender = (pc && slot && pc.getSenders().find((s) => s.track === slot)) || null;
    if (pc) {
      iceProblem(pc,
        (never) => {
          if (G.call !== call) return;
          G.call = null;
          try { call.close(); } catch (e) {}
          dropKnocks();
          clearInterval(G.lagTimer);
          app.watching = false;
          G.camOn = false;
          roomReset();
          guestFace();
          if (never) wait('Can’t connect you two.', 'Trying again…', NET_WHY);
          else { G.lost = G.dropped = true; lostText(); }
          G.tries = 0;
          guestRetry();
        },
        () => note('Connection is shaky. Reconnecting…', 'info'),
        () => { if (G.call === call) { tuneCam(G.camSender); tell(G.conn, { cam: !!G.cam }); } });
    }
    call.on('stream', (s) => { if (G.call === call) guestWatch(s, pc); });
    call.on('close', () => { if (G.call === call) guestLost(); });
  }
  function guestConnect() {
    if (G.left || app.state === 'watching') return;
    if (!G.peer || G.peer.destroyed) { openGuestPeer(); return; } // e.g. the call server was down when we started
    if (!G.peer.open) {
      // Still reaching the call server: 'open' calls us back. Keep a slow retry going in case it never does.
      if (G.peer.disconnected) { try { G.peer.reconnect(); } catch (e) {} }
      guestRetry();
      return;
    }
    clearTimeout(G.retry);
    // The last knock stays open one more round if nobody answered it: a slow call server may still deliver the answer.
    if (G.spare) { const s = G.spare; G.spare = null; try { s.close(); } catch (e) {} }
    const old = G.conn;
    G.conn = null;
    if (old && !old.open && !answered(old)) G.spare = old;
    else if (old) { try { old.close(); } catch (e) {} }
    const conn = G.peer.connect(hostId, { reliable: true, metadata: { name: store.get('beside.name') || '' } });
    G.conn = conn;
    knock(conn);
  }
  function knock(conn) {
    let opened = false;
    const at = Date.now();
    // No answer within 4 s: they're not live yet, or the call server dropped the knock (0.peerjs.com sometimes
    // drops a knock on a link that isn't live without saying so), so knock again; after ~10 minutes, every 12 s.
    // An answer but no link after 15 s: one of the networks is blocking the call.
    const patience = G.tries > 150 ? 12000 : 4000;
    const check = () => {
      if (G.conn !== conn || opened || G.left || app.state === 'watching') return;
      const age = Date.now() - at;
      const heard = answered(conn) || answered(G.spare);
      if (heard) G.quiet = 0;
      if (!heard && age >= patience) {
        G.tries++;
        G.quiet++;
        notLiveYet();
        // Three knocks in a row with no word from the call server: our line to it may have died without
        // saying so (a phone switching networks). Open a fresh one, at most once a minute.
        if (G.quiet >= 3 && Date.now() - G.reopenedAt > 60000) { G.quiet = 0; G.reopenedAt = Date.now(); openGuestPeer(); }
        else guestConnect();
        return;
      }
      if (heard && age >= 15000) { wait('Can’t connect you two.', 'Trying again…', NET_WHY); guestRetry(); return; }
      G.openTimer = setTimeout(check, 1000);
    };
    clearTimeout(G.openTimer);
    G.openTimer = setTimeout(check, 1000);
    conn.on('open', () => {
      if (G.left) { try { conn.close(); } catch (e) {} return; }
      if (G.conn !== conn) {
        // The answer to the knock before came late: use it, unless the newer knock already got through.
        if (G.spare !== conn || app.state === 'watching' || (G.conn && G.conn.open)) { try { conn.close(); } catch (e) {} return; }
        G.spare = null;
        const newer = G.conn;
        G.conn = conn;
        if (newer) { try { newer.close(); } catch (e) {} }
      }
      opened = true;
      tell(conn, { t: 'hello', v: VER, name: cleanName(store.get('beside.name') || ''), share: CAN_SHARE });
      G.tries = G.quiet = 0;
      clearTimeout(G.openTimer);
      clearTimeout(G.retry);
      if (app.state === 'watching') return;
      wait('Found ' + (theirName || 'them') + '.', 'Joining the call…', '');
      // The picture follows within a second or two. If a message got lost on the way, start over.
      clearTimeout(G.picTimer);
      G.picTimer = setTimeout(() => {
        if (G.conn !== conn || G.left || app.state === 'watching') return;
        if (G.call) { const c = G.call; G.call = null; try { c.close(); } catch (e) {} }
        dropKnocks();
        wait('Connecting…', 'Trying again…', '');
        guestRetry();
      }, 10000);
    });
    conn.on('close', () => { if (G.conn === conn && (opened || G.call)) guestLost(); });
    conn.on('data', (d) => { if (G.conn === conn) guestData(d); });
  }
  // Everything the host sends on the data link. Unknown or broken messages are ignored.
  function guestData(d) {
    try {
      if (!d || typeof d !== 'object') return;
      if (!d.t && 'cam' in d) { G.camOn = !!d.cam; guestFace(); return; }
      if (d.t === 'hello') {
        G.hostVer = +d.v || 0;
        G.hostName = cleanName(d.name);
        if (G.hostName && !theirName) { text('camName', G.hostName); text('tapToHearText', 'Tap to hear ' + G.hostName); }
        layout();
      } else if (d.t === 'room') {
        const room = { sharer: typeof d.sharer === 'string' ? d.sharer.slice(0, 80) : '', name: cleanName(d.name), n: +d.n || 0 };
        if (!G.room || G.room.sharer !== room.sharer || G.room.n !== room.n) V.pin = ''; // a new share always shows big
        G.room = room;
        layout();
      } else if (d.t === 'chat') {
        if (typeof d.text !== 'string') return;
        const t = d.text.slice(0, 2000).trim();
        if (t) chatAdd(false, cleanName(d.name) || (d.from === hostId ? hostLabel() : '') || 'Someone', t);
      } else if (d.t === 'ping') {
        const xy = okPing(d);
        if (!xy) return;
        showDot(xy[0], xy[1], String(d.from || hostId), cleanName(d.name));
        maybeTick();
      } else if (d.t === 'file') {
        fileStart('h:' + String(d.id).slice(0, 12), d, cleanName(d.name) || (d.from === hostId ? hostLabel() : '') || 'Someone');
      } else if (d.t === 'part') filePart('h:' + String(d.id).slice(0, 12), d);
    } catch (e) { /* a bad message never breaks the call */ }
  }
  function roomReset() { G.hostVer = 0; G.room = null; }
  function answered(conn) { const pc = conn && conn.peerConnection; return !!(pc && pc.remoteDescription); }
  function notLiveYet() {
    if (app.state === 'watching') return;
    if (G.serverDown || (G.peer && !G.peer.open)) return; // "Can't reach the call server" stays until we're back
    if (G.lost) { lostText(); return; }
    wait(theirName ? 'You’re in. ' + theirName + ' hasn’t started the call yet.' : 'You’re in. They haven’t started the call yet.',
      'Waiting for ' + (theirName || 'them') + '…',
      'Keep this open. You’ll join the moment ' + (theirName ? theirName + ' starts' : 'they start') + '.');
  }
  // After a call: a dropped connection keeps saying so until it's back; an end says they ended it.
  function lostText() {
    if (G.dropped) wait('The connection dropped.', 'Reconnecting…', 'Usually a Wi-Fi hiccup. Keep this open.');
    else wait((theirName || 'They') + ' ended the call.', 'Waiting for ' + (theirName || 'them') + ' to start again…', 'Keep this open and it reconnects by itself.');
  }
  function wait(title, status, hint) {
    if (app.state !== 'waiting') G.waitSince = Date.now();
    show('waiting');
    text('waitTitle', title);
    text('waitingText', status);
    text('waitHint', hint);
    // Keep the screen on so a locked phone doesn't miss the start; give up after 20 minutes to save battery.
    stayAwake(Date.now() - G.waitSince < 20 * 60000);
  }
  function guestRetry() {
    clearTimeout(G.retry);
    if (G.left) return;
    // Quick at first (1 s), then about every 4 s; after ~10 minutes every 12 s to save battery.
    const ms = Math.min(G.tries > 150 ? 12000 : 4000, 1000 * Math.pow(1.4, G.tries || 0));
    G.tries = (G.tries || 0) + 1;
    G.retry = setTimeout(guestConnect, ms);
  }
  function guestWatch(stream, pc) {
    if (pc) {
      pc.getReceivers().forEach((r) => {
        if (!r.track || r.track.kind !== 'video') return; // sound keeps its default buffer so it doesn't crackle
        try { r.jitterBufferTarget = 0; } catch (e) {}
        try { r.playoutDelayHint = 0; } catch (e) {}
      });
    }
    clearTimeout(G.retry);
    clearTimeout(G.picTimer);
    if (G.spare) { const s = G.spare; G.spare = null; try { s.close(); } catch (e) {} }
    show('watching');
    // An old host never says hello, and it was only live while sharing: its screen lane is the picture.
    if (!G.hostVer && !G.room) G.room = { sharer: hostId, name: theirName };
    // The sound has its own element, because a video whose picture lane is empty never starts its sound.
    // PeerJS fires 'stream' once per track: only set what changed.
    const a = stream.getAudioTracks()[0];
    const vo = $('voice');
    if (vo && a && (!vo.srcObject || vo.srcObject.getAudioTracks()[0] !== a)) {
      vo.srcObject = new MediaStream([a]);
      vo.muted = false;
      playWithSound(vo);
    }
    layout();
    tell(G.conn, { cam: !!G.cam });
    clearInterval(G.lagTimer);
    G.lagTimer = setInterval(async () => { const r = await rtt(pc); app.lag = r; setLag('lag', r); }, 2000);
    app.watching = true;
    G.lost = G.dropped = false;
    G.tries = G.quiet = 0;
    stayAwake(true);
    wakeControls();
  }
  function playWithSound(el) {
    el.play().then(() => { app.autoplayErr = ''; tapHide(); }).catch((e) => {
      app.autoplayErr = e && e.name;
      if (!e || e.name !== 'NotAllowedError') return;
      // Sound blocked until the next tap: offer "Tap to hear".
      const t = $('tapToHear');
      if (t) t.hidden = false;
      wakeControls();
    });
  }
  // iPhone pauses media while locked, in another app, or when the camera starts: start it again.
  function resumeMedia() {
    if (app.state !== 'watching') return;
    const v = $('screenVideo');
    if (v && v.srcObject && v.paused) v.play().catch(() => {});
    const vo = $('voice');
    if (vo && vo.srcObject && vo.paused) playWithSound(vo);
  }
  function tapHide() { const t = $('tapToHear'); if (t) t.hidden = true; }
  function guestLost() {
    if (G.left) return;
    clearInterval(G.lagTimer);
    app.watching = false;
    const v = $('screenVideo');
    if (v) v.srcObject = null;
    const vo = $('voice');
    if (vo) vo.srcObject = null;
    tapHide();
    G.view = G.viewFor = null;
    G.camOn = false;
    roomReset();
    V.pin = '';
    chatReset();
    guestFace();
    const pc = G.call && G.call.peerConnection;
    G.dropped = !!(pc && /failed|disconnected/.test(pc.iceConnectionState));
    if (G.call) { const c = G.call; G.call = null; try { c.close(); } catch (e) {} }
    dropKnocks();
    G.lost = true;
    G.tries = 0;
    lostText();
    guestRetry();
  }
  function guestMute() {
    if (!G.mic) { note('Your microphone is off for this call. Leave and join again with the mic to talk.', 'info'); return; }
    G.muted = !G.muted;
    G.mic.getAudioTracks().forEach((t) => { t.enabled = !G.muted; });
    setPressed('gMuteBtn', G.muted, 'Unmute my mic', 'Mute my mic');
  }
  function guestFace() { layout(); }
  async function guestCam() {
    if (G.camBusy || G.left) return;
    if (!G.blank) { note('This browser can’t send your camera. Use Safari or Chrome.', 'info'); return; }
    if (G.cam) { const s = G.cam; G.cam = null; guestSlot(G.blank); s.getTracks().forEach((t) => t.stop()); return; }
    G.camBusy = true;
    try {
      let s;
      try { s = await getCam(); } catch (e) { note(camError(e), 'stay'); return; }
      if (G.left || G.cam) { s.getTracks().forEach((t) => t.stop()); return; }
      G.cam = s;
      const t = s.getVideoTracks()[0];
      t.addEventListener('ended', () => { if (G.cam === s) { G.cam = null; guestSlot(G.blank); } });
      guestSlot(t);
      await keepMic();
      // iPhone can pause other media while the camera starts.
      resumeMedia();
    } finally { G.camBusy = false; }
  }
  // Older iPhones end the microphone when the camera starts: get it back and put it in the same place.
  async function keepMic() {
    const a = G.mic && G.mic.getAudioTracks()[0];
    if (!a || a.readyState !== 'ended') return;
    try {
      const m = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const t = m.getAudioTracks()[0];
      t.enabled = !G.muted;
      const pc = G.call && G.call.peerConnection;
      const snd = pc && pc.getSenders().find((x) => x.track === a);
      if (snd) await snd.replaceTrack(t);
      G.mic = m;
    } catch (e) { note('Your microphone stopped when the camera started. Leave and join again to talk.', 'stay'); }
  }
  function guestSlot(track) {
    if (G.camSender) G.camSender.replaceTrack(track).then(() => tuneCam(G.camSender)).catch(() => {});
    setPressed('gCamBtn', !!G.cam, 'Turn my camera off', 'Turn my camera on');
    tell(G.conn, { cam: !!G.cam });
    layout();
  }
  function guestLeave() {
    G.left = true;
    clearTimeout(G.retry);
    clearInterval(G.lagTimer);
    dropKnocks();
    try { if (G.call) G.call.close(); } catch (e) {}
    try { if (G.peer) G.peer.destroy(); } catch (e) {}
    [G.mic, G.cam].forEach((s) => s && s.getTracks().forEach((t) => t.stop()));
    G.peer = G.call = G.mic = G.cam = G.camSender = G.view = G.viewFor = null;
    G.camOn = false;
    roomReset();
    V.pin = '';
    chatReset();
    app.watching = false;
    guestFace();
    setPressed('gCamBtn', false, 'Turn my camera off', 'Turn my camera on');
    const v = $('screenVideo');
    if (v) v.srcObject = null;
    const vo = $('voice');
    if (vo) vo.srcObject = null;
    tapHide();
    stayAwake(false);
    ended('You left.', 'Open the link again any time.', 'Join again');
  }
  function fullscreen() {
    const v = $('screenVideo');
    const box = $('watchRoot') || document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      try { (document.exitFullscreen || document.webkitExitFullscreen).call(document); } catch (e) {}
      return;
    }
    if (document.fullscreenEnabled && box.requestFullscreen) { box.requestFullscreen().catch(() => {}); return; }
    if (document.webkitFullscreenEnabled && box.webkitRequestFullscreen) { box.webkitRequestFullscreen(); return; }
    // iPhone: only the system video player can go full screen. Tap Done to come back.
    if (v && v.webkitEnterFullscreen) { try { v.webkitEnterFullscreen(); } catch (e) {} }
  }
  let idleTimer = 0;
  let wokeAt = 0;
  function wakeControls(e) {
    // A tap on a hidden control only brings the controls back; the click it makes is swallowed below.
    if (e && e.type === 'pointerdown' && document.body.classList.contains('idle')) wokeAt = Date.now();
    document.body.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (canIdle()) document.body.classList.add('idle'); }, 3000);
  }
  // The bars fade after 3 s, except while you're alone, or More, the check or the chat is open.
  function canIdle() {
    if (app.state !== 'watching' && app.state !== 'live') return false;
    const t = $('tapToHear');
    if (t && !t.hidden) return false;
    if (!isGuest && !watchers().length) return false;
    const ck = document.querySelector('[data-state="check"]');
    if (moreOpen() || (ck && !ck.hidden) || document.body.classList.contains('chat-open')) return false;
    return true;
  }

  // ---------- SELF-CHECK ----------
  const ICON = {
    ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
    problem: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 7v6M12 17h.01"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 7v6M12 17h.01"/></svg>',
    checking: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 3a9 9 0 1 0 9 9"/></svg>',
    skip: '',
  };
  const META = { ok: 'Fine', problem: 'Problem', warn: 'Note', checking: 'checking…', skip: 'Not yet' };
  function checkRow(key, label) {
    const list = $('checkList');
    if (!list) return { set() {} };
    let li = list.querySelector('[data-check="' + key + '"]');
    if (!li) {
      li = document.createElement('li');
      li.dataset.check = key;
      li.innerHTML = '<div class="rowline"><span class="st" aria-hidden="true"></span><span class="ck-label"></span><span class="meta"></span></div><div class="why"></div>';
      list.appendChild(li);
    }
    li.querySelector('.ck-label').textContent = label;
    return {
      set(state, why, meta) {
        const st = state === 'bad' ? 'problem' : state === 'wait' ? 'checking' : state;
        li.dataset.st = st;
        li.querySelector('.st').innerHTML = ICON[st] || '';
        li.querySelector('.meta').textContent = meta || META[st] || '';
        li.querySelector('.why').textContent = why || '';
        app.checks = app.checks || {};
        app.checks[key] = { state, why: why || '' };
      },
    };
  }
  function browserName() {
    const u = navigator.userAgent;
    return /Edg\//.test(u) ? 'Edge' : /Firefox\//.test(u) ? 'Firefox' : /CriOS|Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : 'Browser';
  }
  function withTimeout(p, ms) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]); }
  function parseCand(c) {
    const f = String(c || '').split(' ');
    const i = f.indexOf('typ');
    if (i < 0) return null;
    return { proto: (f[2] || '').toLowerCase(), ip: f[4], port: f[5], typ: f[i + 1] };
  }

  async function runChecks() {
    const list = $('checkList');
    if (list) list.innerHTML = '';
    app.checks = {};
    app.checkDone = false;
    const panel = document.querySelector('[data-state="check"]');
    closeMore();
    if (panel) panel.hidden = false;
    text('checkSummary', 'Checking…');
    const closeBtn = $('checkClose');
    if (closeBtn) closeBtn.focus();

    const basics = checkRow('basics', 'Calls work here');
    const micRow = checkRow('mic', 'Microphone');
    const server = checkRow('server', 'Can reach the call server');
    const net = checkRow('net', 'Network allows direct calls');
    const link = checkRow('link', isGuest ? 'Connection to ' + (theirName || 'them') : 'Connection to your friend');
    [basics, micRow, server, net, link].forEach((r) => r.set('wait'));

    if (!window.isSecureContext) basics.set('bad', 'This page must be opened with https:// at the start. Use the link exactly as it was sent.');
    else if (!window.RTCPeerConnection) basics.set('bad', 'This browser is too old for calls. Update it, or use Chrome or Safari.');
    else if (!isGuest && !CAN_SHARE) basics.set('warn', 'Calls work here. Sharing your screen needs Chrome on a computer.');
    else basics.set('ok', '', browserName());

    const micP = (async () => {
      const live = isGuest ? G.mic : H.mic;
      if (live && live.getAudioTracks().some((t) => t.readyState === 'live')) {
        return micRow.set('ok', (isGuest ? G.muted : H.muted) ? 'Working, but you’re muted.' : '');
      }
      try {
        if (navigator.permissions && navigator.permissions.query) {
          const p = await navigator.permissions.query({ name: 'microphone' });
          if (p.state === 'denied') return micRow.set('bad', 'Blocked for this site. Click the icon at the left of the address bar (on iPhone: aA, then Website Settings) and allow the microphone, then reload.', 'Blocked');
        }
      } catch (e) { /* Safari has no microphone permission query */ }
      try {
        const s = await withTimeout(navigator.mediaDevices.getUserMedia({ audio: true }), 15000);
        s.getTracks().forEach((t) => t.stop());
        micRow.set('ok');
      } catch (e) {
        if (e && e.name === 'NotFoundError') micRow.set('bad', 'No microphone found. Plug in headphones with a mic, or check your sound settings.', 'None');
        else if (e && e.message === 'timeout') micRow.set('bad', 'The browser is still waiting for you to allow the microphone.');
        else micRow.set('bad', 'Blocked. Allow the microphone for this site in the browser, then reload. On a Mac also check System Settings, Privacy & Security, Microphone. Inside WhatsApp or Instagram, open the link in Safari instead.', 'Blocked');
      }
    })();

    const serverP = (async () => {
      if (!window.Peer) return server.set('bad', 'Part of the page didn’t load. Reload, and check your internet or any ad blocker.');
      const peer = new Peer(PEER_OPTS);
      const t0 = Date.now();
      try {
        await withTimeout(new Promise((res, rej) => { peer.on('open', res); peer.on('error', rej); }), 9000);
        server.set('ok', '', (Date.now() - t0) + ' ms');
      } catch (e) {
        server.set('bad', 'Can’t reach the call server. Check your internet. A firewall or blocker on this network may be stopping it.');
      } finally { peer.destroy(); }
    })();

    const netP = (async () => {
      if (srv) return net.set('ok', '', 'Test mode');
      let pc;
      try {
        pc = new RTCPeerConnection({ iceServers: ICE });
        pc.createDataChannel('x');
        const cands = [];
        const done = new Promise((res) => {
          pc.onicecandidate = (e) => { if (!e.candidate) res(); else cands.push(e.candidate.candidate); };
          setTimeout(res, 6000);
        });
        await pc.setLocalDescription(await pc.createOffer());
        await done;
        const srflx = cands.map(parseCand).filter((c) => c && c.typ === 'srflx' && c.proto === 'udp');
        if (!srflx.length) {
          net.set('bad', 'This network blocks the direct route calls use (common on work, school and hospital Wi-Fi). Try other Wi-Fi or a phone hotspot.', 'Blocked');
        } else {
          // The same public address showing different ports means the network changes ports for every contact ("strict").
          const byIp = {};
          srflx.forEach((c) => { (byIp[c.ip] = byIp[c.ip] || new Set()).add(c.port); });
          const strict = Object.values(byIp).some((ports) => ports.size > 1);
          if (strict) net.set('warn', 'This network is strict. Calls work with most other networks, but can fail if the other person is on a strict network too. If that happens, one of you should switch to home Wi-Fi.', 'Strict');
          else net.set('ok');
        }
      } catch (e) {
        net.set('bad', 'Couldn’t test the network (' + ((e && e.name) || 'unknown') + ').');
      } finally { if (pc) pc.close(); }
    })();

    const SLOW = 'The delay is high. Moving closer to the Wi-Fi router, or closing big downloads and other video calls, can help.';
    const linkP = (async () => {
      if (isGuest) {
        if (app.state === 'watching') {
          const r = await rtt(G.call && G.call.peerConnection);
          link.set(r != null && r > 300 ? 'bad' : 'ok', r != null && r > 300 ? SLOW : '', r != null ? Math.round(r) + ' ms' : 'Connected');
        } else if (G.peer && !G.left) link.set('bad', 'Not connected yet. ' + (($('waitHint') && $('waitHint').textContent) || ''), 'Not yet');
        else link.set('skip');
      } else if (app.state !== 'live') link.set('skip');
      else if (!H.guests.size) link.set('skip', '', 'Nobody yet');
      else {
        let bad = 0;
        for (const g of H.guests.values()) { const pc = g.call && g.call.peerConnection; if (!pc || pc.iceConnectionState === 'failed') bad++; }
        const first = [...H.guests.values()][0];
        const r = await rtt(first.call && first.call.peerConnection);
        if (bad) link.set('bad', NET_FAIL);
        else link.set(r != null && r > 300 ? 'bad' : 'ok', r != null && r > 300 ? SLOW : '', r != null ? Math.round(r) + ' ms' : 'Connected');
      }
    })();

    await Promise.all([micP, serverP, netP, linkP]);
    const vals = Object.values(app.checks);
    const bad = vals.filter((c) => c.state === 'bad').length;
    const warn = vals.filter((c) => c.state === 'warn').length;
    const fine = vals.filter((c) => c.state === 'ok').length;
    const el = $('checkSummary');
    if (el) {
      el.textContent = '';
      const b = document.createElement('b');
      b.textContent = fine + ' of 5 fine';
      el.append(b, bad ? ' · ' + bad + (bad === 1 ? ' problem' : ' problems') : warn ? ' · 1 note' : ' · nothing to fix');
    }
    app.checkDone = true;
  }

  // ---------- WIRE UP ----------
  function boot() {
    document.body.dataset.role = isGuest ? 'guest' : 'host';
    if (store.get('beside.mode') === 'motion') H.mode = 'motion';
    modeLabel();
    const saved = store.get('beside.name');
    if (saved && $('nameInput')) $('nameInput').value = saved;
    on('startBtn', 'click', hostStart);
    on('micStartToggle', 'click', () => {
      const el = $('micStartToggle');
      const onNow = el.getAttribute('aria-pressed') === 'false';
      el.setAttribute('aria-pressed', onNow ? 'true' : 'false');
      text('micStartLabel', onNow ? 'Mic on' : 'Mic off');
      const sw = el.querySelector('.switch');
      if (sw) sw.classList.toggle('off', !onNow);
    });
    ['copyBtn', 'moreCopyBtn'].forEach((id) => on(id, 'click', () => copyLink($(id))));
    ['shareBtn', 'moreShareBtn'].forEach((id) => on(id, 'click', () => shareLink($(id))));
    on('muteBtn', 'click', hostMute);
    on('camBtn', 'click', hostCam);
    on('screenBtn', 'click', () => { if (amSharing()) hostUnshare(); else hostShare(); });
    on('gCamBtn', 'click', guestCam);
    on('changeBtn', 'click', () => { closeMore(); hostChange(); });
    on('stopBtn', 'click', () => hostStop());
    document.querySelectorAll('#modeToggle [data-mode]').forEach((b) => b.addEventListener('click', () => hostMode(b.dataset.mode)));
    on('hostName', 'change', (e) => setHostName(e.target.value));
    on('newLinkBtn', 'click', newLink);
    on('joinBtn', 'click', () => guestJoin(true));
    on('joinNoMicBtn', 'click', () => guestJoin(false));
    on('gMuteBtn', 'click', guestMute);
    on('fsBtn', 'click', () => { closeMore(); fullscreen(); });
    on('leaveBtn', 'click', guestLeave);
    on('waitLeaveBtn', 'click', guestLeave);
    on('watchRoot', 'click', swapTap);
    wirePointing();
    on('chatBtn', 'click', () => chatOpen(!C.open));
    on('chatClose', 'click', () => chatOpen(false));
    on('chatForm', 'submit', (e) => { e.preventDefault(); sendText(); });
    on('attachBtn', 'click', () => { const f = $('fileInput'); if (f) f.click(); });
    on('fileInput', 'change', (e) => { const f = e.target; sendFiles(f.files).finally(() => { f.value = ''; }); });
    on('chatInput', 'paste', (e) => {
      const files = e.clipboardData && e.clipboardData.files;
      if (files && files.length) { e.preventDefault(); sendFiles(files); }
    });
    on('chatList', 'click', (e) => { const im = e.target && e.target.closest && e.target.closest('img.photo'); if (im) showPhoto(im.src); });
    on('viewer', 'click', () => { $('viewer').hidden = true; });
    // Computers: drop files anywhere on the call.
    const dropOk = (e) => chatAvailable() && e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
    on('watchRoot', 'dragover', (e) => { if (!dropOk(e)) return; e.preventDefault(); document.body.classList.add('dropping'); });
    on('watchRoot', 'dragleave', (e) => { if (e.target === $('watchRoot') || !$('watchRoot').contains(e.relatedTarget)) document.body.classList.remove('dropping'); });
    on('watchRoot', 'drop', (e) => {
      document.body.classList.remove('dropping');
      if (!dropOk(e)) return;
      e.preventDefault();
      chatOpen(true);
      sendFiles(e.dataTransfer.files);
    });
    if (window.visualViewport) {
      // Phones: keep the chat's typing line above the on-screen keyboard.
      const kb = () => {
        const vv = window.visualViewport;
        document.documentElement.style.setProperty('--kb', Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) + 'px');
      };
      visualViewport.addEventListener('resize', kb);
      visualViewport.addEventListener('scroll', kb);
    }
    on('miniBtn', 'click', () => { if (mini.win) miniClose(); else miniOpen(); });
    on('moreBtn', 'click', () => { if (moreOpen()) closeMore(); else openMore(); });
    on('moreClose', 'click', closeMore);
    on('tapToHear', 'click', () => { const vo = $('voice'); if (vo) { vo.muted = false; vo.play().then(tapHide, () => {}); } wakeControls(); });
    on('checkBtn', 'click', runChecks);
    document.querySelectorAll('[data-check-open]').forEach((b) => b.addEventListener('click', runChecks));
    const sheet = document.querySelector('[data-state="check"]');
    const closeSheet = () => { if (sheet) sheet.hidden = true; wakeControls(); };
    on('checkClose', 'click', closeSheet);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const vw = $('viewer');
      if (vw && !vw.hidden) vw.hidden = true;
      else if (sheet && !sheet.hidden) closeSheet();
      else if (moreOpen()) closeMore();
      else if (C.open) chatOpen(false);
    });
    if (sheet) sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
    const more = $('moreSheet');
    if (more) more.addEventListener('click', (e) => { if (e.target === more) closeMore(); });
    on('endedAction', 'click', () => { if (isGuest) show('join'); else hostStart(); });
    document.addEventListener('pointerdown', () => {
      if (H.ctx && H.ctx.state === 'suspended') H.ctx.resume().catch(() => {});
      // Safari can refuse to play a guest's voice until a click on the page.
      for (const g of H.guests.values()) {
        if (g.audio && g.audio.paused && g.audio.srcObject) {
          g.audio.play().then(() => { const n = $('note'); if (n && /to hear/.test(n.textContent)) n.hidden = true; }).catch(() => {});
        }
      }
    }, { passive: true });
    const inCall = () => app.state === 'watching' || app.state === 'live';
    ['pointermove', 'pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, (e) => { if (inCall()) wakeControls(e); }, { passive: true, capture: true }));
    // A tap on hidden bars only brings them back (bubbles never hide, so a tap on one always counts).
    document.addEventListener('click', (e) => {
      const onBubble = e.target && e.target.closest && e.target.closest('#bubbles');
      if (wokeAt && Date.now() - wokeAt < 700 && inCall() && !onBubble) { e.stopPropagation(); e.preventDefault(); }
      wokeAt = 0;
    }, true);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (inCall() || (app.state === 'waiting' && Date.now() - G.waitSince < 20 * 60000)) stayAwake(true);
      resumeMedia();
    });
    const sv = $('screenVideo');
    if (sv) sv.addEventListener('webkitendfullscreen', () => { if (inCall()) sv.play().catch(() => {}); });
    addEventListener('hashchange', () => location.reload());
    addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });
    addEventListener('beforeunload', (e) => { if (app.state === 'live') { e.preventDefault(); e.returnValue = ''; } });
    addEventListener('pagehide', () => {
      if (H.peer) { try { H.peer.destroy(); } catch (e) {} }
      if (G.peer) { try { G.peer.destroy(); } catch (e) {} }
      if (app.state === 'live' && bc) bc.postMessage('off');
    });
    if (sheet) sheet.hidden = true;
    if ($('hostName')) $('hostName').value = myName();
    const sb = $('screenBtn');
    if (sb) sb.hidden = !CAN_SHARE;
    if (isGuest) {
      const n = theirName;
      if (n) {
        text('hostInitial', n.charAt(0).toUpperCase());
        text('joinTitle', n + ' invites you to a call.');
        text('joinText', 'You can talk, see each other if you like, and see what ' + n + ' shows you. Nothing is recorded.');
        text('joinBtn', 'Sit beside ' + n);
        text('tapToHearText', 'Tap to hear ' + n);
        text('camName', n);
        document.title = n + ' · Beside';
      } else {
        const hi = $('hostInitial');
        if (hi) hi.classList.add('hollow');
      }
      show('join');
    } else {
      H.code = hostCode();
      renderLink();
      show('idle');
      if (bc) bc.postMessage('live?');
    }
    if (!window.Peer) peerLibOk();
    if (LOCAL) app.debug = { H, G, V, C }; // automated tests only
    app.booted = true;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
