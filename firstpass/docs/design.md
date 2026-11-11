# First Pass: design (phase 1, roundabouts)

First Pass is a browser tool where a highway engineer tries a roundabout idea in minutes, sees which checks pass, and only
then builds it in Civil 3D. She changes one shared drawing two ways: by hand on the page, or by asking Claude through a
connector on her own Claude plan. It is our own small tool, not a copy of Civil 3D: no DWG, no Dynamo or LISP runtime.

This file is the contract between the parts. If you build a part, build exactly to this file. If something here is
wrong or missing, say so in your report rather than quietly doing something else.

## The owner's rules (his words, 10 and 11 Nov 2026)

- "it will be used to test out ideas before committing to them, browser based", "easy to use and help a lot".
- "make sure its a modular design so if theres any fix she wants to do ... or a new feature ... then she can do that".
- "the debugging should be a simple process, those things which we incorporated into the debugging of the practice hub
  this should have also".
- "make the look and feel of the thing as close to autodesk civil 3d as possible, so theres no learning curve".
- "use public data and then where she has permission she can insert her own data".
- Plain words in every string she sees. No model names in code, comments or commits. Secrets only through env.

## Shape

- Home: this repo, folder `firstpass/`. Nothing outside `firstpass/` is touched (the repo also holds other apps).
- Runs as one Cloudflare Pages project with a single Worker script and one D1 database. No Durable Objects, no
  WebSockets: the page polls for changes about every 1.5 s. No framework, no bundler for the page: plain ES modules.
- One maths engine, pure JS with no DOM and no Node APIs, in `public/js/engine/`. The page imports it directly; the Worker
  imports the same files (esbuild bundles `src/worker/index.js` to `public/_worker.js` at deploy).
- World coordinates are California state plane feet (CCS83, US survey feet, the zone stored on the project), x = easting,
  y = northing, angles as compass bearings in degrees clockwise from north. The same numbers she sees in Civil 3D.

```
firstpass/
  public/                 static page (index.html, css/, js/app/*, js/engine/*, js/shared/report*.js, vendor/)
  src/worker/             index.js (router), api/*.js, mcp/*.js, debug/*.js, store/*.js (D1, change log, undo)
  migrations/             D1 migrations, numbered
  tests/engine/           node:test, no browser
  tests/worker/           node:test on a D1 fake (node:sqlite)
  tests/web/              Playwright against scripts/dev-server.mjs
  scripts/                dev-server.mjs, agent-map.mjs, build.mjs, deploy.sh, add-user.mjs
  docs/                   design.md (this file), agent-map.md (generated)
  CLAUDE.md  CONTRACT.md  package.json  wrangler.toml
```

Commands (all from `firstpass/`): `npm test` (engine + worker tests, no network), `npm run dev` (dev server on Node
with the D1 fake, serves the page and the real Worker routes), `npm run test:web` (Playwright), `npm run build`,
`npm run map` (regenerate docs/agent-map.md; a test fails when it is stale).

## Modular rule: one file per part, one registry

Every capability is one file that default-exports a part object, and one registry file lists them. The page's panels
and the connector's tool list are generated from the registries, so adding a part never needs edits elsewhere.

- Checks: `public/js/engine/checks/<id>.js` exports `{ id, title, order, run(ctx) }`; `checks/index.js` lists them.
  `run` returns `{ status: 'pass'|'warn'|'fail'|'info', value, unit, limit, items: [{ leg, status, value, text }],
  explain, fix, where }`. `explain` and `fix` are plain sentences she reads. `where` is geometry to highlight.
- Parameters: `public/js/engine/roundabout/params.js` is the single table of every parameter: `{ path, label, unit,
  min, max, step, default, group, help }`. The Properties palette, the command line, validation and the connector's
  tool schema all read this table.
- Rules (design limits): `public/js/engine/rules.js`, a data table `{ id, value, unit, label, source, verify }`.
  A project can override any value. Limits are never hard coded anywhere else.
- Commands: `public/js/app/commands/<name>.js` exports `{ name, aliases, ribbon: { tab, panel, label, icon }, run }`.
  The ribbon, the command line and right-click menus are generated from `commands/index.js`.
- Connector tools: `src/worker/mcp/tools/<name>.js` exports `{ name, description, inputSchema, run }`; `mcp/registry.js`.
- Exports: `public/js/engine/export/<format>.js`.

## Data model

