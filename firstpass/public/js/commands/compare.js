// COMPARE: opens the Compare tab of the Panorama window: the options side by side, the best value in each row marked.
export default {
  name: 'COMPARE',
  aliases: ['CMP'],
  description: 'Shows the options side by side, with the best value in each row marked.',
  ribbon: [
    { tab: 'output', panel: 'Reports', label: 'Comparison', icon: 'compare', size: 'large' },
    { tab: 'analyze', panel: 'Checks', label: 'Compare', icon: 'compare', size: 'large' },
    { tab: 'roundabout', panel: 'Options', label: 'Compare', icon: 'compare' },
  ],
  async run(ctx) { ctx.ui.panorama.show('compare'); },
};
