// The engine's public API. The page and the server import from here (and from the parameter, model and
// rules modules directly). Pure ES modules: no DOM and no Node APIs, so the same files run in the browser
// and in the Worker.

export { evaluate } from './evaluate.js';

export { RULES, ruleById, resolveRules } from './rules.js';
export { PARAMS, LEG_PARAMS, ROUND_PARAMS, LEG_COUNT, paramFor, legField } from './roundabout/params.js';
export { defaultRoundabout, defaultLeg, validate, clamp, getAt, setAt } from './roundabout/model.js';
export { CHECKS, checkById, runChecks } from './checks/index.js';

export { derive } from './roundabout/derive.js';
export { listMovements, solveMovement, pathRadii } from './roundabout/fastest-path.js';
export { speedFromRadius, speedAfter, movementSpeeds, speedProfile } from './roundabout/speeds.js';
export { stoppingSightDistance, stoppingSightDistanceRaw, intersectionSightLength } from './sight.js';
export { solveBoxQP, kktResidual } from './qp.js';
export {
  flattenChain, primLength, primPoint, primTangent, arcSweep, chainLength, closedChainArea, bearingVec,
} from './geom.js';
