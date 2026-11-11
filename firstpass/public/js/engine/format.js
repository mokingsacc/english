// Number formatting for the sentences the engine writes. Plain and the same everywhere (no locale).

/** Whole number with thousands separators: 26356 gives "26,356". */
export function whole(v) {
  if (!Number.isFinite(v)) return String(v);
  const r = Math.round(v);
  const s = String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return r < 0 ? `-${s}` : s;
}

/** Number with at most `places` decimals, trailing zeros dropped: 19.30 gives "19.3". */
export function num(v, places = 1) {
  if (!Number.isFinite(v)) return String(v);
  const f = 10 ** places;
  const r = Math.round(v * f) / f;
  if (Math.abs(r) >= 1000) return whole(r);
  return String(r);
}

/** A speed in whole miles per hour (limits and figures that are not compared). */
export function mph(v) {
  return `${whole(v)} mph`;
}

/**
 * A speed set against a limit or another speed, to one decimal: "25.2 mph". When one decimal would read the same as the
 * number it is set against while the two differ, two decimals: "25.04 mph, above the limit of 25 mph".
 */
export function mph1(v, against = null) {
  if (!Number.isFinite(v)) return String(v);
  let s = v.toFixed(1);
  if (against !== null && Number.isFinite(against) && Math.round(v * 100) !== Math.round(against * 100)
    && Number(s) === Math.round(against * 10) / 10) s = v.toFixed(2);
  return `${s} mph`;
}

export function ft(v) {
  return `${whole(v)} ft`;
}

/** A radius in ft, or "straight" when there is no curve. */
export function radius(r) {
  return r === Infinity || r === null || r === undefined ? 'straight' : `${whole(r)} ft`;
}

/** "a" or "an" before a number written out in figures: "an 80 ft radius", "a 65 ft radius". */
export function article(figures) {
  return /^(8|1[18](?!\d))/.test(String(figures)) ? 'an' : 'a';
}

/** "the North leg" from a leg name. */
export function theLeg(name) {
  return /^(the|leg)\b/i.test(name) ? name : `the ${name}`;
}

/** Join phrases as "a", "a and b", or "a, b and c". */
export function listing(parts) {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** Capitalise the first letter of a sentence. */
export function sentence(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
