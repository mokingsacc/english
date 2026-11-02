// Beside's ring: shows "Mo is calling" when Beside is closed, and opens the call when tapped.
// The ring arrives as an encrypted web push from Beside's own server (beside-server/src/push.js).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = {}; }
  // Every push must show a notification (Safari stops pushes to sites that don't).
  e.waitUntil(self.registration.showNotification(d.title || 'Beside is ringing', {
    body: d.body || 'Tap to open Beside.',
    tag: 'beside-ring',
    renotify: true,
    requireInteraction: true,
    icon: 'icon-192.png',
    vibrate: [400, 200, 400, 200, 400],
    data: { url: d.url || './', at: Date.now() },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  let url;
  try {
    const u = new URL((e.notification.data && e.notification.data.url) || './', self.location.href);
    if (u.origin !== self.location.origin) throw new Error('not ours');
    if (Date.now() - ((e.notification.data && e.notification.data.at) || 0) < 10 * 60 * 1000) u.searchParams.set('answer', '1');
    url = u.href;
  } catch (x) { url = new URL('./', self.location.href).href; }
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Beside already open: bring it forward and tell it to answer (reloading it could end a call).
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) {
        try { await c.focus(); c.postMessage({ beside: 'answer', fresh: url.includes('answer=1') }); return; } catch (x) { /* open a new one */ }
      }
    }
    await self.clients.openWindow(url);
  })());
});
