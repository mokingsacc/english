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
      el.hidden = el.dataset.state !== state;
    });
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
  function showFace(el, track, on) {
    if (!el) return;
    const v = el.querySelector('video');
    if (on && track && v) {
      if (!v.srcObject || v.srcObject.getVideoTracks()[0] !== track) v.srcObject = new MediaStream([track]);
      v.play().catch(() => {});
      el.hidden = false;
    } else {
      if (v && document.pictureInPictureElement === v) document.exitPictureInPicture().catch(() => {});
      if (v) v.srcObject = null;
      el.hidden = true;
    }
  }
  function camError(e) {
    const n = e && e.name;
    if (n === 'NotAllowedError') return 'Your camera is blocked for this site. Click the icon at the left of the address bar (on iPhone: aA, then Website Settings), allow the camera, then press the camera button again.';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'No camera found on this device.';
    if (n === 'NotReadableError') return 'Your camera is busy in another app. Close it there, then press the camera button again.';
    return 'The camera didn’t start (' + (n || 'unknown') + '). Try again.';
  }
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

  // ---------- HOST ----------
  const H = {
    peer: null, code: '', video: null, display: null, mic: null, ctx: null, dest: null,
    micGain: null, tabSrc: null, out: null, guests: new Map(), knocks: new Map(), muted: false, mode: 'detail',
    lagTimer: 0, idRetries: 0, stopping: false, starting: false, changing: false, otherTabLive: false,
  };
  // Tabs of this browser tell each other when one is sharing, so a second tab can say so at once.
  const bc = (() => { try { return new BroadcastChannel('beside'); } catch (e) { return null; } })();
  if (bc) {
    bc.onmessage = (e) => {
      if (isGuest) return;
      if (e.data === 'live?' && app.state === 'live') bc.postMessage('live!');
      else if (e.data === 'live!') H.otherTabLive = true;
      else if (e.data === 'off') H.otherTabLive = false;
    };
  }
  const OTHER_TAB = 'Beside is already sharing in another tab or window. Use that one, or press Stop there first.';

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
    const el = $('linkText');
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
  }
  function hostTitle() {
    if (app.state !== 'live') { document.title = 'Beside'; return; }
    const n = watchers().length;
    document.title = '● ' + (n ? n + ' watching' : 'Sharing') + ' · Beside';
  }

  async function getDisplay() {
    const v = { frameRate: { ideal: 30, max: 60 }, width: { max: 1920 }, height: { max: 1080 } };
    // Safari and Firefox: a plain request, made straight inside the click as Safari requires.
    if (!IS_CHROMIUM) return navigator.mediaDevices.getDisplayMedia({ video: v });
    // Chrome/Edge: open on the Tab list, hide "Entire screen", never offer this page itself,
    // and don't pop "Share this tab instead" whenever you switch tabs.
    const opts = {
      video: { ...v, displaySurface: 'browser' }, audio: true, preferCurrentTab: false,
      selfBrowserSurface: 'exclude', surfaceSwitching: 'exclude', systemAudio: 'exclude', monitorTypeSurfaces: 'exclude',
    };
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
  const WHOLE_SCREEN = 'Pick one tab or one app window, not the whole screen, so nothing else on your screen (like notifications) can be seen. Press Start sharing again.';
  function displayError(e) {
    const browser = IS_CHROMIUM ? 'Chrome' : 'your browser';
    if (e && /system/i.test(e.message || '')) {
      return 'Your Mac is blocking ' + browser + ' from sharing windows. Open System Settings, Privacy & Security, Screen & System Audio Recording, turn ' + browser + ' on, then quit and reopen it. Sharing a tab works without this.';
    }
    if (e && e.name === 'NotAllowedError') {
      return IS_CHROMIUM
        ? 'Nothing was shared. Press Start sharing and pick a tab or a window.'
        : 'Nothing was shared. Press Start sharing, choose Allow, then pick a window.';
    }
    return 'Screen sharing didn’t start (' + ((e && e.name) || 'unknown') + '). Try again, or use Chrome.';
  }

  function tuneSenders(pc) {
    pc.getSenders().forEach((s) => {
      if (!s.track || s.track.kind !== 'video') return;
      if (s.track !== H.video) { tuneCam(s); return; }
      const apply = (withPref) => {
        const p = s.getParameters(); // always fresh: browsers reject a stale parameters object
        if (!p.encodings || !p.encodings.length) p.encodings = [{}];
        p.encodings[0].maxBitrate = H.mode === 'detail' ? 6000000 : 4000000;
        p.encodings[0].maxFramerate = 30;
        if (withPref) {
          p.degradationPreference = H.mode === 'detail' ? 'maintain-resolution' : 'maintain-framerate';
          p.encodings[0].priority = 'high';
          p.encodings[0].networkPriority = 'high';
        }
        return s.setParameters(p);
      };
      try { apply(true).catch(() => { try { apply(false).catch(() => {}); } catch (e) {} }); } catch (e) { /* defaults are fine */ }
    });
  }
  function useVideoTrack(track) {
    track.contentHint = H.mode;
    track.addEventListener('ended', () => {
      if (H.video === track) hostStop('Sharing stopped because the tab or window closed, or Stop was pressed in the browser.');
    });
    H.video = track;
    const pv = $('previewVideo');
    if (pv) { pv.srcObject = new MediaStream([track]); pv.muted = true; pv.play().catch(() => {}); }
  }
  function useTabAudio(stream) {
    if (H.tabSrc) { try { H.tabSrc.disconnect(); } catch (e) {} H.tabSrc = null; }
    const a = stream.getAudioTracks()[0];
    if (a) { H.tabSrc = H.ctx.createMediaStreamSource(new MediaStream([a])); H.tabSrc.connect(H.dest); }
  }
  function setStartBusy(b) { ['startBtn', 'endedAction'].forEach((id) => { const el = $(id); if (el) el.disabled = b; }); }

  async function hostStart() {
    if (H.starting || app.state === 'live') return; // double click
    if (!CAN_SHARE) { note(NO_SHARE, 'stay'); return; }
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
      // Audio engine first, inside the click, so Safari lets it run.
      H.ctx = new (window.AudioContext || window.webkitAudioContext)();
      H.ctx.resume().catch(() => {});
      H.dest = H.ctx.createMediaStreamDestination();
      H.micGain = H.ctx.createGain();
      H.micGain.connect(H.dest);
      let display;
      try {
        display = await getDisplay();
      } catch (e) {
        hostCleanup();
        show('idle');
        note(displayError(e), 'stay');
        return;
      }
      if (isWholeScreen(display)) {
        display.getTracks().forEach((t) => t.stop());
        hostCleanup();
        show('idle');
        note(WHOLE_SCREEN, 'stay');
        return;
      }
      H.display = display;
      useVideoTrack(display.getVideoTracks()[0]);
      useTabAudio(display);
      const wantMic = !$('micStartToggle') || $('micStartToggle').getAttribute('aria-pressed') !== 'false';
      if (wantMic) {
        try {
          H.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
          H.ctx.createMediaStreamSource(H.mic).connect(H.micGain);
        } catch (e) {
          note('Your microphone is blocked, so they can see but not hear you. Click the icon at the left of the address bar, allow the microphone, then press Stop and Share again.', 'stay');
        }
      }
      H.muted = !H.mic;
      H.micGain.gain.value = H.muted ? 0 : 1;
      setPressed('muteBtn', H.muted, 'Unmute', 'Mute');
      H.blank = blankTrack();
      H.camSlot = H.blank;
      H.out = hostOut();
      H.code = hostCode();
      renderLink();
      show('live');
      guestStatus();
      setLag('lagHost', null);
      stayAwake(true);
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
        note('Your link is busy. If Beside is sharing on another computer or browser, stop it there, then press Share again.', 'stay');
        hostStop();
      } else if (t === 'browser-incompatible') {
        note('This browser can’t make calls. Use Chrome or Safari.', 'stay');
      } else if (NET_ERR.test(t || '')) {
        text('liveHint', 'Can’t reach the call server. Trying again… Anyone already watching stays connected.');
        // A server that never answered leaves PeerJS destroyed: start a fresh one.
        setTimeout(() => { if (H.peer === peer && !H.stopping && app.state === 'live' && peer.destroyed) openHostPeer(); }, 3000);
      }
    });
  }

  function hostAddGuest(conn) {
    if (!H.peer || H.peer.destroyed || !H.out || H.guests.has(conn.connectionId)) return;
    for (const [k, old] of H.guests) if (old.conn.peer === conn.peer) hostDropGuest(k); // same guest reconnecting
    const g = { conn, call: null, audio: null, live: false, name: cleanName(conn.metadata && conn.metadata.name) };
    const n = $('note');
    if (n && !n.hidden && n.textContent.includes(KNOCK_FAIL.trim())) note(''); // they got through after all
    let call = null;
    try { call = H.peer.call(conn.peer, H.out, { sdpTransform: preferH264 }); } catch (e) { call = null; }
    if (!call) { try { conn.close(); } catch (e) {} return; }
    g.call = call;
    H.guests.set(conn.connectionId, g);
    const pc = call.peerConnection;
    g.camSender = (pc && H.camSlot && pc.getSenders().find((s) => s.track === H.camSlot)) || null;
    if (pc) {
      iceProblem(pc,
        (never) => {
          if (never) note((g.name || 'Your guest') + ' couldn’t connect. ' + NET_WHY, 'stay');
          hostDropGuest(conn.connectionId); // after a drop the guest reconnects by itself
        },
        () => { text('liveHint', 'Connection is shaky. Reconnecting…'); },
        () => {
          tuneSenders(pc);
          text('liveHint', '');
          tell(conn, { cam: !!H.cam });
          if (!g.live) { g.live = true; guestStatus(); }
          hostFace(g);
        });
    }
    conn.on('data', (d) => { if (d && typeof d === 'object' && 'cam' in d && H.guests.get(conn.connectionId) === g) { g.camOn = !!d.cam; hostFace(g); } });
    tell(conn, { cam: !!H.cam });
    // Joined but the picture never connected (a lost message, or they vanished): let them knock again.
    setTimeout(() => { if (H.guests.get(conn.connectionId) === g && !g.live) hostDropGuest(conn.connectionId); }, 25000);
    call.on('stream', (s) => {
      if (!g.audio) {
        g.audio = new Audio();
        g.audio.autoplay = true;
        g.audio.setAttribute('playsinline', '');
        document.body.appendChild(g.audio);
      }
      if (g.audio.srcObject !== s) g.audio.srcObject = s;
      g.audio.play().catch(() => note('Click anywhere on this page to hear ' + (g.name || 'them') + '.', 'stay'));
    });
    call.on('close', () => hostDropGuest(conn.connectionId));
    guestStatus();
    startHostLag();
  }
  function hostDropGuest(id) {
    const g = H.guests.get(id);
    if (!g) return;
    H.guests.delete(id);
    try { if (g.call) g.call.close(); } catch (e) {}
    try { g.conn.close(); } catch (e) {}
    if (g.audio) { g.audio.srcObject = null; g.audio.remove(); }
    if (g.face) { showFace(g.face, null, false); g.face.remove(); g.face = null; }
    facesShown();
    guestStatus();
  }
  // Each guest's camera shows as a tile under the link; a click floats it over the other windows.
  function hostFace(g) {
    const pc = g.call && g.call.peerConnection;
    const track = g.camOn && g.live && pc ? lane(pc, 0) : null;
    if (track) {
      if (!g.face) {
        g.face = faceTile(g.name || 'Guest', false);
        const box = $('faces');
        if (box) box.insertBefore(g.face, $('selfFace'));
      }
      showFace(g.face, track, true);
    } else if (g.face) { showFace(g.face, null, false); g.face.remove(); g.face = null; }
    facesShown();
  }
  function faceTile(name, mine) {
    const b = document.createElement('button');
    b.className = 'face' + (mine ? ' me' : '');
    b.title = 'Float over your other windows';
    const v = document.createElement('video');
    v.muted = true; v.autoplay = true; v.setAttribute('playsinline', '');
    const lab = document.createElement('span');
    lab.textContent = name;
    b.append(v, lab);
    b.addEventListener('click', () => floatFace(v));
    return b;
  }
  function floatFace(v) {
    if (!v || !v.srcObject) return;
    if (document.pictureInPictureElement === v) { document.exitPictureInPicture().catch(() => {}); return; }
    if (document.pictureInPictureEnabled && v.requestPictureInPicture) v.requestPictureInPicture().catch(() => {});
  }
  function facesShown() {
    const box = $('faces');
    if (!box) return;
    const any = [...box.querySelectorAll('.face')].some((f) => !f.hidden);
    box.hidden = !any;
    const hint = $('facesHint');
    if (hint) hint.hidden = !any || !document.pictureInPictureEnabled || !box.querySelector('.face:not(.me):not([hidden])');
  }
  function hostOut() {
    return new MediaStream([H.video, H.dest.stream.getAudioTracks()[0]].concat(H.camSlot ? [H.camSlot] : []));
  }
  async function hostCam() {
    if (H.camBusy || app.state !== 'live') return;
    if (!H.blank) { note('This browser can’t send your camera. Use Chrome or Safari.', 'info'); return; }
    if (H.cam) { const s = H.cam; H.cam = null; hostSlot(H.blank); s.getTracks().forEach((t) => t.stop()); return; }
    H.camBusy = true;
    try {
      let s;
      try { s = await navigator.mediaDevices.getUserMedia({ video: CAM }); } catch (e) { note(camError(e), 'stay'); return; }
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
    if (H.video && H.dest) H.out = hostOut();
    showFace($('selfFace'), track, !!H.cam);
    setPressed('camBtn', !!H.cam, 'Camera on', 'Camera');
    facesShown();
  }
  function surfaceName() {
    let d = '';
    try { d = H.video && H.video.getSettings ? H.video.getSettings().displaySurface : ''; } catch (e) { d = ''; }
    return d === 'window' ? 'One window' : d === 'browser' ? 'One tab' : d === 'monitor' ? 'Entire screen' : 'Your screen';
  }
  function watchers() { return [...H.guests.values()].filter((g) => g.live); }
  function guestStatus() {
    const live = watchers();
    const joining = [...H.guests.values()].filter((g) => !g.live);
    const n = live.length;
    const names = live.map((g) => g.name).filter(Boolean);
    let s;
    if (n === 1) s = (names[0] || 'Someone') + ' is watching';
    else if (n > 1) s = n + ' people are watching';
    else if (joining.length === 1) s = (joining[0].name || 'Someone') + ' is joining…';
    else if (joining.length > 1) s = joining.length + ' people are joining…';
    else s = 'Waiting for someone to open your link';
    text('guestStatus', s);
    text('guestSub', surfaceName() + ' · mic ' + (H.mic && !H.muted ? 'on' : 'off'));
    const av = $('guestAvatar');
    if (av) {
      av.classList.toggle('empty', !n);
      av.textContent = !n ? '' : n > 1 ? String(n) : (names[0] || '•').charAt(0).toUpperCase();
    }
    document.body.dataset.guests = String(n);
    if (!n) setLag('lagHost', null);
    hostTitle();
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
      setLag('lagHost', worst);
    }, 2000);
  }
  function hostMute() {
    if (!H.mic) { note('No microphone yet. Allow the microphone for this site, then press Stop and Share again.', 'info'); return; }
    H.muted = !H.muted;
    H.micGain.gain.value = H.muted ? 0 : 1;
    setPressed('muteBtn', H.muted, 'Unmute', 'Mute');
    guestStatus();
  }
  async function hostChange() {
    if (H.changing || app.state !== 'live') return;
    H.changing = true;
    let s;
    try {
      s = await getDisplay();
    } catch (e) {
      if (e && /system/i.test(e.message || '')) note(displayError(e), 'stay');
      return;
    } finally {
      H.changing = false;
    }
    if (isWholeScreen(s)) { s.getTracks().forEach((t) => t.stop()); note(WHOLE_SCREEN.replace(' Press Start sharing again.', ''), 'stay'); return; }
    if (app.state !== 'live') { s.getTracks().forEach((t) => t.stop()); return; }
    const prev = H.display;
    const oldVideo = H.video;
    H.display = s;
    useVideoTrack(s.getVideoTracks()[0]);
    useTabAudio(s);
    for (const g of H.guests.values()) {
      const pc = g.call && g.call.peerConnection;
      if (!pc) continue;
      pc.getSenders().forEach((snd) => {
        if (snd.track && snd.track === oldVideo) snd.replaceTrack(H.video).then(() => tuneSenders(pc)).catch(() => {});
      });
    }
    H.out = hostOut();
    if (prev) prev.getTracks().forEach((t) => t.stop()); // video and tab sound of the old choice
    guestStatus();
  }
  function hostMode(mode) {
    if (mode === H.mode) return;
    H.mode = mode;
    store.set('beside.mode', H.mode);
    if (H.video) H.video.contentHint = H.mode;
    for (const g of H.guests.values()) if (g.call && g.call.peerConnection) tuneSenders(g.call.peerConnection);
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
    if (H.video) H.video.stop();
    if (H.blank) H.blank.stop();
    if (H.ctx) H.ctx.close().catch(() => {});
    H.display = H.mic = H.video = H.ctx = H.out = H.tabSrc = H.cam = H.camSlot = H.blank = null;
    showFace($('selfFace'), null, false);
    setPressed('camBtn', false, 'Camera on', 'Camera');
    facesShown();
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
    ended('You stopped sharing.', msg || 'Your link stays the same for next time.', 'Share again');
  }
  async function copyLink() {
    const link = hostLink();
    try {
      await navigator.clipboard.writeText(link);
    } catch (e) {
      const el = $('linkText');
      if (el) { const r = document.createRange(); r.selectNodeContents(el); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
      try { document.execCommand('copy'); } catch (e2) {}
    }
    const b = $('copyBtn');
    const lab = b && b.querySelector('.label-t');
    if (lab) { lab.textContent = 'Copied'; setTimeout(() => { lab.textContent = 'Copy'; }, 1500); }
  }
  async function shareLink() {
    const link = hostLink();
    if (navigator.share) {
      try { await navigator.share({ title: 'Beside', text: 'Open this to see my screen and talk with me:', url: link }); return; }
      catch (e) { if (e && e.name === 'AbortError') return; }
    }
    copyLink();
  }
  function newLink() {
    if (!confirm('Make a new link? The old link will stop working.')) return;
    hostCleanup();
    H.code = code8();
    store.set('beside.room', H.code);
    renderLink();
    ended('New link ready.', 'The old link no longer works. Press Share again, then send the new link.', 'Share again');
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
    cam: null, blank: null, camSender: null, camOn: false, camBusy: false, view: null, viewFor: null,
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
      // Unlock sound for this video inside the tap (iPhone).
      const v = $('screenVideo');
      if (v) { v.muted = false; v.play().catch(() => {}); }
      if (G.mic) { G.mic.getTracks().forEach((t) => t.stop()); G.mic = null; }
      if (withMic && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          G.mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
        } catch (e) {
          note(MIC_BLOCKED, 'stay');
        }
      }
      G.muted = !G.mic;
      setPressed('gMuteBtn', G.muted, 'Unmute', 'Mute');
      if (!G.blank) G.blank = blankTrack();
      if ($('nameInput')) store.set('beside.name', cleanName($('nameInput').value));
      wait('Connecting…', 'Looking for ' + (theirName || 'the person sharing') + '…', '');
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
      if (G.serverDown) { G.serverDown = false; if (G.lost) lostText(); else wait('Connecting…', 'Looking for ' + (theirName || 'the person sharing') + '…', ''); }
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
    call.answer(out.length ? new MediaStream(out) : undefined);
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
      G.tries = G.quiet = 0;
      clearTimeout(G.openTimer);
      clearTimeout(G.retry);
      if (app.state === 'watching') return;
      wait('Found ' + (theirName || 'them') + '.', 'Starting the picture…', '');
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
    conn.on('data', (d) => { if (G.conn === conn && d && typeof d === 'object' && 'cam' in d) { G.camOn = !!d.cam; guestFace(); } });
  }
  function answered(conn) { const pc = conn && conn.peerConnection; return !!(pc && pc.remoteDescription); }
  function notLiveYet() {
    if (app.state === 'watching') return;
    if (G.serverDown || (G.peer && !G.peer.open)) return; // "Can't reach the call server" stays until we're back
    if (G.lost) { lostText(); return; }
    wait(theirName ? 'You’re in. ' + theirName + ' hasn’t started yet.' : 'You’re in. They haven’t started yet.',
      'Waiting for ' + (theirName || 'them') + ' to start sharing…',
      'Keep this open. The moment ' + (theirName ? theirName + ' starts' : 'they start') + ', you’ll see the screen here.');
  }
  // After watching: a dropped connection keeps saying so until it's back; a stop says they stopped.
  function lostText() {
    if (G.dropped) wait('The connection dropped.', 'Reconnecting…', 'Usually a Wi-Fi hiccup. Keep this open.');
    else wait((theirName || 'They') + ' stopped sharing.', 'Waiting for ' + (theirName || 'them') + ' to start again…', 'Keep this open and it reconnects by itself.');
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
    const v = $('screenVideo');
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
    // The big picture gets the screen lane and the sound; their camera goes in its own bubble.
    let view = stream;
    const screen = pc && lane(pc, 0);
    if (screen) {
      if (!G.view || G.viewFor !== pc) { G.view = new MediaStream(); G.viewFor = pc; }
      [screen].concat(stream.getAudioTracks()).forEach((t) => { if (!G.view.getTrackById(t.id)) G.view.addTrack(t); });
      view = G.view;
    }
    // PeerJS fires 'stream' once per track; re-assigning would restart playback.
    if (v && v.srcObject !== view) {
      v.srcObject = view;
      v.muted = false;
      playWithSound(v);
    }
    guestFace();
    tell(G.conn, { cam: !!G.cam });
    clearInterval(G.lagTimer);
    G.lagTimer = setInterval(async () => { const r = await rtt(pc); app.lag = r; setLag('lagGuest', r); }, 2000);
    app.watching = true;
    G.lost = G.dropped = false;
    G.tries = G.quiet = 0;
    stayAwake(true);
    wakeControls();
  }
  function playWithSound(v) {
    v.play().then(() => { app.autoplayErr = ''; if (!v.muted) tapHide(); }).catch((e) => {
      app.autoplayErr = e && e.name;
      if (!e || e.name !== 'NotAllowedError') return;
      // Sound blocked until the next tap: play silently and offer "Tap to hear".
      v.muted = true;
      v.play().catch(() => {});
      const t = $('tapToHear');
      if (t) t.hidden = false;
      wakeControls();
    });
  }
  function tapHide() { const t = $('tapToHear'); if (t) t.hidden = true; }
  function guestLost() {
    if (G.left) return;
    clearInterval(G.lagTimer);
    app.watching = false;
    const v = $('screenVideo');
    if (v) v.srcObject = null;
    G.view = G.viewFor = null;
    G.camOn = false;
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
    setPressed('gMuteBtn', G.muted, 'Unmute', 'Mute');
  }
  function guestFace() {
    const pc = G.call && G.call.peerConnection;
    const on = G.camOn && app.state === 'watching';
    showFace($('camBubble'), on && pc ? lane(pc, 1) : null, on);
  }
  async function guestCam() {
    if (G.camBusy || G.left) return;
    if (!G.blank) { note('This browser can’t send your camera. Use Safari or Chrome.', 'info'); return; }
    if (G.cam) { const s = G.cam; G.cam = null; guestSlot(G.blank); s.getTracks().forEach((t) => t.stop()); return; }
    G.camBusy = true;
    try {
      let s;
      try { s = await navigator.mediaDevices.getUserMedia({ video: CAM }); } catch (e) { note(camError(e), 'stay'); return; }
      if (G.left || G.cam) { s.getTracks().forEach((t) => t.stop()); return; }
      G.cam = s;
      const t = s.getVideoTracks()[0];
      t.addEventListener('ended', () => { if (G.cam === s) { G.cam = null; guestSlot(G.blank); } });
      guestSlot(t);
      await keepMic();
      // iPhone can pause other videos while the camera starts.
      const v = $('screenVideo');
      if (app.state === 'watching' && v && v.srcObject && v.paused) playWithSound(v);
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
    showFace($('gSelf'), track, !!G.cam);
    setPressed('gCamBtn', !!G.cam, 'Turn my camera off', 'Turn my camera on');
    tell(G.conn, { cam: !!G.cam });
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
    app.watching = false;
    guestFace();
    showFace($('gSelf'), null, false);
    setPressed('gCamBtn', false, 'Turn my camera off', 'Turn my camera on');
    const v = $('screenVideo');
    if (v) v.srcObject = null;
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
    idleTimer = setTimeout(() => {
      const t = $('tapToHear');
      if (app.state === 'watching' && !(t && !t.hidden)) document.body.classList.add('idle');
    }, 3000);
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
    if (panel) panel.hidden = false;
    text('checkSummary', 'Checking…');
    const closeBtn = $('checkClose');
    if (closeBtn) closeBtn.focus();

    const basics = checkRow('basics', isGuest ? 'Watching works here' : 'Screen sharing works here');
    const micRow = checkRow('mic', 'Microphone');
    const server = checkRow('server', 'Can reach the call server');
    const net = checkRow('net', 'Network allows direct calls');
    const link = checkRow('link', isGuest ? 'Connection to ' + (theirName || 'them') : 'Connection to your friend');
    [basics, micRow, server, net, link].forEach((r) => r.set('wait'));

    if (!window.isSecureContext) basics.set('bad', 'This page must be opened with https:// at the start. Use the link exactly as it was sent.');
    else if (!window.RTCPeerConnection) basics.set('bad', 'This browser is too old for calls. Update it, or use Chrome or Safari.');
    else if (!isGuest && !CAN_SHARE) basics.set('bad', NO_SHARE);
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
    on('copyBtn', 'click', copyLink);
    on('shareBtn', 'click', shareLink);
    on('muteBtn', 'click', hostMute);
    on('camBtn', 'click', hostCam);
    on('selfFace', 'click', () => floatFace($('selfFace').querySelector('video')));
    on('gCamBtn', 'click', guestCam);
    on('camBubble', 'click', () => { const b = $('bubbles'); if (b) b.classList.toggle('left'); });
    on('changeBtn', 'click', hostChange);
    on('stopBtn', 'click', () => hostStop());
    document.querySelectorAll('#modeToggle [data-mode]').forEach((b) => b.addEventListener('click', () => hostMode(b.dataset.mode)));
    on('hostName', 'change', (e) => setHostName(e.target.value));
    on('newLinkBtn', 'click', newLink);
    on('joinBtn', 'click', () => guestJoin(true));
    on('joinNoMicBtn', 'click', () => guestJoin(false));
    on('gMuteBtn', 'click', guestMute);
    on('fsBtn', 'click', fullscreen);
    on('leaveBtn', 'click', guestLeave);
    on('waitLeaveBtn', 'click', guestLeave);
    on('tapToHear', 'click', () => { const v = $('screenVideo'); if (v) { v.muted = false; v.play().catch(() => {}); } tapHide(); wakeControls(); });
    on('checkBtn', 'click', runChecks);
    document.querySelectorAll('[data-check-open]').forEach((b) => b.addEventListener('click', runChecks));
    const sheet = document.querySelector('[data-state="check"]');
    const closeSheet = () => { if (sheet) sheet.hidden = true; };
    on('checkClose', 'click', closeSheet);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet && !sheet.hidden) closeSheet(); });
    if (sheet) sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
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
    ['pointermove', 'pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, (e) => { if (app.state === 'watching') wakeControls(e); }, { passive: true, capture: true }));
    document.addEventListener('click', (e) => {
      if (wokeAt && Date.now() - wokeAt < 700 && app.state === 'watching') { e.stopPropagation(); e.preventDefault(); }
      wokeAt = 0;
    }, true);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (app.state === 'live' || app.state === 'watching' || (app.state === 'waiting' && Date.now() - G.waitSince < 20 * 60000)) stayAwake(true);
      // iPhone pauses video while locked or in another app; start it again on return.
      const v = $('screenVideo');
      if (app.state === 'watching' && v && v.srcObject && v.paused) playWithSound(v);
    });
    const sv = $('screenVideo');
    if (sv) sv.addEventListener('webkitendfullscreen', () => { if (app.state === 'watching') sv.play().catch(() => {}); });
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
    if (isGuest) {
      const n = theirName;
      if (n) {
        text('hostInitial', n.charAt(0).toUpperCase());
        text('joinTitle', n + ' wants to show you something.');
        text('joinText', 'You’ll see what ' + n + ' shares and you can talk. It’s just the two of you, and nothing is recorded.');
        text('joinBtn', 'Sit beside ' + n);
        text('watchTitle', n + '’s screen');
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
      if (!CAN_SHARE) note(NO_SHARE, 'stay');
    }
    if (!window.Peer) peerLibOk();
    if (LOCAL) app.debug = { H, G }; // automated tests only
    app.booted = true;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
