// Connector tool export_link: a link that opens First Pass on one option and downloads it as a DXF in her browser (the
// export runs in the page, where her key already is, with the same writer as GET /api/projects/:id/export/<option>.dxf;
// the link holds no secret).
import { PROJECT_ARG, OPTION_ARG, projectFor, parseDoc, optionOf } from '../common.js';
import { READ_ONLY } from '../annotations.js';

/** The page link (CONTRACT.md, "Page links"): #p=<project>&o=<option>&do=export-dxf. */
export const exportLink = (origin, projectId, optionId) => `${origin}/#p=${encodeURIComponent(projectId)}&o=${encodeURIComponent(optionId)}&do=export-dxf`;

export default {
  name: 'export_link',
  title: 'Link to export a DXF',
  description: 'A link that opens First Pass on an option and saves it as a DXF for Civil 3D, in the browser where she uses First Pass. Give her the link.',
  inputSchema: { type: 'object', properties: { project: PROJECT_ARG, option: OPTION_ARG }, required: ['option'], additionalProperties: false },
  annotations: READ_ONLY,
  async run(ctx, args) {
    const row = await projectFor(ctx, args);
    const opt = optionOf(parseDoc(row), args.option);
    const link = exportLink(ctx.origin, row.id, opt.id);
    return {
      text: `Open this in the browser where First Pass is open: ${link} . It opens ${opt.name} and downloads it as a DXF for Civil 3D.`,
      data: { link, project: row.id, option: opt.id, export_ready: true },
    };
  },
};
