// PAN (P): real-time pan. The cursor becomes a hand; drag to move the drawing; Esc or Enter ends it.
export default {
  name: 'PAN',
  aliases: ['P'],
  description: 'Moves the view with the hand cursor. Esc or Enter ends it.',
  ribbon: [{ tab: 'home', panel: 'View', label: 'Pan', icon: 'pan' }],
  menu: { when: 'any', label: 'Pan' },
  async run(ctx) {
    ctx.view.panMode(true);
    try {
      await ctx.text({ text: 'Press Esc or Enter to exit, or right-click to display shortcut menu' });
    } finally {
      ctx.view.panMode(false);
    }
  },
};
