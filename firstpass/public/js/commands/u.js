// U: undoes the newest change (hers or Claude's), as one step. Ctrl+Z does the same.
export default {
  name: 'U',
  aliases: ['UNDO'],
  description: 'Undoes the last change.',
  ribbon: [{ tab: 'home', panel: 'Modify', label: 'Undo', icon: 'undo' }],
  qat: 4,
  noRepeat: false,
  async run(ctx) {
    const r = await ctx.app.sync.undo();
    ctx.echo(r.ok ? r.summary : r.error, r.ok ? 'done' : 'error');
  },
};
