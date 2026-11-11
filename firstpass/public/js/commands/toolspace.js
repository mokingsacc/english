// TOOLSPACE (TS): shows or hides the Toolspace palette (Prospector and Settings) on the left.
export default {
  name: 'TOOLSPACE',
  aliases: ['TS', 'PROSPECTOR'],
  description: 'Shows or hides the Toolspace palette.',
  ribbon: [{ tab: 'home', panel: 'Palettes', label: 'Toolspace', icon: 'toolspace' }, { tab: 'manage', panel: 'Settings', label: 'Toolspace', icon: 'toolspace' }],
  async run(ctx) { ctx.ui.toolspace.toggle(); },
};
