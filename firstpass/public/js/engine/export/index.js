// The exports registry (docs/design.md, Modular rule). Each export is one file in this folder that default-exports
// { id, label, ext, mime, build(result, { name, epsg, option, date? }) -> text, check?(text) }; listing it here is all it
// takes for the page's EXPORT command and the server's GET /api/projects/:id/export/<option>.<ext> to offer it.
// A LandXML export, for example, is landxml.js plus one line in EXPORTS.
import dxf from './dxf.js';

export const EXPORTS = [dxf];

export const exportById = (id) => EXPORTS.find((e) => e.id === id) || null;

/** The export a file name asks for by its ending ("A.dxf"), with the option id: { format, option } or null. */
export function exportForFile(file) {
  const m = /^([A-Za-z0-9_-]{1,8})\.([a-z0-9]{1,8})$/i.exec(String(file || ''));
  if (!m) return null;
  const format = EXPORTS.find((e) => e.ext === m[2].toLowerCase());
  return format ? { format, option: m[1] } : null;
}

/** The file name both the page and the server give an export: "<project>-<option>.<ext>", in letters, digits, dashes. */
export function exportFileName(projectName, optionId, ext) {
  const clean = (s) => String(s || '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  const p = clean(projectName).slice(0, 60) || 'First-Pass';
  const o = clean(optionId).slice(0, 8) || 'A';
  return `${p}-${o}.${ext}`;
}
