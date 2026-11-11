// Tooltips in two stages, as CAD ribbons show them: rest on a button and its name, its command and one line come up;
// stay a little longer and the detail follows. Any element with data-tip="Name" (and data-tip-cmd, data-tip-text,
// data-tip-more) gets one; nothing else to wire. One tooltip element serves the whole page.
import { h, setText } from './dom.js';

const FIRST_MS = 450, SECOND_MS = 1600;

export function createTooltips(root = document.body) {
  const box = h('div', { class: 'tip', role: 'tooltip', hidden: true },
    h('div', { class: 'tip-name' }), h('div', { class: 'tip-text' }), h('div', { class: 'tip-more', hidden: true }), h('div', { class: 'tip-cmd' }));
  document.body.append(box);
  const [nameEl, textEl, moreEl, cmdEl] = box.children;
  let target = null, t1 = 0, t2 = 0;

  const hide = () => { clearTimeout(t1); clearTimeout(t2); box.hidden = true; target = null; };
  const place = () => {
    if (!target) return;
    const r = target.getBoundingClientRect();
    const bw = box.offsetWidth, bh = box.offsetHeight;
    let x = Math.min(window.innerWidth - bw - 6, Math.max(6, r.left));
    let y = r.bottom + 6;
    if (y + bh > window.innerHeight - 6) y = Math.max(6, r.top - bh - 6);
    box.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };
  const show = (stage) => {
    if (!target) return;
    const d = target.dataset;
    setText(nameEl, d.tip);
    setText(textEl, d.tipText || '');
    textEl.hidden = !d.tipText;
    setText(cmdEl, d.tipCmd ? `Command: ${d.tipCmd}` : '');
    cmdEl.hidden = !d.tipCmd;
    moreEl.hidden = stage < 2 || !d.tipMore;
    setText(moreEl, d.tipMore || '');
    box.hidden = false;
    place();
  };

  root.addEventListener('pointerover', (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el === target) return;
    hide();
    if (!el || e.pointerType === 'touch') return;
    target = el;
    t1 = setTimeout(() => show(1), FIRST_MS);
    t2 = setTimeout(() => show(2), SECOND_MS);
  });
  root.addEventListener('pointerout', (e) => {
    if (!target) return;
    const to = e.relatedTarget;
    if (to && target.contains(to)) return;
    hide();
  });
  root.addEventListener('pointerdown', hide, true);
  root.addEventListener('keydown', hide, true);
  return { hide };
}

/** The tooltip attributes for a command button. */
export function tipFor(cmd, label) {
  return {
    'data-tip': label || cmd.name,
    'data-tip-text': cmd.description || '',
    'data-tip-cmd': cmd.name,
    'data-tip-more': (cmd.aliases || []).filter((a) => /^[A-Z]/.test(a)).length
      ? `Type ${cmd.name} or ${(cmd.aliases || []).filter((a) => /^[A-Z]/.test(a)).join(' or ')} on the command line, then Enter or Space.`
      : `Type ${cmd.name} on the command line, then Enter or Space.`,
  };
}
