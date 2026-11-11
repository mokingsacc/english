// LAYER (LA): the display layers. On its own it opens the Layers palette; with a layer named after it ("LA P") it turns
// that layer on or off: curbs, edge lines, islands, fastest paths, speed labels, sight triangles, land take, photo.
import { DISPLAY } from '../draw/colors.js';

export default {
  name: 'LAYER',
  aliases: ['LA'],
  description: 'Turns display layers on and off: curbs, paths, speed labels, sight triangles, land take, photo.',
  ribbon: [
    { tab: 'home', panel: 'Layers', label: 'Layer Properties', icon: 'layers', size: 'large' },
    { tab: 'analyze', panel: 'Show', label: 'Fastest Paths', icon: 'paths', args: ['Paths'] },
    { tab: 'analyze', panel: 'Show', label: 'Speed Labels', icon: 'speeds', args: ['Speeds'] },
    { tab: 'analyze', panel: 'Show', label: 'Sight Triangles', icon: 'sight', args: ['Triangles'] },
    { tab: 'analyze', panel: 'Show', label: 'Land Take', icon: 'landtake', args: ['Landtake'] },
    { tab: 'home', panel: 'Layers', label: 'Aerial Photo', icon: 'photo', args: ['pHoto'] },
  ],
  async run(ctx) {
    if (!ctx.moreTyped()) { ctx.ui.layers.open(); return; }
    const kw = await ctx.keyword({ text: 'Enter a layer to turn on or off', keywords: DISPLAY.map((d) => d.kw) });
    const d = DISPLAY.find((x) => x.kw === kw);
    if (!d) return;
    const on = ctx.toggleDisplay(d.key);
    ctx.echo(`${d.label}: ${on ? 'on' : 'off'}.`);
  },
};
