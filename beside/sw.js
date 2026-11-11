// Beside's ring: shows "Mo is calling" when Beside is closed, and opens the call when tapped. A heart
// ("Mo is thinking of you") shows as a gentle notification that just opens Beside.
// Both arrive as encrypted web pushes from Beside's own server (beside-server/src/push.js).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = {}; }
  // Every push must show a notification (Safari stops pushes to sites that don't).
  const heart = d.kind === 'heart';
  e.waitUntil(self.registration.showNotification(d.title || (heart ? 'Beside' : 'Beside is ringing'), {
    body: d.body || 'Tap to open Beside.',
    tag: heart ? 'beside-heart' : 'beside-ring',
    renotify: true,
    requireInteraction: !heart,
    icon: 'icon-192.png',
    vibrate: heart ? [60, 80, 60] : [400, 200, 400, 200, 400],
    data: { url: d.url || './', at: Date.now(), kind: heart ? 'heart' : 'ring' },
  }));
  // Beside open in a browser tab shows the ring itself too: their head, Answer and Not now.
  if (!heart) e.waitUntil(self.clients.matchAll({ type: 'window' }).then((all) => all.forEach((c) => c.postMessage({ beside: 'ringing', url: d.url || './' }))));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const heart = e.notification.data && e.notification.data.kind === 'heart';
  let url;
  try {
    const u = new URL((e.notification.data && e.notification.data.url) || './', self.location.href);
    if (u.origin !== self.location.origin) throw new Error('not ours');
    if (!heart && Date.now() - ((e.notification.data && e.notification.data.at) || 0) < 10 * 60 * 1000) u.searchParams.set('answer', '1');
    url = u.href;
  } catch (x) { url = new URL('./', self.location.href).href; }
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Beside already open: bring it forward and tell it to answer (reloading it could end a call). The page itself
    // opens the rung link instead when it shows another room.
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) {
        if (heart) { try { await c.focus(); return; } catch (x) { /* open a new one */ } continue; }
        try { await c.focus(); c.postMessage({ beside: 'answer', fresh: url.includes('answer=1'), url }); return; } catch (x) { /* open a new one */ }
      }
    }
    await self.clients.openWindow(url);
  })());
});
