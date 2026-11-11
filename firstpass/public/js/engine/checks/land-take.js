// Land take (for information): the area inside the outer curbs, closed across each leg at its splitter
// island nose.

import { whole, num } from '../format.js';
import { flattenChain } from '../geom.js';

export default {
  id: 'land-take',
  title: 'Land take',
  order: 70,
  unit: 'sq ft',
  run(ctx) {
    const { sqft, acres } = ctx.geometry.landTake;
    return {
      status: 'info',
      value: sqft,
      unit: 'sq ft',
      limit: null,
      items: [],
      explain: `The roundabout covers ${whole(sqft)} square feet (${num(acres, 2)} acres), measured inside the outer curbs and across each leg at the nose of its splitter island.`,
      fix: null,
      where: { polygons: ctx.geometry.layers.landtake.length ? [flattenChain(ctx.geometry.layers.landtake, 4)] : [] },
    };
  },
};

