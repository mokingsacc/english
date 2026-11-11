// QSAVE (SAVE): every change is saved as she makes it; this sends anything still waiting and says where things stand.
export default {
  name: 'QSAVE',
  aliases: ['SAVE'],
  description: 'Changes are saved as you make them; this says whether everything is saved.',
  ribbon: [{ tab: 'manage', panel: 'Project', label: 'Save', icon: 'save' }],
  qat: 3,
  async run(ctx) {
    const sync = ctx.app.sync;
    if (sync.mode() !== 'server') { ctx.echo(ctx.app.store.get().net.text, 'error'); return; }
    await sync.flush();
    ctx.echo(sync.waiting() ? ctx.app.store.get().net.text : 'Every change is saved on the server as you make it. All changes saved.');
  },
};
