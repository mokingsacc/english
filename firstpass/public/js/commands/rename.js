// RENAME: renames the option on screen, or the selected leg.
export default {
  name: 'RENAME',
  aliases: ['REN'],
  description: 'Renames the option on screen, or the selected leg.',
  ribbon: [
    { tab: 'roundabout', panel: 'Options', label: 'Rename', icon: 'rename' },
    { tab: 'ctx-leg', panel: 'Modify', label: 'Rename', icon: 'rename' },
  ],
  menu: { when: 'leg', label: 'Rename leg' },
  async run(ctx) {
    const legs = ctx.selectedLegs();
    if (legs.length === 1) {
      const leg = legs[0];
      const name = await ctx.text({ text: `Enter new name for ${ctx.legWords(leg)}`, def: leg.name });
      if (name === null || name === leg.name) return;
      ctx.set(`legs.${leg.id}.name`, name);
      return;
    }
    const opt = ctx.option();
    const name = await ctx.text({ text: `Enter new name for ${opt.name}`, def: opt.name });
    if (name === null || name === opt.name) return;
    ctx.change([ctx.op.renameOption(opt.id, name)]);
  },
};
