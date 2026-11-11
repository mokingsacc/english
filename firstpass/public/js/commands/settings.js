// SETTINGS: opens the Settings tab of the Toolspace: every design limit, where it comes from, editable for this project.
export default {
  name: 'SETTINGS',
  aliases: ['RULES', 'LIMITS'],
  description: 'Opens the design limits for this project.',
  ribbon: [{ tab: 'manage', panel: 'Settings', label: 'Design Limits', icon: 'settings', size: 'large' }],
  async run(ctx) { ctx.ui.toolspace.show('settings'); },
};
