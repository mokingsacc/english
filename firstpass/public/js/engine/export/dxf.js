// DXF export: an evaluate() result as an ASCII DXF drawing, version R2000 (AC1015), to open in her CAD program.
// Pure: no DOM, no Node APIs, no clock unless no date is given, so the page builds the file in her browser (it needs no
// server) and the Worker builds the same text for GET /api/projects/:id/export/<option>.dxf.
//
//   toDxf(result, { name, epsg, option, date?, units? }) -> string        checkDxf(text) -> { ok, problems, counts, layers }
//
// units: 'survey' (the default) marks the drawing in US survey feet ($INSUNITS 21), the unit of California's state plane
// grid, so it inserts at scale 1 into a drawing set to US survey feet; 'international' marks it in feet ($INSUNITS 2), for
// a drawing set to feet. The numbers are the same either way: state plane coordinates exactly as the engine gives them.
//
// Why R2000: it is the oldest version that carries what this drawing needs (the drawing units in feet, $INSUNITS, and
// light polylines whose bulges are true arcs), every program built on that CAD engine since 2000 opens it without a
// conversion step, and it needs none of the extra objects later versions expect. R12 has no units and no light
// polylines; R2004 and later add required objects and text rules for no gain here. The file is complete for R2000:
// every table with its standard entries, *Model_Space and *Paper_Space, the Model and Layout1 layouts, the plot style and
// multiline style dictionaries, handles and owners on everything, and $HANDSEED past the last handle.
//
// What is drawn, one layer per kind (LAYERS below): the curb, edge, centre, yield and exit lines and the inscribed circle
// as true LINE and ARC entities, one per primitive of the engine's chains (arcs are never chopped: DXF arcs run
// counterclockwise from the start angle to the end angle in degrees, so a clockwise chain arc is written from its end to
// its start); the central island, the truck apron's inner edge, each splitter island and the land take as closed light
// polylines whose arc segments are bulges (exact arcs; the polyline is one closed object, so its area and hatching work);
// the fastest paths as light polylines through the engine's points, with each fitted radius and its speed as TEXT; the
// sight triangles as closed polylines; and a short note naming the tool, the option, the zone and the date. Coordinates
// are state plane feet exactly as the engine gives them: no shift, no scale. Nothing else goes in: only the engine's
// result and the names given, never anything else of hers.

export const DXF_LAYERS = [
  // id: where it comes from; name: the layer; color: the CAD colour index
  { id: 'landtake', name: 'FP-LANDTAKE', color: 6, what: 'Land take outline' },
  { id: 'sight', name: 'FP-SIGHT', color: 200, what: 'Intersection sight triangles' },
  { id: 'inscribed', name: 'FP-INSCRIBED', color: 9, what: 'Inscribed circle' },
  { id: 'apron', name: 'FP-APRON', color: 30, what: 'Truck apron, inner edge' },
  { id: 'island', name: 'FP-ISLAND', color: 4, what: 'Central island' },
  { id: 'splitter', name: 'FP-SPLITTER', color: 3, what: 'Splitter islands' },
  { id: 'curb', name: 'FP-CURB', color: 7, what: 'Curbs' },
  { id: 'edge', name: 'FP-EDGE', color: 8, what: 'Edge lines' },
  { id: 'centerline', name: 'FP-CENTERLINE', color: 2, what: 'Centre lines' },
  { id: 'entrance', name: 'FP-YIELD', color: 7, what: 'Yield lines' },
  { id: 'exit', name: 'FP-EXIT', color: 8, what: 'Exit lines' },
  { id: 'path', name: 'FP-PATH', color: 1, what: 'Fastest paths' },
  { id: 'pathText', name: 'FP-PATH-TEXT', color: 7, what: 'Fastest path radii and speeds' },
  { id: 'note', name: 'FP-NOTE', color: 7, what: 'Note' },
];
const LAYER = Object.fromEntries(DXF_LAYERS.map((l) => [l.id, l.name]));
// Chain layers written as closed polylines (each run of the chain is one closed outline); the rest are LINE and ARC.
const CLOSED = new Set(['landtake', 'apron', 'island', 'splitter']);
const CHAIN_ORDER = ['landtake', 'inscribed', 'apron', 'island', 'splitter', 'curb', 'edge', 'centerline', 'entrance', 'exit'];

