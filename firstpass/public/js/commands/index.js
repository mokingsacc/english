// The commands registry. Each command is one file that default-exports { name, aliases, description, ribbon, menu?,
// qat?, run(ctx) }; the ribbon, the quick access toolbar, the command line (and its autocomplete), HELP and the
// right-click menus are all made from this list. A new command is one file plus one line here.
//   ribbon: { tab, panel, label, icon, size: 'large' | 'small', args?, flyout? } or a list of them; tabs home, roundabout,
//   analyze, output, manage, and the contextual ctx-round and ctx-leg. menu: { when: 'any' | 'round' | 'leg', label, args? }.
import icd from './icd.js';
import move from './move.js';
import rotate from './rotate.js';
import leg from './leg.js';
import erase from './erase.js';
import zoom from './zoom.js';
import pan from './pan.js';
import u from './u.js';
import redo from './redo.js';
import option from './option.js';
import rename from './rename.js';
import properties from './properties.js';
import check from './check.js';
import compare from './compare.js';
import exportDxf from './export.js';
import layer from './layer.js';
import regen from './regen.js';
import help from './help.js';
import newProject from './new.js';
import open from './open.js';
import qsave from './qsave.js';
import checkmyself from './checkmyself.js';
import report from './report.js';
import toolspace from './toolspace.js';
import settings from './settings.js';
import panorama from './panorama.js';
import deleteoption from './deleteoption.js';

export const COMMANDS = [
  icd, move, rotate, leg, erase, zoom, pan, u, redo, option, rename, properties, check, compare, exportDxf, layer, regen,
  help, newProject, open, qsave, checkmyself, report, toolspace, settings, panorama, deleteoption,
];

/** Every ribbon entry of every command, as a flat list: [{ command, tab, panel, label, icon, size, args, flyout }]. */
export function ribbonEntries(commands = COMMANDS) {
  const out = [];
  for (const c of commands) {
    const list = Array.isArray(c.ribbon) ? c.ribbon : c.ribbon ? [c.ribbon] : [];
    for (const r of list) out.push({ size: 'small', args: [], ...r, command: c.name });
  }
  return out;
}
