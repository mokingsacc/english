# First Pass: the contract (each behaviour as built)

`docs/design.md` is the plan; this file records what was built and how it behaves, one dated section per area. A
behaviour change adds or edits a section here, with its tests.

## The project document (11 Nov 2026)

A project is stored as one JSON document in `projects.doc`, with `seq` (its newest change number) beside it:

```
{ name, epsg, site: {lat, lon} | null, rules: {<rule id>: value}, options: [{ id, name, kind: "roundabout",
  round: { center: {x, y}, icd, circWidth, apronWidth, legs: [{ id, name, bearing, ...the leg fields of params.js }] } }] }
```

The API answers it as `{id, ...doc, seq, updated_at}`. Keys are stored in a fixed order (the params table's order;
rule keys sorted), so the same drawing is always the same text. Coordinates are state plane feet (`epsg`, 2226 by
default: CCS83 zone 2, US survey feet). The sample (`POST /api/projects {sample: true}`, and the page's own sample
with no key) sits on the middle of a crossing of two paved two-lane county roads in Yolo County, between Davis and
Woodland: 38.618855, -121.729697, x 6638894.89, y 1987310.58 in zone 2 (from `crs.js`), with its legs turned along the
roads: bearings N 0.7, E 90.6, S 180.7, W 270.6 (grid bearings; true north there is 359.83). See "The aerial photo on
the page" for how it was measured. `SAMPLE` (`src/worker/store/projects.js`) and `SAMPLE_SITE`
(`public/js/app/sample.js`) hold the same values (`tests/page/sample-site.test.mjs`). At most 12 options, 500 projects
per user.

## Changes, undo and redo (11 Nov 2026)

Every write, from the page or the connector, is `store/change.js applyChange(db, project, {ops, actor, summary?,
base_seq?, batch_id?})`. Ops (`store/ops.js`):

- `set {option, path, value}`: path `icd`, `circWidth`, `apronWidth`, `center.x`, `center.y`,
  `legs.<leg id or index>.<field>`, `legs.*.<field>` (every leg) or `legs.<leg>.name` (text).
- `add_option {from?, id?, name?, index?}` (a copy of `from`, or the default roundabout), `remove_option {option}`,
  `rename_option {option, name}`.
- `add_leg {option, bearing?, id?, name?, leg?, index?}`, `remove_leg {option, leg}`.
- `set_rule {rule, value}` (value null puts the standard value back).

Each op is checked against the engine's params and rules tables and refused in plain words that name the parameter by
its label and unit. Stored ops are resolved (explicit, each carrying `was`, the value it replaced), so the inverse is
exact: applying a change and then its undo gives back the same document text, byte for byte (a property test runs 60
random rounds). Up to 60 ops in one change.

