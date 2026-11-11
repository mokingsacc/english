// Engine demo: evaluates a roundabout, prints the headline, the per-leg radii and speeds and the time one
// evaluation takes, and writes a picture of it as SVG.
//
//   node scripts/engine-demo.mjs out.svg            the default four-leg roundabout
//   node scripts/engine-demo.mjs out.svg t          a three-leg T (bearings 0, 90, 270)
//   node scripts/engine-demo.mjs out.svg skew       a skewed four-leg (bearings 0, 75, 180, 255), default sizes
//   node scripts/engine-demo.mjs out.svg turned     the default with the North leg turned 15 degrees
//   node scripts/engine-demo.mjs out.svg tightest   the North leg turned as far as it can go (18 degrees)
//   node scripts/engine-demo.mjs out.svg icd150     a 150 ft circle with 100 ft entry and 200 ft exit curb radii
//   node scripts/engine-demo.mjs out.svg big        a 300 ft circle with large curb radii and long splitter islands
//   node scripts/engine-demo.mjs out.svg small      a small circle with tight curbs
//   node scripts/engine-demo.mjs out.svg six        six legs
//   node scripts/engine-demo.mjs out.svg offset     legs shifted to the left and right, with uneven sizes
//   node scripts/engine-demo.mjs out.svg shape.json a roundabout read from a file
//
// Extra name=value arguments change values before evaluating, for example icd=150 or legs.*.exitRadius=90.
// The picture marks each entry and exit width as an engineer measures it: a short line square to the curb
// from where the splitter island meets the circle.

import { writeFileSync, readFileSync } from 'node:fs';
import { evaluate, defaultRoundabout, defaultLeg, flattenChain, setAt } from '../public/js/engine/index.js';

const out = process.argv[2];
const shapeArg = process.argv[3] || 'default';
const sets = process.argv.slice(4);

function shape(name) {
  const r = defaultRoundabout();
  if (name === 'default') return r;
  if (name === 't') { r.legs = [0, 90, 270].map((b) => defaultLeg(b)); return r; }
  if (name === 'skew') { r.legs = [0, 75, 180, 255].map((b) => defaultLeg(b)); return r; }
  if (name === 'turned') { r.legs[0].bearing = 15; return r; }
  if (name === 'tightest') { r.legs[0].bearing = 18; return r; }
  if (name === 'icd150') {
    r.icd = 150;
    r.legs.forEach((l) => { Object.assign(l, { entryRadius: 100, exitRadius: 200 }); });
    return r;
  }
  if (name === 'big') {
    r.icd = 300; r.circWidth = 24; r.apronWidth = 16;
    r.legs.forEach((l) => { Object.assign(l, { entryRadius: 120, exitRadius: 200, splitterLength: 150, splitterWidth: 20, entryWidth: 20, exitWidth: 22 }); });
    return r;
  }
  if (name === 'six') {
    r.icd = 200; r.circWidth = 20;
    r.legs = [0, 60, 120, 180, 240, 300].map((b, i) => ({ ...defaultLeg(b, `L${i + 1}`, `Leg ${i + 1}`), entryRadius: 50, exitRadius: 80, splitterWidth: 10, entryWidth: 19, exitWidth: 21.5 }));
    return r;
  }
  if (name === 'offset') {
    r.icd = 150;
    r.legs.forEach((l) => { Object.assign(l, { entryWidth: 20, exitWidth: 21 }); });
    Object.assign(r.legs[0], { offsetLeft: 12 });
    Object.assign(r.legs[1], { offsetLeft: -8, bearing: 95, exitWidth: 23 });
    Object.assign(r.legs[2], { approachSpeed: 30, entryRadius: 100, entryWidth: 22.5 });
    Object.assign(r.legs[3], { entryWidth: 20, splitterWidth: 20 });
    return r;
  }
  if (name === 'small') {
    r.icd = 90; r.circWidth = 20; r.apronWidth = 10;
    r.legs.forEach((l) => { Object.assign(l, { entryRadius: 35, exitRadius: 45, splitterWidth: 6, entryWidth: 14.5, exitWidth: 15.5, splitterLength: 45 }); });
    return r;
  }
  return JSON.parse(readFileSync(name, 'utf8'));
}

let round = shape(shapeArg);
for (const s of sets) {
  const [path, raw] = s.split('=');
  const v = Number(raw);
  if (path.includes('*')) {
    round.legs.forEach((_, i) => { round = setAt(round, path.replace('*', String(i)), v) || round; });
  } else {
    round = setAt(round, path, v) || round;
  }
}

