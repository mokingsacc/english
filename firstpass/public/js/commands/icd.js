// ICD: sets the inscribed circle diameter of the roundabout on screen ("ICD 110" in one go).
import { paramFor } from '../engine/index.js';

export default {
  name: 'ICD',
  aliases: ['DIAMETER'],
  description: 'Sets the inscribed circle diameter of the roundabout.',
  ribbon: [
    { tab: 'roundabout', panel: 'Circle', label: 'Circle Size', icon: 'icd', size: 'large' },
    { tab: 'home', panel: 'Modify', label: 'Circle Size', icon: 'icd' },
    { tab: 'ctx-round', panel: 'Modify', label: 'Circle Size', icon: 'icd', size: 'large' },
  ],
  menu: { when: 'round', label: 'Circle size (ICD)' },
  async run(ctx) {
    const p = paramFor('icd');
    const v = await ctx.number({ text: `Specify ${p.label.toLowerCase()}`, def: ctx.round().icd, min: p.min, max: p.max, unit: p.unit });
    if (v === null) return;
    ctx.set('icd', v);
  },
};