- The summary is the step name she sees: the given one, or one written from the ops ("Inscribed circle diameter set to
  140 ft (was 130 ft)").
- A change that alters nothing is not stored: `{ok, nothing: true, seq, summary: "Nothing changed: ..."}`.
- `batch_id` (the page sends `id`) makes a resend safe: the same id answers the stored change with `replay: true`.
- `base_seq`: the seq the sender's copy was at. When later changes touched the same parts, the change is refused
  (409 `{error, conflict: true, seq}`); changes to other parts go through.
- Undo is a new change with the inverse ops, summary "Undo: <step>", `undo_of` its seq, and the original marked
  `undone`. Undo without a seq takes the newest change that is neither undone nor an undo. Undoing an undo is a redo
  ("Redo: <step>") and clears the mark. When a later change touched the same values, undo is refused: "That was
  changed again since; undo the later change first."
- Two writers at once: the changes table's key (project, seq) is the lock; the loser retries (up to 4 times).

## The poll (11 Nov 2026)

`GET /api/projects/:id/changes?since=<seq>`, about every 1.5 s, is one indexed database read. Nothing new:
`{"seq":n,"changes":[]}` and nothing else. News: `{seq, changes: [...], project}` (the whole current project, so the
page never has to replay ops). More than 50 changes behind, or a seq ahead of the project: `{seq, reset: true,
changes: [], project}`.

## Keys, users and links (11 Nov 2026)

Each user has a key (the page) and a connector token, 32 random bytes each, stored only as SHA-256 hashes and compared
in constant time. The page's link is `https://<site>/#k=<key>`; the page keeps the key in localStorage `fp.key` and
sends it as the `X-Key` header. The connector's address is `https://<site>/mcp/<token>`. `scripts/add-user.mjs` makes
both and prints them once. A missing or wrong key answers 401: "This needs your First Pass link, the one with #k= in
it. Open First Pass from that link again."

Other page links: `#p=<project id>&o=<option id>` opens an option; `&do=export-dxf` runs EXPORT once the option is
open, so the DXF downloads (the connector's export_link gives this link; see "The DXF export"). The page then drops
`do=` from the address, so a reload does not download again.

## Routes (11 Nov 2026)

`public/_routes.json` sends only `/api/*`, `/mcp/*` and `/tiles/*` to the Worker; every other path is a static file
from the edge. `routes.test.mjs` fails when a route the router handles is outside that list. Every `/api` answer is
JSON with `Cache-Control: no-store`; errors are `{error: "<plain sentence>"}` (500s never show the database's words).
The full list with handlers is in `docs/agent-map.md`.

## The connector (11 Nov 2026)

MCP over HTTP, JSON-RPC, stateless, at `/mcp/<token>`. Tools: `get_project`, `get_option`, `change_option`,
`add_option`, `compare_options`, `sweep`, `undo`, `export_link`, `bugs`. Each result is a short summary sentence then
the data as compact JSON. The tools that change the drawing take `reason`, which becomes the step name she sees;
`change_option` answers the headline before and after. `sweep` changes nothing (at most 25 values). `undo` without a
seq undoes Claude's own newest change. Instructions stay under 2,000 characters and tools/list under 12,000 (tests).
Changes made through the connector have actor `claude` and reach the page through the poll.

`get_option`'s legs (`mcp/common.js legsView`, 11 Nov 2026): each leg's R1 to R5 and V1 to V5, and `as_built` when the
engine built the leg other than asked: `entryRadius`, `exitRadius`, `entryWidth`, `exitWidth`, `splitterLength` as
`{asked, built}` (ft, built to one place), and `splitterWidthAtCircle` as a number (ft), the island's width where it
meets the circle, which is another place than the body width she asks for. Only values the engine reports that differ
by more than 0.05 ft are listed; a leg built as asked has no `as_built` (`tests/worker/legs-view.test.mjs`).

## Aerial tiles (11 Nov 2026)

`GET /tiles/naip/:z/:x/:y` (no key; `.jpg` on y allowed) gives a 256 px JPEG of the Web Mercator tile from the USGS
NAIP Plus image service (public domain). Zoom 12 to 20 only (400 otherwise). Tiles are kept 30 days in the Cache API
(`X-Tile-Cache: hit|miss`, `Cache-Control: public, max-age=2592000, immutable`). When the service fails, answers something other
than an image, or takes over 8 s: 502 with a plain sentence and `no-store`. The route does not depend on the engine's
coordinate code.

## The map conversion (11 Nov 2026)

`public/js/engine/crs.js`, pure JS with no dependencies, exports exactly `toLatLon(epsg, x, y) -> {lat, lon}`,
`fromLatLon(epsg, lat, lon) -> {x, y}` and `zoneFor(lat, lon) -> epsg`, for EPSG 2225 to 2230 (CCS83 zones 1 to 6,
NAD83 Lambert conformal conic with two standard parallels on GRS80, US survey feet, false easting 6,561,666.667 ft and
northing 1,640,416.667 ft as EPSG gives them). The formulas are written out (EPSG Guidance Note 7-2, method 9802); the
inverse latitude is iterated to 1e-15. Any other epsg, or a value that is not a finite number, throws a plain sentence.

- Datum: NAD83 is treated as WGS84 (they differ by about a metre in California). The photo service publishes its
  images in Web Mercator on WGS84 with no datum shift of its own, so taking the two as one keeps the photo and the
  drawing together; a true NAD83 to WGS84 shift would move the drawing off the photo by that metre.
- Accuracy against proj4 (dev dependency only; a test keeps it out of `public/` and `src/`): an 11 by 11 grid over each
  zone, forward within 0.001 ft (largest 2.5e-8 ft), inverse within 1e-9 degree (largest 4.2e-13), round trips, and
  twelve points from PROJ's own EPSG definitions. No published control values are used, since none could be checked.
- `zoneFor` uses the counties, not latitude bands: the five lines between the zones are the boundaries between their
  county groups (California Public Resources Code 8801 to 8819; TIGER/Line 2024 county outlines, simplified to 0.0001
  degree, kept in the file as encoded polylines), each carried due west and due east past the state, and the 5 and 6
  line hooks south of Catalina and San Clemente so both islands stay in zone 5. A point is in zone 1 plus the number of
  lines it lies south of. Against TIGER: 23,200 random points in California with one wrong 1.4 m from a county line,
  and 43,035 points 150 m either side of every line with none wrong. The error case: within about 15 m of a county line
  between two zones the answer can be the neighbour; outside California the answer means nothing. The project's `epsg`
  is the override: set it and the zone guessed from the site is not used.
- Tests: `tests/engine/crs.test.mjs` (named places in every zone, the islands, the counties' inside points, points
  near the lines, bad input).

## The DXF export (11 Nov 2026)

`public/js/engine/export/dxf.js` (pure) writes an option's `evaluate` result as an ASCII DXF, version R2000 (AC1015):
the oldest version with drawing units ($INSUNITS) and light polylines with true arc bulges, which every CAD program in
use opens without converting. CRLF line ends, group codes right-aligned in 3 columns, every table with its standard
entries, both block records and layouts, handles and owners on every object, `$HANDSEED` past the last handle.

- Units and header: `$INSUNITS` 2 (feet), `$MEASUREMENT` 0, `$LUNITS` 2 with 3 places, `$EXTMIN`/`$EXTMAX` and
  `$LIMMIN`/`$LIMMAX` the drawing's extents, the active view zoomed to them. R2000 has no code for US survey feet, so
  the file says feet; the numbers are US survey feet as the note says. Open the file directly, or insert it at scale 1:
  inserting it into a drawing whose units are set to US survey feet would scale it by 0.999998 (about 13 ft at state
  plane distances from the origin).
- Coordinates are state plane feet exactly as the engine gives them (no shift, no scale), each written as the shortest
  decimal that reads back to the same double.
- Layers (CAD colour index): FP-LANDTAKE 6, FP-SIGHT 200, FP-INSCRIBED 9, FP-APRON 30, FP-ISLAND 4, FP-SPLITTER 3,
  FP-CURB 7, FP-EDGE 8, FP-CENTERLINE 2, FP-YIELD 7, FP-EXIT 8, FP-PATH 1, FP-PATH-TEXT 7, FP-NOTE 7; all Continuous.
- Entities: curbs, edge, centre, yield and exit lines and the inscribed circle as one true LINE or ARC per primitive of
  the engine's chains (DXF arcs run counterclockwise in degrees, so a clockwise arc is written end to start; its ends
  are the chain's ends to 1e-6 ft); the central island, apron edge, splitter islands and land take as closed light
  polylines with bulges (exact arcs, one object each, so area and hatching work); each fastest path as a light polyline
  through the engine's points with "R1 99.6 ft, V1 20.3 mph" labels (2 ft text) at each fitted arc, the same text close
  together shown once and overlapping labels stacked; the sight triangles as closed polylines; and a three line note
  above the drawing: "First Pass roundabout sketch: <option> of <project>.", "Coordinates: California state plane,
  CCS83 zone N (EPSG e), US survey feet, exactly as First Pass gives them, with no shift or scale.", "Made <date>.
  Layers start with FP. A first look for testing ideas: check it before you build on it." Text is ASCII (other
  characters as \U+XXXX).
- A shape that cannot be built is refused: "This option cannot be built, so there is no drawing to export. <the
  engine's problem>". The same result and date give the same bytes.
- `exports` registry (`public/js/engine/export/index.js`): `EXPORTS` lists `{id, label, ext, mime, build, check}`; a
  new format (LandXML) is one file plus one line there. `exportFileName` makes `<project>-<option>.<ext>` (letters,
  digits and dashes; "First-Pass" when the name has none).
- The page: EXPORT (EXP, DXFOUT, PLOT; ribbon Output, Export, DXF) builds the file in her browser from the option on
  screen and downloads it: "Saved Sample-roundabout-A.dxf: Option A, CCS83 Zone 2, US survey feet." or "Not exported:
  <why>". Nothing is sent anywhere. The link `#p=<id>&o=<option>&do=export-dxf` does the same once the option is open.
  It asks which file type only when the registry has more than one.
- The server: `GET /api/projects/:id/export/<option>.dxf` (`src/worker/api/export.js`) answers the same text with
  `Content-Type: application/dxf`, `Content-Disposition: attachment; filename="<project>-<option>.dxf"`, `no-store`.
  404 "Ask for an option's drawing as <option id>.dxf, such as A.dxf." or "There is no option X in this project."; 422
  for a shape that cannot be built; 401 without a key; another user's project is 404. The server's date is UTC, the
  page's her own. Built in the same JS engine the text is byte for byte the page's; between a browser and the server
  the last digits can differ (browsers round sines, powers and arctangents differently in the last bit, and the fastest
  path solver carries that on): measured on the sample, Chromium 153 against Node 22, 1,215 numbers differ, the largest
  by 0.00013 ft, and no text.
- Check myself (page): "The DXF export works on this page: the default roundabout made a well formed drawing (N lines,
  N arcs, N outlines and paths, N labels) in X ms. EXPORT saves Option A as <file>." `checkDxf` reads the file back:
  code and value pairs, the sections in order, EOF, handles unique and below `$HANDSEED`, every layer used in the
  layer table, numbers finite, something drawn; and counts the entities.
- Tests: `tests/engine/dxf.test.mjs` parses the file back for the sample, a skewed four-leg and a three-leg shape and
  compares every LINE, ARC and bulge to the engine's result to 1e-6 ft (arc ends on chain ends, sweeps, island centre on
  the roundabout centre, land take area to 0.01 sq ft), the header, layers, handles, note, byte stability and refusals;
  `FP_EZDXF_PYTHON=<python with ezdxf> node --test tests/engine/dxf.test.mjs` also runs ezdxf's audit.
  `tests/worker/export.test.mjs` covers the route. ezdxf 1.4.5 on the sample's file as the page saved it: audit 0
  errors and 0 fixes, recover 0 and 0, 104 entities on 14 layers.

