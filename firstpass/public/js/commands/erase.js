// ERASE (E): removes the selected legs (or the leg she picks). A roundabout keeps at least three legs.
export default {
  name: 'ERASE',
  aliases: ['E', 'DELETE'],
  description: 'Removes a leg from the roundabout.',
  ribbon: [
    { tab: 'home', panel: 'Modify', label: 'Erase', icon: 'erase' },
    { tab: 'roundabout', panel: 'Legs', label: 'Remove Leg', icon: 'erase' },
    { tab: 'ctx-leg', panel: 'Modify', label: 'Remove Leg', icon: 'erase', size: 'large' },
  ],
  menu: { when: 'leg', label: 'Delete leg' },
  async run(ctx) {
    let legs = ctx.selectedLegs();
    if (!legs.length) {
      if (ctx.selection().includes('round')) {
        ctx.echo('The roundabout itself cannot be erased. To remove a whole option, right-click its tab and choose Delete option.');
        return;
      }
      const id = await ctx.leg({ text: 'Select a leg to erase', findLeg: ctx.findLeg });
      if (!id) return;
      legs = ctx.round().legs.filter((l) => l.id === id);
    }
    const r = ctx.change(legs.map((l) => ctx.op.removeLeg(ctx.option().id, l.id)));
    if (r && r.ok) ctx.select([]);
  },
};