```js
project = { id, name, epsg: 2226, site: { lat, lon }, rules: { [ruleId]: value }, options: [option], seq }
option  = { id: 'A', name: 'Option A', kind: 'roundabout', round: roundabout }
roundabout = {
  center: { x, y },            // state plane ft
  icd: 130,                    // inscribed circle diameter
  circWidth: 18,               // circulatory roadway width
  apronWidth: 10,              // truck apron, inside the circulatory roadway (mountable)
  legs: [{
    id: 'N', name: 'North leg',
    bearing: 0,                // direction from the centre outward along the leg
    offsetLeft: 0,             // shift of the approach line to the entering driver's left
    approachSpeed: 45,         // mph, for stopping sight distance
    approachWidth: 12, entryWidth: 16, entryRadius: 65,
    exitWidth: 16, exitRadius: 150, departWidth: 12,
    splitterLength: 80, splitterWidth: 14   // island length outside the circle; width where it meets the circle
  }]
}
```

Right-hand traffic, counterclockwise circulation. One lane everywhere in phase 1 (keep a `lanes` field out until
multilane is designed).

## Engine

`evaluate(roundabout, rules) -> { ok, problems, geometry, movements, legs, checks, headline }`, pure, deterministic,
under 15 ms for four legs on a laptop (it runs on every drag frame). `problems` lists plain-word reasons when the shape
cannot be built (legs overlapping, circle too small for its widths); it must never throw on bad numbers.

### Derived geometry (`roundabout/derive.js`)

All curbs are chains of true line segments and circular arcs `{ type: 'line'|'arc', a, b, c?, r?, ccw?, tag }` (never
pre-flattened), so export can write real arcs.

- Circles about the centre C: inscribed circle `Ri = icd/2` (outer curb of the circulatory roadway); central island
  edge `Rc = Ri - circWidth` (the curb cars follow); apron inner edge `Ra = Rc - apronWidth` (raised island).
- For each leg: `u` = unit vector outward along the bearing; an entering driver travels along `-u`; `rIn` = that
  driver's right; the entry lane lies on the `rIn` side and the exit lane on the other side. The leg axis is the line
  through `C - offsetLeft * rIn` with direction `u`.
- Splitter island: nose on the axis at distance `Ri + splitterLength` from C; it meets the inscribed circle at `Se`
  (lateral offset `splitterWidth/2` toward the entry side) and `Sx` (same toward the exit side). Its two edges are
  straight lines nose to `Se` and nose to `Sx` (curb, tag `splitter`).
- Entry right edge: a straight line from the far point (lateral offset `approachWidth` from the axis, at the nose
  station) to near the circle (lateral offset `splitterWidth/2 + entryWidth`), then the entry curb: an arc of radius
  `entryRadius` tangent to that line and externally tangent to the inscribed circle (centre at distance `Ri +
  entryRadius` from C and `entryRadius` outside the edge line). Beyond the nose the edge runs parallel to the axis for
  250 ft. The exit side mirrors this with `exitWidth`, `exitRadius`, `departWidth`. Upstream of the nose the painted
  centreline is the axis (tag `centerline`).
- Outer curb between legs: inscribed circle arcs from one leg's exit tangent point to the next leg's entry tangent point.
- `geometry` also carries: entrance line and exit line per leg (across the mouth on the inscribed circle), the land
  take polygon (outer edge all round, out to each nose station), and named layers for export.

### Fastest paths (`roundabout/corridor.js`, `roundabout/fastest-path.js`, `qp.js`)

Source: NCHRP Report 672 section 6.7.1 (carried into NCHRP Research Report 1043). The fastest path is the smoothest,
flattest path of a single 6 ft wide car ignoring lane lines, kept clear of the edges by `fp.offset.curb` (5 ft from a
curb face), `fp.offset.centerline` (5 ft from a painted centreline) and `fp.offset.paint` (3 ft from a painted edge).

We compute it the way a racing line is computed: minimum bending energy inside a corridor.

1. Movements: every entry leg to every other leg. Class by turn angle between `-u(entry)` and `u(exit)`: within 45
   degrees of straight = through; otherwise right or left. No U-turns.
2. Boundaries for a movement i to j, as chains of the true primitives with their tags:
   right chain = entry right edge and curb of i, inscribed circle counterclockwise to j's exit curb, exit curb and edge
   of j. Left chain = centreline and splitter entry edge of i up to `Se`, the tangent segment from `Se` to the central
   island circle, the central island arc counterclockwise, the tangent segment to j's `Sx`, splitter exit edge and
   centreline of j.
