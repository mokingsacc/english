// ROTATE (RO): turns a leg to a new bearing (typed, or picked as the direction from the centre), or by an angle.
export default {
  name: 'ROTATE',
  aliases: ['RO'],
  description: 'Turns a leg to a new bearing.',
  ribbon: [
    { tab: 'home', panel: 'Modify', label: 'Rotate', icon: 'rotate' },
    { tab: 'roundabout', panel: 'Legs', label: 'Turn Leg', icon: 'rotate' },
    { tab: 'ctx-leg', panel: 'Modify', label: 'Turn Leg', icon: 'rotate', size: 'large' },
  ],
  menu: { when: 'leg', label: 'Turn leg' },
  async run(ctx) {
    const leg = await ctx.oneLeg('Select a leg to turn');
    if (!leg) return;
    const v = await ctx.point({ text: `Specify bearing of ${ctx.legWords(leg)}`, keywords: ['Angle'], def: leg.bearing, allowNumber: true, base: ctx.round().center, band: 'bearing' });
    if (v === null) return;
    let bearing;
    if (v === 'Angle') {
      const a = await ctx.number({ text: 'Specify rotation angle, clockwise in degrees', def: 0 });
      if (a === null) return;
      bearing = leg.bearing + a;
    } else bearing = typeof v === 'number' ? v : ctx.bearingTo(v);
    bearing = ((bearing % 360) + 360) % 360;
    ctx.set(`legs.${leg.id}.bearing`, Math.round(bearing * 100) / 100);
  },
};
