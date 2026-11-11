// PROPERTIES (PR): opens the Properties palette for the selection. Ctrl+1 does the same.
export default {
  name: 'PROPERTIES',
  aliases: ['PR', 'PROPS', 'MO', 'CH'],
  description: 'Opens the Properties palette for the selection.',
  ribbon: [
    { tab: 'home', panel: 'Palettes', label: 'Properties', icon: 'properties' },
    { tab: 'ctx-round', panel: 'General', label: 'Properties', icon: 'properties', size: 'large' },
    { tab: 'ctx-leg', panel: 'General', label: 'Properties', icon: 'properties', size: 'large' },
  ],
  menu: { when: 'any', label: 'Properties' },
  async run(ctx) { ctx.ui.properties.open(); },
};