3. Reference line: entry lane centre from 250 ft out, the mid-roadway arc (radius `Ri - circWidth/2`), exit lane centre
   to 250 ft out; smoothed and resampled every 4 ft. At each station k the allowed lateral offset `[lo_k, hi_k]` along
   the normal is found from the analytic distance to each chain minus its clearance (bisection on the true distance,
   not ray casting). If `lo > hi` anywhere, the movement reports "the path cannot fit" with the place.
4. Solve for offsets `a_k`: minimise `sum |p[k-1] - 2 p[k] + p[k+1]|^2` with `p[k] = c[k] + a[k] n[k]`, subject to the
   box bounds. Start and end are pinned to the left bound with the lane heading (two stations each end). The Hessian
   is pentadiagonal: use projected Newton with a banded Cholesky solve on the free set and a projected line search
   (`qp.js`, generic, with its own tests against a slow reference solver and a KKT check). Re-linearise two or three
   times (new reference = current path, uniform resample).
5. Radii: signed curvature along the path; split into runs by sign. The circulating run is the left-turning run that
   comes closest to C. `R1` = smallest least-squares circle radius over any `fp.window` (65 ft) window inside the
   right-turning run before it, `R2` likewise inside the circulating run, `R3` inside the right-turning run after it.
   A run shorter than the window is fitted whole (not below 20 ft). No run = radius infinite. For a left-turn movement
   the circulating radius is `R4`; for a right-turn movement the smallest right-turn radius is `R5`.
6. Speeds (`roundabout/speeds.js`), mph and ft: `V = 3.4415 R^0.3861` for +2% cross slope (R1, R3, R5) and
   `V = 3.4614 R^0.3673` for -2% (R2, R4) (672 Eq. 6-1, 6-2). Then `V1 = min(V1, sqrt((1.47 V2)^2 + 2 * 4.2 * d12) /
   1.47)` and `V3 = min(V3, sqrt((1.47 V2)^2 + 2 * 6.9 * d23) / 1.47)` where `d12`, `d23` are path distances between
   the midpoints of the fitted arcs (672 Eq. 6-3, 6-4). Every speed is capped at the leg's approach speed.
   All constants come from `rules.js`, each marked `verify: true` until checked against NCHRP 1043.

### Sight distance (`sight.js`)

Stopping sight distance `d = 1.468 t V + 1.087 V^2 / a` (t 2.5 s, a 11.2 ft/s2) for each approach speed, the circulating
speed and the exit. Intersection sight distance per entry: `d1 = 1.468 Vent tc` along the upstream entering path
(Vent = mean of that movement's V1 and V2) and `d2 = 1.468 V4 tc` along the circulating path, `tc` 5.0 s, eye 50 ft
back from the entrance line in the entry lane. Return the two triangles as polygons to draw. Status is `info` (the
tool does not know what blocks the view); the text says to keep the triangles clear.

### Checks in phase 1 (each its own file)

`geometry` (the shape can be built), `entry-speed` (V1 and V5 against `speed.entry.max`, 25 mph), `speed-consistency`
(V1 - V2, and V1 against the conflicting V4: warn above 10, fail above 15 mph), `exit-speed` (info), `sight-stopping`
(info, distances), `sight-intersection` (info, triangles), `land-take` (info, sq ft and acres), `truck-turns` (added
in a later part; returns `info: not built yet` until then). `headline` = worst entry speed, worst speed drop, land
take, and the count of fails and warns.

### Tests the engine must have

Formula values (V at R = 100 and 200 ft; stopping distances 155, 200, 250, 360, 425 ft at 25, 30, 35, 45, 50 mph
after rounding up to 5 ft); every chain is continuous and tangent at its joints to 1e-6; a symmetric four-leg circle
gives the same numbers on every leg within 0.5 ft; every path point respects every clearance within 0.05 ft; R4 lies
within 15% of `Rc + 5`; bigger `entryRadius` never lowers R1 and bigger `offsetLeft` never raises it; bad input never
throws; the 15 ms budget.

## Server (`src/worker/`)

Port the patterns from the owner's `practice-hub` repo (cloned read-only at `/home/user/practice-hub`; read its
CLAUDE.md first). Same shape: keyed `/api/*`, the connector at `/mcp/<token>`, static assets otherwise.

- D1 tables: `users` (id, name, key_hash, mcp_token_hash), `projects`, `changes` (seq, project, batch_id, actor
  `user|claude`, summary, ops, inverse, undone), `settings`, `bug_reports`, `debug_traces`.
- Every write goes through `store/change.js applyChange(project, { ops, actor, summary })`: validates with the
  engine's params table, applies, stores the ops and their inverse, bumps `seq`. Ops: `set { option, path, value }`,
  `add_option { from? }`, `remove_option`, `rename_option`, `add_leg`, `remove_leg`, `set_rule`. Undo = apply inverse.
