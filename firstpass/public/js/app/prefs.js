// Remembered settings on this browser only (palette sizes, which palettes are open, display layers, toggles): a small
// wrapper on localStorage under fp.ui that never throws, so a private window or blocked storage just forgets.
//   prefs.get('toolspace.width', 240);  prefs.set('toolspace.width', 260)
const KEY = 'fp.ui';
let cache = null;

function load() {
  if (cache) return cache;
  try { cache = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { cache = {}; }
  return cache;
}

export const prefs = {
  get(name, fallback) {
    const v = load()[name];
    return v === undefined ? fallback : v;
  },
  set(name, value) {
    load()[name] = value;
    try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* not remembered */ }
  },
};