export const LABEL_HEIGHT = 2;    // ft: the radius and speed labels
export const NOTE_HEIGHT = 3;     // ft: the note
const JOIN = 1e-6;                // ft: chain primitives closer than this are joined
const ZONES = { 2225: 1, 2226: 2, 2227: 3, 2228: 4, 2229: 5, 2230: 6 };
/** The units a drawing can be marked in: the $INSUNITS code and the words for it. */
export const DXF_UNITS = {
  survey: { insunits: 21, words: 'US survey feet' },
  international: { insunits: 2, words: 'international feet' },
};
export const unitsOf = (units) => DXF_UNITS[units] || DXF_UNITS.survey;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TAU = 2 * Math.PI;

const refuse = (message) => Object.assign(new Error(message), { refused: true });

/** A number as DXF text: the shortest form that reads back to the same double, never with an exponent. */
export function num(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`The drawing has a number that is not finite (${v}).`);
  if (v === 0) return '0.0';
  let s = String(v);
  if (/e/i.test(s)) s = v.toFixed(12).replace(/0+$/, '').replace(/\.$/, '.0');
  else if (!s.includes('.')) s += '.0';
  return s === '-0.0' ? '0.0' : s;
}

/** Text for a TEXT entity or a name: one line, ASCII, with the few sequences DXF and TEXT treat specially escaped. */
export function dxfText(s) {
  return String(s ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\^/g, '^ ')
    .replace(/%%/g, '%%%%%%')
    .replace(/[^ -~]/gu, (c) => `\\U+${c.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')}`)
    .trim();
}

const angleOf = (c, p) => Math.atan2(p.y - c.y, p.x - c.x);
const wrap = (a) => ((a % TAU) + TAU) % TAU;
const deg = (a) => wrap(a) * (180 / Math.PI);
const near = (p, q, tol = JOIN) => Math.abs(p.x - q.x) <= tol && Math.abs(p.y - q.y) <= tol;

/** The sweep of a chain arc in radians, 0 to 2 pi, in its own direction (ccw or not). */
function sweepOf(p) {
  const a0 = angleOf(p.c, p.a), a1 = angleOf(p.c, p.b);
  return wrap(p.ccw ? a1 - a0 : a0 - a1);
}

/** A chain split into runs of primitives that carry on from one another; closed when the last ends where the first starts. */
export function runsOf(chain) {
  const runs = [];
  let cur = null;
  for (const p of chain || []) {
    if (!p || (p.type !== 'line' && p.type !== 'arc')) continue;
    if (cur && near(cur.prims[cur.prims.length - 1].b, p.a)) cur.prims.push(p);
    else { cur = { prims: [p] }; runs.push(cur); }
  }
  for (const r of runs) r.closed = r.prims.length > 1 && near(r.prims[r.prims.length - 1].b, r.prims[0].a);
  return runs;
}

/** The DXF arc for a chain arc: centre, radius, and start and end angles (degrees, counterclockwise from start to end). */
export function arcAngles(p) {
  return p.ccw ? { start: deg(angleOf(p.c, p.a)), end: deg(angleOf(p.c, p.b)) } : { start: deg(angleOf(p.c, p.b)), end: deg(angleOf(p.c, p.a)) };
}

/** The bulge of a chain arc as a polyline segment from p.a to p.b: tan(sweep / 4), negative when it turns clockwise. */
export function bulgeOf(p) {
  return (p.ccw ? 1 : -1) * Math.tan(sweepOf(p) / 4);
}

