// The grips registry. Each grip is one file that default-exports { id, on: 'round' | 'leg', path, points(g),
// value(g, P, startState), start?(g), angle? }: where its squares sit on a selected object, and the new value of its
// parameter path(s) for a cursor at world point P. A new grip is one file plus one line here.
//   g = { round, leg (for leg grips), result }   path: a params.js path ('icd', 'legs.*.entryRadius') or a list of them
import center from './center.js';
import quadrant from './quadrant.js';
import bearing from './bearing.js';
import entryRadius from './entry-radius.js';
import exitRadius from './exit-radius.js';
import splitterTip from './splitter-tip.js';
import entryWidth from './entry-width.js';
import exitWidth from './exit-width.js';

export const GRIPS = [center, quadrant, bearing, entryRadius, exitRadius, splitterTip, entryWidth, exitWidth];

/** The concrete parameter paths a grip sets on a leg: 'legs.*.entryRadius' gives 'legs.N.entryRadius'. */
export function gripPaths(grip, leg) {
  const list = Array.isArray(grip.path) ? grip.path : [grip.path];
  return list.map((p) => (leg ? p.replace('legs.*.', `legs.${leg.id}.`) : p));
}

/** Every grip point for the selected objects: [{ grip, leg, index, x, y, key }]. */
export function gripPoints(round, result, selection) {
  const out = [];
  if (!round) return out;
  for (const key of selection) {
    if (key === 'round') {
      for (const grip of GRIPS) if (grip.on === 'round') addAll(out, grip, null, grip.points({ round, result }));
    } else if (key.startsWith('leg:')) {
      const leg = round.legs.find((l) => l.id === key.slice(4));
      if (!leg) continue;
      for (const grip of GRIPS) if (grip.on === 'leg') addAll(out, grip, leg, grip.points({ round, leg, result }));
    }
  }
  return out;
}

function addAll(out, grip, leg, pts) {
  pts.forEach((p, index) => {
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) out.push({ grip, leg, index, x: p.x, y: p.y, key: `${grip.id}:${leg ? leg.id : ''}:${index}` });
  });
}
