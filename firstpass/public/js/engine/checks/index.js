// The checks registry. Each check is one file that default-exports { id, title, order, run(ctx) }; adding a
// check means adding its file and one line here. The page's checks panel and the connector read this list.
//
// run(ctx) returns { status: 'pass' | 'warn' | 'fail' | 'info', value, unit, limit,
//   items: [{ leg, status, value, text }], explain, fix, where: { legs, movements, points, polygons } }.
// ctx = { ok, problems, round, rules, rule(id), overridden, geometry, movements, legs, derived, toWorld, warnings }
// with every point in world coordinates. A check that needs a buildable shape sets needsShape (the default);
// when the shape cannot be built such a check is reported as not checked, without being run.

import geometry from './geometry.js';
import entrySpeed from './entry-speed.js';
import speedConsistency from './speed-consistency.js';
import exitSpeed from './exit-speed.js';
import sightStopping from './sight-stopping.js';
import sightIntersection from './sight-intersection.js';
import landTake from './land-take.js';
import truckTurns from './truck-turns.js';

export const CHECKS = [
  geometry, entrySpeed, speedConsistency, exitSpeed, sightStopping, sightIntersection, landTake, truckTurns,
].sort((a, b) => a.order - b.order);

export function checkById(id) {
  return CHECKS.find((c) => c.id === id) || null;
}

const STATUSES = new Set(['pass', 'warn', 'fail', 'info']);

/** Run every check against ctx, in order. A check that breaks is reported, never thrown. */
export function runChecks(ctx) {
  return CHECKS.map((check) => {
    const head = { id: check.id, title: check.title, order: check.order };
    if (!ctx.ok && check.needsShape !== false) {
      return {
        ...head, status: 'info', value: null, unit: check.unit || null, limit: null, items: [],
        explain: 'Not checked, because the shape cannot be built yet. Fix the problems listed under the shape check first.',
        fix: null, where: emptyWhere(),
      };
    }
    try {
      const r = check.run(ctx);
      return {
        ...head,
        status: STATUSES.has(r.status) ? r.status : 'info',
        value: r.value ?? null,
        unit: r.unit ?? null,
        limit: r.limit ?? null,
        items: Array.isArray(r.items) ? r.items : [],
        explain: r.explain || '',
        fix: r.fix || null,
        where: { ...emptyWhere(), ...(r.where || {}) },
      };
    } catch (err) {
      return {
        ...head, status: 'fail', value: null, unit: null, limit: null, items: [],
        explain: 'This check could not be worked out for this shape. Please send it with the Report a problem button so it can be fixed.',
        fix: null, where: emptyWhere(), internalError: String((err && err.stack) || err),
      };
    }
  });
}

export function emptyWhere() {
  return { legs: [], movements: [], points: [], polygons: [] };
}