/** The date as the note writes it ("11 Nov 2026"), from a Date or "YYYY-MM-DD"; today (UTC) when none is given. */
function dateText(date) {
  const m = typeof date === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (m) return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function zoneWords(epsg) {
  const z = ZONES[epsg];
  return z ? `California state plane, CCS83 zone ${z} (EPSG ${epsg}), US survey feet` : `the coordinate system EPSG ${epsg}, in feet`;
}

const r1 = (v) => (Math.round(v * 10) / 10).toFixed(1);

/** The label of one fitted path arc: "R1 99.6 ft, V1 20.3 mph". */
export function pathLabel(name, arc) {
  const r = arc.r === Infinity || !Number.isFinite(arc.r) ? 'straight' : `${r1(arc.r)} ft`;
  const v = typeof arc.speed === 'number' && Number.isFinite(arc.speed) ? `, V${name.slice(1)} ${r1(arc.speed)} mph` : '';
  return `${name} ${r}${v}`;
}

/** The radius and speed labels of every movement: one per fitted arc, the same words at the same place written once,
 * and a label that would sit on another moved down a line until it is clear. [{ text, x, y, movement, arc }] */
export function pathLabels(result) {
  const out = [];
  const step = LABEL_HEIGHT * 1.5;
  for (const m of result.movements || []) {
    if (!m.ok || !m.arcs) continue;
    for (const name of Object.keys(m.arcs).sort()) {
      const a = m.arcs[name];
      if (!a || !a.mid || !Number.isFinite(a.mid.x) || !Number.isFinite(a.mid.y)) continue;
      const text = pathLabel(name, a);
      if (out.some((l) => l.text === text && Math.hypot(l.ax - a.mid.x, l.ay - a.mid.y) < step)) continue;
      let y = a.mid.y;
      while (out.some((l) => Math.abs(l.x - a.mid.x) < text.length * LABEL_HEIGHT * 0.8 && Math.abs(l.y - y) < step * 0.9)) y -= step;
      out.push({ text, x: a.mid.x, y, ax: a.mid.x, ay: a.mid.y, movement: m.id, arc: name });
    }
  }
  return out.map(({ text, x, y, movement, arc }) => ({ text, x, y, movement, arc }));
}

/** Every entity of the drawing, in the order written: [{ kind: 'LINE'|'ARC'|'LWPOLYLINE'|'TEXT', layer, ... }]. */
export function dxfEntities(result, { name = 'First Pass project', epsg = 2226, option = null, date, units = 'survey' } = {}) {
  if (!result || typeof result !== 'object') throw refuse('There is no worked-out roundabout to export.');
  if (!result.ok || !result.geometry) {
    const why = (result.problems && result.problems[0]) || 'the shape cannot be built';
    throw refuse(`This option cannot be built, so there is no drawing to export. ${why}`);
  }
  const G = result.geometry;
  const ents = [];
  const chainEnts = (id) => {
    for (const run of runsOf((G.layers || {})[id])) {
      if (CLOSED.has(id) && run.closed) {
        ents.push({ kind: 'LWPOLYLINE', layer: LAYER[id], closed: true, from: id, verts: run.prims.map((p) => ({ x: p.a.x, y: p.a.y, bulge: p.type === 'arc' ? bulgeOf(p) : 0 })), prims: run.prims });
        continue;
      }
      for (const p of run.prims) {
        if (p.type === 'line') ents.push({ kind: 'LINE', layer: LAYER[id], from: id, a: p.a, b: p.b, prim: p });
        else if (sweepOf(p) > 0) ents.push({ kind: 'ARC', layer: LAYER[id], from: id, c: p.c, r: p.r, ...arcAngles(p), prim: p });
      }
    }
  };
  chainEnts('landtake');
  for (const t of G.sightTriangles || []) {
    const pts = (t.polygon || []).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y));
    if (pts.length > 1 && near(pts[0], pts[pts.length - 1])) pts.pop();
    if (pts.length >= 3) ents.push({ kind: 'LWPOLYLINE', layer: LAYER.sight, closed: true, from: 'sight', verts: pts.map((p) => ({ x: p.x, y: p.y, bulge: 0 })), triangle: t });
  }
  for (const id of CHAIN_ORDER.slice(1)) chainEnts(id);
  for (const m of result.movements || []) {
    if (!m.ok || !m.path || !(m.path.n >= 2)) continue;
    const verts = [];
    for (let k = 0; k < m.path.n; k++) verts.push({ x: m.path.x[k], y: m.path.y[k], bulge: 0 });
    ents.push({ kind: 'LWPOLYLINE', layer: LAYER.path, closed: false, from: 'path', verts, movement: m.id });
  }
  for (const l of pathLabels(result)) ents.push({ kind: 'TEXT', layer: LAYER.pathText, x: l.x, y: l.y, height: LABEL_HEIGHT, text: l.text, movement: l.movement, arc: l.arc });

  // The note, above the drawing's top left corner.
  const box = extentsOf(ents);
  const opt = option && typeof option === 'object' ? option : { name: option ? String(option) : 'the option' };
  const optName = opt.name || (opt.id ? `Option ${opt.id}` : 'the option');
  const lines = [
    `First Pass roundabout sketch: ${optName} of ${name}.`,
    `Coordinates: ${zoneWords(epsg)}, exactly as First Pass gives them, with no shift or scale.${units === 'international' ? ' The drawing units are set to international feet, for a drawing set to feet.' : ''}`,
    `Made ${dateText(date)}. Layers start with FP. A first look for testing ideas: check it before you build on it.`,
  ];
  const lead = NOTE_HEIGHT * 1.7;
  lines.forEach((text, i) => ents.push({ kind: 'TEXT', layer: LAYER.note, x: box.x0, y: box.y1 + lead * (lines.length - i), height: NOTE_HEIGHT, text }));
  return ents;
}

