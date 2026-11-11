// The command line: a history scrollback above one input line with the >_ marker and "Type a command"; the running
// command's prompt sits before the input ("ICD Specify inscribed circle diameter <130.00>:") with its options in square
// brackets, each one clickable. As she types a command an autocomplete list opens above the line. Up and Down recall
// earlier input; F2 shows the history larger; Space ends a word as Enter does (except when typing a name).
//   const cl = createCmdline(app, root);  cl.echo('text', kind);  cl.prompt(spec | null);  cl.typeKey('I')
import { h, ico, setText } from './dom.js';
import { suggest } from '../commands/parser.js';
import { openMenu } from './menu.js';

const MAX_LINES = 400;

export function createCmdline(app, root) {
  const history = h('div', { class: 'cl-history', role: 'log', 'aria-live': 'polite', 'aria-label': 'Command history' });
  const promptEl = h('span', { class: 'cl-prompt' });
  const input = h('input', { class: 'cl-input', type: 'text', placeholder: 'Type a command', spellcheck: 'false', autocomplete: 'off', 'aria-label': 'Command line' });
  const recentBtn = h('button', { type: 'button', class: 'cl-recent', 'data-tip': 'Recent commands', 'data-tip-text': 'Runs one of the commands you used lately.', 'aria-label': 'Recent commands' }, ico('caretDown', 16));
  const marker = h('span', { class: 'cl-marker', 'aria-hidden': 'true' }, ico('cmd', 16));
  const list = h('div', { class: 'cl-suggest', role: 'listbox', hidden: true });
  const row = h('div', { class: 'cl-row' }, marker, recentBtn, promptEl, input);
  root.append(history, list, row);

  const typed = [];          // earlier input, for Up and Down
  const usedCommands = [];   // recent commands, for the recent button
  let recall = -1, pick = -1, items = [], spec = null, expanded = false;

  function echo(text, kind = 'note') {
    const line = h('div', { class: `cl-line k-${kind}`, text });
    history.append(line);
    while (history.childElementCount > MAX_LINES) history.firstElementChild.remove();
    history.scrollTop = history.scrollHeight;
    if (kind === 'command') {
      const name = text.replace(/^Command:\s*/, '');
      const i = usedCommands.indexOf(name);
      if (i >= 0) usedCommands.splice(i, 1);
      usedCommands.unshift(name);
      usedCommands.splice(10);
    }
  }

  function prompt(s) {
    spec = s;
    promptEl.textContent = '';
    if (!s) { input.placeholder = 'Type a command'; root.classList.remove('asking'); return; }
    root.classList.add('asking');
    input.placeholder = '';
    promptEl.append(h('span', { class: 'cl-cmdname', text: s.command }), ' ');
    // The options in square brackets become buttons, as in the CAD command line.
    const m = /^(.*)\[([^\]]+)\](.*)$/.exec(s.line);
    if (!m) { promptEl.append(s.line); return; }
    promptEl.append(m[1], '[');
    m[2].split('/').forEach((kw, i) => {
      if (i) promptEl.append('/');
      const b = h('button', { type: 'button', class: 'cl-kw', text: kw, 'data-kw': kw });
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => { app.runner.answer(kw); input.focus(); });
      promptEl.append(b);
    });
    promptEl.append(']', m[3]);
    hideList();
  }

  function submit(text) {
    const v = text !== undefined ? text : input.value;
    input.value = '';
    hideList();
    if (v.trim()) { typed.unshift(v.trim()); typed.splice(50); }
    recall = -1;
    app.runner.submit(v);
  }

  function showList() {
    const v = input.value;
    items = spec ? [] : suggest(app.commands, v, 9);
    pick = -1;
    if (!items.length) { hideList(); return; }
    list.textContent = '';
    items.forEach((it, i) => {
      const li = h('div', { class: 'cl-sug', role: 'option', 'data-i': i },
        h('span', { class: 'cl-sug-name', text: it.name }), h('span', { class: 'cl-sug-via', text: it.via !== it.name ? `(${it.via})` : '' }), h('span', { class: 'cl-sug-desc', text: it.description }));
      li.addEventListener('mousedown', (e) => { e.preventDefault(); submit(it.name); });
      list.append(li);
    });
    list.hidden = false;
  }
  function hideList() { list.hidden = true; items = []; pick = -1; }
  function mark() { [...list.children].forEach((c, i) => c.classList.toggle('on', i === pick)); }

  input.addEventListener('input', () => { recall = -1; showList(); });
  input.addEventListener('blur', () => setTimeout(hideList, 120));
  input.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      if (pick >= 0 && items[pick]) submit(items[pick].name); else submit();
      return;
    }
    if (k === ' ' && !(spec && spec.type === 'text')) {
      e.preventDefault(); e.stopPropagation();
      if (pick >= 0 && items[pick]) submit(items[pick].name); else submit();
      return;
    }
    if (k === 'Tab' && items.length) {
      e.preventDefault();
      input.value = items[Math.max(0, pick)].name;
      showList();
      return;
    }
    if ((k === 'ArrowUp' || k === 'ArrowDown') && !list.hidden && items.length && input.value && recall < 0) {
      e.preventDefault();
      pick = k === 'ArrowDown' ? (pick + 1) % items.length : (pick - 1 + items.length) % items.length;
      mark();
      return;
    }
    if (k === 'ArrowUp' || k === 'ArrowDown') {
      e.preventDefault();
      if (!typed.length) return;
      recall = k === 'ArrowUp' ? Math.min(typed.length - 1, recall + 1) : Math.max(-1, recall - 1);
      input.value = recall >= 0 ? typed[recall] : '';
      hideList();
      input.setSelectionRange(input.value.length, input.value.length);
      return;
    }
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); input.value = ''; hideList(); app.escape(); }
  });

  recentBtn.addEventListener('click', () => {
    const r = recentBtn.getBoundingClientRect();
    const names = usedCommands.length ? usedCommands : ['ICD', 'LEG', 'ZOOM', 'CHECK'];
    openMenu([{ title: 'Recent commands' }, ...names.map((n) => ({ label: n, run: () => app.runCommand(n) }))], r.left, r.top - 8 - names.length * 26 - 30);
  });

  history.addEventListener('dblclick', () => expand(!expanded));

  function expand(on) {
    expanded = on;
    root.classList.toggle('expanded', on);
    history.scrollTop = history.scrollHeight;
  }

  return {
    echo, prompt, submit, expand, input,
    toggleExpand: () => expand(!expanded),
    focus() { if (document.activeElement !== input) input.focus({ preventScroll: true }); },
    /** A key typed while the focus was elsewhere (the drawing): it goes to the command line. */
    typeKey(ch) {
      input.focus({ preventScroll: true });
      input.value += ch;
      input.setSelectionRange(input.value.length, input.value.length);
      recall = -1;
      showList();
    },
    value: () => input.value,
    clearInput() { input.value = ''; hideList(); },
    recentCommands: () => usedCommands.slice(),
    lastLines(n = 5) { return [...history.children].slice(-n).map((l) => l.textContent); },
    setPromptText(t) { setText(promptEl, t); },
  };
}
