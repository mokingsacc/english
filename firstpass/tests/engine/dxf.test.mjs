// The DXF export (public/js/engine/export/dxf.js) read back with a parser written here: every LINE, ARC and polyline
// against the engine's chains to 1e-6 ft (ends, centres, radii, arc directions), arcs ending on the chain ends, closed
// islands, the paths and their labels, sight triangles, the land take (its area too), the header (version, units in
// feet, extents that hold everything, handles), the layers, the note, byte-stable output, and the refusals. The numbers
// compared are whatever evaluate() answers now, never the engine's defaults. An outside check runs ezdxf's audit when
// FP_EZDXF_PYTHON names a Python that has ezdxf (CLAUDE.md, Commands).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { evaluate } from '../../public/js/engine/evaluate.js';
import { defaultRoundabout, defaultLeg } from '../../public/js/engine/roundabout/model.js';
import { toDxf, checkDxf, DXF_LAYERS, num, dxfText } from '../../public/js/engine/export/dxf.js';
import { EXPORTS, exportById, exportForFile, exportFileName } from '../../public/js/engine/export/index.js';

const TOL = 1e-6;
const OPTS = { name: 'Sample roundabout', epsg: 2226, option: { id: 'A', name: 'Option A' }, date: '2026-11-11' };

// ---------------------------------------------------------------- shapes (compared with what evaluate gives now)

function sampleShape() {
  const r = defaultRoundabout();
  r.center = { x: 6636072.770088, y: 1976790.232075 };
  return r;
}
function skewShape() {
  const r = defaultRoundabout();
  r.center = { x: 6250123.4567, y: 2101234.5678 };
  r.legs = [0, 75, 180, 255].map((b) => defaultLeg(b));
  r.legs[0].offsetLeft = 4;
  r.legs[2].offsetLeft = -3;
  return r;
}
function threeLegShape() {
  const r = defaultRoundabout();
  r.legs = [10, 100, 280].map((b) => defaultLeg(b));
  return r;
}
const SHAPES = { sample: sampleShape, skew: skewShape, three: threeLegShape };
const built = Object.fromEntries(Object.entries(SHAPES).map(([k, f]) => [k, evaluate(f(), {})]).filter(([, r]) => r.ok));

// ---------------------------------------------------------------- a DXF reader of our own

function parse(text) {
  assert.ok(text.endsWith('\r\n'), 'lines end with CR LF');
  const lines = text.split('\r\n');
  lines.pop();
  assert.equal(lines.length % 2, 0, 'codes and values come in pairs');
  const pairs = [];
  for (let i = 0; i < lines.length; i += 2) {
    assert.match(lines[i], /^ {0,2}-?\d{1,4}$/, `line ${i + 1} is a group code`);
    pairs.push([Number(lines[i]), lines[i + 1]]);
  }
  const sections = {};
  let cur = null;
  for (let i = 0; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === 0 && v === 'SECTION') { cur = pairs[i + 1][1]; sections[cur] = []; i++; continue; }
    if (c === 0 && v === 'ENDSEC') { cur = null; continue; }
    if (cur) sections[cur].push([c, v]);
  }
  const groups = (list) => {
    const out = [];
    for (const [c, v] of list) {
      if (c === 0) out.push({ type: v, pairs: [] });
      else if (out.length) out[out.length - 1].pairs.push([c, v]);
    }
    return out.map((e) => ({
      ...e,
      get: (code) => { const p = e.pairs.find((q) => q[0] === code); return p ? p[1] : undefined; },
      num: (code) => Number(e.pairs.find((q) => q[0] === code)[1]),
      all: (code) => e.pairs.filter((q) => q[0] === code).map((q) => q[1]),
    }));
  };
  const header = {};
  let name = null;
  for (const [c, v] of sections.HEADER) {
    if (c === 9) { name = v; header[name] = {}; } else header[name][c] = v;
  }
  const entities = groups(sections.ENTITIES);
  for (const e of entities) {
    if (e.type !== 'LWPOLYLINE') continue;
    e.verts = [];
    for (const [c, v] of e.pairs) {
      if (c === 10) e.verts.push({ x: Number(v), y: NaN, bulge: 0 });
      else if (c === 20) e.verts[e.verts.length - 1].y = Number(v);
      else if (c === 42) e.verts[e.verts.length - 1].bulge = Number(v);
    }
  }
  return { pairs, sections, header, entities, tables: groups(sections.TABLES), objects: groups(sections.OBJECTS), last: pairs[pairs.length - 1] };
}

