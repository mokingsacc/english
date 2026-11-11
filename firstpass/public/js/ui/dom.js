// Small DOM helpers the page's parts share: h() to make elements, setText()/setAttr() that write only when the value
// changed (so panels touch only the rows whose values changed, once per frame at most), keyed() to keep a list of
// rows in step with data without rebuilding it, and number formatting for the palettes.

import { icon } from '../../icons/icons.js';

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}

export function ico(name, size = 16) {
  const s = document.createElement('span');
  s.className = `icw s${size}`;
  s.innerHTML = icon(name, size);
  return s;
}

export function setText(el, text) {
  const t = text == null ? '' : String(text);
  if (el.__t !== t) { el.__t = t; el.textContent = t; }
}

export function setAttr(el, name, value) {
  const key = `__a_${name}`;
  if (el[key] === value) return;
  el[key] = value;
  if (value === null || value === undefined || value === false) el.removeAttribute(name);
  else el.setAttribute(name, value === true ? '' : String(value));
}

export function setClass(el, name, on) {
  if (el.classList.contains(name) !== !!on) el.classList.toggle(name, !!on);
}

/**
 * Keeps the children of `parent` in step with `items` by key: make(item) builds a row once, update(row, item) writes
 * only what changed. Rows for keys that went away are removed; order follows items.
 */
export function keyed(parent, items, keyOf, make, update) {
  const old = parent.__rows || new Map();
  const next = new Map();
  let before = parent.firstChild;
  for (const it of items) {
    const k = keyOf(it);
    let row = old.get(k);
    if (!row) row = make(it);
    update(row, it);
    next.set(k, row);
    if (row !== before) parent.insertBefore(row, before);
    else before = before.nextSibling;
  }
  for (const [k, row] of old) if (!next.has(k)) row.remove();
  parent.__rows = next;
}

/** A value as a palette shows it: two decimals and the unit ("130.00 ft"), or a dash for nothing. */
export function showValue(v, unit, places = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return '-';
  if (v === Infinity) return 'straight';
  if (typeof v !== 'number') return String(v);
  const s = Math.abs(v) >= 100000 ? v.toFixed(2) : v.toFixed(places);
  return unit ? `${s} ${unit}` : s;
}

/** Whole numbers with thousands separators ("26,356"). */
export function whole(v) {
  if (!Number.isFinite(v)) return '-';
  return String(Math.round(v)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export const STATUS_WORD = { pass: 'Pass', warn: 'Warning', fail: 'Fail', info: 'For information' };
