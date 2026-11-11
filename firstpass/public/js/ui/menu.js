// Shortcut menus (right click) and flyout lists: one floating menu at a time, closed by a click elsewhere, Esc or a
// choice. Items: { label, run, disabled, checked, sep: true, sub: [items], hint }. openMenu(items, x, y).
import { h } from './dom.js';

let open = null;

export function closeMenu() {
  if (!open) return false;
  open.remove();
  open = null;
  return true;
}

export function menuOpen() { return !!open; }

export function openMenu(items, x, y, { className = '' } = {}) {
  closeMenu();
  const el = build(items, className);
  document.body.append(el);
  open = el;
  const r = el.getBoundingClientRect();
  const nx = Math.min(x, window.innerWidth - r.width - 4), ny = Math.min(y, window.innerHeight - r.height - 4);
  el.style.left = `${Math.max(4, nx)}px`;
  el.style.top = `${Math.max(4, ny)}px`;
  const first = el.querySelector('button:not([disabled])');
  if (first) first.focus({ preventScroll: true });
  return el;
}

function build(items, className) {
  const el = h('div', { class: `menu ${className}`, role: 'menu' });
  const subs = [];
  for (const it of items) {
    if (it.sep) { el.append(h('div', { class: 'menu-sep', role: 'separator' })); continue; }
    if (it.title) { el.append(h('div', { class: 'menu-title', text: it.title })); continue; }
    const b = h('button', { type: 'button', role: 'menuitem', class: `menu-item${it.sub ? ' has-sub' : ''}${it.checked ? ' checked' : ''}`, disabled: it.disabled || false },
      h('span', { class: 'menu-check' }), h('span', { class: 'menu-label', text: it.label }), h('span', { class: 'menu-hint', text: it.hint || '' }));
    const row = h('div', { class: 'menu-row' }, b);
    if (it.sub) {
      const sub = build(it.sub, 'menu-sub');
      sub.hidden = true;
      subs.push(sub);
      row.append(sub);
      const showSub = () => { for (const s of subs) s.hidden = s !== sub; };
      b.addEventListener('pointerenter', showSub);
      b.addEventListener('click', (e) => { e.stopPropagation(); showSub(); });
    } else {
      b.addEventListener('click', (e) => { e.stopPropagation(); closeMenu(); if (it.run) it.run(); });
      b.addEventListener('pointerenter', () => { for (const s of subs) s.hidden = true; });
    }
    el.append(row);
  }
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  return el;
}

document.addEventListener('pointerdown', (e) => { if (open && !open.contains(e.target)) closeMenu(); }, true);
document.addEventListener('keydown', (e) => {
  if (!open) return;
  if (e.key === 'Escape') { closeMenu(); e.stopPropagation(); e.preventDefault(); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const list = [...open.querySelectorAll(':scope > .menu-row > button:not([disabled])')];
    const i = list.indexOf(document.activeElement);
    const n = list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length];
    if (n) n.focus();
    e.preventDefault();
  }
}, true);
window.addEventListener('blur', closeMenu);
