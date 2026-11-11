// LEG: adds a leg at a typed bearing or toward a picked point (the default is the middle of the widest gap).
import { freeBearing } from '../app/ops.js';

export default {
  name: 'LEG',
  aliases: ['ADDLEG'],
  description: 'Adds a leg at a bearing you type or pick.',
  ribbon: [
    { tab: 'home', panel: 'Create', label: 'Add Leg', icon: 'leg', size: 'large' },
    { tab: 'roundabout', panel: 'Legs', label: 'Add Leg', icon: 'leg', size: 'large' },
    { tab: 'ctx-round', panel: 'Modify', label: 'Add Leg', icon: 'leg' },
  ],
  menu: { when: 'any', label: 'Add leg' },
  async run(ctx) {
    const round = ctx.round();
    const v = await ctx.point({ text: 'Specify bearing of the new leg or pick a point', def: freeBearing(round.legs), allowNumber: true, base: round.center, band: 'bearing' });
    if (v === null) return;
    let b = typeof v === 'number' ? v : ctx.bearingTo(v);
    b = Math.round((((b % 360) + 360) % 360) * 2) / 2;
    const r = ctx.change([ctx.op.addLeg(ctx.option().id, b)], undefined, { quiet: true });
    if (r && r.ok && !r.nothing) {
      const legs = ctx.round().legs;
      const added = legs[legs.length - 1];
      ctx.echo(`Added ${ctx.legWords(added)} at a bearing of ${b.toFixed(2)} degrees.`);
      ctx.select([`leg:${added.id}`]);
    }
  },
};
