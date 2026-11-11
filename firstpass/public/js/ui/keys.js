// The keyboard, as in the CAD original: typing anywhere outside a text field goes to the command line without a click
// (or into the dynamic input box during a grip drag); Esc cancels the running command and clears the selection; Enter
// or Space repeats the last command; Delete removes the selected legs; Ctrl+Z undoes and Ctrl+Y redoes; Ctrl+1 opens
// Properties; F1 help, F2 the larger history, F3 object snap, F7 grid, F10 polar tracking, F12 dynamic input.
// Space held down with a left drag pans the drawing; a Space let go without a drag does what Space always did (when the
// command line is empty, it repeats the last command or takes the prompt's default).
// A new shortcut: one entry in FKEYS or CTRL.
const FKEYS = { F1: (a) => a.runCommand('HELP'), F2: (a) => a.cmdline.toggleExpand(), F3: (a) => a.toggle('osnap'), F7: (a) => a.toggle('grid'), F10: (a) => a.toggle('polar'), F12: (a) => a.toggle('dyn') };
const CTRL = { z: (a) => a.runCommand('U'), y: (a) => a.runCommand('REDO'), 1: (a) => a.ui.properties.open(), a: (a) => a.selectAll() };

const isField = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);

export function installKeys(app) {
  // Space with nothing typed: held, it pans with a left drag (viewport.js); let go without a drag, it is Space as before.
  // This listens first (capture), before the command line's own Space.
  const spaceFree = (e) => {
    const t = e.target;
    if (document.querySelector('dialog[open]') || e.ctrlKey || e.metaKey || e.altKey) return false;
    if (t === app.cmdline.input) { const w = app.runner.waiting(); return !app.cmdline.value() && !(w && w.type === 'text'); }
    return !isField(t);
  };
  document.addEventListener('keydown', (e) => {
    if (e.key !== ' ' || !(app.viewport.spaceHeld() || spaceFree(e))) return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat && !app.viewport.spaceHeld()) app.viewport.spaceDown();
  }, true);
  document.addEventListener('keyup', (e) => {
    if (e.key !== ' ' || !app.viewport.spaceHeld()) return;
    e.preventDefault();
    e.stopPropagation();
    if (!app.viewport.spaceUp()) app.cmdline.submit('');
  }, true);
  window.addEventListener('blur', () => { if (app.viewport.spaceHeld()) app.viewport.spaceUp(); });

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented) return;
    if (document.querySelector('dialog[open]')) return;
    const t = e.target;
    const inCmd = t === app.cmdline.input;
    if (FKEYS[e.key]) { e.preventDefault(); FKEYS[e.key](app); return; }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && CTRL[e.key.toLowerCase()]) {
      if (isField(t) && !inCmd && e.key.toLowerCase() !== '1') return;   // a text field keeps its own undo
      e.preventDefault();
      CTRL[e.key.toLowerCase()](app);
      return;
    }
    if (isField(t)) return;
    if (e.key === 'Escape') { e.preventDefault(); app.escape(); return; }
    if (app.viewport.dragging() && app.dyn.isOpen() && /^[-0-9.]$/.test(e.key)) { e.preventDefault(); app.dyn.typeKey(e.key); return; }
    if (e.key === 'Delete') {
      if (app.selectedLegs().length) { e.preventDefault(); app.runCommand('ERASE'); }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      app.cmdline.submit('');
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      app.cmdline.typeKey(e.key);
    }
  });
}
