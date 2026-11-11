// The command line and the commands registry: AutoCAD style words and prompts, the runner (typed-ahead answers, Esc,
// Enter repeats, unknown commands), and the registry's promises: unique names and aliases, every ribbon button on a
// real tab with a real icon, the quick access toolbar in order, plain words in every description.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shortcutOf, matchKeyword, parseNumber, parsePoint, formatPrompt, findCommand, suggest, words } from '../../public/js/commands/parser.js';
import { createRunner } from '../../public/js/commands/runner.js';
import { COMMANDS, ribbonEntries } from '../../public/js/commands/index.js';
import { TABS } from '../../public/js/ui/ribbon.js';
import { ICONS } from '../../public/icons/icons.js';
import site, { parseLatLon } from '../../public/js/commands/site.js';
import newProject from '../../public/js/commands/new.js';
import { op, applyOps } from '../../public/js/app/ops.js';
import { sampleProject } from '../../public/js/app/sample.js';

test('option keywords match by their capital letters or by the word', () => {
  assert.equal(shortcutOf('eXit'), 'X');
  assert.equal(shortcutOf('pHoto'), 'H');
  const kws = ['Extents', 'Window', 'Object', 'Previous'];
  assert.equal(matchKeyword(kws, 'e'), 'Extents');
  assert.equal(matchKeyword(kws, 'WIN'), 'Window');
  assert.equal(matchKeyword(kws, 'previous'), 'Previous');
  assert.equal(matchKeyword(kws, 'z'), null);
  assert.equal(matchKeyword(['Curbs', 'pHoto', 'Paths'], 'h'), 'pHoto');
});

test('numbers and points are read as she types them', () => {
  assert.equal(parseNumber('110'), 110);
  assert.equal(parseNumber(' 110.5 ft'), 110.5);
  assert.equal(parseNumber("110'"), 110);
  assert.equal(parseNumber('-3'), -3);
  assert.equal(parseNumber('abc'), null);
  assert.deepEqual(parsePoint('6636071.5,1976790.3'), { x: 6636071.5, y: 1976790.3 });
  assert.deepEqual(parsePoint('@10,-5', { x: 100, y: 200 }), { x: 110, y: 195 });
  assert.equal(parsePoint('@10,-5'), null);
  assert.equal(parsePoint('10'), null);
  assert.deepEqual(words('  ICD   110 '), ['ICD', '110']);
});

test('prompts read like the CAD original', () => {
  assert.equal(formatPrompt({ text: 'Specify inscribed circle diameter', def: 130 }), 'Specify inscribed circle diameter <130.00>:');
  assert.equal(formatPrompt({ text: 'Specify corner of window, or', join: ' ', keywords: ['Extents', 'Window'], def: 'Extents' }),
    'Specify corner of window, or [Extents/Window] <Extents>:');
  assert.equal(formatPrompt({ text: 'Select a leg' }), 'Select a leg:');
});

test('commands are found by name or alias in any case, and autocomplete puts the exact word first', () => {
  assert.equal(findCommand(COMMANDS, 'icd').name, 'ICD');
  assert.equal(findCommand(COMMANDS, 'z').name, 'ZOOM');
  assert.equal(findCommand(COMMANDS, 'e').name, 'ERASE');
  assert.equal(findCommand(COMMANDS, 'nothing'), null);
  const s = suggest(COMMANDS, 'z');
  assert.equal(s[0].name, 'ZOOM');
  assert.equal(s[0].via, 'Z');
  assert.ok(suggest(COMMANDS, 'pro').some((x) => x.name === 'PROPERTIES'));
  assert.deepEqual(suggest(COMMANDS, 'icd 1'), []);
});

