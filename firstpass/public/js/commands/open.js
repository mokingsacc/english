// OPEN: lists her projects and opens the one she picks.
export default {
  name: 'OPEN',
  aliases: [],
  description: 'Opens another of your projects.',
  ribbon: [{ tab: 'manage', panel: 'Project', label: 'Open', icon: 'open' }],
  qat: 2,
  async run(ctx) {
    if (ctx.app.sync.mode() !== 'server') { ctx.echo('Opening projects needs the server. Open First Pass from your link (the one with #k= in it).', 'error'); return; }
    const r = await ctx.app.api.listProjects();
    if (!r.ok) { ctx.echo(r.error, 'error'); return; }
    ctx.ui.dialogs.openProjects(r.data.projects);
  },
};
