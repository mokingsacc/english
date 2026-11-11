// NEW: starts a new project with the sample roundabout and opens it. After the name it asks for the site as latitude,
// longitude (SITE's prompt); Enter keeps the sample's own site, a place in California puts the roundabout there in that
// place's state plane zone.
import { askSite, zoomToRound } from './site.js';
import { zoneWords } from '../app/ops.js';

const KEEP = 'Sample site';

export default {
  name: 'NEW',
  aliases: ['QNEW'],
  description: 'Starts a new project with a sample roundabout, at the sample site or at a place she gives.',
  ribbon: [{ tab: 'manage', panel: 'Project', label: 'New', icon: 'new', size: 'large' }],
  qat: 1,
  async run(ctx) {
    if (ctx.app.sync.mode() !== 'server') {
      ctx.app.sync.resetLocal();
      const place = await askSite(ctx, { def: KEEP });
      if (place) {
        const r = ctx.change([ctx.op.setSite(place.lat, place.lon)], undefined, { quiet: true });
        if (r.ok && !r.nothing) zoomToRound(ctx); else ctx.app.zoomFirst();
      } else ctx.app.zoomFirst();
      ctx.echo(`A fresh sample is open${place ? ` in ${zoneWords(ctx.project().epsg)}` : ''}. It is not saved: open First Pass from your link to keep projects.`);
      return;
    }
    const name = await ctx.text({ text: 'Enter a name for the new project', def: 'New roundabout' });
    if (name === null) return;
    const place = await askSite(ctx, { def: KEEP });
    const r = await ctx.app.api.createProject({ sample: true, name, ...(place ? { site: place } : {}) });
    if (!r.ok) { ctx.echo(r.error, 'error'); return; }
    const made = r.data.project;
    const o = await ctx.app.openProject(made.id);
    if (o.ok) ctx.echo(`Made and opened the project "${made.name}"${place ? ` at ${made.site.lat}, ${made.site.lon} in ${zoneWords(made.epsg)}` : ''}.`, 'done');
  },
};
