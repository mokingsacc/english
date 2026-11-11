// The connector's tool registry: every tool is one file in mcp/tools/ that default-exports {name, title, description,
// inputSchema, annotations, run(ctx, args)}; this list is the order tools/list shows them. Adding a tool is one file and
// one line here.
import getProject from './tools/get_project.js';
import getOption from './tools/get_option.js';
import changeOption from './tools/change_option.js';
import addOption from './tools/add_option.js';
import compareOptions from './tools/compare_options.js';
import sweep from './tools/sweep.js';
import undo from './tools/undo.js';
import exportLink from './tools/export_link.js';
import setSite from './tools/set_site.js';
import bugs from './tools/bugs.js';

export const TOOLS = [getProject, getOption, changeOption, addOption, compareOptions, sweep, undo, setSite, exportLink, bugs];
export const LIST_MAX = 12_000;   // characters of tools/list (a test holds it under this)

const BY_NAME = new Map(TOOLS.map(t => [t.name, t]));
export const toolByName = name => BY_NAME.get(name) || null;

// What tools/list sends: the MCP fields only.
const LISTED = ['name', 'title', 'description', 'inputSchema', 'annotations'];
export const LIST = TOOLS.map(t => Object.fromEntries(LISTED.filter(k => t[k] !== undefined).map(k => [k, t[k]])));
