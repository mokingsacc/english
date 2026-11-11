# First Pass

A browser tool where a highway engineer tries a roundabout idea in minutes, sees which checks pass, and only then builds
it in Civil 3D. She changes one shared drawing by hand on the page or by asking Claude through the connector (on her own
Claude plan; the server holds no AI key). `docs/design.md` is the design and the contract between the parts; read it
first. `CONTRACT.md` records each behaviour as built.

## Commands (all from `firstpass/`)

- `npm test`: the engine, worker and page tests on node:test (no network, no browser, no wrangler).
  One file: `node --test tests/worker/<name>.test.mjs`.
- `npm run dev`: the dev server on Node at http://localhost:8788 (`PORT=8790 npm run dev` for another port). It serves
  `public/` and the real Worker routes on a local database (`.dev/dev.sqlite`, the D1 fake on node:sqlite), makes a
  Dev user and a sample project the first time, and prints the page link (`/#k=<key>`) and the connector address
  (`/mcp/<token>`). Delete `.dev/` to start again.
- `npm run test:web`: Playwright tests in `tests/web/` against the dev server.
- `npm run build`: bundles `src/worker/index.js` to `public/_worker.js` (esbuild; the file is git-ignored).
- `npm run map`: regenerates `docs/agent-map.md`. A test fails when it is stale: run it after adding a file, a route
  or a tool.
- A new user: `node scripts/add-user.mjs "Name" --origin https://<site>` prints the SQL to run with wrangler and her two
  links once (`--dev` adds the user to the dev database instead).
- Deploy: `scripts/deploy.sh` (tests, build, remote migrations, pages deploy). Never deploy from a session unasked.

## Where things are

`docs/agent-map.md` lists every route with the file and function that handle it, every connector tool, and every file
with its first comment line. Read it to find a file. The overview:

- `public/js/engine/` the maths engine (pure JS, no DOM, no Node APIs), shared by the page and the Worker:
  `roundabout/params.js` (every parameter: label, unit, min, max), `rules.js` (every design limit), `checks/*.js`
  (one file per check, listed in `checks/index.js`), `evaluate.js`. Tests: `tests/engine/`.
- `src/worker/index.js` the router: keyed `/api/*` (header `X-Key`), the connector at `/mcp/<token>`, `/tiles/*`,
  static files otherwise. Each `src/worker/api/*.js` file exports its `routes`.
- `src/worker/store/` the database side: `ops.js` (the change ops, their checks and exact inverses, pure),
  `change.js` (applyChange, undoChange, the poll, history), `projects.js`, `users.js`.
- `src/worker/mcp/` the connector: `registry.js` lists the tools, one file each in `mcp/tools/`; `instructions.js`
  (under 2,000 characters); `server.js` (JSON-RPC).
- `src/worker/debug/` problem reports: `trace.js` (request traces), `bugs.js` (reports and their routes).
- `public/js/shared/report.js` (breadcrumbs, traceparent, `window.fpState()`, the button hook) and `report-sheet.js`
  (the Report a problem sheet, loaded when opened).
- `public/js/app/`, `draw/`, `ui/`, `commands/`, `css/`, `index.html` the page.
- `migrations/` D1 migrations, numbered. `tests/worker/` node:test on `tests/worker/d1-fake.mjs` (a D1 on
  node:sqlite) with `helpers.mjs` (`setup()`, `call`, `tool`, `newProject`).
- `claude/skills/fix-bugs/SKILL.md` how a problem report is fixed.

## Conventions

- Every change to a drawing goes through `store/change.js applyChange` (ops in `store/ops.js`), from the page and the
  connector alike, so undo works the same for both. Never write `projects.doc` directly from a route.
- One file per part, one registry (design.md, Modular rule): a new check, parameter, rule, command, tool or export is one
  file plus one line in its registry. Limits only in `rules.js`, parameters only in `params.js`.
- Plain words in every string she reads: short sentences, the parameter's label and unit ("Inscribed circle diameter
  must be between 70 and 300 ft"), no arrows or symbols. No AI model names in code or comments, or in the words of a commit message (the attribution lines a session adds at the end of a commit are separate).
- Secrets only through env. Keys and tokens are stored only as SHA-256 hashes; never log or print them.
- Every `/api` answer is JSON with `Cache-Control: no-store`; errors are `{error: "<plain sentence>"}`.
- `public/_routes.json` lists the Worker's prefixes (`/api/*`, `/mcp/*`, `/tiles/*`); a test keeps it in step with
  the router. A new prefix goes in both.
- Every source file starts with a `// ` comment saying what it is for (the agent map shows it; a test checks).
- A behaviour change: a dated CONTRACT.md section, and tests.
- The connector's tools/list stays under 12,000 characters (a test checks).

## Problem reports: how she reports and how you fix

She taps Report a problem, types a line and/or adds a screenshot. The report holds her words, the page and what was open,
the last calls with their trace ids, breadcrumbs, errors, versions, the request traces, and the project JSON (the page's
copy and the server's), so a geometry problem replays as a test fixture. Traces (`debug_traces`) hold each call's route,
SQL text (never the values), time and error; they are kept when a call failed, ran slow, or a report asked. The setting
`debug_capture` (`PUT /api/settings`) turns it all off.

The sheet's Copy for Claude puts a prompt on her clipboard ("In Claude Code: fix this First Pass problem. Report <id>:
..."). On that prompt, follow `claude/skills/fix-bugs/SKILL.md`: read it with the connector's `bugs {action: "get", id}`,
say "What I understood: ..." and wait, find the handler from the trace's route in `docs/agent-map.md`, write a failing
test from the bundle's project, fix, `npm test`, then close the report with the link.