const close = (a, b, msg) => assert.ok(Math.abs(a - b) <= TOL, `${msg}: ${a} is not within ${TOL} of ${b}`);
const closePt = (p, q, msg) => { close(p.x, q.x, `${msg} x`); close(p.y, q.y, `${msg} y`); };
const rad = (d) => (d * Math.PI) / 180;
const onArc = (c, r, d) => ({ x: c.x + r * Math.cos(rad(d)), y: c.y + r * Math.sin(rad(d)) });
const wrap = (a) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
const sweep = (p) => wrap(p.ccw ? Math.atan2(p.b.y - p.c.y, p.b.x - p.c.x) - Math.atan2(p.a.y - p.c.y, p.a.x - p.c.x) : Math.atan2(p.a.y - p.c.y, p.a.x - p.c.x) - Math.atan2(p.b.y - p.c.y, p.b.x - p.c.x));

/** The circle a polyline bulge stands for, worked out here from the bulge's definition (tan of a quarter of the sweep). */
function bulgeCircle(p, q, b) {
  const theta = 4 * Math.atan(Math.abs(b));
  const d = Math.hypot(q.x - p.x, q.y - p.y);
  const r = d / (2 * Math.sin(theta / 2));
  const h = r * Math.cos(theta / 2);           // from the chord's middle to the centre, signed
  const nx = -(q.y - p.y) / d, ny = (q.x - p.x) / d;   // left of p to q
  const s = b > 0 ? 1 : -1;
  return { c: { x: (p.x + q.x) / 2 + s * h * nx, y: (p.y + q.y) / 2 + s * h * ny }, r, ccw: b > 0, theta };
}

/** Runs of a chain: primitives that carry on from one another (worked out here, not with the exporter's own helper). */
function runs(chain) {
  const out = [];
  for (const p of chain) {
    const last = out.length ? out[out.length - 1] : null;
    if (last && Math.hypot(last[last.length - 1].b.x - p.a.x, last[last.length - 1].b.y - p.a.y) <= TOL) last.push(p);
    else out.push([p]);
  }
  return out;
}

const OPEN = { curb: 'FP-CURB', edge: 'FP-EDGE', centerline: 'FP-CENTERLINE', entrance: 'FP-YIELD', exit: 'FP-EXIT', inscribed: 'FP-INSCRIBED' };
const CLOSED = { landtake: 'FP-LANDTAKE', apron: 'FP-APRON', island: 'FP-ISLAND', splitter: 'FP-SPLITTER' };

// ---------------------------------------------------------------- the tests

test('the shapes under test all build (otherwise there is nothing to compare)', () => {
  assert.deepEqual(Object.keys(built).sort(), Object.keys(SHAPES).sort(), 'every test shape builds with the engine as it is now');
});

