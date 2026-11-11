// MOVE (M): moves the whole roundabout from a base point to a second point, or by a typed displacement (east,north).
export default {
  name: 'MOVE',
  aliases: ['M'],
  description: 'Moves the roundabout to a new place.',
  ribbon: [
    { tab: 'home', panel: 'Modify', label: 'Move', icon: 'move' },
    { tab: 'roundabout', panel: 'Circle', label: 'Move', icon: 'move' },
    { tab: 'ctx-round', panel: 'Modify', label: 'Move', icon: 'move', size: 'large' },
  ],
  menu: { when: 'round', label: 'Move' },
  async run(ctx) {
    const c = ctx.round().center;
    const base = await ctx.point({ text: 'Specify base point', keywords: ['Displacement'], def: 'Displacement' });
    if (base === null) return;
    let dx, dy;
    if (base === 'Displacement') {
      const d = await ctx.point({ text: 'Specify displacement (east,north)', def: '0.00,0.00', defValue: { x: 0, y: 0 } });
      if (!d || typeof d !== 'object') return;
      dx = d.x; dy = d.y;
    } else {
      const to = await ctx.point({ text: 'Specify second point', base, band: 'line' });
      if (!to || typeof to !== 'object') return;
      dx = to.x - base.x; dy = to.y - base.y;
    }
    if (!dx && !dy) return;
    ctx.change([ctx.op.set(ctx.option().id, 'center.x', c.x + dx), ctx.op.set(ctx.option().id, 'center.y', c.y + dy)], 'Moved the centre');
  },
};
