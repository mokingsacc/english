// EXPORT: asks the server for the option on screen as a DXF drawing. Until the DXF export is built the server answers
// 501, and this says so in plain words.
export default {
  name: 'EXPORT',
  aliases: ['EXP', 'DXFOUT', 'PLOT'],
  description: 'Saves the option on screen as a DXF drawing for Civil 3D work.',
  ribbon: [{ tab: 'output', panel: 'Export', label: 'DXF', icon: 'export', size: 'large' }],
  qat: 6,
  async run(ctx) {
    const project = ctx.project(), opt = ctx.option();
    if (!project.id) {
      ctx.echo('Export needs the server, and this page has no key. Open First Pass from your link (the one with #k= in it), then try again.', 'error');
      return;
    }
    ctx.echo(`Asking the server for ${opt.name} as a DXF drawing...`);
    const r = await ctx.app.api.exportDxf(project.id, opt.id);
    if (r.offline) { ctx.echo('The server cannot be reached, so the drawing cannot be exported now. Try again when the status bar says saved.', 'error'); return; }
    if (r.status === 501) { ctx.echo(`Not exported: ${r.error} Nothing was saved.`, 'error'); return; }
    if (!r.ok) { ctx.echo(`Not exported: ${r.error}`, 'error'); return; }
    const blob = await r.data.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name} - ${opt.name}.dxf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    ctx.echo(`Saved ${a.download}.`, 'done');
  },
};