for (const [shapeName, res] of Object.entries(built)) {
  test(`${shapeName}: every line and arc is the engine's own, to 1e-6 ft, with arcs counterclockwise from start to end`, () => {
    const d = parse(toDxf(res, OPTS));
    const L = res.geometry.layers;
    let arcs = 0, lines = 0;
    for (const [id, layer] of Object.entries(OPEN)) {
      const ents = d.entities.filter((e) => e.get(8) === layer);
      assert.equal(ents.length, L[id].length, `${layer} has one entity per primitive of the ${id} chain`);
      L[id].forEach((p, i) => {
        const e = ents[i];
        const at = `${layer} #${i}`;
        if (p.type === 'line') {
          lines++;
          assert.equal(e.type, 'LINE', at);
          closePt({ x: e.num(10), y: e.num(20) }, p.a, `${at} start`);
          closePt({ x: e.num(11), y: e.num(21) }, p.b, `${at} end`);
          assert.equal(e.num(30), 0); assert.equal(e.num(31), 0);
          return;
        }
        arcs++;
        assert.equal(e.type, 'ARC', `${at} is a true arc, not segments`);
        const c = { x: e.num(10), y: e.num(20) }, r = e.num(40), s = e.num(50), t = e.num(51);
        closePt(c, p.c, `${at} centre`);
        close(r, p.r, `${at} radius`);
        assert.ok(s >= 0 && s < 360 && t >= 0 && t < 360, `${at} angles in degrees from 0 to 360`);
        // DXF arcs run counterclockwise from 50 to 51: a counterclockwise chain arc starts at its a, a clockwise one at b.
        const [first, second] = p.ccw ? [p.a, p.b] : [p.b, p.a];
        closePt(onArc(c, r, s), first, `${at} start point lands on the chain end`);
        closePt(onArc(c, r, t), second, `${at} end point lands on the chain end`);
        close(rad(((t - s) % 360 + 360) % 360), sweep(p), `${at} sweep (the same side of the circle as the chain)`);
      });
    }
    assert.ok(lines > 0 && arcs > 0);
  });

  test(`${shapeName}: islands and the land take are closed polylines whose bulges are the chain's arcs`, () => {
    const d = parse(toDxf(res, OPTS));
    const L = res.geometry.layers;
    for (const [id, layer] of Object.entries(CLOSED)) {
      const polys = d.entities.filter((e) => e.get(8) === layer);
      const rs = runs(L[id]);
      assert.equal(polys.length, rs.length, `${layer}: one polyline per outline`);
      rs.forEach((run, k) => {
        const e = polys[k];
        const at = `${layer} #${k}`;
        assert.equal(e.type, 'LWPOLYLINE', at);
        assert.equal(Number(e.get(70)) & 1, 1, `${at} is closed`);
        closePt(run[run.length - 1].b, run[0].a, `${at} chain closes`);
        assert.equal(e.verts.length, run.length, `${at} one vertex per primitive`);
        assert.equal(Number(e.get(90)), run.length);
        run.forEach((p, i) => {
          const v = e.verts[i], w = e.verts[(i + 1) % e.verts.length];
          closePt(v, p.a, `${at} vertex ${i}`);
          closePt(w, p.b, `${at} segment ${i} ends where the chain does`);
          if (p.type === 'line') { assert.equal(v.bulge, 0, `${at} segment ${i} is straight`); return; }
          assert.notEqual(v.bulge, 0, `${at} segment ${i} is an arc`);
          const a = bulgeCircle(v, w, v.bulge);
          closePt(a.c, p.c, `${at} segment ${i} centre`);
          close(a.r, p.r, `${at} segment ${i} radius`);
          assert.equal(a.ccw, !!p.ccw, `${at} segment ${i} turns the same way`);
          close(a.theta, sweep(p), `${at} segment ${i} sweep`);
        });
      });
    }
    // The land take polyline's area (straight parts plus each bulge's segment) is the engine's land take.
    const lt = d.entities.find((e) => e.get(8) === 'FP-LANDTAKE');
    let area = 0;
    lt.verts.forEach((v, i) => {
      const w = lt.verts[(i + 1) % lt.verts.length];
      area += (v.x - lt.verts[0].x) * (w.y - lt.verts[0].y) - (w.x - lt.verts[0].x) * (v.y - lt.verts[0].y);
      if (v.bulge) { const a = bulgeCircle(v, w, v.bulge); area += Math.sign(v.bulge) * a.r * a.r * (a.theta - Math.sin(a.theta)); }
    });
    area = Math.abs(area / 2);
    assert.ok(Math.abs(area - res.geometry.landTake.sqft) < 0.01, `land take ${area} against ${res.geometry.landTake.sqft} sq ft`);
  });

  test(`${shapeName}: fastest paths, their radius and speed labels, and the sight triangles`, () => {
    const d = parse(toDxf(res, OPTS));
    const paths = d.entities.filter((e) => e.get(8) === 'FP-PATH');
    const ok = res.movements.filter((m) => m.ok && m.path);
    assert.equal(paths.length, ok.length, 'one polyline per movement that has a path');
    ok.forEach((m, i) => {
      const e = paths[i];
      assert.equal(e.type, 'LWPOLYLINE');
      assert.equal(Number(e.get(70)) & 1, 0, 'a path is open');
      assert.equal(e.verts.length, m.path.n);
      for (let k = 0; k < m.path.n; k++) closePt(e.verts[k], { x: m.path.x[k], y: m.path.y[k] }, `${m.id} point ${k}`);
    });
    const labels = d.entities.filter((e) => e.get(8) === 'FP-PATH-TEXT');
    assert.ok(labels.every((e) => e.type === 'TEXT' && Number(e.get(40)) > 0));
    const fmt = (v) => (Math.round(v * 10) / 10).toFixed(1);
    for (const m of ok) {
      for (const [name, a] of Object.entries(m.arcs)) {
        const want = `${name} ${a.r === Infinity ? 'straight' : `${fmt(a.r)} ft`}, V${name.slice(1)} ${fmt(a.speed)} mph`;
        const hit = labels.find((e) => e.get(1) === want && Math.abs(e.num(10) - a.mid.x) < 1e-6 && e.num(20) <= a.mid.y + 1e-6 && e.num(20) > a.mid.y - 40);
        assert.ok(hit, `${m.id} has the label "${want}" at its arc`);
      }
    }
    for (const e of labels) assert.match(e.get(1), /^R[1-5] (\d+\.\d ft|straight), V[1-5] \d+\.\d mph$/);
    const tris = d.entities.filter((e) => e.get(8) === 'FP-SIGHT');
    assert.equal(tris.length, res.geometry.sightTriangles.length);
    res.geometry.sightTriangles.forEach((t, i) => {
      assert.equal(Number(tris[i].get(70)) & 1, 1);
      tris[i].verts.forEach((v, k) => closePt(v, t.polygon[k], `triangle ${i} point ${k}`));
    });
  });

  test(`${shapeName}: header, extents, layers, handles and the note`, () => {
    const text = toDxf(res, OPTS);
    const d = parse(text);
    assert.equal(d.header.$ACADVER[1], 'AC1015');
    assert.equal(d.header.$INSUNITS[70], '2', 'drawing units are feet');
    assert.equal(d.header.$MEASUREMENT[70], '0');
    assert.equal(d.header.$LUNITS[70], '2');
    assert.deepEqual(Object.keys(d.sections), ['HEADER', 'CLASSES', 'TABLES', 'BLOCKS', 'ENTITIES', 'OBJECTS']);
    assert.deepEqual(d.last, [0, 'EOF']);
    // Extents hold every point drawn.
    const lo = { x: Number(d.header.$EXTMIN[10]), y: Number(d.header.$EXTMIN[20]) }, hi = { x: Number(d.header.$EXTMAX[10]), y: Number(d.header.$EXTMAX[20]) };
    const inside = (p, msg) => assert.ok(p.x >= lo.x - TOL && p.x <= hi.x + TOL && p.y >= lo.y - TOL && p.y <= hi.y + TOL, msg);
    for (const e of d.entities) {
      if (e.type === 'LINE') { inside({ x: e.num(10), y: e.num(20) }, 'line start'); inside({ x: e.num(11), y: e.num(21) }, 'line end'); }
      if (e.type === 'ARC') for (const t of [e.num(50), e.num(51)]) inside(onArc({ x: e.num(10), y: e.num(20) }, e.num(40), t), 'arc end');
      if (e.type === 'LWPOLYLINE') e.verts.forEach((v) => inside(v, 'vertex'));
      if (e.type === 'TEXT') inside({ x: e.num(10), y: e.num(20) }, 'text');
    }
    const C = res.geometry.center;
    inside(C, 'the centre');
    // Coordinates are the engine's state plane feet: the centre of the central island is written as the engine gives it.
    const island = d.entities.find((e) => e.get(8) === 'FP-ISLAND');
    const ic = bulgeCircle(island.verts[0], island.verts[1], island.verts[0].bulge).c;
    closePt(ic, C, 'island centre is the roundabout centre, unshifted');
    // Layers: each one in the table with its colour, every entity on one of them.
    const layers = d.tables.filter((t) => t.type === 'LAYER');
    const names = layers.map((l) => l.get(2));
    for (const L of DXF_LAYERS) {
      const row = layers.find((l) => l.get(2) === L.name);
      assert.ok(row, `layer ${L.name}`);
      assert.equal(Number(row.get(62)), L.color);
      assert.match(L.name, /^FP-[A-Z-]+$/);
    }
    assert.ok(names.includes('0'));
    for (const e of d.entities) assert.ok(names.includes(e.get(8)), `${e.type} on ${e.get(8)}`);
    // Handles: unique, every entity owned by *Model_Space, $HANDSEED past the last one.
    const handles = d.pairs.filter(([c], i) => (c === 5 || c === 105) && !(d.pairs[i - 1][0] === 9)).map(([, v]) => parseInt(v, 16));
    assert.equal(new Set(handles).size, handles.length, 'handles are unique');
    assert.ok(parseInt(d.header.$HANDSEED[5], 16) > Math.max(...handles));
    const ms = d.tables.find((t) => t.type === 'BLOCK_RECORD' && t.get(2) === '*Model_Space');
    for (const e of d.entities) assert.equal(e.get(330), ms.get(5));
    // The note: the tool, the option, the zone and the date.
    const note = d.entities.filter((e) => e.get(8) === 'FP-NOTE').map((e) => e.get(1)).join(' ');
    assert.match(note, /First Pass/);
    assert.match(note, /Option A of Sample roundabout/);
    assert.match(note, /CCS83 zone 2 \(EPSG 2226\), US survey feet/);
    assert.match(note, /Made 11 Nov 2026\./);
    assert.ok(!/[^\x20-\x7e\r\n]/.test(text), 'plain ASCII');
    assert.ok(!/autodesk|autocad|civil 3d/i.test(text), 'no product names in the file');
    assert.deepEqual(checkDxf(text).problems, []);
  });
}

