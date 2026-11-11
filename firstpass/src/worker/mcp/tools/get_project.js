// Connector tool get_project: the project at a glance (options with headline numbers, project settings that differ from
// the standard, the last changes, her other projects). Claude calls it first.
import { PROJECT_ARG, projectFor, parseDoc, evaluateOption, headlineView } from '../common.js';
import { READ_ONLY } from '../annotations.js';
import { listProjects } from '../../store/projects.js';
import { history } from '../../store/change.js';
import { ruleById } from '../../engine.js';

export default {
  name: 'get_project',
  title: 'Project at a glance',
  description: 'Call first. The project: each option with its headline numbers, project settings that differ from the standard, the last changes (seq, who, what) and her other projects.',
  inputSchema: { type: 'object', properties: { project: PROJECT_ARG }, additionalProperties: false },
  annotations: READ_ONLY,
  async run(ctx, args) {
    const row = await projectFor(ctx, args);
    const doc = parseDoc(row);
    const options = doc.options.map(o => {
      const r = evaluateOption(doc, o);
      return { id: o.id, name: o.name, legs: o.round.legs.map(l => l.id), icd: o.round.icd, ok: r.ok, headline: headlineView(r.headline) };
    });
    const settings = Object.entries(doc.rules || {}).map(([id, value]) => {
      const r = ruleById(id);
      return { rule: id, label: r ? r.label : id, value, unit: r ? r.unit : null, standard: r ? r.value : null };
    });
    const changes = (await history(ctx.db, row.id, 8)).map(c => ({ seq: c.seq, actor: c.actor, summary: c.summary, ...(c.undone ? { undone: true } : {}) }));
    const others = (await listProjects(ctx.db, ctx.user.id)).filter(p => p.id !== row.id).slice(0, 10).map(p => ({ id: p.id, name: p.name }));
    const lines = [`Project "${doc.name}" (${row.id}), change ${row.seq}, ${options.length} option${options.length === 1 ? '' : 's'}.`];
    for (const o of options) lines.push(`${o.name} (${o.id}): ${o.headline ? o.headline.text : 'not worked out'}`);
    if (settings.length) lines.push(`${settings.length} project setting${settings.length === 1 ? ' differs' : 's differ'} from the standard.`);
    if (changes.length) lines.push(`Last change: ${changes[0].seq}, by ${changes[0].actor === 'claude' ? 'Claude' : 'her'}: ${changes[0].summary}.`);
    return {
      text: lines.join('\n'),
      data: { project: { id: row.id, name: doc.name, seq: row.seq, epsg: doc.epsg, site: doc.site }, options, settings, changes, other_projects: others },
    };
  },
};
