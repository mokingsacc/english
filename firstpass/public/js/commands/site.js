// SITE (LOCATE): places the roundabout at a place in California from its latitude and longitude, pasted as Google Maps
// copies them ("34.0522, -118.2437"; degrees, minutes and seconds with N, S, E, W work too). The set_site op (app/ops.js)
// picks the place's state plane zone and moves every option by one shift so the option on screen lands there; then the
// view zooms to it and the command line says which zone it chose. NEW asks the same with askSite.
import { roughExtents } from '../app/model-index.js';
import { placeSite, OpRefused } from '../app/ops.js';

const HOW = 'Enter the latitude and longitude as Google Maps copies them, such as 34.0522, -118.2437.';

/**
 * A latitude and longitude from what she typed or pasted: {lat, lon}, {lat} when only one number came (the longitude
 * may follow as the next word), or null. Hemisphere letters set the sign and say which is which.
 */
export function parseLatLon(text) {
  const s = String(text ?? '').toUpperCase().replace(/[’′]/g, "'").replace(/[”″]/g, '"');
  const re = /(-?\d+(?:\.\d+)?)\s*°?\s*(?:(\d+(?:\.\d+)?)\s*'\s*)?(?:(\d+(?:\.\d+)?)\s*"\s*)?([NSEW])?/g;
  const vals = [];
  for (const m of s.matchAll(re)) {
    const deg = Number(m[1]);
    let v = Math.abs(deg) + (m[2] ? Number(m[2]) / 60 : 0) + (m[3] ? Number(m[3]) / 3600 : 0);
    if (m[1].startsWith('-') || m[4] === 'S' || m[4] === 'W') v = -v;
    vals.push({ v, axis: m[4] === 'N' || m[4] === 'S' ? 'lat' : m[4] === 'E' || m[4] === 'W' ? 'lon' : null });
  }
  if (!vals.length || vals.length > 2) return null;
  if (vals.length === 1) return vals[0].axis === 'lon' ? null : { lat: vals[0].v };
  const [a, b] = vals;
  if (a.axis === 'lon' || b.axis === 'lat') return { lat: b.v, lon: a.v };
  return { lat: a.v, lon: b.v };
}

/** A place in California and its zone, or why not: placeSite on a one-option probe, so any project will take it. */
function refusal(place) {
  try { placeSite({ options: [{ id: 'A', round: { center: { x: 0, y: 0 } } }] }, place); return null; } catch (e) {
    if (e instanceof OpRefused) return e.message;
    throw e;
  }
}

/**
 * Asks for a site until she gives one in California: {lat, lon}, or null when she presses Enter on the default
 * (def, shown in angle brackets) or gives nothing. Esc cancels the command.
 */
export async function askSite(ctx, { def = null } = {}) {
  for (;;) {
    const typed = await ctx.text({ text: 'Enter the site as latitude, longitude', ...(def ? { def } : {}) });
    if (typed === null || typed === def || !String(typed).trim()) return null;
    let got = parseLatLon(typed);
    if (got && got.lon === undefined) {
      const more = parseLatLon(await ctx.text({ text: 'Enter the longitude' }));
      got = more && more.lon === undefined ? { lat: got.lat, lon: more.lat } : null;
    }
    if (!got) { ctx.echo(HOW, 'error'); continue; }
    const why = refusal(got);
    if (why) { ctx.echo(why, 'error'); continue; }
    return got;
  }
}

/** Frames the roundabout on screen where it now stands. */
export function zoomToRound(ctx) {
  const b = roughExtents(ctx.round());
  ctx.view.window({ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y1 });
}

export default {
  name: 'SITE',
  aliases: ['LOCATE'],
  description: 'Places the roundabout at a place in California, from the latitude and longitude Google Maps gives.',
  ribbon: [{ tab: 'home', panel: 'Modify', label: 'Site', icon: 'grid' }],
  async run(ctx) {
    const p = ctx.project();
    const here = p && p.site ? `${p.site.lat}, ${p.site.lon}` : null;
    const place = await askSite(ctx, { def: here });
    if (!place) return;
    const opt = ctx.option();
    const r = ctx.change([ctx.op.setSite(place.lat, place.lon, null, opt ? opt.id : null)]);
    if (r.ok && !r.nothing) zoomToRound(ctx);
  },
};
