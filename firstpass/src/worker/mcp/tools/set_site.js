// Connector tool set_site: places the drawing at a place in California, as one change she can undo (the set_site op,
// store/ops.js): the site, its state plane zone, and every option moved by one shift so the option named lands there.
import { PROJECT_ARG, OPTION_ARG, REASON_ARG, UNDO_SAY, projectFor, storeRefusal } from '../common.js';
import { UNDOABLE_WRITE } from '../annotations.js';
import { applyChange } from '../../store/change.js';

export default {
  name: 'set_site',
  title: 'Place the drawing at a site',
  description: 'Move the drawing to a place in California, by latitude and longitude (as Google Maps copies them). The state plane zone follows the place unless epsg (2225 to 2230) is given. Every option moves together; `option` lands exactly there (default the first).',
  inputSchema: {
    type: 'object',
    properties: {
      project: PROJECT_ARG,
      lat: { type: 'number', minimum: -90, maximum: 90 },
      lon: { type: 'number', minimum: -180, maximum: 180 },
      epsg: { type: 'integer', minimum: 2225, maximum: 2230 },
      option: OPTION_ARG,
      reason: REASON_ARG,
    },
    required: ['lat', 'lon', 'reason'],
    additionalProperties: false,
  },
  annotations: UNDOABLE_WRITE,
  async run(ctx, args) {
    const row = await projectFor(ctx, args);
    const op = { op: 'set_site', lat: args.lat, lon: args.lon, ...(args.epsg != null ? { epsg: args.epsg } : {}), ...(args.option != null ? { option: args.option } : {}) };
    const r = await applyChange(ctx.db, row, { ops: [op], actor: 'claude', summary: args.reason });
    if (!r.ok) storeRefusal(r);
    if (r.nothing) return { text: 'The drawing is already at that site.', data: { project: { id: row.id, seq: r.seq } } };
    const placed = r.change.ops[0];
    const zone = placed.epsg - 2224;
    return {
      text: `Placed the drawing at ${placed.site.lat}, ${placed.site.lon} in California zone ${zone} (EPSG ${placed.epsg})${placed.was.epsg !== placed.epsg ? `; its coordinates were in zone ${placed.was.epsg - 2224}` : ''}. ${UNDO_SAY}`,
      data: { project: { id: row.id, seq: r.seq }, change: { seq: r.change.seq, summary: r.change.summary }, site: placed.site, epsg: placed.epsg, centers: placed.centers },
    };
  },
};
