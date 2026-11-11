// The line Report a problem's Copy for Claude puts on her clipboard (report-sheet.js), kept pure so it can be tested. It
// works wherever she pastes it: it names the report and her words; Claude Code working in the First Pass code is told to
// read the report in full and follow the fix-bugs skill; any other Claude is told to ask her to send the line to the
// person who looks after First Pass, who can read the report on the server.
export const SKILL = 'claude/skills/fix-bugs/SKILL.md';
export const OPENING = 'First Pass problem report';

const one = (t, n) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, n);

/** The prompt for a report: { id, note, page, state } with state the page's flat facts (strings and numbers only). */
export function claudePrompt({ id, note = '', page = '', state = null } = {}) {
  const words = one(note, 600);
  const open = Object.entries(state || {}).filter(([k, v]) => k !== 'hash' && v != null && v !== '' && typeof v !== 'object').slice(0, 6).map(([k, v]) => `${k}: ${one(v, 60)}`).join(', ');
  const where = one(page, 200).replace(/([#&]k=)[^&]*/, '$1<key>');   // her key never goes on the clipboard
  return `${OPENING} ${id}: ${words ? `"${words}"` : '(a screenshot, no words)'}. Page: ${where || 'not known'}${open ? ` (${open})` : ''}. `
    + `If you are Claude Code working in the First Pass code: read the report in full (traces, screenshot and the project) with the First Pass connector's bugs tool {action: "get", id: "${id}"}, follow ${SKILL}, and tell me what you understood before changing anything. `
    + 'If you are any other Claude: do not try to fix it; tell me to send this whole message to the person who looks after First Pass.';
}
