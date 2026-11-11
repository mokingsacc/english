// Beside's one icon family, used everywhere: drawn on a 24 grid with a 1.75 stroke and round ends.
// BesideIcons.svg('mic', 22) gives the markup; a placeholder <i data-icon="mic" data-size="22"></i> in the page is
// swapped for the same drawing as soon as this file runs. The figures, the house and the wordmark are pictures, not icons.
(function () {
  const P = {
    home: '<path d="M4 10.6 12 4l8 6.6v7.9a2 2 0 0 1-2 2h-3.2v-5a1.3 1.3 0 0 0-1.3-1.3h-3a1.3 1.3 0 0 0-1.3 1.3v5H6a2 2 0 0 1-2-2z"/>',
    calendar: '<rect x="4" y="5.5" width="16" height="15" rx="3.5"/><path d="M4 10.5h16M8.5 3.5v4M15.5 3.5v4"/>',
    heart: '<path d="M12 20.2s-7.6-4.7-7.6-10.4A4.3 4.3 0 0 1 12 7.1a4.3 4.3 0 0 1 7.6 2.7c0 5.7-7.6 10.4-7.6 10.4z"/>',
    heartf: '<path fill="currentColor" d="M12 20.2s-7.6-4.7-7.6-10.4A4.3 4.3 0 0 1 12 7.1a4.3 4.3 0 0 1 7.6 2.7c0 5.7-7.6 10.4-7.6 10.4z"/>',
    phone: '<path d="M6.6 4h2.9l1.6 4.2-2 1.5a11.6 11.6 0 0 0 5.2 5.2l1.5-2 4.2 1.6v2.9a2 2 0 0 1-2.1 2A14.6 14.6 0 0 1 4.6 6.1 2 2 0 0 1 6.6 4z"/>',
    video: '<rect x="3" y="6.5" width="12.5" height="11" rx="3"/><path d="m15.5 10.6 5-2.9v8.6l-5-2.9"/>',
    mic: '<rect x="9" y="3.5" width="6" height="10.5" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>',
    share: '<rect x="3.5" y="4.5" width="17" height="12" rx="3"/><path d="M8.5 20h7M12 16.5V20M12 13.2V8.3M9.7 10.4 12 8.1l2.3 2.3"/>',
    chat: '<path d="M20 11.5a8 8 0 0 1-11.9 7L4 19.6l1.1-4A8 8 0 1 1 20 11.5z"/>',
    speaker: '<path d="M4.5 10v4H8l4.5 3.5v-11L8 10H4.5zM15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10"/>',
    more: '<circle cx="5.5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="18.5" cy="12" r="1.5" fill="currentColor"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    chev: '<path d="M9.5 6l6 6-6 6"/>',
    chevl: '<path d="M14.5 6l-6 6 6 6"/>',
    chevd: '<path d="M6 9.5l6 6 6-6"/>',
    plus: '<path d="M12 5.5v13M5.5 12h13"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    bell: '<path d="M6.5 9.5a5.5 5.5 0 0 1 11 0c0 6 2.5 7.5 2.5 7.5H4s2.5-1.5 2.5-7.5M10 20a2.2 2.2 0 0 0 4 0"/>',
    link: '<path d="M10.2 13.8a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M13.8 10.2a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    photo: '<rect x="3.5" y="5" width="17" height="14" rx="3.5"/><circle cx="9" cy="10" r="1.6"/><path d="m20.5 15-4.5-4.5L7.5 19"/>',
    file: '<path d="M13.5 3.5H8A2.5 2.5 0 0 0 5.5 6v12A2.5 2.5 0 0 0 8 20.5h8a2.5 2.5 0 0 0 2.5-2.5V8.5zM13.5 3.5v5h5"/>',
    screen: '<rect x="3.5" y="4.5" width="17" height="12" rx="3"/><path d="M8.5 20h7M12 16.5V20"/>',
    sliders: '<path d="M4.5 8h8.2M17.3 8h2.2M4.5 16h2.2M11.3 16h8.2"/><circle cx="15" cy="8" r="2.3"/><circle cx="9" cy="16" r="2.3"/>',
    end: '<path d="M3.2 13.7c5.3-4.6 12.3-4.6 17.6 0l-.5 2.6a1.3 1.3 0 0 1-1.7 1l-2.8-1a1.3 1.3 0 0 1-.9-1.3v-1.7a9 9 0 0 0-5.8 0V15a1.3 1.3 0 0 1-.9 1.3l-2.8 1a1.3 1.3 0 0 1-1.7-1z"/>',
    send: '<path d="M12 19V5.5M6.5 11 12 5.5l5.5 5.5"/>',
    pip: '<rect x="3.5" y="5" width="17" height="14" rx="3.5"/><rect x="12" y="11.5" width="6" height="5" rx="1.3" fill="currentColor" stroke="none"/>',
    split: '<rect x="3.5" y="5" width="7.5" height="14" rx="2.5"/><rect x="13" y="5" width="7.5" height="14" rx="2.5"/>',
    play: '<path fill="currentColor" stroke="none" d="M8 5.3v13.4a.8.8 0 0 0 1.2.7l10.7-6.7a.8.8 0 0 0 0-1.4L9.2 4.6a.8.8 0 0 0-1.2.7z"/>',
    pause: '<rect x="6.5" y="5" width="4" height="14" rx="1.5" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="4" height="14" rx="1.5" fill="currentColor" stroke="none"/>',
    moon: '<path d="M19.6 14.3A7.9 7.9 0 0 1 9.7 4.4a7.9 7.9 0 1 0 9.9 9.9z"/>',
    sun: '<circle cx="12" cy="12" r="3.8"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6 18 18M6 18l1.4-1.4M16.6 7.4 18 6"/>',
    cloud: '<path d="M7.5 18a4 4 0 0 1-.4-8 5.5 5.5 0 0 1 10.5 1.3 3.4 3.4 0 0 1-.6 6.7z"/>',
    rain: '<path d="M7.5 15.5a4 4 0 0 1-.4-8 5.5 5.5 0 0 1 10.5 1.3 3.4 3.4 0 0 1-.6 6.7M9 18.5l-.8 2M13 18.5l-.8 2M17 18.5l-.8 2"/>',
    snow: '<path d="M7.5 15.5a4 4 0 0 1-.4-8 5.5 5.5 0 0 1 10.5 1.3 3.4 3.4 0 0 1-.6 6.7"/><circle cx="9" cy="19.5" r=".9" fill="currentColor"/><circle cx="13" cy="20.5" r=".9" fill="currentColor"/><circle cx="17" cy="19.5" r=".9" fill="currentColor"/>',
    fog: '<path d="M4.5 9h15M6.5 13h11M4.5 17h15"/>',
    wifioff: '<path d="M4.5 4.5l15 15M8.6 15.2a5 5 0 0 1 6.3-.4M5.5 11.8a9.5 9.5 0 0 1 3.3-2.1M12.2 8.4a9.5 9.5 0 0 1 6.3 3.4M2.8 8.6a13.5 13.5 0 0 1 3-2.2M10 5.3a13.5 13.5 0 0 1 11.2 3.3"/><circle cx="12" cy="18.5" r="1" fill="currentColor"/>',
    device: '<rect x="6.5" y="2.5" width="11" height="19" rx="3"/><path d="M11 18.5h2"/>',
    note: '<path d="M5 19l1-4.2L16.3 4.5a2.1 2.1 0 0 1 3 3L9 17.9z"/>',
    full: '<path d="M8.5 4.5h-4v4M15.5 4.5h4v4M8.5 19.5h-4v-4M15.5 19.5h4v-4"/>',
    clock: '<circle cx="12" cy="12" r="8.2"/><path d="M12 7.5V12l3 2"/>',
    person: '<circle cx="12" cy="8.5" r="3.7"/><path d="M4.8 20a7.2 7.2 0 0 1 14.4 0"/>',
    personplus: '<circle cx="10" cy="8.5" r="3.7"/><path d="M2.8 20a7.2 7.2 0 0 1 14.4 0M19 7.5v6M16 10.5h6"/>',
    list: '<path d="M9.5 7h10M9.5 12h10M9.5 17h10"/><circle cx="5.2" cy="7" r="1.1" fill="currentColor"/><circle cx="5.2" cy="12" r="1.1" fill="currentColor"/><circle cx="5.2" cy="17" r="1.1" fill="currentColor"/>',
    tools: '<path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L4.5 16.5l3 3 4.7-4.7a4 4 0 0 0 5.3-5.3l-2.6 2.6-2.4-.6-.6-2.4z"/>',
    ear: '<path d="M7 9.5a5 5 0 0 1 10 0c0 3-2.5 3.5-2.5 6a3 3 0 0 1-5.6 1.5M9.8 10a2.3 2.3 0 0 1 4.5 0"/>',
    point: '<circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="7.5"/>',
    refresh: '<path d="M19 12a7 7 0 1 1-2.3-5.2M19 4.5v3.8h-3.8"/>',
    // drawn for Beside in the same hand: copy, send out, swap, a problem, a check still running
    copy: '<rect x="9" y="9" width="11" height="11" rx="3"/><path d="M15 5.5A2 2 0 0 0 13 4H7a3 3 0 0 0-3 3v6a2 2 0 0 0 1.5 2"/>',
    upload: '<path d="M12 14.5V4M7.5 8.5 12 4l4.5 4.5M5 13.5v3.5A3 3 0 0 0 8 20h8a3 3 0 0 0 3-3v-3.5"/>',
    swap: '<path d="M4.5 8h13l-3.5-3.5M19.5 16h-13l3.5 3.5"/>',
    alert: '<path d="M12 7v6.5"/><circle cx="12" cy="17" r="1.1" fill="currentColor" stroke="none"/>',
    spin: '<path d="M12 3.8A8.2 8.2 0 1 0 20.2 12"/>',
  };
  const SLASH = '<path class="slash" d="M4.5 4.5l15 15"/>';
  const esc = (s) => String(s).replace(/[&"<>]/g, (c) => ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' }[c]));
  // The markup of one icon. o.slash adds the line used for mic off and camera off (shown by CSS).
  function svg(name, size, o) {
    o = o || {};
    const s = size || 24;
    const cls = 'i' + (o.cls ? ' ' + o.cls : '');
    return '<svg class="' + esc(cls) + '" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
      (P[name] || '') + (o.slash ? SLASH : '') + '</svg>';
  }
  function el(name, size, o, doc) {
    const t = (doc || document).createElement('template');
    t.innerHTML = svg(name, size, o);
    return t.content.firstChild;
  }
  // Swap every <i data-icon> placeholder under root for its drawing, keeping its classes.
  function fill(root) {
    (root || document).querySelectorAll('[data-icon]').forEach((ph) => {
      const n = el(ph.dataset.icon, +ph.dataset.size || 24, { cls: ph.getAttribute('class') || '', slash: ph.hasAttribute('data-slash') }, ph.ownerDocument);
      ph.replaceWith(n);
    });
  }
  window.BesideIcons = { svg, el, fill, has: (n) => !!P[n] };
  fill(document);
})();