- Routes: `GET/POST /api/projects`, `GET /api/projects/:id`, `POST /api/projects/:id/changes`,
  `GET /api/projects/:id/changes?since=seq`, `POST /api/projects/:id/undo`, `GET /api/projects/:id/export/:option.dxf`,
  `GET /api/selfcheck`, the bug routes as in practice-hub, `GET /tiles/naip/:z/:x/:y` (see Public data).
- Connector tools (few and coarse): `get_project`, `get_option` (parameters, checks, headline), `change_option`
  ({ option, changes: [{ path, value }], reason }, returns the new checks), `add_option`, `compare_options`, `sweep`
  ({ option, path, from, to, step }, a table of headline numbers, changes nothing), `undo`, `export_link`,
  `bugs` (list, get, close). Tool results are compact text plus JSON. The Worker holds no AI key.
- Debugging, ported from practice-hub: `public/js/shared/report.js` and `report-sheet.js` (button, breadcrumbs,
  traceparent, screenshot, Copy for Claude, offline queue), `debug/bugs.js`, `debug/trace.js`, the fix tools, a
  `fix-bugs` skill under `firstpass/claude/skills/`. Each report bundle also carries the full project JSON, so a
  geometry bug replays as a test fixture.

## Public data

- Aerial photos: USGS NAIP Plus ImageServer (public domain, about 0.3 m pixels, checked 11 Nov 2026):
  `https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPPlus/ImageServer/exportImage?bbox=..&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&f=image`.
  The Worker serves standard XYZ tiles at `/tiles/naip/z/x/y` by calling that with the tile's Web Mercator box and
  caching the answer (Cache API, 30 days), zoom 12 to 20.
- `public/js/engine/crs.js`: WGS84 to and from CCS83 zones 1 to 6 (Lambert conformal conic, GRS80, US survey feet),
  written out, tested against proj4 (dev dependency only). Zone picked from the site with a manual override.
- Her own data (a later part of phase 1): a base drawing (DXF) or a photo she adds is read in her browser and kept in
  IndexedDB. It is never uploaded.

## The page: a small CAD workspace that behaves like the one she knows

Match Civil 3D's conventions exactly where they are behaviour and layout; draw our own icons; never use Autodesk's
name, logo or icon artwork.

- Layout: ribbon tabs across the top (Home, Roundabout, Analyze, Output, Manage) with labelled panels and buttons; a
  Toolspace panel on the left (Prospector tree: project, options, roundabout, legs, paths, checks; a Settings tab with
  the rules table); a Properties palette on the right (category rows, name and value, editable in place); the drawing
  area in the middle, dark like model space, with crosshair cursor and a north arrow; a command line with history at
  the bottom and a status bar under it (northing and easting readout, toggles). A Panorama-style docked window lists
  the checks and compares options A, B, C in a table.
- Mouse and keys: wheel zooms about the cursor; middle button drag pans; double middle click zooms to extents; click
  selects; window and crossing selection; Esc cancels and clears; Enter or Space repeats the last command; Delete
  removes a selected leg; Ctrl+Z and U undo; right click opens a context menu. Selected objects show square grips;
  dragging a grip edits live, with a dynamic input box by the cursor where she can type the exact value and press Enter.
- Command line: commands and aliases from the registry, AutoCAD style prompts (`ICD <130.00>:`), for example `ICD`,
  `MOVE`, `LEG` (add), `ZOOM E`, `U`, `OPTION` (copy the current option), `EXPORT`, `CHECK`.
- Live: `evaluate` runs on every drag frame; fastest paths draw coloured by speed with small speed labels; checks
  update in place. A drag commits one change on release.
- Sync: after any commit, and every 1.5 s while visible, the page asks for changes since its `seq`; Claude's changes
  appear as named steps in the history and can be undone.
- Also: Check myself (data service reachable, connector linked, engine self-test, export valid, each line in plain
  words), Report a problem, a first-run sample roundabout on a real California site so the page is never empty.

## Parts, in build order

1. Engine (this file's Engine section) with its tests.
2. Server: store, change log and undo, API, connector, debugging port, dev server, tests, agent map, CLAUDE.md, CONTRACT.md.
3. Page: the CAD workspace above on the engine and the API.
4. DXF export, state plane conversion tests, Check myself.
5. Truck turns (swept path), her own base drawing or photo.
6. One fresh-eyes review; fixes; deploy.
