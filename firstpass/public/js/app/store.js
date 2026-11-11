// The page's one store: the project, the current option, the selection, the draft roundabout while a grip is dragged,
// view settings and the sync state. Every part reads it with get() and hears changes through on(); nothing else keeps
// a copy. Changes to the drawing itself go through sync.js change(), never set() directly.
//   const store = createStore(initial); store.set({ selection: [...] }, 'selection'); store.on((state, why) => ...)
// A new piece of state: add it to initialState() with its default.
import { defaultDisplay } from '../draw/colors.js';

export function initialState() {
  return {
    project: null,          // { id, name, epsg, site, rules, options, seq }
    optionId: null,         // the option on screen
    selection: [],          // 'round' and 'leg:<id>' keys
    hover: null,            // the object key under the cursor
    draft: null,            // the roundabout being dragged (not yet committed)
    focusCheck: null,       // the check chosen in the Checks window ({ id, option })
    display: defaultDisplay(),
    toggles: { grid: false, polar: true, osnap: true, dyn: true },
    net: { state: 'local', text: 'Not saved: there is no key.' },
    photo: { state: 'off', text: '' },
  };
}

export function createStore(initial = initialState()) {
  let state = initial;
  const subs = new Set();
  return {
    get: () => state,
    set(patch, why = 'state') {
      state = { ...state, ...patch };
      for (const f of subs) {
        try { f(state, why); } catch (e) { console.error(e); }
      }
    },
    on(f) { subs.add(f); return () => subs.delete(f); },
  };
}

/** The option on screen, or the first one. */
export function currentOption(state) {
  const p = state.project;
  if (!p || !p.options.length) return null;
  return p.options.find((o) => o.id === state.optionId) || p.options[0];
}

/** The roundabout on screen: the draft while dragging, otherwise the option's own. */
export function shownRound(state) {
  const o = currentOption(state);
  return state.draft || (o ? o.round : null);
}

export function selectedLegs(state) {
  const o = currentOption(state);
  if (!o) return [];
  return state.selection.filter((k) => k.startsWith('leg:')).map((k) => o.round.legs.find((l) => l.id === k.slice(4))).filter(Boolean);
}
