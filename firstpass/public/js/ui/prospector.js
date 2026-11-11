// Prospector, the Toolspace's tree: the project, its Options, each option with its Roundabout, Legs, Fastest paths and
// Checks, with counts and status icons; branches expand and collapse; right click gives Properties, Zoom to, Delete and
// the like. Drawn as a flat list of visible rows kept in step by key (ui/dom.js keyed), so a change writes only the rows
// it touches. A new branch: add its rows in rowsOf().
import { h, ico, setText, setAttr, keyed } from './dom.js';
import { openMenu } from './menu.js';
import { prefs } from '../app/prefs.js';
import { checkNotes } from './checks-view.js';

const KIND_WORD = { through: 'through', left: 'left turn', right: 'right turn' };

export function createProspector(app, body) {
  const tree = h('div', { class: 'tree', role: 'tree', 'aria-label': 'Prospector' });
  body.append(tree);
  const open = new Set(prefs.get('prospector.open', ['project', 'options', 'opt:A', 'round:A', 'legs:A', 'checks:A']));
  const shut = new Set(prefs.get('prospector.shut', []));   // note branches are open unless she closed them
  const save = () => { prefs.set('prospector.open', [...open]); prefs.set('prospector.shut', [...shut]); };
  const isOpen = (r) => (r.notesBranch ? !shut.has(r.key) : open.has(r.key));

  function worst(list) {
    if (list.includes('fail')) return 'fail';
    if (list.includes('warn')) return 'warn';
    if (list.every((s) => s === 'pass' || s === 'info')) return list.includes('pass') ? 'pass' : 'info';
    return 'info';
  }

  function rowsOf(st, current) {
    const p = st.project;
    const out = [];
    const add = (r) => out.push(r);
    add({ key: 'project', depth: 0, icon: 'project', label: p.name, branch: true });
    if (!open.has('project')) return out;
    add({ key: 'options', depth: 1, icon: 'folder', label: 'Options', count: p.options.length, branch: true });
    if (!open.has('options')) return out;
    for (const o of p.options) {
      const res = app.evaluateOption(o);
      const status = !res ? 'info' : !res.ok ? 'fail' : worst(res.checks.map((c) => c.status));
      add({ key: `opt:${o.id}`, depth: 2, icon: 'roundabout', label: o.name, status, branch: true, current: o.id === current.id, option: o.id });
      if (!open.has(`opt:${o.id}`)) continue;
      add({ key: `round:${o.id}`, depth: 3, icon: 'roundabout', label: 'Roundabout', branch: true, option: o.id, obj: 'round' });
      if (!open.has(`round:${o.id}`)) continue;
      add({ key: `legs:${o.id}`, depth: 4, icon: 'folder', label: 'Legs', count: o.round.legs.length, branch: true, option: o.id });
      if (open.has(`legs:${o.id}`)) {
        for (const l of o.round.legs) {
          const legStatus = res && res.ok ? worst(res.checks.flatMap((c) => c.items.filter((it) => it.leg === l.id).map((it) => it.status)).concat(['pass'])) : 'info';
          add({ key: `leg:${o.id}:${l.id}`, depth: 5, icon: 'leg', label: l.name, status: legStatus, option: o.id, obj: `leg:${l.id}` });
        }
      }
      const moves = res && res.ok ? res.movements : [];
      add({ key: `paths:${o.id}`, depth: 4, icon: 'paths', label: 'Fastest paths', count: moves.length, branch: true, option: o.id });
      if (open.has(`paths:${o.id}`)) {
        const name = (id) => (o.round.legs.find((l) => l.id === id) || {}).name || id;
        for (const m of moves) {
          const v = m.ok ? Math.max(...['V1', 'V2', 'V3', 'V4', 'V5'].map((k) => m.V[k] || 0)) : null;
          add({ key: `path:${o.id}:${m.id}`, depth: 5, icon: 'path', label: `${name(m.from)} to ${name(m.to)}, ${KIND_WORD[m.kind] || m.kind}${v ? `: top ${Math.round(v)} mph` : ''}`, status: m.ok ? null : 'fail', option: o.id, movement: m.id });
        }
      }
      const checks = res ? res.checks : [];
      add({ key: `checks:${o.id}`, depth: 4, icon: 'check', label: 'Checks', count: checks.length, branch: true, option: o.id, status: checks.length ? worst(checks.map((c) => c.status)) : null });
      if (open.has(`checks:${o.id}`)) {
        for (const c of checks) {
          // A check with notes (a corner built tighter, an island built longer) opens to show them, until she closes it.
          const notes = checkNotes(c), key = `check:${o.id}:${c.id}`;
          add({ key, depth: 5, icon: null, label: c.title, status: c.status, option: o.id, check: c.id, branch: notes.length > 0, notesBranch: notes.length > 0, count: notes.length || null });
          if (notes.length && isOpen({ key, notesBranch: true })) {
            notes.forEach((n, i) => add({ key: `${key}:note:${i}`, depth: 6, icon: null, label: n.text, status: n.status, option: o.id, check: c.id, note: true }));
          }
        }
      }
    }
    return out;
  }

  function make(r) {
    const caret = h('span', { class: 'tw' });
    const iconSlot = h('span', { class: 'ti' });
    const label = h('span', { class: 'tl' });
    const count = h('span', { class: 'tc' });
    const status = h('span', { class: 'ts' });
    const row = h('div', { class: 'tr', role: 'treeitem', tabindex: '-1' }, caret, iconSlot, label, count, status);
    row.__parts = { caret, iconSlot, label, count, status };
    caret.addEventListener('click', (e) => { e.stopPropagation(); toggle(row.__r); });
    row.addEventListener('click', () => choose(row.__r));
    row.addEventListener('dblclick', () => { if (row.__r.branch && !row.__r.obj && !row.__r.check) toggle(row.__r); else zoomTo(row.__r); });
    row.addEventListener('contextmenu', (e) => { e.preventDefault(); menu(row.__r, e.clientX, e.clientY); });
    return row;
  }

  function update(row, r) {
    row.__r = r;
    const { caret, iconSlot, label, count, status } = row.__parts;
    row.style.paddingLeft = `${4 + r.depth * 12}px`;
    const caretName = r.branch ? (isOpen(r) ? 'caretDown' : 'caretRight') : '';
    if (caret.__n !== caretName) { caret.__n = caretName; caret.innerHTML = ''; if (caretName) caret.append(ico(caretName, 16)); }
    if (iconSlot.__n !== r.icon) { iconSlot.__n = r.icon; iconSlot.innerHTML = ''; if (r.icon) iconSlot.append(ico(r.icon, 16)); }
    setText(label, r.label);
    setAttr(label, 'title', r.label);
    setText(count, r.count != null ? `(${r.count})` : '');
    const st = r.status || '';
    if (status.__n !== st) { status.__n = st; status.innerHTML = ''; if (st) status.append(ico(st, 16)); setAttr(status, 'title', st ? { pass: 'Pass', warn: 'Warning', fail: 'Fails', info: 'For information' }[st] : null); }
    setAttr(row, 'aria-expanded', r.branch ? String(isOpen(r)) : null);
    row.classList.toggle('current', !!r.current);
  }

  function toggle(r) {
    if (!r.branch) return;
    if (r.notesBranch) { if (shut.has(r.key)) shut.delete(r.key); else shut.add(r.key); }
    else if (open.has(r.key)) open.delete(r.key); else open.add(r.key);
    save();
    app.request('tree');
  }

  function choose(r) {
    if (r.option && r.option !== app.option().id && (r.obj || r.check || r.movement || r.key.startsWith('opt:'))) app.setOption(r.option);
    if (r.obj) app.select([r.obj]);
    if (r.check) app.focusCheck(r.check);
    if (r.branch && !r.obj && !r.check && !r.key.startsWith('opt:')) toggle(r);
  }

  function zoomTo(r) {
    if (r.option && r.option !== app.option().id) app.setOption(r.option);
    if (r.obj) app.zoomToKeys([r.obj]);
    else if (r.check) app.focusCheck(r.check, true);
    else if (r.movement) app.zoomToWhere({ movements: [r.movement] });
    else app.zoomExtents();
  }

  function menu(r, x, y) {
    const items = [];
    if (r.key.startsWith('opt:')) {
      items.push({ label: 'Make current', run: () => app.setOption(r.option) });
      items.push({ label: 'Rename...', run: () => { app.setOption(r.option); app.select([]); app.runCommand('RENAME'); } });
      items.push({ label: 'Copy to a new option', run: () => { app.setOption(r.option); app.runCommand('OPTION'); } });
      items.push({ sep: true });
      items.push({ label: 'Zoom to', run: () => zoomTo(r) });
      items.push({ label: 'Delete option...', run: () => { app.setOption(r.option); app.runCommand('DELETEOPTION'); } });
    } else if (r.obj) {
      items.push({ label: 'Properties', run: () => { choose(r); app.ui.properties.open(); } });
      items.push({ label: 'Zoom to', run: () => { choose(r); zoomTo(r); } });
      if (r.obj.startsWith('leg:')) {
        items.push({ label: 'Rename...', run: () => { choose(r); app.runCommand('RENAME'); } });
        items.push({ sep: true });
        items.push({ label: 'Delete leg', run: () => { choose(r); app.runCommand('ERASE'); } });
      }
    } else if (r.check) {
      items.push({ label: 'Show in Checks', run: () => { choose(r); app.ui.panorama.show('checks'); } });
      items.push({ label: 'Zoom to', run: () => zoomTo(r) });
    } else if (r.movement) {
      items.push({ label: 'Zoom to', run: () => zoomTo(r) });
    } else {
      items.push({ label: isOpen(r) ? 'Collapse' : 'Expand', run: () => toggle(r) });
      items.push({ label: 'Zoom extents', run: () => app.zoomExtents() });
    }
    openMenu(items, x, y);
  }

  return {
    update(st, current) {
      if (!st.project || !current) return;
      keyed(tree, rowsOf(st, current), (r) => r.key, make, update);
    },
  };
}
