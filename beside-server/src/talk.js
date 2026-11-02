/* Talk-to-add: one short sentence ("dinner Friday 7pm, and buy flowers") becomes board changes.
   Claude reads the sentence and gives back a plain list (what, which day, which clock); this file turns
   each day and time into a moment itself, so daylight saving and the two homes are always worked out the
   same way as the board's own date picker. The key is a Worker secret (ANTHROPIC_API_KEY), never on a page. */

const LONDON = 'Europe/London';
const LA = 'America/Los_Angeles';
export const TALK_ZONES = [LONDON, LA];
export const TALK_MAX = 300; // characters in one sentence
export const TALK_ITEMS = 6; // changes from one sentence, at most

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['todo', 'event', 'countdown'] },
          title: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD, or empty for a to-do' },
          time: { type: 'string', description: 'HH:MM on a 24-hour clock, or empty for all day' },
          zone: { type: 'string', enum: TALK_ZONES },
        },
        required: ['kind', 'title', 'date', 'time', 'zone'],
        additionalProperties: false,
      },
    },
    reply: { type: 'string' },
  },
  required: ['items', 'reply'],
  additionalProperties: false,
};

const SYSTEM = `You turn one short sentence from a couple's shared board into board items. One of them lives in London, the other in Los Angeles.

Kinds:
- todo: something to do, with no fixed time ("buy flowers", "book flights"). Leave date and time empty.
- event: something at a day or time ("dinner Friday 7pm", "call Mum on the 12th"). A day without a time is all day: leave time empty.
- countdown: only when they ask to count down to something ("count down to my visit on 20 Dec"). Give its day, and a time if they said one.

Rules:
- Titles are short and plain, in the speaker's own words, with a capital first letter and no date or time in them ("Dinner", "Buy flowers").
- Work out dates from today in the speaker's home. "Friday" means the next Friday still to come; "tonight" means today.
- zone is whose clock a time is on: the speaker's, unless they name the other home ("7pm your time", "7pm LA time", "London time"). Use the speaker's zone for to-dos and all-day items too.
- Several things in one sentence become several items. Never more than ${TALK_ITEMS}.
- If nothing in it can go on the board, give no items.
- reply: one short friendly sentence for the speaker, only used when there are no items (say what you'd need). Otherwise an empty string.`;

const pad = (n) => String(n).padStart(2, '0');
const fmtCache = {};
function parts(t, z) {
  const f = fmtCache[z] || (fmtCache[z] = new Intl.DateTimeFormat('en-GB', { timeZone: z, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }));
  const p = {};
  f.formatToParts(t).forEach((x) => { if (x.type !== 'literal') p[x.type] = +x.value; });
  return { y: p.year, mo: p.month, d: p.day, h: p.hour % 24, mi: p.minute, s: p.second };
}
const offsetOf = (t, z) => { const p = parts(t, z); return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000; };
// A wall-clock time in a zone as a moment (the same sum as board.js zoned()).
export function zoned(y, mo, d, hh, mi, z) {
  const guess = Date.UTC(y, mo - 1, d, hh, mi);
  let t = guess - offsetOf(guess, z);
  t = guess - offsetOf(t, z);
  return t;
}
function nowLine(now, z) {
  const p = parts(now, z);
  const wd = new Intl.DateTimeFormat('en-GB', { timeZone: z, weekday: 'long' }).format(now);
  return `${wd} ${p.y}-${pad(p.mo)}-${pad(p.d)} ${pad(p.h)}:${pad(p.mi)}`;
}

// Claude's list, checked and turned into board changes. Anything odd is dropped, never guessed.
export function toOps(items, zone) {
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (out.length >= TALK_ITEMS) break;
    if (!it || typeof it !== 'object') continue;
    const title = typeof it.title === 'string' ? it.title.replace(/\s+/g, ' ').trim().slice(0, TALK_MAX) : '';
    if (!title) continue;
    if (it.kind === 'todo') { out.push({ op: 'todo.add', text: title }); continue; }
    if (it.kind !== 'event' && it.kind !== 'countdown') continue;
    const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(it.date || '');
    if (!dm) continue;
    const [y, mo, d] = [+dm[1], +dm[2], +dm[3]];
    if (mo < 1 || mo > 12 || d < 1 || new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d) continue; // no 30 February
    const tm = /^(\d{1,2}):(\d{2})$/.exec(it.time || '');
    if (tm && (+tm[1] > 23 || +tm[2] > 59)) continue;
    const z = TALK_ZONES.includes(it.zone) ? it.zone : zone;
    if (it.kind === 'event' && !tm) { out.push({ op: 'event.add', title, at: Date.UTC(y, mo - 1, d, 12), allDay: true }); continue; }
    const at = zoned(y, mo, d, tm ? +tm[1] : 0, tm ? +tm[2] : 0, z);
    out.push(it.kind === 'event' ? { op: 'event.add', title, at, allDay: false } : { op: 'countdown.set', title, at });
  }
  return out;
}

export class TalkError extends Error {}

// Ask Claude. Returns { items, reply }.
export async function understand(env, sentence, who, zone, now = Date.now()) {
  if (!env.ANTHROPIC_API_KEY) throw new TalkError('Say it isn’t switched on yet.');
  const other = zone === LA ? LONDON : LA;
  const user = `Speaker: ${who || 'one of them'}, who lives in ${zone === LA ? 'Los Angeles' : 'London'} (${zone}).
Now in the speaker's home: ${nowLine(now, zone)}. Now in the other home (${other}): ${nowLine(now, other)}.

Sentence: ${JSON.stringify(sentence)}`;
  // Local tests point this at a fake; nothing else can (it must be this computer).
  const base = env.ANTHROPIC_TEST_URL && /^http:\/\/127\.0\.0\.1:\d+$/.test(env.ANTHROPIC_TEST_URL) ? env.ANTHROPIC_TEST_URL : 'https://api.anthropic.com';
  const c = new AbortController();
  const timer = setTimeout(() => c.abort(), 25000);
  let r;
  try {
    r = await fetch(base + '/v1/messages', {
      method: 'POST',
      signal: c.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2026-10-21' },
      body: JSON.stringify({
        model: 'claude-opus-5-5',
        max_tokens: 4000,
        system: SYSTEM,
        output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: user }],
      }),
    });
  } catch (e) {
    throw new TalkError('Couldn’t reach Claude just now. Please try again.');
  } finally {
    clearTimeout(timer);
  }
  if (r.status === 401 || r.status === 403) throw new TalkError('Say it isn’t switched on yet.');
  if (r.status === 429 || r.status === 529 || r.status >= 500) throw new TalkError('Claude is busy just now. Please try again in a minute.');
  if (!r.ok) throw new TalkError('That couldn’t be understood. Please try again.');
  const j = await r.json();
  if (j.stop_reason === 'refusal') return { items: [], reply: 'That one can’t go on the board.' };
  const block = (j.content || []).find((b) => b.type === 'text');
  let o;
  try { o = JSON.parse(block && block.text); } catch (e) { throw new TalkError('That couldn’t be understood. Please try again.'); }
  return { items: Array.isArray(o.items) ? o.items : [], reply: typeof o.reply === 'string' ? o.reply.slice(0, 200) : '' };
}
