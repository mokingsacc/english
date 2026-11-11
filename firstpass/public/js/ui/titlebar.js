// The title bar: the application button with our own FP mark (its menu: New, Open, Save, Export, Check myself, Report a
// problem, Help), the quick access toolbar (the commands with a qat place: new, open, save, undo, redo, export), the
// title "First Pass - <project name>" in the middle, and Report a problem at the right. A new quick access button:
// give its command a qat number.
import { h, ico, setText } from './dom.js';
import { tipFor } from './tooltip.js';
import { openMenu } from './menu.js';

const APP_MENU = [['NEW', 'New project'], ['OPEN', 'Open project'], ['QSAVE', 'Save'], null, ['EXPORT', 'Export DXF'], null,
  ['CHECKMYSELF', 'Check myself'], ['REPORT', 'Report a problem'], ['HELP', 'Commands']];

export function createTitlebar(app, root) {
  const appBtn = h('button', { class: 'appbtn', type: 'button', 'data-tip': 'First Pass', 'data-tip-text': 'Projects, export, Check myself and help.', 'aria-label': 'First Pass menu' }, ico('fp', 32));
  const qat = h('div', { class: 'qat' });
  for (const c of app.commands.filter((x) => x.qat).sort((a, b) => a.qat - b.qat)) {
    const label = { NEW: 'New', OPEN: 'Open', QSAVE: 'Save', U: 'Undo', REDO: 'Redo', EXPORT: 'Export DXF' }[c.name] || c.name;
    const iconName = { NEW: 'new', OPEN: 'open', QSAVE: 'save', U: 'undo', REDO: 'redo', EXPORT: 'export' }[c.name] || 'help';
    const b = h('button', { type: 'button', class: 'qat-btn', 'data-cmd': c.name, 'aria-label': label, ...tipFor(c, label) }, ico(iconName, 16));
    b.addEventListener('click', () => app.runCommand(c.name));
    qat.append(b);
  }
  const title = h('div', { class: 'title', text: 'First Pass' });
  const report = h('button', { type: 'button', class: 'tb-report', 'data-report-btn': '', 'data-tip': 'Report a problem', 'data-tip-text': 'Say what went wrong, add a screenshot, and copy it for Claude to fix.', 'aria-label': 'Report a problem' }, ico('report', 16), h('span', { text: 'Report a problem' }));
  const help = h('button', { type: 'button', class: 'tb-help', 'data-tip': 'Commands', 'data-tip-text': 'Lists every command (F1).', 'aria-label': 'Help' }, ico('help', 16));
  help.addEventListener('click', () => app.runCommand('HELP'));
  root.append(appBtn, qat, title, h('div', { class: 'tb-right' }, report, help));

  appBtn.addEventListener('click', () => {
    const r = appBtn.getBoundingClientRect();
    openMenu(APP_MENU.map((m) => (m ? { label: m[1], hint: m[0], run: () => (m[0] === 'REPORT' ? window.fpReport && window.fpReport() : app.runCommand(m[0])) } : { sep: true })), r.left, r.bottom + 1, { className: 'appmenu' });
  });

  return {
    update(project) {
      const t = `First Pass - ${project ? project.name : ''}`;
      setText(title, t);
      if (document.title !== t) document.title = t;
    },
  };
}
