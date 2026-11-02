// sitbeside.pages.dev/peerjs/... is Beside's own call server (beside-server/), reached through a
// service binding so it needs no address of its own. If it is not answering, Beside falls back to 0.peerjs.com.
// The site picks up a new call server when the site itself is next published (2 Nov 2026).
export function onRequest({ request, env }) {
  if (!env.SIGNAL) return new Response('{"ok":false}', { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  return env.SIGNAL.fetch(request);
}
