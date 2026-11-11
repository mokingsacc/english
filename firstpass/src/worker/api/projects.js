// Project routes: list and create her projects, and read one with its recent history (the export is api/export.js).
//   GET  /api/projects                       -> {projects: [{id, name, seq, updated_at, options: [{id, name}]}]}
//   POST /api/projects {name?, epsg?, site?, round?, sample?}  -> 201 {project}
//   GET  /api/projects/:id                   -> {project, history: [{seq, batch_id, at, actor, summary, undone, undo_of}]}
import { json, readJson } from '../http.js';
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


export const routes = [
  { method: 'GET', pattern: '/api/projects', handler: list },
  { method: 'POST', pattern: '/api/projects', handler: create },
  { method: 'GET', pattern: '/api/projects/:id', handler: get },
];
