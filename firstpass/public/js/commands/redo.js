// REDO: puts back the change the last undo took away. Ctrl+Y does the same.
export default {
  name: 'REDO',
  aliases: ['MREDO'],
  description: 'Puts back what the last undo took away.',
  ribbon: [{ tab: 'home', panel: 'Modify', label: 'Redo', icon: 'redo' }],
  qat: 5,
  async run(ctx) {
    const r = await ctx.app.sync.redo();
    ctx.echo(r.ok ? r.summary : r.error, r.ok ? 'done' : 'error');
  },
};