## The aerial photo on the page (11 Nov 2026)

`public/js/draw/underlay.js` draws NAIP tiles (zoom 12 to 20, the zoom whose photo pixel is about a screen pixel) under
the drawing. Each tile's corners go through `crs.js fromLatLon` and the tile is drawn with the affine transform the
corners give, exactly on its square; its last row and column are stretched 0.75 pixel under the next tile so no seam
shows. The tiles are drawn at full strength and one veil of the background colour at 0.4 dims them all to 0.6, so
nothing is darker where tiles meet. A tile still loading is stood in for by the matching part of a coarser tile already
in memory (up to 4 zooms up). A tile the service did not give (it sometimes takes over 8 s) is asked for again after 2,
6 and 20 s. Tiles are kept in memory (400) and the browser and the Worker cache them (`immutable`, 30 days). The status
says "Photo not available" when `crs.js` cannot load or three tiles failed before any came; a later tile turns it back
on.

Measured on the dev server in Chromium (1440 by 900, pixel ratio 2), 11 Nov 2026:

- Placement: the page's photo against the same tiles placed independently (pyproj, NAD83 as WGS84), compared in 70
  windows per view by phase correlation: median 0.00 and 90th percentile 0.03 device pixel, in four views (zoom 18, 19
  and 20 tiles, before and after a pan). The service's tiles match its own single picture of the site to 0.02 tile
  pixel. Drawing each tile 256.5 px wide instead of exactly on its square (the first version) moved the picture by up to
  half a photo pixel; that is why the edges are stretched instead.
