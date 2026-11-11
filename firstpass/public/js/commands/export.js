// EXPORT: saves the option on screen as a drawing file, built here in the browser from the engine's result by the
// exports registry (public/js/engine/export/), so it works with no server and nothing of hers leaves the page. One export
// today (DXF, in state plane feet, named <project>-<option>.dxf); with more in the registry it asks which.
// The link #p=<project>&o=<option>&do=export-dxf runs it once the option is open (app/main.js).
import { EXPORTS, exportById, exportFileName } from '../engine/export/index.js';
import { zoneText } from '../app/sample.js';

/** Today in her own time zone, as YYYY-MM-DD (the date the drawing's note gives). */
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The file for the option on screen: { ok, file, text, mime } or { ok: false, error } in plain words. */
export function buildExport(app, format = exportById('dxf')) {
  const project = app.project(), opt = app.option();
  if (!project || !opt) return { ok: false, error: 'There is no option on screen to export.' };
  const result = app.evaluateOption(opt);
  try {
    const text = format.build(result, { name: project.name, epsg: project.epsg, option: { id: opt.id, name: opt.name }, date: localDate() });
    return { ok: true, text, mime: format.mime, file: exportFileName(project.name, opt.id, format.ext) };
  } catch (e) {
    return { ok: false, error: e && e.refused ? e.message : `The drawing could not be written (${(e && e.message) || e}). Use Report a problem so it can be fixed.` };
  }
}

/** Hands the text to the browser as a file to save. */
export function download(text, file, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: mime }));
  a.download = file;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

export default {
  name: 'EXPORT',
  aliases: ['EXP', 'DXFOUT', 'PLOT'],
  description: 'Saves the option on screen as a DXF drawing in state plane feet, to open in your CAD program.',
  ribbon: [{ tab: 'output', panel: 'Export', label: 'DXF', icon: 'export', size: 'large' }],
  qat: 6,
  async run(ctx) {
    let format = EXPORTS[0];
    if (EXPORTS.length > 1) {
      const kw = await ctx.keyword({ text: 'Enter a file type', keywords: EXPORTS.map((e) => e.ext.toUpperCase()), def: EXPORTS[0].ext.toUpperCase() });
      if (!kw) return;
      format = EXPORTS.find((e) => e.ext.toUpperCase() === kw) || EXPORTS[0];
    }
    const opt = ctx.option();
    const r = buildExport(ctx.app, format);
    if (!r.ok) { ctx.echo(`Not exported: ${r.error}`, 'error'); return; }
    download(r.text, r.file, r.mime);
    ctx.echo(`Saved ${r.file}: ${opt.name}, ${zoneText(ctx.project().epsg)}.`, 'done');
  },
};