// A runner with one test command that asks for a number then a keyword, and records what it got.
function harness() {
  const lines = [], prompts = [], got = [];
  const cmd = {
    name: 'TRY', aliases: ['T'], description: 'A test command.',
    async run(ctx) {
      const n = await ctx.number({ text: 'Specify size', def: 5, min: 1, max: 9, unit: 'ft' });
      const k = await ctx.keyword({ text: 'Choose', join: ' ', keywords: ['Yes', 'No'], def: 'No' });
      got.push([n, k]);
    },
  };
  const runner = createRunner({ commands: [cmd], io: { echo: (t, kind) => lines.push([kind, t]), prompt: (s) => prompts.push(s) } });
  return { runner, lines, prompts, got };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('a line with the answers typed ahead runs the whole command, as "ICD 110" does', async () => {
  const h = harness();
  await h.runner.run('TRY', ['7', 'y']);
  assert.deepEqual(h.got, [[7, 'Yes']]);
  assert.deepEqual(h.lines.map((l) => l[1]), ['Command: TRY', 'Specify size <5.00>: 7', 'Choose [Yes/No] <No>: y']);
});

test('prompts wait for an answer; Enter takes the default; a bad answer asks again', async () => {
  const h = harness();
  const done = h.runner.run('t');
  await tick();
  assert.equal(h.runner.waiting().type, 'number');
  h.runner.submit('12');
  assert.match(h.lines.at(-1)[1], /^Enter a number from 1 to 9 ft\.$/);
  assert.equal(h.runner.waiting().type, 'number');
  h.runner.submit('');
  await tick();
  assert.equal(h.runner.waiting().type, 'keyword');
  h.runner.answer('Yes');
  await done;
  assert.deepEqual(h.got, [[5, 'Yes']]);
  assert.equal(h.runner.running(), null);
});

test('Esc cancels the running command; Enter on an empty line repeats the last one', async () => {
  const h = harness();
  const done = h.runner.run('TRY');
  await tick();
  assert.ok(h.runner.cancel());
  await done;
  assert.equal(h.lines.at(-1)[1], '*Cancel*');
  assert.deepEqual(h.got, []);
  assert.equal(h.runner.last(), 'TRY');
  h.runner.submit('');
  await tick();
  assert.equal(h.runner.running(), 'TRY');
  h.runner.cancel();
});

test('an unknown command says so in plain words', async () => {
  const h = harness();
  assert.equal(await h.runner.run('XYZ'), false);
  assert.deepEqual(h.lines.at(-1), ['error', 'Unknown command "XYZ". Press F1 for help.']);
});

test('every command has a unique name and aliases, a description in plain words, and a run', () => {
  const seen = new Set();
  for (const c of COMMANDS) {
    for (const w of [c.name, ...(c.aliases || [])]) {
      assert.ok(!seen.has(w), `${w} is used twice`);
      assert.equal(w, w.toUpperCase(), `${w} is not in capitals`);
      seen.add(w);
    }
    assert.equal(typeof c.run, 'function', c.name);
    assert.ok(c.description && c.description.length > 10, `${c.name} has no description`);
    assert.doesNotMatch(c.description, /->|=>|[<>|~^]/, `${c.name} description has a symbol`);
  }
});

test('every ribbon button is on a tab that exists, with an icon that exists, and runs a command', () => {
  const tabs = new Map(TABS.map((t) => [t.id, t]));
  const entries = ribbonEntries();
  assert.ok(entries.length > 20);
  for (const e of entries) {
    assert.ok(tabs.has(e.tab), `${e.command} names tab ${e.tab}`);
    assert.ok(ICONS[e.icon], `${e.command} names icon ${e.icon}`);
    assert.ok(COMMANDS.some((c) => c.name === e.command));
    assert.ok(e.label && e.panel, `${e.command} needs a label and a panel`);
    for (const f of e.flyout || []) assert.ok(ICONS[f.icon], `${e.command} flyout icon ${f.icon}`);
  }
  // Each listed panel has at least one button, so no empty panel is drawn.
  for (const t of TABS) for (const p of t.panels) assert.ok(entries.some((e) => e.tab === t.id && e.panel === p), `${t.id} panel ${p} is empty`);
  for (const id of ['home', 'roundabout', 'analyze', 'output', 'manage']) assert.ok(tabs.has(id));
});

test('the quick access toolbar has new, open, save, undo, redo and export in that order', () => {
  const qat = COMMANDS.filter((c) => c.qat).sort((a, b) => a.qat - b.qat).map((c) => c.name);
  assert.deepEqual(qat, ['NEW', 'OPEN', 'QSAVE', 'U', 'REDO', 'EXPORT']);
});

test('right-click menu entries name a scope the menu knows', () => {
  for (const c of COMMANDS) if (c.menu) assert.ok(['any', 'round', 'leg'].includes(c.menu.when), c.name);
});

test('the design.md command words all exist', () => {
  for (const w of ['ICD', 'MOVE', 'LEG', 'ZOOM', 'U', 'OPTION', 'EXPORT', 'CHECK', 'ERASE', 'PAN', 'REDO', 'PROPERTIES', 'LAYER', 'COMPARE', 'HELP']) {
    assert.ok(findCommand(COMMANDS, w), w);
  }
});

test('every icon is an SVG fragment drawn on the 32 grid with no outside files or text', () => {
  for (const [name, svg] of Object.entries(ICONS)) {
    assert.equal(typeof svg, 'string', name);
    assert.doesNotMatch(svg, /<text|href=|url\(/i, name);
  }
});

test('a site is read as Google Maps copies it, and in degrees, minutes and seconds', () => {
  assert.deepEqual(parseLatLon('34.0522, -118.2437'), { lat: 34.0522, lon: -118.2437 });
  assert.deepEqual(parseLatLon('34.0522,-118.2437'), { lat: 34.0522, lon: -118.2437 });
  assert.deepEqual(parseLatLon('34.0522 -118.2437'), { lat: 34.0522, lon: -118.2437 });
  assert.deepEqual(parseLatLon('34.0522° N, 118.2437° W'), { lat: 34.0522, lon: -118.2437 });
  assert.deepEqual(parseLatLon('118.2437 W 34.0522 N'), { lat: 34.0522, lon: -118.2437 });
  const dms = parseLatLon('34°03\'08.0"N 118°14\'37.3"W');
  assert.ok(Math.abs(dms.lat - 34.0522) < 1e-4 && Math.abs(dms.lon + 118.2437) < 1e-4);
  assert.deepEqual(parseLatLon('34.0522,'), { lat: 34.0522 });
  for (const bad of ['', 'downtown', '1, 2, 3']) assert.equal(parseLatLon(bad), null, bad);
});

// SITE and NEW run on a page stand-in: the ops applied as the page applies them, the view and the server recorded.
function page({ mode = 'local' } = {}) {
  const lines = [], views = [], made = [];
  let project = { ...sampleProject(), id: mode === 'server' ? 'p_1' : null, seq: 0 };
  const context = (base) => {
    const ctx = {
      ...base, op,
      project: () => project,
      option: () => project.options[0],
      round: () => project.options[0].round,
      change(ops, summary, { quiet = false } = {}) {
        try { project = applyOps(project, ops); } catch (e) { base.echo(e.message, 'error'); return { ok: false, error: e.message }; }
        if (!quiet) base.echo(summary || 'changed', 'done');
        return { ok: true, summary };
      },
      view: { window: (a, b) => views.push([a, b]) },
      app: {
        sync: { mode: () => mode, resetLocal: () => { project = { ...sampleProject(), id: null, seq: 0 }; } },
        zoomFirst: () => views.push('first'),
        api: { createProject: async (body) => { made.push(body); return { ok: true, data: { project: { id: 'p_2', name: body.name, epsg: body.site ? 2229 : 2226, site: body.site || null } } }; } },
        openProject: async () => ({ ok: true }),
      },
    };
    return ctx;
  };
  const runner = createRunner({ commands: [site, newProject], io: { echo: (t, kind) => lines.push([kind, t]), prompt: () => {} }, context });
  return { runner, lines, views, made, project: () => project };
}

test('SITE (LOCATE): pasted after the command, the drawing goes to Los Angeles in zone 5 and the view follows', async () => {
  const h = page();
  await h.runner.run('LOCATE', ['34.0522,', '-118.2437']);
  assert.equal(h.project().epsg, 2229);
  assert.deepEqual(h.project().site, { lat: 34.0522, lon: -118.2437 });
  assert.equal(h.views.length, 1);
  const [a, b] = h.views[0];
  const c = h.project().options[0].round.center;
  assert.ok(a.x < c.x && c.x < b.x && a.y < c.y && c.y < b.y, 'the view frames the roundabout at its new place');
  assert.ok(findCommand(COMMANDS, 'SITE') && findCommand(COMMANDS, 'LOCATE'));
  assert.ok(ribbonEntries().some((e) => e.command === 'SITE' && e.tab === 'home' && e.panel === 'Modify'));
});

test('SITE says why a place cannot be used and asks again; Enter keeps the site', async () => {
  const h = page();
  await h.runner.run('SITE', ['36.1699,-115.1398', 'nowhere', '37.7749,-122.4194']);
  assert.ok(h.lines.some(([k, t]) => k === 'error' && /^36\.1699, -115\.1398 is outside California\./.test(t)));
  assert.ok(h.lines.some(([k, t]) => k === 'error' && /as Google Maps copies them/.test(t)));
  assert.equal(h.project().epsg, 2227);
  const before = JSON.stringify(h.project());
  await h.runner.run('SITE', ['']);
  assert.equal(JSON.stringify(h.project()), before);
});

test('NEW asks for the site after the name: Enter keeps the sample, a place in California is sent to the server', async () => {
  const s = page({ mode: 'server' });
  await s.runner.run('NEW', ['Elm', '']);
  assert.deepEqual(s.made, [{ sample: true, name: 'Elm' }]);
  await s.runner.run('NEW', ['Downtown', '34.0522,-118.2437']);
  assert.deepEqual(s.made[1], { sample: true, name: 'Downtown', site: { lat: 34.0522, lon: -118.2437 } });
  assert.match(s.lines.at(-1)[1], /^Made and opened the project "Downtown" at 34\.0522, -118\.2437 in California zone 5 \(EPSG 2229\)\.$/);
  // With no server, the fresh sample is placed on the page.
  const l = page();
  await l.runner.run('NEW', ['37.7749, -122.4194']);
  assert.equal(l.project().epsg, 2227);
  assert.match(l.lines.at(-1)[1], /^A fresh sample is open in California zone 3 \(EPSG 2227\)\./);
  const k = page();
  await k.runner.run('NEW', ['']);
  assert.equal(k.project().epsg, 2226);
  assert.deepEqual(k.views, ['first']);
});
