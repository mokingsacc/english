// sitbeside.pages.dev/peerjs/... is Beside's own call server (beside-server/), reached through a
// service binding so it needs no address of its own. Not set up yet: Beside falls back to 0.peerjs.com.
export function onRequest({ request, env }) {
  if (!env.SIGNAL) return new Response('{"ok":false}', { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  return env.SIGNAL.fetch(request);
}
