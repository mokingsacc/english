// What the drawing is made of, for picking and zooming: every primitive of an evaluate result with the object that owns
// it ('round' for the circle and its islands, 'leg:<id>' for a leg's curbs, splitter island and lines), the named points
// object snap can catch, and the extents box. Pure; built once per result and cached on it.
//
// A primitive belongs to a leg when its ends are that leg's named points (geometry.legs[i]); arcs on the circle between
// two legs belong to the roundabout. A new pickable layer: add its name to LEG_LAYERS or ROUND_LAYERS.

import { primBox } from '../draw/hit.js';
import { boxOf } from '../draw/camera.js';

const LEG_LAYERS = ['splitter', 'centerline', 'entrance', 'exit', 'curb', 'edge'];
const ROUND_LAYERS = ['island', 'apron', 'inscribed'];
const NAMED = ['nose', 'Se', 'Sx', 'T1', 'T2', 'T1x', 'T2x', 'F', 'Fx', 'far', 'farIn', 'farOut', 'entranceMid', 'exitMid'];
const SNAP_KIND = { entranceMid: 'mid', exitMid: 'mid' };
const cache = new WeakMap();

const keyOf = (p) => `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;

export function legKey(id) { return `leg:${id}`; }
export function legIdOf(key) { return typeof key === 'string' && key.startsWith('leg:') ? key.slice(4) : null; }

/** The index of a result: { items: [{prim, key, rank, layer}], snaps: [{x, y, kind, key}], extents, legBox(id) }. */
export function indexOf(result) {
  if (!result || !result.ok || !result.geometry) return null;
  let ix = cache.get(result);
  if (!ix) { ix = build(result); cache.set(result, ix); }
  return ix;
}

function build(result) {
  const G = result.geometry;
  const C = G.center;
  const Ri = G.radii.inscribed;
  const owner = new Map();
  for (const L of G.legs) for (const n of NAMED) if (L[n]) owner.set(keyOf(L[n]), L.id);
  const onCircle = (p) => p.type === 'arc' && Math.abs(p.c.x - C.x) < 0.01 && Math.abs(p.c.y - C.y) < 0.01;
  const byBearing = (p) => {
    const mx = (p.a.x + p.b.x) / 2 - C.x, my = (p.a.y + p.b.y) / 2 - C.y;
    let b = (Math.atan2(mx, my) * 180) / Math.PI;
    if (b < 0) b += 360;
    let best = null, bd = Infinity;
    for (const L of G.legs) {
      const d = Math.abs(((b - L.bearing + 540) % 360) - 180);
      if (d < bd) { bd = d; best = L.id; }
    }
    return best;
  };
  const items = [];
  for (const layer of LEG_LAYERS) {
    for (const prim of G.layers[layer] || []) {
      const la = owner.get(keyOf(prim.a)), lb = owner.get(keyOf(prim.b));
      let key;
      if (la && la === lb) key = legKey(la);
      else if (onCircle(prim) && Math.abs(prim.r - Ri) < 0.01) key = 'round';
      else key = legKey(la || lb || byBearing(prim));
      items.push({ prim, key, rank: key === 'round' ? 1 : 0, layer });
    }
  }
  for (const layer of ROUND_LAYERS) for (const prim of G.layers[layer] || []) items.push({ prim, key: 'round', rank: 1, layer });

  const snaps = [{ x: C.x, y: C.y, kind: 'center', key: 'round' }];
  for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) snaps.push({ x: C.x + dx * Ri, y: C.y + dy * Ri, kind: 'quadrant', key: 'round' });
  for (const L of G.legs) {
    for (const n of NAMED) if (L[n] && n !== 'far' && n !== 'farIn' && n !== 'farOut') snaps.push({ x: L[n].x, y: L[n].y, kind: SNAP_KIND[n] || 'end', key: legKey(L.id) });
  }

  const pts = [];
  for (const p of G.layers.landtake || []) { const b = primBox(p); pts.push({ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y1 }); }
  for (const L of G.legs) pts.push(along(L, 140));
  pts.push({ x: C.x - Ri, y: C.y - Ri }, { x: C.x + Ri, y: C.y + Ri });
  const extents = boxOf(pts, 10);

  const legBoxes = new Map();
  for (const it of items) {
    if (it.key === 'round') continue;
    const b = primBox(it.prim);
    const id = it.key.slice(4);
    const cur = legBoxes.get(id);
    // A leg's own box stops at its approach: the 250 ft lead lines would make "zoom to" show far too much road.
    if (it.layer === 'edge' || it.layer === 'centerline') continue;
    legBoxes.set(id, cur ? { x0: Math.min(cur.x0, b.x0), y0: Math.min(cur.y0, b.y0), x1: Math.max(cur.x1, b.x1), y1: Math.max(cur.y1, b.y1) } : b);
  }
  return {
    items, snaps, extents,
    legBox(id) { const b = legBoxes.get(id); return b ? grow(b, 20) : null; },
    roundBox() { return boxOf([{ x: C.x - Ri, y: C.y - Ri }, { x: C.x + Ri, y: C.y + Ri }], 30); },
  };
}

/** A point `d` feet beyond a leg's splitter island nose, along the leg. */
export function along(L, d) {
  const dx = L.far.x - L.nose.x, dy = L.far.y - L.nose.y;
  const n = Math.hypot(dx, dy) || 1;
  return { x: L.nose.x + (dx / n) * d, y: L.nose.y + (dy / n) * d };
}

function grow(b, g) {
  return { x0: b.x0 - g, y0: b.y0 - g, x1: b.x1 + g, y1: b.y1 + g };
}

/** The extents of a roundabout that cannot be built yet (no geometry): its circle and some road around it. */
export function roughExtents(round) {
  const r = (round && round.icd ? round.icd / 2 : 65) + 180;
  const c = (round && round.center) || { x: 0, y: 0 };
  return { x0: c.x - r, y0: c.y - r, x1: c.x + r, y1: c.y + r };
}

/** The world box of a check's `where` ({legs, movements, points, polygons}) in a result, or null. */
export function whereBox(result, where) {
  const ix = indexOf(result);
  if (!ix || !where) return null;
  const pts = [];
  for (const id of where.legs || []) { const b = ix.legBox(id); if (b) pts.push({ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y1 }); }
  for (const id of where.movements || []) {
    const m = result.movements.find((q) => q.id === id);
    if (m && m.path) for (let i = 0; i < m.path.n; i += 4) pts.push({ x: m.path.x[i], y: m.path.y[i] });
    else if (m && m.place) pts.push(m.place);
  }
  for (const p of where.points || []) pts.push(p);
  for (const poly of where.polygons || []) for (const p of poly) pts.push(p);
  return boxOf(pts, 25);
}
