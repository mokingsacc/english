// NEW: starts a new project with the sample roundabout on its site, and opens it.
export default {
  name: 'NEW',
  aliases: ['QNEW'],
  description: 'Starts a new project with a sample roundabout.',
  ribbon: [{ tab: 'manage', panel: 'Project', label: 'New', icon: 'new', size: 'large' }],
  qat: 1,
  async run(ctx) {
    if (ctx.app.sync.mode() !== 'server') {
      ctx.app.sync.resetLocal();
      ctx.app.zoomExtents();
      ctx.echo('A fresh sample is open. It is not saved: open First Pass from your link to keep projects.');
      return;
    }
    const name = await ctx.text({ text: 'Enter a name for the new project', def: 'New roundabout' });
    if (name === null) return;
    const r = await ctx.app.api.createProject({ sample: true, name });
    if (!r.ok) { ctx.echo(r.error, 'error'); return; }
    const o = await ctx.app.openProject(r.data.project.id);
    if (o.ok) ctx.echo(`Made and opened the project "${r.data.project.name}".`, 'done');
  },
};
