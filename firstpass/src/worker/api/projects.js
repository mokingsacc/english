// Project routes: list and create her projects, read one with its recent history, and the DXF export address.
//   GET  /api/projects                       -> {projects: [{id, name, seq, updated_at, options: [{id, name}]}]}
//   POST /api/projects {name?, epsg?, site?, round?, sample?}  -> 201 {project}
//   GET  /api/projects/:id                   -> {project, history: [{seq, batch_id, at, actor, summary, undone, undo_of}]}
//   GET  /api/projects/:id/export/:file      the option's DXF (file '<option id>.dxf'); answers 501 until the DXF export
//                                            (public/js/engine/export/dxf.js, a later part) exists
import { json, readJson, HttpError } from '../http.js';
import { listProjects, createProject, needRow, projectOut } from '../store/projects.js';
import { history } from '../store/change.js';

async function list(request, env, ctx, params, url, user) {
  return json({ projects: await listProjects(env.DB, user.id) });
}

async function create(request, env, ctx, params, url, user) {
  const body = await readJson(request, 500_000);
  const row = await createProject(env.DB, user.id, body);
  return json({ project: projectOut(row) }, 201);
}

async function get(request, env, ctx, params, url, user) {
  const row = await needRow(env.DB, user.id, params.id);
  return json({ project: projectOut(row), history: await history(env.DB, row.id) });
}

async function exportDxf(request, env, ctx, params, url, user) {
  const row = await needRow(env.DB, user.id, params.id);
  const m = /^([A-Za-z0-9_-]{1,8})\.dxf$/.exec(params.file || '');
  if (!m) throw new HttpError(404, 'Ask for an option\'s drawing as <option id>.dxf, such as A.dxf.');
  const doc = JSON.parse(row.doc);
  if (!doc.options.some(o => o.id === m[1])) throw new HttpError(404, `There is no option ${m[1]} in this project.`);
  throw new HttpError(501, 'DXF export is not built yet. It comes in a later part of First Pass.');
}

export const routes = [
  { method: 'GET', pattern: '/api/projects', handler: list },
  { method: 'POST', pattern: '/api/projects', handler: create },
  { method: 'GET', pattern: '/api/projects/:id', handler: get },
  { method: 'GET', pattern: '/api/projects/:id/export/:file', handler: exportDxf },
];
