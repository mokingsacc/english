/* Beside's Together board: a countdown, "thinking of you", a shared to-do list and a calendar, for the two
   people on one Beside link. Kept by Beside's own server (beside-server/, /peerjs/board/<room>), asked
   every 5 s while the page is visible. Changes show straight away and are undone if they can't be saved.
   Use:  BesideBoard.mount(panelElement, { room, name });  BesideBoard.refresh(); */
(() => {
  'use strict';
  if (window.BesideBoard) return;

  // Server: the same origin on sitbeside.pages.dev; ?srv=host:port on this computer (automated tests), like app.js.
  const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const SRV = LOCAL ? new URLSearchParams(location.search).get('srv') : null;
  const BASE = SRV ? 'http://' + SRV : '';
  const POLL_MS = 5000;
  const PHOTO_MAX = 400 * 1024;
  const PHOTO_PX = 1600;
  const ROOM_RE = /^[A-Za-z0-9_]{4,40}$/;
  const LONDON = 'Europe/London';
  const LA = 'America/Los_Angeles';
  const ZONES = [{ z: LONDON, label: 'London' }, { z: LA, label: 'LA' }];
  const HERE = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || LONDON; } catch (e) { return LONDON; } })();
  const DAY = 864e5;
  const SHOW_TODOS = 6;
  const SHOW_DAYS = 3;
  const SHOW_THINKS = 5;

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };

  // ---------- tiny DOM helper: strings always become text (never HTML) ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else if (k === 'html') el.innerHTML = v; // only ever our own fixed icons
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }
  const svg = (d, cls) => `<svg class="${cls || ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I = {
    heart: svg('<path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2z" fill="currentColor" stroke="none"/>'),
    chev: svg('<path d="m6 9 6 6 6-6"/>', 'bb-chev'),
    x: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
    tick: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
    photo: svg('<rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="9" cy="10.5" r="1.8"/><path d="m21 16-5-5-8 8"/>'),
    plus: svg('<path d="M12 5v14M5 12h14"/>'),
    clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    cal: svg('<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
    list: svg('<path d="M9 7h11M9 12h11M9 17h11"/><path d="m3.5 7 1.2 1.2L6.8 6M3.5 12l1.2 1.2 2.1-2.2M3.5 17l1.2 1.2 2.1-2.2"/>'),
    spark: svg('<path d="M12 21s-7-4.3-7-9.5A4 4 0 0 1 12 9a4 4 0 0 1 7 2.5c0 5.2-7 9.5-7 9.5z"/>'),
  };

  // ---------- time, in both homes ----------
  const fmtCache = {};
  function fmt(z, o) {
    const k = z + JSON.stringify(o);
    return fmtCache[k] || (fmtCache[k] = new Intl.DateTimeFormat(undefined, { timeZone: z, ...o }));
  }
  function parts(t, z) {
    const p = {};
    fmt(z, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(t).forEach((x) => { if (x.type !== 'literal') p[x.type] = +x.value; });
    return { y: p.year, mo: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
  }
  const offsetOf = (t, z) => { const p = parts(t, z); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000; };
  // A wall-clock time in a zone (e.g. 19:30 in London) as a moment. Daylight saving handled by Intl.
  function zoned(y, mo, d, hh, mi, z) {
    const guess = Date.UTC(y, mo - 1, d, hh, mi);
    let t = guess - offsetOf(guess, z);
    t = guess - offsetOf(t, z);
    return t;
  }
  const pad = (n) => String(n).padStart(2, '0');
  const keyOf = (t, z) => { const p = parts(t, z); return p.y + '-' + pad(p.mo) + '-' + pad(p.d); };
  // All-day events are kept at 12:00 UTC on their date, so the date is the same for both people.
  const evKey = (e) => (e.allDay ? keyOf(e.at, 'UTC') : keyOf(e.at, HERE));
  const timeIn = (t, z) => fmt(z, { hour: 'numeric', minute: '2-digit' }).format(t);
  const weekdayIn = (t, z) => fmt(z, { weekday: 'short' }).format(t);
  function dayLabel(key) {
    const [y, mo, d] = key.split('-').map(Number);
    const noon = Date.UTC(y, mo - 1, d, 12);
    const today = keyOf(Date.now(), HERE);
    const tmr = keyOf(Date.now() + DAY, HERE);
    const long = fmt('UTC', { weekday: 'short', day: 'numeric', month: 'short' }).format(noon);
    if (key === today) return ['Today', long];
    if (key === tmr) return ['Tomorrow', long];
    return [fmt('UTC', { weekday: 'long' }).format(noon), fmt('UTC', { day: 'numeric', month: 'short', ...(y !== parts(Date.now(), HERE).y ? { year: 'numeric' } : {}) }).format(noon)];
  }
  function ago(t) {
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < DAY / 1000) return Math.floor(s / 3600) + ' h ago';
    const d = Math.floor(s / (DAY / 1000));
    return d === 1 ? 'yesterday' : d + ' days ago';
  }
  // The zone the person probably thinks in: LA if their clock is LA's, otherwise London.
  const myZone = () => (HERE === LA || offsetOf(Date.now(), HERE) === offsetOf(Date.now(), LA) ? LA : LONDON);
  // "7:30 pm London · 11:30 am LA", with the weekday where it's a different day there.
  function bothTimes(t, dayKey) {
    return ZONES.map(({ z, label }) => {
      const k = keyOf(t, z);
      return timeIn(t, z) + ' ' + label + (dayKey && k !== dayKey ? ' (' + weekdayIn(t, z) + ')' : '');
    }).join('  ·  ');
  }

  // ---------- photos: shrunk here, so they're small to send and keep ----------
  const dataBytes = (d) => { const b = d.slice(d.indexOf(',') + 1); return Math.floor(b.length * 3 / 4) - (b.endsWith('==') ? 2 : b.endsWith('=') ? 1 : 0); };
  async function shrink(file) {
    if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('That isn’t a photo.');
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = () => rej(new Error('That photo couldn’t be opened. Try another one.'));
        i.src = url;
      });
      const w0 = img.naturalWidth, h0 = img.naturalHeight;
      if (!w0 || !h0) throw new Error('That photo couldn’t be opened. Try another one.');
      const c = document.createElement('canvas');
      const x = c.getContext('2d');
      let max = PHOTO_PX;
      for (let round = 0; round < 6; round++) {
        const s = Math.min(1, max / Math.max(w0, h0));
        c.width = Math.max(1, Math.round(w0 * s));
        c.height = Math.max(1, Math.round(h0 * s));
        x.fillStyle = '#fff';
        x.fillRect(0, 0, c.width, c.height);
        x.drawImage(img, 0, 0, c.width, c.height);
        for (const q of [0.82, 0.7, 0.56]) {
          let d = c.toDataURL('image/webp', q);
          if (!/^data:image\/webp/.test(d)) d = c.toDataURL('image/jpeg', q); // Safari before 17 can't make WebP
          if (dataBytes(d) < PHOTO_MAX) return d;
        }
        max = Math.round(max * 0.75);
      }
      throw new Error('That photo is too big to send. Try another one.');
    } finally { URL.revokeObjectURL(url); }
  }

  // ---------- the board, as the server has it plus changes on their way ----------
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10).padEnd(8, '0');
  const empty = () => ({ v: -1, countdown: null, todos: [], events: [], thinks: [] });
  function applyOp(b, o) {
    const now = Date.now();
    switch (o.op) {
      case 'countdown.set': b.countdown = { title: o.title, at: o.at, by: o.by }; break;
      case 'countdown.clear': b.countdown = null; break;
      case 'todo.add': if (!b.todos.some((t) => t.id === o.id)) b.todos = b.todos.concat({ id: o.id, text: o.text, done: false, by: o.by, at: now }); break;
      case 'todo.toggle': b.todos = b.todos.map((t) => (t.id === o.id ? { ...t, done: o.done, doneAt: now } : t)); break;
      case 'todo.delete': b.todos = b.todos.filter((t) => t.id !== o.id); break;
      case 'event.add': if (!b.events.some((e) => e.id === o.id)) b.events = b.events.concat({ id: o.id, title: o.title, at: o.at, allDay: !!o.allDay, by: o.by }).sort((x, y) => x.at - y.at); break;
      case 'event.delete': b.events = b.events.filter((e) => e.id !== o.id); break;
      case 'think': if (!b.thinks.some((t) => t.id === o.id)) b.thinks = [{ id: o.id, from: o.from, note: o.note, at: now, photo: !!o.photo, local: o.photo || null }].concat(b.thinks).slice(0, 20); break;
      default:
    }
    return b;
  }

  let S = null; // the mounted board

  function api(path, opts, ms) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), ms || 10000);
    return fetch(BASE + '/peerjs/board/' + S.room + (path || ''), { cache: 'no-store', ...opts, signal: c.signal }).finally(() => clearTimeout(t));
  }
  const photoUrl = (t) => t.local || BASE + '/peerjs/board/' + S.room + '/photo/' + encodeURIComponent(t.id);

  function view() {
    const b = JSON.parse(JSON.stringify(S.server));
    S.pending.forEach((o) => applyOp(b, o));
    return b;
  }

  function accept(b) {
    if (!b || typeof b.v !== 'number' || b.same) return false;
    if (b.v < S.server.v) return false; // an older answer that arrived late
    const fresh = b.v !== S.server.v;
    S.server = b;
    return fresh;
  }

  async function poll() {
    if (!S || S.polling) return;
    S.polling = true;
    const me = S;
    try {
      const r = await api('?v=' + S.server.v, {}, 8000);
      if (!r.ok) throw new Error(String(r.status));
      const b = await r.json();
      if (me !== S) return;
      S.fails = 0;
      S.loaded = true;
      if (accept(b) || S.offline) { S.offline = false; render(); }
    } catch (e) {
      if (me !== S) return;
      S.fails++;
      if (S.fails >= 2 && !S.offline) { S.offline = true; render(); }
    } finally {
      me.polling = false;
    }
  }
  function schedule() {
    clearTimeout(S.timer);
    const me = S;
    S.timer = setTimeout(async () => {
      if (me !== S) return;
      if (document.visibilityState === 'visible' && S.el.isConnected) await poll();
      if (me === S) schedule();
    }, POLL_MS);
  }
  function onVisible() { if (S && document.visibilityState === 'visible') { poll(); schedule(); } }

  // One change: shown at once, sent in order, and taken back with a plain note if it can't be saved.
  function send(o, what) {
    o.by = S.name;
    S.pending.push(o);
    render();
    const me = S;
    S.chain = S.chain.then(async () => {
      let msg = '';
      try {
        const r = await api('', { method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(o) }, 30000);
        if (r.ok) accept(await r.json());
        else msg = r.status === 400 ? (await r.text()).slice(0, 200) : 'The board isn’t answering. Please try again.';
      } catch (e) {
        msg = 'The connection dropped. Please try again.';
      }
      if (me !== S) return;
      S.pending = S.pending.filter((p) => p !== o);
      if (msg) note('Couldn’t save ' + what + '. ' + msg);
      render();
    });
  }

  function note(text, action) {
    const n = S.ui.note;
    n.replaceChildren(...[h('span', { text }), action ? h('button', { type: 'button', class: 'bb-note-act', onclick: () => { action.fn(); n.hidden = true; } }, action.label) : null,
      h('button', { type: 'button', class: 'bb-note-x', 'aria-label': 'Close', html: I.x, onclick: () => { n.hidden = true; } })].filter(Boolean));
    n.hidden = false;
    clearTimeout(S.noteT);
    S.noteT = setTimeout(() => { n.hidden = true; }, action ? 12000 : 9000);
  }

  // ---------- sections ----------
  const SECTIONS = [
    { id: 'countdown', title: 'Countdown', icon: I.clock },
    { id: 'think', title: 'Thinking of you', icon: I.spark },
    { id: 'todo', title: 'To-do', icon: I.list },
    { id: 'cal', title: 'Calendar', icon: I.cal },
  ];
  function section(s) {
    if (S.split) { // tabs: each section is a plain card, always open
      const sum = h('span', { class: 'bb-sum' });
      const body = h('div', { class: 'bb-body', id: 'bb-' + s.id });
      const sec = h('section', { class: 'bb-sec bb-card', 'data-sec': s.id }, h('div', { class: 'bb-head bb-head-static' }, h('h3', { text: s.title }), sum), body);
      return { sec, sum, body };
    }
    const closed = (store.get('bboard.closed') || []).includes(s.id);
    const sum = h('span', { class: 'bb-sum' });
    const body = h('div', { class: 'bb-body', id: 'bb-' + s.id });
    const head = h('button', { type: 'button', class: 'bb-head', 'aria-expanded': String(!closed), 'aria-controls': 'bb-' + s.id, onclick: () => {
      const open = head.getAttribute('aria-expanded') !== 'true';
      head.setAttribute('aria-expanded', String(open));
      sec.classList.toggle('bb-closed', !open);
      const list = (store.get('bboard.closed') || []).filter((x) => x !== s.id);
      if (!open) list.push(s.id);
      store.set('bboard.closed', list);
    } }, h('span', { class: 'bb-ico', html: s.icon }), h('h3', { text: s.title }), sum, h('span', { html: I.chev }));
    const sec = h('section', { class: 'bb-sec' + (closed ? ' bb-closed' : ''), 'data-sec': s.id }, head, body);
    return { sec, sum, body };
  }
  // A "Show 4 more" / "Done (3)" fold that stays open or shut across refreshes.
  function fold(key, label, kids) {
    const open = !!S.folds[key];
    const wrap = h('div', { class: 'bb-fold' + (open ? ' bb-open' : '') });
    wrap.append(h('button', { type: 'button', class: 'bb-fold-btn', 'aria-expanded': String(open), 'data-fold': key, onclick: () => { S.folds[key] = !S.folds[key]; render(); } },
      open ? label[1] : label[0], h('span', { html: I.chev })));
    if (open) wrap.append(...[].concat(kids));
    return wrap;
  }

  // A date + time + "which home's clock" picker, shared by the countdown and the calendar.
  function whenPicker(allowAllDay) {
    let zone = myZone();
    const date = h('input', { type: 'date', class: 'bb-in', required: true, 'aria-label': 'Date' });
    const time = h('input', { type: 'time', class: 'bb-in', 'aria-label': 'Time' + (allowAllDay ? ' (leave empty for all day)' : '') });
    const btns = ZONES.map(({ z, label }) => h('button', { type: 'button', 'data-z': z, 'aria-pressed': String(z === zone), onclick: () => { zone = z; paint(); } }, label + ' time'));
    const seg = h('div', { class: 'bb-seg', role: 'group', 'aria-label': 'Whose time' }, btns);
    const paint = () => btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.z === zone)));
    const el = h('div', { class: 'bb-when' }, h('div', { class: 'bb-when-row' }, date, time), seg,
      allowAllDay ? h('p', { class: 'bb-hint', text: 'No time means all day.' }) : null);
    return {
      el,
      set(t, dateOnly) {
        const p = parts(t != null ? t : Date.now(), zone);
        date.value = p.y + '-' + pad(p.mo) + '-' + pad(p.d);
        time.value = t != null && !dateOnly ? pad(p.h) + ':' + pad(p.mi) : '';
        paint();
      },
      read() {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.value);
        if (!m) return null;
        const [y, mo, d] = [+m[1], +m[2], +m[3]];
        const tm = /^(\d{2}):(\d{2})/.exec(time.value);
        if (!tm && allowAllDay) return { at: Date.UTC(y, mo - 1, d, 12), allDay: true };
        return { at: zoned(y, mo, d, tm ? +tm[1] : 0, tm ? +tm[2] : 0, zone), allDay: false };
      },
    };
  }

  function build() {
    const root = S.el;
    root.classList.add('bboard');
    const ui = {};
    ui.note = h('div', { class: 'bb-note', role: 'status', hidden: true });
    const secs = {};
    SECTIONS.forEach((s) => { secs[s.id] = section(s); });
    ui.secs = secs;

    // Countdown
    {
      const s = secs.countdown;
      ui.cdShow = h('div', { class: 'bb-cd' });
      const title = h('input', { type: 'text', class: 'bb-in', maxlength: 300, placeholder: 'What are you counting down to?', 'aria-label': 'Countdown title', autocomplete: 'off', enterkeyhint: 'done' });
      const when = whenPicker(false);
      const clear = h('button', { type: 'button', class: 'bb-btn bb-danger', onclick: () => {
        const old = view().countdown;
        ui.cdForm.hidden = true;
        send({ op: 'countdown.clear' }, 'that');
        if (old) note('Countdown cleared.', { label: 'Undo', fn: () => send({ op: 'countdown.set', title: old.title, at: old.at }, 'the countdown') });
      } }, 'Clear');
      ui.cdForm = h('form', { class: 'bb-form', hidden: true, onsubmit: (e) => {
        e.preventDefault();
        const t = title.value.trim();
        const w = when.read();
        if (!t) { title.focus(); return; }
        if (!w) return;
        ui.cdForm.hidden = true;
        send({ op: 'countdown.set', title: t.slice(0, 300), at: w.at }, 'the countdown');
      } }, title, when.el, h('div', { class: 'bb-acts' },
        h('button', { type: 'submit', class: 'bb-btn bb-primary' }, 'Save'),
        h('button', { type: 'button', class: 'bb-btn bb-quiet', onclick: () => { ui.cdForm.hidden = true; render(); } }, 'Cancel'), clear));
      ui.cdOpen = () => {
        const c = view().countdown;
        title.value = c ? c.title : '';
        when.set(c ? c.at : null);
        clear.hidden = !c;
        ui.cdForm.hidden = false;
        render();
        title.focus();
      };
      s.body.append(ui.cdShow, ui.cdForm);
    }

    // Thinking of you
    {
      const s = secs.think;
      ui.thTop = h('div', { class: 'bb-th-top' });
      let photo = null;
      const file = h('input', { type: 'file', accept: 'image/*', hidden: true, class: 'bb-file' });
      const prev = h('div', { class: 'bb-prev', hidden: true });
      const noteIn = h('textarea', { class: 'bb-in bb-ta', rows: 2, maxlength: 300, placeholder: 'Add a few words (optional)', 'aria-label': 'Note' });
      const showPhoto = () => {
        prev.replaceChildren();
        prev.hidden = !photo;
        if (photo) prev.append(h('img', { src: photo, alt: 'Photo to send' }), h('button', { type: 'button', class: 'bb-x', 'aria-label': 'Remove photo', html: I.x, onclick: () => { photo = null; showPhoto(); } }));
      };
      file.addEventListener('change', async () => {
        const f = file.files && file.files[0];
        file.value = '';
        if (!f) return;
        pick.disabled = true;
        pick.lastChild.textContent = 'Getting it ready…';
        try { photo = await shrink(f); showPhoto(); } catch (e) { note(e.message); }
        pick.disabled = false;
        pick.lastChild.textContent = 'Add a photo';
      });
      const pick = h('button', { type: 'button', class: 'bb-btn bb-quiet', onclick: () => file.click() }, h('span', { html: I.photo }), h('span', { text: 'Add a photo' }));
      const extra = h('div', { class: 'bb-th-extra', hidden: true }, noteIn, h('div', { class: 'bb-acts' }, pick, file), prev);
      const more = h('button', { type: 'button', class: 'bb-link', 'aria-expanded': 'false', onclick: () => {
        extra.hidden = !extra.hidden;
        more.setAttribute('aria-expanded', String(!extra.hidden));
        more.textContent = extra.hidden ? 'Add a note or photo' : 'Just send it plain';
        if (!extra.hidden) noteIn.focus(); else { noteIn.value = ''; photo = null; showPhoto(); }
      } }, 'Add a note or photo');
      const go = h('button', { type: 'button', class: 'bb-btn bb-primary bb-warm', onclick: () => {
        if (go.disabled) return;
        sendThink(noteIn.value.trim().slice(0, 300), photo);
        noteIn.value = ''; photo = null; showPhoto();
        extra.hidden = true; more.textContent = 'Add a note or photo'; more.setAttribute('aria-expanded', 'false');
        go.disabled = true;
        go.classList.add('bb-sent');
        go.lastChild.textContent = 'Sent with love';
        setTimeout(() => { go.disabled = false; go.classList.remove('bb-sent'); go.lastChild.textContent = 'I’m thinking of you'; }, 2500);
      } }, h('span', { html: I.heart }), h('span', { text: 'I’m thinking of you' }));
      ui.thSent = h('p', { class: 'bb-hint bb-center' });
      ui.thList = h('div');
      s.body.append(ui.thTop, h('div', { class: 'bb-th-send' }, go, more, extra, ui.thSent), ui.thList);
    }

    // To-do
    {
      const s = secs.todo;
      const inp = h('input', { type: 'text', class: 'bb-in', maxlength: 300, placeholder: 'Add a to-do', 'aria-label': 'New to-do', autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'enter' });
      const form = h('form', { class: 'bb-add', onsubmit: (e) => {
        e.preventDefault();
        const t = inp.value.trim();
        if (!t) { inp.focus(); return; }
        inp.value = '';
        send({ op: 'todo.add', id: newId(), text: t.slice(0, 300) }, '“' + short(t) + '”');
      } }, inp, h('button', { type: 'submit', class: 'bb-btn bb-primary bb-add-btn', 'aria-label': 'Add to-do' }, h('span', { html: I.plus }), h('span', { class: 'bb-add-word', text: 'Add' })));
      ui.todoList = h('div', { class: 'bb-list-wrap' });
      s.body.append(form, ui.todoList);
    }

    // Calendar
    {
      const s = secs.cal;
      ui.calList = h('div', { class: 'bb-list-wrap' });
      const title = h('input', { type: 'text', class: 'bb-in', maxlength: 300, placeholder: 'What’s happening?', 'aria-label': 'Event title', autocomplete: 'off', enterkeyhint: 'done' });
      const when = whenPicker(true);
      const form = h('form', { class: 'bb-form', hidden: true, onsubmit: (e) => {
        e.preventDefault();
        const t = title.value.trim();
        const w = when.read();
        if (!t) { title.focus(); return; }
        if (!w) return;
        title.value = '';
        form.hidden = true; open.hidden = false;
        send({ op: 'event.add', id: newId(), title: t.slice(0, 300), at: w.at, allDay: w.allDay }, '“' + short(t) + '”');
      } }, title, when.el, h('div', { class: 'bb-acts' },
        h('button', { type: 'submit', class: 'bb-btn bb-primary' }, 'Add to calendar'),
        h('button', { type: 'button', class: 'bb-btn bb-quiet', onclick: () => { form.hidden = true; open.hidden = false; } }, 'Cancel')));
      const open = h('button', { type: 'button', class: 'bb-btn bb-quiet bb-wide', onclick: () => { when.set(null); form.hidden = false; open.hidden = true; title.focus(); } },
        h('span', { html: I.plus }), h('span', { text: 'Add an event' }));
      ui.calAddOn = (t) => { when.set(t, true); form.hidden = false; open.hidden = true; title.focus(); };
      if (S.split) { ui.week = h('div', { class: 'bb-week', role: 'group', 'aria-label': 'This week' }); s.body.append(ui.week); }
      s.body.append(ui.calList, open, form);
    }

    // Say it: one sentence becomes to-dos, events or a countdown (the keyboard's mic does the listening).
    {
      const inp = h('input', { type: 'text', class: 'bb-in', maxlength: 300, placeholder: 'Say it: dinner Friday 7pm', 'aria-label': 'Add by saying it', autocomplete: 'off', autocapitalize: 'sentences', enterkeyhint: 'send' });
      const go = h('button', { type: 'submit', class: 'bb-btn bb-primary bb-add-btn', 'aria-label': 'Add it' }, h('span', { html: I.plus }), h('span', { class: 'bb-add-word', text: 'Add' }));
      ui.talkIn = inp; ui.talkGo = go;
      ui.talk = h('form', { class: 'bb-add bb-talk', onsubmit: (e) => {
        e.preventDefault();
        const t = inp.value.trim();
        if (!t) { inp.focus(); return; }
        talk(t);
      } }, inp, go);
    }

    ui.status = h('p', { class: 'bb-status', role: 'status' });
    ui.clocks = h('div', { class: 'bb-clocks', 'aria-label': 'Your times and weather' });
    S.ui = ui;
    if (S.split) { buildSplit(ui, secs); return; }
    root.replaceChildren(ui.note, ui.clocks, ui.talk,
      h('div', { class: 'bb-grid' },
        h('div', { class: 'bb-col' }, secs.countdown.sec, secs.think.sec),
        h('div', { class: 'bb-col' }, secs.todo.sec, secs.cal.sec)),
      ui.status);
  }

  // ---------- the app's tabs: each part goes where the app asks (Home, Plans, Hearts) ----------
  const FIG = () => window.BesideFigures || null;
  // Who is who comes from the app: the room's host is Mo, the guest is Semal. Only with no role (the board's own
  // page) does the clock decide.
  const whoMe = () => (S && S.role === 'host' ? 'mo' : S && S.role === 'guest' ? 'semal' : myZone() === LA ? 'semal' : 'mo');
  const whoThem = () => (whoMe() === 'mo' ? 'semal' : 'mo');
  const zoneOf = (who) => (who === 'semal' ? LA : LONDON);
  // The figure for whoever sent something, picked by their name.
  const whoOf = (from) => {
    const n = String(from || '').trim().toLowerCase();
    const F = FIG();
    if (F) { const hit = Object.keys(F.NAME).find((k) => F.NAME[k].toLowerCase() === n); if (hit) return hit; }
    return isMe(from) ? whoMe() : whoThem();
  };
  const placeholderName = (n) => !n || /^(host|guest|someone)$/i.test(n.trim());
  // Their name: from the app, else the latest name on the board that isn't mine, else the figure's own name.
  function theirName(b) {
    if (S.them) return S.them;
    const names = [];
    (b ? b.thinks : []).forEach((t) => names.push([t.at || 0, t.from]));
    (b ? b.todos : []).forEach((t) => names.push([t.at || 0, t.by]));
    (b ? b.events : []).forEach((e) => names.push([e.at || 0, e.by]));
    names.sort((x, y) => y[0] - x[0]);
    const n = names.map((x) => x[1]).find((x) => x && !isMe(x) && !placeholderName(x));
    return n || '';
  }
  const nameFor = (who, b) => (who === whoMe() ? (placeholderName(S.name) ? '' : S.name) : theirName(b)) || (FIG() ? FIG().NAME[who] : '');
  const figHtml = (who, o) => (FIG() ? FIG().figure(who, { name: nameFor(who, S.lastView), ...(o || {}) }) : '');
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const shown = (el) => !!el && el.getClientRects().length > 0;

  function buildSplit(ui, secs) {
    const T = S.t;
    const put = (k, ...kids) => { if (T[k]) { T[k].classList.add('bboard', 'bb-tabs'); T[k].replaceChildren(...kids.filter(Boolean)); } };
    ui.talk.prepend(h('span', { class: 'bb-talk-label', text: 'Say it. Type, or use your keyboard mic.' }));
    // Home
    ui.hello = h('div', { class: 'bb-hello' }, h('span', { class: 'bb-hello-day' }), h('h1', { class: 'bb-hello-hi' }));
    ui.hThink = h('div', { class: 'bb-hcard bb-hthink' });
    ui.hNext = h('button', { type: 'button', class: 'bb-hcard bb-hnext', onclick: () => go('plans') });
    put('hello', ui.hello);
    put('skies', ui.clocks);
    ui.clocks.classList.add('bb-figs');
    put('homeThink', ui.hThink);
    put('countdown', secs.countdown.sec);
    put('next', ui.hNext);
    // Plans
    put('plans', ui.talk, h('div', { class: 'bb-grid' }, h('div', { class: 'bb-col' }, secs.cal.sec), h('div', { class: 'bb-col' }, secs.todo.sec)), ui.status);
    // Hearts
    ui.hScene = h('div', { class: 'bb-hscene bb-figs', html: FIG() ? FIG().pair({ label: 'Mo and Semal, hand in hand' }) : '' });
    put('hearts', h('div', { class: 'bb-grid' }, h('div', { class: 'bb-col' }, ui.hScene, secs.think.sec), h('div', { class: 'bb-col bb-hist' }, ui.thHist = h('section', { class: 'bb-sec bb-card', 'data-sec': 'history' },
      h('div', { class: 'bb-head bb-head-static' }, h('h3', { text: 'Earlier' })), ui.thHistBody = h('div', { class: 'bb-body' })))));
    put('note', ui.note);
  }
  const go = (tab) => { if (S && S.opts.go) S.opts.go(tab); };

  // Thinking of you: sent at once, and on screen a soft heart floats from your figure to theirs as you both lean in.
  function sendThink(noteText, photo) {
    // role: the server pings the other person's devices (host is Mo, guest is Semal).
    send({ op: 'think', id: newId(), from: S.name, note: noteText || '', photo: photo || undefined, role: S.role || undefined }, 'that');
    celebrate();
  }
  function celebrate() {
    const me = whoMe(), them = whoThem();
    const pick = (who) => [...document.querySelectorAll('.bb-figs [data-fig="' + who + '"]')].find(shown);
    const a = pick(me), b = pick(them);
    if (!a || !b || reduced()) return;
    const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
    const right = ra.left < rb.left;
    a.classList.add(right ? 'fig-lean-r' : 'fig-lean-l');
    b.classList.add(right ? 'fig-lean-l' : 'fig-lean-r');
    const x0 = ra.left + ra.width / 2, y0 = ra.top + ra.height * 0.3, x1 = rb.left + rb.width / 2, y1 = rb.top + rb.height * 0.3;
    const cx = (x0 + x1) / 2, cy = Math.min(y0, y1) - Math.max(40, Math.abs(x1 - x0) * 0.35);
    const el = h('div', { class: 'bb-fly', html: FIG().softHeart() });
    document.body.append(el);
    const frames = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24, u = 1 - t;
      const x = u * u * x0 + 2 * u * t * cx + t * t * x1, y = u * u * y0 + 2 * u * t * cy + t * t * y1;
      const sc = 0.55 + 0.6 * Math.sin(Math.PI * Math.min(1, t * 1.1)) * 0.8 + 0.25 * t;
      frames.push({ transform: 'translate(' + (x - 14).toFixed(1) + 'px,' + (y - 14).toFixed(1) + 'px) scale(' + sc.toFixed(3) + ')', opacity: t < 0.12 ? t / 0.12 : t > 0.88 ? (1 - t) / 0.12 : 1 });
    }
    const done = () => {
      el.remove();
      b.classList.add('fig-glad');
      setTimeout(() => { a.classList.remove('fig-lean-r', 'fig-lean-l'); b.classList.remove('fig-lean-r', 'fig-lean-l', 'fig-glad'); }, 1300);
    };
    try { el.animate(frames, { duration: 1900, easing: 'cubic-bezier(.4,0,.3,1)', fill: 'forwards' }).onfinish = done; } catch (e) { done(); }
  }

  const short = (t) => (t.length > 40 ? t.slice(0, 38) + '…' : t);

  // "“Dinner”, Fri 6 Nov, 7:00 pm London"
  function said(a) {
    if (a.kind === 'todo') return '“' + short(a.text) + '” to the list';
    const z = myZone();
    const day = a.allDay ? fmt('UTC', { weekday: 'short', day: 'numeric', month: 'short' }).format(a.at) : fmt(z, { weekday: 'short', day: 'numeric', month: 'short' }).format(a.at);
    const time = a.allDay ? '' : ', ' + timeIn(a.at, z) + ' ' + (z === LA ? 'LA' : 'London');
    return (a.kind === 'countdown' ? 'a countdown to “' : '“') + short(a.title) + '”, ' + day + time;
  }
  async function talk(t) {
    if (S.talking) return;
    const me = S;
    S.talking = true;
    S.ui.talkGo.disabled = true;
    render();
    let msg = '';
    try {
      const r = await api('/talk', { method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ text: t.slice(0, 300), by: S.name, zone: myZone() }) }, 35000);
      if (r.ok) {
        const j = await r.json();
        if (me !== S) return;
        accept(j.board);
        if (j.added && j.added.length) {
          if (S.ui.talkIn.value.trim() === t) S.ui.talkIn.value = '';
          const undo = j.undo || [];
          note('Added ' + j.added.map(said).join(', and ') + '.', undo.length ? { label: 'Undo', fn: () => undo.forEach((o) => send(o, 'the undo')) } : null);
        } else note(j.reply || 'Nothing in that could go on the board.');
      } else msg = [400, 429, 503].includes(r.status) ? (await r.text()).slice(0, 200) : 'The board isn’t answering. Please try again.';
    } catch (e) {
      msg = 'The connection dropped. Please try again.';
    } finally {
      if (me === S) {
        S.talking = false;
        S.ui.talkGo.disabled = false;
        if (msg) note(msg);
        render();
      }
    }
  }
  const isMe = (n) => !!n && !!S.name && n.trim().toLowerCase() === S.name.trim().toLowerCase();

  function showPhoto(src) {
    const v = h('div', { class: 'bboard bb-viewer', role: 'dialog', 'aria-label': 'Photo', onclick: () => v.remove() }, h('img', { src, alt: '' }));
    const esc = (e) => { if (e.key === 'Escape') { v.remove(); document.removeEventListener('keydown', esc); } };
    document.addEventListener('keydown', esc);
    document.body.append(v);
  }

  // ---------- both your times and weather ----------
  // Weather from Open-Meteo (free, no key, no personal data: two fixed places), asked at most every 30 minutes.
  const PLACES = [
    { z: LONDON, label: 'London', lat: 51.51, lon: -0.13, unit: 'C' },
    { z: LA, label: 'Los Angeles', lat: 34.05, lon: -118.24, unit: 'F' },
  ];
  const WX = { at: 0, busy: false, now: {} };
  const SKY = [[0, 'Clear'], [1, 'Mostly clear'], [2, 'Partly cloudy'], [3, 'Cloudy'], [48, 'Fog'], [57, 'Drizzle'], [65, 'Rain'],
    [67, 'Freezing rain'], [77, 'Snow'], [82, 'Showers'], [86, 'Snow showers'], [99, 'Thunderstorms']];
  const sky = (c) => { for (const [max, w] of SKY) if (c <= max) return w; return ''; };
  function weather() {
    if (WX.busy || Date.now() - WX.at < 30 * 60000) return;
    WX.busy = true;
    const q = 'latitude=' + PLACES.map((p) => p.lat).join(',') + '&longitude=' + PLACES.map((p) => p.lon).join(',') + '&current=temperature_2m,weather_code,is_day&timezone=auto';
    fetch('https://api.open-meteo.com/v1/forecast?' + q, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => {
      const list = Array.isArray(j) ? j : j ? [j] : [];
      list.forEach((x, i) => { if (x && x.current && PLACES[i]) WX.now[PLACES[i].z] = x.current; });
      if (list.length) { WX.at = Date.now(); render(); }
    }).catch(() => {}).finally(() => { WX.busy = false; });
  }
  function partOfDay(hr) { return hr < 5 ? 'night' : hr < 12 ? 'morning' : hr < 17 ? 'afternoon' : hr < 21 ? 'evening' : 'night'; }
  // The two skies (tabs): built once, then only words, colours and the weather's little picture change, so the
  // figures keep moving smoothly.
  const wxKind = (c) => (typeof c !== 'number' ? '' : c <= 1 ? 'clear' : c <= 3 ? 'cloud' : c <= 48 ? 'fog' : c <= 67 || (c >= 80 && c <= 82) || c >= 95 ? 'rain' : 'snow');
  let decoSeq = 0;
  const DECO = {
    sun: '<svg class="bb-deco bb-sun" viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="34" fill="#EDBE7A"/></svg>',
    moon: '<svg class="bb-deco bb-moon" viewBox="0 0 80 80" aria-hidden="true"><path d="M52 10 A30 30 0 1 0 70 52 A24 24 0 1 1 52 10 Z" fill="#F1E6C8"/></svg><svg class="bb-deco bb-stars" viewBox="0 0 160 60" aria-hidden="true"><circle cx="20" cy="14" r="1.6" fill="#F1E6C8"/><circle cx="64" cy="30" r="1.2" fill="#F1E6C8"/><circle cx="110" cy="10" r="1.4" fill="#F1E6C8"/><circle cx="138" cy="40" r="1.1" fill="#F1E6C8"/><circle cx="40" cy="48" r="1" fill="#F1E6C8"/></svg>',
    cloud: '<svg class="bb-deco bb-cloud" viewBox="0 0 120 50" aria-hidden="true"><path d="M24 44 a14 14 0 0 1 2-28 a20 20 0 0 1 38-6 a16 16 0 0 1 30 10 a12 12 0 0 1 2 24 Z" fill="currentColor"/></svg>',
    // Rain and snow fill the whole card at any size: a tile of drops repeated, never stretched.
    rain: () => { const id = 'bbrain' + (++decoSeq); return '<svg class="bb-deco bb-rain" aria-hidden="true"><defs><pattern id="' + id + '" width="58" height="46" patternUnits="userSpaceOnUse"><path d="M12 4l-4 9M40 18l-4 9M26 32l-4 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></pattern></defs><rect width="100%" height="100%" fill="url(#' + id + ')"/></svg>'; },
    snow: () => { const id = 'bbsnow' + (++decoSeq); return '<svg class="bb-deco bb-snow" aria-hidden="true"><defs><pattern id="' + id + '" width="56" height="50" patternUnits="userSpaceOnUse"><g fill="currentColor"><circle cx="10" cy="8" r="2"/><circle cx="38" cy="20" r="1.6"/><circle cx="22" cy="38" r="1.8"/></g></pattern></defs><rect width="100%" height="100%" fill="url(#' + id + ')"/></svg>'; },
  };
  const WX_ICON = {
    clear: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    night: '<path d="M19 14.5A8 8 0 0 1 9.5 5a8 8 0 1 0 9.5 9.5z"/>',
    cloud: '<path d="M7 18a4 4 0 0 1 .5-8A5 5 0 0 1 17 11a3.5 3.5 0 0 1 0 7z"/>',
    fog: '<path d="M4 9h16M6 13h12M4 17h16"/>',
    rain: '<path d="M7 15a4 4 0 0 1 .5-8A5 5 0 0 1 17 8a3.5 3.5 0 0 1 0 7z"/><path d="M8 18l-1 2M12 18l-1 2M16 18l-1 2"/>',
    snow: '<path d="M7 15a4 4 0 0 1 .5-8A5 5 0 0 1 17 8a3.5 3.5 0 0 1 0 7z"/><path d="M8 19h.01M12 20h.01M16 19h.01"/>',
  };
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  const clockText = (t, z) => fmt(z, { hour: 'numeric', minute: '2-digit' }).formatToParts(t).filter((x) => x.type !== 'dayPeriod').map((x) => x.value).join('').trim();
  function drawSkies(now) {
    const el = S.ui.clocks;
    const b = S.lastView;
    if (!S.ui.skies) {
      S.ui.skies = PLACES.map((p) => {
        const who = p.z === LA ? 'semal' : 'mo';
        const r = {
          place: h('span', { class: 'bb-clock-place', text: p.label }),
          whoEl: h('span', { class: 'bb-clock-who' }),
          time: h('b', { class: 'bb-clock-time' }),
          part: h('span', { class: 'bb-clock-part' }),
          wx: h('span', { class: 'bb-clock-wx' }),
          deco: h('div', { class: 'bb-sky-deco', 'aria-hidden': 'true' }),
          fig: h('div', { class: 'bb-sky-fig', html: figHtml(who) }),
          key: '', p, who,
        };
        r.el = h('div', { class: 'bb-clock bb-sky' + (p.z === HERE ? ' bb-mine' : '') }, r.deco, h('div', { class: 'bb-sky-words' }, r.place, r.whoEl, r.time, r.part, r.wx), r.fig);
        return r;
      });
      el.replaceChildren(...S.ui.skies.map((r) => r.el));
    }
    S.ui.skies.forEach((r) => {
      const t = parts(now, r.p.z);
      const pod = partOfDay(t.h);
      const w = WX.now[r.p.z];
      const kind = w ? wxKind(w.weather_code) : '';
      const night = pod === 'night' || (w && w.is_day === 0);
      const grey = !night && /^(rain|snow|fog|cloud)$/.test(kind);
      const skyName = night ? 'night' : grey ? 'grey' : pod;
      let wx = '';
      if (w && typeof w.temperature_2m === 'number') {
        const deg = r.p.unit === 'F' ? Math.round(w.temperature_2m * 9 / 5 + 32) : Math.round(w.temperature_2m);
        wx = (sky(w.weather_code) ? sky(w.weather_code) + ', ' : '') + deg + '°' + r.p.unit;
      }
      const mine = r.who === whoMe();
      const nm = mine ? 'You' : nameFor(r.who, b);
      if (r.whoEl.textContent !== nm) r.whoEl.textContent = nm;
      const tm = clockText(now, r.p.z);
      if (r.time.textContent !== tm) r.time.textContent = tm;
      r.part.textContent = cap(pod);
      const key = skyName + '|' + kind + '|' + wx;
      if (key !== r.key) {
        r.key = key;
        r.el.dataset.sky = skyName;
        r.el.dataset.wx = kind || 'none';
        r.wx.replaceChildren();
        if (wx) r.wx.append(h('span', { html: svg(WX_ICON[night && kind === 'clear' ? 'night' : kind] || WX_ICON.cloud) }), h('span', { text: wx }));
        const deco = [];
        if (night) deco.push(DECO.moon); else if (!grey) deco.push(DECO.sun);
        if (kind === 'cloud' || kind === 'fog') deco.push(DECO.cloud);
        if (kind === 'rain') deco.push(DECO.rain());
        if (kind === 'snow') deco.push(DECO.snow());
        r.deco.innerHTML = deco.join('');
      }
    });
  }
  function drawClocks(now) {
    const el = S.ui.clocks;
    if (!el) return;
    if (S.split) { drawSkies(now); return; }
    el.replaceChildren(...PLACES.map((p) => {
      const t = parts(now, p.z);
      const w = WX.now[p.z];
      let wx = '';
      if (w && typeof w.temperature_2m === 'number') {
        const deg = p.unit === 'F' ? Math.round(w.temperature_2m * 9 / 5 + 32) : Math.round(w.temperature_2m);
        wx = (sky(w.weather_code) ? sky(w.weather_code) + ', ' : '') + deg + '°' + p.unit;
      }
      return h('div', { class: 'bb-clock' + (p.z === HERE ? ' bb-mine' : '') },
        h('span', { class: 'bb-clock-place', text: p.label }),
        h('b', { class: 'bb-clock-time', text: fmt(p.z, { hour: 'numeric', minute: '2-digit' }).format(now) }),
        h('span', { class: 'bb-clock-sub', text: [partOfDay(t.h), wx].filter(Boolean).join(' · ') }));
    }));
  }

  // ---------- drawing ----------
  function render() {
    if (!S || !S.ui) return;
    const b = view();
    S.lastView = b;
    const ui = S.ui;
    const now = Date.now();
    drawClocks(now);
    weather();

    // Countdown
    {
      const c = b.countdown;
      const sec = ui.secs.countdown;
      ui.cdShow.replaceChildren();
      if (!ui.cdForm.hidden) { ui.cdShow.hidden = true; } else {
        ui.cdShow.hidden = false;
        if (!c) {
          sec.sum.textContent = '';
          ui.cdShow.append(h('div', { class: 'bb-empty' }, h('p', { text: S.loaded ? 'Counting down to something? Pick the day.' : 'Opening the board…' })));
          if (S.split && S.loaded) ui.cdShow.prepend(meet(60));
          if (S.loaded) ui.cdShow.append(h('button', { type: 'button', class: 'bb-btn bb-quiet bb-wide', onclick: ui.cdOpen }, 'Set a countdown'));
        } else if (S.split) {
          cdSplit(c, now, sec);
        } else {
          const left = c.at - now;
          const big = h('div', { class: 'bb-big' });
          if (left <= 0) {
            big.append(h('div', { class: 'bb-here', text: 'It’s here' }));
            sec.sum.textContent = 'It’s here';
          } else {
            const d = Math.floor(left / DAY);
            const hr = Math.floor((left % DAY) / 36e5);
            const mn = Math.floor((left % 36e5) / 6e4);
            const unit = (n, one, many) => h('div', { class: 'bb-unit' }, h('b', { text: String(n) }), h('span', { text: n === 1 ? one : many }));
            if (d > 0) big.append(unit(d, 'day', 'days'), unit(hr, 'hour', 'hours'));
            else big.append(unit(hr, 'hour', 'hours'), unit(mn, 'minute', 'minutes'));
            sec.sum.textContent = d > 0 ? d + (d === 1 ? ' day' : ' days') : hr + ' h ' + mn + ' min';
          }
          ui.cdShow.append(
            h('p', { class: 'bb-cd-title', text: c.title }),
            big,
            h('p', { class: 'bb-cd-when', text: fmt(HERE, { weekday: 'long', day: 'numeric', month: 'long' }).format(c.at) }),
            h('p', { class: 'bb-hint bb-center', text: bothTimes(c.at, keyOf(c.at, HERE)) }),
            h('div', { class: 'bb-center' }, h('button', { type: 'button', class: 'bb-link', onclick: ui.cdOpen }, 'Change')));
        }
      }
    }

    // Thinking of you
    {
      const sec = ui.secs.think;
      const got = b.thinks.filter((t) => !isMe(t.from));
      const top = got[0];
      ui.thTop.replaceChildren();
      if (top) {
        const fresh = S.seenThink && S.seenThink !== top.id;
        ui.thTop.append(h('div', { class: 'bb-th-card' + (fresh ? ' bb-pulse' : '') },
          h('p', { class: 'bb-th-line' }, h('span', { html: I.heart, class: 'bb-th-heart' }), h('span', {}, h('b', { text: top.from }), ' is thinking of you'), h('span', { class: 'bb-ago', text: (S.split ? '' : ' · ') + ago(top.at) })),
          top.note ? h('p', { class: 'bb-th-note', text: top.note }) : null,
          top.photo ? h('button', { type: 'button', class: 'bb-th-photo', 'aria-label': 'Open photo', onclick: () => showPhoto(photoUrl(top)) }, h('img', { src: photoUrl(top), alt: 'Photo from ' + top.from, loading: 'lazy' })) : null));
        sec.sum.textContent = top.from + ' · ' + ago(top.at);
      } else sec.sum.textContent = '';
      if (top) S.seenThink = top.id; else if (!S.seenThink && S.loaded) S.seenThink = '-';
      const mine = b.thinks.find((t) => isMe(t.from));
      ui.thSent.textContent = mine ? 'You last sent one ' + ago(mine.at) + '.' : '';
      const rest = b.thinks.filter((t) => t !== top).slice(0, SHOW_THINKS * 4);
      ui.thList.replaceChildren();
      if (S.split) thSplit(b, rest);
      else if (rest.length) {
        const rows = rest.map((t) => h('div', { class: 'bb-row bb-th-row' },
          t.photo ? h('button', { type: 'button', class: 'bb-thumb', 'aria-label': 'Open photo', onclick: () => showPhoto(photoUrl(t)) }, h('img', { src: photoUrl(t), alt: '', loading: 'lazy' })) : h('span', { class: 'bb-dot', html: I.heart }),
          h('div', { class: 'bb-row-main' }, h('p', {}, h('b', { text: isMe(t.from) ? 'You' : t.from }), h('span', { class: 'bb-ago', text: ' · ' + ago(t.at) })), t.note ? h('p', { class: 'bb-sub', text: t.note }) : null)));
        ui.thList.append(fold('think', ['Earlier (' + rest.length + ')', 'Hide earlier'], h('div', { class: 'bb-list' }, rows)));
      }
    }

    // To-do
    {
      const sec = ui.secs.todo;
      const open = b.todos.filter((t) => !t.done).reverse(); // newest first
      const done = b.todos.filter((t) => t.done).sort((x, y) => (y.doneAt || 0) - (x.doneAt || 0));
      sec.sum.textContent = open.length ? open.length + ' to do' : done.length ? 'All done' : '';
      const row = (t) => h('div', { class: 'bb-row bb-todo' + (t.done ? ' bb-done' : ''), 'data-id': t.id },
        h('button', { type: 'button', class: 'bb-tick', role: 'checkbox', 'aria-checked': String(!!t.done), 'aria-label': (t.done ? 'Not done: ' : 'Done: ') + t.text, html: I.tick, onclick: () => send({ op: 'todo.toggle', id: t.id, done: !t.done }, '“' + short(t.text) + '”') }),
        h('div', { class: 'bb-row-main' }, h('p', { class: 'bb-todo-text', text: t.text }), t.by && !isMe(t.by) ? h('p', { class: 'bb-sub', text: S.split ? 'Added by ' + t.by : t.by }) : null),
        h('button', { type: 'button', class: 'bb-x', 'aria-label': 'Delete ' + t.text, html: I.x, onclick: () => {
          send({ op: 'todo.delete', id: t.id }, 'that');
          note('Deleted “' + short(t.text) + '”.', { label: 'Undo', fn: () => send({ op: 'todo.add', id: t.id, text: t.text }, '“' + short(t.text) + '”') });
        } }));
      ui.todoList.replaceChildren();
      if (!open.length && S.split && S.loaded) ui.todoList.append(h('div', { class: 'bb-empty bb-empty-sofa' }, h('div', { class: 'bb-sofa', html: FIG() ? FIG().sofa() : '' }),
        h('p', { class: 'bb-empty-h', text: done.length ? 'All done for today' : 'Nothing on the list yet' }), h('p', { text: 'Say it at the top to add one.' })));
      else if (!open.length) ui.todoList.append(h('p', { class: 'bb-empty', text: S.loaded ? (done.length ? 'All done. Lovely.' : 'Nothing on the list yet.') : '' }));
      else {
        ui.todoList.append(h('div', { class: 'bb-list' }, open.slice(0, SHOW_TODOS).map(row)));
        if (open.length > SHOW_TODOS) ui.todoList.append(fold('todoMore', ['Show ' + (open.length - SHOW_TODOS) + ' more', 'Show fewer'], h('div', { class: 'bb-list' }, open.slice(SHOW_TODOS).map(row))));
      }
      if (done.length) ui.todoList.append(fold('done', ['Done (' + done.length + ')', 'Hide done'], h('div', { class: 'bb-list' }, done.map(row))));
    }

    // Calendar
    {
      const sec = ui.secs.cal;
      const today = keyOf(now, HERE);
      const isPast = (e) => (e.allDay ? evKey(e) < today : e.at < now - 36e5);
      const up = b.events.filter((e) => !isPast(e));
      const past = b.events.filter(isPast).reverse();
      const groups = [];
      up.forEach((e) => {
        const k = evKey(e);
        let g = groups[groups.length - 1];
        if (!g || g.k !== k) groups.push(g = { k, list: [] });
        g.list.push(e);
      });
      groups.forEach((g) => g.list.sort((x, y) => (y.allDay - x.allDay) || (x.at - y.at)));
      groups.sort((x, y) => (x.k < y.k ? -1 : x.k > y.k ? 1 : 0));
      sec.sum.textContent = up.length ? (dayLabel(groups[0].k)[0] === 'Today' ? 'Today' : 'Next: ' + dayLabel(groups[0].k)[0]) : '';
      const evRow = (e, k) => h('div', { class: 'bb-row bb-ev', 'data-id': e.id },
        h('div', { class: 'bb-row-main' }, h('p', { class: 'bb-ev-title', text: e.title }),
          S.split && !e.allDay ? twoTimes(e.at, k) : h('p', { class: 'bb-sub bb-times', text: e.allDay ? 'All day' : bothTimes(e.at, k) })),
        h('button', { type: 'button', class: 'bb-x', 'aria-label': 'Delete ' + e.title, html: I.x, onclick: () => {
          send({ op: 'event.delete', id: e.id }, 'that');
          note('Deleted “' + short(e.title) + '”.', { label: 'Undo', fn: () => send({ op: 'event.add', id: e.id, title: e.title, at: e.at, allDay: !!e.allDay }, '“' + short(e.title) + '”') });
        } }));
      const day = (g) => {
        const [a, bLabel] = dayLabel(g.k);
        return h('div', { class: 'bb-day', 'data-day': g.k }, h('p', { class: 'bb-day-h' }, h('b', { text: a }), h('span', { text: bLabel })), h('div', { class: 'bb-list' }, g.list.map((e) => evRow(e, g.k))));
      };
      ui.calList.replaceChildren();
      if (ui.week) weekStrip(b, today);
      if (!groups.length) ui.calList.append(h('p', { class: 'bb-empty', text: S.loaded ? 'Nothing planned yet.' : '' }));
      else {
        ui.calList.append(...groups.slice(0, SHOW_DAYS).map(day));
        if (groups.length > SHOW_DAYS) ui.calList.append(fold('calMore', ['Show ' + (groups.length - SHOW_DAYS) + ' more ' + (groups.length - SHOW_DAYS === 1 ? 'day' : 'days'), 'Show fewer'], groups.slice(SHOW_DAYS).map(day)));
      }
      if (past.length) {
        const rows = past.slice(0, 30).map((e) => {
          const r = evRow(e, evKey(e));
          r.querySelector('.bb-times').textContent = fmt(e.allDay ? 'UTC' : HERE, { weekday: 'short', day: 'numeric', month: 'short' }).format(e.at) + (e.allDay ? '  ·  all day' : '  ·  ' + bothTimes(e.at, evKey(e)));
          return r;
        });
        ui.calList.append(fold('past', ['Past (' + past.length + ')', 'Hide past'], h('div', { class: 'bb-list bb-past' }, rows)));
      }
    }

    ui.status.textContent = S.offline ? 'Can’t reach the board right now. It will keep trying.' : S.talking ? 'Reading that…' : S.pending.length ? 'Saving…' : '';
    ui.status.classList.toggle('bb-off', !!S.offline);
    if (S.split) homeSplit(b, now);
    if (S.opts.onRender) { try { S.opts.onRender({ me: whoMe(), them: theirName(b), theirFigure: whoThem() }); } catch (e) { /* the app's own business */ } }
  }

  // ---------- tabs: Home's cards, the countdown's two figures, the week, both clocks on each plan ----------
  // Two small heads with a dotted path between them: the path shortens as the day comes.
  function meet(days) {
    const f = FIG();
    const here = days <= 0;
    const gap = here ? 0 : Math.round(8 + Math.min(1, days / 60) * 56);
    return h('div', { class: 'bb-meet' + (here ? ' bb-meet-here' : ''), role: 'img', 'aria-label': here ? 'The two of you, together' : 'The two of you, a little closer each day' },
      h('span', { class: 'bb-meet-h bb-meet-mo', html: f ? f.figure('mo', { pose: 'head', label: '' }) : '' }),
      here ? h('span', { class: 'bb-meet-heart', html: f ? f.softHeart() : '' }) : h('span', { class: 'bb-meet-path', style: 'width:' + gap + 'px' }),
      h('span', { class: 'bb-meet-h bb-meet-semal', html: f ? f.figure('semal', { pose: 'head', label: '' }) : '' }));
  }
  function cdSplit(c, now, sec) {
    const ui = S.ui;
    const left = c.at - now;
    let num = '', unit = '';
    if (left <= 0) sec.sum.textContent = 'It’s here';
    else {
      const d = Math.floor(left / DAY), hr = Math.floor((left % DAY) / 36e5), mn = Math.max(1, Math.floor((left % 36e5) / 6e4));
      if (d > 0) { num = String(d); unit = (d === 1 ? 'day' : 'days') + ' to go'; } else if (hr > 0) { num = String(hr); unit = (hr === 1 ? 'hour' : 'hours') + ' to go'; } else { num = String(mn); unit = (mn === 1 ? 'minute' : 'minutes') + ' to go'; }
      sec.sum.textContent = num + ' ' + unit;
    }
    ui.cdShow.append(
      h('p', { class: 'bb-cd-title', text: c.title }),
      left <= 0 ? h('div', { class: 'bb-here', text: 'It’s here' }) : h('div', { class: 'bb-cd-num' }, h('b', { text: num }), h('span', { text: unit })),
      meet(Math.ceil(left / DAY)),
      h('p', { class: 'bb-cd-when', text: fmt(HERE, { weekday: 'short', day: 'numeric', month: 'short' }).format(c.at) }),
      h('button', { type: 'button', class: 'bb-link bb-cd-change', onclick: ui.cdOpen, 'aria-label': 'Change the countdown' }, 'Change'));
  }
  // "7:00 pm", "London, evening", and where that sits in the day there.
  function twoTimes(t, dayKey) {
    const f = FIG();
    return h('div', { class: 'bb-times bb-two' }, ZONES.map(({ z, label }) => {
      const p = parts(t, z);
      const k = keyOf(t, z);
      const frac = (p.h * 60 + p.mi) / 1440;
      return h('div', { class: 'bb-tz' },
        h('span', { class: 'bb-tz-fig', html: f ? f.figure(z === LA ? 'semal' : 'mo', { pose: 'head', label: '' }) : '' }),
        h('span', { class: 'bb-tz-words' }, h('b', { text: timeIn(t, z) + (dayKey && k !== dayKey ? ' ' + weekdayIn(t, z) : '') }), h('span', { text: label + ', ' + partOfDay(p.h) })),
        h('span', { class: 'bb-tz-bar', 'aria-hidden': 'true' }, h('i', { class: 'bb-tz-mark', style: 'left:calc(' + (frac * 100).toFixed(1) + '% - 7px)' })));
    }));
  }
  function weekStrip(b, today) {
    const ui = S.ui;
    const has = new Set(b.events.map(evKey));
    const days = [];
    const [y, mo, d] = today.split('-').map(Number);
    for (let i = 0; i < 7; i++) {
      const noon = Date.UTC(y, mo - 1, d + i, 12);
      const k = keyOf(noon, 'UTC');
      const wd = fmt('UTC', { weekday: 'short' }).format(noon);
      const dn = fmt('UTC', { day: 'numeric' }).format(noon);
      const long = fmt('UTC', { weekday: 'long', day: 'numeric', month: 'long' }).format(noon);
      days.push(h('button', { type: 'button', class: 'bb-wday' + (i === 0 ? ' bb-today' : '') + (has.has(k) ? ' bb-has' : ''), 'aria-label': long + (has.has(k) ? ', has plans' : ''), onclick: () => {
        let g = ui.calList.querySelector('[data-day="' + k + '"]');
        // Plans on that day sit in the "Show more days" fold: open it, then go to them.
        if (!g && has.has(k) && !S.folds.calMore) { S.folds.calMore = true; render(); g = ui.calList.querySelector('[data-day="' + k + '"]'); }
        if (g) { g.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' }); g.classList.remove('bb-flash'); void g.offsetWidth; g.classList.add('bb-flash'); }
        else ui.calAddOn(zoned(y, mo, d + i, 12, 0, myZone()));
      } }, h('span', { class: 'bb-wd', text: wd }), h('span', { class: 'bb-dn', text: dn }), h('i', { class: 'bb-wdot' })));
    }
    ui.week.replaceChildren(...days);
  }
  function thSplit(b, rest) {
    const ui = S.ui;
    const f = FIG();
    ui.thHistBody.replaceChildren();
    // One heart so far: it is already on show above, so there is nothing earlier to list.
    const card = ui.thHistBody.closest('.bb-card');
    if (card) card.hidden = !rest.length && b.thinks.length > 0;
    if (!rest.length) {
      ui.thHistBody.append(h('div', { class: 'bb-empty bb-empty-sofa' }, h('div', { class: 'bb-sofa', html: f ? f.sofa() : '' }),
        h('p', { class: 'bb-empty-h', text: S.loaded ? 'No hearts yet' : 'Opening the board…' }), S.loaded ? h('p', { text: 'Send the first one. It takes one tap.' }) : null));
      return;
    }
    ui.thHistBody.append(h('div', { class: 'bb-list' }, rest.map((t) => h('div', { class: 'bb-row bb-th-row' },
      t.photo ? h('button', { type: 'button', class: 'bb-thumb', 'aria-label': 'Open photo', onclick: () => showPhoto(photoUrl(t)) }, h('img', { src: photoUrl(t), alt: '', loading: 'lazy' }))
        : h('span', { class: 'bb-dot bb-dot-fig bb-fig-' + whoOf(t.from), html: f ? f.figure(whoOf(t.from), { pose: 'head', label: '' }) : I.heart }),
      h('div', { class: 'bb-row-main' }, h('p', {}, h('b', { text: isMe(t.from) ? 'You' : t.from }), h('span', { class: 'bb-ago', text: ', ' + ago(t.at) })), t.note ? h('p', { class: 'bb-sub', text: t.note }) : null)))));
  }
  function homeSplit(b, now) {
    const ui = S.ui;
    const f = FIG();
    // Hello
    const hr = parts(now, HERE).h;
    const hi = hr < 5 ? 'Hello' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
    ui.hello.firstChild.textContent = fmt(HERE, { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
    ui.hello.lastChild.textContent = hi + (placeholderName(S.name) ? '' : ', ' + S.name);
    // The latest heart from them, with a quick one back
    const top = b.thinks.filter((t) => !isMe(t.from))[0];
    const them = top ? whoOf(top.from) : whoThem();
    const nm = theirName(b) || (f ? f.NAME[whoThem()] : 'They');
    const from = top ? top.from : nm;
    const key = (top ? top.id + ago(top.at) : '-') + nm + them + S.loaded;
    if (ui.hThink.dataset.k !== key) {
      ui.hThink.dataset.k = key;
      const quick = h('button', { type: 'button', class: 'bb-heart-btn', 'aria-label': 'Send a heart', html: I.heart, onclick: () => {
        if (quick.disabled) return;
        quick.disabled = true;
        sendThink('', null);
        quick.innerHTML = I.tick;
        quick.setAttribute('aria-label', 'Sent');
        setTimeout(() => { quick.disabled = false; quick.innerHTML = I.heart; quick.setAttribute('aria-label', 'Send a heart'); }, 2500);
      } });
      ui.hThink.replaceChildren(
        h('button', { type: 'button', class: 'bb-hthink-open', onclick: () => go('hearts'), 'aria-label': top ? from + ' is thinking of you, ' + ago(top.at) + '. Open Hearts' : 'Open Hearts' },
          h('span', { class: 'bb-hthink-fig bb-fig-' + them, html: f ? f.figure(them, { pose: 'head', label: '' }) : I.heart }),
          h('span', { class: 'bb-hthink-words' },
            h('b', { text: top ? from + ' is thinking of you' : S.loaded ? 'Send a heart' : 'Thinking of you' }),
            h('span', { class: 'bb-sub', text: top ? ago(top.at) : 'Let ' + nm + ' know you’re thinking of them.' }),
            top && top.note ? h('span', { class: 'bb-hthink-note', text: top.note }) : null)),
        quick);
    }
    // The next plan, in both clocks
    const up = b.events.filter((e) => (e.allDay ? evKey(e) >= keyOf(now, HERE) : e.at >= now - 36e5)).sort((x, y) => x.at - y.at)[0];
    const chev = h('span', { class: 'bb-hnext-chev', html: svg('<path d="M9 6l6 6-6 6"/>') });
    ui.hNext.replaceChildren(h('span', { class: 'bb-hnext-top' }, h('span', { class: 'bb-label', text: 'Next plan' }), chev),
      ...(up ? [h('b', { class: 'bb-hnext-title', text: up.title + ', ' + fmt(up.allDay ? 'UTC' : HERE, { weekday: 'short', day: 'numeric', month: 'short' }).format(up.at) }),
        h('span', { class: 'bb-hnext-times' }, ...(up.allDay ? [h('span', { text: 'All day' })] : ZONES.map(({ z, label }) => h('span', { text: timeIn(up.at, z) + ' ' + label }))))]
        : [h('b', { class: 'bb-hnext-title', text: S.loaded ? 'Nothing planned yet' : 'Opening the board…' }), h('span', { class: 'bb-hnext-times' }, h('span', { text: 'Say it on Plans to add one.' }))]));
    const said = [...ui.hNext.querySelectorAll('.bb-hnext-title, .bb-hnext-times > span')].map((x) => x.textContent.trim().replace(/[.]$/, '')).filter(Boolean);
    ui.hNext.setAttribute('aria-label', 'Next plan: ' + said.join(', ') + '. Open Plans');
    if (S.t.shared) S.t.shared.textContent = 'Shared with ' + nm;
  }

  // ---------- styles (all under .bboard; colours come from Beside's own tokens) ----------
  const CSS = `
