// CHECKMYSELF: the page checks itself and the server, one plain line each, green or red with what to do.
export default {
  name: 'CHECKMYSELF',
  aliases: ['SELFCHECK'],
  description: 'Checks the server, the connector, the maths, the export, the photos and the speed of this machine.',
  ribbon: [
    { tab: 'analyze', panel: 'Tool', label: 'Check myself', icon: 'selfcheck', size: 'large' },
    { tab: 'manage', panel: 'Help', label: 'Check myself', icon: 'selfcheck', size: 'large' },
  ],
  async run(ctx) { ctx.ui.dialogs.checkMyself(); },
};
