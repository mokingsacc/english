// REPORT: opens Report a problem (public/js/shared/report.js): her words, a screenshot, and Copy for Claude.
export default {
  name: 'REPORT',
  aliases: ['BUG'],
  description: 'Reports a problem, with a screenshot, so it can be fixed.',
  ribbon: [{ tab: 'manage', panel: 'Help', label: 'Report a problem', icon: 'report', size: 'large', report: true }],
  async run(ctx) {
    if (typeof window.fpReport === 'function') window.fpReport();
    else ctx.echo('Report a problem could not be opened on this page.', 'error');
  },
};
