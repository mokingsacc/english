// CHECK: opens the Checks tab of the Panorama window: every check, its value and limit, and what to do.
export default {
  name: 'CHECK',
  aliases: ['CHECKS', 'CK'],
  description: 'Opens the Checks window: every check, its value, its limit and what to do.',
  ribbon: [
    { tab: 'output', panel: 'Reports', label: 'Checks Report', icon: 'check', size: 'large' },
    { tab: 'analyze', panel: 'Checks', label: 'Checks', icon: 'check', size: 'large' },
    { tab: 'ctx-round', panel: 'Analyze', label: 'Checks', icon: 'check', size: 'large' },
  ],
  async run(ctx) { ctx.ui.panorama.show('checks'); },
};
