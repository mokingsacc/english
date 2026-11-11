// Runs commands the way a CAD command line does. A line she enters is split into words (a space ends a word as Enter does): the first
// word names a command and the rest answer its prompts in turn, so "ICD 110" sets the diameter in one go. A running
// command asks with ctx.number / point / text / keyword / leg; the answer comes from the command line, a click in the
// drawing, or a clicked option. Esc cancels ("*Cancel*"). Enter on an empty line repeats the last command.
//   const runner = createRunner({ commands, io, context });  runner.submit('ICD 110');  runner.run('ZOOM', ['E'])
// io = { echo(text, kind), prompt(spec | null) }; context(base) adds the page's helpers to each command's ctx.

import { findCommand, words, formatPrompt, matchKeyword, parseNumber, parsePoint } from './parser.js';

export class Cancel extends Error {
  constructor() { super('*Cancel*'); }
}

export function createRunner({ commands, io, context = (c) => c }) {
  let running = null;      // { cmd, promise }
  let waiting = null;      // { spec, resolve, reject, line }
  let queue = [];          // words typed ahead for the prompts still to come
  let last = null;         // the last command name, for Enter and Repeat
  const recent = [];       // recent answers she typed, for the right-click menu

  function lineOf(spec) {
    return formatPrompt({ text: spec.text, keywords: spec.keywords || [], def: spec.def ?? null, join: spec.join });
  }

  /** Asks one prompt. Resolves with the answer, or rejects with Cancel. */
  function ask(spec) {
    if (!running) return Promise.reject(new Cancel());
    if (queue.length) {
      const typed = queue.shift();
      const got = interpret(spec, typed);
      io.echo(`${lineOf(spec)} ${typed}`, 'prompt');
      if (got.ok) return Promise.resolve(got.value);
      io.echo(got.error, 'error');
      queue = [];
    }
    return new Promise((resolve, reject) => {
      waiting = { spec, resolve, reject };
      io.prompt({ ...spec, command: running.cmd.name, line: lineOf(spec) });
    });
  }

  /** What a typed answer means for a prompt: { ok, value } or { ok: false, error }. */
  function interpret(spec, typed) {
    const s = String(typed ?? '').trim();
    if (s === '') {
      if (spec.def !== undefined && spec.def !== null) return { ok: true, value: spec.defValue !== undefined ? spec.defValue : spec.def };
      return { ok: true, value: null };
    }
    const kw = matchKeyword(spec.keywords || [], s);
    if (kw) return { ok: true, value: kw };
    if (spec.type === 'number') {
      const v = parseNumber(s);
      if (v === null) return { ok: false, error: spec.keywords && spec.keywords.length ? `Enter a number or one of the options in square brackets.` : 'Enter a number.' };
      if (spec.min !== undefined && (v < spec.min || v > spec.max)) return { ok: false, error: `Enter a number from ${spec.min} to ${spec.max}${spec.unit ? ` ${spec.unit}` : ''}.` };
      return { ok: true, value: v };
    }
    if (spec.type === 'point') {
      const sc = spec.scale ? /^(\d*\.?\d+)\s*xp?$/i.exec(s) : null;
      if (sc && Number(sc[1]) > 0) return { ok: true, value: { scale: Number(sc[1]) } };
      const p = parsePoint(s, spec.base);
      if (p) return { ok: true, value: p };
      const v = spec.allowNumber ? parseNumber(s) : null;
      if (v !== null) return { ok: true, value: v };
      return { ok: false, error: 'Pick a point in the drawing, or type easting,northing (or @east,north from the last point).' };
    }
    if (spec.type === 'leg') {
      const id = spec.findLeg ? spec.findLeg(s) : null;
      if (id) return { ok: true, value: id };
      return { ok: false, error: `There is no leg called "${s}". Click a leg, or type its id or name.` };
    }
    if (spec.type === 'keyword') return { ok: false, error: 'Choose one of the options in square brackets.' };
    return { ok: true, value: s };
  }

  function answer(typed, { echoAs } = {}) {
    if (!waiting) return false;
    const w = waiting;
    const got = interpret(w.spec, typed);
    io.echo(`${lineOf(w.spec)} ${echoAs ?? typed}`, 'prompt');
    if (!got.ok) { io.echo(got.error, 'error'); io.prompt({ ...w.spec, command: running.cmd.name, line: lineOf(w.spec) }); return true; }
    if (typed && String(typed).trim()) { recent.unshift(String(typed).trim()); recent.splice(8); }
    waiting = null;
    io.prompt(null);
    w.resolve(got.value);
    return true;
  }

  async function run(word, args = []) {
    const cmd = findCommand(commands, word);
    if (!cmd) {
      io.echo(`Unknown command "${String(word).toUpperCase()}". Press F1 for help.`, 'error');
      return false;
    }
    if (running) cancel();
    // A command started while another winds down waits for it, so prompts never mix.
    if (running && running.promise) { try { await running.promise; } catch { /* cancelled */ } }
    io.echo(`Command: ${cmd.name}`, 'command');
    if (!cmd.noRepeat) last = cmd.name;
    queue = args.slice();
    const base = {
      name: cmd.name,
      echo: (t, kind) => io.echo(t, kind),
      number: (spec) => ask({ ...spec, type: 'number' }),
      point: (spec) => ask({ ...spec, type: 'point' }),
      text: (spec) => ask({ ...spec, type: 'text' }),
      keyword: (spec) => ask({ ...spec, type: 'keyword' }),
      leg: (spec) => ask({ ...spec, type: 'leg' }),
      moreTyped: () => queue.length > 0,
    };
    const ctx = context(base);
    const me = { cmd, promise: null };
    running = me;
    me.promise = (async () => {
      try {
        await cmd.run(ctx);
      } catch (e) {
        if (e instanceof Cancel) io.echo('*Cancel*', 'cancel');
        else { io.echo(e && e.message ? e.message : String(e), 'error'); console.error(e); }
      } finally {
        if (running === me) { running = null; waiting = null; queue = []; io.prompt(null); }
      }
    })();
    await me.promise;
    return true;
  }

  function cancel() {
    queue = [];
    if (waiting) {
      const w = waiting;
      waiting = null;
      io.prompt(null);
      w.reject(new Cancel());
      return true;
    }
    return false;
  }

  /** A line from the command line (Enter, or a space at the end of a word). */
  function submit(line) {
    if (waiting) {
      if (waiting.spec.type === 'text') return answer(line);
      const ws = words(line);
      if (!ws.length) return answer('');
      queue = ws.slice(1);
      return answer(ws[0]);
    }
    const ws = words(line);
    if (!ws.length) {
      if (last) run(last);
      return true;
    }
    run(ws[0], ws.slice(1));
    return true;
  }

  return {
    run, submit, cancel, answer,
    /** A point picked in the drawing answers a point prompt. */
    pick(point, label) {
      if (!waiting || waiting.spec.type !== 'point') return false;
      return answer(`${point.x.toFixed(2)},${point.y.toFixed(2)}`, { echoAs: label || `${point.x.toFixed(2)},${point.y.toFixed(2)}` });
    },
    /** A leg clicked in the drawing answers a leg prompt. */
    pickLeg(id, name) {
      if (!waiting || waiting.spec.type !== 'leg') return false;
      const w = waiting;
      waiting = null;
      io.prompt(null);
      io.echo(`${lineOf(w.spec)} ${name || id}`, 'prompt');
      w.resolve(id);
      return true;
    },
    waiting: () => (waiting ? waiting.spec : null),
    running: () => (running ? running.cmd.name : null),
    last: () => last,
    recent: () => recent.slice(),
  };
}