/** The box around a list of entities (arcs by their true extremes; text by an allowance of 0.8 of its height a letter). */
export function extentsOf(ents) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x, y) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; };
  const arcBox = (c, r, start, end) => {
    const s = start, sw = ((end - start) % 360 + 360) % 360 || 360;
    const at = (t) => grow(c.x + r * Math.cos((t * Math.PI) / 180), c.y + r * Math.sin((t * Math.PI) / 180));
    at(s); at(s + sw);
    for (let q = Math.ceil(s / 90) * 90; q < s + sw; q += 90) at(q);
  };
  for (const e of ents) {
    if (e.kind === 'LINE') { grow(e.a.x, e.a.y); grow(e.b.x, e.b.y); }
    else if (e.kind === 'ARC') arcBox(e.c, e.r, e.start, e.end);
    else if (e.kind === 'LWPOLYLINE') {
      e.verts.forEach((v, i) => {
        grow(v.x, v.y);
        if (!v.bulge || (!e.closed && i === e.verts.length - 1)) return;
        const w = e.verts[(i + 1) % e.verts.length];
        const a = bulgeArc(v, w, v.bulge);
        if (a.ccw) arcBox(a.c, a.r, deg(angleOf(a.c, v)), deg(angleOf(a.c, w)));
        else arcBox(a.c, a.r, deg(angleOf(a.c, w)), deg(angleOf(a.c, v)));
      });
    } else if (e.kind === 'TEXT') { grow(e.x, e.y); grow(e.x + e.text.length * e.height * 0.8, e.y + e.height); }
  }
  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 0, y1: 0 };
  return { x0, y0, x1, y1 };
}

/** The circle of a polyline segment from p to q with bulge b: { c, r, ccw }. */
export function bulgeArc(p, q, b) {
  const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
  const k = (1 - b * b) / (4 * b);       // the centre's offset from the chord's middle, in chord lengths, to the left
  return { c: { x: (p.x + q.x) / 2 - dy * k, y: (p.y + q.y) / 2 + dx * k }, r: (d * (1 + b * b)) / (4 * Math.abs(b)), ccw: b > 0 };
}

