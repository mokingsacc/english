// The file tabs above the drawing: one tab per option (Option A, Option B, ...) as drawing tabs, the one on screen
// highlighted, and "+" to copy the option on screen to the next letter. Right click a tab to rename, copy or delete it.
import { h, ico, setText, setClass, keyed } from './dom.js';
import { openMenu } from './menu.js';

export function createDocTabs(app, root) {
  const list = h('div', { class: 'dt-list', role: 'tablist', 'aria-label': 'Options' });
  const plus = h('button', { type: 'button', class: 'dt-plus', 'aria-label': 'Copy this option', 'data-tip': 'Copy option', 'data-tip-text': 'Copies the option on screen to a new option with the next letter.', 'data-tip-cmd': 'OPTION' }, ico('plus', 16));
  plus.addEventListener('click', () => app.runCommand('OPTION'));
  root.append(list, plus);

  function make(o) {
    const b = h('button', { type: 'button', class: 'dt-tab', role: 'tab', 'data-opt': o.id }, ico('roundabout', 16), h('span', { class: 'dt-name' }), h('span', { class: 'dt-st' }));
    b.addEventListener('click', () => app.setOption(b.dataset.opt));
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      app.setOption(b.dataset.opt);
      openMenu([
        { label: 'Rename...', run: () => { app.select([]); app.runCommand('RENAME'); } },
        { label: 'Copy to a new option', run: () => app.runCommand('OPTION') },
        { sep: true },
        { label: 'Delete option...', run: () => app.runCommand('DELETEOPTION') },
      ], e.clientX, e.clientY);
    });
    return b;
  }

  return {
    update(st, current) {
      keyed(list, st.project.options, (o) => o.id, make, (b, o) => {
        setText(b.querySelector('.dt-name'), o.name);
        setClass(b, 'active', o.id === current.id);
        b.setAttribute('aria-selected', o.id === current.id ? 'true' : 'false');
        const res = app.evaluateOption(o);
        const s = !res ? '' : !res.ok || res.headline.fails ? 'fail' : res.headline.warns ? 'warn' : 'pass';
        const dot = b.querySelector('.dt-st');
        if (dot.dataset.s !== s) { dot.dataset.s = s; dot.title = { fail: 'A check fails', warn: 'A check warns', pass: 'All checks pass', '': '' }[s]; }
      });
    },
  };
}
