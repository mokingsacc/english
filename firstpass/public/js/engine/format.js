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

export function mph(v) {
  return `${whole(v)} mph`;
}

export function ft(v) {
  return `${whole(v)} ft`;
}

/** A radius in ft, or "straight" when there is no curve. */
export function radius(r) {
  return r === Infinity || r === null || r === undefined ? 'straight' : `${whole(r)} ft`;
}

/** "the North leg" from a leg name. */
export function theLeg(name) {
  return /^the /i.test(name) ? name : `the ${name}`;
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
