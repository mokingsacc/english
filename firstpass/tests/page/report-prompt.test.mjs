// Report a problem's Copy for Claude line (public/js/shared/report-prompt.js): it works wherever she pastes it. It names
// the report and her words, tells Claude Code with the First Pass code to read the report and follow the fix-bugs skill,
// and tells any other Claude to ask her to send it to the person who runs First Pass. Nothing of her key goes in.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { claudePrompt, SKILL, OPENING } from '../../public/js/shared/report-prompt.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('the Copy for Claude line names the report, her words, and what each kind of Claude should do', () => {
  const t = claudePrompt({ id: 'bug_123', note: '  The   entry speed\nlooks wrong ', page: '/#p=p_1&k=<key>', state: { option: 'A', selection: ['leg:N'], hash: '#k=<key>', project_id: 'p_1' } });
  assert.ok(t.startsWith(`${OPENING} bug_123: "The entry speed looks wrong". Page: /#p=p_1&k=<key> (option: A, project_id: p_1). `), t);
  assert.match(t, /If you are Claude Code working in the First Pass code: read the report in full .* \{action: "get", id: "bug_123"\}, follow claude\/skills\/fix-bugs\/SKILL\.md, and tell me what you understood before changing anything\./);
  assert.match(t, /If you are any other Claude: do not try to fix it; tell me to send this whole message to the person who runs First Pass\.$/);
  assert.match(claudePrompt({ id: 'bug_9' }), /^First Pass problem report bug_9: \(a screenshot, no words\)\. Page: not known\. /);
  assert.match(claudePrompt({ id: 'bug_8', page: '/#k=abc123secret&p=p_1' }), /Page: \/#k=<key>&p=p_1\./, 'a key in the address is masked');
  assert.doesNotMatch(claudePrompt({ id: 'bug_8', page: '/#k=abc123secret&p=p_1' }), /abc123secret/);
  assert.ok(fs.existsSync(path.join(ROOT, SKILL)), 'the skill it names is there');
});

test('the sheet says the report is saved for the person who runs First Pass', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public/js/shared/report-sheet.js'), 'utf8');
  assert.match(src, /'Saved\. The person who runs First Pass can read it\.'/);
  assert.match(src, /from '\.\/report-prompt\.js'/);
  assert.doesNotMatch(src, /In Claude Code: fix this/);
});
