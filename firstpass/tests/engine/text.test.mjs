import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, defaultRoundabout, defaultLeg, PARAMS, RULES, CHECKS } from '../../public/js/engine/index.js';
import { shapes } from './helpers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

// Characters and sequences that do not belong in plain sentences: arrows, comparison and maths signs, code.
const SYMBOLS = /->|=>|<-|[<>=≤≥→←±≈~^*|&$#@{}[\]\\_+%]|NaN|undefined|Infinity|null\b|\[object/;

function sentencesOf(e) {
  const out = [...e.problems, e.headline.text];
  for (const c of e.checks) {
    out.push(c.explain);
    if (c.fix) out.push(c.fix);
    for (const it of c.items) out.push(it.text);
  }
  for (const m of e.movements) out.push(...m.problems);
  return out;
}

function collect() {
  const sentences = [], labels = [];
  for (const p of PARAMS) { labels.push(p.label); sentences.push(p.help); }
  for (const r of RULES) labels.push(r.label);
  for (const c of CHECKS) labels.push(c.title);
  const cases = [...Object.values(shapes())];
  const skew = defaultRoundabout(); skew.legs = [0, 75, 180, 255].map((b) => defaultLeg(b)); cases.push(skew);
  // The new words of the second engine pass: a corner built with shorter radii, legs too close for any radii,
  // widths that cannot be met for each reason.
  const close = defaultRoundabout(); close.legs[0].bearing = 30; cases.push(close);
  const close1 = defaultRoundabout(); close1.legs[0].bearing = 23; cases.push(close1);
  const wide = defaultRoundabout(); wide.legs[0].splitterLength = 20; cases.push(wide);
  const long = defaultRoundabout(); long.legs[0].entryRadius = 250; long.legs[2].exitRadius = 150; cases.push(long);
  const pinch = defaultRoundabout(); pinch.legs[0].entryWidth = 15; pinch.legs[1].exitWidth = 16; cases.push(pinch);
  const cross = defaultRoundabout(); Object.assign(cross.legs[0], { entryWidth: 12, splitterWidth: 4 }); cases.push(cross);
  const tight = defaultRoundabout(); tight.circWidth = 12; tight.legs.forEach((l) => { l.entryWidth = 12; l.exitWidth = 12; l.exitRadius = 100; l.splitterWidth = 30; }); cases.push(tight);
  // The third pass: a curb too far out to turn onto the circle, a width the curve cannot reach, an entry and
  // exit that overlap at the circle, an island built longer than asked, and an island tip cut back.
  const miss = defaultRoundabout(); miss.icd = 70; miss.circWidth = 14; miss.apronWidth = 0;
  Object.assign(miss.legs[0], { splitterWidth: 40, approachWidth: 20 }); cases.push(miss);
  const reach = defaultRoundabout(); reach.icd = 70; reach.circWidth = 14; reach.apronWidth = 0;
  Object.assign(reach.legs[0], { splitterWidth: 20, approachWidth: 20, entryRadius: 30 }); cases.push(reach);
  const overlap = defaultRoundabout();
  Object.assign(overlap.legs[0], { entryRadius: 30, exitRadius: 40, entryWidth: 26, exitWidth: 26, splitterWidth: 4 }); cases.push(overlap);
  const longer = defaultRoundabout(); longer.icd = 150; longer.legs.forEach((l) => { l.entryRadius = 100; l.exitRadius = 200; }); cases.push(longer);
  const tip = defaultRoundabout(); tip.icd = 90; Object.assign(tip.legs[0], { entryRadius: 30, exitRadius: 40, splitterWidth: 6 }); cases.push(tip);
  const junk = defaultRoundabout(); junk.icd = 'x'; junk.legs[0].entryRadius = 9999; cases.push(junk);
  cases.push(null, { legs: [] });
  for (const r of cases) sentences.push(...sentencesOf(evaluate(r, {})));
  sentences.push(...sentencesOf(evaluate(defaultRoundabout(), { 'speed.entry.max': 20, 'speed.consistency.warn': 5 })));
  sentences.push(...sentencesOf(evaluate(defaultRoundabout(), { 'fp.offset.curb': 'x', 'speed.decel': 99, 'sight.isd.criticalHeadway': 1 })));
  return { sentences, labels };
}

test('every sentence a person reads is plain words and ends with a full stop', () => {
  const { sentences, labels } = collect();
  assert.ok(sentences.length > 100);
  for (const s of sentences) {
    assert.equal(typeof s, 'string');
    assert.ok(s.length > 10, `too short: "${s}"`);
    assert.ok(!SYMBOLS.test(s) && !s.includes('/'), `symbol in: "${s}"`);
    assert.match(s, /^[A-Z0-9"]/, `does not start like a sentence: "${s}"`);
    assert.match(s, /[.]$/, `does not end with a full stop: "${s}"`);
    assert.ok(!/\s{2}/.test(s), `double space in: "${s}"`);
  }
  for (const s of labels) {
    assert.ok(!SYMBOLS.test(s), `symbol in label: "${s}"`);
    assert.match(s, /^[A-Z]/, `label: "${s}"`);
  }
});

test('no file of the engine, its tests or its demo names an AI model', () => {
  // The names are written backwards here so that this file does not contain them either.
  const names = ['edualc', 'tpg', 'iaNEPO', 'cihporhtna', 'inimeg', 'amall', 'lartsim', 'tolipoc'].map((s) => s.split('').reverse().join(''));
  const re = new RegExp(`\\b(${names.join('|')})`, 'i');
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p); else if (/\.(m?js)$/.test(f)) files.push(p);
    }
  };
  walk(join(root, 'public', 'js', 'engine'));
  walk(join(root, 'tests', 'engine'));
  files.push(join(root, 'scripts', 'engine-demo.mjs'));
  assert.ok(files.length > 20);
  for (const f of files) assert.ok(!re.test(readFileSync(f, 'utf8')), f);
});

test('the engine uses no browser page and no Node features', () => {
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.js')) files.push(p);
    }
  };
  walk(join(root, 'public', 'js', 'engine'));
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!/(\brequire\(|\bprocess\.|\bdocument\.|(^|[^.\w])window\.|from 'node:|\bBuffer\b|__dirname)/m.test(src), f);
    for (const m of src.matchAll(/from '([^']+)'/g)) assert.ok(m[1].startsWith('.'), `${f} imports ${m[1]}`);
  }
});