const result = evaluate(round, {});
for (let i = 0; i < 30; i++) evaluate(round, {});
const times = [];
for (let i = 0; i < 100; i++) {
  const t0 = performance.now();
  evaluate(round, {});
  times.push(performance.now() - t0);
}
times.sort((a, b) => a - b);

const f1 = (v) => (v === null || v === undefined ? '-' : v === Infinity ? 'straight' : v.toFixed(1));
console.log(result.headline.text);
if (!result.ok) console.log('Problems:\n  ' + result.problems.join('\n  '));
console.log('');
console.log('leg   R1      R2      R3      R4      R5      |  V1    V2    V3    V4    V5   (ft, mph)');
for (const L of result.legs) {
  const R = ['R1', 'R2', 'R3', 'R4', 'R5'].map((k) => f1(L.R[k]).padStart(7)).join(' ');
  const V = ['V1', 'V2', 'V3', 'V4', 'V5'].map((k) => f1(L.V[k]).padStart(5)).join(' ');
  console.log(`${L.id.padEnd(4)} ${R}  | ${V}`);
}
console.log('');
if (result.ok) {
  console.log('leg   entry width  exit width  |  entry radius  exit radius  |  island at circle  island length  (ft, as built)');
  for (const L of result.geometry.legs) {
    console.log(`${L.id.padEnd(4)}  ${L.entryWidthBuilt.toFixed(2).padStart(11)} ${L.exitWidthBuilt.toFixed(2).padStart(11)}  | ${L.entryRadiusBuilt.toFixed(1).padStart(13)} ${L.exitRadiusBuilt.toFixed(1).padStart(12)}  | ${L.splitterWidthAtCircle.toFixed(2).padStart(17)} ${L.splitterLengthBuilt.toFixed(1).padStart(14)}`);
  }
  const items = result.checks.find((c) => c.id === 'geometry').items;
  const corners = items.filter((i) => i.status === 'warn');
  if (corners.length) console.log('Warnings:\n  ' + corners.map((i) => i.text).join('\n  '));
  const notes = items.filter((i) => i.status === 'info');
  if (notes.length) console.log('Notes:\n  ' + notes.map((i) => i.text).join('\n  '));
  console.log(`Land take: ${Math.round(result.geometry.landTake.sqft)} square feet (${result.geometry.landTake.acres.toFixed(2)} acres).`);
  console.log('');
}
for (const c of result.checks) console.log(`${c.status.padEnd(4)}  ${c.title}${c.value !== null ? `: ${typeof c.value === 'number' ? Math.round(c.value * 10) / 10 : c.value} ${c.unit || ''}` : ''}`);
console.log('');
const q = (p) => times[Math.floor(p * (times.length - 1))].toFixed(2);
console.log(`evaluate() over 100 runs after warm-up: median ${q(0.5)} ms, fastest ${q(0)} ms, 90th percentile ${q(0.9)} ms.`);

if (out) {
  writeFileSync(out, svg(result, round));
  console.log(`Picture written to ${out}`);
}

// ---------------------------------------------------------------- picture

