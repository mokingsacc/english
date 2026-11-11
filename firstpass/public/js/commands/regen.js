// REGEN (RE): works the drawing out again from its numbers and redraws it.
export default {
  name: 'REGEN',
  aliases: ['RE'],
  description: 'Works the drawing out again and redraws it.',
  ribbon: [{ tab: 'home', panel: 'View', label: 'Regen', icon: 'regen' }],
  async run(ctx) {
    ctx.echo('Regenerating model.');
    ctx.app.regen();
  },
};
