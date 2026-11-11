/* Ring and hearts: wake the other person's device when Beside is closed.
   Web push (Safari Home Screen icon, Chrome, Firefox): VAPID (RFC 8292) with an encrypted payload (RFC 8291, aes128gcm).
   The Beside iPhone and iPad app: an Apple VoIP push, which the app turns into a real incoming call (CallKit),
   and an ordinary Apple notification (with a soft ping) for a heart.
   Keys are Worker secrets: VAPID_JWK (a P-256 private key as JWK), APNS_KEY_P8, APNS_KEY_ID, APPLE_TEAM_ID. */

const enc = new TextEncoder();
export const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function unb64u(s) {
  const b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(s).length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
const cat = (...a) => { const out = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let o = 0; a.forEach((x) => { out.set(x, o); o += x.length; }); return out; };

// Push services browsers really use; anything else is refused, so the Worker can't be made to call other sites.
const PUSH_HOSTS = /(^|\.)(push\.apple\.com|fcm\.googleapis\.com|android\.googleapis\.com|notify\.windows\.com|push\.services\.mozilla\.com)$/;
export function pushHostOk(endpoint, env) {
  try {
    const u = new URL(endpoint);
    if (env && env.PUSH_TEST_HOST && u.host === env.PUSH_TEST_HOST) return true; // local tests only
    return u.protocol === 'https:' && PUSH_HOSTS.test(u.hostname);
  } catch (e) { return false; }
}

function vapidJwk(env) {
  if (!env.VAPID_JWK) return null;
  try { const j = JSON.parse(env.VAPID_JWK); return j && j.d && j.x && j.y ? j : null; } catch (e) { return null; }
}
export function vapidPublic(env) {
  const j = vapidJwk(env);
  return j ? b64u(cat(new Uint8Array([4]), unb64u(j.x), unb64u(j.y))) : null;
}

async function es256(header, claims, key) {
  const data = b64u(enc.encode(JSON.stringify(header))) + '.' + b64u(enc.encode(JSON.stringify(claims)));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(data));
  return data + '.' + b64u(sig); // WebCrypto gives r||s, which is what JWS wants
}

async function hmac(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

// RFC 8291: the payload encrypted for one browser's keys.
export async function encryptPayload(text, p256dh, auth) {
  const ua = unb64u(p256dh), secret = unb64u(auth);
  if (ua.length !== 65 || secret.length < 16) throw new Error('bad keys');
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const as = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256));
  const prkKey = await hmac(secret, shared);
  const ikm = await hmac(prkKey, cat(enc.encode('WebPush: info\0'), ua, asPub, new Uint8Array([1])));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, cat(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, cat(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(enc.encode(text), new Uint8Array([2]))));
  const head = new Uint8Array(21);
  head.set(salt, 0);
  new DataView(head.buffer).setUint32(16, 4096);
  head[20] = 65;
  return cat(head, asPub, ct);
}

// One web push. Returns 'ok', 'gone' (forget this device) or 'fail'.
// topic: a newer push with the same topic replaces one still waiting (a ring, or a heart).
// ttl: seconds the push service keeps it for a device it can't reach yet. A ring is no use after a minute; a heart waits.
export async function sendWeb(env, sub, payload, topic = 'ring', ttl = 60) {
  const j = vapidJwk(env);
  if (!j || !pushHostOk(sub.endpoint, env)) return 'fail';
  const key = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', d: j.d, x: j.x, y: j.y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const u = new URL(sub.endpoint);
  const jwt = await es256({ typ: 'JWT', alg: 'ES256' }, { aud: u.origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'https://sitbeside.pages.dev' }, key);
  let body;
  try { body = await encryptPayload(JSON.stringify(payload), sub.keys.p256dh, sub.keys.auth); } catch (e) { return 'gone'; }
  try {
    const r = await fetch(sub.endpoint, {
      method: 'POST',
      headers: { authorization: `vapid t=${jwt}, k=${vapidPublic(env)}`, ttl: String(ttl), urgency: 'high', topic, 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream' },
      body,
    });
    if (r.status === 404 || r.status === 410) return 'gone';
    if (!r.ok) console.warn('web push', topic, r.status); // seen with wrangler tail; never the address or the keys
    return r.ok ? 'ok' : 'fail';
  } catch (e) { return 'fail'; }
}

// One Apple VoIP push to the Beside app (a real incoming call screen).
let apnsJwt = null;
export const APNS_TOPIC = 'com.mokingsacc.beside.voip';
export const APNS_ALERT_TOPIC = 'com.mokingsacc.beside';
export const sendVoip = (env, sub, payload) => apns(env, sub.token, sub.env, 'voip', APNS_TOPIC, payload);
// One ordinary Apple notification to the Beside app (a heart), to the device's notification token.
// keep: seconds Apple holds it for a phone that is off or has no signal just then (a ring is never held: 0).
export const sendAlert = (env, sub, payload, keep = 0) => apns(env, sub.alert, sub.env, 'alert', APNS_ALERT_TOPIC, payload, keep);

async function apns(env, token, where, type, topic, payload, keep = 0) {
  if (!env.APNS_KEY_P8 || !env.APNS_KEY_ID || !env.APPLE_TEAM_ID) return 'fail';
  if (!apnsJwt || Date.now() - apnsJwt.at > 40 * 60 * 1000) {
    const pem = String(env.APNS_KEY_P8).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    const key = await crypto.subtle.importKey('pkcs8', unb64u(pem.replace(/\+/g, '-').replace(/\//g, '_')), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    apnsJwt = { at: Date.now(), t: await es256({ alg: 'ES256', kid: env.APNS_KEY_ID }, { iss: env.APPLE_TEAM_ID, iat: Math.floor(Date.now() / 1000) }, key) };
  }
  const host = where === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
  const base = env.APNS_TEST_URL || host; // local tests only
  try {
    const r = await fetch(`${base}/3/device/${token}`, {
      method: 'POST',
      headers: { authorization: 'bearer ' + apnsJwt.t, 'apns-push-type': type, 'apns-topic': topic, 'apns-priority': '10', 'apns-expiration': keep ? String(Math.floor(Date.now() / 1000) + keep) : '0', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (r.ok) return 'ok';
    let why = '';
    try { why = (await r.json()).reason || ''; } catch (e) {}
    if (why === 'ExpiredProviderToken') apnsJwt = null;
    console.warn('apns', type, r.status, why); // seen with wrangler tail; never the device code
    if (r.status === 410 || why === 'BadDeviceToken' || why === 'Unregistered' || why === 'DeviceTokenNotForTopic') return 'gone';
    return 'fail';
  } catch (e) { return 'fail'; }
}