test('the same input gives the same bytes; only the date line changes with the date', () => {
  const res = built.sample;
  const a = toDxf(res, OPTS), b = toDxf(structuredClone(res), { ...OPTS });
  assert.equal(a, b);
  const c = toDxf(res, { ...OPTS, date: '2027-01-05' });
  const da = a.split('\r\n'), dc = c.split('\r\n');
  assert.equal(da.length, dc.length);
  const diff = da.map((l, i) => (l === dc[i] ? null : [l, dc[i]])).filter(Boolean);
  assert.deepEqual(diff.map((x) => x[1]), ['Made 5 Jan 2027. Layers start with FP. A first look for testing ideas: check it before you build on it.']);
  const d = toDxf(res, { ...OPTS, date: new Date(Date.UTC(2026, 10, 11, 23, 30)) });
  assert.equal(d, a, 'a Date gives its UTC day');
});

test('a shape that cannot be built is refused in plain words, and nothing is written', () => {
  const r = defaultRoundabout();
  r.icd = 5000;
  const res = evaluate(r, {});
  assert.equal(res.ok, false);
  assert.throws(() => toDxf(res, OPTS), (e) => e.refused === true && /^This option cannot be built, so there is no drawing to export\./.test(e.message));
  assert.throws(() => toDxf(null, OPTS), (e) => e.refused === true);
});

