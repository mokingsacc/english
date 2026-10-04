// English app photo inbox (Cloudflare Worker, free plan).
// Receives a photo from Freshta's app and saves it in the private GitHub repo
// "english-inbox". Claude checks that repo every evening and turns new photos
// into lessons.
//
// Setup: paste this whole file into the Worker editor, then add one secret
// named GITHUB_TOKEN (Settings > Variables and Secrets).

const REPO = 'mokingsacc/english-inbox';
const APP_ORIGIN = 'https://mokingsacc.github.io';
const MAX_BYTES = 4 * 1024 * 1024; // base64 photo size limit

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin === APP_ORIGIN ? APP_ORIGIN : 'null',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function reply(status, body, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(origin) },
  });
}

async function putFile(env, path, base64, message) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'english-upload-worker',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ message, content: base64 }),
  });
  return res;
}

function toBase64Utf8(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(origin) });

    // Health check used by the app's self-check and by Mo: open the Worker URL in a browser.
    if (request.method === 'GET') {
      return reply(200, { ok: true, service: 'english-upload', token: !!env.GITHUB_TOKEN }, origin);
    }
    if (request.method !== 'POST') return reply(405, { ok: false, error: 'method' }, origin);
    if (origin !== APP_ORIGIN) return reply(403, { ok: false, error: 'origin' }, origin);
    if (!env.GITHUB_TOKEN) return reply(500, { ok: false, error: 'no-token' }, origin);

    let data;
    try { data = await request.json(); } catch (e) { return reply(400, { ok: false, error: 'json' }, origin); }
    const image = typeof data.image === 'string' ? data.image : '';
    if (!/^[A-Za-z0-9+/=]+$/.test(image) || image.length < 1000) return reply(400, { ok: false, error: 'image' }, origin);
    if (image.length > MAX_BYTES) return reply(413, { ok: false, error: 'too-big' }, origin);
    // JPEG files start with FF D8 FF, which is "/9j/" in base64.
    if (!image.startsWith('/9j/')) return reply(400, { ok: false, error: 'not-jpeg' }, origin);

    const note = String(data.note || '').slice(0, 500);
    const name = String(data.name || '').slice(0, 40);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const id = `${stamp}-${Math.random().toString(36).slice(2, 8)}`;

    const img = await putFile(env, `inbox/${id}.jpg`, image, `Photo from app ${id}`);
    if (!img.ok) return reply(502, { ok: false, error: 'github', status: img.status }, origin);
    const meta = JSON.stringify({ id, note, name, sentAt: new Date().toISOString() }, null, 1);
    const js = await putFile(env, `inbox/${id}.json`, toBase64Utf8(meta), `Note from app ${id}`);
    if (!js.ok) return reply(502, { ok: false, error: 'github-note', status: js.status }, origin);

    return reply(200, { ok: true, id }, origin);
  },
};
