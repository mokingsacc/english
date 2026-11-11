// OPTION: copies the option on screen to the next letter (Option A to Option B) and shows the copy.
import { nextOptionId } from '../app/ops.js';

export default {
  name: 'OPTION',
  aliases: ['OPT', 'COPYOPTION'],
  description: 'Copies the option on screen to a new option with the next letter.',
  ribbon: [
    { tab: 'home', panel: 'Create', label: 'Copy Option', icon: 'option', size: 'large' },
    { tab: 'roundabout', panel: 'Options', label: 'Copy Option', icon: 'option', size: 'large' },
  ],
  async run(ctx) {
    const from = ctx.option();
    const id = nextOptionId(ctx.project());
    const r = ctx.change([ctx.op.addOption(from.id, id)], `Added Option ${id} as a copy of ${from.name}`, { quiet: true });
    if (r && r.ok && !r.nothing) {
      ctx.app.setOption(id);
      ctx.echo(`Option ${id} is a copy of ${from.name}. It is now on screen.`);
    }
  },
};
