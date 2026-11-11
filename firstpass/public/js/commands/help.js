// HELP (F1): lists every command with its short names and what it does, in the command history.
export default {
  name: 'HELP',
  aliases: ['?', 'COMMANDS'],
  description: 'Lists every command with its short names.',
  ribbon: [{ tab: 'manage', panel: 'Help', label: 'Commands', icon: 'help', size: 'large' }],
  async run(ctx) {
    ctx.echo('Commands (type the name or a short name, then Enter or Space):');
    for (const c of ctx.app.commands) {
      if (c.hidden) continue;
      const short = (c.aliases || []).filter((a) => /^[A-Z]/.test(a));
      ctx.echo(`  ${c.name}${short.length ? ` (${short.join(', ')})` : ''}: ${c.description}`, 'help');
    }
    ctx.echo('Keys: Esc cancels, Enter or Space repeats the last command, Ctrl+Z undoes, Ctrl+Y redoes, F2 shows this history larger.');
    ctx.ui.cmdline.expand(true);
  },
};
