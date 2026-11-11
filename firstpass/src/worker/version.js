// The build's id ({commit, at}), set by scripts/build.mjs through esbuild's define; null on Node (tests, dev server).
/* global __FP_BUILD__ */
export const BUILD = typeof __FP_BUILD__ !== 'undefined' ? __FP_BUILD__ : null;
