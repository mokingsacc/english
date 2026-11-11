import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, defaultRoundabout, defaultLeg, PARAMS, RULES, CHECKS } from '../../public/js/engine/index.js';
import { shapes } from './helpers.mjs';
import { mph1 } from '../../public/js/engine/format.js';

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
  // The third and fourth passes: a curb too far out to turn onto the circle, entries too wide for a small
  // circle, an island built longer than asked, and an island that meets the circle on its body line.
  const miss = defaultRoundabout(); miss.icd = 70; miss.circWidth = 14; miss.apronWidth = 0;
  Object.assign(miss.legs[0], { splitterWidth: 40 }); cases.push(miss);
  const crowd = defaultRoundabout(); crowd.icd = 90; crowd.apronWidth = 0;
  crowd.legs.forEach((l) => Object.assign(l, { entryWidth: 20, exitWidth: 21 })); cases.push(crowd);
  const longer = defaultRoundabout(); longer.icd = 150; longer.legs.forEach((l) => { l.entryRadius = 100; l.exitRadius = 200; l.splitterLength = 40; }); cases.push(longer);
  const body = defaultRoundabout(); body.legs = [0, 120, 240].map((b) => defaultLeg(b));
  Object.assign(body.legs[0], { entryRadius: 30, entryWidth: 26, splitterWidth: 40 }); cases.push(body);
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

test('an entry just over its limit reads as over: the speed is written finely enough to differ from the limit', () => {
  const v = evaluate(defaultRoundabout(), {}).checks.find((c) => c.id === 'entry-speed').value;
  // A limit under the fastest entry that rounds to the same whole number, so whole numbers would read the same.
  const lo = Math.round(v) - 0.5;
  const limit = (Math.max(lo, v - 0.4) + v) / 2;
  const c = evaluate(defaultRoundabout(), { 'speed.entry.max': limit }).checks.find((x) => x.id === 'entry-speed');
  const over = c.items.filter((it) => it.status === 'fail');
  assert.ok(over.length, 'some entry is over the limit');
  for (const it of over) {
    const [said, lim] = it.text.split('above the limit of');
    const speeds = [...said.matchAll(/(\d+(?:\.\d+)?) mph/g)].map((m) => Number(m[1]));
    const written = Number(/(\d+(?:\.\d+)?) mph/.exec(lim)[1]);
    assert.ok(Math.max(...speeds) > written, `reads as over the limit: "${it.text}"`);
  }
});

test('a speed set against a limit or another speed has one decimal, or two when one would read the same as the limit', () => {
  assert.equal(mph1(25.24), '25.2 mph');
  assert.equal(mph1(25, 25), '25.0 mph');
  assert.equal(mph1(25.04, 25), '25.04 mph');
  assert.equal(mph1(24.96, 25), '24.96 mph');
  assert.equal(mph1(23.71, 25), '23.7 mph');
  assert.equal(mph1(10.04, 10), '10.04 mph');
});

// Every speed in the headline and in the entry, exit and consistency sentences, except a limit ("the limit of 25 mph").
function comparedSpeeds(e) {
  const texts = [e.headline.text];
  for (const id of ['entry-speed', 'exit-speed', 'speed-consistency']) for (const it of e.checks.find((c) => c.id === id).items) texts.push(it.text);
  return texts.flatMap((t) => [...t.replace(/the limit of [\d.]+ mph/g, '').matchAll(/(\d+(?:\.\d+)?) mph/g)].map((m) => m[1]));
}

test('the headline and the entry, exit and consistency sentences give every speed to a tenth of a mph', () => {
  const r = defaultRoundabout();
  r.legs[0].entryRadius = r.legs[0].entryRadius * 1.6;
  for (const round of [defaultRoundabout(), r]) {
    const e = evaluate(round, {});
    const speeds = comparedSpeeds(e);
    assert.ok(speeds.length > 10);
    for (const v of speeds) assert.match(v, /^\d+\.\d{1,2}$/, `"${v} mph" has no decimal`);
    // The headline's fastest entry is the entry check's value, as written.
    assert.match(e.headline.text, new RegExp(`The fastest entry is ${mph1(e.checks.find((c) => c.id === 'entry-speed').value).replace('.', '\\.')},`));
  }
});

test('a speed difference reads on the same side of its limits as its status', () => {
  const warnAt = RULES.find((x) => x.id === 'speed.consistency.warn').value;
  for (const round of Object.values(shapes()).concat([defaultRoundabout()])) {
    const c = evaluate(round, {}).checks.find((x) => x.id === 'speed-consistency');
    for (const it of c.items.filter((i) => i.value !== null)) {
      const written = Math.max(...[...it.text.matchAll(/(?:changes|differs) by (\d+(?:\.\d+)?) mph/g)].map((m) => Number(m[1])));
      assert.equal(written > warnAt, it.status !== 'pass', it.text);
    }
  }
  // Pushed just past the warning line, the written difference is past it too.
  const base = evaluate(defaultRoundabout(), {}).checks.find((x) => x.id === 'speed-consistency').value;
  const c = evaluate(defaultRoundabout(), { 'speed.consistency.warn': base - 0.03 }).checks.find((x) => x.id === 'speed-consistency');
  const warned = c.items.filter((i) => i.status === 'warn');
  assert.ok(warned.length);
  for (const it of warned) assert.ok([...it.text.matchAll(/by (\d+(?:\.\d+)?) mph/g)].some((m) => Number(m[1]) > base - 0.03), it.text);
});

test('a shape that only warns counts its warnings as the geometry check\'s value, not "0 problems"', () => {
  const r = defaultRoundabout();
  for (const l of r.legs) l.entryRadius = l.entryRadius * 2.5;
  const g = evaluate(r, {}).checks.find((c) => c.id === 'geometry');
  assert.equal(g.status, 'warn');
  const warns = g.items.filter((i) => i.status === 'warn').length;
  assert.ok(warns > 0);
  assert.equal(g.value, warns);
  assert.equal(g.unit, warns === 1 ? 'warning' : 'warnings');
  const ok = evaluate(defaultRoundabout(), {}).checks.find((c) => c.id === 'geometry');
  assert.equal(ok.status, 'pass');
  assert.deepEqual([ok.value, ok.unit], [0, 'problems']);
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
