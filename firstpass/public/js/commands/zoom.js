// ZOOM (Z): a window picked in the drawing, a scale factor ("2x"), or the options Extents, Window, Object and Previous.
export default {
  name: 'ZOOM',
  aliases: ['Z'],
  description: 'Zooms to the whole drawing, a window, the selection, or by a factor.',
  ribbon: [
    { tab: 'home', panel: 'View', label: 'Extents', icon: 'zoomExtents', size: 'large', args: ['E'],
      flyout: [{ label: 'Extents', icon: 'zoomExtents', args: ['E'] }, { label: 'Window', icon: 'zoomWindow', args: ['W'] },
        { label: 'Object', icon: 'zoomObject', args: ['O'] }, { label: 'Previous', icon: 'zoomPrevious', args: ['P'] }] },
    { tab: 'ctx-round', panel: 'General', label: 'Zoom to', icon: 'zoomObject', args: ['O'] },
    { tab: 'ctx-leg', panel: 'General', label: 'Zoom to', icon: 'zoomObject', args: ['O'] },
  ],
  menu: { when: 'any', label: 'Zoom extents', args: ['E'] },
  async run(ctx) {
    const v = await ctx.point({ text: 'Specify corner of window, enter a scale factor (nX), or', join: ' ', keywords: ['Extents', 'Window', 'Object', 'Previous'], def: 'Extents', scale: true });
    if (v === null || v === 'Extents') { ctx.view.extents(); return; }
    if (v === 'Previous') { if (!ctx.view.previous()) ctx.echo('There is no previous view.'); return; }
    if (v === 'Object') {
      if (!ctx.selection().length) {
        const id = await ctx.leg({ text: 'Select a leg', findLeg: ctx.findLeg });
        if (!id) return;
        ctx.view.object([`leg:${id}`]);
      } else ctx.view.object(ctx.selection());
      return;
    }
    if (v && typeof v === 'object' && 'scale' in v) { ctx.view.scale(v.scale); return; }
    const first = v === 'Window' ? await ctx.point({ text: 'Specify first corner' }) : v;
    if (!first || typeof first !== 'object') return;
    const second = await ctx.point({ text: 'Specify opposite corner', base: first, band: 'window' });
    if (!second || typeof second !== 'object') return;
    ctx.view.window(first, second);
  },
};