function svg(res, round) {
  const C = round.center;
  if (!res.ok) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="120" viewBox="0 0 1400 120"><rect width="1400" height="120" fill="#fff"/>`
      + res.problems.map((p, i) => `<text x="10" y="${30 + i * 24}" font-family="sans-serif" font-size="14">${esc(p)}</text>`).join('') + '</svg>';
  }
  const G = res.geometry;
  const X = (p) => p.x - C.x, Y = (p) => -(p.y - C.y);
  // Picture extent: the land take and 100 ft of each approach beyond the nose.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const grow = (p) => { x0 = Math.min(x0, X(p)); x1 = Math.max(x1, X(p)); y0 = Math.min(y0, Y(p)); y1 = Math.max(y1, Y(p)); };
  flattenChain(G.layers.landtake, 4).forEach(grow);
  for (const L of G.legs) {
    const d = { x: L.far.x - L.nose.x, y: L.far.y - L.nose.y };
    const k = 100 / Math.hypot(d.x, d.y);
    grow({ x: L.nose.x + d.x * k, y: L.nose.y + d.y * k });
  }
  const pad = 30;
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const W = 1400, H = Math.round((W * (y1 - y0)) / (x1 - x0));
  const sc = W / (x1 - x0);
  const lw = (px) => (px / sc).toFixed(3);

  const pathOf = (chain, close) => {
    let d = '';
    let at = null;
    chain.forEach((p) => {
      // Start a new piece wherever this primitive does not carry on from the last one.
      if (!at || Math.hypot(at.x - p.a.x, at.y - p.a.y) > 1e-6) d += `M${X(p.a).toFixed(3)} ${Y(p.a).toFixed(3)}`;
      at = p.b;
      if (p.type === 'line') d += `L${X(p.b).toFixed(3)} ${Y(p.b).toFixed(3)}`;
      else {
        const a0 = Math.atan2(p.a.y - p.c.y, p.a.x - p.c.x), a1 = Math.atan2(p.b.y - p.c.y, p.b.x - p.c.x);
        let sw = p.ccw ? a1 - a0 : a0 - a1;
        sw = ((sw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        // y is flipped for the screen, so a counterclockwise arc on the ground is drawn with sweep flag 0.
        d += `A${p.r.toFixed(3)} ${p.r.toFixed(3)} 0 ${sw > Math.PI ? 1 : 0} ${p.ccw ? 0 : 1} ${X(p.b).toFixed(3)} ${Y(p.b).toFixed(3)}`;
      }
    });
    return d + (close ? 'Z' : '');
  };
  const poly = (pts) => 'M' + pts.map((p) => `${X(p).toFixed(3)} ${Y(p).toFixed(3)}`).join('L') + 'Z';

  const parts = [];
  parts.push(`<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="#f4f1ea"/>`);
  // Pavement: the area inside the outer curbs, and each approach road beyond the nose.
  parts.push(`<path d="${pathOf(G.layers.landtake, true)}" fill="#c9c9c9"/>`);
  for (const L of G.legs) parts.push(`<path d="${poly([L.farIn, L.F, L.Fx, L.farOut])}" fill="#c9c9c9"/>`);
  // Sight triangles under everything else.
  for (const t of G.sightTriangles) {
    const col = t.stream === 'entering' ? '#7b4fd6' : '#d68a1f';
    parts.push(`<path d="${poly(t.polygon)}" fill="${col}" fill-opacity="0.08" stroke="${col}" stroke-opacity="0.7" stroke-width="${lw(1)}"/>`);
  }
  // Islands.
  parts.push(`<path d="${pathOf(G.layers.island, true)}" fill="#d8cdb0" stroke="#222" stroke-width="${lw(1.6)}"/>`);
  if (G.layers.apron.length) parts.push(`<path d="${pathOf(G.layers.apron, true)}" fill="#8fb27a" stroke="#222" stroke-width="${lw(1.6)}"/>`);
  // Each splitter island is one closed run of pieces in the layer: start a new one wherever a piece does not
  // carry on from the last.
  const islands = [];
  for (const p of G.layers.splitter) {
    const cur = islands[islands.length - 1];
    if (cur && Math.hypot(cur[cur.length - 1].b.x - p.a.x, cur[cur.length - 1].b.y - p.a.y) < 1e-6) cur.push(p);
    else islands.push([p]);
  }
  for (const run of islands) parts.push(`<path d="${pathOf(run, true)}" fill="#8fb27a" stroke="#222" stroke-width="${lw(1.6)}"/>`);
  // Lines.
  parts.push(`<path d="${pathOf(G.layers.curb)}" fill="none" stroke="#111" stroke-width="${lw(2)}"/>`);
  for (const p of G.layers.edge) parts.push(`<path d="${pathOf([p])}" fill="none" stroke="#fff" stroke-width="${lw(1.4)}"/>`);
  for (const p of G.layers.centerline) parts.push(`<path d="${pathOf([p])}" fill="none" stroke="#e5b800" stroke-width="${lw(1.6)}" stroke-dasharray="${lw(8)} ${lw(6)}"/>`);
  for (const p of [...G.layers.entrance, ...G.layers.exit]) parts.push(`<path d="${pathOf([p])}" fill="none" stroke="#fff" stroke-width="${lw(2.2)}" stroke-dasharray="${lw(4)} ${lw(3)}"/>`);
  // Entry and exit widths as measured: square to the curb from where the splitter island meets the circle.
  for (const L of G.legs) {
    for (const [a, b] of [[L.Se, L.entryWidthPoint], [L.Sx, L.exitWidthPoint]]) {
      parts.push(`<path d="M${X(a).toFixed(3)} ${Y(a).toFixed(3)}L${X(b).toFixed(3)} ${Y(b).toFixed(3)}" fill="none" stroke="#1f6fd6" stroke-width="${lw(2)}"/>`);
    }
  }
  // Fastest paths, coloured by speed.
  for (const m of res.movements) {
    if (!m.ok) {
      parts.push(`<circle cx="${X(m.place)}" cy="${Y(m.place)}" r="${lw(9)}" fill="none" stroke="#d00" stroke-width="${lw(3)}"/>`);
      continue;
    }
    const p = m.path;
    for (let k = 1; k < p.n; k++) {
      const v = 0.5 * (p.speed[k] + p.speed[k - 1]);
      parts.push(`<line x1="${X({ x: p.x[k - 1] }).toFixed(3)}" y1="${Y({ y: p.y[k - 1] }).toFixed(3)}" x2="${X({ x: p.x[k] }).toFixed(3)}" y2="${Y({ y: p.y[k] }).toFixed(3)}" stroke="${speedColour(v)}" stroke-width="${lw(2.2)}" stroke-linecap="round"/>`);
    }
  }
  // Speed labels at the fitted arcs, once per place.
  const placed = [];
  const fs = lw(12);
  for (const m of res.movements) {
    if (!m.ok) continue;
    for (const [name, a] of Object.entries(m.arcs)) {
      const px = X(a.mid), py = Y(a.mid);
      if (placed.some((q) => Math.hypot(q[0] - px, q[1] - py) < 12)) continue;
      placed.push([px, py]);
      const txt = `${name} ${a.r === Infinity ? 'straight' : Math.round(a.r)} ft, ${Math.round(a.speed)} mph`;
      parts.push(`<circle cx="${px.toFixed(2)}" cy="${py.toFixed(2)}" r="${lw(3)}" fill="#000"/>`);
      parts.push(`<text x="${(px + 4 / sc).toFixed(2)}" y="${(py - 4 / sc).toFixed(2)}" font-family="sans-serif" font-size="${fs}" fill="#000" stroke="#fff" stroke-width="${lw(3)}" paint-order="stroke">${esc(txt)}</text>`);
    }
  }
  // Leg names and eye points.
  for (const L of G.legs) {
    const d = { x: L.far.x - L.nose.x, y: L.far.y - L.nose.y };
    const k = 85 / Math.hypot(d.x, d.y);
    const p = { x: L.nose.x + d.x * k, y: L.nose.y + d.y * k };
    parts.push(`<text x="${X(p).toFixed(2)}" y="${Y(p).toFixed(2)}" font-family="sans-serif" font-size="${lw(16)}" font-weight="bold" text-anchor="middle" fill="#333" stroke="#fff" stroke-width="${lw(3)}" paint-order="stroke">${esc(L.name)}</text>`);
  }
  for (const L of res.legs) if (L.eye) parts.push(`<circle cx="${X(L.eye)}" cy="${Y(L.eye)}" r="${lw(4)}" fill="#7b4fd6"/>`);
  // Legend.
  const lx = x0 + 10 / sc, ly = y0 + 18 / sc;
  parts.push(`<text x="${lx}" y="${ly}" font-family="sans-serif" font-size="${lw(14)}" fill="#000">${esc(res.headline.text)}</text>`);
  for (let i = 0; i <= 6; i++) {
    const v = 10 + i * 5;
    parts.push(`<rect x="${lx + (i * 60) / sc}" y="${ly + 10 / sc}" width="${lw(56)}" height="${lw(10)}" fill="${speedColour(v)}"/>`);
    parts.push(`<text x="${lx + (i * 60) / sc}" y="${ly + 36 / sc}" font-family="sans-serif" font-size="${lw(12)}">${v} mph</text>`);
  }
  parts.push(`<text x="${lx}" y="${ly + 56 / sc}" font-family="sans-serif" font-size="${lw(12)}" fill="#7b4fd6">Purple: sight triangle along the entering path. Orange: along the circulating path.</text>`);
  parts.push(`<text x="${lx}" y="${ly + 74 / sc}" font-family="sans-serif" font-size="${lw(12)}" fill="#1f6fd6">Blue: entry and exit widths, measured square to the curb from where the splitter island meets the circle.</text>`);
  const geoItems = res.checks.find((c) => c.id === 'geometry').items;
  const lines = [...geoItems.filter((i) => i.status === 'warn'), ...geoItems.filter((i) => i.status === 'info')];
  lines.forEach((w, i) => {
    parts.push(`<text x="${lx}" y="${ly + (94 + 18 * i) / sc}" font-family="sans-serif" font-size="${lw(12)}" fill="${w.status === 'warn' ? '#a04000' : '#335'}">${esc(w.text)}</text>`);
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}">${parts.join('\n')}</svg>\n`;
}

function speedColour(v) {
  const stops = [[10, [40, 90, 220]], [18, [40, 180, 200]], [24, [90, 190, 60]], [28, [240, 200, 30]], [35, [220, 40, 30]]];
  if (v <= stops[0][0]) return rgb(stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [va, ca] = stops[i - 1], [vb, cb] = stops[i];
      const t = (v - va) / (vb - va);
      return rgb(ca.map((c, k) => c + (cb[k] - c) * t));
    }
  }
  return rgb(stops[stops.length - 1][1]);
}

function rgb(c) {
  return `rgb(${c.map((x) => Math.round(x)).join(',')})`;
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
