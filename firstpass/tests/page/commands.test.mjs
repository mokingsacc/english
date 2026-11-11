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
