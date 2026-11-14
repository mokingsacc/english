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
  // NET.life: how long the relay passwords last.
  const NET = { own: false, ice: srv ? [] : ICE, at: 0, p: null, relay: false, relayAt: 0, life: 12 * 3600e3 };
  const opts = (free) => ({ ...(OWN && NET.own && !free ? OWN : FREE), config: { iceServers: NET.ice }, debug: 0 });
  async function getJSON(u, ms, headers) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms);
    try { const r = await fetch(u, { cache: 'no-store', signal: c.signal, ...(headers ? { headers } : {}) }); return r.ok ? await r.json() : null; } catch (e) { return null; } finally { clearTimeout(t); }
  }
  // Checked when the page opens, and again before a call if it's been a while (the passwords last 12 hours, or an
  // hour once the room is locked).
  // Returns true when ready; otherwise NET.p resolves once it is.
  // Mo, 10 Nov 2026: "Can't connect you two ... It was working before". The relay carries a call across a network
  // that blocks direct calls, and three things could leave a device without it: one slow answer to the password
  // request meant no relay for six hours; a link left open for hours (our room) kept passwords past their 12
  // hours; and a retry after a failed connection used the same old passwords. Now a missing relay is asked for
  // again within a minute, every open link gets the newest passwords for its next connection (netPeers), they
  // are renewed while a link is open (netKeep), and a failed connection asks for fresh ones before it retries.
  // Once the room is locked they last an hour, and a call can last longer: a connection made keeps going, but a
  // reconnect needs passwords still good, so they are renewed quietly half way through their life, and a call
  // starting in their last quarter waits for new ones.
  function netReady() {
    if (!OWN || NET.p) return !OWN;
    const age = Date.now() - NET.at;
    const used = NET.relay ? (Date.now() - NET.relayAt) / NET.life : 0;
    if (NET.at && age < (NET.own ? 6 * 3600e3 : 60e3) && (used < 0.75 || age < 60e3)) {
      if (!srv && age > 60e3 && (!NET.relay || used > 0.5)) netAsk(); // no relay yet, or half used: ask again quietly, nobody waits for it
      return true;
    }
    netAsk();
    return false;
  }
  function netAsk() {
    if (!OWN || NET.p) return;
    const base = srv ? 'http://' + srv : '';
    // With the room and this device's key: once the room is locked, only a device on its list gets passwords.
    const k = store.get('beside.key') || '';
    const turnU = '/peerjs/turn?room=' + encodeURIComponent(boardRoom());
    NET.p = Promise.all([getJSON(base + '/peerjs/health', 3000), srv ? null : getJSON(turnU, 6000, /^[A-Za-z0-9_-]{43}$/.test(k) ? { 'x-beside-key': k } : null)]).then(([h, t]) => {
      NET.own = !!(h && h.ok);
      const relay = t && Array.isArray(t.iceServers) ? t.iceServers.filter((x) => x && x.username && x.credential) : [];
      // A request that failed keeps the passwords we have until near the end of their life: better than none.
      if (!srv && (relay.length || !NET.relay || Date.now() - NET.relayAt > NET.life * 11 / 12)) {
        NET.ice = ICE.concat(relay);
        NET.relay = relay.length > 0;
        if (NET.relay) { NET.relayAt = Date.now(); NET.life = Math.min(12 * 3600, t.ttl > 0 ? t.ttl : 12 * 3600) * 1000; }
      }
      app.net = { own: NET.own, relay: NET.relay };
      NET.at = Date.now();
      NET.p = null;
      netPeers();
    });
  }
  // PeerJS reads a link's settings each time it makes a connection, so an open link can be given new passwords.
  function netPeers() {
    [H.peer, H.spare, G.peer].forEach((p) => { if (p && !p.destroyed && p.options) p.options.config = { ...(p.options.config || {}), iceServers: NET.ice }; });
  }
  // While a link is open: renew in good time (every 10 minutes it checks; also when Beside comes back on screen).
  function netKeep() { if ((H.peer && !H.peer.destroyed) || (G.peer && !G.peer.destroyed)) netReady(); }
  // A connection just failed: get fresh relay passwords for the retry (at most every 20 s).
  function netAgain() { if (!srv && Date.now() - NET.at > 20000) netAsk(); }
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
  // Link looks like  .../beside/#abcd1234-Mo  : 8-letter room code, then the host's name.
  const hashM = location.hash.slice(1).match(/^([a-z0-9]{8})(?:-(.*))?$/);
  const guestCode = hashM ? hashM[1] : '';
  const isGuest = !!guestCode;
  // Your accent is the other person: the host's devices wear Semal's colour on the main button, the guest's Mo's.
  document.documentElement.classList.toggle('as-semal', isGuest);
  document.documentElement.classList.toggle('as-mo', !isGuest);
  function cleanName(n) { return String(n || '').replace(/[^\p{L}\p{N} .'-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 20); }
  // Your own other devices (iPad, iPhone) host the same room: open  .../?room=abcd1234  once there, or add that to the
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
  setInterval(netKeep, 10 * 60e3);
  // Not in a call (start, join, ended): the tabs. In a call (waiting, live, watching): the call, full screen.
  const SHELL = ['idle', 'join', 'ended'];
  function show(state) {
    const prev = app.state;
    const into = SHELL.includes(prev) && !SHELL.includes(state);
    const back = !!prev && !SHELL.includes(prev) && SHELL.includes(state);
    const snap = into ? tvSnap() : null; // before the tabs go
    if (into) { ['inviteSheet', 'soundSheet'].forEach((id) => { const sh = $(id); if (sh) sh.hidden = true; }); boardSheet(false); homeSheetsClose(); }
    if (app.state !== state) { app.states.push(state); if (app.states.length > 300) app.states.shift(); }
    app.state = state;
    document.body.dataset.app = state;
    callDark(state === 'live' || state === 'watching');
    document.querySelectorAll('[data-state]').forEach((el) => {
      if (el.dataset.state === 'check') return; // the check panel is an overlay
      if (el.hasAttribute('data-shell')) { el.hidden = !SHELL.includes(state); return; } // the Calls tab, for host or guest
      el.hidden = !el.dataset.state.split(' ').includes(state);
    });
    boardPlace(state);
    if (into) tvOpen(snap);
    else if (back) tvClose();
    if (state !== 'join') joinStage(false);
    if (state === 'live' || state === 'watching') { ringBanner(''); layout(); wakeControls(); clockRun(true); }
    else { closeMore(); shareOpen(false); soundOpen(false); document.body.classList.remove('idle'); if (SHELL.includes(state)) callReset(); }
    if (!isGuest) hostTitle();
  }
  function text(id, s) { const el = $(id); if (el) el.textContent = s; }
  // Calls are always dark: the sheets, banners and notes that open over a call take the call's dark set.
  function callDark(on) {
    ['note', 'moreSheet', 'shareSheet', 'boardSheet', 'linkBanner', 'bNote'].forEach((id) => { const el = $(id); if (el) el.classList.toggle('dark', on); });
    const ck = document.querySelector('.sheet[data-state="check"]');
    if (ck) ck.classList.toggle('dark', on);
  }
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
      room: boardRoom(), name: boardName(), them: isGuest ? theirName : '', role: isGuest ? 'guest' : 'host', go: (t) => setTab(t), onRender: boardRendered, onLock: lockSet, onDenied: lockDenied, key: () => LK.key, photoKey: () => LK.p,
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
  // Who is who: Mo's figure lives in London, Semal's in LA. The top of Home and the Ring button say their name.
  function boardRendered(pp) {
    app.people = pp;
    houseDraw();
  }

  // ---------- HOME: the house (Next Door), version A: a kitchen downstairs ----------
  // Upstairs, two rooms side by side, each with its own clock, a window with that city's weather and day or night, and a
  // light that is off late at night there. Downstairs, one shared kitchen: the calendar opens the month, the note on the
  // fridge opens the list, and the paper chain opens the countdown. Tap your own figure and it waves (only on this
  // screen: the board has no wave message to send).
  const ROOM_ID = { mo: 'ndRoomMo', semal: 'ndRoomSemal' };
  const HAND = { mo: ['#1B1D23', '#E2AE88'], semal: ['#1C1D22', '#E7B48F'] }; // paint: the figures' own sleeve and skin
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
    on('ndCal', 'click', () => calSheet(true));
    on('ndFridge', 'click', () => todoSheet(true));
    on('ndChain', 'click', () => boardSheet(true, 'count'));
    let rz = 0;
    addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(houseDraw, 150); }); // the hearts find room again
    // The house also changes size without the window doing so: the sidebar comes and goes, Home comes back from
    // another tab, the house turns wide. The hearts and the chain are placed again then too.
    if (window.ResizeObserver) new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(houseDraw, 150); }).observe($('house'));
  }
  // The top of Home: how the other person is, by their own clock. Asleep is the same 11 pm to 6 am that turns their
  // lamp off. The guest's phone says the same about the host.
  const dayPart = (h) => (h < 12 ? 'in the morning' : h < 17 ? 'in the afternoon' : h < 21 ? 'in the evening' : 'at night');
  function homeTop(hs) {
    const r = hs.rooms.find((x) => !x.mine);
    if (!r) return;
    const nm = r.name || (r.who === 'mo' ? 'Mo' : 'Semal');
    text('homeTitle', nm + (r.late ? ' is asleep' : ' is awake'));
    text('homeRingText', 'Ring ' + nm);
    text('homeSub', r.late ? 'It is night for them. A heart will wait.' : 'It is ' + r.clock + ' ' + dayPart(r.h) + ' for them.');
  }
  function houseDraw() {
    houseBoot();
    const hs = houseOn && window.BesideBoard && window.BesideBoard.house ? window.BesideBoard.house() : null;
    if (!hs) return;
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
      // under the house, one line: "London 12:24, 11° drizzle"
      text('ndTime' + id, r.clock);
      text('ndWx' + id, r.wx ? ', ' + r.wx : '');
      text('ndWx2' + id, r.wx || ''); // the same weather on its own line, in that place's card (iPad and Mac)
      const fig = $('ndFig' + id);
      fig.disabled = !r.mine;
      fig.setAttribute('aria-label', r.mine ? 'Wave' : nm + ' in ' + r.place + (r.late ? ', asleep' : ''));
    });
    homeTop(hs);
    const c = hs.countdown;
    const tag = !c ? 'Countdown' : c.today ? 'Today' : c.past ? c.title : c.days === 1 ? '1 day' : c.days + ' days';
    text('ndTag', tag);
    const ch = $('ndChain');
    if (ch) {
      // longer the more days are left, but always between the two lamps, so it hangs in front of neither
      let cap = 96;
      const box = ch.offsetParent && ch.offsetParent.getBoundingClientRect();
      const lamps = [...document.querySelectorAll('#house .nd-lamp')].map((l) => l.getBoundingClientRect()).filter((r) => r.width);
      if (box && box.width && lamps.length === 2) {
        const mid = box.left + box.width / 2;
        const half = Math.min(mid - Math.min(lamps[0].right, lamps[1].right), Math.max(lamps[0].left, lamps[1].left) - mid) - 6;
        cap = Math.max(20, (half * 2) / box.width * 100);
      }
      ch.style.setProperty('--chain', Math.min(cap, c && !c.past && !c.today ? Math.max(26, Math.min(96, 26 + c.days * 1.2)) : 60).toFixed(1) + '%');
      ch.setAttribute('aria-label', !c ? 'Countdown: set one' : c.past ? 'Countdown: ' + c.title + ' has been' : 'Countdown: ' + tag + ' to ' + c.title);
    }
    // the calendar on the kitchen wall: the month at 13 px, today ringed, a dot on days with plans, the next plan
    const m = hs.month;
    text('ndCalMonth', m.name);
    text('ndCalNext', hs.next ? hs.next.day + ', ' + hs.next.title : hs.loaded ? 'No plans yet' : '');
    const grid = $('ndCalGrid');
    const gk = [m.name, m.first, m.count, m.today, m.plans.join(',')].join('|');
    if (grid && grid.dataset.k !== gk) {
      grid.dataset.k = gk;
      const cell = (t, cls) => { const i = document.createElement('i'); i.textContent = t; if (cls) i.className = cls; return i; };
      const cells = 'MTWTFSS'.split('').map((d) => cell(d, 'wd'));
      for (let i = 0; i < m.first; i++) cells.push(cell('', ''));
      for (let d = 1; d <= m.count; d++) cells.push(cell(d, [d === m.today ? 't' : '', m.plans.includes(d) ? 'p' : ''].filter(Boolean).join(' ')));
      grid.replaceChildren(...cells);
    }
    if ($('ndCal')) $('ndCal').setAttribute('aria-label', 'Calendar, ' + m.name + (hs.next ? '. Next: ' + hs.next.title + ', ' + hs.next.day : ''));
    // the note on the fridge: the first three, and how many more
    const notes = $('ndNotes');
    if (notes) {
      // newest first, as in the list it opens
      const top = hs.todos.slice().reverse().slice(0, 3);
      const more = hs.todos.length - top.length;
      const key = top.join('|') + '|' + more + '|' + hs.loaded;
      if (notes.dataset.k !== key) {
        notes.dataset.k = key;
        const line = (cls, t) => { const n = document.createElement('span'); n.className = cls; n.textContent = t; return n; };
        if (!top.length) notes.replaceChildren(line('nd-none', hs.loaded ? 'Nothing yet. Tap to add.' : ''));
        else {
          notes.replaceChildren(...top.map((t) => {
            const row = document.createElement('span'); row.className = 'nd-todo';
            const sp = document.createElement('span'); sp.textContent = t;
            row.append(document.createElement('i'), sp);
            return row;
          }), ...(more > 0 ? [line('nd-more', 'and ' + more + ' more')] : []));
        }
      }
      $('ndFridge').setAttribute('aria-label', 'To-do list: ' + (hs.todos.length ? hs.todos.length + ' to do' : 'nothing yet'));
    }
    if (hs.loaded) {
      ['mo', 'semal'].forEach((who) => heartWall($(ROOM_ID[who]), (hs.hearts || []).filter((x) => x.who === who).slice(-30)));
      heartsReady = true; // the hearts already there on opening just sit; later ones pop on
    }
    // the calendar and the list, if open, follow the board too
    if (HS.cal) calDraw();
    if (HS.todo) todoDraw();
  }
  // The heart wall (Mo, 5 Nov 2026): each heart sent in the last 24 hours is a heart on the wall of the one it was sent to.
  // It only ever sits on bare wall (Mo, 10 Nov 2026: "now they kinda go and hide behind the person"). The rule: a heart
  // keeps clear of the drawn paper chain and its tag, of both figures (the whole body, with room to wave and lean), and
  // of everything drawn or tapped on the wall: the window, clock, picture and its name, and the lamp. (The calendar and
  // the fridge are downstairs in the kitchen, where no hearts go.) The chain's tap area reaches a little below the drawn
  // chain; a heart may sit there, as it covers nothing. The bare wall is cut into heart-sized places and each heart
  // takes the place its id picks, so it stays put. More hearts than places: they shrink a little, and past that the
  // newest ones show. A new one pops on (not with reduced motion).
  const HEART_SVG = '<svg viewBox="0 0 24 22" aria-hidden="true"><path d="M12 21.2C5.6 16.4 1 12.5 1 7.4 1 3.9 3.7 1.2 7 1.2c2 0 3.8 1 5 2.6 1.2-1.6 3-2.6 5-2.6 3.3 0 6 2.7 6 6.2 0 5.1-4.6 9-11 13.8z"/></svg>';
  const heartSeen = new Set();
  let heartsReady = false;
  function seeded(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  }
  function heartWall(room, list) {
    const layer = room && room.querySelector('.nd-hearts');
    if (!layer) return;
    const fresh = new Set(heartsReady ? list.filter((x) => !heartSeen.has(x.id)).map((x) => x.id) : []);
    list.forEach((ht) => heartSeen.add(ht.id));
    const W = room.clientWidth, H = room.clientHeight;
    if (!W) return;
    // The room's own pieces by where they stand (a wave or a press moves them for a moment; the hearts stay put).
    const own = (e, px, py) => ({ l: e.offsetLeft - px, t: e.offsetTop - py, r: e.offsetLeft + e.offsetWidth + px, b: e.offsetTop + e.offsetHeight + py });
    const R = room.getBoundingClientRect();
    const box = (e, pad) => { const r = e.getBoundingClientRect(); return { l: r.left - R.left - pad, t: r.top - R.top - pad, r: r.right - R.left + pad, b: r.bottom - R.top + pad }; };
    const keep = [...room.querySelectorAll('.nd-clock, .nd-pic, .nd-lamp')].map((e) => own(e, 5, 5));
    const win = room.querySelector('.nd-win');
    if (win) { const w = own(win, 5, 5); w.b += 3; keep.push(w); } // with its shadow
    const fig = room.querySelector('.nd-fig');
    if (fig) keep.push(own(fig, Math.max(6, fig.offsetWidth * 0.18), 6)); // the whole body, and the room its wave and lean take
    // the picture's name can be wider than the picture; the chain crosses both rooms (its rings and its tag)
    [...room.querySelectorAll('.nd-pic b'), ...document.querySelectorAll('#ndChain svg, #ndTag')].forEach((e) => keep.push(box(e, 4)));
    const floor = room.querySelector('.nd-floor');
    const bottom = (floor ? floor.offsetTop : H * 0.88) - 5;
    // Drawn again only when the hearts, or anything they must stay clear of, have changed (the calendar grows with a plan).
    const key = list.map((x) => x.id).join(',') + '|' + W + 'x' + H + '|' + bottom + '|' + keep.map((b) => [b.l, b.t, b.r, b.b].map(Math.round).join(' ')).join(',');
    if (layer.dataset.k === key) return;
    layer.dataset.k = key;
    if (!list.length) { layer.replaceChildren(); return; }
    // The places at one heart size: the bare wall, row by row, each a heart and a small gap from the next.
    const places = (s) => {
      const h = s * 22 / 24, gap = s * 0.34, out = [];
      for (let y = 6; y + h <= bottom; y += 2) {
        let x = 6;
        while (x + s <= W - 6) {
          const b = keep.find((k) => x < k.r && x + s > k.l && y < k.b && y + h > k.t);
          const p = b ? null : out.find((q) => Math.abs(q.x - x) < s + gap - 0.01 && Math.abs(q.y - y) < h + gap);
          if (b) x = Math.max(x + 1, b.r); else if (p) x = Math.max(x + 1, p.x + s + gap); else { out.push({ x, y }); x += s + gap; }
        }
      }
      return out;
    };
    const full = Math.max(15, Math.min(28, W * 0.095)); // big enough to read on a phone
    let s = full, spots = [];
    for (const k of [1, 0.9, 0.8, 0.72, 0.66]) { s = full * k; spots = places(s); if (spots.length >= list.length) break; }
    const taken = [];
    const out = (spots.length ? list.slice(-spots.length) : []).map((ht) => {
      const rnd = seeded(ht.id);
      let i = Math.floor(rnd() * spots.length);
      while (taken[i]) i = (i + 1) % spots.length;
      taken[i] = true;
      const nudge = () => (rnd() * 2 - 1) * s * 0.06; // a little off the row, never enough to touch a neighbour
      const el = document.createElement('i');
      el.className = 'nd-heart' + (fresh.has(ht.id) ? ' pop' : '');
      el.dataset.id = ht.id;
      el.style.cssText = 'left:' + ((spots[i].x + nudge()) / W * 100).toFixed(2) + '%;top:' + ((spots[i].y + nudge()) / H * 100).toFixed(2) + '%;width:' + s.toFixed(1) + 'px;--r:' + Math.round(rnd() * 24 - 12) + 'deg';
      el.innerHTML = HEART_SVG;
      return el;
    });
    layer.replaceChildren(...out);
  }

  // ---------- TABS ----------
  // Three tabs. Calls is no longer a tab: anything that still asks for it lands on Home with Calls and setup open.
  const TABS = ['home', 'plans', 'hearts'];
  const tabEl = (t) => $('tab' + t.charAt(0).toUpperCase() + t.slice(1));
  const tabScroll = {};
  app.tab = 'home';
  function setTab(name, instant) {
    if (name === 'calls') { setTab('home', instant); if (SHELL.includes(app.state)) setupSheet(true); return; }
    if (!TABS.includes(name)) name = 'home';
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
    // From 700 px wide the bar is a sidebar (up and down), an icon rail up to 900 px: there each tab and Calls and
    // setup show their word as a tooltip (a screen reader has the word all along).
    const side = window.matchMedia && matchMedia('(min-width:700px)'), rail = window.matchMedia && matchMedia('(min-width:700px) and (max-width:899.98px)');
    const fit = () => {
      if (bar) bar.setAttribute('aria-orientation', side && side.matches ? 'vertical' : 'horizontal');
      document.querySelectorAll('.tabbar button').forEach((b) => { if (rail && rail.matches) b.title = b.textContent.trim(); else b.removeAttribute('title'); });
    };
    fit();
    [side, rail].forEach((m) => { if (m && m.addEventListener) m.addEventListener('change', fit); });
    if (bar) bar.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!d) return;
      e.preventDefault(); // up and down move between tabs here, not the page
      const t = TABS[(TABS.indexOf(app.tab) + d + TABS.length) % TABS.length];
      setTab(t);
      const b = $('tb-' + t);
      if (b) b.focus();
    });
    setTab('home', true);
  }

  // ---------- HOME: one Ring button, a heart, and three sheets (Calls and setup, the calendar, the note on the fridge) ----------
  // The calendar and the fridge note each open a sheet that does the board's own work, so the house is never just a
  // picture (Mo, 11 Nov 2026: "the house style i like becaise the calender/ the to do list ect has functionality, keep
  // that functionality").
  const HS = { setup: false, cal: false, todo: false, back: {}, todoKey: '', calKey: '' };
  const HOME_SHEETS = { setup: 'setupSheet', cal: 'calSheet', todo: 'todoSheet' };
  // A sheet from Home fades in with its close button focused; closing it gives focus back to what opened it.
  function homeSheet(k, open, back) {
    const sh = $(HOME_SHEETS[k]);
    if (!sh || HS[k] === !!open) return;
    HS[k] = !!open;
    sh.hidden = !open;
    if (open) {
      HS.back[k] = back || document.activeElement;
      const x = sh.querySelector('.close');
      if (x) x.focus({ preventScroll: true });
    } else {
      let b = HS.back[k];
      HS.back[k] = null;
      if (k === 'setup' && !(b && b.getClientRects().length)) b = setupBtn(); // the round button is not on an iPad or a Mac
      if (b && b.focus && b.getClientRects().length) b.focus({ preventScroll: true });
    }
  }
  function homeSheetsClose() { Object.keys(HOME_SHEETS).forEach((k) => homeSheet(k, false)); }
  // whichever button opens Calls and setup on this screen size (Home's round one, or the sidebar's)
  const setupBtn = () => [...document.querySelectorAll('[data-setup-open]')].find((b) => b.getClientRects().length) || $('homeSetupBtn');
  function setupSheet(open) { if (open) homeSetupVals(); homeSheet('setup', open, $('homeSetupBtn')); }
  function calSheet(open) { homeSheet('cal', open, $('ndCal')); if (open) calDraw(); }
  function todoSheet(open) { homeSheet('todo', open, $('ndFridge')); if (open) todoDraw(true); }
  // Each row says how things are: the last check, the mic's way, rings on or off, the guest's name.
  function homeSetupVals() {
    text('setupSoundVal', MODE_TEXT[CLEAR.mode] ? MODE_TEXT[CLEAR.mode][0] : '');
    setupHealth();
    ringMeUi();
    text('nameRowVal', cleanName(store.get('beside.name') || ($('nameInput') && $('nameInput').value) || '') || 'Not set');
    lockUi();
    trustMsg('');
  }
  // "All good" once Check my setup found nothing wrong, or what it found. Before a check, only what is plain without
  // one: a browser that can't make calls, or a mic that is blocked.
  const CHECK_SHORT = { basics: 'Calls can’t work here', mic: 'Mic problem', server: 'Can’t reach Beside', net: 'Network problem', relay: 'Network problem', link: 'Connection problem' };
  function setupHealth() {
    const el = $('setupCheckVal');
    if (!el) return;
    const put = (t, bad) => { el.textContent = t; el.toggleAttribute('data-ok', !!t && !bad); el.toggleAttribute('data-bad', !!bad); };
    if (!window.RTCPeerConnection) { put(CHECK_SHORT.basics, true); return; }
    if (app.checkDone && app.checks) {
      const bad = Object.keys(app.checks).filter((k) => app.checks[k].state === 'bad');
      put(!bad.length ? 'All good' : bad.length === 1 ? CHECK_SHORT[bad[0]] || '1 problem' : bad.length + ' problems', bad.length > 0);
      return;
    }
    put(app.checks && Object.keys(app.checks).length ? 'Checking…' : '');
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'microphone' }).then((p) => { if (p.state === 'denied' && !app.checkDone) put('Mic is blocked', true); }).catch(() => {});
    }
  }
  // Ring them: a video call that rings their devices, the way Ring does inside a call. The host starts the room and
  // rings once it is open (unless they come in first); a guest knocks, and rings if the host isn't there yet.
  function homeRing() {
    homeSheetsClose();
    if (isGuest) {
      G.ringOnMiss = Date.now();
      guestJoin(true).then(() => { if (!G.left && !G.cam && G.peer) guestCam(); });
      return;
    }
    H.ringOnReady = Date.now();
    RG.ringAt = Date.now();
    hostStart('video');
  }
  // The round heart beside it: the same quick heart as before, with a tick for a moment.
  function homeHeart() {
    const b = $('homeHeartBtn');
    if (!b || b.disabled || !window.BesideBoard || !window.BesideBoard.heart) return;
    if (!window.BesideBoard.heart()) { note('Your hearts open in a moment. Try again.', 'info'); return; }
    b.disabled = true;
    const ico = (n) => (window.BesideIcons ? window.BesideIcons.svg(n, 22) : '');
    // the words show on an iPad or a Mac, where it is a button with words
    b.innerHTML = ico('check') + '<span>Sent</span>';
    b.setAttribute('aria-label', 'Sent');
    setTimeout(() => { b.disabled = false; b.innerHTML = ico('heart') + '<span>Send a heart</span>'; b.setAttribute('aria-label', 'Send a heart'); }, 2500);
  }
  // The calendar, opened: this month with a dot in each person's colour on their plan days, and the next plan.
  const WEEK_NAMES = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  function calDraw() {
    const B = window.BesideBoard;
    const grid = $('calGrid');
    if (!grid || !B || !B.month) return;
    const m = B.month();
    const key = JSON.stringify([m.name, m.today, m.days, m.next, m.loaded]);
    if (key === HS.calKey) return;
    HS.calKey = key;
    text('calTitle', m.name);
    const names = $('calNames');
    if (names && !names.firstChild) WEEK_NAMES.forEach((w) => { const sp = document.createElement('span'); sp.textContent = w; names.append(sp); });
    const cells = [];
    for (let i = 0; i < m.first; i++) cells.push(document.createElement('span'));
    for (let d = 1; d <= m.count; d++) {
      const info = m.days[d];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hcal-day' + (d === m.today ? ' today' : '');
      const n = document.createElement('b');
      n.textContent = String(d);
      const dots = document.createElement('u');
      dots.setAttribute('aria-hidden', 'true');
      (info ? info.who : []).forEach((w) => { const s2 = document.createElement('s'); if (w === 'semal') s2.className = 'semal'; dots.append(s2); });
      b.append(n, dots);
      const long = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(Date.UTC(m.y, m.mo - 1, d, 12));
      b.setAttribute('aria-label', long + (d === m.today ? ', today' : '') + (info ? ', ' + info.titles.join(', ') : ''));
      if (d === m.today) b.setAttribute('aria-current', 'date');
      const k = m.key + String(d).padStart(2, '0');
      b.addEventListener('click', () => { calSheet(false); B.planDay(k); });
      cells.push(b);
    }
    grid.replaceChildren(...cells);
    const nx = $('calNext');
    if (nx) {
      nx.replaceChildren();
      if (m.next) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'hnext';
        const bar = document.createElement('i');
        if (m.next.who === 'semal') bar.className = 'semal';
        const w = document.createElement('span');
        const t = document.createElement('b');
        t.textContent = m.next.title;
        const l = document.createElement('small');
        l.textContent = m.next.line;
        w.append(t, l);
        b.append(bar, w);
        b.insertAdjacentHTML('beforeend', window.BesideIcons ? window.BesideIcons.svg('chev', 18) : '');
        b.setAttribute('aria-label', 'Next plan: ' + m.next.title + ', ' + m.next.line + '. Open Plans');
        b.addEventListener('click', () => { calSheet(false); B.planDay(m.next.key); });
        nx.append(b);
      } else if (m.loaded) {
        const p = document.createElement('p');
        p.className = 'hempty';
        p.textContent = 'No plans yet this month.';
        nx.append(p);
      }
    }
  }
  // The note on the fridge, opened: each row one tap to tick; swipe left (or the cross, with a mouse) to delete.
  function todoDraw(force) {
    const B = window.BesideBoard;
    const list = $('todoList');
    if (!list || !B || !B.todoList) return;
    const t = B.todoList();
    const key = JSON.stringify(t);
    if (!force && key === HS.todoKey) return;
    // A row being swiped is left alone; the list catches up when the finger lifts.
    if (list.querySelector('.hrow-go.drag')) return;
    HS.todoKey = key;
    const had = document.activeElement && list.contains(document.activeElement) ? document.activeElement : null;
    const hadId = had ? (had.closest('.hrow') || {}).dataset : null;
    const openId = (list.querySelector('.hrow.open') || { dataset: {} }).dataset.id;
    const icon = (n, z) => (window.BesideIcons ? window.BesideIcons.svg(n, z) : '');
    list.replaceChildren(...t.items.map((it) => {
      const row = document.createElement('div');
      row.className = 'hrow' + (it.done ? ' done' : '');
      row.dataset.id = it.id;
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'hrow-go';
      go.setAttribute('role', 'checkbox');
      go.setAttribute('aria-checked', String(it.done));
      const tick = document.createElement('span');
      tick.className = 'hrow-tick';
      tick.innerHTML = icon('check', 16);
      const w = document.createElement('span');
      w.className = 'hrow-words';
      const b = document.createElement('b');
      b.textContent = it.text;
      w.append(b);
      if (it.from) { const sm = document.createElement('small'); sm.textContent = 'From ' + it.from; w.append(sm); }
      go.append(tick, w);
      go.addEventListener('click', (e) => {
        if (go.dataset.swiped) { delete go.dataset.swiped; e.preventDefault(); return; }
        if (row.classList.contains('open')) { row.classList.remove('open'); return; }
        B.todoTick(it.id);
      });
      swipeRow(row, go);
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'hrow-del';
      del.setAttribute('aria-label', 'Delete ' + it.text);
      del.innerHTML = icon('x', 20);
      const dw = document.createElement('span');
      dw.textContent = 'Delete';
      del.append(dw);
      del.addEventListener('click', () => B.todoDelete(it.id));
      row.append(go, del);
      return row;
    }));
    if (openId) { const r = list.querySelector('.hrow[data-id="' + CSS.escape(openId) + '"]'); if (r) r.classList.add('open'); }
    let empty = $('todoEmpty');
    if (!empty) { empty = document.createElement('p'); empty.id = 'todoEmpty'; empty.className = 'hempty'; list.after(empty); }
    const open = t.items.filter((x) => !x.done).length;
    empty.textContent = !t.loaded ? 'Opening the list…' : !t.items.length ? 'Nothing on the list yet.' : !open ? 'All done.' : '';
    empty.hidden = !empty.textContent;
    if (hadId && hadId.id) {
      const r = list.querySelector('.hrow[data-id="' + CSS.escape(hadId.id) + '"]');
      const f = r && r.querySelector('.hrow-go');
      if (f) f.focus({ preventScroll: true });
      else { const inp = $('todoInput'); if (inp) inp.focus({ preventScroll: true }); }
    }
  }
  // Swipe a row left to show Delete; a short swipe springs back. Up and down still scroll the sheet.
  function swipeRow(row, go) {
    let x0 = 0, y0 = 0, dx = 0, id = null, sliding = false;
    const open0 = () => row.classList.contains('open');
    go.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      id = e.pointerId; x0 = e.clientX; y0 = e.clientY; dx = 0; sliding = false;
    });
    go.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const mx = e.clientX - x0, my = e.clientY - y0;
      if (!sliding) {
        if (Math.abs(my) > 10 && Math.abs(my) > Math.abs(mx)) { id = null; return; }
        if (Math.abs(mx) < 10) return;
        sliding = true;
        go.classList.add('drag');
        try { go.setPointerCapture(id); } catch (x) {}
      }
      dx = Math.max(-120, Math.min(0, mx + (open0() ? -96 : 0)));
      go.style.transform = 'translateX(' + dx + 'px)';
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      if (!sliding) return;
      sliding = false;
      go.classList.remove('drag');
      go.style.transform = '';
      go.dataset.swiped = '1';
      setTimeout(() => { delete go.dataset.swiped; }, 400);
      $('todoList').querySelectorAll('.hrow.open').forEach((r) => { if (r !== row) r.classList.remove('open'); });
      row.classList.toggle('open', dx < -48);
      todoDraw();
    };
    go.addEventListener('pointerup', end);
    go.addEventListener('pointercancel', end);
  }
  function homeBoot() {
    // Calls and setup: the round button on Home (phone) or the sidebar's row (iPad and Mac); closing gives focus back to it
    document.querySelectorAll('[data-setup-open]').forEach((b) => b.addEventListener('click', () => { setupSheet(true); HS.back.setup = b; }));
    on('homeRingBtn', 'click', homeRing);
    on('homeHeartBtn', 'click', homeHeart);
    on('setupClose', 'click', () => setupSheet(false));
    on('calClose', 'click', () => calSheet(false));
    on('todoClose', 'click', () => todoSheet(false));
    on('calAdd', 'click', () => { calSheet(false); if (window.BesideBoard && window.BesideBoard.planDay) window.BesideBoard.planDay(''); });
    on('todoForm', 'submit', (e) => {
      e.preventDefault();
      const inp = $('todoInput');
      if (!inp) return;
      if (window.BesideBoard && window.BesideBoard.todoAdd && window.BesideBoard.todoAdd(inp.value)) inp.value = '';
      inp.focus();
    });
    // The rows that open a sheet of their own close this one first; Ring this phone and Use my room stay in it.
    const setupRows = $('setupSheet');
    if (setupRows) setupRows.addEventListener('click', (e) => {
      const r = e.target.closest && e.target.closest('[data-check-open], [data-sound-open], #inviteRowBtn, #nameRowBtn, #startBtn, #joinBtn');
      if (r) homeSheet('setup', false);
    }, true);
    on('nameRowBtn', 'click', () => { const row = $('nameRow'), inp = $('nameInput'); if (row) row.hidden = false; if (inp) { inp.focus(); inp.select(); } });
    Object.keys(HOME_SHEETS).forEach((k) => {
      const sh = $(HOME_SHEETS[k]);
      if (!sh) return;
      sh.addEventListener('click', (e) => { if (e.target === sh) homeSheet(k, false); });
      sh.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); homeSheet(k, false); } });
    });
    // A tap anywhere but an open row closes it.
    document.addEventListener('pointerdown', (e) => {
      const l = $('todoList');
      if (!l || !HS.todo) return;
      const r = e.target.closest && e.target.closest('.hrow');
      l.querySelectorAll('.hrow.open').forEach((x) => { if (x !== r) x.classList.remove('open'); });
    }, true);
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
    scr.className = 'tvfx-screen dark';
    fx.append(scr);
    document.body.append(fx);
    const ground = getComputedStyle(scr).getPropertyValue('--bg').trim();
    const from = { ...snap.screen, round: snap.tv ? 3 : 32 };
    scr.animate([
      // paint:start (the TV's warm glow and its switched-off grey belong to the drawing)
      { clipPath: clip(from), opacity: snap.tv ? 0 : 1, backgroundColor: '#E8A87C' },
      { clipPath: clip(from), opacity: 1, backgroundColor: '#E8A87C', offset: lead ? lead / (lead + 700) : 0.001 },
      { clipPath: clip(FULL()), opacity: 1, backgroundColor: ground },
      // paint:end
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
    scr.className = 'tvfx-screen dark';
    fx.append(scr);
    document.body.append(fx);
    const ground = getComputedStyle(scr).getPropertyValue('--bg').trim();
    const tv = app.tab === 'calls' && $('tvBox') && $('tvBox').querySelector('.tv-screen');
    const r = tv && tv.getClientRects().length ? { ...rectOf(tv.getBoundingClientRect()), round: 3 } : { left: innerWidth / 2 - 50, top: innerHeight / 2 - 32, width: 100, height: 64, round: 18 };
    scr.animate([
      // paint:start
      { clipPath: clip(FULL()), backgroundColor: ground, opacity: 1 },
      { clipPath: clip(r), backgroundColor: tv ? '#2A2D35' : ground, opacity: 1, offset: 0.8 },
      { clipPath: clip(r), backgroundColor: '#2A2D35', opacity: 0 },
      // paint:end
    ], { duration: 760, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'forwards' }).onfinish = () => { if (tvFx === fx) tvDone(); };
  }

  function on(id, ev, fn) { const el = $(id); if (el) el.addEventListener(ev, fn); }
  let noteTimer = 0;
  // acts: [label, fn] pairs, each a word button that closes the note (a device asking to come in, during a call).
  function note(msg, kind, acts) {
    app.log.push(msg);
    const el = $('note');
    if (!el) return;
    clearTimeout(noteTimer);
    delete el.dataset.ask;
    if (!msg) { el.hidden = true; return; }
    el.textContent = msg;
    (acts || []).forEach(([label, fn]) => {
      const b = document.createElement('button');
      b.className = 'note-act';
      b.textContent = label;
      b.onclick = () => { el.hidden = true; fn(); };
      el.appendChild(b);
    });
    const x = document.createElement('button');
    x.setAttribute('aria-label', 'Close');
    x.innerHTML = window.BesideIcons ? window.BesideIcons.svg('x', 18) : '';
    x.onclick = () => { el.hidden = true; };
    el.appendChild(x);
    el.dataset.kind = kind || 'info';
    el.hidden = false;
    if (kind !== 'stay') noteTimer = setTimeout(() => { el.hidden = true; }, 7000);
  }
  // The call shows no speed number (Check my setup keeps the numbers). "Weak connection" shows only once the round
  // trip has been bad (200 ms or more) for a few seconds, and goes a few seconds after it is fine again.
  const LAG = { bad: 0, ok: 0, q: '' };
  function setLag(id, ms) {
    const el = $(id);
    if (!el) return;
    const q = ms == null ? 'none' : ms < 80 ? 'calm' : ms < 200 ? 'ok' : 'bad';
    const now = Date.now();
    LAG.q = q;
    el.dataset.q = q;
    if (q === 'bad') { LAG.ok = 0; if (!LAG.bad) LAG.bad = now; if (now - LAG.bad >= 3500) el.hidden = false; }
    else {
      LAG.bad = 0;
      if (!LAG.ok) LAG.ok = now;
      if (q === 'none' || now - LAG.ok >= 3500) el.hidden = true;
    }
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
  // A blocked camera gets its own small sheet of steps; anything else stays a short message.
  function camFail(e, kind) { if (e && e.name === 'NotAllowedError' && steps(/system/i.test(e.message || '') ? 'camMac' : 'cam')) return; note(camError(e), kind); }
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
  // a computer listening lifts the voice (LIFT).
  const SEND_RAW = IS_IOS;
  // Said under Clear voice, Voice focus and Far away there: only a computer listening lifts the voice.
  const RAW_SAY = ' This works when they listen on a computer. An iPhone or iPad plays your voice just as your phone sends it.';
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
      else if (dead && sum > 0) { dead = false; report(); } // sound came back: the leveller is used again
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
        if (dead) { dead = false; report(); }
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
    if (!fresh.getAudioTracks()[0]) return;
    app.micSwap = 'track';
    await micSwap(fresh, tr, hint);
  }
  // A fresh mic takes the old one's place everywhere the old one was used, so the call carries on.
  async function micSwap(fresh, tr, hint) {
    const nt = fresh.getAudioTracks()[0];
    try { nt.contentHint = hint; } catch (e) {}
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
      nt.enabled = !H.muted;
      if (H.clear) H.clear.swap(fresh);
      else if (H.rawSrc && H.ctx) { try { H.rawSrc.disconnect(); } catch (e) {} H.rawSrc = H.ctx.createMediaStreamSource(fresh); H.rawSrc.connect(H.micGain); }
      hostVoicePick();
      old.getTracks().forEach((x) => x.stop());
    }
  }
  // LIFT: an iPhone sending its mic as it comes in Clear voice, Voice focus or Far away asks the other side to run
  // the same processing on its voice before playing it (Mo, 2 Nov 2026: "and it will lift hers for mine?"). A
  // computer does. An iPhone or iPad plays it as it comes, straight through the page (see outRest). Old copies of
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
  // ducking under a voice (Mo, 2 Nov 2026). Safari on a Mac (and the Mac app) plays every sound through the audio
  // engine, where each lane has its own volume (ENGINE_OUT). Other computer browsers play through the page (their
  // echo cancelling hears that best), and use the engine only to go above 100% or to lift an iPhone's voice
  // (LIFT). If the engine stops or its clock stalls, the page plays it again at once. An iPhone or iPad always
  // plays through the page, never through the engine, and the buttons on its side set the volume, because it
  // ignores a page's volume (see outRest below).
  const CAN_VOL = true;
  const UA = navigator.userAgent;
  const ENGINE_OUT = !IS_IOS && /AppleWebKit/.test(UA) && !/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS|Android|OPR/.test(UA);
  const DUCK = 0.25; // about -12 dB under a voice
  function savedVol(k, max) { const v = parseFloat(store.get(k)); return v >= 0 && v <= max ? v : 1; }
  const SND = { voice: savedVol('beside.vol.voice', 1.5), media: savedVol('beside.vol.media', 1), duck: store.get('beside.duck') !== '0' };
  const OUT = { map: new Map(), duck: 1, duckT: 1, clocks: new Map(), timer: 0, rest: false, idleAt: 0 };
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
      // Never on an iPhone or iPad, not even while the host's engine is briefly alive (see outRest).
      if (ctx && tr && ctx.state !== 'closed' && !outRest()) {
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
      if (l.el.muted && l.el.srcObject) {
        l.el.muted = false;
        if (l.el.paused) l.el.play().catch(() => {}); // the phone may have paused it while the engine played
      }
      const v = Math.min(1, outLevel(l, false));
      if (Math.abs(l.el.volume - v) > 0.001) l.el.volume = v;
    }
    l.route = eng ? 'engine' : 'page';
  }
  // Does this lane need the engine? On an iPhone or iPad, never (OUT.rest). On Safari on a Mac and the Mac app,
  // always; elsewhere a voice does only to be lifted or to go above 100%.
  function outEngine(l) {
    if (!l.gain || OUT.rest || !engineOk(l.ctx)) return false;
    return ENGINE_OUT || (l.kind === 'voice' && (!!l.chain || SND.voice > 1));
  }
  // Mo, 5 Nov 2026: "when im watching a youtube video on the app together then there is crackles, both when we're
  // speaking and when the video is playing". 10 Nov: "I want the sound quality to be A1 because that was the whole
  // purpose of building this app". 12 Nov: "It still crackles, mainly on the iPhone, when I'm hearing her voice on
  // my phone it crackles, and then my voice for her just stopps, like when I'm talking it just stops sometimes
  // apparently". On an iPhone or iPad, an audio engine that merely exists makes the phone run ALL of the call's
  // sound (the mic with Apple's voice processing, and everything you hear) in slices of 128 frames, under 3 ms;
  // when they fall behind, it crackles, both what you hear and the mic you send. Pausing the engine does not undo
  // that (the first fix, 5 Nov, paused it, and the crackle stayed): only closing it does. A voice played through
  // the engine there also leaves Apple's own call path (the one its echo canceller listens to) and goes through a
  // bridge into the engine that drops and clicks. The 11 Nov fix closed it only while a video was open together.
  // So on an iPhone or iPad, in every call, what you hear always plays through the page (at full volume, not
  // lifted: the buttons on the side set the volume), and the engine is closed whenever the call's own sound
  // doesn't need it (engineBusy). Computers are unchanged.
  function outRest() { return IS_IOS; }
  // Does the call's own sound pass through the engine? A host needs it until one guest is settled in: the lanes
  // of a call are made from its tracks, and three or more people get a mix that only it can make.
  function engineBusy() {
    if (CV.snd) return true;
    if (isGuest) return !!G.vctx && G.vctx === G.ctx;
    if (!H.mic || H.guests.size !== 1) return true;
    const g = [...H.guests.values()][0];
    return !g.live || !g.voice || Date.now() - (g.liveAt || 0) < 1500 || (!!H.mediaTrack && g.ver < 3 && g.id !== H.sharer);
  }
  function engineUp() {
    if (outCtx()) return false;
    let ctx = null;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return false; }
    ctx.resume().catch(() => {});
    if (isGuest) G.ctx = ctx; else hostEngineBuild(ctx);
    return true;
  }
  function engineDown() {
    const ctx = outCtx();
    if (!ctx) return;
    if (isGuest) G.ctx = null; else hostEngineDrop();
    [...OUT.map.values()].forEach(outDrop);
    outEls().forEach(([el, kind, lift]) => outApply(outLane(el, kind, lift))); // on the page from here
    ctx.close().catch(() => {});
  }
  // iPhone and iPad only: the engine is closed once the call's own sound doesn't need it (engineBusy), and made
  // again when it does. It waits 2 s before closing, so a need that comes and goes at once doesn't close it and
  // make it again.
  function outIdle() {
    if (!IS_IOS) return;
    const live = isGuest ? app.state === 'watching' : app.state === 'live';
    if (!live) return;
    if (!OUT.rest || engineBusy()) {
      OUT.idleAt = 0;
      if (!outCtx() && engineUp()) applyVolumes();
    } else if (outCtx()) {
      if (!OUT.idleAt) OUT.idleAt = Date.now();
      else if (Date.now() - OUT.idleAt > 2000) { OUT.idleAt = 0; engineDown(); }
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
    soundWatch();
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

  // ---------- SOUND WATCH ----------
  // Mo, 10 Nov 2026: "sometimes just randomly i cant hear her and she cant here me, figure out why this happens and
  // how we can fix it". A phone can take a call's sound away without telling the page: a phone call, Siri, an
  // alarm, headphones going in or out, the lock screen. It pauses what plays and cuts the mic, on one phone, so
  // both of you go silent at once. Nothing started them again (a guest's sound came back only on returning to
  // the page, a host's only on a tap). So every 2 s in a call, on coming back to Beside, and when the phone says
  // its sound changed: a paused sound plays again, a stopped engine starts again, and a mic the phone cut or
  // ended is asked for again. Each side also reads what arrives from the other: if nothing does, it asks that
  // device to restart its mic. "Fix sound" does all of it on both sides at once; pressed twice, it connects the
  // call again. What happened is kept in a short log, shown in Check my setup.
  const SW = { timer: 0, log: [], lanes: new Map(), plays: new WeakSet(), micBadAt: 0, micHid: false, micBusy: 0, micP: null, micPF: false, micTry: 0, micFails: 0, fixAt: 0, sayT: 0, owed: '', owedFix: false };
  try { SW.log = (JSON.parse(store.get('beside.sndlog') || '[]') || []).filter((e) => e && typeof e.w === 'string' && e.t > 0).slice(-30); } catch (e) { SW.log = []; }
  function inCallNow() { return isGuest ? app.state === 'watching' : app.state === 'live'; }
  // A phone gives an app in the background neither the mic nor a new player; a computer's tab gets both.
  function inBack() { return IS_IOS && document.visibilityState !== 'visible'; }
  function sndLog(what) {
    const now = Date.now();
    const last = SW.log[SW.log.length - 1];
    if (last && last.w === what && now - last.t < 60000) { last.n = (last.n || 1) + 1; last.t = now; } else SW.log.push({ t: now, w: what });
    if (SW.log.length > 30) SW.log.splice(0, SW.log.length - 30);
    store.set('beside.sndlog', JSON.stringify(SW.log));
    sndLogShow();
  }
  function sndLogShow() {
    const box = $('sndLog'), list = $('sndLogList');
    if (!box || !list) return;
    const sum = box.querySelector('summary .sl-t') || box.querySelector('summary');
    if (sum) sum.textContent = 'Sound log, ' + (SW.log.length ? SW.log.length + (SW.log.length === 1 ? ' line' : ' lines') : 'nothing yet');
    const cur = $('sndNow');
    if (cur) cur.textContent = !inCallNow() ? '' : !outCtx() ? 'Right now the sound engine is closed: voices play straight through the page.' : 'Right now the sound engine is on.';
    list.textContent = '';
    SW.log.slice().reverse().forEach((e) => {
      const li = document.createElement('li');
      const tm = document.createElement('time');
      const d = new Date(e.t);
      tm.textContent = d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
      tm.dateTime = d.toISOString();
      const s = document.createElement('span');
      s.textContent = e.w + (e.n > 1 ? ' (' + e.n + ' times)' : '');
      li.append(tm, s);
      list.appendChild(li);
    });
  }
  function soundWatch() {
    if (SW.timer || !inCallNow()) return;
    SW.timer = setInterval(() => {
      if (!inCallNow()) { clearInterval(SW.timer); SW.timer = 0; SW.lanes.clear(); SW.micBadAt = SW.micFails = 0; SW.micHid = SW.owedFix = false; SW.owed = ''; return; }
      soundCheck();
      laneWatch();
    }, 2000);
  }
  // Put right whatever on this device stopped the call's sound.
  function soundCheck() {
    if (!inCallNow()) return;
    document.querySelectorAll('#screenVideo, #watchRoot .tile video').forEach((v) => { if (v.srcObject && v.paused) v.play().catch(() => {}); });
    const tap = $('tapToHear');
    const waits = !!tap && !tap.hidden; // "Tap to hear" already shows: try again without showing it again
    outEls().forEach(([el]) => {
      if (!el.srcObject || !el.paused || SW.plays.has(el)) return;
      SW.plays.add(el);
      (isGuest ? playWithSound(el, waits) : el.play().then(() => true, () => false)).then((ok) => {
        SW.plays.delete(el);
        if (ok && !el.paused) sndLog('A sound that had been paused was started again.');
      });
    });
    // A sound meant to play on the page must not be left muted there.
    OUT.map.forEach((l) => { if (l.route === 'page' && l.el.muted && l.el.srcObject) { l.el.muted = false; sndLog('A sound that had been left muted was turned back on.'); } });
    [outCtx(), G.vctx].forEach((ctx) => {
      if (!ctx || ctx.state === 'running' || ctx.state === 'closed') return;
      ctx.resume().then(() => { if (ctx.state === 'running') sndLog('The sound engine had stopped. It was started again.'); }).catch(() => {});
    });
    if (isGuest) guestVoicePick(); else hostVoicePick();
    if (SW.owed && !inBack()) {
      const who = SW.owed, fix = SW.owedFix;
      SW.owed = '';
      SW.owedFix = false;
      if (fix) soundFix(who); else micAgain(who + ' heard nothing from your mic, so it was started again.', true);
    } else micWatch();
  }
  // A mic the phone cut (for 2.5 s or more, with Beside in front) or ended is asked for again.
  function micWatch() {
    const stream = isGuest ? G.mic : H.mic;
    const tr = stream && stream.getAudioTracks()[0];
    if (!tr || SW.micBusy) return;
    const ended = tr.readyState !== 'live';
    if (!ended && !tr.muted) {
      if (SW.micBadAt) { SW.micBadAt = SW.micFails = 0; sndLog('Your mic came back by itself.'); }
      return;
    }
    const now = Date.now();
    if (!SW.micBadAt) { SW.micBadAt = now; sndLog(ended ? 'Your mic stopped.' : 'Your mic was cut by this device.'); }
    if (inBack()) { SW.micHid = true; return; }
    if (SW.micHid) { SW.micHid = false; SW.micBadAt = now; } // back in front: the phone gets its 2.5 s to give the mic back
    if (!ended && (!IS_IOS || now - SW.micBadAt < 2500)) return; // elsewhere a cut mic is often a headset's own mute
    if (now - SW.micTry < (SW.micFails >= 3 ? 30000 : 8000)) return;
    micAgain('Your mic was started again.');
  }
  function micWhy(e) {
    const n = (e && e.name) || '';
    return n === 'NotAllowedError' ? 'this device did not allow it' : n === 'NotFoundError' ? 'no mic was found' : n === 'NotReadableError' || n === 'AbortError' ? 'the mic is busy somewhere else' : 'this device gave no reason';
  }
  // Waits its turn behind a change of mic mode. force: also when the mic looks fine from here.
  function micAgain(why, force) {
    if (SW.micP && (SW.micPF || !force)) return SW.micP; // one is already waiting its turn
    const run = async () => {
      const stream = isGuest ? G.mic : H.mic;
      const tr = stream && stream.getAudioTracks()[0];
      if (!tr || !inCallNow()) return false;
      if (!force && tr.readyState === 'live' && !tr.muted) return true; // it came back while this waited
      SW.micTry = Date.now();
      try {
        const fresh = await getOwn('audio', micWant(CLEAR.mode));
        const nt = fresh.getAudioTracks()[0];
        const gone = (isGuest ? G.mic : H.mic) !== stream || !inCallNow();
        if (gone || !nt || nt.readyState !== 'live' || (nt.muted && tr.readyState === 'live')) {
          fresh.getTracks().forEach((x) => x.stop());
          if (!gone) SW.micFails++;
          return false;
        }
        await micSwap(fresh, tr, CLEAR.mode === 'music' ? 'music' : 'speech');
        SW.micBadAt = SW.micFails = 0;
        sndLog(why);
        return true;
      } catch (e) {
        SW.micFails++;
        sndLog('Your mic could not be started again: ' + micWhy(e) + '.');
        return false;
      }
    };
    SW.micBusy++;
    const p = CLEAR.q.then(run, run).catch(() => false);
    CLEAR.q = p;
    const me = p.then((ok) => { SW.micBusy--; if (SW.micP === me) SW.micP = null; return ok; });
    SW.micP = me;
    SW.micPF = !!force;
    return me;
  }
  // What arrives on each voice lane, read from the call itself. Nothing arriving on a connected call for 6 s means
  // the other device stopped sending: it is asked to restart its mic. Perfect silence for 20 s is only noted (they
  // may simply be muted or quiet): a restart there could click in the middle of a quiet film.
  async function laneWatch() {
    const voice = $('voice');
    const list = isGuest
      ? [{ id: hostId, pc: G.call && G.call.peerConnection, track: voice && voice.srcObject ? voice.srcObject.getAudioTracks()[0] : null, conn: G.conn, name: theirName || 'Your host' }]
      : [...H.guests.values()].filter((g) => g.live).map((g) => ({ id: g.id, pc: g.call && g.call.peerConnection, track: g.voice, conn: g.conn, name: g.name || 'Your guest' }));
    for (const p of list) {
      const pc = p.pc;
      const rc = pc && p.track && /^(connected|completed)$/.test(pc.iceConnectionState) ? pc.getReceivers().find((x) => x.track === p.track) : null;
      if (!rc) { SW.lanes.delete(p.id); continue; }
      let bytes = null, energy = null;
      try {
        (await rc.getStats()).forEach((r) => {
          if (r.type !== 'inbound-rtp') return;
          bytes = r.bytesReceived;
          if (typeof r.totalAudioEnergy === 'number') energy = r.totalAudioEnergy;
        });
      } catch (e) { continue; }
      if (typeof bytes !== 'number') continue;
      const now = Date.now();
      let l = SW.lanes.get(p.id);
      if (!l || l.track !== p.track) { SW.lanes.set(p.id, { track: p.track, bytes, energy, bAt: now, eAt: now, seen: false, asks: 0, flats: 0, askAt: 0, quiet: false }); continue; }
      if (bytes !== l.bytes) { l.bytes = bytes; l.bAt = now; if (l.seen && l.asks) l.asks = 0; l.seen = true; }
      if (energy !== l.energy) { l.energy = energy; l.eAt = now; l.quiet = false; l.flats = 0; }
      const stall = l.seen && now - l.bAt > 6000;
      const flat = !stall && l.seen && energy != null && !l.quiet && now - l.eAt > 20000;
      if (stall && l.asks < 3 && now - l.askAt > 15000) {
        l.asks++;
        l.askAt = now;
        sndLog('Nothing was arriving from ' + p.name + '’s mic. Their device was asked to restart it.');
        tell(p.conn, { t: 'snd', q: 'stall' });
      } else if (flat && l.flats < 3 && now - l.askAt > 15000) {
        l.flats++;
        l.askAt = now;
        tell(p.conn, { t: 'snd', q: 'flat' });
      }
    }
  }
  // The other side asks about this device's sound (q), answers (a), or pressed Fix sound (fix).
  function soundAsked(d, g) {
    if (!inCallNow()) return;
    if (g && !rate(g, 'sndT', 5)) return;
    const conn = g ? g.conn : G.conn;
    const who = g ? g.name || 'Your guest' : theirName || 'Your host';
    if (d.fix && inBack()) {
      // Restarting players or the engine from the background can lose the sound this phone still has.
      SW.owed = who;
      SW.owedFix = true;
      sndLog(who + ' pressed Fix sound while Beside was in the background here. The sound is restarted when you come back.');
      tell(conn, { t: 'snd', a: 'away' });
    } else if (d.fix === 2) {
      if (!isGuest) return;
      sndLog(who + ' pressed Fix sound twice, so the call was connected again.');
      guestLost();
    } else if (d.fix) soundFix(who);
    else if (d.q === 'stall') {
      const stream = isGuest ? G.mic : H.mic;
      if (!stream) tell(conn, { t: 'snd', a: 'muted' });
      else if (inBack()) { SW.owed = who; tell(conn, { t: 'snd', a: 'away' }); }
      else {
        soundCheck();
        micAgain(who + ' heard nothing from your mic, so it was started again.', true).then((ok) => tell(conn, { t: 'snd', a: ok ? 'fixed' : 'failed' }));
      }
    } else if (d.q === 'flat') {
      const ch = isGuest ? G.clear : H.clear;
      const muted = isGuest ? G.muted || !G.mic : H.muted || !H.mic;
      tell(conn, { t: 'snd', a: muted ? 'muted' : ch && ch.ok ? 'quiet' : 'open' });
    } else if (typeof d.a === 'string') {
      const l = SW.lanes.get(g ? g.id : hostId);
      if (!l) return;
      if (d.a === 'muted' || d.a === 'quiet' || d.a === 'open') l.quiet = true;
      if (d.a === 'open') sndLog(who + '’s mic sent only silence for 20 seconds. If you can’t hear them, press Fix sound.');
      else if (d.a === 'away') {
        sndLog(who + ' has Beside in the background. Their sound is restarted when they come back.');
        if (SW.sayT) fixSay(who + ' has Beside in the background. Their sound is restarted when they come back.');
      }
      else if (d.a === 'fixed') sndLog(who + '’s mic was started again.');
      else if (d.a === 'failed') sndLog(who + '’s mic could not be started again.');
    }
  }
  // Fix sound: every sound gets a fresh player, the engine's lanes are made again, and the mic is asked for again,
  // here and on the other side. by: the other person's name when they pressed it.
  function soundFix(by) {
    if (!inCallNow()) return;
    const now = Date.now();
    if (!by) {
      const twice = now - SW.fixAt < 30000;
      SW.fixAt = twice ? 0 : now;
      if (twice) {
        sndLog('You pressed Fix sound twice, so the call was connected again.');
        fixSay('Connecting the call again…');
        if (isGuest) guestLost(); else toGuests({ t: 'snd', fix: 2 });
        return;
      }
      sndLog('You pressed Fix sound.');
      if (isGuest) tell(G.conn, { t: 'snd', fix: 1 }); else toGuests({ t: 'snd', fix: 1 });
    } else {
      sndLog(by + ' pressed Fix sound.');
      note(by + ' pressed Fix sound, so the sound was restarted here too.', 'info');
    }
    [...OUT.map.values()].forEach(outDrop);
    outEls().forEach(([el]) => {
      const tr = el.srcObject && el.srcObject.getAudioTracks()[0];
      if (!tr) return;
      el.srcObject = new MediaStream([tr]);
      if (isGuest) playWithSound(el); else el.play().catch(() => {});
    });
    const ctx = outCtx();
    if (IS_IOS && ctx && !engineBusy()) engineDown(); // made again by itself if something needs it
    else if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {});
    applyVolumes();
    if (isGuest) guestVoicePick(); else hostVoicePick();
    if (!inBack()) micAgain('Your mic was started again.', true);
    if (!by) fixSay('The sound was restarted on both sides. Still nothing? Press again to connect the call again.');
  }
  function fixSay(txt) {
    document.querySelectorAll('.sound-fix-say').forEach((el) => { el.textContent = txt; });
    if (mini.els && mini.els.snd) mini.els.snd.querySelectorAll('.sound-fix-say').forEach((el) => { el.textContent = txt; });
    clearTimeout(SW.sayT);
    SW.sayT = txt ? setTimeout(() => fixSay(''), 30000) : 0;
  }
  // The Beside app says when the phone's sound changed hands (Calls.swift).
  const SND_NATIVE = {
    began: 'This device took the sound away for something else.',
    ended: 'This device gave the sound back.',
    route: 'The sound moved to another speaker or headphones.',
    reset: 'This device restarted its sound.',
    call: 'The ring handed the call over to Beside.',
  };
  function soundNative(why) {
    if (!inCallNow() || !SND_NATIVE[why]) return;
    sndLog(SND_NATIVE[why]);
    if (why === 'began') return;
    [300, 1500, 4000].forEach((ms) => setTimeout(soundCheck, ms));
    if (why === 'reset') setTimeout(() => micAgain('Your mic was started again.', true), 800);
  }

  // Who is talking: the host listens to every voice and tells everyone. The chip's dot pulses softly while someone
  // else talks (no outlines on any picture).
  const T = { ids: new Set(), sig: '', timer: 0, last: new Map(), buf: null };
  function renderTalk() {
    const has = (el) => !!el.dataset.pid && T.ids.has(el.dataset.pid);
    document.querySelectorAll('#watchRoot .tile').forEach((el) => el.classList.toggle('talking', has(el)));
    const me = isGuest ? G.peer && G.peer.id : H.me;
    const chip = $('callChip');
    if (chip) chip.classList.toggle('talking', [...T.ids].some((id) => id && id !== me));
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
  // With no engine (an iPhone or iPad host once the call has settled, see outRest) the call itself says how loud
  // each voice it receives is.
  // Such a host can't measure its own mic (blind), so each guest measures the host's voice the same way.
  function rxLevel(pc, track) {
    try {
      const r = pc && track && pc.getReceivers().find((x) => x.track === track);
      let v = 0;
      (r && r.getSynchronizationSources ? r.getSynchronizationSources() : []).forEach((x) => { if (x.audioLevel > v) v = x.audioLevel; });
      return v;
    } catch (e) { return 0; }
  }
  function hostListen() {
    clearInterval(T.timer);
    T.timer = setInterval(() => {
      if (app.state !== 'live') return;
      const now = Date.now();
      const eng = H.ctx;
      const run = !!eng && eng.state === 'running'; // a stopped engine's meters hold their last sound
      if (run && loud(H.micAn) > 0.02) T.last.set(H.me, now);
      const ids = now - (T.last.get(H.me) || 0) < 1300 ? [H.me] : [];
      for (const g of H.guests.values()) {
        if (!g.live) continue;
        const lv = eng ? (run ? loud(g.an) : 0) : rxLevel(g.call && g.call.peerConnection, g.voice);
        if (lv > 0.02) T.last.set(g.id, now);
        if (now - (T.last.get(g.id) || 0) < 1300) ids.push(g.id);
      }
      const blind = !eng;
      if (setTalk(ids) || blind !== T.blind) { T.blind = blind; toGuests({ t: 'talk', ids, blind }); }
    }, 120);
  }
  // A guest: what the host says, plus the host's own voice when the host can't measure it.
  function guestTalk() {
    const now = Date.now();
    const ids = (T.host || []).filter((x) => x !== hostId || !T.blind);
    if (T.blind) {
      const el = $('voice');
      if (rxLevel(G.call && G.call.peerConnection, el && el.srcObject && el.srcObject.getAudioTracks()[0]) > 0.02) T.last.set(hostId, now);
      if (now - (T.last.get(hostId) || 0) < 1300) ids.push(hostId);
      if (!T.gTimer) T.gTimer = setInterval(() => { if (T.blind && app.state === 'watching') guestTalk(); else { clearInterval(T.gTimer); T.gTimer = 0; } }, 150);
    }
    setTalk(ids);
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
  // The Beside look: their picture fills the pane and you are a round dot at its corner. Drag the dot to any corner,
  // tap it to swap; both are kept for this call only. The same stage has other views (#watchRoot[data-view]):
  // alone (ringing, or waiting for someone), split (Side by side, from More), share (the shared thing on top, the
  // faces below) and film (the film on top, their face below). With three or more, the others are small round
  // pictures down the right: tap one to make it big.
  const V = { pin: '', auto: '', focus: 'them', sbs: false, corner: 'br', pair: false, view: '', since: 0, lastWith: 0, withName: '', faceName: '', skyAt: 0, clock: 0, snapAt: 0 };
  const ico = (n, s, o) => (window.BesideIcons ? window.BesideIcons.svg(n, s, o) : '');
  const PERSON = ico('person');
  // Which figure is whose: yours, and the other one's.
  function whoMe() { const b = window.BesideBoard; return b ? b.people().me : isGuest ? 'semal' : 'mo'; }
  function whoThem() { return whoMe() === 'mo' ? 'semal' : 'mo'; }
  function headSvg(who) { return window.BesideFigures && who ? window.BesideFigures.figure(who, { pose: 'head', label: '' }) : ''; }
  function putHead(el, who) { if (!el || el.dataset.who === who) return; el.dataset.who = who; el.innerHTML = headSvg(who); }
  // The other one's room on Home: their name there, their time and their weather.
  function theirRoom() { try { const h = window.BesideBoard && window.BesideBoard.house(); return (h && h.rooms.find((r) => !r.mine)) || null; } catch (e) { return null; } }
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
  function sharerName() {
    const sid = sharerId();
    if (isGuest) return sid === hostId ? hostLabel() : (G.room && G.room.name) || '';
    const g = guestById(sid);
    return (g && g.name) || '';
  }
  const pad2 = (n) => (n < 10 ? '0' : '') + n;
  function lasted(ms) {
    const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    return (h ? h + ':' + pad2(m) : m) + ':' + pad2(s % 60);
  }
  function layout() {
    const root = $('watchRoot'), bigSlot = $('bigSlot'), bub = $('bubbles'), park = $('parking'), dot = $('dotSlot');
    if (!root || !bigSlot || !bub || !park || !dot) return;
    preCam();
    const scr = screenSource();
    setTrack($('screenTile'), scr);
    const others = [];
    let alone = false, name = '', avatarId = '', many = false, mine = null;
    const selfT = $(isGuest ? 'gSelf' : 'selfFace');
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
      mine = G.cam && G.cam.getVideoTracks()[0];
      many = G.people.length > 0;
      if (selfT) selfT.dataset.pid = (G.peer && G.peer.id) || '';
    } else {
      const live = watchers();
      alone = !live.length;
      live.forEach((g) => { if (g.tile) others.push(g.tile); });
      name = live.length ? live[0].name || '' : '';
      avatarId = live.length ? live[0].id : '';
      mine = H.cam ? H.camSlot : null;
      many = live.length > 1;
      if (selfT) selfT.dataset.pid = H.me || '';
    }
    // you: your camera, or your figure's head while it is off
    setTrack(selfT, mine || null);
    if (selfT) { selfT.classList.toggle('nocam', !mine); putHead(selfT.querySelector('.self-fig'), whoMe()); }
    const avatar = $('avatarTile');
    if (avatar) avatar.dataset.pid = avatarId;
    const screen = scr ? $('screenTile') : null;
    const ytOn = !!W.id && !!$('ytBox') && !$('ytBox').hidden;
    const them = others[0] || avatar; // their camera, or the sky where they are
    V.pair = !alone && !many;
    const sbsOk = V.pair && !screen && !ytOn;
    const view = alone ? 'alone' : ytOn ? 'film' : screen ? 'share' : sbsOk && V.sbs ? 'split' : 'beside';
    let big = null, halves = null, dotT = null, smalls = [];
    if (view === 'alone') big = $('inviteTile');
    else if (view === 'split') halves = [them, selfT];
    else if (view === 'share') {
      V.auto = 'screen';
      big = screen;
      if (V.pin) { const p = others.concat([avatar]).find((el) => el && el.dataset.key === V.pin); if (p) big = p; else V.pin = ''; }
      // The faces window is open: the faces are there, so the shared screen here stays clear.
      smalls = mini.win && big === screen ? [] : [screen].concat(others.length ? others : [avatar], [selfT]).filter((el) => el && el !== big);
    } else if (V.pair) {
      big = V.focus === 'self' ? selfT : them;
      dotT = big === selfT ? them : selfT;
    } else {
      // three or more: one big (the first, or the one you tapped), the others small, you in the dot
      const first = others[0] || avatar;
      V.auto = first ? first.dataset.key : '';
      big = first;
      if (V.pin) { const p = others.find((el) => el.dataset.key === V.pin); if (p) big = p; else V.pin = ''; }
      smalls = others.filter((el) => el !== big);
      dotT = selfT;
    }
    V.view = view;
    root.dataset.view = view;
    root.dataset.faces = smalls.length ? '1' : '';
    root.dataset.ring = view === 'alone' && ringingNow() ? '1' : '';
    // the dot stays clear of the small pictures down the right and of the film's controls
    const corner = view === 'film' || (smalls.length && view !== 'share') ? 'b' + V.corner.charAt(1) : V.corner;
    dot.dataset.corner = corner;
    const keep = new Set([big, dotT].concat(smalls, halves || []).filter(Boolean));
    root.querySelectorAll('.tile').forEach((el) => {
      if (keep.has(el)) return;
      el.hidden = true;
      el.classList.remove('big', 'small', 'half', 'dot');
      if (el.parentNode !== park) park.appendChild(el);
    });
    const put = (el, box, i, kind) => {
      el.hidden = false;
      ['big', 'small', 'half', 'dot'].forEach((k) => el.classList.toggle(k, k === kind));
      if (box.children[i] !== el) {
        box.insertBefore(el, box.children[i] || null);
        const v = el.querySelector('video');
        if (v && v.srcObject) v.play().catch(() => {}); // iPhone can pause a moved video
      }
    };
    if (halves) halves.forEach((el, i) => put(el, bigSlot, i, 'half'));
    else if (big) put(big, bigSlot, 0, 'big');
    smalls.forEach((el, i) => put(el, bub, i, 'small'));
    if (dotT) put(dotT, dot, 0, 'dot');
    document.body.dataset.toast = view === 'share' && smalls.length ? 'faces' : dotT && corner.charAt(0) === 'b' ? 'dot' : '';
    const lb = $('layoutBtn');
    if (lb) { lb.hidden = !sbsOk; lb.setAttribute('aria-pressed', view === 'split' ? 'true' : 'false'); }
    // their initial (or a plain figure) while their camera is off; the board draws their figure instead when it
    // knows who they are (an event, nothing else), and then the tile is the sky where they are
    const ini = $('avatarInitial');
    if (ini) { if (name) ini.textContent = name.charAt(0).toUpperCase(); else ini.innerHTML = PERSON; }
    if (name !== V.faceName) { V.faceName = name; document.dispatchEvent(new CustomEvent('beside:face', { detail: { name: name || '' } })); }
    text('avatarName', name || (isGuest ? 'Your host' : 'Your guest'));
    text('avatarLabel', name);
    const fig = $('avatarFig');
    if (avatar) { avatar.classList.toggle('sky', !!(fig && fig.dataset.who)); if (avatar.classList.contains('sky')) skyDraw(); }
    // the chip: who, and how long; their camera off says so
    const camOff = V.pair && them === avatar;
    const n = isGuest ? 2 + G.people.length : watchers().length + 1;
    text('callTitle', !V.pair ? n + ' people' : camOff ? (name ? name + '’s camera is off' : 'Their camera is off') : name || 'In the call');
    const chatEl = $('chat');
    if (chatEl) chatEl.classList.toggle('many', n > 2); // the chat names who wrote only when three or more are in
    const chip = $('callChip');
    if (chip) chip.classList.toggle('camoff', camOff);
    if (inCallWithSomeone() && !(isGuest ? G.left : H.stopping)) { // not while the call is being taken down
      const now = Date.now();
      if (!V.since || now - V.lastWith > 60000) { V.since = now; snapClear(); }
      V.lastWith = now;
      if (name && V.pair) V.withName = name;
    }
    callClock();
    shareBar(screen);
    if (view === 'alone') aloneDraw();
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
  // The clock in the chip, once a second; a still of their picture now and then for the sheet when the call ends.
  function callClock() {
    const on = (app.state === 'live' || app.state === 'watching') && inCallWithSomeone();
    text('callTime', on && V.since ? lasted(Date.now() - V.since) : '');
    if (on) { V.lastWith = Date.now(); if (Date.now() - V.snapAt > 5000) snapTake(); }
  }
  function clockRun(on) {
    clearInterval(V.clock);
    V.clock = on ? setInterval(callClock, 1000) : 0;
  }
  function snapTake() {
    V.snapAt = Date.now();
    const v = document.querySelector('#bigSlot .tile.big:not(.self):not(.screen) video');
    const bg = $('endBg');
    if (!v || !bg || v.readyState < 2 || !v.videoWidth) return;
    let c = bg.querySelector('canvas');
    if (!c) { c = document.createElement('canvas'); bg.appendChild(c); }
    c.width = 96; c.height = Math.max(1, Math.round((96 * v.videoHeight) / v.videoWidth));
    try { c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); } catch (e) {}
  }
  function snapClear() { const c = document.querySelector('#endBg canvas'); if (c) c.remove(); }
  // Out of the call: the dot, the swap and Side by side start fresh next time.
  function callReset() {
    V.corner = 'br'; V.focus = 'them'; V.sbs = false; V.since = 0; V.lastWith = 0; V.withName = '';
    clockRun(false);
    delete document.body.dataset.toast;
    const lg = $('lag');
    if (lg) lg.hidden = true;
    LAG.bad = LAG.ok = 0;
  }
  // Someone shares: a glass bar across the top says what, with Stop for your own.
  function shareBar(screen) {
    const b = $('shareBar');
    if (!b) return;
    b.hidden = !screen;
    if (!screen) return;
    const me = amSharing();
    const track = isGuest ? G.screenTrack : H.video;
    const who = sharerName();
    text('shareBarText', me ? shareWhat(track) : who ? who + ' is sharing' : 'Someone is sharing');
    text('shareLabel', me ? shareWhat(track) : who);
    const st = $('shareBarStop');
    if (st) st.hidden = !me;
    const kind = me && CV.kind === 'photo' ? 'photo' : me && CV.kind === 'video' ? 'play' : me && CV.kind === 'browse' ? 'link' : 'screen';
    const ic = $('shareBarIcon');
    if (ic && ic.dataset.k !== kind) { ic.dataset.k = kind; ic.innerHTML = ico(kind, 22); }
  }
  // The host alone: ringing them, or waiting for someone to open the link. Their head, and the time where they are.
  function ringingNow() { return !isGuest && Date.now() - (RG.ringAt || 0) < 45000; }
  function clock12(h, mi) {
    const part = h < 5 ? 'at night' : h < 12 ? 'in the morning' : h < 17 ? 'in the afternoon' : h < 21 ? 'in the evening' : 'at night';
    return (h % 12 || 12) + ':' + pad2(mi) + ' ' + part;
  }
  function aloneDraw() {
    const ring = ringingNow();
    const box = document.querySelector('#inviteTile .alone');
    if (box) box.classList.toggle('ringing', ring);
    const room = theirRoom();
    const nm = RG.name || (room && room.name) || '';
    const joining = [...H.guests.values()].filter((g) => !g.live);
    text('aloneTitle', joining.length === 1 ? (joining[0].name || 'Someone') + ' is joining…'
      : joining.length ? joining.length + ' people are joining…'
        : ring ? 'Ringing ' + (nm || 'them') : nm ? 'Waiting for ' + nm : 'Waiting for someone');
    text('aloneTime', room ? 'It is ' + clock12(room.h, room.mi) + ' for them.' : '');
    putHead($('aloneFig'), whoThem());
    const v = $('aloneCam'), cam = H.cam ? H.camSlot : null;
    if (!v) return;
    if (cam) { if (!v.srcObject || v.srcObject.getVideoTracks()[0] !== cam) v.srcObject = new MediaStream([cam]); v.play().catch(() => {}); }
    else if (v.srcObject) v.srcObject = null;
    v.classList.toggle('on', !!cam);
  }
  // Their camera is off: the sky where they are (day or night, and the weather, the same as their window on Home),
  // and the two of you on one sofa, seen from behind, looking at it together.
  const SKY_CLOUD = (c) => '<svg class="sky-cloud ' + c + '" viewBox="0 0 120 42"><g fill="currentColor"><rect y="16" width="120" height="26" rx="13"/><rect x="30" width="60" height="32" rx="16"/></g></svg>';
  const SKY_STARS = [[18, 22, 1.4], [52, 60, 1], [80, 14, 1.2], [118, 40, 1], [150, 18, 1.5], [176, 70, 1], [210, 30, 1.2], [240, 58, 1], [268, 16, 1.3], [290, 48, 1], [32, 96, 1], [132, 92, 1.1], [228, 100, 1]];
  const SKY_FALL = { rain: 'ndRain', thunder: 'ndRain', drizzle: 'ndDrizzle', snow: 'ndSnow' };
  function skyDraw() {
    const el = $('avatarSky');
    if (!el || (el.firstChild && Date.now() - V.skyAt < 60000)) return;
    V.skyAt = Date.now();
    const r = theirRoom() || { kind: 'none', night: false };
    const kind = r.kind || 'none';
    el.dataset.sky = r.night ? 'night' : ['cloud', 'fog', 'drizzle', 'rain', 'thunder', 'snow'].includes(kind) ? 'grey' : '';
    el.dataset.wx = kind;
    if (!el.firstChild) {
      el.innerHTML = '<svg class="sky-stars" viewBox="0 0 300 120" preserveAspectRatio="xMidYMid slice"><g fill="currentColor">' +
        SKY_STARS.map((s) => '<circle cx="' + s[0] + '" cy="' + s[1] + '" r="' + s[2] + '"/>').join('') + '</g></svg>' +
        '<span class="sky-sun"></span>' + SKY_CLOUD('c1') + SKY_CLOUD('c2') + SKY_CLOUD('c3') +
        '<svg class="sky-wx"><rect width="100%" height="100%"/></svg><span class="sky-fog"></span>' +
        '<svg class="sky-hills" viewBox="0 0 374 200" preserveAspectRatio="none"><path class="h1" d="M0 64q90 -40 190 -10t184 -16V200H0z"/><path class="h2" d="M0 114q120 -30 220 0t154 -10V200H0z"/></svg>' +
        '<div class="sky-sofa">' + (window.BesideFigures ? window.BesideFigures.sofaBack({ label: '' }) : '') + '</div>';
    }
    const fall = el.querySelector('.sky-wx rect');
    if (fall) fall.setAttribute('fill', 'url(#' + (SKY_FALL[kind] || 'ndRain') + ')');
  }
  // The waiting stage (a guest): your own camera, or your figure; their head in the empty dot.
  function preCam() {
    const v = $('waitCam'), s = G.cam;
    putHead($('waitFig'), whoMe());
    putHead($('waitDot'), whoThem());
    if (!v) return;
    if (s) { if (v.srcObject !== s) v.srcObject = s; v.play().catch(() => {}); }
    else if (v.srcObject) v.srcObject = null;
    v.classList.toggle('on', !!s);
  }

  // The dot: drag it to any corner (it settles in the nearest one), tap it to swap who is big. A tap is a touch
  // that hardly moved; the swap happens on the dot itself, so the stage's own tap (wake the bars) is not a swap.
  function dotWire() {
    const d = $('dotSlot');
    if (!d) return;
    let s = null;
    d.addEventListener('pointerdown', (e) => {
      if (e.button > 0 || s) return;
      s = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
      try { d.setPointerCapture(e.pointerId); } catch (x) {}
    });
    d.addEventListener('pointermove', (e) => {
      if (!s || e.pointerId !== s.id) return;
      const dx = e.clientX - s.x, dy = e.clientY - s.y;
      if (!s.moved && Math.hypot(dx, dy) < 8) return;
      s.moved = true;
      d.classList.add('drag');
      d.style.transform = 'translate(' + Math.round(dx) + 'px,' + Math.round(dy) + 'px)';
    });
    const end = (e) => {
      if (!s || e.pointerId !== s.id) return;
      const moved = s.moved;
      s = null;
      if (!moved) { if (e.type === 'pointerup') dotTap(); return; }
      const box = $('watchRoot').getBoundingClientRect(), r = d.getBoundingClientRect();
      const cx = r.left + r.width / 2 - box.left, cy = r.top + r.height / 2 - box.top;
      V.corner = (cy < box.height / 2 ? 't' : 'b') + (cx < box.width / 2 ? 'l' : 'r');
      app.dotMoves = (app.dotMoves || 0) + 1;
      d.classList.remove('drag');
      void d.offsetWidth; // from where the finger left it, into the corner
      d.style.transform = '';
      layout();
    };
    d.addEventListener('pointerup', end);
    d.addEventListener('pointercancel', end);
    d.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); dotTap(); } });
  }
  function dotTap() {
    if (!V.pair || (V.view !== 'beside' && V.view !== 'film')) return; // your own dot among three or more never swaps
    V.focus = V.focus === 'self' ? 'them' : 'self';
    app.swaps = (app.swaps || 0) + 1;
    layout();
  }
  // A tap on a small picture makes it big; tap the one that was big (now small) to go back. You never go big here.
  function swapTap(e) {
    const t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    if (CV.kind === 'video' && amSharing() && t.closest('#screenTile')) { videoToggle(); return; }
    const s = t.closest('#bubbles .tile.small');
    if (!s) return;
    const k = s.dataset.key;
    if (!k || k === 'self' || k === 'invite') return;
    V.pin = k === V.auto ? '' : k;
    layout();
  }
  // More: the tray above the bar. Setup is today's More sheet, a bottom sheet on phones and a card on computers.
  function trayIsOpen() { const t = $('tray'); return !!t && !t.hidden; }
  function trayOpen(on) {
    const t = $('tray'), b = $('moreBtn');
    if (!t) return;
    t.hidden = !on;
    if (b) b.setAttribute('aria-expanded', on ? 'true' : 'false');
    if (on) {
      soundOpen(false);
      wakeControls();
      const f = t.querySelector('.tb:not([hidden])');
      if (f && !matchMedia('(pointer: coarse)').matches) f.focus();
    }
  }
  function setupIsOpen() { const m = $('moreSheet'); return !!m && !m.hidden; }
  function moreOpen() { return trayIsOpen() || setupIsOpen(); }
  function setupOpen() {
    const m = $('moreSheet');
    if (!m) return;
    trayOpen(false);
    const ch = $('changeBtn');
    if (ch) ch.hidden = !amSharing() || isGuest || !!CV.kind;
    setupVals();
    m.hidden = false;
    wakeControls();
    const x = $('moreClose');
    if (x) x.focus();
  }
  // Setup's rows show their current value: the picture priority, your name, the last Check my setup, and which
  // device the ring row is about. Rings, the mode and the name keep their own code; this only reads them.
  function setupVals() {
    text('modeVal', H.mode === 'motion' ? 'Smooth motion' : 'Sharp text');
    text('nameVal', myName());
    const cv = $('checkVal');
    if (cv) {
      const bad = app.checkDone ? Object.values(app.checks || {}).filter((c) => c.state === 'bad').length : -1;
      cv.textContent = bad < 0 ? '' : bad ? bad + (bad === 1 ? ' problem' : ' problems') : 'All good';
      cv.classList.toggle('good', bad === 0);
      cv.classList.toggle('bad', bad > 0);
    }
    const pad = /iPad/.test(navigator.userAgent) || (IS_IOS && Math.min(screen.width, screen.height) >= 600);
    text('ringRowName', pad ? 'Ring this iPad' : matchMedia('(pointer: coarse)').matches ? 'Ring this phone' : 'Ring this computer');
  }
  function closeMore() { trayOpen(false); const m = $('moreSheet'); if (m) m.hidden = true; }
  // Watch a film: the Share sheet, at its link field (a YouTube link plays for everyone).
  function filmAsk() {
    shareOpen(true);
    shareFilm();
  }
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
  // Each person is one colour everywhere: Mo blue, Semal gold, anyone else neutral.
  function dotColor(id) {
    const me = isGuest ? (G.peer && G.peer.id) : H.me;
    if (id && id === me) return ['var(--me)', 'var(--on-me)'];
    const pair = isGuest ? id === hostId : (watchers()[0] || {}).id === id;
    return pair ? ['var(--them)', 'var(--on-them)'] : ['var(--ink-2)', 'var(--bg)'];
  }
  function dotEl(doc, x, y, from, name) {
    const el = doc.createElement('div');
    el.className = 'dot';
    el.style.left = Math.round(x * 1000) / 10 + '%';
    el.style.top = Math.round(y * 1000) / 10 + '%';
    const dc = dotColor(from);
    el.style.setProperty('--dc', dc[0]);
    el.style.setProperty('--dct', dc[1]);
    const nm = doc.createElement('span');
    nm.className = 'dot-name';
    nm.textContent = name || '';
    el.appendChild(nm);
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
  // Picture), like Teams. Two people: their face fills it and you are a round dot bottom right, as in the call;
  // three people split three ways, four make a grid. One glass pill bottom left: Mic, Camera and a red End.
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
      note('The faces window didn’t open. Press Small window to try again.', 'info');
      return;
    }
    mini.opening = false;
    if (!inCallWithSomeone()) { try { win.close(); } catch (e) {} return; }
    const d = win.document;
    const css = document.querySelector('style');
    const st = d.createElement('style');
    st.textContent = css ? css.textContent : '';
    // the tokens come with the page's styles; the fonts are their own links
    document.querySelectorAll('link[rel=stylesheet]').forEach((l) => d.head.appendChild(d.importNode(l, false)));
    const meta = d.createElement('meta');
    meta.name = 'color-scheme';
    meta.content = 'light dark';
    d.head.append(meta, st);
    d.title = 'Beside';
    d.documentElement.className = 'dark ' + (isGuest ? 'as-semal' : 'as-mo');
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
    const acts = div('fw-acts');
    const bar = div('fw-bar');
    const stopBar = div('fw-bar fw-stopbar');
    stopBar.hidden = true;
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
    // End does what the call's own end button does (the host ends the call, a guest leaves it)
    const endFrom = isGuest ? '#leaveBtn' : '#stopBtn';
    const endB = $(isGuest ? 'leaveBtn' : 'stopBtn');
    bar.append(btn('mute', 'Mic', isGuest ? '#gMuteBtn' : '#muteBtn'), btn('cam', 'Camera', isGuest ? '#gCamBtn' : '#camBtn', 'cam'),
      btn('end', (endB && endB.getAttribute('aria-label')) || 'End the call', endFrom, 'end'));
    stopBar.append(stop);
    acts.append(bar, stopBar);
    // Sound: a small round button top right that shows when the pointer moves; its panel opens below it
    const sndBtn = CAN_VOL ? btn('sound', 'Sound', '#soundBtn', 'fw-sndbtn') : null;
    if (sndBtn) sndBtn.setAttribute('aria-expanded', 'false');
    root.append(grid, stage, peek, wait, snd, acts);
    if (sndBtn) root.append(sndBtn);
    d.body.appendChild(root);
    root.addEventListener('click', (e) => { const b = e.target.closest('[data-act]'); if (b) act(b.dataset.act); });
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
    mini.els = { grid, stage, v, dots, peek, wait, bar, stopBar, sndBtn, snd, root };
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
    else if (name === 'sound' && mini.els) {
      mini.els.snd.hidden = !mini.els.snd.hidden;
      mini.els.root.classList.toggle('awake', !mini.els.snd.hidden);
      if (mini.els.sndBtn) mini.els.sndBtn.setAttribute('aria-expanded', mini.els.snd.hidden ? 'false' : 'true');
    } else if (name === 'end') { const e = $(isGuest ? 'leaveBtn' : 'stopBtn'); if (e) e.click(); return; }
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
    mini.els.root.dataset.n = String(n);
    // two people: their face fills the window and you are the dot (sized by the styles, not here)
    if (n === 2) { tiles.forEach((t) => { t.style.width = ''; t.style.height = ''; }); g.dataset.cols = ''; return; }
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
    mini.els.stopBar.hidden = !amSharing();
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
  // the Sound sheet outside a call; all show the same: a grouped card (Their voice, Film sound, the switch), the
  // five mic chips with one line on the chosen one, then Hear myself and Fix sound side by side. An iPhone or iPad
  // ignores a page's volume, so there the card is hidden and the line under it says why (see outRest).
  function rangeFill(r) { r.style.setProperty('--pct', (r.value - r.min) / ((r.max - r.min) || 1) * 100 + '%'); }
  function soundPanel(doc, opts) {
    opts = opts || {};
    const box = doc.createElement('div');
    box.className = 'sound';
    const head = (txt) => { const h = doc.createElement('h3'); h.className = 'sound-h'; h.textContent = txt; return h; };
    const card = doc.createElement('div');
    card.className = 'sound-card';
    card.hidden = IS_IOS;
    box.appendChild(card);
    [['voice', 'Their voice', 150], ['media', 'Film sound', 100]].forEach(([k, label, max]) => {
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
      rangeFill(r);
      r.addEventListener('input', () => { rangeFill(r); r.setAttribute('aria-valuetext', r.value + '%'); setVol(k, r.value / 100); });
      const pct = doc.createElement('span');
      pct.className = 'sound-pct';
      row.append(name, r, pct);
      card.appendChild(row);
    });
    const dk = doc.createElement('label');
    dk.className = 'sound-tog';
    const dcb = doc.createElement('input');
    dcb.type = 'checkbox';
    dcb.className = 'sw';
    dcb.setAttribute('role', 'switch');
    dcb.checked = SND.duck;
    dcb.addEventListener('change', () => setDuck(dcb.checked));
    const dt = doc.createElement('span');
    dt.textContent = 'Quieter film when someone talks';
    dk.append(dt, dcb);
    card.appendChild(dk);
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
    const acts = doc.createElement('div');
    acts.className = 'sound-acts';
    box.appendChild(acts);
    if (!opts.noTest) {
      const tb = doc.createElement('button');
      tb.type = 'button';
      tb.className = 'btn quiet sound-test';
      tb.innerHTML = ico('ear') + '<span>Hear myself</span>';
      const ts = doc.createElement('span');
      ts.className = 'sound-test-say';
      ts.setAttribute('aria-live', 'polite');
      tb.addEventListener('click', () => hearMyself(tb, ts));
      const tr = doc.createElement('div');
      tr.className = 'sound-testrow';
      tr.append(tb, ts);
      acts.appendChild(tr);
    }
    // In a call: one button that restarts the sound on both sides (see SOUND WATCH).
    const fr = doc.createElement('div');
    fr.className = 'sound-testrow sound-fixrow';
    fr.hidden = true;
    const fb = doc.createElement('button');
    fb.type = 'button';
    fb.className = 'btn quiet sound-fix';
    fb.innerHTML = ico('tools') + '<span>Fix sound</span>';
    fb.addEventListener('click', () => soundFix());
    const fs = doc.createElement('span');
    fs.className = 'sound-test-say sound-fix-say';
    fs.setAttribute('aria-live', 'polite');
    fr.append(fb, fs);
    acts.appendChild(fr);
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
        rangeFill(r);
        row.querySelector('.sound-pct').textContent = n + '%';
        r.setAttribute('aria-valuetext', n + '%');
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
      if (say) say.textContent = MODE_TEXT[CLEAR.mode][1] + (SEND_RAW ? (tuneFor(CLEAR.mode) ? RAW_SAY : '')
        : CLEAR.mode !== 'focus' ? ''
          : ISO.why === 'slow' ? ' The typing remover was too slow on this device, so it is off. Other sounds are still pushed back.'
            : ISO.why === 'rate' ? ' The typing remover can’t run with this mic, so other sounds are only pushed back.'
              : ISO.why === 'broke' ? ' The typing remover can’t run on this device, so other sounds are only pushed back.' : '');
      const fr = b.querySelector('.sound-fixrow');
      if (fr) fr.hidden = !inCallNow();
      const h = b.querySelector('.sound-hint');
      if (h) {
        h.textContent = IS_IOS ? 'On an iPhone or iPad, the volume buttons on the side set how loud everything is. Beside plays every sound straight through, which keeps it clean.'
          : !amSharing() ? 'Changes only what you hear. Nobody else’s sound changes.'
          : mine ? 'You’re sharing: use the video’s own volume. Everyone hears that change.'
            : 'You’re sharing without sound. Share a tab with “Also share tab audio” on to send its sound.';
        // the usual line ("Changes only what you hear") is left off the panel; a line that explains a slider is kept
        h.hidden = !IS_IOS && !amSharing();
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
    const md = $('moreDot'), mb = $('moreBtn');
    if (md) md.hidden = !C.unread;
    if (mb) mb.setAttribute('aria-label', C.unread ? 'More, a new message' : 'More');
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
      a.textContent = linkLabel(url);
      a.title = url;
      el.appendChild(a);
      if (tail) el.appendChild(document.createTextNode(tail));
    });
  }
  // A link as people say it: the site and the page, without https:// or www, cut short when long.
  function linkLabel(url) {
    let t = url;
    try { const u = new URL(url); t = u.hostname.replace(/^www\./, '') + (u.pathname === '/' ? '' : u.pathname) + u.search; } catch (e) {}
    return t.length > 42 ? t.slice(0, 40) + '…' : t;
  }
  // A message that is only a link: a card you can open (its icon, the site, the page, and Open).
  function linkCard(body, url) {
    let host = url, page = '';
    try { const u = new URL(url); host = u.hostname.replace(/^www\./, ''); page = (u.pathname === '/' ? '' : u.pathname) + u.search; } catch (e) {}
    const a = document.createElement('a');
    a.className = 'linkcard';
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = url;
    const fic = document.createElement('span');
    fic.className = 'fic';
    fic.setAttribute('aria-hidden', 'true');
    fic.innerHTML = ico('link');
    const w = document.createElement('span');
    const b = document.createElement('b');
    b.textContent = host;
    w.appendChild(b);
    if (page) { const sm = document.createElement('small'); sm.textContent = page; w.appendChild(sm); }
    const go = document.createElement('span');
    go.className = 'go';
    go.textContent = 'Open';
    a.append(fic, w, go);
    body.classList.add('linkmsg');
    body.appendChild(a);
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
      // after the caller has filled the bubble (text, a card), so the whole of it shows
      if (stick || mine) Promise.resolve().then(() => { list.scrollTop = list.scrollHeight; });
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
    const lone = String(t).trim().match(/^https?:\/\/[^\s<>"']+$/);
    if (lone && !ytId(t)) linkCard(body, lone[0].replace(/[.,!?;:)\]]+$/, ''));
    else linkify(body, t);
    if (ytId(t)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn quiet ytgo';
      b.textContent = 'Watch together';
      b.addEventListener('click', () => { ytWatch(t); if (matchMedia('(max-width: 899px)').matches) chatOpen(false); });
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
    if (ytId(t) && ytWatch(t) && matchMedia('(max-width: 899px)').matches) chatOpen(false); // the sheet would cover the film; the docked chat stays
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
  const RG = { busy: false, until: 0, ringAt: 0, name: '', t: 0, bannerT: 0 };
  const ringBase = () => (srv ? 'http://' + srv : '') + '/peerjs/board/' + boardRoom();
  const ringRole = () => (isGuest ? 'guest' : 'host');
  function ringOpen() { return isGuest ? location.origin + location.pathname + location.hash : location.origin + location.pathname + '?room=' + hostCode(); }
  function ringPost(path, o) {
    return fetch(ringBase() + path, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json', ...keyHead() }, body: JSON.stringify(o) })
      .then(async (r) => { if (!r.ok) throw new Error((await r.text()) || 'The ring server didn’t answer.'); return r.json(); });
  }
  const NATIVE = () => window.BesideNative && window.BesideNative.app === 'ios';
  function ringStandaloneNeeded() {
    return IS_IOS && !navigator.standalone && !(window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  }
  const ringKey = () => 'beside.ring.' + boardRoom() + '.' + ringRole();
  // Calls and setup's row: "Ring this phone" (or device), On or Off. The Beside app rings by itself, so it has none.
  function ringMeUi() {
    const on = !!store.get(ringKey());
    document.querySelectorAll('.ring-me').forEach((b) => {
      b.hidden = NATIVE();
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    text('ringMeLabel', /iPhone|iPod|Android.+Mobile/.test(navigator.userAgent) ? 'Ring this phone' : 'Ring this device');
    text('ringMeVal', on ? 'On' : 'Off');
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
    if (ringStandaloneNeeded()) { if (!steps('homescreen')) note('On iPhone and iPad, rings need Beside on your Home Screen. Tap Share, then Add to Home Screen, open Beside from there and tap this again.', 'stay'); return; }
    if (!('PushManager' in window) || !('Notification' in window) || !('serviceWorker' in navigator)) { note('This browser can’t ring. Use Chrome, Firefox, Safari on a Mac, or Beside from the iPhone Home Screen.', 'stay'); return; }
    RG.busy = true;
    try {
      const perm = await Notification.requestPermission(); // first, while the tap still counts
      if (perm !== 'granted') throw Object.assign(new Error('Rings need notifications. Turn them on for Beside in Settings, then tap this again.'), { steps: 'notify' });
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
    } catch (e) { if (!(e && e.steps && steps(e.steps))) note(e.message || 'That didn’t work. Try again.', 'stay'); }
    RG.busy = false;
    ringMeUi();
  }
  // The Beside app's device code: handed over quietly, again whenever it or the room changes, and (force) each time
  // this device opens and is let in, so the server knows which listed device it belongs to.
  function ringNative(force) {
    const n = window.BesideNative;
    if (!n || !n.voip || !/^[0-9a-f]{64,200}$/.test(n.voip)) return;
    if (!isGuest && !store.get('beside.room.linked')) return; // not yet given a link: no room of its own to ring
    const alert = typeof n.alert === 'string' && /^[0-9a-f]{64,200}$/.test(n.alert) ? n.alert : '';
    // Handed over again each day: if the server ever dropped this phone's codes (Apple said one was gone), it gets
    // them back within a day, so rings and heart pings can't stay lost.
    const mark = n.voip + '|' + alert + '|' + boardRoom() + '|' + ringRole() + '|' + boardName() + '|' + new Date().toISOString().slice(0, 10);
    if (force !== true && store.get('beside.voip.sent') === mark) return;
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
      if (!isGuest && j.names && j.names[0]) RG.name = cleanName(j.names[0]);
      // The host's call screen says "Ringing" itself (their head, pulsing); the guest's waiting screen gets a note.
      if (j.sent > 0) { if (isGuest) note('Ringing ' + who + '…', 'info'); else ringing(true); }
      else { ringing(false); if (j.devices > 0) note('The ring couldn’t reach ' + who + '’s device. Try again in a minute, or send them a message.', 'stay');
      else note((isGuest && theirName ? theirName + ' hasn’t' : 'They haven’t') + ' let Beside ring them yet. ' + (isGuest ? 'Send them a message instead.' : 'Send the link instead.'), 'stay'); }
    } catch (e) { ringing(false); note(e.message || 'The ring didn’t go through. Try again.', 'stay'); }
    setTimeout(() => { if (btn) btn.disabled = false; }, 8000);
  }
  // The host's screen while it rings: for 45 s, or until someone comes in.
  function ringing(on) {
    RG.ringAt = on ? Date.now() : 0;
    clearTimeout(RG.t);
    if (on) RG.t = setTimeout(layout, 45100);
    if (app.state === 'live') layout();
  }
  // A ring while Beside is open in a browser (a computer, an iPad): the same look as the call, with Answer and Not
  // now. The notification shows as well; either one answers.
  function ringHere(url) {
    let u = null;
    try { u = new URL(url || './', location.href); } catch (x) { return false; }
    const m = u.hash.slice(1).match(/^([a-z0-9]{8})/);
    return isGuest ? !m || m[1] === guestCode : !m && (u.searchParams.get('room') || hostCode()) === hostCode();
  }
  function ringBanner(url) {
    const b = $('ringBanner');
    if (!b) return;
    clearTimeout(RG.bannerT);
    if (!url || !ringHere(url) || ['waiting', 'live', 'watching'].includes(app.state)) { b.hidden = true; return; }
    putHead($('ringBannerHead'), whoThem());
    const nm = isGuest ? theirName : ((theirRoom() || {}).name || '');
    text('ringBannerText', nm ? nm + ' is ringing' : 'They are ringing');
    b.hidden = false;
    RG.bannerT = setTimeout(() => { b.hidden = true; }, 45000);
  }
  function ringNoteClose() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.getRegistration().then((r) => (r ? r.getNotifications({ tag: 'beside-ring' }) : [])).then((ns) => ns.forEach((n) => n.close())).catch(() => {});
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
    const gr = $('gRingBtn') && $('gRingBtn').querySelector('span');
    if (gr && theirName) gr.textContent = 'Ring ' + theirName;
    on('ringBannerAnswer', 'click', () => { ringBanner(''); ringNoteClose(); ringAnswerNow(); });
    on('ringBannerNot', 'click', () => { ringBanner(''); ringNoteClose(); });
    ringMeUi();
    window.addEventListener('besidenative', () => { ringMeUi(); ringNative(); });
    on('nameInput', 'change', ringNative);
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => {
      const d = e.data;
      if (d && d.beside === 'ringing') { ringBanner(d.url || './'); return; }
      if (!d || d.beside !== 'answer') return;
      ringBanner('');
      if (!d.url) { if (d.fresh) ringAnswerNow(); return; } // no link said: this page
      let u = null;
      try { u = new URL(d.url, location.href); } catch (x) {}
      const m = u && u.hash.slice(1).match(/^([a-z0-9]{8})/);
      const here = u && (isGuest ? !!m && m[1] === guestCode : !m && (u.searchParams.get('room') || hostCode()) === hostCode());
      if (here) { if (d.fresh) ringAnswerNow(); }
      else if (u) location.href = u.href; // a ring for another room or role: open that one
    });
    ringAnswer(); // the first ringRecheck and ringNative run once the first hello is answered (lockStart)
  }

  // ---------- TRUSTED DEVICES ----------
  // Mo, 13 Nov 2026: "ok we need some security then, what do you propose, anyway only we can access this link and no
  // one else can". Until then the link was the only lock. Each device now keeps a random key of its own (never shown,
  // sent only to Beside's own server) and a key pair whose public half goes on the list. While Beside is open, every
  // device that opens it is listed by itself. Once locked (Calls and setup, Trusted devices), a new device sees "This
  // device isn't let in yet" and asks once, showing a code the two people compare, and a listed device lets it in from
  // the banner on Home (or the note in a call). The recovery code shown once at Lock lists a device when nobody can.
  // The server keeps everyone else off the board, rings and photos; a call goes browser to browser, so the two pages
  // check each other when it starts (the call gate, below).
  const keyText = (a) => btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const hexOf = (a) => Array.from(a, (x) => x.toString(16).padStart(2, '0')).join('');
  const lockSha = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const LOCK_EC = { name: 'ECDSA', namedCurve: 'P-256' }, LOCK_SIG = { name: 'ECDSA', hash: 'SHA-256' };
  function lockKey() {
    const k = store.get('beside.key') || '';
    if (/^[A-Za-z0-9_-]{43}$/.test(k)) return k;
    try { const n = keyText(crypto.getRandomValues(new Uint8Array(32))); store.set('beside.key', n); return n; } catch (e) { return ''; }
  }
  // This device's key pair, made once: the private half stays here (a JWK next to beside.key), the public half is listed.
  async function lockPair() {
    let jwk = null, priv = null;
    try { jwk = JSON.parse(store.get('beside.pair') || 'null'); } catch (e) {}
    if (jwk && jwk.kty === 'EC' && jwk.crv === 'P-256' && jwk.d) { try { priv = await crypto.subtle.importKey('jwk', jwk, LOCK_EC, false, ['sign']); } catch (e) { priv = null; } }
    if (!priv) {
      const kp = await crypto.subtle.generateKey(LOCK_EC, true, ['sign', 'verify']);
      jwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
      priv = kp.privateKey;
      store.set('beside.pair', JSON.stringify(jwk));
    }
    return { priv, pub: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y } };
  }
  // key: this device's own; id: what the server knows it by (12 hex of its hash); p: its photo token; pub and priv:
  // its key pair. lock: the list as the server last gave it (kept for when the server can't be reached); out: not let in.
  const LK = { key: lockKey(), id: '', p: '', pub: null, priv: null, lock: null, out: false, asked: false, no: false, msg: '', t: 0, told: new Set(), sig: '', first: null, firstDone: false, noted: '', confirm: '' };
  LK.ready = (async () => {
    if (!LK.key || !window.crypto || !crypto.subtle) return;
    try {
      const [h, p] = await Promise.all([lockSha(LK.key), lockSha(LK.key + ':photo')]);
      LK.id = hexOf(h).slice(0, 12);
      LK.p = keyText(p);
      Object.assign(LK, await lockPair());
    } catch (e) { /* no key pair: the server treats this page as an older one */ }
  })();
  const keyHead = () => (LK.key ? { 'x-beside-key': LK.key } : {});
  // The call server's links. Open: PREFIX + the room code, as always. Locked: PREFIX + the room's call id, which
  // Beside's server gives only to listed devices (and makes anew at each Lock), so someone with just the old link can't
  // reach the call layer. Every PeerJS id this page opens or dials comes from here: the host's link (and its spare on
  // the free server), the guest's knock, a look for the call on my other device, and moving the call. Ring links carry
  // the room code, never an id: the page they open says hello first. The list is kept on this device too, so a call
  // still finds the right id when Beside's server can't be reached.
  const CID_RE = /^[0-9a-f]{32}$/;
  function callId(code) { const L = LK.lock; return PREFIX + (L && L.on && CID_RE.test(L.cid || '') ? L.cid : code); }
  const lockStoreKey = () => 'beside.lock.' + boardRoom();
  const lockDev = (id) => (LK.lock && LK.lock.devices.find((d) => d.id === id)) || null;
  // The 4 digits an ask shows on both screens (from the asking device's id), for the two people to compare.
  const askCode = (id) => String(parseInt(String(id).slice(0, 8), 16) % 10000).padStart(4, '0');
  // A person's name as this page really has it, or '' (a guest link with no name, say, is "Guest" on the list).
  function sideName(role) {
    if (role === ringRole()) return isGuest ? cleanName(store.get('beside.name') || ($('nameInput') && $('nameInput').value) || '') : myName();
    return isGuest ? theirName : cleanName((app.people && app.people.them) || '');
  }
  function lockKind() {
    const u = navigator.userAgent;
    const ipad = /iPad/.test(u) || (IS_IOS && /Macintosh/.test(u));
    if (NATIVE()) return ipad ? 'iPad app' : 'iPhone app';
    if (/iPhone|iPod/.test(u)) return 'iPhone';
    if (ipad) return 'iPad';
    const os = /Macintosh/.test(u) ? 'Mac' : /Windows/.test(u) ? 'Windows' : '';
    const br = browserName();
    return os && br !== 'Browser' ? os + ' ' + br : 'browser';
  }
  // Hello: this device, its key and its public key; ask: "Ask to come in"; recover: a recovery code. Answers {in, lock},
  // or {in: false, asked, msg} when kept out; null when the server can't be reached (or is an older one).
  async function lockHello(ask, recover, ms) {
    await LK.ready;
    if (!LK.id) return null;
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms || 8000);
    try {
      const o = { role: ringRole(), name: sideName(ringRole()), kind: lockKind(), ask: !!ask };
      if (LK.pub) o.pub = LK.pub;
      if (recover) o.recover = recover;
      const r = await fetch(ringBase() + '/hello', { method: 'POST', cache: 'no-store', signal: c.signal, headers: { 'content-type': 'application/json', ...keyHead() }, body: JSON.stringify(o) });
      if (r.status === 403 || r.status === 429) { const j = await r.json().catch(() => null); return j && j.in === false ? j : null; }
      return r.ok ? await r.json() : null;
    } catch (e) { return null; } finally { clearTimeout(t); }
  }
  // The first hello. A call starting meanwhile waits for it, 3 s at most. Then the ring registrations go to the server
  // again (quietly, as at every start), so a listed device's rings are known to be its own.
  function lockStart() {
    try { const j = JSON.parse(store.get(lockStoreKey()) || 'null'); if (j && Array.isArray(j.devices) && Array.isArray(j.asks)) LK.lock = j; } catch (e) {}
    const first = lockHello(false).then((j) => {
      lockAnswer(j);
      if (!j || j.in) { ringRecheck(); ringNative(!!j); }
    }).catch(() => {});
    LK.first = Promise.race([first, new Promise((r) => setTimeout(r, 3000))]).finally(() => { LK.firstDone = true; });
  }
  // No answer: carry on as before (a list kept from before still checks calls).
  function lockAnswer(j) { if (j) { if (j.in) lockSet(j.lock); else lockOut(!!j.asked); } }
  function lockSet(lock) {
    const L = lock && Array.isArray(lock.devices) && Array.isArray(lock.asks) ? lock : null;
    const sig = L ? JSON.stringify(L) : '';
    LK.lock = L;
    if (sig === LK.sig) { hostReid(); return; } // the 5 s check brings the same list most times
    LK.sig = sig;
    store.set(lockStoreKey(), sig);
    lockUi();
    askUi();
    // A device removed while locked leaves the call too.
    if (L && L.on) for (const [k, g] of H.guests) if (g.conn.besideDev && !lockDev(g.conn.besideDev)) hostDropGuest(k);
    hostReid(); // locked, unlocked or a new call id: the host's link follows
  }
  // The board said no: check with hello, then show the "not let in" screen.
  function lockDenied() { if (!LK.out) lockHello(false).then((j) => { if (j && !j.in && !LK.out) lockOut(!!j.asked); }); }
  // Not let in: a calm full screen. No house, no calls, no hosting. It checks every 5 s, and opens Beside once let in.
  function lockOut(asked) {
    const box = $('lockOut');
    if (!box) return;
    if (!LK.out) {
      LK.out = true;
      if (isGuest && !G.left) guestLeave();
      else if (!isGuest && ['waiting', 'live'].includes(app.state)) hostStop();
      box.hidden = false;
      // The list kept on this device goes, with the call id in it.
      LK.lock = null;
      LK.sig = '';
      store.set(lockStoreKey(), '');
      lockUi();
      askUi();
    }
    if (LK.asked && !asked) LK.no = true; // turned down (or a day went by): said until it asks again
    LK.asked = asked;
    if (asked) LK.no = false;
    text('lockOutText', asked ? askedWords() : LK.msg || (LK.no ? 'Not let in this time. You can ask again.' : 'Beside only opens on devices that are let in.'));
    const code = $('lockOutCode');
    if (code) { code.hidden = !asked; code.textContent = asked ? 'Your code is ' + askCode(LK.id) + '. Tell it to them.' : ''; }
    const b = $('lockAskBtn');
    if (b) { b.hidden = asked; b.disabled = false; }
    clearTimeout(LK.t);
    LK.t = setTimeout(lockOutCheck, 5000);
  }
  function lockOutCheck() {
    if (document.visibilityState !== 'visible') { LK.t = setTimeout(lockOutCheck, 5000); return; }
    lockHello(false).then((j) => { if (j && j.in) location.reload(); else lockOut(j ? !!j.asked : LK.asked); });
  }
  function lockAsk() {
    const b = $('lockAskBtn');
    if (b) b.disabled = true;
    lockHello(true).then((j) => {
      if (j && j.in) { location.reload(); return; }
      if (j) { LK.msg = j.msg || ''; lockOut(!!j.asked); return; }
      text('lockOutText', 'Can’t reach Beside. Check the internet, then try again.');
      if (b) b.disabled = false;
    });
  }
  // "Use a recovery code": the code made when Beside was locked lets this device in.
  function lockRecover(e) {
    if (e) e.preventDefault();
    const inp = $('lockRecInput'), b = $('lockRecGo'), m = $('lockRecMsg');
    const v = String((inp && inp.value) || '').trim();
    if (!v) { if (inp) inp.focus(); return; }
    if (b) b.disabled = true;
    lockHello(false, v).then((j) => {
      if (j && j.in) { location.reload(); return; }
      if (b) b.disabled = false;
      if (m) { m.textContent = j ? j.msg || 'That code isn’t right.' : 'Can’t reach Beside. Check the internet, then try again.'; m.hidden = false; }
    });
  }
  function askedWords() {
    const names = [sideName('host'), sideName('guest')].filter(Boolean);
    return 'Asked. ' + (names.length ? names.join(' or ') + ' can let this device in from their Beside.' : 'The other device can let this one in from its Beside.');
  }
  // A new name: hello again, so this device's place on the list says it.
  function lockRename() { if (LK.lock && !LK.out) lockHello(false).then(lockAnswer); }
  // Calls and setup: the Trusted devices fold (closed until opened: the list stays out of the way).
  function lockUi() {
    const card = $('trustCard'), L = LK.lock;
    if (!card) return;
    card.hidden = !L;
    if (!L) return;
    text('trustVal', L.on ? 'Locked' : 'Open');
    text('trustSay', L.on ? 'Locked. Only these devices get in.' : 'Open to anyone with the link.');
    const me = L.devices.find((d) => d.me);
    const list = $('trustList');
    list.textContent = '';
    L.devices.forEach((d) => {
      const li = document.createElement('li');
      const w = document.createElement('span'), b = document.createElement('b'), s = document.createElement('small');
      b.textContent = d.label;
      s.textContent = d.me ? 'This device' : 'Seen ' + seenWords(d.seen);
      w.append(b, s);
      li.append(w);
      // Remove: only a device added after this one (one that got in later can't push out those before it), asked once.
      if (me && !d.me && d.added > me.added) {
        if (LK.confirm === d.id) {
          const q = document.createElement('div'), p = document.createElement('p');
          q.className = 'trust-ask';
          p.textContent = 'Remove ' + d.label + '? It will have to ask to come in again.';
          q.append(p, trustBtn('Remove', 'btn sm primary', (x) => lockOp({ op: 'forget', id: d.id }, x).then((m) => { LK.confirm = ''; trustMsg(m); lockUi(); })),
            trustBtn('Cancel', 'btn sm', () => { LK.confirm = ''; lockUi(); }));
          li.append(q);
        } else li.append(trustBtn('Remove', 'btn sm', () => { LK.confirm = d.id; lockUi(); }, 'Remove ' + d.label));
      } else if (me && L.on) {
        // Where that rule says no (a device added before this one, or this one): the recovery code removes it.
        if (LK.confirm === 'rec:' + d.id) li.append(recRemove(d));
        else li.append(trustBtn('Remove with recovery code', 'btn sm', () => { LK.confirm = 'rec:' + d.id; trustMsg(''); lockUi(); const i = $('trustRecInput'); if (i) i.focus(); }, 'Remove ' + d.label + ' with the recovery code'));
      }
      list.append(li);
    });
    text('trustLockBtn', L.on ? 'Unlock' : 'Lock Beside');
    if (L.on) lockConfirm(false);
  }
  // "Remove with recovery code": asks for the code, then removes the device, even this one (which is then signed out).
  function recRemove(d) {
    const f = document.createElement('form'), p = document.createElement('p'), inp = document.createElement('input');
    f.className = 'trust-ask';
    f.autocomplete = 'off';
    p.textContent = d.me ? 'Type the recovery code to remove this device. It will be signed out, and will have to ask to come in again.' : 'Type the recovery code to remove ' + d.label + '. It will have to ask to come in again.';
    Object.assign(inp, { id: 'trustRecInput', type: 'text', maxLength: 20, placeholder: 'Recovery code', autocapitalize: 'characters', spellcheck: false, enterKeyHint: 'go' });
    inp.setAttribute('aria-label', 'Recovery code');
    inp.setAttribute('autocorrect', 'off');
    const go = trustBtn('Remove', 'btn sm primary', () => {
      const v = inp.value.trim();
      if (!v) { inp.focus(); return; }
      lockOp({ op: 'forget', id: d.id, recover: v }, go).then((m) => { trustMsg(m); if (!m) { LK.confirm = ''; lockUi(); } });
    });
    f.addEventListener('submit', (e) => { e.preventDefault(); go.click(); });
    f.append(p, inp, go, trustBtn('Cancel', 'btn sm', () => { LK.confirm = ''; trustMsg(''); lockUi(); }));
    return f;
  }
  function trustBtn(label, cls, fn, aria) {
    const x = document.createElement('button');
    x.type = 'button';
    x.className = cls;
    x.textContent = label;
    if (aria) x.setAttribute('aria-label', aria);
    x.addEventListener('click', () => fn(x));
    return x;
  }
  function seenWords(t) {
    const day = (x) => new Date(x).setHours(0, 0, 0, 0);
    const n = Math.round((day(Date.now()) - day(t)) / 864e5);
    return n <= 0 ? 'today' : n === 1 ? 'yesterday' : n + ' days ago';
  }
  function trustMsg(m) { const el = $('trustMsg'); if (el) { el.textContent = m || ''; el.hidden = !m; } }
  // One change to the list. Answers '' when done, else what went wrong in plain words. Lock's answer carries the new
  // recovery code, shown once.
  async function lockOp(o, btn) {
    if (btn) btn.disabled = true;
    let msg = '';
    try {
      const r = await fetch(ringBase(), { method: 'POST', cache: 'no-store', headers: { 'content-type': 'text/plain;charset=UTF-8', ...keyHead() }, body: JSON.stringify(o) });
      if (r.ok) {
        const j = await r.json();
        if (j.out) lockDenied(); // this device removed itself with the recovery code: signed out
        else { lockSet(j.lock); if (j.recovery) recShow(j.recovery); }
      } else msg = r.status === 400 || r.status === 403 || r.status === 429 ? (await r.text()).slice(0, 200) : 'Beside’s server didn’t answer. Try again.';
    } catch (e) { msg = 'Can’t reach Beside’s server. Try again.'; }
    if (btn) btn.disabled = false;
    return msg;
  }
  // Lock: first what will happen, in plain words, then "Lock now". Unlock needs no asking.
  function lockToggle() {
    const L = LK.lock;
    if (!L) return;
    if (L.on) { lockOp({ op: 'lock', on: false }, $('trustLockBtn')).then(trustMsg); return; }
    const miss = ['guest', 'host'].find((r) => !L.devices.some((d) => d.role === r));
    if (miss) { const n = sideName(miss); trustMsg('Open Beside once on ' + (n ? n + '’s' : 'the other person’s') + ' device first, so it is listed.'); return; }
    trustMsg('');
    const ul = $('trustStay');
    if (ul) ul.replaceChildren(...L.devices.map((d) => { const li = document.createElement('li'); li.textContent = d.label; return li; }));
    const sr = $('trustStrays');
    if (sr) sr.hidden = !L.strays;
    lockConfirm(true);
  }
  function lockConfirm(open) {
    const box = $('trustConfirm'), lb = $('trustLockBtn');
    if (box) box.hidden = !open;
    if (lb) lb.hidden = !!open;
  }
  function lockNow() { lockOp({ op: 'lock', on: true }, $('trustLockNow')).then((m) => { lockConfirm(false); trustMsg(m); }); }
  // The recovery code, shown once: the server keeps only its hash, and this page forgets it when the sheet closes.
  function recShow(code) {
    const sh = $('recSheet');
    if (!sh) return;
    text('recCode', code ? String(code).match(/.{1,4}/g).join(' ') : '');
    sh.hidden = !code;
    const f = $(code ? 'recDone' : 'trustLockBtn');
    if (f) f.focus();
  }
  // Home's banner: the newest ask, its code, Let in and No. In a call the banner is hidden, so the note says it.
  function askUi() {
    const c = $('askCard'), n = $('note');
    if (!c) return;
    const asks = (LK.lock && LK.lock.asks) || [];
    const a = asks[asks.length - 1];
    if (n && !n.hidden && n.dataset.ask && !asks.some((x) => x.id + x.at === n.dataset.ask)) n.hidden = true; // answered
    c.hidden = !a || LK.out;
    if (!a) return;
    c.dataset.id = a.id;
    const say = 'Code ' + askCode(a.id) + '. Only let it in if they tell you this code.';
    text('askTitle', a.label + ' wants to come in.');
    text('askText', say);
    if (LK.out || !['waiting', 'live', 'watching'].includes(app.state) || LK.noted === a.id + a.at) return;
    LK.noted = a.id + a.at;
    note(a.label + ' wants to come in. ' + say, 'stay', [['Let in', () => askAnswer('letin', null, a.id)], ['No', () => askAnswer('refuse', null, a.id)]]);
    if (n) n.dataset.ask = LK.noted;
  }
  function askAnswer(op, btn, id) {
    const c = $('askCard');
    const which = id || (c && c.dataset.id);
    if (which) lockOp({ op, id: which }, btn).then((m) => { if (m) note(m, 'info'); });
  }
  function lockBoot() {
    on('lockAskBtn', 'click', lockAsk);
    on('lockRecLink', 'click', () => {
      const f = $('lockRecForm'), l = $('lockRecLink'), i = $('lockRecInput');
      if (f) f.hidden = false;
      if (l) l.hidden = true;
      if (i) i.focus();
    });
    on('lockRecForm', 'submit', lockRecover);
    on('trustLockBtn', 'click', lockToggle);
    on('trustLockNow', 'click', lockNow);
    on('trustLockCancel', 'click', () => lockConfirm(false));
    on('recCopy', 'click', () => copyLink($('recCopy'), ($('recCode') || {}).textContent));
    on('recDone', 'click', () => recShow(''));
    on('askLetIn', 'click', (e) => askAnswer('letin', e.currentTarget));
    on('askNo', 'click', (e) => askAnswer('refuse', e.currentTarget));
    on('nameInput', 'change', lockRename);
    on('hostName', 'change', lockRename);
    lockStart();
  }

  // ---------- THE CALL GATE ----------
  // Only while Beside is locked: a call starts only between two listed devices, checked both ways. The server never
  // sees a call (it goes browser to browser, and the spare call server isn't Beside's), so each side proves itself
  // over the call's own data link, which is encrypted end to end, and never in a knock's details (those pass through
  // the spare server). Each side sends a random question; the other signs it with its private key, tied to this very
  // link (its PeerJS id and its side's encryption fingerprint), so an answer can't be carried over to another link, and
  // the asker checks the signature with that device's public key from the list. Unlocked, none of this runs and calls
  // are exactly as before.
  const gateOn = () => !!(LK.lock && LK.lock.on);
  const gateMsg = (d) => !!d && (d.t === 'proof?' || d.t === 'proof');
  // What counts for the call: never the gate's own messages, and nothing while the other side isn't checked yet.
  const gateLets = (conn, d) => !gateMsg(d) && (!conn.bg || conn.bg.st === 'open' || conn.bg.st === 'ok');
  function sdpFp(desc) { const m = /a=fingerprint:\S+\s+([0-9A-Fa-f:]+)/.exec((desc && desc.sdp) || ''); return m ? m[1].toUpperCase() : ''; }
  // Every link answers the other side's question, whatever this device knows of the lock: an answer gives nothing away.
  function gateWire(conn) {
    if (conn.bg) return conn.bg;
    const bg = (conn.bg = { st: 'open', ns: [], q: [], held: [], got: null });
    conn.on('data', (d) => {
      if (!d || typeof d !== 'object') return;
      if (d.t === 'proof?') { if (typeof d.n === 'string' && d.n.length <= 64) gateProve(conn, d.n); return; }
      if (d.t === 'proof') { if (bg.got) bg.got(d); return; }
      if (bg.st === 'wait') bg.q.push(d);
    });
    return bg;
  }
  async function gateProve(conn, n) {
    await LK.ready;
    const pc = conn.peerConnection;
    if (!LK.priv || !conn.provider) return;
    try {
      const s = await crypto.subtle.sign(LOCK_SIG, LK.priv, new TextEncoder().encode(n + ':' + conn.provider.id + ':' + sdpFp(pc && pc.localDescription)));
      tell(conn, { t: 'proof', id: LK.id, n, s: keyText(new Uint8Array(s)) });
    } catch (e) {}
  }
  // true: a listed device signed one of our questions; 'old': a page from before key pairs answered; else 'wrong'.
  async function gateCheck(conn, ns, d) {
    if (typeof d.s !== 'string') return typeof d.m === 'string' ? 'old' : 'wrong';
    if (typeof d.id !== 'string' || !ns.includes(d.n) || d.s.length > 100) return 'wrong';
    if (!lockDev(d.id)) {
      lockAnswer(await lockHello(false, '', 3000)); // let in a moment ago: get the list first
      if (!gateOn()) return true; // unlocked meanwhile
    }
    const dev = lockDev(d.id);
    const fp = sdpFp(conn.peerConnection && conn.peerConnection.remoteDescription);
    if (!dev || !dev.pub || !fp) return 'wrong';
    try {
      const k = await crypto.subtle.importKey('jwk', dev.pub, LOCK_EC, false, ['verify']);
      if (!(await crypto.subtle.verify(LOCK_SIG, k, b64uBytes(d.s), new TextEncoder().encode(d.n + ':' + conn.peer + ':' + fp)))) return 'wrong';
    } catch (e) { return 'wrong'; }
    conn.besideDev = dev.id;
    return true;
  }
  // pass() once the other side is a listed device (at once while unlocked); fail(why) when it isn't: 'wrong' for a proof
  // that doesn't check out, 'old' when nothing usable came. No answer in 4 s: the list is fetched again and the question
  // asked once more, fresh. Whatever came while checking is handed on after pass(), in order. The list not known yet:
  // wait for the first hello.
  function gateRun(conn, pass, fail) {
    const bg = gateWire(conn);
    bg.st = 'wait';
    if (!LK.lock && LK.first && !LK.firstDone) { LK.first.then(() => gateRun(conn, pass, fail)); return; }
    let over = false, t = 0, again = false;
    const end = (ok, why) => {
      if (over) return;
      over = true;
      clearTimeout(t);
      bg.got = null;
      bg.st = ok ? 'ok' : 'no';
      if (ok) pass(); else if (conn.open) fail(why);
      if (ok) bg.q.splice(0).forEach((d) => conn.emit('data', d));
      bg.held.splice(0).forEach((f) => f(ok));
    };
    if (!gateOn()) { end(true); return; }
    const ask = () => {
      const n = keyText(crypto.getRandomValues(new Uint8Array(16)));
      bg.ns.push(n);
      tell(conn, { t: 'proof?', n });
      t = setTimeout(async () => {
        if (over || !bg.got) return; // a proof came and is being checked
        if (again || !conn.open) { end(false, 'old'); return; }
        again = true;
        lockAnswer(await lockHello(false, '', 3000));
        if (over || !bg.got) return;
        if (gateOn()) ask(); else end(true);
      }, 4000);
    };
    bg.got = (d) => { bg.got = null; clearTimeout(t); gateCheck(conn, bg.ns, d).then((r) => end(r === true, r), () => end(false, 'wrong')); };
    ask();
  }
  // The host: a device that isn't let in tried to join (a wrong proof), or one on an older Beside (nothing it could
  // read). Each is said once.
  function gateRefused(why, conn) {
    const nm = cleanName(conn && conn.metadata && conn.metadata.name) || sideName('guest');
    const m = why === 'old' ? (nm ? nm + '’s device is on an older Beside. They need to reload it.' : 'The other device is on an older Beside. Reload Beside there.') : 'A device that isn’t let in tried to join.';
    if (!LK.told.has(m)) { LK.told.add(m); note(m, 'info'); }
  }
  // The guest: the link was answered by a device that isn't one of ours, or by one on an older Beside.
  function gateEnd(why) {
    guestLeave();
    if (why === 'old') ended('The other device is on an older Beside.', 'Reload Beside there.', 'Join again');
    else ended('This link isn’t answered by one of your own devices.', 'The call didn’t start.', 'Join again');
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
    const all = people().length > 2 ? 'everyone' : 'both of you';
    n.textContent = msg || (away ? 'Paused: ' + W.away + ' left.' : (W.play ? 'Playing for ' : 'Paused for ') + all);
    k.hidden = !away || !!msg;
    ytCtl();
  }
  // One line of controls under the film: play or pause, where in the film, the time, and Stop. They work for
  // everyone, the same way as a press on the YouTube player itself: the new state goes to all (ytSend).
  function ytDur() { try { return W.p && W.ready ? W.p.getDuration() || 0 : 0; } catch (e) { return 0; } }
  function ytCtl() {
    const box = $('ytBox');
    clearTimeout(W.ctlT);
    if (!box || box.hidden || !W.id) return;
    W.ctlT = setTimeout(ytCtl, 500);
    box.classList.toggle('paused', !W.play);
    const dur = ytDur(), cur = W.seeking ? +(($('ytSeek') || {}).value || 0) : Math.min(ytNow(), dur || Infinity);
    const sk = $('ytSeek');
    if (sk && !W.seeking) {
      sk.max = String(Math.max(1, Math.floor(dur)));
      sk.value = String(Math.floor(cur));
      sk.style.setProperty('--pct', (dur ? Math.min(100, (cur / dur) * 100) : 0).toFixed(1) + '%');
    }
    const m = Math.floor(cur / 60);
    text('ytTime', (m >= 60 ? Math.floor(m / 60) + ':' + pad2(m % 60) : m) + ':' + pad2(Math.floor(cur % 60)));
    const pb = $('ytPlay');
    if (pb && pb.dataset.play !== String(W.play)) {
      pb.dataset.play = String(W.play);
      pb.innerHTML = ico(W.play ? 'pause' : 'play', 20);
      pb.setAttribute('aria-label', W.play ? 'Pause for everyone' : 'Play for everyone');
    }
  }
  function ytWire() {
    on('ytPlay', 'click', () => { if (W.id) ytSend({ id: W.id, at: ytNow(), play: !W.play }); });
    const sk = $('ytSeek');
    if (!sk) return;
    sk.addEventListener('input', () => { W.seeking = true; const d = ytDur(); sk.style.setProperty('--pct', (d ? (sk.value / d) * 100 : 0).toFixed(1) + '%'); ytCtl(); });
    sk.addEventListener('change', () => { W.seeking = false; if (W.id) ytSend({ id: W.id, at: +sk.value || 0, play: W.play }); });
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
    const fic = document.createElement('span');
    fic.className = 'fic';
    fic.setAttribute('aria-hidden', 'true');
    fic.innerHTML = ico('file');
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
    card.append(fic, fn, meta, bar, acts);
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
        // the card grows by its buttons: a chat that was at the bottom stays at the bottom
        const l = $('chatList');
        const stick = !!l && l.scrollHeight - l.scrollTop - l.clientHeight < 80;
        if (type === 'application/pdf') {
          const o = document.createElement('a');
          o.href = url; o.target = '_blank'; o.rel = 'noopener'; o.textContent = 'Open'; o.className = 'open';
          acts.appendChild(o);
        }
        const s = document.createElement('a');
        s.href = url; s.download = f.fname; s.textContent = 'Save'; s.className = 'save';
        acts.appendChild(s);
        if (stick) l.scrollTop = l.scrollHeight;
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
  function soundLane() { return isGuest ? !!G.mediaSender && G.hostVer >= 3 && !!G.ctx : !!H.ctx || (IS_IOS && app.state === 'live'); }
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
    // A film: the link field, ready for a YouTube link, so it can do what a link can.
    set('shareFilmOpt', 'shareFilmBtn', 'shareFilmWhy', why.link, 'YouTube plays for both of you.');
    const lw = $('shareLinkWhy');
    if (lw) lw.classList.remove('said');
  }
  // A line under the link field that must be seen (the sheet otherwise keeps the link's usual line for a screen reader).
  function linkSay(t) {
    text('shareLinkWhy', t);
    const lw = $('shareLinkWhy');
    if (lw) lw.classList.add('said');
  }
  function shareFilm() {
    const i = $('shareLinkInput');
    if (!i || i.disabled) return;
    linkSay('Paste a YouTube link here. It plays for both of you.');
    i.focus();
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
    if (why.link) { linkSay(why.link); return; }
    const u = shareUrl(inp && inp.value);
    if (!u) { linkSay('That isn’t a link. Copy the page’s address, then tap Paste.'); return; }
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
      if (!shareUrl(t)) linkSay('There’s no link to paste. Copy the page’s address first.');
    } catch (e) {
      linkSay('Paste isn’t allowed here. Tap the box, then paste the link into it.');
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
    x.fillStyle = '#000'; // paint: plain black behind a shared picture, as a video has
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
    x.fillStyle = '#000'; // paint: plain black behind a shared picture, as a video has
    x.fillRect(0, 0, c.width, c.height);
    try { x.drawImage(src, (c.width - w) / 2, (c.height - h) / 2, w, h); CV.frames++; } catch (e) {}
  }
  function canvasWords(words) {
    const c = CV.canvas, x = CV.x;
    if (!c || !x) return;
    const st = document.querySelector('.stage.watch') || document.documentElement;
    const cs = getComputedStyle(st);
    x.fillStyle = cs.getPropertyValue('--bg').trim() || 'black';
    x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = cs.getPropertyValue('--ink').trim() || 'white';
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
    if (!isGuest && IS_IOS && !H.ctx && app.state === 'live') engineUp(); // closed while nothing needed it
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
      if (CV.kind === 'video') return CV.media && (CV.media.paused || CV.media.ended) ? 'Your video is paused. Tap it to play.' : 'You are sharing a video. Tap it to pause.';
      return CV.kind === 'photo' ? 'You are sharing a photo' : 'You are sharing a web page';
    }
    return 'You are sharing ' + surfaceName(track);
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
    on('shareFilmBtn', 'click', shareFilm);
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
  // A Mac that blocks sharing gets its own small sheet of steps; anything else stays a short message.
  function shareFail(e, kind) { if (e && /system/i.test(e.message || '') && steps('screenMac')) return; note(displayError(e), kind); }
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
  function setStartBusy(b) { ['startBtn', 'endedAction', 'homeRingBtn'].forEach((id) => { const el = $(id); if (el) el.disabled = b; }); }

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
    // If it stops or starts, what each guest is sent changes with it (hostVoicePick).
    ctx.addEventListener('statechange', () => { if (H.ctx === ctx && app.state === 'live') hostVoicePick(); });
  }
  // Your mic into the engine: the leveller, or the plain mic if the leveller can't be made.
  function hostMicIn() {
    if (!H.mic || !H.ctx) return;
    try { H.clear = clearChain(H.ctx, H.mic, { live: () => !H.muted, change: () => hostVoicePick() }); H.clear.out.connect(H.micGain); } catch (e) {
      H.clear = null;
      try { H.rawSrc = H.ctx.createMediaStreamSource(H.mic); H.rawSrc.connect(H.micGain); } catch (e2) { H.rawSrc = null; }
    }
  }
  // iPhone and iPad (see outRest): the engine made again in the middle of a call, with everything that lives in
  // it: your mic's path, each guest's voice mix and meter, and the shared video's sound.
  function hostEngineBuild(ctx) {
    hostEngine(ctx);
    hostMicIn();
    H.micGain.gain.value = H.muted ? 0 : 1;
    for (const g of H.guests.values()) {
      try { g.vdest = H.ctx.createMediaStreamDestination(); g.vdest.channelCount = 1; H.micGain.connect(g.vdest); } catch (e) { g.vdest = null; }
      if (g.voice) { try { g.vsrc = H.ctx.createMediaStreamSource(new MediaStream([g.voice])); g.an = analyser(g.vsrc); } catch (e) { g.vsrc = g.an = null; } }
    }
    H.mediaSrc = null;
    H.mediaTrack = null; // roomSound makes its part of the engine again
    roomSound();
    rewire();
  }
  // And closed: the plain mic is sent, and nothing of the engine's stays on a lane.
  function hostEngineDrop() {
    const raw = H.mic && H.mic.getAudioTracks()[0];
    for (const g of H.guests.values()) {
      if (g.voiceSender && raw && g.voiceSender.track !== raw) g.voiceSender.replaceTrack(raw).catch(() => {});
      if (g.mediaSender && H.silent && g.mediaSender.track === H.silent) g.mediaSender.replaceTrack(null).catch(() => {});
      [g.vsrc, g.an].forEach((nd) => { if (nd) { try { nd.disconnect(); } catch (e) {} } });
      g.vsrc = g.an = g.vdest = null;
    }
    if (H.clear) { H.clear.close(); H.clear = null; }
    [H.rawSrc, H.mediaSrc].forEach((nd) => { if (nd) { try { nd.disconnect(); } catch (e) {} } });
    if (H.silent) H.silent.stop();
    H.ctx = H.sink = H.silent = H.micGain = H.micAn = H.rawSrc = H.mediaSrc = null;
    app.hostVoice = raw ? 'plain' : '';
    T.last.clear();
  }
  // Three ways to start: a video call, a voice call, or a call that starts by sharing a tab or window.
  async function hostStart(mode) {
    if (LK.out) return; // not let in (trusted devices)
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
          shareFail(e, e && /system/i.test(e.message || '') ? 'stay' : 'info');
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
          hostMicIn();
        } catch (e) {
          if (!(e && e.name === 'NotAllowedError' && steps('mic'))) note('Your microphone is blocked, so they can’t hear you. Click the icon at the left of the address bar, allow the microphone, then press End and start the call again.', 'stay');
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
    // The link's id depends on the lock (callId): wait for the first hello, 3 s at most.
    if (LK.first && !LK.firstDone) { const code = H.code; LK.first.then(() => { if (H.code === code && !H.stopping && app.state === 'live') openHostPeer(); }); return; }
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
    H.pid = callId(H.code);
    const peer = new Peer(H.pid, opts());
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
      netAgain();
    }
    gateWire(conn);
    conn.on('open', () => {
      H.knocks.delete(conn.peer);
      // Locked: only a listed device comes in (at once while unlocked).
      gateRun(conn, () => { if (conn.open) hostAddGuest(conn); }, (why) => { gateRefused(why, conn); try { conn.close(); } catch (e) {} });
    });
    conn.on('close', () => hostDropGuest(conn.connectionId));
    conn.on('error', () => hostDropGuest(conn.connectionId));
  }
  // The link is also live on the free server, quietly, so a guest still on it finds us: an older copy of
  // Beside, or a network that can't reach the own server. The own server carries everything else.
  function openSparePeer() {
    if (H.spare && !H.spare.destroyed) { try { H.spare.destroy(); } catch (e) {} }
    const id = H.pid; // the same id as the link on the own server
    const peer = new Peer(id, opts(true));
    H.spare = peer;
    const again = (ms) => setTimeout(() => {
      if (H.spare === peer && H.pid === id && !H.stopping && app.state === 'live' && (peer.destroyed || peer.disconnected)) {
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
    if (IS_IOS && !H.ctx && app.state === 'live') engineUp(); // closed while nobody needed it: a call's lanes are made from it
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
          if (never) { note((g.name || 'Your guest') + ' couldn’t connect. ' + NET_WHY, 'stay'); netAgain(); }
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
          if (!g.live) { g.live = true; g.liveAt = Date.now(); guestStatus(); moveTakeOver(g); }
          hostFace(g);
        });
    }
    conn.on('data', (d) => { if (H.guests.get(conn.connectionId) === g && gateLets(conn, d)) hostData(g, d); });
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
      applyVolumes(); // your volume for their voice (through the engine on Safari on a Mac)
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
      if (d.t === 'snd') { soundAsked(d, g); return; }
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
    if (!H.guests.size && !H.stopping) setTimeout(hostReid, 0); // the last one left: the link may move now (a guest coming back is added first)
  }
  // Locked or unlocked (or a new call id): the host's link moves to the id that is right now (callId). Never in the
  // middle of a call, which would drop it: at once when nobody is in the call, else as soon as the last one has left.
  function hostReid() {
    if (isGuest || !H.peer || H.stopping || app.state !== 'live' || H.guests.size || H.pid === callId(H.code)) return;
    if (H.spare) { try { H.spare.destroy(); } catch (e) {} H.spare = null; } // it opens again under the new id
    H.idRetries = 0;
    openHostPeer();
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
      try { s = await getCam(); } catch (e) { camFail(e, 'stay'); return; }
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
  // Any host whose engine or leveller has stopped also sends the mic as it comes (10 Nov 2026): the engine's mix
  // would be silence, and the guest would hear nothing.
  function hostVoicePick() {
    const mic = H.mic ? H.mic.getAudioTracks()[0] : null;
    const plain = SEND_RAW || !H.ctx || H.ctx.state !== 'running' || (!!H.clear && !H.clear.ok);
    const raw = plain && mic && mic.readyState === 'live' ? mic : null;
    const one = H.guests.size <= 1;
    let sent = '';
    for (const g of H.guests.values()) {
      const s = g.voiceSender;
      if (!s) continue;
      const mixed = g.vdest ? g.vdest.stream.getAudioTracks()[0] : null;
      const mix = !one || (!!H.mediaSrc && g.ver < 3 && g.id !== H.sharer); // an old guest hears the video in its voice
      const want = raw && (!mix || !mixed) ? raw : mixed;
      if (want && s.track !== want) s.replaceTrack(want).catch(() => {});
      if (want) sent = want === raw ? 'plain' : 'mix';
    }
    app.hostVoice = sent;
  }
  function rewire() {
    hostVoicePick();
    if (!H.ctx) return;
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
      if (e && /system/i.test(e.message || '')) shareFail(e, 'stay');
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
    if (H.micGain) H.micGain.gain.value = H.muted ? 0 : 1;
    H.mic.getAudioTracks().forEach((t) => { t.enabled = !H.muted; }); // the mic itself may be what is sent
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
  // The call ended: a sheet over the dimmed stage with both of you, how long you were together, and a kind next
  // step (a heart, sent the way the Hearts tab sends one). Done closes it; the link and Home are under it.
  function ended(title, body, action) {
    const together = V.since ? Math.max(1, V.lastWith - V.since) : 0;
    const who = V.withName || (isGuest ? hostLabel() : '');
    text('endedTitle', String(title).replace(/\.$/, ''));
    text('endedText', together && !MV.away ? howLong(together) + (who ? ' with ' + who : '') : body);
    text('endedAction', action);
    const heart = !!together && !MV.away && boardOn && !!(window.BesideBoard && window.BesideBoard.heart);
    const hb = $('endHeart'), ab = $('endedAction');
    if (hb) { hb.hidden = !heart; hb.disabled = false; const t = hb.querySelector('span'); if (t) t.textContent = 'Send a heart'; }
    if (ab) ab.hidden = heart;
    const heads = $('endHeads');
    if (heads) heads.innerHTML = window.BesideFigures ? '<span>' + headSvg(whoMe()) + '</span><span>' + headSvg(whoThem()) + '</span>' : '';
    const c = document.querySelector('#endBg canvas');
    if (c) c.hidden = !together;
    show('ended');
  }
  function howLong(ms) {
    const m = Math.round(ms / 60000);
    if (m < 1) return 'Less than a minute';
    if (m < 60) return m + (m === 1 ? ' minute' : ' minutes');
    const h = Math.floor(m / 60), r = m % 60;
    return h + (h === 1 ? ' hour' : ' hours') + (r ? ' ' + r + (r === 1 ? ' minute' : ' minutes') : '');
  }
  function endHeart() {
    const hb = $('endHeart');
    if (!hb || hb.disabled || !window.BesideBoard || !window.BesideBoard.heart) return;
    if (!window.BesideBoard.heart()) return;
    hb.disabled = true;
    const t = hb.querySelector('span');
    if (t) t.textContent = 'Heart sent';
  }
  function endClose() { const sh = document.querySelector('.endsheet'); if (sh) sh.hidden = true; }

  // ---------- JOIN (a guest who opened the link in a browser) ----------
  // You see yourself first (or your figure, camera off), the host's head in the corner dot, and one Join button.
  // The installed app, a ring being answered and a first visit (no name yet) open on Home as before.
  const J = { on: false, cam: null, mic: true };
  function joinFirst() {
    if (!isGuest || !cleanName(store.get('beside.name') || '')) return false;
    if (NATIVE() || navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches)) return false;
    try { if (new URLSearchParams(location.search).get('answer') === '1') return false; } catch (e) {}
    return true;
  }
  function joinStage(on) {
    const st = $('joinStage');
    if (!st || (!on && !J.on)) return;
    J.on = !!on;
    st.hidden = !on;
    if (!on) { joinPreview(false); return; }
    const n = theirName;
    putHead($('joinFig'), whoMe());
    putHead($('joinDot'), whoThem());
    text('joinStageTitle', n ? 'Sit beside ' + n : 'Sit beside them');
    text('joinStageText', 'You sit together as soon as ' + (n ? n + ' is' : 'they are') + ' in.');
    J.mic = true;
    joinUi();
    // Camera on as last time, if the browser already lets Beside use it (no question before a tap).
    const want = store.get('beside.joincam') === '1';
    if (want && navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'camera' }).then((p) => { if (p.state === 'granted' && J.on) joinPreview(true); }).catch(() => {});
    }
    // Is the host in the room now? The same quick look as "Move the call here" says so.
    moveProbe((r) => {
      if (!J.on || !r) return;
      if (r.here) { joinStage(false); moveFound(r); return; } // already in the call on another device: Home offers to move it
      if (r.live) text('joinStageText', (n ? n + ' is' : 'They are') + ' in the room now.');
    });
  }
  function joinUi() {
    const cam = !!J.cam;
    const mb = $('joinMicBtn'), cb = $('joinCamBtn');
    if (mb) { mb.setAttribute('aria-pressed', J.mic ? 'false' : 'true'); mb.setAttribute('aria-label', J.mic ? 'Join with my mic off' : 'Join with my mic on'); }
    if (cb) { cb.setAttribute('aria-pressed', cam ? 'true' : 'false'); cb.setAttribute('aria-label', cam ? 'Turn my camera off' : 'Turn my camera on'); }
    text('joinChipText', cam ? 'This is how you look' : 'Your camera is off');
  }
  async function joinPreview(on) {
    const v = $('joinCam');
    if (!on) {
      if (J.cam) { J.cam.getTracks().forEach((t) => t.stop()); J.cam = null; }
      if (v) { v.srcObject = null; v.classList.remove('on'); }
      joinUi();
      return;
    }
    if (J.cam || J.busy) return;
    J.busy = true;
    try {
      const s = await getCam();
      if (!J.on || J.cam) { s.getTracks().forEach((t) => t.stop()); return; }
      J.cam = s;
      if (v) { v.srcObject = s; v.classList.add('on'); v.play().catch(() => {}); }
    } catch (e) { camFail(e, 'info'); } finally { J.busy = false; }
    joinUi();
  }
  function joinGo() {
    const cam = !!J.cam;
    store.set('beside.joincam', cam ? '1' : '0');
    joinStage(false);
    guestJoin(J.mic).then(() => { if (cam && !G.left && !G.cam) guestCam(); });
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
    const target = callId(isGuest ? guestCode : (H.code || hostCode()));
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
      gateWire(c); // locked: the live device asks this one to prove it is listed
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
    gateWire(conn);
    // Locked: only a listed device may look, move the call or ask this one to step back.
    conn.on('open', () => gateRun(conn, () => moveAnswer(conn, m), () => { try { conn.close(); } catch (e) {} }));
    return true;
  }
  function moveAnswer(conn, m) {
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
      const c = p.connect(H.pid, { reliable: true, metadata: { beside: 'yield', as: 'host', since: H.liveSince, cam: !!H.cam } });
      gateWire(c);
      c.on('data', (d) => { if (!gateMsg(d)) bye(); });
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
      const c = p.connect(callId(H.code), { reliable: true, metadata: { beside: 'move', as: 'host' } });
      gateWire(c);
      c.on('data', (d) => { if (!gateMsg(d)) bye(); });
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
  async function copyLink(btn, what) {
    const link = what || hostLink();
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
    LK.lock = null; // the old room's list (and its call id) isn't this room's: hello again for the new one
    LK.sig = '';
    lockStart();
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
  const hostId = PREFIX + guestCode; // the host as this page names it in the call; dialled as G.dial (callId)
  const MIC_BLOCKED = 'Your microphone is blocked, so you can watch and listen but they can’t hear you. Allow the microphone for this site to talk. If this link opened inside another app (WhatsApp, Instagram…), open it in Safari or Chrome instead.';

  function setJoinBusy(b) { ['joinBtn', 'homeRingBtn'].forEach((id) => { const el = $(id); if (el) el.disabled = b; }); }
  async function guestJoin(withMic) {
    if (LK.out) return; // not let in (trusted devices)
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
      // shared tab's. The audio engine starts inside the tap, so it is allowed to run. Clear voice needs it too,
      // and Safari on a Mac plays what you hear through it. Not on an iPhone or iPad: no engine is made there
      // (see outRest), as one makes the whole call crackle. Their videos go without sound.
      if (!G.ctx && !outRest()) { try { G.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { G.ctx = null; } }
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
          if (!(e && e.name === 'NotAllowedError' && steps('mic'))) note(MIC_BLOCKED, 'stay');
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
    peer.on('call', (call) => {
      // Locked: the host's picture waits until the host has proved itself (and is turned away if it can't).
      const bg = G.conn && G.conn.bg;
      if (bg && (bg.st === 'wait' || (bg.st === 'open' && gateOn()))) bg.held.push((ok) => { if (ok) guestOnCall(peer, call); else { try { call.close(); } catch (e) {} } });
      else if (bg && bg.st === 'no') { try { call.close(); } catch (e) {} }
      else guestOnCall(peer, call);
    });
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
    // Only from the link this page knocked on.
    if (G.peer !== peer || G.left || ![G.conn, G.spare].some((c) => c && c.peer === call.peer)) { try { call.close(); } catch (e) {} return; }
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
          if (never) { wait('Can’t connect you two.', 'Trying again…', NET_WHY); netAgain(); }
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
    // The link's id depends on the lock (callId): wait for the first hello (3 s at most) before knocking.
    if (LK.first && !LK.firstDone) { G.retry = setTimeout(guestConnect, 250); return; }
    // The last knock stays open one more round if nobody answered it: a slow call server may still deliver the answer.
    if (G.spare) { const s = G.spare; G.spare = null; try { s.close(); } catch (e) {} }
    const old = G.conn;
    G.conn = null;
    if (old && !old.open && !answered(old)) G.spare = old;
    else if (old) { try { old.close(); } catch (e) {} }
    G.dial = callId(guestCode);
    const conn = G.peer.connect(G.dial, { reliable: true, metadata: G.moveIn ? { name: store.get('beside.name') || '', move: 1 } : { name: store.get('beside.name') || '' } });
    G.conn = conn;
    knock(conn);
  }
  function knock(conn) {
    let opened = false;
    const at = Date.now();
    gateWire(conn);
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
      if (heard && age >= 15000) { wait('Can’t connect you two.', 'Trying again…', NET_WHY); netAgain(); guestRetry(); return; }
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
      // Locked: nothing is said and no picture is taken until the host proves it is one of our own devices.
      gateRun(conn, () => { if (G.conn === conn && !G.left) knockIn(conn); }, (why) => { if (G.conn === conn && !G.left) gateEnd(why); });
    });
    conn.on('close', () => { if (G.conn === conn && (opened || G.call)) guestLost(); });
    conn.on('data', (d) => { if (G.conn === conn && gateLets(conn, d)) guestData(d); });
  }
  function knockIn(conn) {
    tell(conn, { t: 'hello', v: VER, name: cleanName(store.get('beside.name') || ''), share: CAN_SHARE || CAN_LANE });
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
        T.host = (Array.isArray(d.ids) ? d.ids : []).slice(0, 8).map((x) => String(x).slice(0, 80));
        T.blind = !!d.blind;
        guestTalk();
      } else if (d.t === 'snd') {
        soundAsked(d);
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
  function roomReset() { G.hostVer = 0; G.room = null; G.people = []; T.host = []; T.blind = false; setTalk([]); }
  function answered(conn) { const pc = conn && conn.peerConnection; return !!(pc && pc.remoteDescription); }
  function notLiveYet() {
    if (app.state === 'watching') return;
    if (G.serverDown || (G.peer && !G.peer.open)) return; // "Can't reach the call server" stays until we're back
    if (G.lost) { lostText(); return; }
    wait('Waiting for ' + (theirName || 'them'), '',
      'Stay here. You join the moment ' + (theirName ? theirName + ' arrives' : 'they arrive') + '.');
    // Home's Ring button: they aren't in, so their devices ring (once, and only just after the tap).
    if (G.ringOnMiss && Date.now() - G.ringOnMiss < 30000) { G.ringOnMiss = 0; ringThem($('gRingBtn')); }
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
    preCam();
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
  function playWithSound(el, quiet) {
    return el.play().then(() => { app.autoplayErr = ''; tapHide(); return true; }).catch((e) => {
      app.autoplayErr = e && e.name;
      if (!e || e.name !== 'NotAllowedError' || quiet) return false;
      // Sound blocked until the next tap: offer "Tap to hear".
      const t = $('tapToHear');
      if (t) t.hidden = false;
      wakeControls();
      return false;
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
      // The tick for a hidden sharer needs sound unlocked, so the audio engine starts inside this tap. (Never on
      // an iPhone or iPad: they can't share a screen, and an engine there makes the call crackle, see outRest.)
      if (!G.ctx && !IS_IOS) { try { G.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { G.ctx = null; } }
      let s;
      try {
        s = await getDisplay(true);
      } catch (e) {
        shareFail(e, e && /system/i.test(e.message || '') ? 'stay' : 'info');
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
      try { s = await getCam(); } catch (e) { camFail(e, 'stay'); return; }
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
      if (!G.mic || G.mic.getAudioTracks()[0] !== a) { m.getTracks().forEach((x) => x.stop()); return; } // the sound watch got there first
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
    if (IS_IOS) { [...OUT.map.values()].forEach(outDrop); if (G.ctx) { G.ctx.close().catch(() => {}); G.ctx = null; } } // closed, not paused (see outRest)
    else if (G.ctx && G.ctx.state === 'running') G.ctx.suspend().catch(() => {}); // joining again resumes it inside the tap
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
  const ICON = { ok: ico('check'), problem: ico('alert'), warn: ico('alert'), checking: ico('spin'), skip: '' };
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
        app.checks[key] = { state, why: why || '', meta: meta || '' };
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
    checkAnswer();
    sndLogShow();
    const closeBtn = $('checkClose');
    if (closeBtn) closeBtn.focus();

    const basics = checkRow('basics', 'Calls work here');
    const micRow = checkRow('mic', 'Microphone');
    const server = checkRow('server', 'Can reach the call server');
    const net = checkRow('net', 'Network allows direct calls');
    const relayRow = checkRow('relay', 'Relay for blocked networks');
    const link = checkRow('link', isGuest ? 'Connection to ' + (theirName || 'them') : 'Connection to your friend');
    [basics, micRow, server, net, relayRow, link].forEach((r) => r.set('wait'));

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

    // The relay, really tried (Mo, 10 Nov 2026, after "Can't connect you two"): a connection that may only use the
    // relay looks for a way in. Finding one means a blocked network can still carry the call from this device.
    const relayP = (async () => {
      if (srv) return relayRow.set('ok', '', 'Test mode');
      if (!netReady()) await NET.p;
      if (!NET.relay) { netAgain(); return relayRow.set('bad', 'Beside couldn’t get its relay ready. Calls still work when both networks allow direct calls. Close Beside, open it again and run this check once more.', 'Not ready'); }
      let pc;
      try {
        pc = new RTCPeerConnection({ iceServers: NET.ice, iceTransportPolicy: 'relay' });
        pc.createDataChannel('x');
        let got = 0;
        const done = new Promise((res) => {
          pc.onicecandidate = (e) => { if (!e.candidate) res(); else if ((parseCand(e.candidate.candidate) || {}).typ === 'relay') { got++; setTimeout(res, 400); } };
          setTimeout(res, 8000);
        });
        await pc.setLocalDescription(await pc.createOffer());
        await done;
        if (got) relayRow.set('ok', '', 'Ready');
        else relayRow.set('bad', 'This network won’t let Beside reach its relay. If a call can’t connect, one of you should try another network.', 'Blocked');
      } catch (e) {
        relayRow.set('bad', 'Couldn’t test the relay (' + ((e && e.name) || 'unknown') + ').');
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

    await Promise.all([micP, serverP, netP, relayP, linkP]);
    const vals = Object.values(app.checks);
    const bad = vals.filter((c) => c.state === 'bad').length;
    const warn = vals.filter((c) => c.state === 'warn').length;
    const fine = vals.filter((c) => c.state === 'ok').length;
    checkAnswer({ bad, warn, fine, ran: vals.filter((c) => c.state !== 'skip').length });
    app.checkDone = true;
  }
  // One answer first: a big tick and "Everything works", or the one thing that is wrong in plain words. The six
  // checks and the sound log stay folded under it.
  function deviceWord() {
    const u = navigator.userAgent;
    if (/iPhone|iPod/.test(u)) return 'iPhone';
    if (/iPad/.test(u) || (IS_IOS && /Macintosh/.test(u))) return 'iPad';
    if (/Android/.test(u)) return /Mobile/.test(u) ? 'phone' : 'tablet';
    if (/Macintosh/.test(u)) return 'Mac';
    return 'computer';
  }
  const CHECK_WORDS = {
    basics: () => 'Calls do not work in this browser',
    mic: (c) => (c.meta === 'Blocked' ? 'Your microphone is blocked' : c.meta === 'None' ? 'No microphone found' : 'The microphone is not working'),
    server: () => 'Beside cannot reach its call server',
    net: () => 'This network blocks calls',
    relay: (c) => (c.meta === 'Blocked' ? 'This network blocks the relay' : 'The relay is not ready'),
    link: () => (isGuest ? 'The call with ' + (theirName || 'them') + ' is not right yet' : 'The call with your friend is not right yet'),
  };
  function checkAnswer(r) {
    const box = $('checkAnswer'), mark = $('checkMark'), how = $('checkHow');
    if (!box) return;
    const icon = (n) => { if (mark) mark.innerHTML = ico(n, 40); };
    let st = 'checking', title = 'Checking', sum = 'This takes a few seconds.';
    if (how) how.hidden = true;
    if (r) {
      const order = ['basics', 'mic', 'server', 'net', 'relay', 'link'];
      const badKey = order.find((k) => app.checks[k] && app.checks[k].state === 'bad');
      const warnKey = order.find((k) => app.checks[k] && app.checks[k].state === 'warn');
      if (badKey) {
        st = 'problem';
        title = CHECK_WORDS[badKey](app.checks[badKey]);
        sum = app.checks[badKey].why;
        // a blocked microphone: one plain line here, and the steps a tap away
        if (how && badKey === 'mic' && app.checks.mic.meta === 'Blocked') { how.hidden = false; sum = stepsFor('mic').why; }
      } else if (warnKey) {
        st = 'warn'; title = 'Calls should work'; sum = app.checks[warnKey].why;
      } else {
        st = 'ok'; title = 'Everything works'; sum = 'Checked just now on this ' + deviceWord() + '.';
      }
      text('checkCount', r.fine === r.ran ? r.fine + (r.fine === 1 ? ' check passed' : ' checks passed') : r.fine + ' of ' + r.ran + ' checks passed');
    } else text('checkCount', 'The checks');
    box.dataset.st = st;
    icon(st === 'ok' ? 'check' : st === 'checking' ? 'spin' : 'alert');
    text('checkTitle', title);
    text('checkSummary', sum);
  }

  // ---------- A REAL PROBLEM: its own small sheet ----------
  // What is wrong in one heading, one line why, three steps and one button. For the blocked microphone, camera and
  // screen, and rings that need notifications or the Home Screen: the same instructions the app gave in a banner.
  function stepsFor(kind) {
    const them = (isGuest ? theirName : app.people && app.people.them) || 'They';
    const live = inCallNow();
    const ios = IS_IOS, nat = NATIVE(), mac = /Macintosh/.test(navigator.userAgent) && !IS_IOS;
    const br = browserName();
    const site = (what) => (nat
      ? [['Open Settings', 'On this ' + deviceWord() + ', open the Settings app.'], ['Turn on ' + what, 'Find Beside in the list, then turn ' + what + ' on.'], ['Come back', live ? 'Then press End and start the call again.' : 'Then try again.']]
      : ios
        ? [['Tap aA', 'It is at the left of the address bar.'], ['Allow the ' + what.toLowerCase(), 'Tap Website Settings, then ' + what + ', then Allow.'], ['Reload', live ? 'Then press End and start the call again.' : 'Reload the page, then try again.']]
        : [['Click the icon at the left of the address bar', 'It shows what this site may use.'], ['Allow the ' + what.toLowerCase(), 'Turn ' + what + ' on for this site.'], ['Reload', live ? 'Then press End and start the call again.' : 'Reload the page, then try again.']]);
    const reload = !live && !nat ? { label: 'Reload', fn: () => location.reload() } : null;
    const P = {
      mic: { icon: 'mic', slash: true, title: live ? them + ' cannot hear you' : 'Your microphone is blocked', why: 'The microphone is turned off for Beside' + (nat ? '.' : ' in ' + (br === 'Browser' ? 'this browser' : br) + '.'), steps: site('Microphone'), go: reload,
        more: nat ? '' : mac ? 'Still blocked? On a Mac also check System Settings, Privacy and Security, Microphone.' : 'Opened inside WhatsApp or Instagram? Open the link in Safari or Chrome instead.' },
      cam: { icon: 'video', slash: true, title: 'Your camera is blocked', why: 'The camera is turned off for Beside' + (nat ? '.' : ' in ' + (br === 'Browser' ? 'this browser' : br) + '.'), steps: site('Camera').map((x, i) => (i === 2 && live ? ['Come back', 'Then press the camera button again.'] : x)), go: reload },
      camMac: { icon: 'video', slash: true, title: 'Your Mac is blocking the camera', why: 'The Mac itself is not letting ' + br + ' use the camera.',
        steps: [['Open System Settings', 'From the Apple menu.'], ['Privacy and Security, then Camera', 'Turn ' + br + ' on.'], ['Reopen ' + br, 'Quit it and open it again.']] },
      screenMac: { icon: 'screen', title: 'Your Mac is blocking screen sharing', why: 'The Mac itself is not letting ' + br + ' share windows.',
        steps: [['Open System Settings', 'From the Apple menu.'], ['Privacy and Security, then Screen and System Audio Recording', 'Turn ' + br + ' on.'], ['Reopen ' + br, 'Quit it and open it again.']], more: 'Sharing a tab works without this.' },
      homescreen: { icon: 'bell', title: 'Add Beside to your Home Screen', why: 'On iPhone and iPad, rings need Beside on your Home Screen.',
        steps: [['Tap Share', 'The Share button in Safari.'], ['Tap Add to Home Screen', 'Scroll down the list to find it.'], ['Open Beside from there', 'Then tap Let Beside ring me again.']] },
      notify: { icon: 'bell', title: 'Turn on notifications', why: 'Rings need notifications, and they are off for Beside.',
        steps: ios
          ? [['Open Settings', 'On this ' + deviceWord() + ', open the Settings app.'], ['Notifications, then Beside', 'Turn on Allow Notifications.'], ['Come back', 'Then tap Let Beside ring me again.']]
          : [['Click the icon at the left of the address bar', 'It shows what this site may use.'], ['Allow notifications', 'Turn Notifications on for this site.'], ['Come back', 'Then tap Let Beside ring me again.']] },
    };
    return P[kind] || null;
  }
  function steps(kind) {
    const p = stepsFor(kind), sh = $('stepsSheet');
    if (!p || !sh) return false;
    closeMore();
    sh.classList.toggle('dark', inCallNow());
    const m = $('stepsMark');
    if (m) m.innerHTML = ico(p.icon, 38, { slash: !!p.slash });
    text('stepsTitle', p.title);
    text('stepsWhy', p.why);
    const list = $('stepsList');
    list.textContent = '';
    p.steps.forEach(([a, b]) => {
      const li = document.createElement('li');
      const d = document.createElement('div');
      const x = document.createElement('b'), y = document.createElement('span');
      x.textContent = a; y.textContent = b;
      d.append(x, y); li.append(d); list.append(li);
    });
    const more = $('stepsMore');
    more.textContent = p.more || '';
    more.hidden = !p.more;
    const go = $('stepsGo');
    go.textContent = p.go ? p.go.label : 'Got it';
    go.onclick = () => { stepsClose(); if (p.go) p.go.fn(); };
    app.log.push(p.title + '. ' + p.why);
    sh.hidden = false;
    go.focus();
    return true;
  }
  function stepsClose() { const sh = $('stepsSheet'); if (sh) sh.hidden = true; }

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
    // The guest's name field shows on Home until there is a name (Calls and setup's Your name brings it back).
    if ($('nameRow')) $('nameRow').hidden = !!cleanName(saved || '');
    // Calls and setup's quiet way in: the room opens and nobody is rung (the camera starts off).
    on('startBtn', 'click', () => hostStart('voice'));
    on('endedClose', 'click', endClose);
    on('endHeart', 'click', endHeart);
    on('joinX', 'click', () => joinStage(false));
    on('joinGoBtn', 'click', joinGo);
    on('joinMicBtn', 'click', () => { J.mic = !J.mic; joinUi(); });
    on('joinCamBtn', 'click', () => joinPreview(!J.cam));
    tabsBoot();
    homeBoot();
    ['copyBtn', 'moreCopyBtn', 'idleCopyBtn'].forEach((id) => on(id, 'click', () => copyLink($(id))));
    ['shareBtn', 'moreShareBtn', 'idleShareBtn'].forEach((id) => on(id, 'click', () => shareLink($(id))));
    ['mineBtn', 'mineIdleBtn'].forEach((id) => on(id, 'click', () => copyMine($(id))));
    // Calls and setup: "Invite someone else" opens a small sheet with the link, Copy and Send link.
    const inv = $('inviteSheet');
    const invite = (open) => {
      if (!inv) return;
      inv.hidden = !open;
      if (open) { renderLink(); const x = $('inviteClose'); if (x) x.focus(); } else { const r = setupBtn(); if (r) r.focus(); }
    };
    on('inviteRowBtn', 'click', () => invite(true));
    on('inviteClose', 'click', () => invite(false));
    if (inv) {
      inv.addEventListener('click', (e) => { if (e.target === inv) invite(false); });
      inv.addEventListener('keydown', (e) => { if (e.key === 'Escape') invite(false); });
    }
    // Calls and setup: "Sound and mic" opens the Sound panel outside a call, to set it up and try Hear myself.
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
    document.querySelectorAll('[data-sound-open]').forEach((b) => b.addEventListener('click', () => soundSheet(true, b.closest('#setupSheet') ? setupBtn() : b)));
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
    on('screenBtn', 'click', () => { if (amSharing()) hostUnshare(); else shareOpen(true); });
    on('gCamBtn', 'click', guestCam);
    on('gScreenBtn', 'click', () => { if (G.display) guestUnshare(); else shareOpen(true); });
    shareWire();
    on('changeBtn', 'click', () => { closeMore(); hostChange(); });
    on('stopBtn', 'click', () => hostStop());
    document.querySelectorAll('#modeToggle [data-mode]').forEach((b) => b.addEventListener('click', () => { hostMode(b.dataset.mode); setupVals(); }));
    on('hostName', 'change', (e) => { setHostName(e.target.value); setupVals(); });
    on('newLinkBtn', 'click', newLink);
    on('joinBtn', 'click', () => { G.ringOnMiss = 0; guestJoin(true); });
    on('gMuteBtn', 'click', guestMute);
    on('fsBtn', 'click', () => { closeMore(); fullscreen(); });
    on('leaveBtn', 'click', guestLeave);
    on('waitLeaveBtn', 'click', guestLeave);
    on('watchRoot', 'click', swapTap);
    dotWire();
    wirePointing();
    ytWire();
    // More: the tray. Each choice closes it and opens its sheet, or turns Side by side on or off.
    const fromTray = (fn) => () => { trayOpen(false); fn(); };
    on('chatBtn', 'click', fromTray(() => chatOpen(!C.open)));
    on('layoutBtn', 'click', fromTray(() => { V.sbs = V.view !== 'split'; layout(); }));
    on('trayFilm', 'click', fromTray(filmAsk));
    on('trayPlans', 'click', fromTray(() => boardSheet(true)));
    on('traySetup', 'click', fromTray(setupOpen));
    on('shareBarStop', 'click', shareStop);
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
    on('miniBtn', 'click', fromTray(() => { if (mini.win) miniClose(); else miniOpen(); }));
    const sp = $('soundPop');
    if (sp) sp.appendChild(soundPanel(document));
    on('soundBtn', 'click', fromTray(() => soundOpen(!!sp && sp.hidden)));
    on('soundPopClose', 'click', () => { soundOpen(false); const mb = $('moreBtn'); if (mb) mb.focus(); });
    on('ytKeep', 'click', () => { if (W.id) ytSend({ id: W.id, at: ytWant(), play: true }); });
    on('ytStop', 'click', () => ytClose(false));
    document.addEventListener('pointerdown', (e) => {
      if (sp && !sp.hidden && !sp.contains(e.target) && !(e.target.closest && e.target.closest('#soundBtn'))) soundOpen(false);
      if (trayIsOpen() && !(e.target.closest && e.target.closest('#tray, #moreBtn'))) trayOpen(false);
    }, true);
    on('moreBtn', 'click', () => trayOpen(!trayIsOpen()));
    on('moreClose', 'click', closeMore);
    on('tapToHear', 'click', () => {
      const vo = $('voice'), me = $('media');
      if (me && me.srcObject) { me.muted = outMuted(me); me.play().catch(() => {}); }
      if (vo) { vo.muted = outMuted(vo); vo.play().then(tapHide, () => {}); }
      if (G.ctx && G.ctx.state === 'suspended') G.ctx.resume().catch(() => {});
      wakeControls();
    });
    on('checkBtn', 'click', runChecks);
    document.querySelectorAll('[data-check-open]').forEach((b) => b.addEventListener('click', runChecks));
    const sheet = document.querySelector('[data-state="check"]');
    const closeSheet = () => { if (sheet) sheet.hidden = true; wakeControls(); };
    on('checkClose', 'click', closeSheet);
    on('checkX', 'click', closeSheet);
    on('checkHow', 'click', () => { closeSheet(); steps('mic'); });
    on('stepsX', 'click', stepsClose);
    on('stepsSheet', 'click', (e) => { if (e.target === $('stepsSheet')) stepsClose(); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const vw = $('viewer'), st = $('stepsSheet');
      if (st && !st.hidden) stepsClose();
      else if (vw && !vw.hidden) vw.hidden = true;
      else if (sheet && !sheet.hidden) closeSheet();
      else if (HS.setup || HS.cal || HS.todo) homeSheetsClose();
      else if (sp && !sp.hidden) soundOpen(false);
      else if (shareIsOpen()) shareOpen(false);
      else if (setupIsOpen()) closeMore();
      else if (trayIsOpen()) { trayOpen(false); const mb = $('moreBtn'); if (mb) mb.focus(); }
      else if (C.open) chatOpen(false);
      else if (J.on) joinStage(false);
      else if (app.state === 'ended') endClose();
    });
    if (sheet) sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
    const more = $('moreSheet');
    if (more) more.addEventListener('click', (e) => { if (e.target === more) closeMore(); });
    on('endedAction', 'click', () => { if (MV.away) moveHere(); else if (isGuest) { show('join'); joinStage(true); } else hostStart(store.get('beside.start') === 'video' ? 'video' : 'voice'); });
    on('moveBtn', 'click', moveHere);
    on('moveNot', 'click', () => { MV.dismissed = true; moveCardHide(); });
    on('nameInput', 'change', () => { if (app.state === 'join') moveProbe(moveFound); });
    document.addEventListener('pointerdown', () => {
      if (H.ctx && H.ctx.state === 'suspended') H.ctx.resume().catch(() => {});
      if (G.ctx && G.ctx.state === 'suspended' && app.state === 'watching') G.ctx.resume().catch(() => {}); // made again with no mic on: it waits for a tap
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
      const onBubble = e.target && e.target.closest && e.target.closest('#bubbles, #dotSlot');
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
      netKeep();
      if (inCall() || (app.state === 'waiting' && Date.now() - G.waitSince < 20 * 60000)) stayAwake(true);
      resumeMedia();
      soundCheck();
    });
    // The Beside app, and the browser, say when the device's sound changed (headphones, a phone call ending).
    window.besideSound = (why) => { try { soundNative(String(why || '')); } catch (e) {} };
    if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', () => { if (inCallNow()) { sndLog('The speaker, headphones or mic changed.'); setTimeout(soundCheck, 600); } });
    }
    const sv = $('screenVideo');
    if (sv) sv.addEventListener('webkitendfullscreen', () => { if (inCall()) sv.play().catch(() => {}); });
    addEventListener('hashchange', () => location.reload());
    addEventListener('pageshow', (e) => { if (e.persisted) location.reload(); else soundCheck(); });
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
        text('tapToHearText', 'Tap to hear ' + n);
        text('camName', n);
        document.title = n + ' · Beside';
      }
      show('join');
      if (joinFirst()) joinStage(true);
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
    // (after the first hello: locked, the live device's link has the call id)
    if (window.Peer) whenNet(() => setTimeout(() => { if (LK.first && !LK.firstDone) LK.first.then(() => bootProbe(0)); else bootProbe(0); }, 400));
    if (!window.Peer) peerLibOk();
    ringBoot();
    lockBoot();
    // The Voice focus noise remover (voiceiso.js) plugs in here: fn(ctx, mode) gives the node that goes first.
    app.setVoicePre = (fn) => { CLEAR.pre = typeof fn === 'function' ? fn : null; clearRebuild(); };
    if (LOCAL) app.debug = { H, G, V, C, T, SND, OUT, CLEAR, ENGINE_OUT, MV, RG, J, mini, ringBanner, ringing, layout, setVol, setDuck, setMicMode, micWant, renderVoice, setTalk, clearChain, clearNodes, clearGate, clearRebuild, clearEss, CLEAR_TUNE, FOCUS_TUNE, FAR_TUNE, ISO, isoOff, W, ytWatch, ytClose, SW, soundCheck, soundFix, soundAsked, soundNative, laneWatch, engineUp, engineDown, outRest, sndLog, LK }; // automated tests only
    app.booted = true;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
