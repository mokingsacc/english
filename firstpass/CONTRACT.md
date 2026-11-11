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
default: CCS83 zone 2, US survey feet). The sample (`POST /api/projects {sample: true}`) sits on a rural crossroads
east of Davis (38.58999, -121.73968; x 6636071.5, y 1976790.3). At most 12 options, 500 projects per user.

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

Other page links: `#p=<project id>&o=<option id>` opens an option; `&do=export-dxf` asks for the DXF (the connector's
export_link gives this link; the export itself is not built yet and `GET /api/projects/:id/export/:option.dxf` answers
501 in plain words).

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

## Aerial tiles (11 Nov 2026)

`GET /tiles/naip/:z/:x/:y` (no key; `.jpg` on y allowed) gives a 256 px JPEG of the Web Mercator tile from the USGS
NAIP Plus image service (public domain). Zoom 12 to 20 only (400 otherwise). Tiles are kept 30 days in the Cache API
(`X-Tile-Cache: hit|miss`, `Cache-Control: public, max-age=2592000, immutable`). When the service fails, answers something other
than an image, or takes over 8 s: 502 with a plain sentence and `no-store`. The route does not depend on the engine's
coordinate code.

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
