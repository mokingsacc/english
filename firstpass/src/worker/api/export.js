// GET /api/projects/:id/export/:file: one option of a project as a drawing file to save, built from the stored project by
// the same export part the page uses (public/js/engine/export/), so the server's file and the page's are the same text.
// The file name picks the option and the export by its ending ("A.dxf" is option A as DXF): a new export in the
// registry needs no change here. The answer is the file itself (not JSON) with a download header and no-store; a refusal
// is JSON in plain words as everywhere else: 404 for a project, option or ending there is not, 422 for a shape that
// cannot be built.
import { HttpError } from '../http.js';
import { needRow, parseDoc } from '../store/projects.js';
import { evaluate } from '../engine.js';
import { exportForFile, exportFileName, EXPORTS } from '../../../public/js/engine/export/index.js';

async function exportFile(request, env, ctx, params, url, user) {
  const row = await needRow(env.DB, user.id, params.id);
  const want = exportForFile(params.file);
  if (!want) throw new HttpError(404, `Ask for an option's drawing as <option id>.${EXPORTS[0].ext}, such as A.${EXPORTS[0].ext}.`);
  const doc = parseDoc(row);
  const opt = (doc.options || []).find(o => o.id === want.option);
  if (!opt) throw new HttpError(404, `There is no option ${want.option} in this project.`);
  let text;
  try {
    text = want.format.build(evaluate(opt.round, doc.rules || {}), { name: doc.name, epsg: doc.epsg, option: { id: opt.id, name: opt.name } });
  } catch (e) {
    if (e && e.refused) throw new HttpError(422, e.message);
    throw e;
  }
  const file = exportFileName(doc.name, opt.id, want.format.ext);
  return new Response(text, {
    headers: {
      'Content-Type': want.format.mime,
      'Content-Disposition': `attachment; filename="${file}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export const routes = [
  { method: 'GET', pattern: '/api/projects/:id/export/:file', handler: exportFile },
];