- The sample against the crossing: the crossing's centre, from the pavement edges of both roads in the page's photo
  (the widest view, 230 m of road each way), is 0.57 ft from the roundabout's centre (0.38 ft east, 0.42 ft south);
  the method's own uncertainty is about 3 ft (1 m: road edges with shoulders, 0.6 m photo pixels). Views showing only
  short stretches of road give 3 to 4 ft by the same method; the photo itself did not move between them (above). The
  roads run at grid bearings 0.6 to 0.7 and 90.4 to 90.6 by two measurements; the legs are at 0.7 and 90.6.
- Caching: after a pan away and back no tile already loaded is asked for again (the only repeats are retries of tiles
  that failed); a second session over the same views took 169 of 178 tiles from the Worker's cache.
- Tests: `tests/page/underlay.test.mjs` (tile maths, transform, exact squares and edge strips, retries, stand-ins, the
  veil, the quiet fallback), `tests/page/sample-site.test.mjs`.

## Self check (11 Nov 2026)

`GET /api/selfcheck` answers `{ok, lines: [{id, ok, text}]}`, one plain line each for: the database, users, the
engine (evaluates the default roundabout), aerial tiles (fetches one known tile) and the connector (whether this
user has a connector link). Each failing line says what to do.

## Problem reports and traces (11 Nov 2026)