test('numbers and words are written the way the file format reads them', () => {
  assert.equal(num(6636072.770087818), '6636072.770087818');
  assert.equal(num(2), '2.0');
  assert.equal(num(-0), '0.0');
  assert.equal(num(1e-7), '0.0000001');
  assert.equal(Number(num(0.1 + 0.2)), 0.1 + 0.2, 'reads back to the same double');
  assert.throws(() => num(Infinity));
  assert.equal(dxfText('Calle Señora\nand 5th ^ 100%% done'), 'Calle Se\\U+00F1ora and 5th ^  100%%%%%% done');
  const t = toDxf(built.sample, { ...OPTS, name: 'Elm & 5th, Señora' });
  assert.ok(t.includes('Option A of Elm & 5th, Se\\U+00F1ora.'));
  // The zone words for each California zone, and for a coordinate system that is not one.
  for (const [epsg, z] of [[2225, 1], [2230, 6]]) assert.ok(toDxf(built.sample, { ...OPTS, epsg }).includes(`CCS83 zone ${z} (EPSG ${epsg})`));
  assert.ok(toDxf(built.sample, { ...OPTS, epsg: 3310 }).includes('the coordinate system EPSG 3310, in feet'));
});

test('the well-formedness check finds a broken file', () => {
  const good = toDxf(built.sample, OPTS);
  assert.equal(checkDxf(good).ok, true);
  assert.deepEqual(checkDxf(good).counts.ARC > 0 && checkDxf(good).counts.TEXT > 0, true);
  assert.match(checkDxf(good.replace(/  0\r\nEOF\r\n$/, '')).problems.join(' '), /does not end with EOF/);
  assert.match(checkDxf(good.replace('  8\r\nFP-CURB\r\n', '  8\r\nFP-NOWHERE\r\n')).problems.join(' '), /FP-NOWHERE is used but not in the layer table/);
  assert.match(checkDxf(good.replace(/\r\n 10\r\n([\d.]+)\r\n/, '\r\n 10\r\nNaN\r\n')).problems.join(' '), /not finite/);
  assert.match(checkDxf('').problems.join(' '), /sections/);
});

