// DELETEOPTION: removes the option on screen from the project, after she says Yes. The last option cannot go.
export default {
  name: 'DELETEOPTION',
  aliases: ['DELOPT'],
  description: 'Removes the option on screen from the project.',
  ribbon: [{ tab: 'roundabout', panel: 'Options', label: 'Delete Option', icon: 'deleteOption' }],
  async run(ctx) {
    const opt = ctx.option();
    const yes = await ctx.keyword({ text: `Delete ${opt.name}?`, join: ' ', keywords: ['Yes', 'No'], def: 'No' });
    if (yes !== 'Yes') return;
    const r = ctx.change([ctx.op.removeOption(opt.id)], undefined, { quiet: true });
    if (r && r.ok) ctx.echo(`${opt.name} is removed. U puts it back.`);
  },
};
