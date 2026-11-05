/* Beside: a call from a link: talk, see each other, share one tab or window, chat and send files.
   Audio and video go peer to peer (WebRTC, encrypted). A call server only introduces the browsers and
   never sees the picture or sound: Beside's own (beside-server/, at sitbeside.pages.dev/peerjs/), with
   PeerJS's free one (0.peerjs.com) as the spare. Networks that block direct calls go through
   Cloudflare's relay (TURN), still encrypted end to end. */
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
  // ?spare=host:port is a second local server standing in for 0.peerjs.com (tests of the spare).
  const spare = LOCAL ? qs.get('spare') : null;
  const at = (hp, path) => ({ host: hp.split(':')[0], port: +hp.split(':')[1], path, secure: false });
  // On Beside's own site the own call server comes first; elsewhere (and in tests) only the free one.
  const OWN = srv ? (spare ? at(srv, '/') : null) : (/(^|\.)sitbeside\.pages\.dev$/.test(location.hostname) ? { host: location.hostname, port: 443, path: '/peerjs/', secure: true } : null);
  const FREE = srv ? at(spare || srv, '/') : {};
  // NET.own: the own server answered its health check. NET.ice: STUN, plus relay passwords when we got them.
  const NET = { own: false, ice: srv ? [] : ICE, at: 0, p: null };
  const opts = (free) => ({ ...(OWN && NET.own && !free ? OWN : FREE), config: { iceServers: NET.ice }, debug: 0 });
  async function getJSON(u, ms) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try { const r = await fetch(u, { cache: 'no-store', signal: c.signal }); return r.ok ? await r.json() : null; } catch (e) { return null; } finally { clearTimeout(t); }
  }
  // Checked when the page opens, and again before a call if it's been a while (the passwords last 12 hours).
  // Returns true when ready; otherwise NET.p resolves once it is.
  function netReady() {
    if (!OWN || NET.p) return !OWN;
    if (NET.at && Date.now() - NET.at < (NET.own ? 6 * 3600e3 : 60e3)) return true;
    const base = srv ? 'http://' + srv : '';
    NET.p = Promise.all([getJSON(base + '/peerjs/health', 3000), srv ? null : getJSON('/peerjs/turn', 4000)]).then(([h, t]) => {
      NET.own = !!(h && h.ok);
      const relay = t && Array.isArray(t.iceServers) ? t.iceServers.filter((x) => x && x.username && x.credential) : [];
      if (!srv) NET.ice = ICE.concat(relay);
      app.net = { own: NET.own, relay: relay.length > 0 };
      NET.at = Date.now();
      NET.p = null;
    });
    return false;
  }
  function whenNet(fn) { if (netReady()) fn(); else NET.p.then(fn); }
  const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
  const NET_ERR = /^(network|server-error|socket-error|socket-closed)$/;
  const IS_CHROMIUM = !!navigator.userAgentData;
  // iPhone and iPad (an iPad says it's a Mac): Apple's "Screen Sharing" sheet opens but never hands the picture
  // to a web page, which left the page stuck. They watch and talk instead.
  const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const CAN_SHARE = !IS_IOS && !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
  // Every device can share a photo, a video or (in the Beside app) a web page: each is drawn on a canvas whose
  // picture rides the same screen lane a shared tab uses. Only the canvas is sent, never the screen.
  const CAN_LANE = (() => { try { return typeof HTMLCanvasElement !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream; } catch (e) { return false; } })();
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
  // Your own other devices (iPad, iPhone) host the same room: open  .../?room=k7m2abcd  once there, or add that to the
  // Home Screen. Your partner keeps the usual link.
  try {
    const q = new URLSearchParams(location.search);
    const rq = (q.get('room') || '').toLowerCase();
    if (!isGuest && /^[a-z0-9]{8}$/.test(rq)) {
      store.set('beside.room', rq);
      store.set('beside.room.linked', '1');
      const nq = cleanName(q.get('name'));
      if (nq && !store.get('beside.name.host')) store.set('beside.name.host', nq);
    }
  } catch (e) { /* an odd address just opens Beside as usual */ }
  let theirName = '';
  try { theirName = cleanName(decodeURIComponent((hashM && hashM[2]) || '')); } catch (e) { theirName = ''; }

  // ---------- UI helpers ----------
  const app = { state: '', log: [], states: [], guestPeers: 0, hostPeers: 0, mv: [] };
  window.__beside = app; // for the automated tests
  netReady(); // ask the own call server early, so it's known by the time someone presses a button
  // Not in a call (start, join, ended): the tabs. In a call (waiting, live, watching): the call, full screen.
  const SHELL = ['idle', 'join', 'ended'];
  function show(state) {
    const prev = app.state;
    const into = SHELL.includes(prev) && !SHELL.includes(state);
    const back = !!prev && !SHELL.includes(prev) && SHELL.includes(state);
    const snap = into ? tvSnap() : null; // before the tabs go
    if (into) { ['inviteSheet', 'soundSheet'].forEach((id) => { const sh = $(id); if (sh) sh.hidden = true; }); boardSheet(false); }
    if (app.state !== state) { app.states.push(state); if (app.states.length > 300) app.states.shift(); }
    app.state = state;
    document.body.dataset.app = state;
    document.querySelectorAll('[data-state]').forEach((el) => {
      if (el.dataset.state === 'check') return; // the check panel is an overlay
      if (el.hasAttribute('data-shell')) { el.hidden = !SHELL.includes(state); return; } // the Calls tab, for host or guest
      el.hidden = !el.dataset.state.split(' ').includes(state);
    });
    boardPlace(state);
    if (into) tvOpen(snap);
    else if (back) tvClose();
    if (state === 'live' || state === 'watching') { layout(); wakeControls(); }
    else { closeMore(); shareOpen(false); soundOpen(false); document.body.classList.remove('idle'); if (SHELL.includes(state)) roomOff(); }
    if (!isGuest) hostTitle();
  }
  function text(id, s) { const el = $(id); if (el) el.textContent = s; }
  // ---------- OUR BOARD ----------
  // The countdown, Thinking of you, to-dos and calendar (board.js) belong to the room: the host's room code, which
  // the guest's link carries. Shown under the start and join screens, and from More during a call.
  let boardOn = false;
  function boardRoom() { return isGuest ? guestCode : hostCode(); }
  function boardName() { return (isGuest ? cleanName(store.get('beside.name') || ($('nameInput') && $('nameInput').value) || '') : myName()) || (isGuest ? 'Guest' : 'Host'); }
  // The board draws each part where the tabs want it: Home (hello, skies, latest heart, countdown, next plan),
  // Plans (Say it, calendar, to-dos), Hearts (send one, history).
  function boardMountNow() {
    window.BesideBoard.mount($('boardMount'), {
      room: boardRoom(), name: boardName(), them: isGuest ? theirName : '', role: isGuest ? 'guest' : 'host', go: (t) => setTab(t), onRender: boardRendered,
      targets: { hello: $('bHello'), skies: $('bSkies'), homeThink: $('bHomeThink'), countdown: $('bHomeCount'), next: $('bHomeNext'), plans: $('boardMount'), hearts: $('bHearts'), note: $('bNote'), shared: $('bShared') },
    });
  }
  function boardPlace(state) {
    const z = $('boardZone'), m = $('boardMount');
    if (!z || !m || !window.BesideBoard) return;
    const home = SHELL.includes(state);
    z.hidden = !home;
    document.body.classList.toggle('has-board', home);
    if (home) {
      boardSheetBack();
      try { boardMountNow(); boardOn = true; } catch (e) { boardOn = false; }
      houseDraw(); // the clocks and times, even with no board
    }
    if (!home && state !== 'live' && state !== 'watching') boardSheet(false);
  }
  // In a call, More opens the countdown, to-dos and calendar: those parts move into the sheet, then back. On Home,
  // the house's calendar, fridge and paper chain each open just their part the same way.
  const SHEET_PARTS = { all: ['bHomeCount', 'boardMount'], count: ['bHomeCount'], cal: ['[data-sec=cal]'], todo: ['[data-sec=todo]'] };
  const SHEET_TITLE = { all: 'Together', count: 'Countdown', cal: 'Calendar', todo: 'To-do' };
  const partEl = (k) => (k.charAt(0) === '[' ? document.querySelector('#boardMount ' + k + ', #boardSheetBody ' + k) : $(k));
  const sheetMarks = new Map();
  function boardSheetBack() {
    sheetMarks.forEach((mark, k) => { const el = partEl(k); if (el && mark.parentNode && el.nextSibling !== mark) mark.parentNode.insertBefore(el, mark); });
  }
  function boardSheet(on, part) {
    const sh = $('boardSheet'), body = $('boardSheetBody'), m = $('boardMount');
    if (!sh || !body || !m || !window.BesideBoard) return;
    if (on) {
      closeMore();
      boardSheetBack();
      const which = SHEET_PARTS[part] ? part : 'all';
      text('boardTitle', SHEET_TITLE[which]);
      body.classList.toggle('bboard', which !== 'all'); // one part alone keeps the board's own look
      body.classList.toggle('bb-tabs', which !== 'all');
      SHEET_PARTS[which].forEach((k) => {
        const el = partEl(k);
        if (!el) return;
        if (!sheetMarks.has(k)) { const mark = document.createComment(k); el.parentNode.insertBefore(mark, el.nextSibling); sheetMarks.set(k, mark); }
        body.appendChild(el);
      });
      try { boardMountNow(); window.BesideBoard.refresh(); } catch (e) {}
      sh.hidden = false;
    } else {
      sh.hidden = true;
      boardSheetBack();
    }
  }
  // Who is who: Mo's figure lives in London, Semal's in LA. The Ring button says their name once it's known.
  function boardRendered(pp) {
    app.people = pp;
    const n = isGuest ? theirName : pp.them;
    text('homeRingText', n ? 'Ring ' + n : 'Ring them');
    houseDraw();
  }

  // ---------- HOME: the house (Next Door) ----------
  // Two rooms, a thin wall between: each with its own clock, a window with that city's weather and day or night, and a
  // light that is off late at night there. The calendar, the fridge and the paper chain open their part of the board.
  // Tap your own figure and it waves (only on this screen: the board has no wave message to send).
  const ROOM_ID = { mo: 'ndRoomMo', semal: 'ndRoomSemal' };
  const HAND = { mo: ['#1B1D23', '#E2AE88'], semal: ['#1C1D22', '#E7B48F'] };
  let houseOn = false;
  function houseBoot() {
    if (houseOn || !$('house') || !window.BesideFigures) return;
    houseOn = true;
    ['mo', 'semal'].forEach((who) => {
      const b = $(who === 'mo' ? 'ndFigMo' : 'ndFigSemal');
      b.innerHTML = window.BesideFigures.figure(who, { label: '' }) + '<svg class="nd-hand" viewBox="0 0 30 30" aria-hidden="true"><rect x="3" y="12" width="9" height="17" rx="4.5" fill="' + HAND[who][0] + '"/><circle cx="7.5" cy="9" r="6" fill="' + HAND[who][1] + '"/></svg>';
      b.addEventListener('click', () => { b.classList.remove('wave'); void b.offsetWidth; b.classList.add('wave'); });
      b.addEventListener('animationend', (e) => { if (e.target === b) b.classList.remove('wave'); });
    });
    on('ndCal', 'click', () => boardSheet(true, 'cal'));
    on('ndFridge', 'click', () => boardSheet(true, 'todo'));
    on('ndChain', 'click', () => boardSheet(true, 'count'));
  }
  function houseDraw() {
    houseBoot();
    const hs = houseOn && window.BesideBoard && window.BesideBoard.house ? window.BesideBoard.house() : null;
    if (!hs) return;
    let late = '';
    hs.rooms.forEach((r) => {
      const room = $(ROOM_ID[r.who]);
      if (!room) return;
      room.dataset.light = r.late ? 'off' : 'on';
      const win = room.querySelector('.nd-win');
      win.dataset.sky = r.night ? 'night' : /^(cloud|fog|drizzle|rain|snow|thunder)$/.test(r.kind) ? 'grey' : 'day';
      win.dataset.wx = r.kind;
      const hr = room.querySelector('.h-hr'), mn = room.querySelector('.h-mn');
      hr.style.transform = 'rotate(' + ((r.h % 12) * 30 + r.mi / 2) + 'deg)';
      mn.style.transform = 'rotate(' + r.mi * 6 + 'deg)';
      const nm = r.name || (r.who === 'mo' ? 'Mo' : 'Semal');
      const id = r.who === 'mo' ? 'Mo' : 'Semal';
      text('ndTime' + id, nm + ', ' + r.time.toLowerCase());
      text('ndWx' + id, r.words || r.place);
      const fig = $('ndFig' + id);
      fig.disabled = !r.mine;
      fig.setAttribute('aria-label', r.mine ? 'Wave' : nm + ' in ' + r.place);
      if (!r.mine && r.late) late = 'It is late at night for ' + nm + '. A heart will wait for them.';
    });
    const lt = $('ndLate');
    if (lt) { lt.textContent = late; lt.hidden = !late; }
    const c = hs.countdown;
    const tag = !c ? 'Countdown' : c.today ? 'Today' : c.past ? c.title : c.days === 1 ? '1 day' : c.days + ' days';
    text('ndTag', tag);
    const ch = $('ndChain');
    if (ch) {
      ch.style.setProperty('--chain', c && !c.past && !c.today ? Math.max(26, Math.min(96, 26 + c.days * 1.2)) + '%' : '60%');
      ch.setAttribute('aria-label', !c ? 'Countdown: set one' : c.past ? 'Countdown: ' + c.title + ' has been' : 'Countdown: ' + tag + ' to ' + c.title);
    }
    const m = hs.month;
    text('ndCalMonth', m.name);
    text('ndCalNext', hs.next ? hs.next.day + ', ' + hs.next.title : '');
    const grid = $('ndCalGrid');
    const gk = [m.name, m.first, m.count, m.today, m.plans.join(',')].join('|');
    if (grid && grid.dataset.k !== gk) {
      grid.dataset.k = gk;
      const cell = (t, cls) => { const i = document.createElement('i'); i.textContent = t; if (cls) i.className = cls; return i; };
      const cells = 'MTWTFSS'.split('').map((d) => cell(d, 'wd'));
      for (let i = 0; i < m.first; i++) cells.push(cell('', ''));
      for (let d = 1; d <= m.count; d++) cells.push(cell(d, [d === m.today ? 't' : d < m.today ? 'o' : '', m.plans.includes(d) ? 'p' : ''].filter(Boolean).join(' ')));
      grid.replaceChildren(...cells);
    }
    if ($('ndCal')) $('ndCal').setAttribute('aria-label', 'Calendar, ' + m.name + (hs.next ? '. Next: ' + hs.next.title + ', ' + hs.next.day : ''));
    const notes = $('ndNotes');
    if (notes) {
      const top = hs.todos.slice(0, 3);
      const key = top.join('|') || '-';
      if (notes.dataset.k !== key) {
        notes.dataset.k = key;
        if (!top.length) {
          const n = document.createElement('span'); n.className = 'nd-none'; n.textContent = 'Nothing yet. Tap to add.';
          notes.replaceChildren(n);
        } else {
          notes.replaceChildren(...top.map((t) => {
            const row = document.createElement('span'); row.className = 'nd-todo';
            const sp = document.createElement('span'); sp.textContent = t;
            row.append(document.createElement('i'), sp);
            return row;
          }));
        }
      }
      $('ndFridge').setAttribute('aria-label', 'To-do list: ' + (hs.todos.length ? hs.todos.length + ' to do' : 'nothing yet'));
    }
  }

  // ---------- TABS ----------
  const TABS = ['home', 'plans', 'calls', 'hearts'];
  const tabEl = (t) => $('tab' + t.charAt(0).toUpperCase() + t.slice(1));
  const tabScroll = {};
  app.tab = 'home';
  function setTab(name, instant) {
    if (!TABS.includes(name)) return;
    const prev = app.tab;
    if (prev !== name) tabScroll[prev] = window.scrollY;
    app.tab = name;
    TABS.forEach((t) => {
      const p = tabEl(t), b = $('tb-' + t);
      if (p) p.hidden = t !== name;
      if (b) { b.setAttribute('aria-selected', String(t === name)); b.tabIndex = t === name ? 0 : -1; }
    });
    const bar = document.querySelector('.tabbar-in');
    if (bar) bar.style.setProperty('--i', TABS.indexOf(name));
    const p = tabEl(name);
    if (p && prev !== name && !instant) {
      p.style.setProperty('--dir', TABS.indexOf(name) > TABS.indexOf(prev) ? '1' : '-1');
      p.classList.remove('tab-in');
      void p.offsetWidth;
      p.classList.add('tab-in');
      // Once it has slid in, drop the class, so a later copy of this tab (the TV opening) never replays it.
      p.addEventListener('animationend', function done(e) { if (e.target !== p) return; p.classList.remove('tab-in'); p.removeEventListener('animationend', done); });
    }
    if (prev !== name) window.scrollTo(0, tabScroll[name] || 0);
  }
  function tabsBoot() {
    document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.go)));
    const bar = document.querySelector('.tabbar-in');
    if (bar) bar.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      const t = TABS[(TABS.indexOf(app.tab) + d + TABS.length) % TABS.length];
      setTab(t);
      const b = $('tb-' + t);
      if (b) b.focus();
    });
    setTab('home', true);
  }

  // ---------- MOTION: the TV opens into the call, and the call shrinks back into it ----------
  const still = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const rectOf = (r) => ({ left: r.left, top: r.top, width: r.width, height: r.height });
  // A copy of what's on screen, with nothing in it a person (or a test) could find or press.
  let copies = 0;
  function quietCopy(el) {
    const c = el.cloneNode(true);
    // Pictures keep their knit and check patterns, under new names so they never clash with the originals.
    const tag = '-q' + (++copies);
    c.querySelectorAll('pattern[id]').forEach((x) => { x.id += tag; });
    c.querySelectorAll('[fill^="url(#"]').forEach((x) => { x.setAttribute('fill', x.getAttribute('fill').replace(/\)$/, tag + ')')); });
    [c, ...c.querySelectorAll('*')].forEach((x) => {
      if (x.tagName === 'pattern') return;
      ['id', 'data-state', 'data-shell', 'data-check-open', 'data-go', 'for', 'name'].forEach((a) => x.removeAttribute(a));
      if (x.classList) x.classList.remove('ring-me', 'tab-in');
      // A copy of a busy button would show greyed out; the picture should look like the page did.
      if ('disabled' in x) x.disabled = false;
    });
    c.setAttribute('aria-hidden', 'true');
    c.inert = true;
    return c;
  }
  function tvSnap() {
    if (still()) return null;
    const box = $('tvBox');
    const scr = box && box.querySelector('.tv-screen');
    const panel = tabEl(app.tab);
    if (app.tab === 'calls' && scr && box.getClientRects().length) {
      const pr = panel.getBoundingClientRect();
      const bar = document.querySelector('.tabbar');
      return { panel: quietCopy(panel), panelRect: rectOf(pr), bar: bar ? quietCopy(bar) : null, screen: rectOf(scr.getBoundingClientRect()), tv: true };
    }
    // Safari does not focus a tapped button, so the button's place is noted when the finger goes down.
    const a = document.activeElement;
    const r = lastTap && Date.now() - lastTap.at < 4000 ? lastTap.r : a && a !== document.body && a.getBoundingClientRect ? a.getBoundingClientRect() : null;
    return { screen: r && r.width ? rectOf(r) : { left: innerWidth / 2 - 60, top: innerHeight / 2 - 40, width: 120, height: 80 } };
  }
  let lastTap = null;
  document.addEventListener('pointerdown', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('button') : null;
    lastTap = b ? { r: b.getBoundingClientRect(), at: Date.now() } : null;
  }, true);
  const clip = (r) => 'inset(' + Math.max(0, r.top).toFixed(1) + 'px ' + Math.max(0, innerWidth - r.left - r.width).toFixed(1) + 'px ' + Math.max(0, innerHeight - r.top - r.height).toFixed(1) + 'px ' + Math.max(0, r.left).toFixed(1) + 'px round ' + (r.round || 6) + 'px)';
  const FULL = () => ({ left: 0, top: 0, width: innerWidth, height: innerHeight, round: 0.01 });
  let tvFx = null;
  function tvDone() { if (tvFx) { tvFx.remove(); tvFx = null; } }
  function tvOpen(snap) {
    tvDone();
    if (!snap || !document.body.animate) return;
    const fx = document.createElement('div');
    fx.className = 'tvfx';
    fx.setAttribute('aria-hidden', 'true');
    tvFx = fx;
    let lead = 0;
    if (snap.tv) {
      const pane = document.createElement('div');
      pane.className = 'tvfx-pane';
      const pr = snap.panelRect;
      Object.assign(snap.panel.style, { position: 'absolute', left: pr.left + 'px', top: pr.top + 'px', width: pr.width + 'px', margin: '0' });
      snap.panel.hidden = false;
      pane.append(snap.panel);
      if (snap.bar) pane.append(snap.bar);
      fx.append(pane);
      lead = 820; // he lifts the remote, the TV clicks on, she leans in
      requestAnimationFrame(() => { const room = snap.panel.querySelector('.tv-room'); if (room) room.classList.add('tv-go'); });
      pane.animate([{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: lead + 500, easing: 'ease-in-out', fill: 'forwards' });
    }
    const scr = document.createElement('div');
    scr.className = 'tvfx-screen';
    fx.append(scr);
    document.body.append(fx);
    const from = { ...snap.screen, round: snap.tv ? 3 : 32 };
    scr.animate([
      { clipPath: clip(from), opacity: snap.tv ? 0 : 1, backgroundColor: '#E8A87C' },
      { clipPath: clip(from), opacity: 1, backgroundColor: '#E8A87C', offset: lead ? lead / (lead + 700) : 0.001 },
      { clipPath: clip(FULL()), opacity: 1, backgroundColor: '#1C1712' },
    ], { duration: lead + 700, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' });
    const end = fx.animate([{ opacity: 1 }, { opacity: 1, offset: (lead + 700) / (lead + 1050) }, { opacity: 0 }], { duration: lead + 1050, fill: 'forwards' });
    end.onfinish = () => { if (tvFx === fx) tvDone(); };
  }
  function tvClose() {
    tvDone();
    if (still() || !document.body.animate) return;
    const fx = document.createElement('div');
    fx.className = 'tvfx';
    fx.setAttribute('aria-hidden', 'true');
    tvFx = fx;
    const scr = document.createElement('div');
    scr.className = 'tvfx-screen';
    fx.append(scr);
    document.body.append(fx);
    const tv = app.tab === 'calls' && $('tvBox') && $('tvBox').querySelector('.tv-screen');
    const r = tv && tv.getClientRects().length ? { ...rectOf(tv.getBoundingClientRect()), round: 3 } : { left: innerWidth / 2 - 50, top: innerHeight / 2 - 32, width: 100, height: 64, round: 18 };
    scr.animate([
      { clipPath: clip(FULL()), backgroundColor: '#1C1712', opacity: 1 },
      { clipPath: clip(r), backgroundColor: tv ? '#2A2D35' : '#1C1712', opacity: 1, offset: 0.8 },
      { clipPath: clip(r), backgroundColor: '#2A2D35', opacity: 0 },
    ], { duration: 760, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' }).onfinish = () => { if (tvFx === fx) tvDone(); };
  }

  // While it rings, their figure peeks in from the edge and hops.
  let ringFigT = 0;
  function ringHop() {
    const el = $('ringFig');
    if (!el || !window.BesideFigures) return;
    const me = window.BesideBoard ? window.BesideBoard.people().me : 'mo';
    el.innerHTML = window.BesideFigures.figure(me === 'mo' ? 'semal' : 'mo', { label: '' });
    el.hidden = false;
    el.classList.remove('go');
    void el.offsetWidth;
    el.classList.add('go');
    clearTimeout(ringFigT);
    ringFigT = setTimeout(() => { el.classList.remove('go'); el.hidden = true; }, 8000);
  }
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
  // The lanes of a call, in the order its offer lists them. Video: 0 the shared screen, 1 the host's camera,
  // 2 and 3 two other guests' cameras (relayed by the host). Sound: 0 voices, 1 the shared video's sound.
  // (A guest's camera comes back on video lane 0 and its screen on 1; its mic on sound lane 0, its tab on 1.)
  function lane(pc, i, want) {
    try {
      const offer = [pc.localDescription, pc.remoteDescription].find((d) => d && d.type === 'offer');
      if (!offer) return null;
      const mids = [];
      let kind = '';
      offer.sdp.split(/\r?\n/).forEach((l) => {
        if (l.startsWith('m=')) kind = l.slice(2).split(' ')[0];
        else if (kind === (want || 'video') && l.startsWith('a=mid:')) mids.push(l.slice(6).trim());
      });
      if (mids[i] == null) return null;
      const t = pc.getTransceivers().find((x) => x.mid === mids[i]);
      return (t && t.receiver && t.receiver.track) || null;
    } catch (e) { return null; }
  }
  // The computer's own mic and camera come first: a Mac can offer a nearby iPhone's (Continuity), and macOS
  // sometimes makes that the default. Names are only known once the site is allowed, so the first time we look
  // at what we got and switch if it's a phone. Phones themselves keep their own.
  const PHONE_DEV = /iphone|ipad|continuity/i;
  async function ownDevice(kind) {
    if (IS_IOS || !navigator.mediaDevices.enumerateDevices) return '';
    try {
      const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === kind && d.label && d.deviceId && !/^(default|communications)$/.test(d.deviceId));
      const own = list.filter((d) => !PHONE_DEV.test(d.label));
      const best = own.find((d) => /built-in|macbook|imac|mac mini|mac studio|facetime|internal/i.test(d.label)) || own[0];
      return best ? best.deviceId : '';
    } catch (e) { return ''; }
  }
  async function getOwn(kind, want) {
    const md = navigator.mediaDevices;
    const id = await ownDevice(kind === 'audio' ? 'audioinput' : 'videoinput');
    let s;
    if (id) { try { s = await md.getUserMedia({ [kind]: { ...want, deviceId: { exact: id } } }); } catch (e) { s = null; } }
    if (!s) s = await md.getUserMedia({ [kind]: want });
    const t = s.getTracks()[0];
    if (!id && t && PHONE_DEV.test(t.label || '')) {
      const id2 = await ownDevice(kind === 'audio' ? 'audioinput' : 'videoinput');
      if (id2) {
        try { const s2 = await md.getUserMedia({ [kind]: { ...want, deviceId: { exact: id2 } } }); s.getTracks().forEach((x) => x.stop()); s = s2; } catch (e) { /* keep the phone's */ }
      }
    }
    return s;
  }
  // Ask for a small camera picture; if this camera can't do that (or answers oddly), take any picture it gives:
  // the 300 kbit/s cap on the lane keeps it small either way.
  async function getCam() {
    try {
      return await getOwn('video', CAM);
    } catch (e) {
      if (!e || !/^(OverconstrainedError|NotFoundError|NotReadableError|AbortError|TypeError)$/.test(e.name)) throw e;
      const s = await getOwn('video', {});
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
  // so the lanes of a call are always [voices, video sound, screen, camera, face, face] (offer) and
  // [mic, tab sound, camera, screen] (answer).
  function ordered(list) {
    const l = list.filter(Boolean);
    const s = new MediaStream(l);
    try { s.getTracks = () => l.slice(); } catch (e) { /* the default order is the next best thing */ }
    return s;
  }
  const VER = 3;
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

  // ---------- SOUND ----------
  // Voices and the shared video's sound travel in two lanes, so neither squashes the other and each has its own
  // volume. The voice lane repairs lost packets and may carry stereo up to 128 kbit/s; the sender holds a voice to
  // 64 kbit/s and lets Music use the full 128 (tuneVoice). The video lane is stereo at 128 kbit/s. Each side's
  // own description says how it wants to be sent to.
  const MIC = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

  // ---------- CLEAR VOICE ----------
  // For quiet talkers (Mo, 2 Nov 2026: "we both have the habit of speaking quietly"). Your mic goes through a small
  // leveller before it's sent: a rumble filter, a gentle lift where words live, and a soft compressor that brings
  // quiet words up while normal talking barely changes and loud talking not at all, then a limiter so a laugh never
  // crackles. In real pauses (400 ms of nothing above the room's own hum) the level eases down to -20 dB, so the lift
  // doesn't raise the room's hiss (Mo, 2 Nov 2026: hiss and some crackle). Only your voice: the shared video's sound
  // never passes through it. The browser's own auto-volume stays on underneath (Safari can't turn it off).
  // Your mic, five ways (Mo, 2 Nov 2026: "full sound control"), kept on each device: Natural (the browser's own
  // clean-up only), Clear voice (the leveller, the default), Voice focus (for a noisy room: a narrower band, deeper
  // pauses and softer s sounds), Far away (Mo, 2 Nov 2026: "if the mic is far away or coved under pillow bedsheet
  // ... it will still hear that": a much stronger lift, with the muffled top end brought back) and Music (nothing
  // changed at all, in stereo, for playing or singing).
  const MODES = ['natural', 'clear', 'focus', 'far', 'music'];
  const MODE_TEXT = {
    natural: ['Natural', 'Your mic as the browser gives it, with nothing added.'],
    clear: ['Clear voice', 'Lifts a quiet voice and keeps the room quiet in pauses.'],
    focus: ['Voice focus', 'Removes typing, fans and other sounds around you, and keeps your voice.'],
    far: ['Far away', 'For a phone across the room or under the covers. Lifts a soft, muffled voice a lot.'],
    music: ['Music', 'Every sound as it is, in stereo, for playing or singing. Use headphones.'],
  };
  function savedMode() {
    const m = store.get('beside.micmode');
    if (MODES.includes(m)) return m;
    return store.get('beside.clear') === '0' ? 'natural' : 'clear';
  }
  // iPhone and iPad send the mic as it comes, in every mode (Mo, 2 Nov 2026: "the voice still crackles a tiny bit
  // when im talking on the phone but it doesnt when on the mac"). Their audio engine runs on its own clock, not
  // the mic's, and a voice passed through it clicks now and then; in Natural mode, which skips it, the crackle
  // went away. So there Clear voice, Voice focus and Far away use Apple's own voice processing (echo cancel,
  // noise suppression, auto volume, and voice isolation for Voice focus only: it can cut a distant voice), and
  // the listener lifts the voice (LIFT).
  const SEND_RAW = IS_IOS;
  // CLEAR.pre: the slot for a node that goes first in a chain whose tuning has pre (Voice focus), for its noise
  // remover: a function (ctx, mode) giving an AudioNode, or null. Set it, then clearRebuild(), to put it in.
  const CLEAR = { mode: savedMode(), on: false, chains: new Set(), q: Promise.resolve(), pre: null };
  CLEAR.on = ['clear', 'focus', 'far'].includes(CLEAR.mode); // the modes tuneFor gives a chain (its tunings come below)
  // Watching YouTube together (see WATCH YOUTUBE TOGETHER below).
  const W = { id: '', at: 0, play: false, stamp: 0, away: '', p: null, pid: '', ready: false, quiet: 0, api: null, timer: 0, tap: 0, vol: -1 };
  // What the browser is asked for. Music turns every clean-up off and asks for stereo; Voice focus asks for the
  // browser's voice isolation where it has one.
  function micWant(mode) {
    let sup = {};
    try { sup = navigator.mediaDevices.getSupportedConstraints() || {}; } catch (e) {}
    if (mode === 'music') {
      const c = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: { ideal: 2 } };
      if (sup.voiceIsolation) c.voiceIsolation = false;
      return c;
    }
    const c = { ...MIC };
    if (sup.voiceIsolation) c.voiceIsolation = mode === 'focus';
    return c;
  }
  // opts.live(): is the mic meant to be sending (not muted)? opts.change(): the chain stopped or started working
  // (ch.ok), so the caller can send the plain mic instead. Not working = the audio engine's clock stopped (a known
  // iPhone stall), or perfect silence from a live, unmuted mic for 4 s.
  // Clear voice's settings. The compressor's own make-up gain lifts quiet talkers; in real pauses an expander eases
  // the sound down to -20 dB over about 150 ms (so the room's hiss is not lifted too) and opens at once on speech;
  // a gentle limiter and a little headroom keep every peak under 0 dBFS. Soft attacks avoid crackle.
  const CLEAR_TUNE = {
    hp: 90, lp: 0, ess: false,
    comp: { threshold: -30, knee: 12, ratio: 2.5, attack: 0.01, release: 0.25 },
    lim: { threshold: -4.5, knee: 0, ratio: 20, attack: 0.003, release: 0.15 },
    out: 0.8, // about 2 dB of headroom after the limiter (its own make-up gain lifts it a little)
    pause: 0.1, // -20 dB in pauses
    fade: 0.05, // time constant: about 150 ms to settle
    hold: 400, // ms of quiet before it counts as a pause
  };
  // Voice focus: only 100 Hz to 7 kHz, pauses down to about -30 dB, and a gentle de-esser that softens a sharp s.
  const FOCUS_TUNE = { ...CLEAR_TUNE, hp: 100, lp: 7000, ess: true, pause: 0.0316, pre: true };
  // Far away: a phone across the room or under a pillow. Fabric takes the top off a voice, so 3 kHz comes up 6 dB
  // and everything above 4.5 kHz 5 dB; the compressor starts at -50 dBFS (ratio 4) with about 10 dB more make-up,
  // so a soft voice comes out near normal talking level; pauses go down to about -35 dB so the lifted hiss stays
  // down, and the limiter keeps a voice close to the phone from clipping.
  const FAR_TUNE = {
    ...CLEAR_TUNE, hp: 100, lift: { f: 3000, g: 6 }, shelf: { f: 4500, g: 5 },
    comp: { threshold: -50, knee: 10, ratio: 4, attack: 0.01, release: 0.25 },
    makeup: 3, pause: 0.0178,
  };
  const ESS_HZ = 4500; // the de-esser listens above this
  function tuneFor(mode) { return mode === 'focus' ? FOCUS_TUNE : mode === 'clear' ? CLEAR_TUNE : mode === 'far' ? FAR_TUNE : null; }
  function clearNodes(ctx, t, pre) {
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = t.hp || 90; hp.Q.value = 0.7;
    if (pre) pre.connect(hp);
    let last = hp;
    if (t.lp) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = t.lp; lp.Q.value = 0.7; last.connect(lp); last = lp; }
    const lt = t.lift || { f: 2500, g: 3.5 };
    const lift = ctx.createBiquadFilter(); lift.type = 'peaking'; lift.frequency.value = lt.f; lift.Q.value = 1; lift.gain.value = lt.g;
    last.connect(lift); last = lift;
    if (t.shelf) { const sh = ctx.createBiquadFilter(); sh.type = 'highshelf'; sh.frequency.value = t.shelf.f; sh.gain.value = t.shelf.g; last.connect(sh); last = sh; }
    let ess = null;
    if (t.ess) { ess = ctx.createBiquadFilter(); ess.type = 'peaking'; ess.frequency.value = 6500; ess.Q.value = 1.4; ess.gain.value = 0; last.connect(ess); last = ess; }
    const comp = ctx.createDynamicsCompressor();
    Object.entries(t.comp).forEach(([k, v]) => { comp[k].value = v; });
    const gate = ctx.createGain();
    const lim = ctx.createDynamicsCompressor();
    Object.entries(t.lim).forEach(([k, v]) => { lim[k].value = v; });
    const out = ctx.createGain();
    out.gain.value = t.out;
    last.connect(comp);
    if (t.makeup && t.makeup !== 1) { const mk = ctx.createGain(); mk.gain.value = t.makeup; comp.connect(mk); mk.connect(gate); } else comp.connect(gate);
    gate.connect(lim); lim.connect(out);
    return { in: pre || hp, pre: pre || null, hp, gate, out, ess };
  }
  // The pause rule, every 20 ms, from the raw mic's level: the room's own hum follows quiet moments down at once
  // and creeps up slowly (about 1 dB a second); anything 10 dB over it, or louder than -45 dBFS, is speech.
  // Returns [gain, time constant] to move the expander to, or null to leave it. A hidden tab's timers run slowly,
  // so there it stays open (awake).
  function clearGate(st, db, now, t, awake) {
    if (db > -200) st.floor = db < st.floor ? db : st.floor + 0.02;
    if (awake || db > st.floor + 10 || db > -45) { st.loudAt = now; return [1, 0.005]; }
    if (now - st.loudAt > t.hold) return [t.pause, t.fade];
    return null;
  }
  // The de-esser's rule: a sharp s puts most of the sound above 4.5 kHz; then 6.5 kHz comes down 6 dB, briefly.
  function clearEss(db, hi) { return hi > -45 && hi > db - 6 ? [-6, 0.003] : [0, 0.03]; }
  // opts.mode: a fixed mode, for lifting a voice you hear (LIFT); such a chain ignores your own mic mode.
  function clearChain(ctx, stream, opts) {
    opts = opts || {};
    const fixed = opts.mode || '';
    // tail: what the caller connects. It stays the same when the mode changes; only what feeds it is rebuilt.
    const tail = ctx.createGain();
    let n = null, t = null;
    // The analysers hang off the raw mic with nothing after them: browsers keep measuring them, and on iPhone
    // nothing touching the speakers' output lets the engine keep running when the phone locks.
    const an = ctx.createAnalyser(); an.fftSize = 1024;
    const hiF = ctx.createBiquadFilter(); hiF.type = 'highpass'; hiF.frequency.value = ESS_HZ; hiF.Q.value = 0.7;
    const hiA = ctx.createAnalyser(); hiA.fftSize = 1024;
    hiF.connect(hiA);
    const buf = new Float32Array(an.fftSize);
    const gst = { loudAt: 0, floor: -60 };
    let zero = 0, ct = -1, ctAt = Date.now(), dead = false, stalled = false;
    const report = () => { const ok = !dead && !stalled; if (ok !== ch.ok) { ch.ok = ok; if (opts.change) opts.change(); } };
    const power = (a) => { a.getFloatTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]; return s; };
    const timer = setInterval(() => {
      const now = Date.now();
      // The engine's clock must move while it says it's running; if it hasn't for 1.5 s, it's stalled.
      if (ctx.state === 'running') {
        if (ctx.currentTime !== ct) { ct = ctx.currentTime; ctAt = now; if (stalled) { stalled = false; report(); } }
        else if (now - ctAt > 1500 && !stalled) { stalled = true; report(); ctx.suspend().then(() => ctx.resume()).catch(() => {}); ctAt = now; }
      } else ctAt = now;
      if (!n || ctx.state !== 'running') return;
      const sum = power(an);
      const tr = ch.src.mediaStream && ch.src.mediaStream.getAudioTracks()[0];
      const live = (!opts.live || opts.live()) && tr && tr.readyState === 'live' && tr.enabled && !tr.muted;
      zero = sum === 0 && live ? zero + 20 : 0;
      if (zero >= 4000 && !dead) { dead = true; report(); }
      const db = sum > 0 ? 10 * Math.log10(sum / buf.length + 1e-12) : -300;
      const go = clearGate(gst, db, now, t, document.hidden);
      if (go) n.gate.gain.setTargetAtTime(go[0], ctx.currentTime, go[1]);
      if (n.ess) {
        const hs = power(hiA);
        const e = clearEss(db, hs > 0 ? 10 * Math.log10(hs / buf.length + 1e-12) : -300);
        n.ess.gain.setTargetAtTime(e[0], ctx.currentTime, e[1]);
      }
    }, 20);
    const wire = () => {
      try { ch.src.disconnect(); } catch (e) {}
      ch.src.connect(an); ch.src.connect(hiF);
      if (n) ch.src.connect(n.in); else ch.src.connect(tail);
    };
    const ch = {
      out: tail, on: null, mode: '', src: ctx.createMediaStreamSource(stream), ok: true,
      // Natural and Music: the plain mic, at full level. Clear voice, Voice focus and Far away: their own processing.
      use(mode, again) {
        const nt = fixed ? tuneFor(fixed) : SEND_RAW ? null : tuneFor(mode); // an iPhone's own mic: no processing
        ch.mode = fixed || mode;
        if (nt === t && ch.on !== null && !again) return;
        if (n) [n.out, n.pre].forEach((x) => { try { if (x) x.disconnect(); } catch (e) {} });
        isoEnd(n);
        t = nt;
        let pre = null;
        if (t && t.pre && CLEAR.pre) { try { pre = CLEAR.pre(ctx, ch.mode, !fixed) || null; } catch (e) { pre = null; } }
        n = t ? clearNodes(ctx, t, pre) : null;
        if (n) n.out.connect(tail);
        ch.on = !!n;
        wire();
        if (!fixed) app.clear = ch.on;
      },
      set(on) { ch.use(on ? 'clear' : 'natural'); },
      hasPre() { return !!(n && n.pre); }, // the noise remover is in (tests and the self-check)
      // Same chain, a new mic (an iPhone can end the mic when the camera starts; a new mode can need a new mic).
      swap(stream2) {
        try { ch.src.disconnect(); } catch (e) {}
        ch.src = ctx.createMediaStreamSource(stream2);
        zero = 0;
        wire();
      },
      close() { clearInterval(timer); CLEAR.chains.delete(ch); [ch.src, tail, n && n.out, n && n.pre].forEach((x) => { try { if (x) x.disconnect(); } catch (e) {} }); isoEnd(n); },
    };
    if (!fixed) CLEAR.chains.add(ch);
    ch.use(fixed || CLEAR.mode);
    return ch;
  }
  // Builds every chain again, yours and the ones lifting a voice you hear: after CLEAR.pre changes.
  // onlyPre: just the chains whose tuning takes the noise remover (Voice focus), so the others don't blip.
  function clearRebuild(onlyPre) {
    const want = (m) => !onlyPre || !!(tuneFor(m) && tuneFor(m).pre);
    CLEAR.chains.forEach((c) => { if (want(c.mode)) c.use(c.mode, true); });
    OUT.map.forEach((l) => { if (l.chain && want(l.lift)) l.chain.use(l.lift, true); });
  }
  // VOICE ISOLATION (Mo, 2 Nov 2026: "allows the typing sound to not be heard ... like a good voice isolation",
  // "our voices to be heard really clear and loud"). Voice focus puts RNNoise (voiceiso.js) first in its chain,
  // on the sending side, and on the listening side when an iPhone sends its voice as it comes (LIFT); Clear
  // voice's leveller after it keeps the voice loud. It needs a 48 kHz audio engine; elsewhere the chain runs
  // without it. If it falls behind (3 lost moments in 10 s, or its own buffer running short) it is switched
  // off on this device until the page is opened again, so the sound never breaks up.
  // own: your own mic's chain (only that one sets what the Sound panel says; a lift chain is the other voice).
  // A remover that fails to start (no download, no WebAssembly) is tried once more after 5 s.
  const ISO = { off: false, late: [], why: '', retried: false };
  function isoPre(ctx, mode, own) {
    if (ISO.off || !window.BesideIso) return null;
    let nd = null;
    try { nd = window.BesideIso.node(ctx, () => clearRebuild(true)); } catch (e) { nd = null; }
    if (!nd) {
      if (!own) return null;
      if (!window.BesideIso.supported()) ISO.why = 'broke';
      else if (ctx.sampleRate !== 48000) ISO.why = 'rate';
      else window.BesideIso.ready(ctx).then((good) => {
        if (good || ISO.off) return;
        ISO.why = 'broke'; try { soundUi(); } catch (e) {}
        if (!ISO.retried) { ISO.retried = true; setTimeout(() => clearRebuild(true), 5000); }
      }, () => {});
      return null;
    }
    if (own) ISO.why = '';
    const iso = nd.iso;
    let seen = 0;
    if (iso) iso.onhealth = (h) => {
      const now = Date.now();
      // At most one lost moment counted per 1.5 s, however many removers (yours and the other voice's) saw it.
      if (h.late > seen) { seen = h.late; if (!ISO.late.length || now - ISO.late[ISO.late.length - 1] > 1500) ISO.late.push(now); }
      ISO.late = ISO.late.filter((x) => now - x < 10000);
      if (h.underruns > 0 || ISO.late.length >= 3 || iso.ok === false) isoOff(h.underruns > 0 || ISO.late.length >= 3 ? 'slow' : 'broke');
    };
    return nd;
  }
  function isoOff(why) {
    if (ISO.off) return;
    ISO.off = true; ISO.why = why;
    clearRebuild(true);
    try { soundUi(); } catch (e) {}
  }
  function isoEnd(n) { try { if (n && n.pre && n.pre.iso) { n.pre.iso.onhealth = null; n.pre.iso.close(); } } catch (e) {} }
  CLEAR.pre = isoPre;
  // The same processing, offline, on a recording: for "Hear myself" and for the tests. The pause rule and the
  // de-esser step every 20 ms from the recording's own level, as the live timer does.
  async function renderVoice(x, sr, mode) {
    const t = tuneFor(mode);
    if (!t) return x;
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const n = x.length;
    const mk = () => new OAC(1, n, sr);
    const bufOf = (ctx) => { const b = ctx.createBuffer(1, n, sr); b.getChannelData(0).set(x); return b; };
    let hi = null;
    if (t.ess) {
      const c1 = mk();
      const s1 = c1.createBufferSource(); s1.buffer = bufOf(c1);
      const f = c1.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = ESS_HZ; f.Q.value = 0.7;
      s1.connect(f); f.connect(c1.destination); s1.start();
      hi = (await c1.startRendering()).getChannelData(0);
    }
    const ctx = mk();
    const src = ctx.createBufferSource(); src.buffer = bufOf(ctx);
    // Voice focus: the typing remover too, so Hear myself sounds like the call (at 48 kHz, as live).
    let pre = null;
    if (t.pre && !ISO.off && window.BesideIso && sr === 48000) {
      try { if (await window.BesideIso.ready(ctx)) pre = window.BesideIso.node(ctx); } catch (e) { pre = null; }
    }
    const nd = clearNodes(ctx, t, pre);
    src.connect(nd.in); nd.out.connect(ctx.destination);
    const st = { loudAt: 0, floor: -60 };
    const step = Math.round(0.02 * sr);
    const lvl = (a, i) => { let s = 0; for (let k = Math.max(0, i - 1024); k < i; k++) s += a[k] * a[k]; return s > 0 ? 10 * Math.log10(s / 1024 + 1e-12) : -300; };
    for (let i = step; i < n; i += step) {
      const db = lvl(x, i);
      const go = clearGate(st, db, i / sr * 1000, t, false);
      if (go) nd.gate.gain.setTargetAtTime(go[0], i / sr, go[1]);
      if (nd.ess) { const e = clearEss(db, lvl(hi, i)); nd.ess.gain.setTargetAtTime(e[0], i / sr, e[1]); }
    }
    src.start();
    return (await ctx.startRendering()).getChannelData(0);
  }
  // Pick how your mic is sent. Mid-call it changes in place: the browser is asked to change the mic's own
  // clean-up, and if it can't, a fresh mic replaces the old one in the same lane, so the call carries on.
  function setMicMode(mode) {
    if (!MODES.includes(mode) || mode === CLEAR.mode) return CLEAR.q;
    CLEAR.mode = mode;
    CLEAR.on = !!tuneFor(mode);
    store.set('beside.micmode', mode);
    store.set('beside.clear', CLEAR.on ? '1' : '0');
    soundUi();
    CLEAR.q = CLEAR.q.then(() => micRefit(mode)).catch(() => {}).then(() => {
      if (CLEAR.mode !== mode) return;
      CLEAR.chains.forEach((c) => c.use(mode));
      if (isGuest) guestVoicePick();
      voiceRates();
      liftTell();
      soundUi();
    });
    return CLEAR.q;
  }
  function setClear(on) { return setMicMode(on ? 'clear' : 'natural'); }
  const MIC_KEYS = ['echoCancellation', 'noiseSuppression', 'autoGainControl', 'voiceIsolation'];
  function micFits(tr, want) {
    let s = {};
    try { s = tr.getSettings() || {}; } catch (e) {}
    return MIC_KEYS.every((k) => !(k in want) || !(k in s) || s[k] === want[k]);
  }
  async function micRefit(mode) {
    const stream = isGuest ? G.mic : H.mic;
    const tr = stream && stream.getAudioTracks()[0];
    if (!tr || tr.readyState !== 'live') return;
    const want = micWant(mode);
    const hint = mode === 'music' ? 'music' : 'speech';
    if (micFits(tr, want) && !(mode === 'music' && (tr.getSettings().channelCount || 1) < 2 && tr.getCapabilities && ((tr.getCapabilities().channelCount || {}).max || 1) > 1)) { try { tr.contentHint = hint; } catch (e) {} return; }
    try { await tr.applyConstraints(want); } catch (e) {}
    if (micFits(tr, want)) { try { tr.contentHint = hint; } catch (e) {} app.micSwap = 'constraints'; return; }
    const fresh = await getOwn('audio', want);
    const nt = fresh.getAudioTracks()[0];
    if (!nt) return;
    try { nt.contentHint = hint; } catch (e) {}
    app.micSwap = 'track';
    if (isGuest) {
      nt.enabled = !G.muted;
      const old = G.mic;
      G.mic = fresh;
      const pc = G.call && G.call.peerConnection;
      const snd = pc && pc.getSenders().find((x) => x.track === tr);
      guestVoiceSetup(); // a new leveller for the new mic (its rate can differ)
      if (snd && snd !== G.voiceSender) await snd.replaceTrack(nt).catch(() => {});
      guestVoicePick();
      old.getTracks().forEach((x) => x.stop());
    } else {
      const old = H.mic;
      H.mic = fresh;
      nt.enabled = !(SEND_RAW && H.muted);
      if (H.clear) H.clear.swap(fresh);
      else if (H.rawSrc) { try { H.rawSrc.disconnect(); } catch (e) {} H.rawSrc = H.ctx.createMediaStreamSource(fresh); H.rawSrc.connect(H.micGain); }
      hostVoicePick();
      old.getTracks().forEach((x) => x.stop());
    }
  }
  // LIFT: an iPhone sending its mic as it comes in Clear voice, Voice focus or Far away asks the other side to run
  // the same processing on its voice before playing it, on any device, an iPhone too (Mo, 2 Nov 2026: "and it will
  // lift hers for mine?"). What you hear already passes through the engine there, with no crackle. Old copies of
  // Beside ignore the message and hear Apple's levelled voice.
  function liftMsg() { return { t: 'lift', mode: SEND_RAW && tuneFor(CLEAR.mode) ? CLEAR.mode : '' }; }
  function liftTell(g) {
    if (!SEND_RAW) return;
    if (isGuest) { if (G.conn) tell(G.conn, liftMsg()); } else if (g) tell(g.conn, liftMsg()); else toGuests(liftMsg());
  }
  function liftMode(m) { return MODES.includes(m) && tuneFor(m) ? m : ''; }
  // Voices go at up to 96 kbit/s (Mo, 2 Nov 2026: "really clear and loud and good quality"); Music at 128 kbit/s. The lane allows stereo, and only a stereo mic fills it.
  function voiceRates() {
    if (isGuest) tuneVoice(G.voiceSender);
    else for (const g of H.guests.values()) tuneVoice(g.voiceSender);
  }
  function tuneOpus(sdp) {
    const nl = /\r\n/.test(sdp) ? '\r\n' : '\n';
    let a = -1;
    return sdp.split(/\r?\n(?=m=)/).map((sec) => {
      if (!sec.startsWith('m=audio')) return sec;
      a++;
      const m = sec.match(/^a=rtpmap:(\d+) opus\/48000/im);
      if (!m || a > 1) return sec;
      const want = a === 0
        ? { stereo: '1', 'sprop-stereo': '1', useinbandfec: '1', usedtx: '0', maxaveragebitrate: '128000' }
        : { stereo: '1', 'sprop-stereo': '1', useinbandfec: '1', usedtx: '0', maxaveragebitrate: '128000' };
      const re = new RegExp('^a=fmtp:' + m[1] + ' (.*)$', 'm');
      const fm = sec.match(re);
      const kv = new Map();
      if (fm) fm[1].split(';').forEach((p) => { const i = p.indexOf('='); if (i > 0) kv.set(p.slice(0, i).trim(), p.slice(i + 1).trim()); });
      Object.entries(want).forEach(([k, v]) => kv.set(k, v));
      const line = 'a=fmtp:' + m[1] + ' ' + [...kv].map(([k, v]) => k + '=' + v).join(';');
      return fm ? sec.replace(re, line) : sec.replace(/^(a=rtpmap:\d+ opus\/48000.*)$/im, (l) => l + nl + line);
    }).join(nl);
  }
  // Voices go first on a busy network.
  function tuneVoice(s) {
    try {
      const p = s && s.getParameters();
      if (!p || !p.encodings || !p.encodings.length) return;
      p.encodings[0].priority = 'high';
      p.encodings[0].networkPriority = 'high';
      p.encodings[0].maxBitrate = CLEAR.mode === 'music' ? 128000 : 96000;
      s.setParameters(p).catch(() => {});
    } catch (e) { /* defaults are fine */ }
  }
  // What you hear, on this device: their voice (0 to 150%), the video's sound (0 to 100%), and the video's sound
  // ducking under a voice (Mo, 2 Nov 2026). iPhones and iPads ignore a page's volume, so on Safari, iPhone, iPad
  // and the Beside app every sound you hear plays through the audio engine, where each lane has its own volume.
  // Other browsers play through the page (their echo cancelling hears that best), and use the engine only to go
  // above 100% or to lift an iPhone's voice (LIFT). If the engine stops (an iPhone phone call, or its clock
  // stalls), the page plays it again at once.
  const CAN_VOL = true;
  const UA = navigator.userAgent;
  const ENGINE_OUT = IS_IOS || (/AppleWebKit/.test(UA) && !/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS|Android|OPR/.test(UA));
  const DUCK = 0.25; // about -12 dB under a voice
  function savedVol(k, max) { const v = parseFloat(store.get(k)); return v >= 0 && v <= max ? v : 1; }
  const SND = { voice: savedVol('beside.vol.voice', 1.5), media: savedVol('beside.vol.media', 1), duck: store.get('beside.duck') !== '0' };
  const OUT = { map: new Map(), duck: 1, duckT: 1, clocks: new Map(), timer: 0, rest: false, slept: null };
  function voiceEls() { return isGuest ? [$('voice')] : [...H.guests.values()].map((g) => g.audio); }
  function outEls() {
    const els = isGuest ? [[$('voice'), 'voice', G.lift]] : [...H.guests.values()].map((g) => [g.audio, 'voice', g.lift]);
    const me = $('media');
    if (me) els.push([me, 'media', '']);
    return els.filter((e) => e[0]);
  }
  function outCtx() { return isGuest ? G.ctx : H.ctx; }
  // The engine is fit to play when it runs and its clock moves.
  function engineOk(ctx) {
    if (!ctx || ctx.state !== 'running') return false;
    const c = OUT.clocks.get(ctx), now = Date.now();
    if (!c || c.t !== ctx.currentTime) { OUT.clocks.set(ctx, { t: ctx.currentTime, at: now }); return true; }
    return now - c.at < 1500;
  }
  function outLane(el, kind, lift) {
    const ctx = outCtx();
    const tr = el.srcObject && el.srcObject.getAudioTracks ? el.srcObject.getAudioTracks()[0] || null : null;
    lift = kind === 'voice' && !OUT.rest && tuneFor(lift) ? lift : '';
    let l = OUT.map.get(el);
    if (l && (l.ctx !== ctx || l.track !== tr || l.lift !== lift)) { outDrop(l); l = null; }
    if (!l) {
      l = { el, kind, ctx, track: tr, src: null, gain: null, chain: null, lift, on: false, route: 'page' };
      if (ctx && tr && ctx.state !== 'closed') {
        try {
          l.src = ctx.createMediaStreamSource(new MediaStream([tr]));
          l.gain = ctx.createGain();
          if (lift) { l.chain = clearChain(ctx, new MediaStream([tr]), { mode: lift }); l.chain.out.connect(l.gain); } else l.src.connect(l.gain);
        } catch (e) { if (l.chain) l.chain.close(); l.src = l.gain = l.chain = null; }
      }
      OUT.map.set(el, l);
    }
    return l;
  }
  function outDrop(l) {
    if (l.chain) l.chain.close();
    [l.src, l.gain].forEach((x) => { try { if (x) x.disconnect(); } catch (e) {} });
    OUT.map.delete(l.el);
  }
  function outLevel(l, now) { return l.kind === 'voice' ? SND.voice : SND.media * (now ? OUT.duckT : OUT.duck); }
  function outApply(l, smooth) {
    const eng = outEngine(l);
    if (eng) {
      if (!l.on) { l.gain.connect(l.ctx.destination); l.on = true; }
      const g = l.gain.gain, t = l.ctx.currentTime, v = outLevel(l, true);
      g.cancelScheduledValues(t);
      if (smooth) { g.setValueAtTime(g.value, t); g.setTargetAtTime(v, t, v < g.value ? 0.05 : 0.25); } else g.setValueAtTime(v, t);
      if (!l.el.muted) l.el.muted = true;
    } else {
      if (l.on) { try { l.gain.disconnect(); } catch (e) {} l.on = false; }
      if (l.el.muted && l.el.srcObject) l.el.muted = false;
      const v = Math.min(1, outLevel(l, false));
      if (Math.abs(l.el.volume - v) > 0.001) l.el.volume = v;
    }
    l.route = eng ? 'engine' : 'page';
  }
  // Does this lane need the engine? On Safari, iPhone, iPad and the app, always; elsewhere a voice does only to
  // be lifted or to go above 100%.
  function outEngine(l) {
    if (!l.gain || OUT.rest || !engineOk(l.ctx)) return false;
    return ENGINE_OUT || (l.kind === 'voice' && (!!l.chain || SND.voice > 1));
  }
  // Mo, 5 Nov 2026: "when im watching a youtube video on the app together then there is crackles, both when we're
  // speaking and when the video is playing". While the audio engine runs, an iPhone or iPad plays all of the app's
  // sound, the video's too, in tiny slices of under 3 ms; with YouTube and two cameras busy it falls behind, and
  // everything crackles. YouTube ignores its volume there anyway. So while a video is open together on an iPhone
  // or iPad, voices play through the page (at full volume, not lifted, no green ring) and the engine rests, unless
  // the call's own sound still passes through it (three or more people, or a video file you share). It starts again
  // when the video closes.
  function outRest() { return IS_IOS && !!W.id; }
  function outIdle() {
    const ctx = outCtx();
    const busy = !!CV.snd || (isGuest ? !!G.vctx && G.vctx === G.ctx : app.hostVoice === 'mix');
    if (OUT.rest && !busy) {
      if (ctx && ctx.state === 'running') { OUT.slept = ctx; ctx.suspend().catch(() => {}); }
    } else if (OUT.slept) {
      const c = OUT.slept;
      OUT.slept = null;
      if (c === ctx && c.state === 'suspended' && (app.state === 'live' || app.state === 'watching')) c.resume().catch(() => {});
    }
  }
  // Should this element be muted (its sound plays through the engine instead)?
  function outMuted(el) { const l = OUT.map.get(el); return !!l && l.route === 'engine'; }
  function applyVolumes() {
    OUT.rest = outRest();
    const live = new Set();
    outEls().forEach(([el, kind, lift]) => { live.add(el); outApply(outLane(el, kind, lift)); });
    [...OUT.map.values()].forEach((l) => { if (!live.has(l.el)) outDrop(l); });
    ytVolume();
    outWatch();
    soundUi();
    outIdle();
  }
  // Every 50 ms in a call: the duck follows who is talking (in fast, out slowly), and a lane whose engine stopped
  // goes back to the page.
  function outWatch() {
    if (OUT.timer) return;
    OUT.timer = setInterval(() => {
      if (app.state !== 'live' && app.state !== 'watching' && !W.p) { clearInterval(OUT.timer); OUT.timer = 0; return; }
      const want = SND.duck && T.ids.size > 0 ? DUCK : 1;
      const smooth = want !== OUT.duckT;
      OUT.duckT = want;
      if (OUT.duck !== want) {
        OUT.duck += (want - OUT.duck) * (want < OUT.duck ? 0.35 : 0.08);
        if (Math.abs(OUT.duck - want) < 0.01) OUT.duck = want;
      }
      app.duck = OUT.duck;
      OUT.map.forEach((l) => {
        const was = l.route;
        const eng = outEngine(l);
        if (eng !== (was === 'engine')) outApply(l);
        else if (l.kind === 'media' && (smooth || l.route === 'page')) outApply(l, true);
      });
      ytVolume();
      if (outRest() !== OUT.rest) applyVolumes(); else outIdle();
    }, 50);
  }
  // YouTube plays in its own frame: its player sets the video's sound (and the duck). Its volume jumps at once,
  // so it moves at most 4 steps of 100 each 50 ms: a big jump clicks (Mo, 5 Nov 2026). A full duck takes under 1 s.
  const YT_STEP = 4;
  function ytVolume() {
    const p = W.p;
    if (!p || !W.ready || typeof p.setVolume !== 'function') return;
    const want = Math.round(100 * SND.media * OUT.duck);
    const v = W.vol < 0 ? want : W.vol + Math.max(-YT_STEP, Math.min(YT_STEP, want - W.vol));
    if (v === W.vol) return;
    try {
      p.setVolume(v);
      if (v === 0 && typeof p.mute === 'function') p.mute();
      else if (W.vol <= 0 && typeof p.unMute === 'function') p.unMute();
    } catch (e) {}
    W.vol = v;
  }
  function setVol(k, v) {
    SND[k] = Math.max(0, Math.min(k === 'voice' ? 1.5 : 1, v));
    store.set('beside.vol.' + k, String(SND[k]));
    applyVolumes();
  }
  function setDuck(on) {
    SND.duck = !!on;
    store.set('beside.duck', on ? '1' : '0');
    applyVolumes();
  }
  // A sound lane that holds its place in the call and sends silence.
  function silentTrack(ctx) {
    try { const d = ctx.createMediaStreamDestination(); d.channelCount = 1; return d.stream.getAudioTracks()[0] || null; } catch (e) { return null; }
  }
  function play(el, track) {
    if (!el) return;
    if (!track) { if (el.srcObject) el.srcObject = null; return; }
    if (!el.srcObject || el.srcObject.getAudioTracks()[0] !== track) el.srcObject = new MediaStream([track]);
    el.muted = outMuted(el);
    if (el.paused) el.play().catch(() => {});
  }

  // Who is talking: the host listens to every voice and tells everyone; a green ring marks them.
  const T = { ids: new Set(), sig: '', timer: 0, last: new Map(), buf: null };
  function renderTalk() {
    const has = (el) => !!el.dataset.pid && T.ids.has(el.dataset.pid);
    document.querySelectorAll('#watchRoot .tile').forEach((el) => el.classList.toggle('talking', has(el)));
    if (mini.els) mini.els.grid.querySelectorAll('.fw-tile').forEach((el) => el.classList.toggle('talking', has(el)));
  }
  function setTalk(ids) {
    const sig = [...ids].sort().join(',');
    if (sig === T.sig) return false;
    T.sig = sig;
    T.ids = new Set(ids);
    renderTalk();
    return true;
  }
  function loud(an) {
    if (!an) return 0;
    if (!T.buf || T.buf.length !== an.fftSize) T.buf = new Float32Array(an.fftSize);
    an.getFloatTimeDomainData(T.buf);
    let s = 0;
    for (let i = 0; i < T.buf.length; i++) s += T.buf[i] * T.buf[i];
    return Math.sqrt(s / T.buf.length);
  }
  function hostListen() {
    clearInterval(T.timer);
    T.timer = setInterval(() => {
      if (!H.ctx) return;
      const now = Date.now();
      const src = [[H.me, H.micAn]].concat([...H.guests.values()].filter((g) => g.live).map((g) => [g.id, g.an]));
      const ids = [];
      const run = H.ctx.state === 'running'; // a resting engine's meters hold their last sound
      src.forEach(([id, an]) => {
        if (run && loud(an) > 0.02) T.last.set(id, now);
        if (now - (T.last.get(id) || 0) < 1300) ids.push(id);
      });
      if (setTalk(ids)) toGuests({ t: 'talk', ids });
    }, 120);
  }
  function analyser(node) {
    try {
      const an = H.ctx.createAnalyser();
      an.fftSize = 32768; // the last ~0.7 s: a hidden tab only runs timers about once a second
      node.connect(an);
      an.connect(H.sink); // a silent sink keeps it measuring in every browser
      return an;
    } catch (e) { return null; }
  }

  // ---------- VIEW (one call stage for both roles) ----------
  // One tile is big, the others float as bubbles. Big = the tile you tapped (while it's there), else the shared
  // screen, else the other person's face, else their initial. A host alone sees the invite card instead.
  const V = { pin: '', mode: store.get('beside.layout') === 'focus' ? 'focus' : 'split', focus: 'them', pair: false };
  // A video call for two: Split shows you both, half and half (stacked when the screen is tall, side by side when
  // it is wide); Focus shows one of you big and the other as a small tile. The choice is kept on this device.
  const LAYOUT_ICON = {
    split: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="8" height="16" rx="2"/><rect x="13" y="4" width="8" height="16" rx="2"/></svg>',
    focus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2.5"/><rect x="13" y="13" width="6" height="5" rx="1.2" fill="currentColor"/></svg>',
  };
  function setLayout(mode, focus) {
    V.mode = mode === 'focus' ? 'focus' : 'split';
    if (focus) V.focus = focus;
    store.set('beside.layout', V.mode);
    layout();
  }
  function layoutButton() {
    const b = $('layoutBtn');
    if (!b) return;
    b.hidden = !V.pair || V.room; // in the room both of you are always there: you in the photo, them in the window
    const toFocus = V.mode === 'split';
    const lab = toFocus ? 'Focus: show one of you big' : 'Split: show you both, half and half';
    if (b.dataset.to !== (toFocus ? 'focus' : 'split')) {
      b.dataset.to = toFocus ? 'focus' : 'split';
      b.innerHTML = LAYOUT_ICON[toFocus ? 'focus' : 'split'];
      b.setAttribute('aria-label', lab);
      b.title = toFocus ? 'Focus' : 'Split';
    }
  }
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
    let alone = false, name = '', self = null, avatarId = '';
    if (isGuest) {
      const pc = G.call && G.call.peerConnection;
      const face = G.camOn && app.state === 'watching' && pc ? lane(pc, 1) : null;
      setTrack($('camBubble'), face);
      if ($('camBubble')) $('camBubble').dataset.pid = hostId;
      if (face) others.push($('camBubble'));
      // the other guests' faces, passed on by the host
      const keep = new Set();
      G.people.forEach((p) => {
        const t = p.cam && p.lane > 1 && pc && app.state === 'watching' ? lane(pc, p.lane) : null;
        if (!t) return;
        keep.add(p.id);
        let tile = G.tiles.get(p.id);
        if (!tile) { tile = faceTile(p.name || 'Guest', 'p:' + p.id); tile.dataset.pid = p.id; park.appendChild(tile); G.tiles.set(p.id, tile); }
        setTrack(tile, t);
        others.push(tile);
      });
      for (const [id, tile] of G.tiles) if (!keep.has(id)) { setTrack(tile, null); tile.remove(); G.tiles.delete(id); }
      name = hostLabel();
      avatarId = hostId;
      const mine = G.cam && G.cam.getVideoTracks()[0];
      setTrack($('gSelf'), mine || null);
      if ($('gSelf')) $('gSelf').dataset.pid = (G.peer && G.peer.id) || '';
      if (mine) self = $('gSelf');
    } else {
      const live = watchers();
      alone = !live.length;
      live.forEach((g) => { if (g.tile) others.push(g.tile); });
      name = live.length ? live[0].name || '' : '';
      avatarId = live.length ? live[0].id : '';
      setTrack($('selfFace'), H.cam ? H.camSlot : null);
      if ($('selfFace')) $('selfFace').dataset.pid = H.me || '';
      if (H.cam) self = $('selfFace');
    }
    if ($('avatarTile')) $('avatarTile').dataset.pid = avatarId;
    const screen = scr ? $('screenTile') : null;
    const visible = [screen].concat(others, [self]).filter(Boolean);
    const auto = alone ? $('inviteTile') : screen || others[0] || $('avatarTile');
    V.auto = auto ? auto.dataset.key : '';
    let big = auto;
    // Just the two of you, your camera on, nothing shared: Split or Focus. More people, a shared screen, a video
    // together or a voice call keep the usual view.
    const them = others[0] || $('avatarTile');
    V.pair = !alone && !screen && !!self && others.length <= 1 && (isGuest ? !G.people.length : watchers().length === 1) && !(!!W.id && !!$('ytBox') && !$('ytBox').hidden);
    let halves = null;
    if (V.pair) {
      if (V.mode === 'split') { halves = [them, self]; big = null; }
      else big = V.focus === 'self' ? self : them;
    } else if (!alone && V.pin) {
      const p = visible.find((el) => el !== self && el.dataset.key === V.pin);
      if (p) big = p; else V.pin = '';
    }
    // Watching YouTube together: the video takes the middle, everyone's faces float beside it.
    const ytOn = !!W.id && !!$('ytBox') && !$('ytBox').hidden;
    if (ytOn) big = null;
    // The faces window is open: the faces are there, so the shared screen here stays clear.
    const smalls = halves ? [] : V.pair ? [big === self ? them : self] : mini.win && big === screen ? [] : visible.filter((el) => el !== big);
    root.dataset.faces = ytOn && smalls.length ? '1' : '';
    root.dataset.layout = halves ? 'split' : V.pair ? 'focus' : '';
    // Next Door: just one other person and nothing shared, so the call is one room (see roomLook).
    roomLook(root, !alone && !screen && !ytOn && others.length <= 1 && (isGuest ? !G.people.length : watchers().length === 1));
    root.querySelectorAll('.tile').forEach((el) => {
      if (el === big || smalls.includes(el) || (halves && halves.includes(el))) return;
      el.hidden = true;
      el.classList.remove('big', 'small', 'half');
      if (el.parentNode !== park) park.appendChild(el);
    });
    const put = (el, box, i, half) => {
      el.hidden = false;
      el.classList.toggle('half', !!half);
      el.classList.toggle('big', !half && box === bigSlot);
      el.classList.toggle('small', box !== bigSlot);
      if (box.children[i] !== el) {
        box.insertBefore(el, box.children[i] || null);
        const v = el.querySelector('video');
        if (v && v.srcObject) v.play().catch(() => {}); // iPhone can pause a moved video
      }
    };
    if (halves) halves.forEach((el, i) => put(el, bigSlot, i, true));
    else if (big) put(big, bigSlot, 0);
    smalls.forEach((el, i) => put(el, bub, i));
    layoutButton();
    // their initial (or a plain figure) while their camera is off
    const ini = $('avatarInitial');
    if (ini) { if (name) ini.textContent = name.charAt(0).toUpperCase(); else ini.innerHTML = PERSON; }
    // the board draws their character there instead, when it knows who they are (an event, nothing else)
    if (name !== V.faceName) { V.faceName = name; document.dispatchEvent(new CustomEvent('beside:face', { detail: { name: name || '' } })); }
    text('avatarName', name || (isGuest ? 'Your host' : 'Your guest'));
    text('callTitle', titleText());
    const mine = isGuest ? G.screenTrack : H.video;
    text('shareLabel', amSharing() ? shareWhat(mine) : titleText());
    document.body.dataset.alone = alone ? '1' : '';
    const gs = $('gScreenBtn');
    if (gs) gs.hidden = !(isGuest && G.hostVer >= 2 && app.state === 'watching');
    const sb = $('soundBtn');
    if (sb) { sb.hidden = !inCallWithSomeone(); if (sb.hidden) soundOpen(false); }
    chatButton();
    docTitle();
    fitDots();
    pointTip();
    miniRender();
    renderTalk();
  }

  // ---------- NEXT DOOR: the call as one room ----------
  // When the call connects, the wall between your rooms folds down (a plain fade with reduced motion). Their camera
  // fills the big window, yours is the framed photo on the sill, and the two of you sit on one sofa, seen from
  // behind. Double tap anywhere but the controls: it zooms until only they fill the screen; double tap to go back.
  // More people, a shared screen or a video together keep the usual view.
  function roomLook(root, on) {
    if (on && !V.room) {
      const so = $('ndSofa');
      if (so && !so.firstChild && window.BesideFigures) so.innerHTML = window.BesideFigures.sofaBack({ label: '' });
      if (!V.folded) { V.folded = true; foldWall(); }
    }
    V.room = on;
    root.classList.toggle('nd-call', on);
    if (!on) setZoom(false);
  }
  // Back on Home (a reconnect keeps the room, its zoom, and does not fold the wall again).
  function roomOff() { V.room = false; V.folded = false; const r = $('watchRoot'); if (r) r.classList.remove('nd-call'); setZoom(false); }
  function foldWall() {
    const f = $('ndFold');
    if (!f || !f.animate) return;
    app.folds = (app.folds || 0) + 1;
    f.classList.add('go');
    const done = () => f.classList.remove('go');
    if (still()) { f.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 450, fill: 'forwards' }).onfinish = done; return; }
    f.querySelector('b').animate([{ transform: 'rotateX(0deg)' }, { transform: 'rotateX(-90deg)', opacity: 1, offset: 0.8 }, { transform: 'rotateX(-90deg)', opacity: 0 }],
      { duration: 1000, easing: 'cubic-bezier(.55,0,.35,1)', fill: 'forwards' });
    f.querySelectorAll('i').forEach((el) => el.animate([{ opacity: 0.94 }, { opacity: 0.94, offset: 0.4 }, { opacity: 0 }], { duration: 1000, easing: 'ease-in-out', fill: 'forwards' }).onfinish = done);
  }
  function setZoom(on) {
    const r = $('watchRoot');
    app.zoomed = !!on && !!r && r.classList.contains('nd-call');
    if (r) r.classList.toggle('nd-zoom', app.zoomed);
  }
  // Our own double tap (touch, pen or mouse): Safari on iPhone and iPad sends no dblclick for a quick double tap.
  let dtap = null;
  function zoomTap(e) {
    const r = $('watchRoot');
    if (!V.room || !r || (e.pointerType === 'mouse' && e.button !== 0)) return;
    if (e.target && e.target.closest && e.target.closest('button, input, a, .dock, .hud .top, .soundpop, .peek, .hear, .ytbox')) { dtap = null; return; }
    const now = Date.now();
    if (dtap && now - dtap.t < 400 && Math.hypot(e.clientX - dtap.x, e.clientY - dtap.y) < 40) { dtap = null; setZoom(!app.zoomed); return; }
    dtap = { t: now, x: e.clientX, y: e.clientY };
  }

  // Swap: tap a bubble and it becomes big; tap the small screen to swap back. Your own bubble never swaps.
  function swapTap(e) {
    if (CV.kind === 'video' && amSharing() && e.target && e.target.closest && e.target.closest('#screenTile')) { videoToggle(); return; }
    if (V.room) return; // in the room a tap is half of a double tap
    // Two of you: tap a half to make that person big; tap the big one, or the small tile, to go back to Split.
    if (V.pair) {
      const p = e.target && e.target.closest && e.target.closest('#bigSlot .tile, #bubbles .tile');
      if (!p) return;
      if (p.classList.contains('half')) setLayout('focus', p.dataset.key === 'self' ? 'self' : 'them');
      else setLayout('split');
      return;
    }
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
    if (ch) ch.hidden = !amSharing() || isGuest || !!CV.kind;
    m.hidden = false;
    wakeControls();
    const x = $('moreClose');
    if (x) x.focus();
  }
  function closeMore() { const m = $('moreSheet'); if (m) m.hidden = true; }
  function soundOpen(on) {
    const p = $('soundPop'), b = $('soundBtn');
    if (!p) return;
    p.hidden = !on;
    if (b) b.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on) { soundUi(); wakeControls(); }
  }

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
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((ev) => tile.addEventListener(ev, (e) => {
      if (e.pointerType !== 'mouse') P.lastTouch = Date.now(); // the click a long hold ends with is not a second point
      if (P.start && e.pointerId === P.start.id) cancel();
    }));
    tile.addEventListener('click', (e) => {
      if (Date.now() - P.lastTouch < 800 || !canPoint()) return; // a short tap only wakes the controls
      pointAt(e.clientX, e.clientY);
    });
    tile.addEventListener('contextmenu', (e) => { if (canPoint()) e.preventDefault(); });
    try { new ResizeObserver(fitDots).observe(tile); } catch (e) { addEventListener('resize', fitDots); }
    const v = $('screenVideo');
    if (v) ['resize', 'loadedmetadata'].forEach((ev) => v.addEventListener(ev, fitDots));
  }

  // ---------- FACES WINDOW ----------
  // Chrome and Edge, in a call: the faces pop out into their own always-on-top window (Document Picture-in-
  // Picture), like Teams. You on one side, them on the other; three people split three ways, four make a grid.
  // Drag it over the tab you share or onto another screen and size it as you like. It is its own window, so it
  // never shows in the shared picture. While you share, a dot someone puts on your screen flashes up in it.
  const HAS_MINI = 'documentPictureInPicture' in window;
  const mini = { win: null, els: null, opening: false, sig: '', auto: false, peekTimer: 0, stageTimer: 0, awakeTimer: 0 };
  function inCallWithSomeone() { return isGuest ? app.state === 'watching' : app.state === 'live' && watchers().length > 0; }
  // Still in the call, maybe waiting for someone to (re)connect: the faces window stays open through a blip.
  function inCall() { return isGuest ? !G.left && (app.state === 'watching' || app.state === 'waiting') : app.state === 'live'; }
  // Everyone in the call, you first: { pid, name, track (their camera, or null), self }
  function people() {
    const list = [];
    if (isGuest) {
      const pc = G.call && G.call.peerConnection;
      const mine = G.cam && G.cam.getVideoTracks()[0];
      list.push({ pid: (G.peer && G.peer.id) || 'me', name: 'You', initial: cleanName(store.get('beside.name')), track: mine || null, self: true });
      list.push({ pid: hostId, name: hostLabel() || 'Host', track: G.camOn && pc ? lane(pc, 1) : null });
      G.people.forEach((p) => list.push({ pid: p.id, name: p.name || 'Guest', track: p.cam && p.lane > 1 && pc ? lane(pc, p.lane) : null }));
    } else {
      list.push({ pid: H.me, name: 'You', initial: myName(), track: H.cam ? H.camSlot : null, self: true });
      watchers().forEach((g) => {
        const pc = g.call && g.call.peerConnection;
        list.push({ pid: g.id, name: g.name || 'Guest', track: g.camOn && pc ? lane(pc, 0) : null });
      });
    }
    return list;
  }
  function miniSize(n) { return n <= 2 ? { width: 520, height: 230 } : n === 3 ? { width: 660, height: 220 } : { width: 480, height: 360 }; }
  async function miniOpen() {
    if (!HAS_MINI || mini.win || mini.opening || !inCallWithSomeone()) return;
    mini.opening = true;
    let win;
    try {
      win = await window.documentPictureInPicture.requestWindow(miniSize(people().length));
    } catch (e) {
      mini.opening = false;
      note('The faces window didn’t open. Press Pop out to try again.', 'info');
      return;
    }
    mini.opening = false;
    if (!inCallWithSomeone()) { try { win.close(); } catch (e) {} return; }
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
    const div = (cls) => { const e = d.createElement('div'); e.className = cls; return e; };
    const root = div('fw');
    const grid = div('fw-grid');
    // a small picture of the screen you share, shown for a moment when someone points at it
    const stage = div('fw-stage');
    stage.hidden = true;
    const v = d.createElement('video');
    v.muted = true; v.autoplay = true; v.setAttribute('playsinline', '');
    const dots = div('dots');
    stage.append(v, dots);
    const peek = div('mini-peek');
    peek.hidden = true;
    const wait = div('mini-peek fw-wait');
    wait.hidden = true;
    const snd = soundPanel(d, { noTest: true });
    snd.classList.add('fw-sound');
    snd.hidden = true;
    const bar = div('fw-bar');
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
    bar.append(btn('mute', 'Mic', isGuest ? '#gMuteBtn' : '#muteBtn'), btn('cam', 'Camera', isGuest ? '#gCamBtn' : '#camBtn', 'cam'));
    if (CAN_VOL) bar.append(btn('sound', 'Sound', '#soundBtn'));
    bar.append(stop);
    root.append(grid, stage, peek, wait, snd, bar);
    d.body.appendChild(root);
    bar.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) act(b.dataset.act); });
    const awake = () => {
      root.classList.add('awake');
      clearTimeout(mini.awakeTimer);
      mini.awakeTimer = setTimeout(() => { if (snd.hidden) root.classList.remove('awake'); }, 2500);
    };
    root.addEventListener('pointermove', awake);
    root.addEventListener('pointerdown', awake);
    const fit = () => { fitGrid(); fitLayer(v, dots); };
    win.addEventListener('resize', fit);
    ['resize', 'loadedmetadata'].forEach((ev) => v.addEventListener(ev, () => fitLayer(v, dots)));
    win.addEventListener('pagehide', () => { if (mini.win === win) { mini.win = null; mini.els = null; layout(); } });
    mini.win = win;
    mini.els = { grid, stage, v, dots, peek, wait, bar, snd, root };
    mini.sig = '';
    layout();
    soundUi();
    awake();
  }
  // The faces window's buttons do what the same buttons in the dock do.
  function act(name) {
    if (name === 'mute') { if (isGuest) guestMute(); else hostMute(); }
    else if (name === 'cam') { if (isGuest) guestCam(); else hostCam(); }
    else if (name === 'unshare') { if (isGuest) guestUnshare(); else hostUnshare(); }
    else if (name === 'sound' && mini.els) { mini.els.snd.hidden = !mini.els.snd.hidden; mini.els.root.classList.toggle('awake', !mini.els.snd.hidden); }
    miniRender();
  }
  function miniClose() {
    const w = mini.win;
    mini.win = null;
    mini.els = null;
    if (w) { try { w.close(); } catch (e) {} }
  }
  // Tiles as big as the window allows: try every number of columns and keep the one whose tiles come closest to
  // a camera's 4:3 shape, with few empty places. Two people in a wide window sit side by side, in a tall one
  // above each other.
  function fitGrid() {
    if (!mini.els) return;
    const g = mini.els.grid;
    const tiles = [...g.children];
    const n = tiles.length, W = g.clientWidth, Ht = g.clientHeight;
    if (!n || !W || !Ht) return;
    let best = null;
    for (let c = 1; c <= n; c++) {
      const r = Math.ceil(n / c);
      const score = Math.abs(Math.log((W / c) / (Ht / r) / (4 / 3))) + 0.5 * (c * r - n);
      if (!best || score < best.score) best = { c, r, score };
    }
    const gap = 6;
    const w = Math.floor((W - gap * (best.c - 1)) / best.c), h = Math.floor((Ht - gap * (best.r - 1)) / best.r);
    tiles.forEach((t) => { t.style.width = w + 'px'; t.style.height = h + 'px'; });
    g.dataset.cols = String(best.c);
  }
  function miniRender() {
    const want = HAS_MINI && inCallWithSomeone();
    if (want !== mini.auto) autoPip(want);
    const btn = $('miniBtn');
    if (btn) { btn.hidden = !want && !mini.win; btn.setAttribute('aria-pressed', mini.win ? 'true' : 'false'); }
    if (!mini.win || !mini.els) return;
    if (!inCall()) { miniClose(); return; }
    const { grid, bar, wait } = mini.els;
    const who = isGuest ? hostLabel() || 'them' : '';
    wait.textContent = want ? '' : isGuest ? 'Waiting for ' + who + '…' : 'Waiting for someone to join…';
    wait.hidden = want;
    const list = people();
    const sig = list.map((p) => p.pid + ':' + (p.track ? p.track.id : '') + ':' + p.name + ':' + (p.initial || '')).join('|');
    if (sig !== mini.sig) {
      mini.sig = sig;
      const d = mini.win.document;
      grid.querySelectorAll('video').forEach((x) => { x.srcObject = null; });
      grid.textContent = '';
      list.forEach((p) => {
        const f = d.createElement('div');
        f.className = 'fw-tile' + (p.self ? ' self' : '');
        f.dataset.pid = p.pid;
        // their initial, covered by their camera once its picture arrives
        const b = d.createElement('b');
        const ini = (p.self ? p.initial : p.name) || '';
        if (ini) b.textContent = ini.charAt(0).toUpperCase(); else b.innerHTML = PERSON;
        f.appendChild(b);
        if (p.track) {
          const fv = d.createElement('video');
          fv.muted = true; fv.autoplay = true; fv.setAttribute('playsinline', '');
          fv.srcObject = new MediaStream([p.track]);
          f.appendChild(fv);
          fv.play().catch(() => {});
        }
        const lab = d.createElement('span');
        lab.className = 'label';
        lab.textContent = p.name;
        f.appendChild(lab);
        grid.appendChild(f);
      });
      fitGrid();
      renderTalk();
    }
    const muted = isGuest ? G.muted : H.muted;
    const camOn = isGuest ? !!G.cam : !!H.cam;
    const self = grid.querySelector('.fw-tile.self');
    if (self) self.classList.toggle('muted', muted);
    const m = bar.querySelector('[data-act=mute]');
    if (m) m.setAttribute('aria-pressed', muted ? 'true' : 'false');
    const c = bar.querySelector('[data-act=cam]');
    if (c) c.setAttribute('aria-pressed', camOn ? 'true' : 'false');
    const s = bar.querySelector('[data-act=unshare]');
    if (s) s.hidden = !amSharing();
  }
  function miniDot(x, y, from, name) {
    if (!mini.win || !mini.els || !amSharing()) return;
    const { stage, v, dots } = mini.els;
    const t = screenSource();
    if (!t) return;
    if (!v.srcObject || v.srcObject.getVideoTracks()[0] !== t) v.srcObject = new MediaStream([t]);
    v.play().catch(() => {});
    stage.hidden = false;
    fitLayer(v, dots);
    dots.appendChild(dotEl(mini.win.document, x, y, from, name));
    clearTimeout(mini.stageTimer);
    mini.stageTimer = setTimeout(() => {
      if (!mini.els || mini.els.stage !== stage) return;
      stage.hidden = true;
      v.srcObject = null;
    }, 2800);
  }
  function miniPeek(line) {
    if (!mini.win || !mini.els) return;
    const p = mini.els.peek;
    p.textContent = line;
    p.hidden = false;
    clearTimeout(mini.peekTimer);
    mini.peekTimer = setTimeout(() => { p.hidden = true; }, 6000);
  }
  // Chrome can pop the faces out by itself when you switch to another tab during a call (it may ask once).
  function autoPip(on) {
    mini.auto = !!on;
    try { navigator.mediaSession.setActionHandler('enterpictureinpicture', on && HAS_MINI ? () => { miniOpen(); } : null); } catch (e) { /* not offered here */ }
  }
  // The Sound panel: what you hear, and how your mic is sent. One in the call, one in the faces window and one in
  // the Sound and mic sheet outside a call; all show the same.
  function soundPanel(doc, opts) {
    opts = opts || {};
    const box = doc.createElement('div');
    box.className = 'sound';
    const head = (txt) => { const h = doc.createElement('h3'); h.className = 'sound-h'; h.textContent = txt; return h; };
    box.appendChild(head('What you hear'));
    [['voice', 'Their voice', 150], ['media', 'Video sound', 100]].forEach(([k, label, max]) => {
      const row = doc.createElement('label');
      row.className = 'sound-row';
      row.dataset.k = k;
      const name = doc.createElement('span');
      name.className = 'sound-name';
      name.textContent = label;
      const r = doc.createElement('input');
      r.type = 'range'; r.min = '0'; r.max = String(max); r.step = '1';
      r.value = String(Math.round(SND[k] * 100));
      r.setAttribute('aria-label', label);
      r.addEventListener('input', () => setVol(k, r.value / 100));
      const pct = doc.createElement('span');
      pct.className = 'sound-pct';
      row.append(name, r, pct);
      box.appendChild(row);
    });
    const dk = doc.createElement('label');
    dk.className = 'sound-tog';
    const dcb = doc.createElement('input');
    dcb.type = 'checkbox';
    dcb.checked = SND.duck;
    dcb.addEventListener('change', () => setDuck(dcb.checked));
    const dt = doc.createElement('span');
    dt.textContent = 'Lower the video when someone talks';
    dk.append(dcb, dt);
    box.appendChild(dk);
    const hint = doc.createElement('p');
    hint.className = 'sound-hint';
    box.appendChild(hint);
    box.appendChild(head('Your mic'));
    const modes = doc.createElement('div');
    modes.className = 'sound-modes';
    modes.setAttribute('role', 'radiogroup');
    modes.setAttribute('aria-label', 'How your mic is sent');
    MODES.forEach((m) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'sound-mode';
      b.dataset.mode = m;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', m === CLEAR.mode ? 'true' : 'false');
      b.tabIndex = m === CLEAR.mode ? 0 : -1;
      b.textContent = MODE_TEXT[m][0];
      b.addEventListener('click', () => setMicMode(m));
      modes.appendChild(b);
    });
    box.appendChild(modes);
    const say = doc.createElement('p');
    say.className = 'sound-say';
    box.appendChild(say);
    if (!opts.noTest) {
      const tb = doc.createElement('button');
      tb.type = 'button';
      tb.className = 'btn quiet sound-test';
      tb.textContent = 'Hear myself';
      const ts = doc.createElement('span');
      ts.className = 'sound-test-say';
      ts.setAttribute('aria-live', 'polite');
      tb.addEventListener('click', () => hearMyself(tb, ts));
      const tr = doc.createElement('div');
      tr.className = 'sound-testrow';
      tr.append(tb, ts);
      box.appendChild(tr);
    }
    return box;
  }
  function soundUi() {
    const disp = isGuest ? G.display : H.display;
    const mine = amSharing() && !!disp && disp.getAudioTracks().some((t) => t.readyState === 'live');
    [$('soundPop'), $('soundSheetBody'), mini.els && mini.els.snd].filter(Boolean).forEach((b) => {
      b.querySelectorAll('.sound-row').forEach((row) => {
        const k = row.dataset.k;
        const r = row.querySelector('input');
        const n = Math.round(SND[k] * 100);
        if (+r.value !== n) r.value = String(n);
        row.querySelector('.sound-pct').textContent = n + '%';
        const off = k === 'media' && amSharing() && !W.id;
        r.disabled = off;
        row.classList.toggle('off', off);
      });
      const dcb = b.querySelector('.sound-tog input');
      if (dcb && dcb.checked !== SND.duck) dcb.checked = SND.duck;
      b.querySelectorAll('.sound-mode').forEach((m) => {
        const on = m.dataset.mode === CLEAR.mode;
        m.setAttribute('aria-checked', on ? 'true' : 'false');
        m.tabIndex = on ? 0 : -1;
      });
      const say = b.querySelector('.sound-say');
      if (say) say.textContent = MODE_TEXT[CLEAR.mode][1] + (CLEAR.mode !== 'focus' || SEND_RAW ? ''
        : ISO.why === 'slow' ? ' The typing remover was too slow on this device, so it is off. Other sounds are still pushed back.'
          : ISO.why === 'rate' ? ' The typing remover can’t run with this mic, so other sounds are only pushed back.'
            : ISO.why === 'broke' ? ' The typing remover can’t run on this device, so other sounds are only pushed back.' : '');
      const h = b.querySelector('.sound-hint');
      if (h) {
        h.textContent = !amSharing() ? 'Changes only what you hear. Nobody else’s sound changes.'
          : mine ? 'You’re sharing: use the video’s own volume. Everyone hears that change.'
            : 'You’re sharing without sound. Share a tab with “Also share tab audio” on to send its sound.';
      }
    });
  }
  // Hear myself: 3 seconds of your mic, played back the way the chosen mode sends it. Works without a call.
  const HM = { busy: false };
  async function hearMyself(btn, say) {
    if (HM.busy) return;
    HM.busy = true;
    const mode = CLEAR.mode;
    const AC = window.AudioContext || window.webkitAudioContext;
    let ctx = new AC(); // made inside the tap so it may play
    ctx.resume().catch(() => {});
    let own = null;
    const all = [...document.querySelectorAll('.sound-test')];
    all.forEach((b) => { b.disabled = true; });
    const tell2 = (t) => document.querySelectorAll('.sound-test-say').forEach((x) => { x.textContent = t; });
    try {
      const live = isGuest ? G.mic : H.mic;
      const lt = live && live.getAudioTracks()[0];
      let stream = live;
      if (!lt || lt.readyState !== 'live') { own = await getOwn('audio', micWant(mode)); stream = own; }
      // The engine runs at the mic's own rate, as in a call.
      const rate = trackRate(stream);
      if (rate && rate !== ctx.sampleRate) { try { const c2 = new AC({ sampleRate: rate }); ctx.close().catch(() => {}); ctx = c2; ctx.resume().catch(() => {}); } catch (e) {} }
      tell2('Speak now, for 3 seconds.');
      const src = ctx.createMediaStreamSource(stream);
      const sp = ctx.createScriptProcessor(4096, 1, 1);
      const zero = ctx.createGain(); zero.gain.value = 0;
      const want = Math.round(ctx.sampleRate * 3);
      const rec = new Float32Array(want);
      let got = 0;
      await new Promise((done) => {
        sp.onaudioprocess = (e) => {
          const d = e.inputBuffer.getChannelData(0);
          const k = Math.min(d.length, want - got);
          rec.set(d.subarray(0, k), got);
          got += k;
          if (got >= want) { sp.onaudioprocess = null; done(); }
        };
        src.connect(sp); sp.connect(zero); zero.connect(ctx.destination);
        setTimeout(done, 5000); // an engine that never runs
      });
      try { src.disconnect(); sp.disconnect(); } catch (e) {}
      if (own) { own.getTracks().forEach((t) => t.stop()); own = null; }
      if (got < want / 2) throw new Error('no sound');
      tell2('Playing it back.');
      const y = await renderVoice(rec.subarray(0, got), ctx.sampleRate, mode);
      const b = ctx.createBuffer(1, y.length, ctx.sampleRate);
      b.getChannelData(0).set(y);
      const p = ctx.createBufferSource();
      p.buffer = b;
      p.connect(ctx.destination);
      app.heard = { mode, n: y.length, rate: ctx.sampleRate };
      await new Promise((done) => { p.onended = done; p.start(); setTimeout(done, 4500); });
      tell2('That is how you sound with ' + MODE_TEXT[mode][0] + '.');
    } catch (e) {
      tell2(e && e.message === 'no sound' ? 'Your mic gave no sound. Try again.' : 'The microphone is blocked. Allow it for this site, then try again.');
    } finally {
      if (own) own.getTracks().forEach((t) => t.stop());
      ctx.close().catch(() => {});
      all.forEach((b) => { b.disabled = false; });
      HM.busy = false;
    }
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
  function trimChat() {
    const l = $('chatList');
    const rows = l ? l.querySelectorAll('.msg') : [];
    for (let i = 0; i < rows.length - 300; i++) rows[i].remove(); // keep the last 300
  }
  function chatAdd(mine, name, t) {
    trimChat();
    const body = chatRow(mine, name);
    linkify(body, t);
    if (ytId(t)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn quiet ytgo';
      b.textContent = 'Watch together';
      b.addEventListener('click', () => { ytWatch(t); if (matchMedia('(max-width: 699px)').matches) chatOpen(false); });
      body.appendChild(b);
    }
    if (!mine) incoming(name, ': ' + t);
    // A message that is just a link (not YouTube, which has Watch together): a banner with an Open button.
    const only = String(t).trim().match(/^https?:\/\/[^\s<>"']+$/);
    if (!mine && only && !ytId(t)) linkBanner(name, only[0]);
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
    p.dataset.chat = name ? '1' : ''; // a message preview opens the chat when tapped; a tip just goes away
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
    chatPost(t);
    if (ytId(t) && ytWatch(t) && matchMedia('(max-width: 699px)').matches) chatOpen(false);
  }
  function chatPost(t) {
    const msg = { t: 'chat', id: rid(), text: t };
    if (isGuest) tell(G.conn, msg);
    else toGuests({ ...msg, from: H.me, name: myName() });
    chatAdd(true, '', t);
  }
  function chatReset() {
    linkBanner('');
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

  // ---------- RING ----------
  // Rings the other person's devices when Beside is closed there. In a browser each device says yes once
  // ("Let Beside ring me": a web push, kept by the board's server for this room). In the Beside iPhone and iPad
  // app the ring is a real incoming call, and the app hands its device code over by itself (window.BesideNative).
  // Tapping the ring opens Beside with ?answer=1, which joins (guest) or starts the call (host) straight away.
  const RG = { busy: false, until: 0 };
  const ringBase = () => (srv ? 'http://' + srv : '') + '/peerjs/board/' + boardRoom();
  const ringRole = () => (isGuest ? 'guest' : 'host');
  function ringOpen() { return isGuest ? location.origin + location.pathname + location.hash : location.origin + location.pathname + '?room=' + hostCode(); }
  function ringPost(path, o) {
    return fetch(ringBase() + path, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) })
      .then(async (r) => { if (!r.ok) throw new Error((await r.text()) || 'The ring server didn’t answer.'); return r.json(); });
  }
  const NATIVE = () => window.BesideNative && window.BesideNative.app === 'ios';
  function ringStandaloneNeeded() {
    return IS_IOS && !navigator.standalone && !(window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  }
  const ringKey = () => 'beside.ring.' + boardRoom() + '.' + ringRole();
  function ringMeUi() {
    const on = !!store.get(ringKey());
    document.querySelectorAll('.ring-me').forEach((b) => {
      b.hidden = NATIVE();
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      const t = b.querySelector('span') || b;
      t.textContent = on ? 'Beside rings this device' : 'Let Beside ring me';
    });
  }
  function b64uBytes(s) {
    const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
    return Uint8Array.from(b, (c) => c.charCodeAt(0));
  }
  async function ringSw() {
    if (!('serviceWorker' in navigator)) return null;
    try { await navigator.serviceWorker.register('sw.js'); return await navigator.serviceWorker.ready; } catch (e) { return null; }
  }
  async function ringMe() {
    if (RG.busy) return;
    if (store.get(ringKey())) { // on: turn it off
      RG.busy = true;
      try {
        await ringPost('/push', { off: true, endpoint: store.get(ringKey()) });
        store.set(ringKey(), '');
        note('Beside won’t ring this device any more.', 'info');
      } catch (e) { note(e.message, 'info'); }
      RG.busy = false;
      ringMeUi();
      return;
    }
    if (ringStandaloneNeeded()) { note('On iPhone and iPad, rings need Beside on your Home Screen. Tap Share, then Add to Home Screen, open Beside from there and tap this again.', 'stay'); return; }
    if (!('PushManager' in window) || !('Notification' in window) || !('serviceWorker' in navigator)) { note('This browser can’t ring. Use Chrome, Firefox, Safari on a Mac, or Beside from the iPhone Home Screen.', 'stay'); return; }
    RG.busy = true;
    try {
      const perm = await Notification.requestPermission(); // first, while the tap still counts
      if (perm !== 'granted') throw new Error('Rings need notifications. Turn them on for Beside in Settings, then tap this again.');
      const k = await fetch((srv ? 'http://' + srv : '') + '/peerjs/push/key', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({}));
      if (!k.key) throw new Error('Rings aren’t switched on at Beside’s server yet.');
      const reg = await ringSw();
      if (!reg) throw new Error('This browser can’t ring.');
      let s = await reg.pushManager.getSubscription();
      if (s && s.options && s.options.applicationServerKey) {
        const had = new Uint8Array(s.options.applicationServerKey), want = b64uBytes(k.key);
        if (had.length !== want.length || had.some((x, i) => x !== want[i])) { await s.unsubscribe().catch(() => {}); s = null; }
      }
      if (!s) s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(k.key) });
      const j = s.toJSON();
      await ringPost('/push', { role: ringRole(), name: boardName(), open: ringOpen(), web: { endpoint: j.endpoint, keys: j.keys } });
      store.set(ringKey(), j.endpoint);
      note('Done. When ' + (isGuest ? (theirName || 'they') : 'your person') + ' rings, this device will too.', 'info');
    } catch (e) { note(e.message || 'That didn’t work. Try again.', 'stay'); }
    RG.busy = false;
    ringMeUi();
  }
  // The Beside app's device code: handed over quietly, again whenever it or the room changes.
  function ringNative() {
    const n = window.BesideNative;
    if (!n || !n.voip || !/^[0-9a-f]{64,200}$/.test(n.voip)) return;
    if (!isGuest && !store.get('beside.room.linked')) return; // not yet given a link: no room of its own to ring
    const alert = typeof n.alert === 'string' && /^[0-9a-f]{64,200}$/.test(n.alert) ? n.alert : '';
    const mark = n.voip + '|' + alert + '|' + boardRoom() + '|' + ringRole() + '|' + boardName();
    if (store.get('beside.voip.sent') === mark) return;
    ringPost('/push', { role: ringRole(), name: boardName(), open: ringOpen(), voip: n.voip, alert: alert || undefined, env: n.env === 'sandbox' ? 'sandbox' : 'production' })
      .then(() => store.set('beside.voip.sent', mark)).catch(() => {});
  }
  async function ringThem(btn) {
    if (Date.now() < RG.until) { note('Still ringing…', 'info'); return; }
    RG.until = Date.now() + 8000;
    if (btn) btn.disabled = true;
    try {
      const j = await ringPost('/ring', { role: ringRole(), name: isGuest ? boardName() : (myName() || 'Your person') });
      const who = isGuest ? (theirName || 'them') : ((j.names && j.names[0]) || 'them');
      if (j.sent > 0) { note('Ringing ' + who + '…', 'info'); ringHop(); }
      else if (j.devices > 0) note('The ring couldn’t reach ' + who + '’s device. Try again in a minute, or send them a message.', 'stay');
      else note((isGuest && theirName ? theirName + ' hasn’t' : 'They haven’t') + ' let Beside ring them yet. ' + (isGuest ? 'Send them a message instead.' : 'Send the link instead.'), 'stay');
    } catch (e) { note(e.message || 'The ring didn’t go through. Try again.', 'stay'); }
    setTimeout(() => { if (btn) btn.disabled = false; }, 8000);
  }
  function ringAnswer() {
    let q;
    try { q = new URLSearchParams(location.search); } catch (e) { return; }
    if (q.get('answer') !== '1') return;
    q.delete('answer');
    const qs2 = q.toString();
    try { history.replaceState(null, '', location.pathname + (qs2 ? '?' + qs2 : '') + location.hash); } catch (e) {}
    setTimeout(ringAnswerNow, 600); // after the "is another tab live?" answer
  }
  function ringAnswerNow() {
    if (isGuest) { if (app.state === 'ended') show('join'); if (app.state === 'join') guestJoin(true); }
    else if (app.state === 'idle' || app.state === 'ended') hostStart(store.get('beside.start') === 'video' ? 'video' : 'voice');
  }
  // A "rings on" flag is only a note: at each start, hand the browser's current subscription to the server again
  // (it may have changed, or been dropped as gone), or clear the flag if there is none.
  async function ringRecheck() {
    if (NATIVE() || !store.get(ringKey()) || !('Notification' in window) || Notification.permission !== 'granted') {
      if (store.get(ringKey()) && 'Notification' in window && Notification.permission === 'denied') { store.set(ringKey(), ''); ringMeUi(); }
      return;
    }
    try {
      const reg = await ringSw();
      const s = reg && await reg.pushManager.getSubscription();
      if (!s) { store.set(ringKey(), ''); ringMeUi(); return; }
      const j = s.toJSON();
      await ringPost('/push', { role: ringRole(), name: boardName(), open: ringOpen(), web: { endpoint: j.endpoint, keys: j.keys } });
      store.set(ringKey(), j.endpoint);
    } catch (e) { /* offline: try again next time */ }
  }
  // The Beside app opens at sitbeside.pages.dev with no link: ask for the link once, so it knows its room.
  function ringLinkAsk() {
    const box = $('linkAsk');
    if (!box) return;
    box.hidden = !(NATIVE() && !isGuest && !store.get('beside.room.linked'));
  }
  function ringLinkGo() {
    const v = String(($('linkAskInput') || {}).value || '').trim();
    let u = null;
    try { u = new URL(v); } catch (e) {}
    const ok = u && (u.host === location.host) && (/^#[a-z0-9]{8}/.test(u.hash) || /^[a-z0-9]{8}$/.test(u.searchParams.get('room') || ''));
    if (!ok) { note('That isn’t a Beside link. It looks like ' + location.host + '/#abcd1234-Mo or ' + location.host + '/?room=abcd1234.', 'stay'); return; }
    location.href = u.href;
    if (u.pathname === location.pathname && u.search === location.search) location.reload(); // only the #part changed
  }
  function ringBoot() {
    on('linkAskGo', 'click', ringLinkGo);
    on('linkAskInput', 'keydown', (e) => { if (e.key === 'Enter') ringLinkGo(); });
    ringLinkAsk();
    window.addEventListener('besidenative', ringLinkAsk);
    document.querySelectorAll('.ring-me').forEach((b) => b.addEventListener('click', ringMe));
    on('ringBtn', 'click', (e) => ringThem(e.currentTarget));
    on('gRingBtn', 'click', (e) => ringThem(e.currentTarget));
    if (theirName) text('gRingBtn', 'Ring ' + theirName);
    ringMeUi();
    ringNative();
    window.addEventListener('besidenative', () => { ringMeUi(); ringNative(); });
    on('nameInput', 'change', ringNative);
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => {
      const d = e.data;
      if (!d || d.beside !== 'answer') return;
      if (!d.url) { if (d.fresh) ringAnswerNow(); return; } // no link said: this page
      let u = null;
      try { u = new URL(d.url, location.href); } catch (x) {}
      const m = u && u.hash.slice(1).match(/^([a-z0-9]{8})/);
      const here = u && (isGuest ? !!m && m[1] === guestCode : !m && (u.searchParams.get('room') || hostCode()) === hostCode());
      if (here) { if (d.fresh) ringAnswerNow(); }
      else if (u) location.href = u.href; // a ring for another room or role: open that one
    });
    ringRecheck();
    ringAnswer();
  }

  // ---------- WATCH YOUTUBE TOGETHER ----------
  // Paste a YouTube link in the chat (or press Watch together under one): it opens for everyone in the call, and
  // play, pause and jumps follow on every screen within about a second. Each screen plays YouTube itself, so it's
  // full quality and nothing is re-streamed. If someone leaves the call or leaves Beside (locks the phone, switches
  // app or tab), it pauses for everyone and says who; anyone still here can tap Keep playing. Whoever comes back
  // lands where it is now. The host passes the state on, and tells newcomers.
  const YT_RE = /(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|shorts\/|live\/|embed\/)|youtu\.be\/|youtube-nocookie\.com\/embed\/)([\w-]{11})/;
  function ytId(t) { const m = String(t || '').match(YT_RE); return m ? m[1] : ''; }
  function ytStartAt(t) {
    const m = String(t || '').match(/[?&#](?:t|start)=(\d+h)?(\d+m)?(\d+)?s?(?=[&#\s]|$)/);
    if (!m) return 0;
    return (parseInt(m[1] || 0, 10) * 3600) + (parseInt(m[2] || 0, 10) * 60) + parseInt(m[3] || 0, 10);
  }
  function meName() { return isGuest ? cleanName(store.get('beside.name') || '') : myName(); }
  function ytWant() { return Math.max(0, W.at + (W.play ? (performance.now() - W.stamp) / 1000 : 0)); }
  function ytNow() { try { return W.p && W.ready ? W.p.getCurrentTime() || 0 : ytWant(); } catch (e) { return ytWant(); } }
  function ytMsg() { return { t: 'yt', id: W.id, at: Math.round(ytWant() * 10) / 10, play: W.play, away: W.away }; }
  function ytApi() {
    if (W.api) return W.api;
    W.api = new Promise((res, rej) => {
      if (window.YT && window.YT.Player) { res(); return; }
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { try { if (prev) prev(); } catch (e) {} res(); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => { W.api = null; rej(new Error('yt')); };
      document.head.appendChild(s);
      setTimeout(() => { if (!(window.YT && window.YT.Player)) { W.api = null; rej(new Error('yt')); } }, 15000);
    });
    return W.api;
  }
  // Anyone in the call: start, change or stop. Everyone else follows.
  function ytSend(s) {
    if (!inCallWithSomeone() && !W.id && s.id) { note('Start a call first, then share a YouTube link.', 'info'); return; }
    W.id = s.id; W.at = Math.max(0, +s.at || 0); W.play = !!s.play; W.stamp = performance.now(); W.away = s.away || '';
    const msg = { ...ytMsg(), by: meName() };
    if (isGuest) tell(G.conn, msg); else toGuests(msg);
    ytShow();
  }
  function ytWatch(text) {
    const id = ytId(text);
    if (!id) return false;
    ytSend({ id, at: ytStartAt(text), play: true });
    return true;
  }
  // A state from someone else (guest: from the host; host: from a guest, then passed on).
  function ytApply(d) {
    const id = typeof d.id === 'string' && /^[\w-]{11}$/.test(d.id) ? d.id : '';
    if (!id) { ytClose(true); return; }
    W.id = id; W.at = Math.max(0, Math.min(+d.at || 0, 864000)); W.play = !!d.play; W.stamp = performance.now();
    W.away = cleanName(d.away);
    ytShow();
  }
  function ytShow() {
    const box = $('ytBox');
    if (!box) return;
    if (!W.id) { ytClose(true); return; }
    if (box.hidden) { box.hidden = false; layout(); }
    clearInterval(W.timer);
    W.timer = setInterval(() => ytSync(false), 2000);
    ytBar();
    if (W.p && W.pid === W.id) { ytSync(true); return; }
    ytLoad();
  }
  async function ytLoad() {
    const id = W.id;
    try { await ytApi(); } catch (e) { if (W.id === id) note('YouTube didn’t load. Check the internet connection, then share the link again.', 'info'); return; }
    if (W.id !== id || (W.p && W.pid === id)) return;
    if (W.p) { try { W.p.destroy(); } catch (e) {} W.p = null; }
    const spot = $('ytFrame');
    if (!spot) return;
    spot.textContent = '';
    const el = document.createElement('div');
    spot.appendChild(el);
    W.ready = false;
    W.pid = id;
    W.quiet = performance.now() + 4000;
    W.p = new window.YT.Player(el, {
      videoId: id,
      width: '100%', height: '100%',
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1, start: Math.floor(ytWant()), autoplay: W.play ? 1 : 0 },
      events: {
        onReady: () => { if (W.pid !== id) return; W.ready = true; W.vol = -1; ytVolume(); outWatch(); ytSync(true); },
        onStateChange: (e) => ytState(e.data),
        onError: (e) => { if (W.pid === id) ytBar(e && (e.data === 101 || e.data === 150) ? 'This video can’t play here: its owner only allows it on YouTube.' : 'YouTube couldn’t play this video.'); },
      },
    });
  }
  // Bring this screen to the shared state. Small differences (under 1.5 s) are left alone, so it never stutters.
  function ytSync(force) {
    const p = W.p;
    if (!p || !W.ready || !W.id) return;
    let st = -1, cur = 0;
    try { st = p.getPlayerState(); cur = p.getCurrentTime() || 0; } catch (e) { return; }
    const want = ytWant();
    if (force || Math.abs(cur - want) > 1.5) { W.quiet = performance.now() + 1500; try { p.seekTo(want, true); } catch (e) {} }
    if (W.play && st !== 1 && st !== 3) {
      W.quiet = performance.now() + 1500;
      try { p.playVideo(); } catch (e) {}
      // iPhone and iPad only let a video start after a tap on it, the first time.
      clearTimeout(W.tap);
      W.tap = setTimeout(() => { try { if (W.play && W.p && W.p.getPlayerState() !== 1 && W.p.getPlayerState() !== 3) ytBar('Tap the video once to join in.'); } catch (e) {} }, 2500);
    } else if (!W.play && (st === 1 || st === 3)) { W.quiet = performance.now() + 1500; try { p.pauseVideo(); } catch (e) {} }
  }
  // Someone on this screen pressed play, pause, or jumped: tell everyone. Our own syncing matches the shared state,
  // so it's never sent back. Right after our own start or jump, a lag behind it or a refused start (iPhone) isn't
  // a choice, so it isn't sent either: this screen catches up instead.
  function ytState(st) {
    if (!W.p || !W.ready) return;
    if (st === 1) { clearTimeout(W.tap); ytBar(); }
    if (document.hidden) return;
    const cur = ytNow(), off = cur - ytWant(), settling = performance.now() < W.quiet;
    if (st === 1) {
      if (!W.play) ytSend({ id: W.id, at: cur, play: true });
      else if (Math.abs(off) > 1.5) { if (off < 0 && settling) ytSync(false); else ytSend({ id: W.id, at: cur, play: true }); }
    } else if (st === 2 || st === 0) {
      if (W.play ? !settling : Math.abs(off) > 1.5) ytSend({ id: W.id, at: cur, play: false });
    }
  }
  // Leaving pauses it for everyone, unless they choose to keep playing.
  function ytAway(who) {
    if (!W.id || !W.play) return;
    W.at = ytNow(); W.play = false; W.stamp = performance.now(); W.away = cleanName(who) || 'Someone';
    ytSync(false);
    ytBar();
  }
  function ytBar(msg) {
    const n = $('ytNote'), k = $('ytKeep');
    if (!n || !k) return;
    const away = !W.play && W.away && W.away !== meName();
    n.textContent = msg || (away ? 'Paused: ' + W.away + ' left.' : '');
    k.hidden = !away || !!msg;
  }
  function ytClose(remote) {
    const had = !!W.id;
    W.id = ''; W.play = false; W.away = '';
    clearInterval(W.timer); clearTimeout(W.tap);
    if (W.p) { try { W.p.destroy(); } catch (e) {} }
    W.p = null; W.pid = ''; W.ready = false;
    const f = $('ytFrame');
    if (f) f.textContent = '';
    const box = $('ytBox');
    if (box && !box.hidden) { box.hidden = true; layout(); }
    if (had && !remote) {
      const msg = { t: 'yt', id: '', by: meName() };
      if (isGuest) tell(G.conn, msg); else toGuests(msg);
    }
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
            // (from up to half a second back, so a hidden tab's slow timers don't crawl it to 16 KB/s)
            q.nextAt = Math.max(Date.now() - 500, q.nextAt) + (b.byteLength / (someoneShares() ? 250000 : 1000000)) * 1000;
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
    if (isGuest) r.parts = []; // the Blob holds the bytes now; the host keeps parts only while relays read them
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
    if (!rate(g, 'chatT', 10)) return;
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

  // ---------- SHARE ----------
  // One Share button in every call, on every device. Its sheet offers only what works here, and says in one
  // sentence why anything else doesn't: a link (YouTube plays together; in the Beside iPhone and iPad app other
  // pages open in its own browser and they see that page live; elsewhere the link goes to the chat with an Open
  // button), a photo or video (drawn on a canvas that rides the screen lane), a file (the chat), and on a computer
  // the screen itself. Only Beside's own picture is ever sent: never the whole screen, never notifications.
  const CV = { kind: '', canvas: null, x: null, stream: null, timer: 0, url: '', media: null, snd: null, sound: false, img: null, decoding: false, frames: 0 };
  const LB = { url: '', timer: 0 };
  // The Beside app (Shell.swift) says it has the in-app browser with BesideNative.browse.
  function canBrowse() { return NATIVE() && !!window.BesideNative.browse && CAN_LANE; }
  function nativeSay(msg) {
    try { const mh = window.webkit && window.webkit.messageHandlers; if (mh && mh.beside) { mh.beside.postMessage(msg); return true; } } catch (e) {}
    return false;
  }
  function shareIsOpen() { const m = $('shareSheet'); return !!m && !m.hidden; }
  function shareOpen(on) {
    const m = $('shareSheet');
    if (!m) return;
    if (!on) { if (!m.hidden) { m.hidden = true; const b = $(isGuest ? 'gScreenBtn' : 'screenBtn'); if (b && !b.hidden) b.focus(); } return; }
    closeMore();
    shareRender();
    m.hidden = false;
    wakeControls();
    const x = $('shareClose');
    if (x) x.focus();
  }
  // What this device can share now. '' means it can; otherwise the one sentence the sheet shows instead.
  function shareWhy() {
    const someone = inCallWithSomeone();
    const lane = isGuest ? !!G.screenSender && G.hostVer >= 2 : true;
    const wait = 'You can share this once they’re in the call.';
    const old = 'Their Beside is out of date. Ask them to reload the page, then try again.';
    return {
      link: !someone ? wait : '',
      media: !CAN_LANE ? 'This browser can’t show a photo or video live. Send it as a file instead.'
        : !lane ? old : !someone ? wait : '',
      file: !someone ? wait : !chatAvailable() ? old : '',
      screen: CAN_SHARE ? (isGuest && !G.screenSender ? old : !someone && isGuest ? wait : '')
        : IS_IOS ? 'iPhone and iPad can’t share their screen. A link, a photo or a video works instead.'
          : 'Sharing your screen needs Chrome on a computer.',
    };
  }
  // The video's sound has a lane to everyone (an old host's guest has none).
  function soundLane() { return isGuest ? !!G.mediaSender && G.hostVer >= 3 && !!G.ctx : !!H.ctx; }
  function soundWhy() {
    if (soundLane()) return 'Videos play with their sound.';
    return isGuest && IS_IOS ? 'Videos you share from an iPhone or iPad play without sound.' : 'Videos play without sound, because their Beside is out of date.';
  }
  function shareRender() {
    const why = shareWhy();
    const set = (opt, btn, whyId, reason, ok) => {
      const b = $(btn);
      if (b) b.disabled = !!reason;
      text(whyId, reason || ok);
      const o = $(opt);
      if (o) o.classList.toggle('off', !!reason);
    };
    set('shareLinkOpt', 'shareLinkGo', 'shareLinkWhy', why.link, canBrowse()
      ? 'YouTube links play together. Other pages open here, and they see them live. Videos inside web pages show as still pictures, so use YouTube for videos.'
      : 'YouTube links play together. Other links go to the chat, and they get an Open button.');
    const inp = $('shareLinkInput');
    if (inp) inp.disabled = !!why.link;
    const paste = $('sharePaste');
    if (paste) paste.hidden = !!why.link || !(navigator.clipboard && navigator.clipboard.readText);
    set('shareMediaOpt', 'shareMediaBtn', 'shareMediaWhy', why.media, 'They see it full size. ' + soundWhy());
    set('shareFileOpt', 'shareFileBtn', 'shareFileWhy', why.file, 'It goes to the chat. Files up to 25 MB.');
    // My screen: only where it works. Elsewhere the sheet just says why.
    const sb = $('shareScreen');
    if (sb) { sb.hidden = !CAN_SHARE; sb.disabled = !!why.screen; }
    text('shareScreenWhy', why.screen || 'Shows one tab or one window. Never the whole screen.');
  }
  // A pasted link: the address itself, or the first link inside some pasted words. "example.com" gets https://.
  function shareUrl(raw) {
    const t = String(raw || '').trim();
    let u = (t.match(/https?:\/\/[^\s<>"']+/i) || [''])[0];
    if (!u) u = t.split(/\s+/).find((w) => /^[\w-]+(\.[\w-]+)*\.[a-z]{2,}(:\d+)?([/?#]\S*)?$/i.test(w)) || '';
    if (u && !/^https?:/i.test(u)) u = 'https://' + u;
    u = u.replace(/[.,!?;:)\]]+$/, '');
    if (!u) return '';
    try { const x = new URL(u); return /^https?:$/.test(x.protocol) && x.hostname ? x.href : ''; } catch (e) { return ''; }
  }
  function shareLinkGo() {
    const inp = $('shareLinkInput');
    const why = shareWhy();
    if (why.link) { text('shareLinkWhy', why.link); return; }
    const u = shareUrl(inp && inp.value);
    if (!u) { text('shareLinkWhy', 'That isn’t a link. Copy the page’s address, then tap Paste.'); return; }
    if (inp) inp.value = '';
    shareOpen(false);
    if (ytId(u)) {
      ytWatch(u);
      if (chatAvailable()) chatPost(u);
      return;
    }
    if (canBrowse() && !why.media) { shareBrowse(u); return; }
    if (!chatAvailable()) { note('Their Beside is out of date, so the link can’t go. Ask them to reload the page.', 'info'); return; }
    chatPost(u);
    note('Link sent. They can open it from the chat.', 'info');
  }
  async function sharePaste() {
    const inp = $('shareLinkInput');
    try {
      const t = await navigator.clipboard.readText();
      if (inp) inp.value = (t || '').trim();
      if (!shareUrl(t)) text('shareLinkWhy', 'There’s no link to paste. Copy the page’s address first.');
    } catch (e) {
      text('shareLinkWhy', 'Paste isn’t allowed here. Tap the box, then paste the link into it.');
      if (inp) inp.focus();
    }
  }
  // The picture of a share: a canvas (in the page, too small to see) sent as the screen lane.
  function canvasMake(kind, w, h, fps) {
    canvasStop();
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.setAttribute('aria-hidden', 'true');
    c.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
    const x = c.getContext('2d');
    if (!x) return null;
    x.fillStyle = '#000';
    x.fillRect(0, 0, w, h);
    let s = null;
    try { s = c.captureStream(fps); } catch (e) { s = null; }
    if (!s || !s.getVideoTracks()[0]) return null;
    document.body.appendChild(c);
    Object.assign(CV, { kind, canvas: c, x, stream: s, frames: 0 });
    return s;
  }
  // Ends the canvas share's own parts (timers, the video, the in-app browser). The call's lanes are put back by
  // hostUnshare or guestUnshare. fromApp: the app's browser closed itself, so it isn't told again.
  function canvasStop(fromApp) {
    if (!CV.kind) return;
    const kind = CV.kind;
    clearInterval(CV.timer);
    if (CV.media) { try { CV.media.pause(); CV.media.removeAttribute('src'); CV.media.load(); } catch (e) {} }
    if (CV.snd) { [CV.snd.src, CV.snd.dest].forEach((n) => { try { n.disconnect(); } catch (e) {} }); }
    if (CV.stream) CV.stream.getTracks().forEach((t) => t.stop());
    if (CV.canvas) CV.canvas.remove();
    if (CV.url) URL.revokeObjectURL(CV.url);
    Object.assign(CV, { kind: '', canvas: null, x: null, stream: null, timer: 0, url: '', media: null, snd: null, sound: false, img: null, decoding: false, frames: 0 });
    if (kind === 'browse' && !fromApp) nativeSay({ t: 'browse', on: false });
  }
  // Fits a picture of w×h into at most 1280 on its long side.
  function fitSize(w, h) {
    const k = Math.min(1, 1280 / Math.max(w || 1, h || 1));
    return [Math.max(2, Math.round((w || 16) * k / 2) * 2), Math.max(2, Math.round((h || 9) * k / 2) * 2)];
  }
  function canvasDraw(src, sw, sh) {
    const c = CV.canvas, x = CV.x;
    if (!c || !x || !sw || !sh) return;
    const k = Math.min(c.width / sw, c.height / sh);
    const w = sw * k, h = sh * k;
    x.fillStyle = '#000';
    x.fillRect(0, 0, c.width, c.height);
    try { x.drawImage(src, (c.width - w) / 2, (c.height - h) / 2, w, h); CV.frames++; } catch (e) {}
  }
  function canvasWords(words) {
    const c = CV.canvas, x = CV.x;
    if (!c || !x) return;
    x.fillStyle = '#201A13';
    x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = '#F0E7D8';
    x.font = '600 ' + Math.round(c.width / 22) + 'px -apple-system, system-ui, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText(words, c.width / 2, c.height / 2);
  }
  // Whatever the canvas shows goes out on the screen lane, as a shared tab would.
  function shareStream(s) {
    if (isGuest) guestUse(s);
    else if (app.state === 'live') useDisplay(s);
    else { canvasStop(); return; }
    layout();
  }
  function sharePick(file) {
    if (!file) return;
    const why = shareWhy();
    if (why.media) { note(why.media, 'info'); return; }
    if (/^video\//.test(file.type || '') || /\.(mov|mp4|m4v|webm)$/i.test(file.name || '')) shareVideo(file);
    else sharePhoto(file);
  }
  async function sharePhoto(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    try {
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    } catch (e) {
      URL.revokeObjectURL(url);
      note('This photo can’t be shown here. Try another one, or send it as a file.', 'info');
      return;
    }
    const [w, h] = fitSize(img.naturalWidth, img.naturalHeight);
    const s = canvasMake('photo', w, h, 5);
    if (!s) { URL.revokeObjectURL(url); note('This browser can’t show a photo live. Send it as a file instead.', 'info'); return; }
    CV.url = url;
    // Scaled down once, so each redraw is cheap (a phone photo can be 48 megapixels).
    const pre = document.createElement('canvas'); pre.width = w; pre.height = h;
    try { pre.getContext('2d').drawImage(img, 0, 0, w, h); } catch (e) {}
    CV.img = pre;
    const draw = () => canvasDraw(pre, w, h);
    draw();
    CV.timer = setInterval(draw, 250); // drawn again a few times a second, so the picture keeps arriving
    shareStream(s);
  }
  async function shareVideo(file) {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.preload = 'auto';
    v.src = url;
    const loaded = new Promise((res, rej) => {
      v.addEventListener('loadeddata', res, { once: true });
      v.addEventListener('error', rej, { once: true });
      setTimeout(rej, 15000);
    });
    // iPhone only loads a video once it plays. Started straight after the pick, so it may play with sound.
    let quiet = false;
    try { await v.play(); } catch (e) {
      if (e && e.name === 'NotAllowedError') { v.muted = true; quiet = true; try { await v.play(); } catch (e2) {} }
    }
    try { await loaded; } catch (e) {
      try { v.pause(); } catch (e2) {}
      URL.revokeObjectURL(url);
      note('This video can’t play here. Try another one, or send it as a file.', 'info');
      return;
    }
    const [w, h] = fitSize(v.videoWidth, v.videoHeight);
    const s = canvasMake('video', w, h, 30);
    if (!s) { v.pause(); URL.revokeObjectURL(url); note('This browser can’t show a video live. Send it as a file instead.', 'info'); return; }
    CV.url = url;
    CV.media = v;
    // Its sound: through the call's audio engine to the video-sound lane, and to your own speaker.
    const ctx = isGuest ? G.ctx : H.ctx;
    if (soundLane() && ctx) {
      try {
        const src = ctx.createMediaElementSource(v);
        const dest = ctx.createMediaStreamDestination();
        src.connect(dest);
        src.connect(ctx.destination);
        CV.snd = { src, dest };
        const a = dest.stream.getAudioTracks()[0];
        if (a) { s.addTrack(a); CV.sound = true; }
      } catch (e) { CV.snd = null; }
    }
    if (!CV.sound) v.muted = true;
    // Safari has no video.captureStream: each frame is drawn onto the canvas instead.
    CV.timer = setInterval(() => { if (v.readyState >= 2) canvasDraw(v, v.videoWidth, v.videoHeight); }, 33);
    v.addEventListener('ended', () => layout());
    shareStream(s);
    if (!soundLane()) note(soundWhy(), 'info');
    else if (quiet && CV.sound) note('The video is playing without sound. Tap it twice to play it with sound.', 'info');
  }
  function videoToggle() {
    const v = CV.media;
    if (!v) return;
    if (v.paused || v.ended) { v.muted = !CV.sound; v.play().catch(() => {}); } else v.pause();
    setTimeout(layout, 50);
  }
  // A web page in the app's own browser: the app sends snapshots of only that browser (window.__besideFrame).
  function shareBrowse(u) {
    if (CV.kind === 'browse' && amSharing()) { nativeSay({ t: 'browse', on: true, url: u }); return; }
    const s = canvasMake('browse', 960, 540, 10);
    if (!s) { note('This can’t share a web page live. The link went to the chat instead.', 'info'); chatPost(u); return; }
    canvasWords('Opening the page…');
    // Until the first picture comes, and to keep the lane alive if the page sits still.
    CV.timer = setInterval(() => { if (!CV.frames) canvasWords('Opening the page…'); else if (CV.img && CV.img.complete && !CV.decoding) { try { CV.x.drawImage(CV.img, 0, 0); } catch (e) {} } }, 500);
    if (!nativeSay({ t: 'browse', on: true, url: u })) { canvasStop(true); chatPost(u); return; }
    shareStream(s);
  }
  // From the app: one snapshot of its browser, a base64 JPEG. Drawn as it is; a frame that comes while the last
  // one is still being read is skipped, so the call never falls behind.
  window.__besideFrame = function (b64) {
    if (CV.kind !== 'browse' || !CV.canvas || CV.decoding || typeof b64 !== 'string') return false;
    CV.decoding = true;
    const img = CV.img || (CV.img = new Image());
    img.src = 'data:image/jpeg;base64,' + b64;
    // Decoded away from the page's main work, then drawn.
    const dec = img.decode ? img.decode() : new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    dec.then(() => {
      CV.decoding = false;
      const c = CV.canvas;
      if (CV.kind !== 'browse' || !c) return;
      const w = img.naturalWidth, h = img.naturalHeight;
      if (!w || !h) return;
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      try { CV.x.drawImage(img, 0, 0); CV.frames++; } catch (e) {}
    }, () => { CV.decoding = false; });
    return true;
  };
  // From the app: its browser's Stop sharing was pressed.
  window.__besideBrowse = function (what) {
    if (what !== 'stop' || CV.kind !== 'browse') return;
    canvasStop(true);
    shareStop();
  };
  function shareStop() {
    if (isGuest) guestUnshare(); else hostUnshare();
  }
  // The dock's Share button: "Share" opens the sheet; while you share it says Stop sharing ("Stop" on a phone).
  function shareBtns() {
    const on = amSharing();
    ['screenBtn', 'gScreenBtn'].forEach((id) => {
      const el = $(id);
      if (!el) return;
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
      el.setAttribute('aria-label', on ? 'Stop sharing' : 'Share');
      el.title = on ? 'Stop sharing' : 'Share a link, a photo, a video or a file';
      const lab = el.querySelector('.label-t');
      if (lab) lab.innerHTML = on ? 'Stop<span class="w"> sharing</span>' : 'Share';
    });
  }
  function shareWhat(track) {
    if (CV.kind && CV.stream && track && CV.stream.getVideoTracks()[0] === track) {
      if (CV.kind === 'video') return CV.media && (CV.media.paused || CV.media.ended) ? 'Your video is paused. Tap it to play.' : 'You’re sharing a video. Tap it to pause.';
      return CV.kind === 'photo' ? 'You’re sharing a photo' : 'You’re sharing a web page';
    }
    return 'You’re sharing ' + surfaceName(track);
  }
  // Someone sent a link in the chat: a banner with an Open button (a browser only opens a new tab after a tap).
  function linkBanner(name, url) {
    const b = $('linkBanner');
    if (!b) return;
    clearTimeout(LB.timer);
    if (!url) { b.hidden = true; LB.url = ''; return; }
    LB.url = url;
    let where = url;
    try { where = new URL(url).hostname.replace(/^www\./, ''); } catch (e) {}
    text('linkBannerWho', name || 'They');
    text('linkBannerUrl', where);
    b.hidden = false;
    LB.timer = setTimeout(() => { b.hidden = true; }, 30000);
  }
  function linkBannerOpen() {
    const u = LB.url;
    linkBanner('');
    if (u) { try { window.open(u, '_blank', 'noopener'); } catch (e) {} }
  }
  function shareWire() {
    on('shareClose', 'click', () => shareOpen(false));
    on('shareSheet', 'click', (e) => { if (e.target === $('shareSheet')) shareOpen(false); });
    on('shareLinkForm', 'submit', (e) => { e.preventDefault(); shareLinkGo(); });
    on('sharePaste', 'click', sharePaste);
    on('shareMediaBtn', 'click', () => { const f = $('shareMediaInput'); if (f) f.click(); });
    on('shareMediaInput', 'change', (e) => { const f = e.target; const file = f.files && f.files[0]; f.value = ''; shareOpen(false); sharePick(file); });
    on('shareFileBtn', 'click', () => { shareOpen(false); chatOpen(true); const f = $('fileInput'); if (f) f.click(); });
    on('shareScreen', 'click', () => { shareOpen(false); if (isGuest) guestShare(); else hostShare(); });
    on('linkBannerOpen', 'click', linkBannerOpen);
    on('linkBannerClose', 'click', () => linkBanner(''));
  }

  // ---------- HOST ----------
  // Mo starts a call with one tap; nothing is shared until Share screen. Every lane of the call exists from the
  // first offer ([audio, screen, camera]); a blank track holds a lane while it has nothing to carry.
  const H = {
    peer: null, spare: null, code: '', me: '', video: null, display: null, mic: null, ctx: null, sink: null, silent: null,
    micGain: null, micAn: null, mediaSrc: null, mediaTrack: null, guests: new Map(), knocks: new Map(), muted: false,
    mode: 'detail', lagTimer: 0, idRetries: 0, stopping: false, starting: false, changing: false, otherTabLive: false,
    blank: null, blankScreen: null, blankF: [], camSlot: null, cam: null, camBusy: false, sharer: '',
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
    ['linkText', 'moreLinkText', 'idleLinkText'].forEach((id) => {
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
  const WHOLE_SCREEN = 'Pick one tab or one app window, not the whole screen, so nothing else on your screen (like notifications) can be seen. Press Share, then My screen.';
  function displayError(e) {
    const browser = IS_CHROMIUM ? 'Chrome' : 'your browser';
    if (e && /system/i.test(e.message || '')) {
      return 'Your Mac is blocking ' + browser + ' from sharing windows. Open System Settings, Privacy & Security, Screen & System Audio Recording, turn ' + browser + ' on, then quit and reopen it. Sharing a tab works without this.';
    }
    if (e && e.name === 'NotAllowedError') {
      return IS_CHROMIUM
        ? 'Nothing was shared. Press Share, then My screen, and pick a tab or a window.'
        : 'Nothing was shared. Press Share, then My screen, choose Allow, then pick a window.';
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
  function setStartBusy(b) { ['startBtn', 'videoBtn', 'shareStartBtn', 'endedAction', 'homeRingBtn', 'callVideoBtn', 'callVoiceBtn'].forEach((id) => { const el = $(id); if (el) el.disabled = b; }); }

  // The host's audio engine: a silent sink that keeps meters measuring, a silent track for empty lanes, and the
  // mic's level control with its meter.
  function hostEngine(ctx) {
    H.ctx = ctx;
    H.ctx.resume().catch(() => {});
    H.sink = H.ctx.createGain();
    H.sink.gain.value = 0;
    H.sink.connect(H.ctx.destination);
    H.silent = silentTrack(H.ctx);
    H.micGain = H.ctx.createGain();
    H.micAn = analyser(H.micGain);
  }
  // Three ways to start: a video call, a voice call, or a call that starts by sharing a tab or window.
  async function hostStart(mode) {
    if (H.starting || app.state === 'live') return; // double click
    if (!peerLibOk()) return;
    mode = mode === 'video' || mode === 'share' ? mode : 'voice';
    if (mode === 'share' && !CAN_SHARE) { note(NO_SHARE, 'info'); return; }
    store.set('beside.start', mode);
    MV.away = false;
    moveCardHide();
    if (H.otherTabLive && !H.moveTo) {
      H.otherTabLive = false; // ask again, in case that tab has gone
      if (bc) bc.postMessage('live?');
      note(OTHER_TAB, 'stay');
      return;
    }
    H.starting = true;
    H.gen = (H.gen || 0) + 1; // this start: an answer meant for an earlier start is ignored
    H.probeAgain = false;
    H.checked = false;
    H.liveSince = 0;
    H.ownDown = false;
    setStartBusy(true);
    try {
      // Audio engine first, inside the click, so Safari lets it run. Each guest gets their own voice mix: your
      // mic plus everyone else's voice (never their own). The shared video's sound has a lane of its own.
      hostEngine(new (window.AudioContext || window.webkitAudioContext)());
      // Share my screen: pick the tab first, still inside the click (the browser needs that).
      let display = null;
      if (mode === 'share') {
        try {
          display = await getDisplay(true);
        } catch (e) {
          hostCleanup();
          note(displayError(e), e && /system/i.test(e.message || '') ? 'stay' : 'info');
          return;
        }
        if (isWholeScreen(display)) { display.getTracks().forEach((t) => t.stop()); hostCleanup(); note(WHOLE_SCREEN, 'stay'); return; }
      }
      const wantMic = !!H.moveTo || !$('micStartToggle') || $('micStartToggle').getAttribute('aria-pressed') !== 'false';
      if (wantMic) {
        try {
          H.mic = await getOwn('audio', micWant(CLEAR.mode));
          H.ctx.resume().catch(() => {}); // allowed now the page uses the mic: a tab opened from a ring has had no click
          H.mic.getAudioTracks().forEach((t) => { try { t.contentHint = CLEAR.mode === 'music' ? 'music' : 'speech'; } catch (e) {} });
          // The engine runs at the mic's own rate: a mic and an engine at different rates crackle. (Not on an
          // iPhone or iPad: the mic doesn't pass through the engine there, and the engine stays at the speaker's
          // own rate, so a headset's slower call mic never slows down everything you hear.)
          const rate = trackRate(H.mic);
          if (!SEND_RAW && rate && rate !== H.ctx.sampleRate) {
            try {
              const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: rate });
              const old = H.ctx;
              hostEngine(ctx);
              ctx.resume().catch(() => {});
              old.close().catch(() => {});
            } catch (e) {}
          }
          try { H.clear = clearChain(H.ctx, H.mic, { live: () => !H.muted }); H.clear.out.connect(H.micGain); } catch (e) {
            H.clear = null;
            H.rawSrc = H.ctx.createMediaStreamSource(H.mic);
            H.rawSrc.connect(H.micGain);
          }
        } catch (e) {
          note('Your microphone is blocked, so they can’t hear you. Click the icon at the left of the address bar, allow the microphone, then press End and start the call again.', 'stay');
        }
      }
      H.muted = !H.mic;
      H.micGain.gain.value = H.muted ? 0 : 1;
      setPressed('muteBtn', H.muted, 'Unmute my mic', 'Mute my mic');
      H.blank = blankTrack();
      H.blankScreen = blankTrack(); // more of them: one track can't ride two lanes of a call
      H.blankF = [blankTrack(), blankTrack()];
      if (!H.blank || !H.blankScreen) {
        if (display) display.getTracks().forEach((t) => t.stop());
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
      H.idRetries = 0;
      openHostPeer();
      hostListen();
      if (display) useDisplay(display);
      else if (mode === 'video') hostCam();
    } finally {
      H.starting = false;
      setStartBusy(false);
    }
  }

  function openHostPeer() {
    if (H.peer && !H.peer.destroyed) { try { H.peer.destroy(); } catch (e) {} }
    H.stopping = false;
    text('liveHint', 'Getting your link ready…');
    if (!netReady()) { const code = H.code; NET.p.then(() => { if (H.code === code && !H.stopping && app.state === 'live') openHostPeer(); }); return; }
    if (H.moveTo && !H.moveTo.sent) { H.moveTo.sent = true; H.fast = 40; text('liveHint', 'Moving the call here…'); moveAsk(); }
    // Another of my devices was live a moment ago: ask it first, before claiming the link, so this one never
    // takes the call from it (a blip on that device's line would otherwise free the link for a second or two).
    // A live device answers in well under a second; a device that has ended never answers, so wait 2 s at most.
    if (!H.moveTo && !H.checked && MV.liveAt && Date.now() - MV.liveAt < 5 * 60000) {
      H.checked = true;
      const gen = H.gen, t0 = Date.now();
      moveProbe((r) => {
        app.mv.push({ at: t0, ms: Date.now() - t0, live: r ? !!r.live : null, first: true });
        if (H.gen !== gen || app.hostReady || app.state !== 'live' || H.stopping) return;
        if (r && r.live) { hostCleanup(); show('idle'); MV.dismissed = false; moveFound(r); return; }
        openHostPeer();
      }, 2000);
      return;
    }
    let wasOpen = false;
    const peer = new Peer(PREFIX + H.code, opts());
    app.hostPeers++;
    H.peer = peer;
    peer.on('open', () => {
      if (H.peer !== peer) return;
      wasOpen = true;
      H.ownDown = false;
      MV.liveAt = 0; // the link is ours now: what was live elsewhere has ended or moved here
      if (!H.liveSince) H.liveSince = Date.now();
      H.idRetries = 0;
      H.fast = 0;
      H.moveTo = null;
      app.hostReady = true;
      // The spare link on the free server opens once the own server gave us the link (or can't be reached):
      // before that another of my devices may hold it, and a spare must never take guests for a call that isn't ours.
      if (NET.own && !H.spare) openSparePeer();
      text('liveHint', '');
      if (H.ringOnReady && Date.now() - H.ringOnReady < 30000) {
        // Ring them: if they are already waiting in the room, they come straight in, so give them a moment and
        // only ring when nobody has arrived.
        H.ringOnReady = 0;
        setTimeout(() => { if (H.peer === peer && !H.guests.size && app.state === 'live') ringThem($('ringBtn')); }, 2500);
      }
      if (bc) bc.postMessage('live!');
    });
    peer.on('connection', (conn) => {
      if (H.peer !== peer) { try { conn.close(); } catch (e) {} return; }
      if (moveConn(conn)) return;
      hostKnock(conn);
    });
    // Back on the line quickly (the link is free for anyone while we're off it), then every 1.5 s.
    let lostAt = 0;
    peer.on('disconnected', () => {
      if (H.peer !== peer || H.stopping || peer.destroyed) return;
      const quick = Date.now() - lostAt > 10000;
      lostAt = Date.now();
      setTimeout(() => {
        if (H.peer === peer && !H.stopping && !peer.destroyed && peer.disconnected) { try { peer.reconnect(); } catch (e) {} }
      }, quick ? 250 : 1500);
    });
    peer.on('error', (e) => {
      if (H.peer !== peer || H.stopping) return;
      const t = e && e.type;
      if (t === 'unavailable-id') {
        // Our own session after a Wi-Fi blip: PeerJS keeps the calls and 'disconnected' retries. If another of
        // my devices took the link during the blip, the call that started first keeps it: ask that one to step back.
        if (wasOpen) { text('liveHint', 'Reconnecting to the call server…'); askYield(); return; }
        // Moving the call here: the other device is letting go of the link right now.
        if (H.fast > 0) {
          H.fast--;
          try { peer.destroy(); } catch (e2) {}
          setTimeout(() => { if (H.peer === peer && !H.stopping && app.state === 'live') openHostPeer(); }, 250);
          return;
        }
        if (H.otherTabLive) { note(OTHER_TAB, 'stay'); hostStop(); return; }
        // Is it live on another of my devices? Then offer to move it here instead of waiting. The answer can
        // take longer than one claim attempt (2.5 s), so it belongs to this start, not to this attempt; with no
        // answer at all it asks again on the next attempt.
        if (!H.idRetries || H.probeAgain) {
          H.probeAgain = false;
          const gen = H.gen, t0 = Date.now();
          moveProbe((r) => {
            app.mv.push({ at: t0, ms: Date.now() - t0, live: r ? !!r.live : null, gen, now: H.gen, ready: !!app.hostReady, state: app.state });
            if (H.gen !== gen || app.hostReady || app.state !== 'live' || H.stopping) return;
            if (!r) { H.probeAgain = true; return; }
            if (!r.live) return;
            hostCleanup();
            show('idle');
            MV.dismissed = false;
            moveFound(r);
          });
        }
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
        // The own server is down: the spare on the free server carries the call meanwhile (there, too, the link
        // is only ours if no other device holds it).
        if (!wasOpen) H.ownDown = true;
        if (NET.own && !H.spare) openSparePeer();
        // A server that never answered leaves PeerJS destroyed: start a fresh one.
        setTimeout(() => { if (H.peer === peer && !H.stopping && app.state === 'live' && peer.destroyed) openHostPeer(); }, 3000);
      }
    });
  }

  function hostKnock(conn) {
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
  }
  // The link is also live on the free server, quietly, so a guest still on it finds us: an older copy of
  // Beside, or a network that can't reach the own server. The own server carries everything else.
  function openSparePeer() {
    if (H.spare && !H.spare.destroyed) { try { H.spare.destroy(); } catch (e) {} }
    const code = H.code;
    const peer = new Peer(PREFIX + code, opts(true));
    H.spare = peer;
    const again = (ms) => setTimeout(() => {
      if (H.spare === peer && H.code === code && !H.stopping && app.state === 'live' && (peer.destroyed || peer.disconnected)) {
        if (peer.destroyed) openSparePeer(); else { try { peer.reconnect(); } catch (e) {} }
      }
    }, ms);
    peer.on('connection', (conn) => {
      if (H.spare !== peer || (!app.hostReady && !H.ownDown)) { try { conn.close(); } catch (e) {} return; }
      if (moveConn(conn)) return;
      hostKnock(conn);
    });
    peer.on('disconnected', () => again(3000));
    // Never a message about it: a reload still holding the link there frees itself, and it's only the spare.
    peer.on('error', () => again(10000));
  }
  function guestById(id) { for (const g of H.guests.values()) if (g.id === id) return g; return null; }
  // What this guest's screen lane carries: the room's screen, except its own (no echo), else blank.
  function screenFor(g) { return (g.id === H.sharer ? null : roomTrack()) || H.blankScreen; }
  function hostAddGuest(conn) {
    const via = conn.provider || H.peer; // the server this guest came through: the own one or the spare
    if (!via || via.destroyed || !H.ctx || !H.blankScreen || H.guests.has(conn.connectionId)) return;
    for (const [k, old] of H.guests) if (old.conn.peer === conn.peer) hostDropGuest(k); // same guest reconnecting
    const g = {
      id: conn.peer, conn, call: null, audio: null, live: false, ver: 0, canShare: false, tile: null,
      screenSender: null, camSender: null, faceSenders: [], voiceSender: null, mediaSender: null,
      vdest: null, vsrc: null, an: null, voice: null, peopleSig: '', name: cleanName(conn.metadata && conn.metadata.name),
    };
    const n = $('note');
    if (n && !n.hidden && n.textContent.includes(KNOCK_FAIL.trim())) note(''); // they got through after all
    g.vdest = H.ctx.createMediaStreamDestination();
    g.vdest.channelCount = 1;
    H.micGain.connect(g.vdest);
    const voice = g.vdest.stream.getAudioTracks()[0];
    const media = mediaFor(g);
    const screen = screenFor(g);
    let call = null;
    try {
      call = via.call(conn.peer, ordered([voice, media, screen, H.camSlot].concat(H.blankF)), { sdpTransform: (sdp) => tuneOpus(preferH264(sdp)) });
    } catch (e) { call = null; }
    if (!call) { try { H.micGain.disconnect(g.vdest); } catch (e) {} try { conn.close(); } catch (e) {} return; }
    g.call = call;
    H.guests.set(conn.connectionId, g);
    rewire();
    const pc = call.peerConnection;
    if (pc) {
      // Senders are kept by role: a relayed screen is someone else's track, never look them up by track again.
      const vids = pc.getSenders().filter((s) => s.track && s.track.kind === 'video');
      const auds = pc.getSenders().filter((s) => s.track && s.track.kind === 'audio');
      g.voiceSender = pc.getSenders().find((s) => s.track === voice) || auds[0] || null;
      g.mediaSender = pc.getSenders().find((s) => s.track === media) || auds[1] || null;
      g.screenSender = pc.getSenders().find((s) => s.track === screen) || vids[0] || null;
      g.camSender = pc.getSenders().find((s) => s.track === H.camSlot) || vids[1] || null;
      g.faceSenders = H.blankF.map((t, k) => pc.getSenders().find((s) => s.track === t) || vids[2 + k] || null);
      hostVoicePick();
      iceProblem(pc,
        (never) => {
          if (never) note((g.name || 'Your guest') + ' couldn’t connect. ' + NET_WHY, 'stay');
          hostDropGuest(conn.connectionId); // after a drop the guest reconnects by itself
        },
        () => { text('liveHint', 'Connection is shaky. Reconnecting…'); },
        () => {
          tuneScreen(g.screenSender);
          tuneCam(g.camSender);
          g.faceSenders.forEach(tuneCam);
          tuneVoice(g.voiceSender);
          text('liveHint', '');
          tell(conn, { cam: !!H.cam });
          if (!g.live) { g.live = true; guestStatus(); moveTakeOver(g); }
          hostFace(g);
        });
    }
    conn.on('data', (d) => { if (H.guests.get(conn.connectionId) === g) hostData(g, d); });
    tell(conn, { cam: !!H.cam });
    tell(conn, { t: 'hello', v: VER, name: myName(), share: CAN_SHARE || CAN_LANE, video: !!H.cam });
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
      // Their voice plays here on its own, and joins everyone else's mix (an element must play it for that).
      const a = (pc && lane(pc, 0, 'audio')) || s.getAudioTracks()[0];
      if (a && a !== g.voice) {
        g.voice = a;
        g.audio.srcObject = new MediaStream([a]);
        if (g.vsrc) { try { g.vsrc.disconnect(); } catch (e) {} }
        try { g.vsrc = H.ctx.createMediaStreamSource(new MediaStream([a])); g.an = analyser(g.vsrc); } catch (e) { g.vsrc = g.an = null; }
        rewire();
      }
      applyVolumes(); // your volume for their voice (through the engine on iPhone, iPad and Safari)
      if (g.audio.paused) g.audio.play().catch(() => note('Click anywhere on this page to hear ' + (g.name || 'them') + '.', 'stay'));
      hostFace(g);
      if (H.sharer === g.id) roomSound(); // their shared video's sound may have just arrived
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
      if (d.t === 'lift') { g.lift = liftMode(d.mode); applyVolumes(); return; }
      if (d.t === 'hello') {
        liftTell(g);
        g.ver = +d.v || 0;
        g.canShare = !!d.share;
        tell(g.conn, roomMsg()); // the sharer may have changed since we said hello
        if (W.id) tell(g.conn, ytMsg()); // they join the video where it is now
        g.peopleSig = '';
        rewire();
        guestStatus();
        return;
      }
      if (g.ver < 2) return;
      if (d.t === 'chat') {
        if (typeof d.text !== 'string' || !rate(g, 'chatT', 10)) return;
        const t = d.text.slice(0, 2000).trim();
        if (!t) return;
        const name = g.name || 'Guest';
        chatAdd(false, name, t);
        toGuests({ t: 'chat', id: String(d.id || '').slice(0, 12), text: t, from: g.id, name }, g);
      } else if (d.t === 'share') {
        if (d.on && g.live && g.canShare) takeOver(g.id);
        else if (!d.on && H.sharer === g.id) { H.sharer = ''; V.pin = ''; H.shareN = (H.shareN || 0) + 1; roomScreen(); }
      } else if (d.t === 'ping') {
        const xy = okPing(d);
        if (!xy || !rate(g, 'pingT', 5)) return;
        const name = g.name || '';
        showDot(xy[0], xy[1], g.id, name);
        toGuests({ t: 'ping', x: xy[0], y: xy[1], from: g.id, name }, g);
        maybeTick();
      } else if (d.t === 'yt') {
        if (!rate(g, 'ytT', 20)) return;
        ytApply(d);
        toGuests({ ...ytMsg(), id: W.id, by: g.name || '' }, g);
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
    if (g.audio) { g.audio.srcObject = null; g.audio.remove(); g.audio = null; applyVolumes(); }
    if (g.tile) { const v = g.tile.querySelector('video'); if (v) v.srcObject = null; g.tile.remove(); g.tile = null; }
    [g.vsrc, g.an].forEach((nd) => { if (nd) { try { nd.disconnect(); } catch (e) {} } });
    if (g.vdest && H.micGain) { try { H.micGain.disconnect(g.vdest); } catch (e) {} }
    g.vsrc = g.an = g.vdest = null;
    T.last.delete(g.id);
    rewire();
    if (g.live && !H.stopping) ytAway(g.name || 'Your guest');
    if (H.sharer && H.sharer === g.id) { H.sharer = ''; V.pin = ''; roomScreen(); }
    guestStatus();
  }
  // A guest's camera becomes a face tile; layout() decides whether it is big or a bubble.
  function hostFace(g) {
    const pc = g.call && g.call.peerConnection;
    const track = g.camOn && g.live && pc ? lane(pc, 0) : null;
    if (track && !g.tile) {
      g.tile = faceTile(g.name || 'Guest', g.id);
      g.tile.dataset.pid = g.id;
      const park = $('parking');
      if (park) park.appendChild(g.tile);
    } else if (!track && g.tile) {
      const v = g.tile.querySelector('video');
      if (v) v.srcObject = null;
      g.tile.remove();
      g.tile = null;
    }
    if (g.tile) setTrack(g.tile, track);
    relayFaces();
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
    roomSound();
    shareBtns();
    guestStatus();
  }
  // ----- sound: the shared video's sound rides its own lane to everyone but its sharer -----
  function roomAudio() {
    if (!H.sharer) return null;
    if (H.sharer === H.me) { const a = H.display && H.display.getAudioTracks()[0]; return a && a.readyState === 'live' ? a : null; }
    const g = guestById(H.sharer);
    const pc = g && g.ver >= 3 && g.call && g.call.peerConnection;
    return pc ? lane(pc, 1, 'audio') : null;
  }
  function mediaFor(g) { return (g.id === H.sharer ? null : roomAudio()) || H.silent; }
  function roomSound() {
    const t = roomAudio();
    for (const g of H.guests.values()) {
      const want = mediaFor(g);
      const s = g.mediaSender;
      if (s && want && s.track !== want) s.replaceTrack(want).catch(() => {});
    }
    if (H.mediaTrack !== t) {
      if (H.mediaSrc) { try { H.mediaSrc.disconnect(); } catch (e) {} }
      H.mediaSrc = null;
      H.mediaTrack = t;
      if (t && H.ctx) { try { H.mediaSrc = H.ctx.createMediaStreamSource(new MediaStream([t])); } catch (e) { H.mediaSrc = null; } }
      rewire();
    }
    play($('media'), t && H.sharer !== H.me ? t : null); // a guest's shared video: you hear it here
    applyVolumes();
  }
  // Each guest's voice mix: everyone else's voice. A guest on the old Beside has no video-sound lane, so the
  // shared video's sound goes into its voice mix, as before.
  // An iPhone or iPad host with one guest sends its mic as it comes (SEND_RAW). With more guests each one needs
  // the others' voices mixed in, which only the audio engine can do, so then every guest gets the mix.
  function hostVoicePick() {
    const raw = SEND_RAW && H.mic ? H.mic.getAudioTracks()[0] : null;
    const one = H.guests.size <= 1;
    let sent = '';
    for (const g of H.guests.values()) {
      const s = g.voiceSender;
      if (!s || !g.vdest) continue;
      const mix = !one || (!!H.mediaSrc && g.ver < 3 && g.id !== H.sharer); // an old guest hears the video in its voice
      const want = raw && raw.readyState === 'live' && !mix ? raw : g.vdest.stream.getAudioTracks()[0];
      if (want && s.track !== want) s.replaceTrack(want).catch(() => {});
      sent = want === raw ? 'plain' : 'mix';
    }
    app.hostVoice = sent;
  }
  function rewire() {
    if (!H.ctx) return;
    hostVoicePick();
    const all = [...H.guests.values()];
    all.forEach((g) => {
      if (!g.vsrc) return;
      try { g.vsrc.disconnect(); } catch (e) {}
      if (g.an) g.vsrc.connect(g.an);
      all.forEach((o) => { if (o !== g && o.vdest) g.vsrc.connect(o.vdest); });
    });
    if (H.mediaSrc) {
      try { H.mediaSrc.disconnect(); } catch (e) {}
      all.forEach((o) => { if (o.vdest && o.ver < 3 && o.id !== H.sharer) H.mediaSrc.connect(o.vdest); });
    }
  }
  // Faces for guests: each guest gets up to two other guests' cameras on lanes 2 and 3 (so four people all see
  // each other), and the list of who is in the call, so even people without a camera get a tile.
  function relayFaces() {
    const live = watchers();
    for (const g of H.guests.values()) {
      const others = live.filter((o) => o !== g);
      g.faceSenders.forEach((s, k) => {
        if (!s) return;
        const o = others[k];
        const pc = o && o.camOn && o.call && o.call.peerConnection;
        const t = (g.ver >= 3 && pc && lane(pc, 0)) || H.blankF[k]; // an old guest can't show them
        if (t && s.track !== t) s.replaceTrack(t).then(() => tuneCam(s)).catch(() => {});
      });
      if (g.ver < 3) continue;
      const list = others.map((o, k) => ({ id: o.id, name: o.name || '', cam: !!o.camOn, lane: k < 2 && g.faceSenders[k] ? k + 2 : -1 }));
      const sig = JSON.stringify(list);
      if (sig !== g.peopleSig) { g.peopleSig = sig; tell(g.conn, { t: 'people', list }); }
    }
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
    useDisplay(s);
  }
  function useDisplay(s) {
    const prev = H.display;
    H.display = s;
    useVideoTrack(s.getVideoTracks()[0]);
    if (s === CV.stream) { try { H.video.contentHint = CV.kind === 'video' ? 'motion' : 'detail'; } catch (e) {} }
    s.getAudioTracks().forEach((t) => { try { t.contentHint = 'music'; } catch (e) {} });
    if (prev) prev.getTracks().forEach((t) => t.stop()); // video and tab sound of the old choice
    if (H.sharer === H.me) { V.pin = ''; H.shareN = (H.shareN || 0) + 1; roomScreen(); } else takeOver(H.me);
  }
  const hostChange = hostShare;
  function hostUnshare(msg, keepSharer) {
    const d = H.display;
    H.display = null;
    H.video = null;
    if (d) d.getTracks().forEach((t) => t.stop());
    if (d && d === CV.stream) canvasStop();
    if (H.sharer === H.me && !keepSharer) { H.sharer = ''; V.pin = ''; roomScreen(); }
    shareBtns();
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
    relayFaces();
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
    if (SEND_RAW) H.mic.getAudioTracks().forEach((t) => { t.enabled = !H.muted; }); // the mic itself is sent
    setPressed('muteBtn', H.muted, 'Unmute my mic', 'Mute my mic');
  }
  function hostMode(mode) {
    if (mode === H.mode) return;
    H.mode = mode;
    store.set('beside.mode', H.mode);
    if (H.video && !CV.kind) H.video.contentHint = H.mode;
    for (const g of H.guests.values()) tuneScreen(g.screenSender);
    modeLabel();
  }
  function modeLabel() {
    document.querySelectorAll('#modeToggle [data-mode]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === H.mode ? 'true' : 'false'));
  }
  function hostCleanup() {
    const wasLive = app.state === 'live';
    H.stopping = true;
    H.ringOnReady = 0;
    ytClose(true);
    canvasStop();
    clearInterval(H.lagTimer);
    clearInterval(T.timer);
    for (const id of [...H.guests.keys()]) hostDropGuest(id);
    [H.peer, H.spare].forEach((p) => { if (p) { try { p.destroy(); } catch (e) {} } });
    H.peer = H.spare = null;
    [H.display, H.mic, H.cam].forEach((s) => s && s.getTracks().forEach((t) => t.stop()));
    [H.video, H.blank, H.blankScreen, H.silent].concat(H.blankF).forEach((t) => t && t.stop());
    if (H.clear) { H.clear.close(); H.clear = null; }
    H.rawSrc = null;
    if (H.ctx) H.ctx.close().catch(() => {});
    H.display = H.mic = H.video = H.ctx = H.sink = H.silent = H.micGain = H.micAn = H.mediaSrc = H.mediaTrack = null;
    H.cam = H.camSlot = H.blank = H.blankScreen = null;
    H.blankF = [];
    H.sharer = '';
    T.last.clear();
    setTalk([]);
    const me = $('media');
    if (me) me.srcObject = null;
    V.pin = '';
    miniClose();
    autoPip(false);
    chatReset();
    setPressed('camBtn', false, 'Turn my camera off', 'Turn my camera on');
    shareBtns();
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
  // ---------- MOVE THE CALL HERE ----------
  // One person, two devices: the call is live on one (phone, iPad, Mac, browser or the Beside app) and they open
  // Beside on another. A quick look (a "probe": a short data link with metadata {beside:'probe'}) asks the live
  // room. For a host, any live host device of this room counts; for a guest, a live guest with the same name
  // (the name is the per-person key the guest link's devices share). "Move the call here" then:
  //  host: the new device asks the live one to hand over ({beside:'move'}); the old one tells the guests a move
  //        is coming, stops hosting (which ends any screen share it was running) and frees the link; the new one
  //        claims it with quick retries; the guests knock again by themselves.
  //  guest: the new device joins first (with {move:1}); once it is in, the host tells the old device to leave.
  const MV = { probing: false, waiting: [], dismissed: false, cam: false, away: false, liveAt: 0, yieldAt: 0 };
  function moveProbe(then, ms) {
    if (MV.probing) { if (then) MV.waiting.push(then); return; } // one probe at a time: share its answer
    if (!window.Peer || !roomy()) { if (then) then(null); return; }
    const nm = isGuest ? cleanName(store.get('beside.name') || '') : '';
    if (isGuest && !nm) { if (then) then(null); return; } // no name yet: nothing to match a guest's other device by
    const target = isGuest ? hostId : PREFIX + (H.code || hostCode());
    MV.probing = true;
    let p = null;
    const done = (r) => {
      if (!MV.probing) return;
      MV.probing = false;
      clearTimeout(t);
      setTimeout(() => { try { if (p) p.destroy(); } catch (e) {} }, 200);
      const all = [then].concat(MV.waiting.splice(0));
      all.forEach((f) => { if (f) f(r); });
    };
    const t = setTimeout(() => done(null), ms || 5000);
    const t0 = Date.now(), tr = { at: t0 };
    MV.trace = tr;
    try { p = new Peer(opts()); } catch (e) { done(null); return; }
    p.on('open', () => {
      tr.open = Date.now() - t0;
      const c = p.connect(target, { reliable: true, metadata: { beside: 'probe', as: isGuest ? 'guest' : 'host', name: nm } });
      c.on('open', () => { tr.conn = Date.now() - t0; });
      c.on('data', (d) => { tr.data = Date.now() - t0; if (d && d.t === 'probe') done(d); });
      c.on('error', (e) => { tr.cerr = (e && e.type) || 'x'; done(null); });
    });
    p.on('error', (e) => { tr.perr = (e && e.type) || 'x'; done(null); });
  }
  function roomy() { return isGuest ? !!guestCode : true; }
  function moveFound(r) {
    // Seen live elsewhere: a Start here asks it first. (Not while this device holds the call: then it was us.)
    if (r && r.live && !isGuest && ['idle', 'ended'].includes(app.state) && !app.hostReady) MV.liveAt = Date.now();
    if (!r || !r.live || MV.dismissed) return;
    if (isGuest ? !r.here || !['join', 'ended'].includes(app.state) : !['idle', 'ended'].includes(app.state)) return;
    MV.cam = !!r.cam;
    const c = $('moveCard');
    if (c) c.hidden = false;
    if (typeof setTab === 'function') setTab('home', true);
  }
  function moveCardHide() { const c = $('moveCard'); if (c) c.hidden = true; }
  // The live device: a probe or a move request on its link (never counted as a guest).
  function moveConn(conn) {
    const m = conn.metadata;
    if (!m || (m.beside !== 'probe' && m.beside !== 'move' && m.beside !== 'yield')) return false;
    conn.on('open', () => {
      if (m.beside === 'probe') {
        const nm = cleanName(m.name || '').toLowerCase();
        const same = m.as === 'guest' && nm ? [...H.guests.values()].find((g) => g.live && (g.name || '').toLowerCase() === nm) : null;
        tell(conn, { t: 'probe', live: app.state === 'live' && !!app.hostReady, here: m.as === 'host' || !!same, cam: m.as === 'host' ? !!H.cam : !!(same && same.camOn) });
        setTimeout(() => { try { conn.close(); } catch (e) {} }, 1500);
      } else if (m.beside === 'yield') {
        // My other device has had this call since before this one took the link (its line blipped): step back.
        const mine = H.liveSince || Date.now();
        const back = m.as === 'host' && app.state === 'live' && +m.since > 0 && +m.since < mine;
        tell(conn, { t: 'yield', ok: back });
        if (back) {
          app.mv.push({ yielded: Date.now(), since: +m.since, mine });
          setTimeout(() => {
            if (app.state !== 'live') return;
            hostCleanup();
            show('idle');
            MV.dismissed = false;
            moveFound({ live: true, here: true, cam: !!m.cam });
          }, 50);
        }
      } else if (m.as === 'host' && app.state === 'live') {
        // Only another host device of this room asks this; a guest's other device joins instead (see guestConnect).
        tell(conn, { t: 'moving' });
        setTimeout(moveAway, 100);
      }
    });
    return true;
  }
  function moveAway() {
    if (app.state !== 'live') return;
    MV.cam = !!H.cam;
    toGuests({ t: 'moving' });
    setTimeout(() => {
      hostCleanup();
      nativeEnd();
      MV.away = true;
      ended('Moved to your other device.', 'The call carries on there.', 'Bring it back');
    }, 60);
  }
  // The live device, whose link another of my devices took while its line blipped: ask that one to step back
  // (at most once every 3 s); its own reconnect then gets the link again.
  function askYield() {
    if (!H.liveSince || Date.now() - (MV.yieldAt || 0) < 3000) return;
    MV.yieldAt = Date.now();
    let p = null;
    const bye = () => setTimeout(() => { try { if (p) p.destroy(); } catch (e) {} }, 300);
    try { p = new Peer(opts()); } catch (e) { return; }
    p.on('open', () => {
      const c = p.connect(PREFIX + H.code, { reliable: true, metadata: { beside: 'yield', as: 'host', since: H.liveSince, cam: !!H.cam } });
      c.on('data', bye);
      c.on('close', bye);
      c.on('error', bye);
    });
    p.on('error', bye);
    setTimeout(bye, 4000);
  }
  // The new device: ask the live one to hand over, then claim the link (openHostPeer retries quickly).
  function moveAsk() {
    let p = null;
    const bye = () => setTimeout(() => { try { if (p) p.destroy(); } catch (e) {} }, 300);
    try { p = new Peer(opts()); } catch (e) { return; }
    p.on('open', () => {
      const c = p.connect(PREFIX + H.code, { reliable: true, metadata: { beside: 'move', as: 'host' } });
      c.on('data', bye);
      c.on('close', bye);
      c.on('error', bye);
    });
    p.on('error', bye);
    setTimeout(bye, 4000);
  }
  function moveHere() {
    moveCardHide();
    MV.away = false;
    if (isGuest) {
      G.moveIn = true;
      G.moveCam = MV.cam;
      if (app.state === 'ended') show('join');
      guestJoin(true);
      return;
    }
    H.moveTo = { sent: false };
    hostStart(MV.cam ? 'video' : 'voice');
  }
  // The guest's old device, told by the host that the new one is in.
  function guestMovedAway() {
    MV.cam = !!G.cam;
    guestLeave();
    nativeEnd();
    MV.away = true;
    ended('Moved to your other device.', 'The call carries on there.', 'Bring it back');
  }
  // The host, when a guest that came with {move:1} is in: their other device (same name) can go.
  function moveTakeOver(g) {
    const m = (g.conn && g.conn.metadata) || {};
    if (!m.move || !g.name) return;
    const nm = g.name.toLowerCase();
    for (const [k, o] of H.guests) {
      if (o === g || (o.name || '').toLowerCase() !== nm) continue;
      tell(o.conn, { t: 'moved' });
      setTimeout(() => hostDropGuest(k), 500);
    }
  }
  // Inside the Beside app, the old device's phone call (CallKit) ends with the page's call.
  function nativeEnd() {
    const n = window.BesideNative;
    if (!n) return;
    try { if (typeof n.endCall === 'function') n.endCall('moved'); } catch (e) {}
    try { const mh = window.webkit && window.webkit.messageHandlers; if (mh && mh.beside) mh.beside.postMessage({ t: 'ended', why: 'moved' }); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent('beside:ended', { detail: { why: 'moved' } })); } catch (e) {}
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
      // Older browsers: copy from a box of our own, so it works whichever screen is showing.
      const ta = document.createElement('textarea');
      ta.value = link;
      ta.setAttribute('readonly', '');
      ta.setAttribute('aria-hidden', 'true');
      Object.assign(ta.style, { position: 'fixed', top: '0', left: '0', width: '1px', height: '1px', opacity: '0', fontSize: '16px' });
      document.body.append(ta);
      ta.select();
      try { ta.setSelectionRange(0, link.length); } catch (e3) {}
      try { document.execCommand('copy'); } catch (e2) {}
      ta.remove();
    }
    const lab = btn && btn.querySelector('.label-t');
    if (lab) { lab.textContent = 'Copied'; setTimeout(() => { lab.textContent = 'Copy'; }, 1500); }
  }
  // The link for your own other devices: same room, you host there too.
  async function copyMine(btn) {
    const n = myName();
    const link = location.origin + location.pathname + '?room=' + (H.code || hostCode()) + (n ? '&name=' + encodeURIComponent(n) : '');
    let done = false;
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ title: 'Beside (my room)', url: link }); done = true; } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    if (!done) { try { await navigator.clipboard.writeText(link); } catch (e) { prompt('Copy this link, then open it on your other device:', link); return; } }
    if (!done) note('Copied. Open it on your iPad or iPhone (paste it into Safari), then add it to the Home Screen.', 'info');
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
    openTimer: 0, picTimer: 0, tries: 0, quiet: 0, reopenedAt: 0, waitSince: 0, free: false, misses: 0, netErrs: 0,
    lost: false, dropped: false, joining: false, serverDown: false,
    cam: null, blank: null, camSender: null, camOn: false, camBusy: false, view: null, viewFor: null, hostVer: 0, room: null,
    hostName: '', ctx: null, display: null, screenTrack: null, screenBlank: null, screenSender: null,
    voiceSender: null, mediaSender: null, silentA: null, silentB: null, people: [], tiles: new Map(),
  };
  const hostId = PREFIX + guestCode;
  const MIC_BLOCKED = 'Your microphone is blocked, so you can watch and listen but they can’t hear you. Allow the microphone for this site to talk. If this link opened inside another app (WhatsApp, Instagram…), open it in Safari or Chrome instead.';

  function setJoinBusy(b) { ['joinBtn', 'joinNoMicBtn', 'callJoinBtn', 'callJoinNoMicBtn'].forEach((id) => { const el = $(id); if (el) el.disabled = b; }); }
  async function guestJoin(withMic) {
    if (!peerLibOk() || G.joining || (G.peer && !G.peer.destroyed)) return; // double tap
    G.joining = true;
    setJoinBusy(true);
    try {
      G.left = false;
      G.lift = '';
      MV.away = false;
      moveCardHide();
      G.lost = G.dropped = false;
      G.tries = G.quiet = G.reopenedAt = 0;
      // Unlock sound inside the tap (iPhone): voices and the shared video's sound each play in their own element.
      ['voice', 'media'].forEach((id) => { const el = $(id); if (el) { el.muted = outMuted(el); el.play().catch(() => {}); } });
      // Computers that can share back hold two silent sound lanes ready: the mic's (if joining without it) and the
      // shared tab's. The audio engine starts inside the tap, so it is allowed to run. (Not iPhone and iPad: no
      // audio engine track is ever sent from there, as that made the voice crackle. Their videos go without sound.)
      // Clear voice needs the engine too, so anyone joining with a mic starts it here.
      // Everyone gets it: your volumes for their voice and the video play through it on iPhone and iPad.
      if (!G.ctx) { try { G.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { G.ctx = null; } }
      if (G.ctx) {
        G.ctx.resume().catch(() => {});
        if (CAN_SHARE && !G.silentA) G.silentA = silentTrack(G.ctx);
        if (CAN_SHARE && !G.silentB) G.silentB = silentTrack(G.ctx);
      }
      guestVoiceClose();
      if (G.mic) { G.mic.getTracks().forEach((t) => t.stop()); G.mic = null; }
      if (withMic && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          G.mic = await getOwn('audio', micWant(CLEAR.mode));
          G.mic.getAudioTracks().forEach((t) => { try { t.contentHint = CLEAR.mode === 'music' ? 'music' : 'speech'; } catch (e) {} });
        } catch (e) {
          note(MIC_BLOCKED, 'stay');
        }
      }
      G.muted = !G.mic;
      if (G.mic) guestVoiceSetup();
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
    if (!netReady()) { G.peer = null; NET.p.then(() => { if (!G.left && !G.peer && app.state !== 'watching') openGuestPeer(); }); return; }
    if (!NET.own) G.free = false;
    const peer = new Peer(opts(G.free));
    app.guestPeers++;
    G.peer = peer;
    // 'open' also fires after a call-server blip; an existing link to them must be left alone.
    peer.on('open', () => {
      if (G.peer !== peer || G.left) return;
      G.netErrs = 0;
      if ((G.conn && G.conn.open) || app.state === 'watching') return;
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
        // Not there yet. Every third time, one knock on the free server instead, in case the host's Beside
        // is an older copy that only uses that one (a host on this one is on both), then back.
        if (G.free || (NET.own && ++G.misses >= 3)) { G.misses = 0; G.free = !G.free; openGuestPeer(); return; }
        guestRetry();
      } else if (t === 'browser-incompatible') {
        note('This browser can’t join calls. Try Safari or Chrome.', 'stay');
      } else if (NET_ERR.test(t || '')) {
        if (app.state !== 'watching') {
          // PeerJS keeps retrying the same server. Switch to the other one: at once after a failed round on
          // the free server (no message, it was only a look), else after two failures in a row.
          if (NET.own && (G.free || ++G.netErrs >= 2)) {
            const wasFree = G.free;
            G.netErrs = 0;
            G.free = !G.free;
            NET.at = 0; // and ask the own server again
            try { peer.destroy(); } catch (e2) {}
            if (wasFree) { openGuestPeer(); return; }
          }
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
    // Anyone who can share (a tab, a photo, a video, a web page) also answers on the second video lane (its screen, blank until it shares).
    if (G.display) guestUnshare(true);
    const slot = G.cam ? G.cam.getVideoTracks()[0] : G.blank;
    if (CAN_LANE && slot && !G.screenBlank) G.screenBlank = blankTrack();
    const scr = CAN_LANE && slot ? G.screenBlank : null;
    const mic = guestVoiceTrack();
    const voice = mic || (G.silentB && G.silentA) || null; // with a tab's sound to come, the voice lane must be held first
    const media = voice && G.silentB ? G.silentB : null;
    const out = [voice, media, slot, scr].filter(Boolean);
    call.answer(out.length ? ordered(out) : undefined, { sdpTransform: tuneOpus });
    const pc = call.peerConnection;
    const find = (t) => (pc && t && pc.getSenders().find((s) => s.track === t)) || null;
    G.camSender = find(slot);
    G.screenSender = find(scr);
    G.voiceSender = find(voice);
    G.mediaSender = find(media);
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
        () => { if (G.call === call) { tuneCam(G.camSender); tuneVoice(G.voiceSender); tell(G.conn, { cam: !!G.cam }); } });
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
    const conn = G.peer.connect(hostId, { reliable: true, metadata: G.moveIn ? { name: store.get('beside.name') || '', move: 1 } : { name: store.get('beside.name') || '' } });
    G.conn = conn;
    knock(conn);
  }
  function knock(conn) {
    let opened = false;
    const at = Date.now();
    // No answer within 4 s: they're not live yet, or the call server dropped the knock (0.peerjs.com sometimes
    // drops a knock on a link that isn't live without saying so), so knock again; after ~10 minutes, every 12 s.
    // An answer but no link after 15 s: one of the networks is blocking the call.
    const patience = G.movingAt && Date.now() - G.movingAt < 15000 ? 1200 : G.tries > 150 ? 12000 : 4000;
    const check = () => {
      if (G.conn !== conn || opened || G.left || app.state === 'watching') return;
      const age = Date.now() - at;
      const heard = answered(conn) || answered(G.spare);
      if (heard) G.quiet = 0;
      if (!heard && age >= patience) {
        G.tries++;
        notLiveYet();
        if (G.free) { G.free = false; openGuestPeer(); return; } // nobody on the free server either: back
        G.quiet++;
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
      tell(conn, { t: 'hello', v: VER, name: cleanName(store.get('beside.name') || ''), share: CAN_SHARE || CAN_LANE });
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
      if (d.t === 'lift') { G.lift = liftMode(d.mode); applyVolumes(); return; }
      if (d.t === 'moving') { G.movingAt = Date.now(); return; }
      if (d.t === 'moved') { guestMovedAway(); return; }
      if (d.t === 'hello') {
        G.hostVer = +d.v || 0;
        G.hostName = cleanName(d.name);
        // A video call: a gentle nudge to turn the camera on (never turned on for you).
        if (d.video && !G.cam && G.blank) peekLine((hostLabel() || 'They') + ' started a video call. Tap the camera to show your face.');
        if (G.hostName && !theirName) { text('camName', G.hostName); text('tapToHearText', 'Tap to hear ' + G.hostName); }
        layout();
      } else if (d.t === 'room') {
        const room = { sharer: typeof d.sharer === 'string' ? d.sharer.slice(0, 80) : '', name: cleanName(d.name), n: +d.n || 0 };
        if (!G.room || G.room.sharer !== room.sharer || G.room.n !== room.n) V.pin = ''; // a new share always shows big
        G.room = room;
        layout();
      } else if (d.t === 'share') {
        // Someone else started sharing: the host stopped ours.
        if (d.on === false && G.display) { guestUnshare(true); note((cleanName(d.name) || 'Someone') + ' is sharing now, so your sharing stopped.', 'info'); }
        // Say so even if our picture started after the host's message left: otherwise the room keeps a frozen screen.
        if (d.on === false) tell(G.conn, { t: 'share', on: false });
      } else if (d.t === 'people') {
        if (!Array.isArray(d.list)) return;
        G.people = d.list.slice(0, 8).filter((p) => p && typeof p.id === 'string').map((p) => ({
          id: p.id.slice(0, 80), name: cleanName(p.name), cam: !!p.cam, lane: p.lane === 2 || p.lane === 3 ? p.lane : -1,
        }));
        layout();
      } else if (d.t === 'talk') {
        setTalk((Array.isArray(d.ids) ? d.ids : []).slice(0, 8).map((x) => String(x).slice(0, 80)));
      } else if (d.t === 'chat') {
        if (typeof d.text !== 'string') return;
        const t = d.text.slice(0, 2000).trim();
        if (t) chatAdd(false, cleanName(d.name) || (d.from === hostId ? hostLabel() : '') || 'Someone', t);
      } else if (d.t === 'ping') {
        const xy = okPing(d);
        if (!xy) return;
        showDot(xy[0], xy[1], String(d.from || hostId), cleanName(d.name));
        maybeTick();
      } else if (d.t === 'yt') {
        ytApply(d);
      } else if (d.t === 'file') {
        fileStart('h:' + String(d.id).slice(0, 12), d, cleanName(d.name) || (d.from === hostId ? hostLabel() : '') || 'Someone');
      } else if (d.t === 'part') filePart('h:' + String(d.id).slice(0, 12), d);
    } catch (e) { /* a bad message never breaks the call */ }
  }
  function roomReset() { G.hostVer = 0; G.room = null; G.people = []; setTalk([]); }
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
    if (G.movingAt && Date.now() - G.movingAt < 15000) wait('Moving the call…', 'Back in a moment…', (theirName || 'They') + ' is moving the call to another device.');
    else if (G.dropped) wait('The connection dropped.', 'Reconnecting…', 'Usually a Wi-Fi hiccup. Keep this open.');
    else wait((theirName || 'They') + ' ended the call.', 'Waiting for ' + (theirName || 'them') + ' to start again…', 'Keep this open and it reconnects by itself.');
  }
  function wait(title, status, hint) {
    if (app.state !== 'waiting') G.waitSince = Date.now();
    show('waiting');
    miniRender();
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
    // The host is moving the call to another of their devices: knock again quickly.
    const moving = G.movingAt && Date.now() - G.movingAt < 15000;
    const ms = moving ? 250 : Math.min(G.tries > 150 ? 12000 : 4000, 1000 * Math.pow(1.4, G.tries || 0));
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
    // The sound has its own elements, because a video whose picture lane is empty never starts its sound:
    // voices in one, the shared video's sound in the other (an old host mixes both into the voice lane).
    // PeerJS fires 'stream' once per track: only set what changed.
    [['voice', (pc && lane(pc, 0, 'audio')) || stream.getAudioTracks()[0]], ['media', pc && lane(pc, 1, 'audio')]].forEach(([id, a]) => {
      const el = $(id);
      if (!el || !a || (el.srcObject && el.srcObject.getAudioTracks()[0] === a)) return;
      el.srcObject = new MediaStream([a]);
      el.muted = outMuted(el);
      playWithSound(el);
    });
    applyVolumes();
    layout();
    tell(G.conn, { cam: !!G.cam });
    liftTell();
    clearInterval(G.lagTimer);
    G.lagTimer = setInterval(async () => { const r = await rtt(pc); app.lag = r; setLag('lag', r); }, 2000);
    app.watching = true;
    G.lost = G.dropped = false;
    G.tries = G.quiet = 0;
    G.movingAt = 0;
    if (G.moveIn) { G.moveIn = false; if (G.moveCam && !G.cam) { G.moveCam = false; guestCam(); } }
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
    ['voice', 'media'].forEach((id) => { const el = $(id); if (el && el.srcObject && el.paused) playWithSound(el); });
  }
  function tapHide() { const t = $('tapToHear'); if (t) t.hidden = true; }
  function guestLost() {
    if (G.left) return;
    ytClose(true); // the host paused it for everyone; joining again brings it back where it is
    guestUnshare(true);
    autoPip(false);
    clearInterval(G.lagTimer);
    app.watching = false;
    const v = $('screenVideo');
    if (v) v.srcObject = null;
    ['voice', 'media'].forEach((id) => { const el = $(id); if (el) el.srcObject = null; });
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
    if (G.clearTrack) G.clearTrack.enabled = !G.muted;
    setPressed('gMuteBtn', G.muted, 'Unmute my mic', 'Mute my mic');
  }
  // Clear voice for a guest: the mic goes through the leveller into a track of its own. The plain mic is sent
  // instead whenever the leveller can't run (Clear voice off, the iPhone paused the audio engine for a phone call or
  // Siri, or the engine hears nothing), and Clear voice comes back by itself when the engine runs again.
  // A mic and an audio engine at different rates crackle (and Safari garbles them), so when they differ the
  // leveller gets an engine of its own at the mic's rate (allowed without a tap while the mic is on).
  function guestVoiceSetup() {
    guestVoiceClose();
    if (SEND_RAW) return; // an iPhone or iPad sends its mic as it comes (see SEND_RAW)
    if (!G.mic || !G.ctx || !G.ctx.createMediaStreamDestination) return;
    try {
      let ctx = G.ctx;
      const rate = micRate();
      if (rate && rate !== G.ctx.sampleRate) {
        try { ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: rate }); ctx.resume().catch(() => {}); } catch (e) { ctx = G.ctx; }
      }
      G.vctx = ctx;
      const dest = ctx.createMediaStreamDestination();
      const ch = clearChain(ctx, G.mic, { live: () => !G.muted, change: () => guestVoicePick() });
      ch.out.connect(dest);
      G.clear = ch;
      G.clearTrack = dest.stream.getAudioTracks()[0];
      try { G.clearTrack.contentHint = CLEAR.mode === 'music' ? 'music' : 'speech'; } catch (e) {}
      G.clearTrack.enabled = !G.muted;
      G.clearDead = false;
      if (!ctx.besideWatch) {
        ctx.besideWatch = true;
        ctx.addEventListener('statechange', () => guestVoicePick());
      }
      if (!G.devWatch && navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
        G.devWatch = true;
        navigator.mediaDevices.addEventListener('devicechange', () => setTimeout(guestVoicePick, 500));
      }
    } catch (e) { guestVoiceClose(); }
  }
  function guestVoiceClose() {
    if (G.clear) G.clear.close();
    if (G.clearTrack) G.clearTrack.stop();
    if (G.vctx && G.vctx !== G.ctx) G.vctx.close().catch(() => {});
    G.clear = G.clearTrack = G.vctx = null;
  }
  function trackRate(stream) { try { return (stream && stream.getAudioTracks()[0].getSettings().sampleRate) || 0; } catch (e) { return 0; } }
  function micRate() { return trackRate(G.mic); }
  function guestVoiceTrack() {
    const raw = G.mic && G.mic.getAudioTracks()[0];
    if (!raw) return null;
    // If the mic's rate changes mid-call (AirPods' call mic runs slower), Safari would garble it: plain mic then.
    const r = micRate();
    const rate = !r || !G.vctx || r === G.vctx.sampleRate;
    const ok = CLEAR.on && rate && G.clear && G.clear.ok && G.clearTrack && G.clearTrack.readyState === 'live' && !G.clearDead && G.vctx && G.vctx.state === 'running';
    app.voiceSent = ok ? 'clear' : 'plain';
    return ok ? G.clearTrack : raw;
  }
  function guestVoicePick() {
    if (!isGuest) return;
    const t = guestVoiceTrack();
    const s = G.voiceSender;
    if (s && t && s.track !== t) s.replaceTrack(t).catch(() => {});
    if (s && t && G.vctx && G.vctx.state !== 'running' && G.vctx.state !== 'closed') G.vctx.resume().catch(() => {});
  }
  function guestFace() { layout(); }
  // A guest can share back: one tab or window (a computer), or a photo, a video or a web page (every device). It
  // rides the second video lane of the same call; the host decides who shares (the newest share wins) and passes
  // it on to the others.
  async function guestShare() {
    if (G.sharing || G.display || !G.screenSender || G.hostVer < 2 || app.state !== 'watching') return;
    G.sharing = true;
    try {
      // The tick for a hidden sharer needs sound unlocked, so the audio engine starts inside this tap.
      if (!G.ctx) { try { G.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { G.ctx = null; } }
      let s;
      try {
        s = await getDisplay(true);
      } catch (e) {
        note(displayError(e), e && /system/i.test(e.message || '') ? 'stay' : 'info');
        return;
      }
      if (isWholeScreen(s)) { s.getTracks().forEach((t) => t.stop()); note(WHOLE_SCREEN, 'stay'); return; }
      await guestUse(s);
    } finally { G.sharing = false; }
  }
  // Puts a picture (and its sound, if any) on this guest's share lanes, in place of whatever was shared before.
  async function guestUse(s) {
    const t = s.getVideoTracks()[0];
    if (!t || app.state !== 'watching' || !G.screenSender) { s.getTracks().forEach((x) => x.stop()); if (s === CV.stream) canvasStop(); return false; }
    try { t.contentHint = s === CV.stream && CV.kind === 'video' ? 'motion' : 'detail'; } catch (e) {}
    try { await G.screenSender.replaceTrack(t); } catch (e) {
      s.getTracks().forEach((x) => x.stop());
      if (s === CV.stream) canvasStop();
      note('Sharing didn’t start. Try again.', 'info');
      return false;
    }
    tuneScreen(G.screenSender);
    // The sound rides its own lane; an old host has none, so it isn't sent.
    const a = s.getAudioTracks()[0];
    if (a && G.mediaSender && G.hostVer >= 3) {
      try { a.contentHint = 'music'; } catch (e) {}
      G.mediaSender.replaceTrack(a).catch(() => {});
    } else {
      s.getAudioTracks().forEach((x) => { if (s !== CV.stream) x.stop(); });
      if (G.mediaSender && G.silentB) G.mediaSender.replaceTrack(G.silentB).catch(() => {});
    }
    const prev = G.display;
    G.display = s;
    G.screenTrack = t;
    if (prev && prev !== s) prev.getTracks().forEach((x) => x.stop());
    t.addEventListener('ended', () => { if (G.screenTrack === t) guestUnshare(); }); // Stop in the browser's bar
    tell(G.conn, { t: 'share', on: true });
    V.pin = '';
    shareBtns();
    layout();
    return true;
  }
  function guestUnshare(quiet) {
    const d = G.display;
    if (!d) return;
    G.display = null;
    G.screenTrack = null;
    if (G.screenSender && G.screenBlank) G.screenSender.replaceTrack(G.screenBlank).catch(() => {});
    if (G.mediaSender && G.silentB) G.mediaSender.replaceTrack(G.silentB).catch(() => {});
    d.getTracks().forEach((t) => t.stop());
    if (d === CV.stream) canvasStop();
    if (!quiet) tell(G.conn, { t: 'share', on: false });
    shareBtns();
    layout();
  }
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
      const m = await getOwn('audio', micWant(CLEAR.mode));
      const t = m.getAudioTracks()[0];
      t.enabled = !G.muted;
      try { t.contentHint = CLEAR.mode === 'music' ? 'music' : 'speech'; } catch (e) {}
      G.mic = m;
      if (G.clear) { G.clear.swap(m); G.clearDead = true; } // a restarted iPhone mic can feed the engine silence
      const pc = G.call && G.call.peerConnection;
      const snd = pc && pc.getSenders().find((x) => x.track === a);
      if (snd) await snd.replaceTrack(t);
      guestVoicePick();
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
    ytClose(true);
    guestUnshare(true);
    miniClose();
    autoPip(false);
    clearTimeout(G.retry);
    clearInterval(G.lagTimer);
    dropKnocks();
    try { if (G.call) G.call.close(); } catch (e) {}
    try { if (G.peer) G.peer.destroy(); } catch (e) {}
    guestVoiceClose();
    if (G.ctx && G.ctx.state === 'running') G.ctx.suspend().catch(() => {}); // joining again resumes it inside the tap
    [G.mic, G.cam].forEach((s) => s && s.getTracks().forEach((t) => t.stop()));
    G.peer = G.call = G.mic = G.cam = G.camSender = G.screenSender = G.view = G.viewFor = null;
    G.camOn = false;
    roomReset();
    V.pin = '';
    chatReset();
    app.watching = false;
    guestFace();
    setPressed('gCamBtn', false, 'Turn my camera off', 'Turn my camera on');
    const v = $('screenVideo');
    if (v) v.srcObject = null;
    ['voice', 'media'].forEach((id) => { const el = $(id); if (el) el.srcObject = null; });
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
    const sp = $('soundPop');
    if (moreOpen() || shareIsOpen() || (sp && !sp.hidden) || (ck && !ck.hidden) || document.body.classList.contains('chat-open')) return false;
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
    else if (!isGuest && !CAN_SHARE) basics.set('warn', 'Calls work here. Share links, photos and videos with the Share button. Sharing your screen needs Chrome on a computer.');
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
      if (!netReady()) await NET.p;
      const peer = new Peer(opts());
      const t0 = Date.now();
      try {
        await withTimeout(new Promise((res, rej) => { peer.on('open', res); peer.on('error', rej); }), 9000);
        server.set('ok', '', (Date.now() - t0) + ' ms' + (OWN && !NET.own ? ' (spare)' : ''));
      } catch (e) {
        server.set('bad', 'Can’t reach the call server. Check your internet. A firewall or blocker on this network may be stopping it.');
      } finally { peer.destroy(); }
    })();

    const netP = (async () => {
      if (srv) return net.set('ok', '', 'Test mode');
      if (!netReady()) await NET.p;
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
        const relay = NET.ice.length > ICE.length;
        if (!srflx.length && relay) {
          net.set('ok', 'This network blocks direct calls, so yours go through Cloudflare’s relay. They still work, with a little more delay.', 'Relay');
        } else if (!srflx.length) {
          net.set('bad', 'This network blocks the direct route calls use (common on work, school and hospital Wi-Fi). Try other Wi-Fi or a phone hotspot.', 'Blocked');
        } else {
          // The same public address showing different ports means the network changes ports for every contact ("strict").
          const byIp = {};
          srflx.forEach((c) => { (byIp[c.ip] = byIp[c.ip] || new Set()).add(c.port); });
          const strict = Object.values(byIp).some((ports) => ports.size > 1);
          if (strict && !relay) net.set('warn', 'This network is strict. Calls work with most other networks, but can fail if the other person is on a strict network too. If that happens, one of you should switch to home Wi-Fi.', 'Strict');
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
  // Nobody looking: animations wait (the page's own class; board.js sets the same). Calls, sound, the ring and
  // the board's checks carry on.
  function hiddenClass() {
    const hid = document.visibilityState === 'hidden';
    document.documentElement.classList.toggle('is-hidden', hid);
    // A fade or slide still going is simply finished.
    if (hid && document.getAnimations) document.getAnimations().forEach((a) => { if (window.CSSTransition && a instanceof CSSTransition) { try { a.finish(); } catch (e) {} } });
  }
  document.addEventListener('visibilitychange', hiddenClass);
  function boot() {
    hiddenClass();
    document.body.dataset.role = isGuest ? 'guest' : 'host';
    if (store.get('beside.mode') === 'motion') H.mode = 'motion';
    modeLabel();
    const saved = store.get('beside.name');
    if (saved && $('nameInput')) $('nameInput').value = saved;
    on('startBtn', 'click', () => hostStart('voice'));
    on('videoBtn', 'click', () => hostStart('video'));
    on('callVoiceBtn', 'click', () => hostStart('voice'));
    on('callVideoBtn', 'click', () => hostStart('video'));
    on('homeRingBtn', 'click', () => { H.ringOnReady = Date.now(); hostStart('voice'); });
    on('callJoinBtn', 'click', () => guestJoin(true));
    on('callJoinNoMicBtn', 'click', () => guestJoin(false));
    on('endedClose', 'click', () => { const c = $('endedClose').closest('.endcard'); if (c) c.hidden = true; });
    if ($('tvBox') && window.BesideFigures) $('tvBox').innerHTML = window.BesideFigures.tvRoom();
    tabsBoot();
    on('shareStartBtn', 'click', () => hostStart('share'));
    if ($('shareStartBtn')) $('shareStartBtn').hidden = !CAN_SHARE;
    on('micStartToggle', 'click', () => {
      const el = $('micStartToggle');
      const onNow = el.getAttribute('aria-pressed') === 'false';
      el.setAttribute('aria-pressed', onNow ? 'true' : 'false');
      text('micStartLabel', onNow ? 'Mic on' : 'Mic off');
      const sw = el.querySelector('.switch');
      if (sw) sw.classList.toggle('off', !onNow);
    });
    ['copyBtn', 'moreCopyBtn', 'idleCopyBtn'].forEach((id) => on(id, 'click', () => copyLink($(id))));
    ['shareBtn', 'moreShareBtn', 'idleShareBtn'].forEach((id) => on(id, 'click', () => shareLink($(id))));
    ['mineBtn', 'mineIdleBtn'].forEach((id) => on(id, 'click', () => copyMine($(id))));
    // Calls: "Invite someone else" opens a small sheet with the link, Copy and Send link.
    const inv = $('inviteSheet');
    const invite = (open) => {
      if (!inv) return;
      inv.hidden = !open;
      if (open) { renderLink(); const x = $('inviteClose'); if (x) x.focus(); } else { const r = $('inviteRowBtn'); if (r) r.focus(); }
    };
    on('inviteRowBtn', 'click', () => invite(true));
    on('inviteClose', 'click', () => invite(false));
    if (inv) {
      inv.addEventListener('click', (e) => { if (e.target === inv) invite(false); });
      inv.addEventListener('keydown', (e) => { if (e.key === 'Escape') invite(false); });
    }
    // Calls: "Sound and mic" opens the Sound panel outside a call, to set it up and try Hear myself.
    const ss = $('soundSheet');
    let ssFrom = null;
    const soundSheet = (open, from) => {
      if (!ss) return;
      ss.hidden = !open;
      if (open) {
        ssFrom = from || null;
        const body = $('soundSheetBody');
        if (body && !body.firstChild) body.appendChild(soundPanel(document));
        soundUi();
        const x = $('soundClose'); if (x) x.focus();
      } else if (ssFrom && ssFrom.focus) ssFrom.focus();
    };
    document.querySelectorAll('[data-sound-open]').forEach((b) => b.addEventListener('click', () => soundSheet(true, b)));
    on('soundClose', 'click', () => soundSheet(false));
    if (ss) {
      ss.addEventListener('click', (e) => { if (e.target === ss) soundSheet(false); });
      ss.addEventListener('keydown', (e) => { if (e.key === 'Escape') soundSheet(false); });
    }
    on('boardBtn', 'click', () => boardSheet(true));
    on('nameInput', 'change', () => { if (boardOn && app.state === 'join') boardPlace('join'); });
    on('boardClose', 'click', () => boardSheet(false));
    on('boardSheet', 'click', (e) => { if (e.target === $('boardSheet')) boardSheet(false); });
    on('muteBtn', 'click', hostMute);
    on('camBtn', 'click', hostCam);
    on('layoutBtn', 'click', () => setLayout(V.mode === 'split' ? 'focus' : 'split'));
    on('screenBtn', 'click', () => { if (amSharing()) hostUnshare(); else shareOpen(true); });
    on('gCamBtn', 'click', guestCam);
    on('gScreenBtn', 'click', () => { if (G.display) guestUnshare(); else shareOpen(true); });
    shareWire();
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
    on('watchRoot', 'pointerup', zoomTap);
    wirePointing();
    on('chatBtn', 'click', () => chatOpen(!C.open));
    on('peek', 'click', () => { const p = $('peek'); if (!p) return; p.hidden = true; if (p.dataset.chat) chatOpen(true); });
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
    const sp = $('soundPop');
    if (sp) sp.appendChild(soundPanel(document));
    on('soundBtn', 'click', () => soundOpen(!!sp && sp.hidden));
    on('ytKeep', 'click', () => { if (W.id) ytSend({ id: W.id, at: ytWant(), play: true }); });
    on('ytStop', 'click', () => ytClose(false));
    document.addEventListener('pointerdown', (e) => {
      if (sp && !sp.hidden && !sp.contains(e.target) && !(e.target.closest && e.target.closest('#soundBtn'))) soundOpen(false);
    }, true);
    on('moreBtn', 'click', () => { if (moreOpen()) closeMore(); else openMore(); });
    on('moreClose', 'click', closeMore);
    on('tapToHear', 'click', () => {
      const vo = $('voice'), me = $('media');
      if (me && me.srcObject) { me.muted = outMuted(me); me.play().catch(() => {}); }
      if (vo) { vo.muted = outMuted(vo); vo.play().then(tapHide, () => {}); }
      if (G.ctx && G.ctx.state === 'suspended' && OUT.slept !== G.ctx) G.ctx.resume().catch(() => {});
      wakeControls();
    });
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
      else if (sp && !sp.hidden) soundOpen(false);
      else if (shareIsOpen()) shareOpen(false);
      else if (moreOpen()) closeMore();
      else if (C.open) chatOpen(false);
    });
    if (sheet) sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
    const more = $('moreSheet');
    if (more) more.addEventListener('click', (e) => { if (e.target === more) closeMore(); });
    on('endedAction', 'click', () => { if (MV.away) moveHere(); else if (isGuest) show('join'); else hostStart(store.get('beside.start') === 'video' ? 'video' : 'voice'); });
    on('moveBtn', 'click', moveHere);
    on('moveNot', 'click', () => { MV.dismissed = true; moveCardHide(); });
    on('nameInput', 'change', () => { if (app.state === 'join') moveProbe(moveFound); });
    document.addEventListener('pointerdown', () => {
      if (H.ctx && H.ctx.state === 'suspended' && OUT.slept !== H.ctx) H.ctx.resume().catch(() => {}); // not while it rests
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
      const onBubble = e.target && e.target.closest && e.target.closest('#bubbles, #bigSlot .tile.half');
      // Every click in that 700 ms is swallowed, so the second tap of a double tap never presses a bar button.
      if (wokeAt && Date.now() - wokeAt < 700 && inCall() && !onBubble) { e.stopPropagation(); e.preventDefault(); return; }
      wokeAt = 0;
    }, true);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') {
        // Leaving Beside (lock, another app or tab) pauses the video for everyone.
        if (W.id && W.play && inCallWithSomeone()) ytSend({ id: W.id, at: ytNow(), play: false, away: meName() || (isGuest ? 'Your guest' : 'Your host') });
        return;
      }
      if (W.id) setTimeout(() => { ytSync(true); ytBar(); }, 300);
      if (inCall() || (app.state === 'waiting' && Date.now() - G.waitSince < 20 * 60000)) stayAwake(true);
      resumeMedia();
    });
    const sv = $('screenVideo');
    if (sv) sv.addEventListener('webkitendfullscreen', () => { if (inCall()) sv.play().catch(() => {}); });
    addEventListener('hashchange', () => location.reload());
    addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); });
    addEventListener('beforeunload', (e) => { if (app.state === 'live') { e.preventDefault(); e.returnValue = ''; } });
    addEventListener('pagehide', () => {
      [H.peer, H.spare].forEach((p) => { if (p) { try { p.destroy(); } catch (e) {} } });
      if (G.peer) { try { G.peer.destroy(); } catch (e) {} }
      if (app.state === 'live' && bc) bc.postMessage('off');
    });
    if (sheet) sheet.hidden = true;
    if ($('hostName')) $('hostName').value = myName();
    const sb = $('screenBtn');
    if (sb) sb.hidden = false; // Share: links, photos, videos and files work everywhere
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
    // Already in this call on another device? Offer to move it here.
    // Is the call live on another of my devices? A probe that got no answer (now and then the first one doesn't)
    // asks again, twice.
    const bootProbe = (n) => moveProbe((r) => { if (!r && n < 2 && ['idle', 'join', 'ended'].includes(app.state)) setTimeout(() => bootProbe(n + 1), 1500); else moveFound(r); });
    if (window.Peer) whenNet(() => setTimeout(() => bootProbe(0), 400));
    if (!window.Peer) peerLibOk();
    ringBoot();
    // The Voice focus noise remover (voiceiso.js) plugs in here: fn(ctx, mode) gives the node that goes first.
    app.setVoicePre = (fn) => { CLEAR.pre = typeof fn === 'function' ? fn : null; clearRebuild(); };
    if (LOCAL) app.debug = { H, G, V, C, T, SND, OUT, CLEAR, ENGINE_OUT, MV, mini, setVol, setDuck, setMicMode, micWant, renderVoice, setTalk, clearChain, clearNodes, clearGate, clearRebuild, clearEss, CLEAR_TUNE, FOCUS_TUNE, FAR_TUNE, ISO, isoOff, W, ytWatch, ytClose }; // automated tests only
    app.booted = true;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