test('the exports registry: DXF by id and by file name, and one file name for page and server', () => {
  assert.deepEqual(EXPORTS.map((e) => e.id), ['dxf']);
  for (const e of EXPORTS) {
    assert.equal(typeof e.build, 'function');
    assert.match(e.ext, /^[a-z0-9]+$/);
    assert.match(e.mime, /^[a-z]+\/[\w.+-]+$/);
    assert.ok(e.label && !/autodesk|civil 3d|autocad/i.test(e.label));
  }
  assert.equal(exportById('dxf').ext, 'dxf');
  assert.equal(exportById('landxml'), null);
  assert.deepEqual(exportForFile('A.dxf'), { format: exportById('dxf'), option: 'A' });
  assert.deepEqual(exportForFile('B.DXF').option, 'B');
  assert.equal(exportForFile('A.dwg'), null);
  assert.equal(exportForFile('../A.dxf'), null);
  assert.equal(exportFileName('Sample roundabout', 'A', 'dxf'), 'Sample-roundabout-A.dxf');
  assert.equal(exportFileName('Elm & 5th / Señora', 'B', 'dxf'), 'Elm-5th-Senora-B.dxf');
  assert.equal(exportFileName('', 'A', 'dxf'), 'First-Pass-A.dxf');
});

test('outside check: ezdxf loads the file, its audit finds nothing, and the entities are all there', { skip: process.env.FP_EZDXF_PYTHON ? false : 'set FP_EZDXF_PYTHON to a Python with ezdxf to run it' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-dxf-'));
  const file = path.join(dir, 'sample.dxf');
  fs.writeFileSync(file, toDxf(built.sample, OPTS));
  const script = [
    'import sys, ezdxf', 'from ezdxf import recover',
    'doc = ezdxf.readfile(sys.argv[1]); a = doc.audit(); d2, a2 = recover.readfile(sys.argv[1])',
    'print(len(a.errors), len(a.fixes), len(a2.errors), len(a2.fixes), len(doc.modelspace()), doc.dxfversion)',
  ].join('\n');
  const out = execFileSync(process.env.FP_EZDXF_PYTHON, ['-I', '-c', script, file], { encoding: 'utf8' }).trim().split(/\s+/);
  fs.rmSync(dir, { recursive: true, force: true });
  const ents = parse(toDxf(built.sample, OPTS)).entities.length;
  assert.deepEqual(out, ['0', '0', '0', '0', String(ents), 'AC1015']);
});