/** The drawing as DXF R2000 text. Throws an Error with refused: true and a plain sentence when there is nothing to draw. */
export function toDxf(result, opts = {}) {
  const ents = dxfEntities(result, opts);
  const box = extentsOf(ents);
  let next = 0;
  const h = () => (++next).toString(16).toUpperCase();
  const out = [];
  const put = (code, value) => { out.push(String(code).padStart(3, ' '), String(value)); };
  const xy = (cx, cy, p, z = true) => { put(cx, num(p.x)); put(cy, num(p.y)); if (z) put(cx + 20, '0.0'); };

  // Handles: tables, their entries, the blocks, and the objects first; then one per entity.
  const T = { VPORT: h(), LTYPE: h(), LAYER: h(), STYLE: h(), VIEW: h(), UCS: h(), APPID: h(), DIMSTYLE: h(), BLOCK_RECORD: h() };
  const O = { root: h(), groups: h(), layouts: h(), mlstyles: h(), plotsettings: h(), plotstyles: h(), normal: h(), mlStandard: h(), model: h(), layout1: h() };
  const R = { vport: h(), byBlock: h(), byLayer: h(), continuous: h(), style: h(), acad: h(), dim: h(), msRec: h(), psRec: h(), msBlock: h(), msEnd: h(), psBlock: h(), psEnd: h() };
  const layerH = [['0', 7, h()], ...DXF_LAYERS.map((l) => [l.name, l.color, h()])];
  const entH = ents.map(() => h());
  const seed = h();

  // ---- HEADER
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  put(0, 'SECTION'); put(2, 'HEADER');
  put(9, '$ACADVER'); put(1, 'AC1015');
  put(9, '$DWGCODEPAGE'); put(3, 'ANSI_1252');
  put(9, '$INSBASE'); xy(10, 20, { x: 0, y: 0 });
  put(9, '$EXTMIN'); xy(10, 20, { x: box.x0, y: box.y0 });
  put(9, '$EXTMAX'); xy(10, 20, { x: box.x1, y: box.y1 });
  put(9, '$LIMMIN'); xy(10, 20, { x: box.x0, y: box.y0 }, false);
  put(9, '$LIMMAX'); xy(10, 20, { x: box.x1, y: box.y1 }, false);
  put(9, '$TEXTSIZE'); put(40, num(LABEL_HEIGHT));
  put(9, '$TEXTSTYLE'); put(7, 'Standard');
  put(9, '$CLAYER'); put(8, '0');
  put(9, '$LUNITS'); put(70, 2);
  put(9, '$LUPREC'); put(70, 3);
  put(9, '$ANGBASE'); put(50, '0.0');
  put(9, '$ANGDIR'); put(70, 0);
  put(9, '$TILEMODE'); put(70, 1);
  put(9, '$MEASUREMENT'); put(70, 0);
  put(9, '$INSUNITS'); put(70, unitsOf(opts.units).insunits);
  put(9, '$HANDSEED'); put(5, seed);
  put(0, 'ENDSEC');

  // ---- CLASSES (the object types of the OBJECTS section that are classes in R2000)
  put(0, 'SECTION'); put(2, 'CLASSES');
  for (const [dxf, cpp] of [['ACDBDICTIONARYWDFLT', 'AcDbDictionaryWithDefault'], ['ACDBPLACEHOLDER', 'AcDbPlaceHolder'], ['LAYOUT', 'AcDbLayout']]) {
    put(0, 'CLASS'); put(1, dxf); put(2, cpp); put(3, 'ObjectDBX Classes'); put(90, 0); put(280, 0); put(281, 0);
  }
  put(0, 'ENDSEC');

  // ---- TABLES
  const table = (name, handle, count, body, extra = null) => {
    put(0, 'TABLE'); put(2, name); put(5, handle); put(330, 0); put(100, 'AcDbSymbolTable'); put(70, count);
    if (extra) extra();
    body();
    put(0, 'ENDTAB');
  };
  const record = (type, handle, owner, sub, codeForHandle = 5) => {
    put(0, type); put(codeForHandle, handle); put(330, owner); put(100, 'AcDbSymbolTableRecord'); put(100, sub);
  };
  put(0, 'SECTION'); put(2, 'TABLES');
  table('VPORT', T.VPORT, 1, () => {
    const aspect = 1.6;
    const height = Math.max(box.y1 - box.y0, (box.x1 - box.x0) / aspect, 10) * 1.1;
    record('VPORT', R.vport, T.VPORT, 'AcDbViewportTableRecord');
    put(2, '*Active'); put(70, 0);
    xy(10, 20, { x: 0, y: 0 }, false); xy(11, 21, { x: 1, y: 1 }, false);
    xy(12, 22, { x: cx, y: cy }, false);
    xy(13, 23, { x: 0, y: 0 }, false); xy(14, 24, { x: 1, y: 1 }, false); xy(15, 25, { x: 10, y: 10 }, false);
    put(16, '0.0'); put(26, '0.0'); put(36, '1.0');
    put(17, '0.0'); put(27, '0.0'); put(37, '0.0');
    put(40, num(height)); put(41, num(aspect)); put(42, '50.0'); put(43, '0.0'); put(44, '0.0'); put(50, '0.0'); put(51, '0.0');
    put(71, 0); put(72, 1000); put(73, 1); put(74, 3); put(75, 0); put(76, 0); put(77, 0); put(78, 0);
  });
  table('LTYPE', T.LTYPE, 3, () => {
    for (const [nm, hh, desc] of [['ByBlock', R.byBlock, ''], ['ByLayer', R.byLayer, ''], ['Continuous', R.continuous, 'Solid line']]) {
      record('LTYPE', hh, T.LTYPE, 'AcDbLinetypeTableRecord');
      put(2, nm); put(70, 0); put(3, desc); put(72, 65); put(73, 0); put(40, '0.0');
    }
  });
  table('LAYER', T.LAYER, layerH.length, () => {
    for (const [nm, color, hh] of layerH) {
      record('LAYER', hh, T.LAYER, 'AcDbLayerTableRecord');
      put(2, nm); put(70, 0); put(62, color); put(6, 'Continuous'); put(370, -3); put(390, O.normal);
    }
  });
  table('STYLE', T.STYLE, 1, () => {
    record('STYLE', R.style, T.STYLE, 'AcDbTextStyleTableRecord');
    put(2, 'Standard'); put(70, 0); put(40, '0.0'); put(41, '1.0'); put(50, '0.0'); put(71, 0); put(42, num(LABEL_HEIGHT)); put(3, 'txt'); put(4, '');
  });
  table('VIEW', T.VIEW, 0, () => {});
  table('UCS', T.UCS, 0, () => {});
  table('APPID', T.APPID, 1, () => {
    record('APPID', R.acad, T.APPID, 'AcDbRegAppTableRecord');
    put(2, 'ACAD'); put(70, 0);
  });
  table('DIMSTYLE', T.DIMSTYLE, 1, () => {
    record('DIMSTYLE', R.dim, T.DIMSTYLE, 'AcDbDimStyleTableRecord', 105);
    put(2, 'Standard'); put(70, 0);
  }, () => put(100, 'AcDbDimStyleTable'));
  table('BLOCK_RECORD', T.BLOCK_RECORD, 2, () => {
    record('BLOCK_RECORD', R.msRec, T.BLOCK_RECORD, 'AcDbBlockTableRecord'); put(2, '*Model_Space'); put(340, O.model);
    record('BLOCK_RECORD', R.psRec, T.BLOCK_RECORD, 'AcDbBlockTableRecord'); put(2, '*Paper_Space'); put(340, O.layout1);
  });
  put(0, 'ENDSEC');

  // ---- BLOCKS
  put(0, 'SECTION'); put(2, 'BLOCKS');
  for (const [nm, rec, b, e] of [['*Model_Space', R.msRec, R.msBlock, R.msEnd], ['*Paper_Space', R.psRec, R.psBlock, R.psEnd]]) {
    put(0, 'BLOCK'); put(5, b); put(330, rec); put(100, 'AcDbEntity'); put(8, '0'); put(100, 'AcDbBlockBegin');
    put(2, nm); put(70, 0); xy(10, 20, { x: 0, y: 0 }); put(3, nm); put(1, '');
    put(0, 'ENDBLK'); put(5, e); put(330, rec); put(100, 'AcDbEntity'); put(8, '0'); put(100, 'AcDbBlockEnd');
  }
  put(0, 'ENDSEC');

  // ---- ENTITIES
  put(0, 'SECTION'); put(2, 'ENTITIES');
  ents.forEach((e, i) => {
    put(0, e.kind); put(5, entH[i]); put(330, R.msRec); put(100, 'AcDbEntity'); put(8, e.layer);
    if (e.kind === 'LINE') {
      put(100, 'AcDbLine'); xy(10, 20, e.a); xy(11, 21, e.b);
    } else if (e.kind === 'ARC') {
      put(100, 'AcDbCircle'); xy(10, 20, e.c); put(40, num(e.r)); put(100, 'AcDbArc'); put(50, num(e.start)); put(51, num(e.end));
    } else if (e.kind === 'LWPOLYLINE') {
      put(100, 'AcDbPolyline'); put(90, e.verts.length); put(70, e.closed ? 1 : 0);
      for (const v of e.verts) { put(10, num(v.x)); put(20, num(v.y)); if (v.bulge) put(42, num(v.bulge)); }
    } else if (e.kind === 'TEXT') {
      put(100, 'AcDbText'); xy(10, 20, e); put(40, num(e.height)); put(1, dxfText(e.text)); put(7, 'Standard'); put(100, 'AcDbText');
    }
  });
  put(0, 'ENDSEC');

  // ---- OBJECTS: the named object dictionary and what R2000 expects in it
  put(0, 'SECTION'); put(2, 'OBJECTS');
  const dict = (handle, owner, entries, hard = 1) => {
    put(0, 'DICTIONARY'); put(5, handle); put(330, owner); put(100, 'AcDbDictionary'); put(281, hard);
    for (const [k, v] of entries) { put(3, k); put(350, v); }
  };
  dict(O.root, 0, [['ACAD_GROUP', O.groups], ['ACAD_LAYOUT', O.layouts], ['ACAD_MLINESTYLE', O.mlstyles], ['ACAD_PLOTSETTINGS', O.plotsettings], ['ACAD_PLOTSTYLENAME', O.plotstyles]], 0);
  dict(O.groups, O.root, []);
  dict(O.layouts, O.root, [['Layout1', O.layout1], ['Model', O.model]]);
  dict(O.mlstyles, O.root, [['Standard', O.mlStandard]]);
  dict(O.plotsettings, O.root, []);
  put(0, 'ACDBDICTIONARYWDFLT'); put(5, O.plotstyles); put(330, O.root); put(100, 'AcDbDictionary'); put(281, 1);
  put(3, 'Normal'); put(350, O.normal); put(100, 'AcDbDictionaryWithDefault'); put(340, O.normal);
  put(0, 'ACDBPLACEHOLDER'); put(5, O.normal); put(330, O.plotstyles);
  put(0, 'MLINESTYLE'); put(5, O.mlStandard); put(102, '{ACAD_REACTORS'); put(330, O.mlstyles); put(102, '}'); put(330, O.mlstyles);
  put(100, 'AcDbMlineStyle'); put(2, 'Standard'); put(70, 0); put(3, ''); put(62, 256); put(51, '90.0'); put(52, '90.0'); put(71, 2);
  put(49, '0.5'); put(62, 256); put(6, 'BYLAYER'); put(49, '-0.5'); put(62, 256); put(6, 'BYLAYER');
  for (const [nm, hh, rec, tab, flags] of [['Model', O.model, R.msRec, 0, 1024], ['Layout1', O.layout1, R.psRec, 1, 0]]) {
    put(0, 'LAYOUT'); put(5, hh); put(102, '{ACAD_REACTORS'); put(330, O.layouts); put(102, '}'); put(330, O.layouts);
    // Plot settings: no plotter, ISO A3 paper in millimetres (the program's own empty-layout values); she sets her sheets.
    put(100, 'AcDbPlotSettings'); put(1, ''); put(4, 'A3'); put(6, '');
    put(40, '7.5'); put(41, '20.0'); put(42, '7.5'); put(43, '20.0'); put(44, '420.0'); put(45, '297.0');
    for (const c of [46, 47, 48, 49, 140, 141]) put(c, '0.0');
    put(142, '1.0'); put(143, '1.0'); put(70, flags); put(72, 1); put(73, 0); put(74, 5); put(7, ''); put(75, 16); put(147, '1.0'); put(148, '0.0'); put(149, '0.0');
    put(100, 'AcDbLayout'); put(1, nm); put(70, 1); put(71, tab);
    put(10, '0.0'); put(20, '0.0'); put(11, '420.0'); put(21, '297.0');
    put(12, '0.0'); put(22, '0.0'); put(32, '0.0');
    if (tab === 0) { xy(14, 24, { x: box.x0, y: box.y0 }); xy(15, 25, { x: box.x1, y: box.y1 }); }
    else { put(14, '1.0E+20'); put(24, '1.0E+20'); put(34, '1.0E+20'); put(15, '-1.0E+20'); put(25, '-1.0E+20'); put(35, '-1.0E+20'); }
    put(146, '0.0'); put(13, '0.0'); put(23, '0.0'); put(33, '0.0');
    put(16, '1.0'); put(26, '0.0'); put(36, '0.0'); put(17, '0.0'); put(27, '1.0'); put(37, '0.0');
    put(76, 0); put(330, rec);
  }
  put(0, 'ENDSEC');
  put(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}

/** A well-formedness check of DXF text, for Check myself and the tests: group codes and values in pairs, the six
 * sections in order, EOF at the end, unique handles below $HANDSEED, every entity on a layer of the LAYER table, every
 * number finite. { ok, problems: [plain sentences], counts: { LINE, ARC, LWPOLYLINE, TEXT }, layers: [names] } */
export function checkDxf(text) {
  const problems = [];
  const lines = String(text || '').split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  if (lines.length % 2) problems.push('The file does not hold group codes and values in pairs.');
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isInteger(code) || !/^\s*-?\d+$/.test(lines[i])) { problems.push(`Line ${i + 1} is not a group code.`); break; }
    pairs.push([code, lines[i + 1]]);
  }
  const counts = { LINE: 0, ARC: 0, LWPOLYLINE: 0, TEXT: 0 };
  const sections = [], layers = [], handles = new Set(), usedLayers = new Set();
  let section = null, seed = null, inLayerTable = false, prev = null, entity = null;
  for (const [code, v] of pairs) {
    if (code === 0) {
      entity = v;
      if (v === 'SECTION') section = 'next';
      else if (v === 'ENDSEC') section = null;
      else if (section === 'ENTITIES' && v in counts) counts[v]++;
      if (v === 'TABLE') inLayerTable = false;
    }
    if (code === 2 && section === 'next') { section = v; sections.push(v); }
    if (code === 2 && entity === 'TABLE' && v === 'LAYER') inLayerTable = true;
    if (code === 2 && inLayerTable && entity === 'LAYER') layers.push(v);
    if (code === 8 && section === 'ENTITIES') usedLayers.add(v);
    if ((code === 5 || code === 105) && entity !== null) {
      if (prev && prev[0] === 9 && prev[1] === '$HANDSEED') seed = parseInt(v, 16);
      else if (handles.has(v)) problems.push(`The handle ${v} is used twice.`);
      else handles.add(v);
    }
    if (((code >= 10 && code <= 59) || (code >= 140 && code <= 149)) && !Number.isFinite(Number(v))) problems.push(`A number is not finite: ${v}.`);
    prev = [code, v];
  }
  const want = ['HEADER', 'CLASSES', 'TABLES', 'BLOCKS', 'ENTITIES', 'OBJECTS'];
  if (sections.join() !== want.join()) problems.push(`The sections are ${sections.join(', ') || 'missing'}, not ${want.join(', ')}.`);
  if (!pairs.length || pairs[pairs.length - 1][0] !== 0 || pairs[pairs.length - 1][1] !== 'EOF') problems.push('The file does not end with EOF.');
  if (!/^\s*0\s*$/.test(lines[0] || '') || lines[1] !== 'SECTION') problems.push('The file does not start with a section.');
  const maxHandle = Math.max(0, ...[...handles].map((x) => parseInt(x, 16)));
  if (seed === null || !(seed > maxHandle)) problems.push('$HANDSEED is missing or not past the last handle.');
  for (const l of usedLayers) if (!layers.includes(l)) problems.push(`The layer ${l} is used but not in the layer table.`);
  if (counts.LINE + counts.ARC + counts.LWPOLYLINE === 0) problems.push('The drawing has nothing in it.');
  return { ok: !problems.length, problems: [...new Set(problems)].slice(0, 8), counts, layers };
}

/** The export part (export/index.js lists it): the DXF drawing of an option. */
export default {
  id: 'dxf',
  label: 'DXF drawing',
  ext: 'dxf',
  mime: 'application/dxf',
  build: toDxf,
  check: checkDxf,
};