Ported from practice-hub. The page loads `public/js/shared/report.js`: breadcrumbs (taps, page changes, console
errors, failed calls; the 1.5 s poll only when it fails), a W3C `traceparent` on its own `/api` calls, and
`window.fpState()`, which merges every `window.fpParts.<name>()` with the address (the key cut out). The page adds a
part that returns `{project_id, option, selection, project}`, `project` being the full current project JSON. Any
element with `data-report-btn` (or `window.fpReport()`) opens the sheet (`report-sheet.js`): her words, an optional
screenshot, Save, Copy for Claude. Reports that cannot be sent wait in localStorage `fp.bugq` and go later.

- `POST /api/bugs {id, note?, shot?, page, state, calls, crumbs, errors, app}`: words or a screenshot are required;
  screenshots JPEG, PNG or WebP up to about 1 MB. Saved with the traces it names, the page's project and the server's
  (doc, seq, last 10 changes; `{same_as_server_project: true}` when equal). Secrets are scrubbed: header and key fields
  dropped, `#k=` and `/mcp/<token>` cut out of every string. The same id twice answers `duplicate: true`.
- `GET /api/bugs`, `GET /api/bugs/:id`, `GET /api/bugs/:id/shot`, `POST /api/bugs/:id/close {fix, state?}`; the
  connector's `bugs {action: list | get | close}` does the same (get attaches the screenshot as an image).
- Traces: every `/api` and `/mcp` call gets an `X-Trace-Id`. A trace (route, SQL text without values, times, error) is
  kept 7 days when the call failed, took over 3 s, or the sheet asked (`X-Trace-Keep: 1`, only for a valid key); a
  report pins the ones it names.
- `PUT /api/settings {debug_capture: false}` turns traces off (no `X-Trace-Id`; report.js then stops sending
  traceparent for an hour). The setting is for the whole server.
- Fixing: `claude/skills/fix-bugs/SKILL.md`.
