// Connector tool get_option: one option in full: its parameters, the headline, every check with its words, and each
// leg's fastest path radii and speeds, with the curb radii, widths and splitter island as built where they differ.
import { PROJECT_ARG, OPTION_ARG, projectFor, parseDoc, optionOf, evaluateOption, headlineView, checksView, legsView } from '../common.js';
import { READ_ONLY } from '../annotations.js';

export default {
  name: 'get_option',
  title: 'One option in full',
  description: 'One option: its parameters (feet, mph, degrees), the headline, every check (status, value, limit, explain, fix) and each leg\'s fastest path radii R1 to R5 (ft) and speeds V1 to V5 (mph). as_built on a leg: curb radii, widths and splitter length built other than asked {asked, built}, and the splitter width at the circle (ft). Describe the shape as built.',
  inputSchema: { type: 'object', properties: { project: PROJECT_ARG, option: OPTION_ARG }, required: ['option'], additionalProperties: false },
  annotations: READ_ONLY,
  async run(ctx, args) {
    const row = await projectFor(ctx, args);
    const doc = parseDoc(row);
    const opt = optionOf(doc, args.option);
    const r = evaluateOption(doc, opt);
    const head = `${opt.name} (${opt.id}) of "${doc.name}": `;
    const text = r.ok ? `${head}${r.headline.text}` : `${head}the shape cannot be built. ${r.problems.join(' ')}`;
    return {
      text,
      data: { project: { id: row.id, seq: row.seq }, option: { id: opt.id, name: opt.name }, parameters: opt.round, ok: r.ok, problems: r.problems,
        headline: headlineView(r.headline), checks: checksView(r.checks, { detail: true }), legs: legsView(r.legs, opt.round) },
    };
  },
};
