// PANORAMA: shows or hides the Panorama window (Checks and Compare) under the drawing.
export default {
  name: 'PANORAMA',
  aliases: ['PANO'],
  description: 'Shows or hides the Panorama window with Checks and Compare.',
  ribbon: [{ tab: 'home', panel: 'Palettes', label: 'Panorama', icon: 'panorama' }, { tab: 'analyze', panel: 'Checks', label: 'Panorama', icon: 'panorama' }],
  async run(ctx) { ctx.ui.panorama.toggle(); },
};