.bboard{--bb-paper:var(--paper,#F5EFE4);--bb-paper-2:var(--paper-2,#EDE5D6);--bb-paper-3:var(--paper-3,#E3D9C6);--bb-ink:var(--ink,#201A13);--bb-ink-2:var(--ink-2,#6E6457);--bb-ink-3:var(--ink-3,#A89D8E);--bb-line:var(--line,#D8CDB9);--bb-clay:var(--clay,#B84F2A);--bb-clay-ink:var(--clay-ink,#FFF4EA);--bb-clay-soft:var(--clay-soft,#F1D9CC);--bb-moss:var(--moss,#4C7D47);--bb-rust:var(--rust,#B5352C);--bb-r:var(--radius,22px);--bb-display:var(--font-display,"Fraunces","Iowan Old Style",Georgia,serif);
  container-type:inline-size;position:relative;font-family:var(--font-ui,-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif);color:var(--bb-ink);font-size:16px;line-height:1.4;-webkit-font-smoothing:antialiased;min-width:0}
.bboard *,.bboard *::before,.bboard *::after{box-sizing:border-box}
.bboard :where(p,h3){margin:0;padding:0}
.bboard [hidden]{display:none !important}
.bboard button{font:inherit;color:inherit;background:none;border:0;padding:0;margin:0;cursor:pointer;-webkit-tap-highlight-color:transparent}
.bboard svg{width:20px;height:20px;flex:none;display:block}
.bboard .bb-grid{display:grid;gap:14px;min-width:0}
.bboard .bb-col{display:grid;gap:14px;align-content:start;min-width:0}
@container (min-width:700px){.bboard .bb-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}.bboard .bb-col{gap:16px}}
.bboard .bb-talk{margin:0 0 14px}
.bboard .bb-talk .bb-btn:disabled{opacity:.6}
.bboard .bb-clocks{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:0 0 12px}
.bboard .bb-clock{display:flex;flex-direction:column;gap:2px;padding:12px 16px;border-radius:var(--bb-r);background:var(--bb-paper-2);box-shadow:inset 0 0 0 1px var(--bb-line);min-width:0}
.bboard .bb-clock.bb-mine{background:var(--bb-paper)}
.bboard .bb-clock-place{font-size:13px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--bb-ink-2)}
.bboard .bb-clock-time{font-family:var(--bb-display);font-size:30px;font-weight:500;line-height:1.1;color:var(--bb-ink)}
.bboard .bb-clock-sub{font-size:14px;color:var(--bb-ink-2);overflow-wrap:anywhere}
.bboard .bb-sec{background:var(--bb-paper-2);border-radius:var(--bb-r);box-shadow:inset 0 0 0 1px var(--bb-line);min-width:0;overflow:hidden}
.bboard .bb-head{width:100%;display:flex;align-items:center;gap:10px;min-height:56px;padding:6px 16px 6px 18px;text-align:left}
.bboard .bb-head:focus-visible,.bboard .bb-fold-btn:focus-visible,.bboard .bb-link:focus-visible{outline:2px solid var(--bb-clay);outline-offset:-2px;border-radius:14px}
.bboard .bb-ico{color:var(--bb-clay);display:grid;place-items:center}
.bboard .bb-head h3{font-size:13px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--bb-ink-2);white-space:nowrap}
.bboard .bb-sum{flex:1;min-width:0;text-align:right;font-size:14px;color:var(--bb-ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:0;transition:opacity .2s}
.bboard .bb-closed .bb-sum{opacity:1}
.bboard .bb-chev{color:var(--bb-ink-3);transition:transform .2s ease;width:18px;height:18px}
.bboard .bb-closed .bb-head .bb-chev{transform:rotate(-90deg)}
.bboard .bb-closed .bb-body{display:none}
.bboard .bb-body{padding:0 18px 18px;display:grid;gap:14px;min-width:0}
.bboard .bb-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:48px;padding:0 20px;border-radius:999px;font-weight:600;font-size:16px;line-height:1.1;user-select:none;-webkit-user-select:none;transition:transform .15s ease,filter .2s,background .2s;text-align:center}
.bboard .bb-btn:active{transform:scale(.97)}
.bboard .bb-btn:focus-visible,.bboard .bb-x:focus-visible,.bboard .bb-tick:focus-visible{outline:2px solid var(--bb-clay);outline-offset:2px}
.bboard .bb-primary{background:var(--bb-clay);color:var(--bb-clay-ink);box-shadow:0 10px 24px -14px var(--bb-clay)}
.bboard .bb-primary:hover{filter:brightness(1.05)}
.bboard .bb-quiet{background:var(--bb-paper);color:var(--bb-ink);box-shadow:inset 0 0 0 1px var(--bb-line)}
.bboard .bb-danger{color:var(--bb-rust);box-shadow:inset 0 0 0 1px var(--bb-line)}
.bboard .bb-wide{width:100%}
.bboard .bb-link{min-height:44px;padding:0 6px;color:var(--bb-ink-2);font-size:15px;text-decoration:underline;text-underline-offset:3px;text-decoration-color:var(--bb-line)}
.bboard .bb-link:hover{color:var(--bb-ink)}
.bboard .bb-in{font:inherit;font-size:16px;color:var(--bb-ink);background:var(--bb-paper);border:0;box-shadow:inset 0 0 0 1px var(--bb-line);border-radius:14px;min-height:48px;padding:0 14px;width:100%;min-width:0;-webkit-appearance:none;appearance:none}
.bboard .bb-in::placeholder{color:var(--bb-ink-3)}
.bboard .bb-in:focus{outline:2px solid var(--bb-clay);outline-offset:1px}
.bboard input[type=date].bb-in,.bboard input[type=time].bb-in{display:flex;align-items:center;line-height:48px;padding-top:0;padding-bottom:0}
.bboard .bb-ta{padding:12px 14px;line-height:1.4;resize:vertical;min-height:72px}
.bboard .bb-hint{font-size:14px;color:var(--bb-ink-2)}
.bboard .bb-center{text-align:center;display:flex;justify-content:center;flex-wrap:wrap}
.bboard .bb-empty{color:var(--bb-ink-2);font-size:15px;text-align:center;padding:4px 0}
.bboard .bb-acts{display:flex;flex-wrap:wrap;gap:8px}
.bboard .bb-acts .bb-btn{flex:1 1 auto}
.bboard .bb-form{display:grid;gap:10px}
.bboard .bb-when{display:grid;gap:8px}
.bboard .bb-when-row{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:8px}
.bboard .bb-seg{display:grid;grid-template-columns:1fr 1fr;padding:4px;border-radius:999px;background:var(--bb-paper-3);box-shadow:inset 0 0 0 1px var(--bb-line)}
.bboard .bb-seg button{min-height:40px;border-radius:999px;font-size:15px;font-weight:600;color:var(--bb-ink-2)}
.bboard .bb-seg button[aria-pressed="true"]{background:var(--bb-paper);color:var(--bb-ink);box-shadow:0 2px 8px -4px rgba(0,0,0,.4)}
.bboard.bb-tabs .bb-seg button{min-height:44px}
@media (max-width:360px){.bboard.bb-tabs .bb-when-row{grid-template-columns:1fr}}
/* countdown */
.bboard .bb-cd{display:grid;gap:6px;text-align:center;padding-top:2px}
.bboard .bb-cd-title{font-family:var(--bb-display);font-variation-settings:"opsz" 40,"SOFT" 50;font-size:24px;line-height:1.15;overflow-wrap:anywhere;text-wrap:balance}
.bboard .bb-big{display:flex;justify-content:center;gap:clamp(18px,7cqi,40px);padding:4px 0 2px}
.bboard .bb-unit{display:flex;flex-direction:column;align-items:center;min-width:0}
.bboard .bb-unit b{font-family:var(--bb-display);font-weight:400;font-variation-settings:"opsz" 144,"SOFT" 50;font-size:clamp(56px,15cqi,84px);line-height:1;letter-spacing:-.02em;color:var(--bb-clay);font-variant-numeric:tabular-nums lining-nums}
.bboard .bb-unit span{font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--bb-ink-3);margin-top:4px}
.bboard .bb-here{font-family:var(--bb-display);font-size:48px;line-height:1.05;color:var(--bb-clay)}
.bboard .bb-cd-when{font-weight:600;font-size:15px}
/* thinking of you */
.bboard .bb-th-card{background:var(--bb-clay-soft);border-radius:18px;padding:14px 16px;display:grid;gap:8px}
.bboard .bb-th-line{display:flex;flex-wrap:wrap;align-items:baseline;column-gap:0;font-family:var(--bb-display);font-variation-settings:"opsz" 30,"SOFT" 50;font-size:21px;line-height:1.25}
.bboard .bb-th-line b{font-weight:600}
.bboard .bb-th-heart{color:var(--bb-clay);margin-right:8px;align-self:center}
.bboard .bb-th-heart svg{width:20px;height:20px}
.bboard .bb-ago{font-family:var(--font-ui,sans-serif);font-size:14px;color:var(--bb-ink-2);white-space:pre}
.bboard .bb-th-note{font-size:16px;white-space:pre-wrap;overflow-wrap:anywhere}
.bboard .bb-th-photo{display:block;border-radius:14px;overflow:hidden;cursor:zoom-in;max-width:100%;justify-self:start}
.bboard .bb-th-photo img{display:block;max-width:100%;max-height:260px;border-radius:14px}
.bboard .bb-pulse{animation:bb-pulse 1.6s ease 2}
@keyframes bb-pulse{0%,100%{box-shadow:0 0 0 0 transparent}40%{box-shadow:0 0 0 6px var(--glow,rgba(255,186,110,.45))}}
.bboard .bb-th-send{display:grid;gap:4px;justify-items:center}
.bboard .bb-warm{width:100%;min-height:60px;font-size:18px;gap:10px}
.bboard .bb-warm svg{width:22px;height:22px}
.bboard .bb-warm.bb-sent{background:var(--bb-moss);box-shadow:none}
.bboard .bb-th-extra{display:grid;gap:10px;width:100%;margin-top:4px}
.bboard .bb-prev{position:relative;justify-self:start}
.bboard .bb-prev img{display:block;max-width:180px;max-height:140px;border-radius:12px}
.bboard .bb-prev .bb-x{position:absolute;top:-10px;right:-10px;background:var(--bb-ink);color:var(--bb-paper);width:32px;height:32px;min-width:32px;min-height:32px}
/* lists */
.bboard .bb-list{display:grid}
.bboard .bb-list-wrap{display:grid;gap:10px;min-width:0}
.bboard .bb-row{display:flex;align-items:center;gap:10px;min-height:52px;padding:4px 0;border-top:1px solid var(--bb-line);min-width:0}
.bboard .bb-list > .bb-row:first-child{border-top:0}
.bboard .bb-row-main{flex:1;min-width:0}
.bboard .bb-row-main p{overflow-wrap:anywhere}
.bboard .bb-sub{font-size:13.5px;color:var(--bb-ink-2);margin-top:1px}
.bboard .bb-x{display:grid;place-items:center;width:44px;height:44px;border-radius:50%;color:var(--bb-ink-3);flex:none}
.bboard .bb-x:hover{color:var(--bb-rust);background:var(--bb-paper)}
.bboard .bb-x svg{width:18px;height:18px}
.bboard .bb-tick{display:grid;place-items:center;width:44px;height:44px;flex:none;margin-left:-8px;border-radius:50%;color:transparent;position:relative}
.bboard .bb-tick::before{content:"";position:absolute;inset:10px;border-radius:50%;box-shadow:inset 0 0 0 2px var(--bb-ink-3);background:var(--bb-paper);transition:background .15s,box-shadow .15s}
.bboard .bb-tick svg{position:relative;width:16px;height:16px;stroke-width:3}
.bboard .bb-tick:hover::before{box-shadow:inset 0 0 0 2px var(--bb-moss)}
.bboard .bb-done .bb-tick{color:#fff}
.bboard .bb-done .bb-tick::before{background:var(--bb-moss);box-shadow:none}
.bboard .bb-done .bb-todo-text{text-decoration:line-through;text-decoration-color:var(--bb-ink-3);color:var(--bb-ink-2)}
.bboard .bb-add{display:flex;gap:8px}
.bboard .bb-add .bb-in{flex:1;border-radius:999px;padding:0 18px}
.bboard .bb-add-btn{flex:none;padding:0 18px}
.bboard .bb-add-btn svg{width:18px;height:18px}
@container (max-width:340px){.bboard .bb-add-word{display:none}.bboard .bb-add-btn{width:48px;padding:0}}
.bboard .bb-fold{display:grid}
.bboard .bb-fold-btn{display:inline-flex;align-items:center;gap:6px;justify-self:start;min-height:44px;padding:0 4px;font-size:15px;font-weight:600;color:var(--bb-ink-2)}
.bboard .bb-fold-btn:hover{color:var(--bb-ink)}
.bboard .bb-fold-btn .bb-chev{width:16px;height:16px;transform:rotate(-90deg)}
.bboard .bb-fold.bb-open > .bb-fold-btn .bb-chev{transform:none}
.bboard .bb-th-row .bb-dot{display:grid;place-items:center;width:40px;height:40px;border-radius:12px;background:var(--bb-clay-soft);color:var(--bb-clay);flex:none}
.bboard .bb-th-row .bb-dot svg{width:16px;height:16px}
.bboard .bb-thumb{width:40px;height:40px;border-radius:12px;overflow:hidden;flex:none;cursor:zoom-in}
.bboard .bb-thumb img{width:100%;height:100%;object-fit:cover;display:block}
/* calendar */
.bboard .bb-day{display:grid;gap:2px}
.bboard .bb-day-h{display:flex;align-items:baseline;gap:8px;font-size:15px;padding-top:2px}
.bboard .bb-day-h b{font-weight:700}
.bboard .bb-day-h span{color:var(--bb-ink-3);font-size:14px}
.bboard .bb-ev{padding-left:12px;border-top:0;position:relative}
.bboard .bb-ev::before{content:"";position:absolute;left:0;top:12px;bottom:12px;width:3px;border-radius:2px;background:var(--bb-clay)}
.bboard .bb-past .bb-ev::before{background:var(--bb-line)}
.bboard .bb-past .bb-ev-title{color:var(--bb-ink-2)}
.bboard .bb-ev-title{font-weight:600}
.bboard .bb-times{font-variant-numeric:tabular-nums}
/* notes and status */
.bboard .bb-note{position:sticky;top:8px;z-index:5;display:flex;align-items:center;gap:8px;margin:0 0 12px;padding:10px 6px 10px 16px;border-radius:16px;background:var(--bb-ink);color:var(--bb-paper);font-size:15px;line-height:1.35;box-shadow:var(--shadow,0 12px 32px -16px rgba(60,40,10,.35));animation:bb-fade .25s ease}
.bboard .bb-note > span{flex:1;min-width:0;overflow-wrap:anywhere}
.bboard .bb-note .bb-note-act{min-height:36px;padding:0 12px;border-radius:999px;font-weight:700;color:var(--bb-paper);box-shadow:inset 0 0 0 1px currentColor}
.bboard .bb-note .bb-note-x{display:grid;place-items:center;width:36px;height:36px;border-radius:50%;flex:none}
.bboard .bb-note .bb-note-x svg{width:16px;height:16px}
@keyframes bb-fade{from{opacity:0}}
.bboard .bb-status{min-height:1.4em;margin-top:10px;text-align:center;font-size:13px;color:var(--bb-ink-3)}
.bboard .bb-status.bb-off{color:var(--bb-rust)}
.bboard.bb-viewer{position:fixed;inset:0;z-index:80;display:grid;place-items:center;padding:16px;background:rgba(12,10,8,.92);cursor:zoom-out;animation:bb-fade .2s}
.bboard.bb-viewer img{max-width:100%;max-height:calc(100dvh - 32px);border-radius:10px}
/* ---------- tabs (Two Skies): the parts the app spreads over Home, Plans and Hearts ---------- */
.bb-tabs{--bb-ease:cubic-bezier(.3,.7,.2,1);font-family:var(--font-ui,sans-serif)}
.bb-tabs .bb-sec.bb-card{background:var(--bb-paper-2);box-shadow:none;border-radius:24px}
.bb-tabs .bb-head-static{min-height:0;padding:16px 18px 8px;display:flex;align-items:baseline;gap:10px}
.bb-tabs .bb-head-static h3{font-size:13px;font-weight:600;letter-spacing:0;text-transform:none;color:var(--bb-ink-2)}
.bb-tabs .bb-head-static .bb-sum{opacity:1;font-size:13px;color:var(--bb-ink-3)}
.bb-tabs .bb-body{padding:0 16px 16px;gap:12px}
.bb-tabs .bb-quiet{background:var(--bb-paper);box-shadow:none}
.bb-tabs .bb-grid{gap:14px}
@container (min-width:700px){.bb-tabs .bb-grid{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px}}
.bb-hello{display:flex;flex-direction:column;gap:2px;min-height:56px;justify-content:center}
.bb-hello-day{font-size:13px;font-weight:500;color:var(--bb-ink-2)}
.bb-hello-hi{font-family:var(--bb-display);font-weight:400;font-size:26px;line-height:1.1;letter-spacing:-.01em;margin:0;overflow-wrap:anywhere}
/* the two skies */
.bboard.bb-tabs .bb-clocks{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px;margin:0}
.bboard.bb-tabs .bb-sky{--sky:#F3D9B1;--sky-ink:#2A2420;--sky-sub:#5E4426;position:relative;display:block;height:clamp(236px,64vw,280px);padding:16px;border-radius:28px;overflow:hidden;background:var(--sky);color:var(--sky-ink);box-shadow:none;transition:background-color 1.4s ease,color 1.4s ease}
.bboard.bb-tabs .bb-sky[data-sky=afternoon]{--sky:#CFE0E8;--sky-ink:#22303A;--sky-sub:#3F5560}
.bboard.bb-tabs .bb-sky[data-sky=evening]{--sky:#E9B49A;--sky-ink:#2A1A14;--sky-sub:#5A3226}
.bboard.bb-tabs .bb-sky[data-sky=night]{--sky:#2F3550;--sky-ink:#FFFFFF;--sky-sub:#D5D9E8}
.bboard.bb-tabs .bb-sky[data-sky=grey]{--sky:#4F5F6C;--sky-ink:#FFFFFF;--sky-sub:#DCE3E8}
.bb-tabs .bb-sky-words{position:relative;z-index:2;display:flex;flex-direction:column;gap:2px;min-width:0}
.bboard.bb-tabs .bb-clock-place{font-size:15px;font-weight:600;letter-spacing:0;text-transform:none;color:inherit;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bb-tabs .bb-clock-who{font-size:13px;color:var(--sky-sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bboard.bb-tabs .bb-clock-time{font-family:var(--bb-display);font-weight:400;font-size:clamp(38px,11vw,48px);line-height:1;margin-top:10px;color:inherit;font-variant-numeric:lining-nums tabular-nums;letter-spacing:-.01em}
.bb-tabs .bb-clock-part{font-size:14px;margin-top:6px}
.bb-tabs .bb-clock-wx{font-size:14px;display:flex;align-items:center;gap:6px;color:var(--sky-sub);min-height:20px}
.bb-tabs .bb-clock-wx svg{width:18px;height:18px;stroke-width:1.8}
.bb-tabs .bb-sky-fig{position:absolute;z-index:1;left:50%;bottom:-30px;width:66px;transform:translateX(-50%)}
.bboard.bb-tabs .bb-sky-fig svg{width:100%;height:auto}
.bboard.bb-tabs .bb-meet-h svg,.bboard.bb-tabs .bb-hthink-fig svg,.bboard.bb-tabs .bb-tz-fig svg,.bboard.bb-tabs .bb-th-row .bb-dot.bb-dot-fig svg{width:100%;height:100%}
.bboard.bb-tabs .bb-meet-heart svg{width:14px;height:14px}
@media (min-width:900px){.bboard.bb-tabs .bb-sky{height:340px}.bb-tabs .bb-sky-fig{width:84px;bottom:-36px}}
.bb-tabs .bb-sky-deco{position:absolute;inset:0;z-index:0;pointer-events:none}
/* the weather pictures: .bboard.bb-tabs beats the board's small-icon size (.bboard svg) */
.bboard.bb-tabs .bb-deco{position:absolute;height:auto}
.bboard.bb-tabs .bb-sun{right:-22px;top:112px;width:80px;height:80px;animation:bb-glow 7s ease-in-out infinite}
.bboard.bb-tabs .bb-moon{right:14px;top:112px;width:42px;height:42px}
.bboard.bb-tabs .bb-stars{left:0;top:96px;width:100%;height:auto;animation:bb-twinkle 5s ease-in-out infinite}
.bboard.bb-tabs .bb-cloud{right:-14px;top:124px;width:96px;height:40px;color:rgba(255,255,255,.42);animation:bb-drift 14s ease-in-out infinite}
.bboard.bb-tabs .bb-rain,.bboard.bb-tabs .bb-snow{left:0;top:-12px;width:100%;height:calc(100% + 24px)}
.bboard.bb-tabs .bb-rain{color:#8C9BA7;animation:bb-rain 1.9s linear infinite}
.bboard.bb-tabs .bb-snow{color:rgba(255,255,255,.8);animation:bb-snow 4s linear infinite}
@keyframes bb-glow{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
@keyframes bb-twinkle{0%,100%{opacity:1}50%{opacity:.55}}
@keyframes bb-drift{0%,100%{transform:translateX(0)}50%{transform:translateX(-10px)}}
@keyframes bb-rain{0%{transform:translateY(-6px);opacity:0}30%{opacity:1}100%{transform:translateY(10px);opacity:0}}
@keyframes bb-snow{0%{transform:translateY(-8px);opacity:0}25%{opacity:1}100%{transform:translateY(14px);opacity:0}}
/* Home: the latest heart, the countdown, the next plan */
.bb-tabs .bb-hcard{width:100%;background:var(--bb-paper-2);border-radius:24px;color:var(--bb-ink);text-align:left}
.bb-tabs .bb-hthink{display:flex;align-items:center;gap:10px;padding:12px}
.bb-tabs .bb-hthink-open{flex:1;min-width:0;display:flex;align-items:center;gap:12px;min-height:60px;text-align:left;border-radius:18px}
.bb-tabs .bb-hthink-fig{width:60px;height:60px;border-radius:30px;overflow:hidden;flex:none;background:#F3D9B1}
.bb-tabs .bb-hthink-fig.bb-fig-mo{background:#EDE3D6}
.bb-tabs .bb-hthink-fig svg{width:100%;height:100%}
.bb-tabs .bb-hthink-words{display:flex;flex-direction:column;gap:1px;min-width:0}
.bb-tabs .bb-hthink-words b{font-size:15px;font-weight:600}
.bb-tabs .bb-hthink-words .bb-sub{font-size:13px;margin:0}
.bb-tabs .bb-hthink-note{font-family:var(--bb-display);font-style:italic;font-size:15px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.bb-tabs .bb-heart-btn{width:48px;height:48px;border-radius:24px;flex:none;display:grid;place-items:center;background:var(--bb-clay);color:var(--bb-clay-ink);transition:transform .25s var(--bb-ease)}
.bb-tabs .bb-heart-btn:active{transform:scale(.92)}
.bb-tabs .bb-heart-btn svg{width:22px;height:22px}
.bb-tabs .bb-hthink-open:focus-visible,.bb-tabs .bb-hnext:focus-visible,.bb-tabs .bb-heart-btn:focus-visible,.bb-tabs .bb-wday:focus-visible{outline:2px solid var(--bb-clay);outline-offset:2px}
.bb-tabs[id=bHomeCount] .bb-sec{height:100%}
.bb-tabs [data-sec=countdown] .bb-head{display:none}
.bb-tabs [data-sec=countdown] .bb-body{padding:16px;height:100%}
.bb-tabs .bb-cd{text-align:left;gap:4px;padding:0;align-content:space-between;height:100%}
.bb-tabs .bb-cd-title{font-family:var(--font-ui,sans-serif);font-size:13px;font-weight:500;color:var(--bb-ink-2);line-height:1.3;text-wrap:pretty;overflow-wrap:anywhere}
.bb-tabs .bb-cd-num{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap}
.bb-tabs .bb-cd-num b{font-family:var(--bb-display);font-weight:400;font-size:44px;line-height:1;font-variant-numeric:lining-nums}
.bb-tabs .bb-cd-num span{font-size:14px}
.bb-tabs .bb-here{font-size:30px}
.bb-tabs .bb-cd-when{font-size:12px;font-weight:500;color:var(--bb-ink-2)}
.bb-tabs .bb-cd-change{justify-self:start;min-height:44px;padding:0;margin:-8px 0 -12px;font-size:14px}
.bb-tabs .bb-cd .bb-empty{text-align:left;padding:0;font-size:14px}
.bb-meet{display:flex;align-items:center;gap:6px;min-height:28px}
.bb-meet-h{width:26px;height:26px;border-radius:13px;overflow:hidden;flex:none;background:#EDE3D6}
.bb-meet-semal{background:#F3D9B1}
.bb-meet-h svg{width:100%;height:100%}
.bb-meet-path{height:0;border-top:2px dotted #B9A796;transition:width .8s var(--bb-ease)}
.bb-meet-here{gap:0;position:relative}
.bb-meet-here .bb-meet-mo{margin-right:-5px}
.bb-meet-heart{position:absolute;left:19px;top:-12px;width:14px;height:14px}
.bb-meet-heart svg{width:100%;height:100%}
.bb-tabs .bb-hnext{display:flex;flex-direction:column;justify-content:space-between;gap:8px;padding:16px;min-height:126px}
.bb-tabs .bb-hnext-top{display:flex;align-items:center;justify-content:space-between;width:100%}
.bb-tabs .bb-label{font-size:13px;font-weight:500;color:var(--bb-ink-2)}
.bb-tabs .bb-hnext-chev svg{width:18px;height:18px;color:var(--bb-ink-2)}
.bb-tabs .bb-hnext-title{font-size:16px;font-weight:600;line-height:1.25;overflow-wrap:anywhere}
.bb-tabs .bb-hnext-times{display:flex;flex-direction:column;font-size:13px;color:var(--bb-ink-2)}
/* Plans: Say it, the week, both clocks on each plan */
.bboard.bb-tabs .bb-talk{display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"l b" "i b";align-items:center;column-gap:10px;min-height:68px;padding:8px 8px 2px 18px;margin:0 0 14px;border-radius:24px;background:var(--bb-paper-2)}
.bb-tabs .bb-talk-label{grid-area:l;font-size:12px;font-weight:600;color:var(--bb-ink-2)}
.bboard.bb-tabs .bb-talk .bb-in{grid-area:i;background:transparent;box-shadow:none;min-height:44px;height:44px;padding:0;border-radius:0;font-size:16px}
.bboard.bb-tabs .bb-talk .bb-in:focus{outline:none}
.bboard.bb-tabs .bb-talk:focus-within{box-shadow:0 0 0 2px var(--bb-clay)}
.bboard.bb-tabs .bb-talk .bb-add-btn{grid-area:b;width:48px;height:48px;min-height:48px;padding:0;border-radius:24px}
.bb-tabs .bb-talk .bb-add-word{display:none}
.bb-tabs .bb-talk .bb-add-btn svg{width:22px;height:22px}
.bb-tabs .bb-week{display:grid;grid-template-columns:repeat(7,minmax(44px,1fr));gap:6px;overflow-x:auto;scrollbar-width:none;overscroll-behavior-x:contain}
.bb-tabs .bb-week::-webkit-scrollbar{display:none}
/* small phones: closer together and out to the card's edge; the very smallest scroll the week sideways, inside the card */
@media (max-width:400px){.bb-tabs .bb-week{gap:2px;margin:0 -8px}}
.bb-tabs .bb-wday{position:relative;height:58px;min-width:44px;border-radius:16px;background:var(--bb-paper);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;transition:transform .2s var(--bb-ease)}
.bb-tabs .bb-wday:active{transform:scale(.95)}
.bb-tabs .bb-wd{font-size:11px;color:var(--bb-ink-2)}
.bb-tabs .bb-dn{font-size:16px;font-weight:600}
.bb-tabs .bb-wdot{width:5px;height:5px;border-radius:3px;background:transparent}
.bb-tabs .bb-wday.bb-has{box-shadow:inset 0 0 0 1.5px var(--bb-clay)}
.bb-tabs .bb-wday.bb-has .bb-wdot{background:var(--bb-clay)}
.bb-tabs .bb-wday.bb-today{background:var(--bb-ink);color:var(--bb-paper)}
.bb-tabs .bb-wday.bb-today .bb-wd{color:inherit;opacity:.85}
.bb-tabs .bb-day.bb-flash{animation:bb-flash 1.4s ease}
@keyframes bb-flash{0%,100%{background:transparent}30%{background:var(--bb-clay-soft)}}
.bb-tabs .bb-day{border-radius:14px}
.bb-tabs .bb-ev-title{font-family:var(--bb-display);font-weight:400;font-size:21px;line-height:1.2}
.bb-tabs .bb-two{display:grid;gap:4px;margin-top:6px}
.bb-tabs .bb-tz{display:grid;grid-template-columns:30px 96px minmax(0,1fr);align-items:center;gap:10px;min-height:36px}
.bb-tabs .bb-tz-fig{width:30px;height:30px;border-radius:15px;overflow:hidden;background:#EDE3D6}
.bb-tabs .bb-tz + .bb-tz .bb-tz-fig{background:#F3D9B1}
.bb-tabs .bb-tz-fig svg{width:100%;height:100%}
.bb-tabs .bb-tz-words{display:flex;flex-direction:column;line-height:1.2;min-width:0}
.bb-tabs .bb-tz-words b{font-size:15px;font-weight:600;white-space:nowrap}
.bb-tabs .bb-tz-words span{font-size:12px;color:var(--bb-ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bb-tabs .bb-tz-bar{position:relative;height:16px;border-radius:8px;background:linear-gradient(90deg,#4F5F6C 0 25%,#F3D9B1 25% 83.3%,#4F5F6C 83.3%)}
.bb-tabs .bb-tz-mark{position:absolute;top:1px;width:14px;height:14px;border-radius:7px;background:#FFFFFF;box-shadow:inset 0 0 0 3px var(--bb-clay)}
.bb-tabs .bb-ev{padding-left:0;align-items:flex-start;padding-top:8px;padding-bottom:8px}
.bb-tabs .bb-ev::before{display:none}
.bb-tabs .bb-past .bb-ev-title{font-family:var(--font-ui,sans-serif);font-size:16px;font-weight:600}
.bb-tabs .bb-empty-sofa{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 0 4px}
.bb-tabs .bb-sofa{width:150px;margin-bottom:4px}
.bb-tabs .bb-sofa svg,.bb-tabs .bb-hscene svg{width:100%;height:auto;display:block}
.bb-tabs .bb-empty-h{font-weight:600;color:var(--bb-ink);font-size:15px}
/* Hearts */
.bb-tabs .bb-hscene{display:grid;place-items:center;padding:18px 16px 8px;border-radius:24px;background:linear-gradient(180deg,#F6E2C6,#F3D9B1)}
.bb-tabs .bb-hscene svg{max-width:200px}
.bb-tabs .bb-dot-fig{background:#EDE3D6;overflow:hidden}
.bb-tabs .bb-dot-fig.bb-fig-semal{background:#F3D9B1}
.bb-tabs .bb-dot-fig svg{width:100%;height:100%}
.bb-tabs .bb-th-row .bb-dot.bb-dot-fig{width:40px;height:40px;border-radius:20px}
.bb-tabs .bb-th-card{border-radius:20px}
.bb-tabs .bb-th-line{font-size:19px;row-gap:2px}
.bb-tabs .bb-th-line .bb-ago{flex-basis:100%;padding-left:28px}
.bb-tabs [data-sec=think] .bb-head-static .bb-sum{display:none}
/* notes sit above the tab bar */
.bboard.bb-notewrap,.bb-notewrap{container-type:normal}
.bb-notewrap .bb-note{position:fixed;z-index:62;left:50%;top:auto;bottom:max(calc(86px + env(safe-area-inset-bottom)),calc(var(--kb,0px) + 12px));transform:translateX(-50%);width:min(calc(100% - 32px),520px);margin:0;border-radius:18px;padding:6px 4px 6px 16px;min-height:52px;animation:bb-up .4s var(--bb-ease)}
.bb-notewrap .bb-note .bb-note-act{color:#F3C98F;box-shadow:none;min-height:44px}
@keyframes bb-up{from{opacity:0;transform:translate(-50%,10px)}to{opacity:1;transform:translate(-50%,0)}}
.bb-fly{position:fixed;left:0;top:0;z-index:95;width:28px;height:28px;pointer-events:none;filter:drop-shadow(0 0 6px rgba(232,144,122,.55))}
.bb-fly svg{width:100%;height:100%;display:block}
@media (prefers-reduced-motion:reduce){.bboard *,.bboard *::before,.bboard *::after,.bb-fly{animation:none !important;transition:none !important}}
html.is-hidden .bboard *,html.is-hidden .bboard *::before,html.is-hidden .bboard *::after{animation-play-state:paused !important;transition:none !important}
`;

  function mount(el, opts) {
    if (!el) throw new Error('BesideBoard.mount needs an element');
    const o = opts || {};
    const room = String(o.room || '');
    const name = String(o.name || '').trim().slice(0, 40) || 'Someone';
    if (S && S.el === el && S.room === room) { S.name = name; if (o.them != null) S.them = String(o.them).trim().slice(0, 40); if (o.role) S.role = o.role; render(); return; }
    if (S) { clearTimeout(S.timer); S.el.classList.remove('bboard'); }
    if (!document.getElementById('bboard-css')) document.head.append(h('style', { id: 'bboard-css', text: CSS }));
    S = { el, room, name, server: empty(), pending: [], chain: Promise.resolve(), folds: {}, fails: 0, loaded: false, offline: false, timer: 0,
      split: !!o.targets, t: o.targets || {}, opts: o, them: String(o.them || '').trim().slice(0, 40), role: o.role === 'host' || o.role === 'guest' ? o.role : '' };
    if (!ROOM_RE.test(room)) {
      el.classList.add('bboard');
      el.replaceChildren(h('p', { class: 'bb-empty', text: 'The board opens once you’re on a Beside link.' }));
      S = null;
      return;
    }
    build();
    render();
    poll();
    schedule();
  }

  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pageshow', onVisible);
  setInterval(() => { if (S && document.visibilityState === 'visible') render(); }, 30000); // "2 h ago", the countdown
  // Nobody looking: every animation waits (html.is-hidden), and the words catch up the moment they look again.
  function seen() {
    const hid = document.visibilityState === 'hidden';
    document.documentElement.classList.toggle('is-hidden', hid);
    if (hid && document.getAnimations) document.getAnimations().forEach((a) => { if (window.CSSTransition && a instanceof CSSTransition) { try { a.finish(); } catch (e) {} } });
    if (!hid && S) render();
  }
  document.addEventListener('visibilitychange', seen);
  seen();

  window.BesideBoard = {
    mount,
    refresh() { if (S) { poll(); schedule(); } },
    // Which figure is this person's (Mo's home is London, Semal's is LA), and the other one's name if known.
    people() { return { me: whoMe(), them: S ? theirName(S.lastView) : '' }; },
    celebrate() { if (S) celebrate(); },
  };
})();
