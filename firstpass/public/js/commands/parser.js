// The command line's words, in the manner of a CAD command line, as pure functions (tests/page/commands.test.mjs): finding a command
// by name or alias, prompt text with options in square brackets and the shortcut letters in capitals ("[Undo/eXit]"),
// matching what she types against those options, numbers ("110", "110 ft", "110'"), points ("x,y" for easting and
// northing, "@dx,dy" from the last point) and the autocomplete list.

/** The shortcut of an option keyword: its capital letters ("eXit" gives "X", "Extents" gives "E", "pHoto" gives "H"). */
export function shortcutOf(kw) {
  const caps = String(kw).match(/[A-Z]+/g);
  return caps ? caps.join('') : String(kw).toUpperCase();
}

/** The option keyword she means by `input`, or null: its shortcut, or the start of the word at least that long. */
export function matchKeyword(keywords, input) {
  const s = String(input || '').trim().toUpperCase();
  if (!s || !keywords) return null;
  for (const kw of keywords) if (shortcutOf(kw) === s) return kw;
  for (const kw of keywords) {
    const full = kw.toUpperCase();
    if (full === s) return kw;
  }
  for (const kw of keywords) {
    const full = kw.toUpperCase();
    if (full.startsWith(s) && s.length >= shortcutOf(kw).length && full.indexOf(shortcutOf(kw)) < s.length) return kw;
  }
  return null;
}

/** A number typed at a prompt: "110", "110.5", "-3", "110ft", "110 ft", "110'". Null when it is not one. */
export function parseNumber(input) {
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+))\s*(?:ft|feet|foot|'|mph|deg|degrees?)?\s*$/i.exec(String(input ?? ''));
  return m ? Number(m[1]) : null;
}

/** A point typed at a prompt: "x,y" (easting, northing) or "@dx,dy" (from `base`). Null when it is not one. */
export function parsePoint(input, base) {
  const m = /^\s*(@)?\s*([-+]?(?:\d+\.?\d*|\.\d+))\s*,\s*([-+]?(?:\d+\.?\d*|\.\d+))\s*$/.exec(String(input ?? ''));
  if (!m) return null;
  const a = Number(m[2]), b = Number(m[3]);
  if (m[1]) return base ? { x: base.x + a, y: base.y + b } : null;
  return { x: a, y: b };
}

/** A default value as the prompt shows it: two decimals for numbers. */
export function showDefault(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return v.toFixed(2);
  return String(v);
}

/** The prompt line: "Specify inscribed circle diameter <130.00>:" or "Enter an option [Extents/Window] <Extents>:". */
export function formatPrompt({ text, keywords = [], def = null, join = ' or ' } = {}) {
  const opts = keywords.length ? `${join}[${keywords.join('/')}]` : '';
  const d = showDefault(def);
  return `${text}${opts}${d !== null ? ` <${d}>` : ''}:`;
}

/** The command named by `word` (its name or an alias, any case), or null. */
export function findCommand(list, word) {
  const w = String(word || '').trim().toUpperCase();
  if (!w) return null;
  return list.find((c) => c.name === w) || list.find((c) => (c.aliases || []).includes(w)) || null;
}

/**
 * The autocomplete list for what she has typed: commands whose name or an alias starts with it, an exact name or
 * alias first, then by name. [{ name, via, description }] where via is the alias that matched (or the name).
 */
export function suggest(list, typed, max = 8) {
  const w = String(typed || '').trim().toUpperCase();
  if (!w || /\s/.test(w)) return [];
  const out = [];
  for (const c of list) {
    if (c.hidden) continue;
    const words = [c.name, ...(c.aliases || [])];
    const via = words.find((x) => x === w) || words.find((x) => x.startsWith(w));
    if (via) out.push({ name: c.name, via, description: c.description || '', exact: via === w });
  }
  out.sort((a, b) => (b.exact - a.exact) || (a.name.length - b.name.length) || a.name.localeCompare(b.name));
  return out.slice(0, max);
}

/** Splits a typed line into words; a space ends a word as Enter does, as on a CAD command line. */
export function words(line) {
  return String(line || '').trim().split(/\s+/).filter(Boolean);
}
