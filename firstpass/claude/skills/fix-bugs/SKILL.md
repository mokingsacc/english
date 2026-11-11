---
name: "fix-bugs"
description: "Fix a First Pass problem report in the owner's Claude Code: read the report with its traces, screenshot and project, say in plain words what you understood and wait for a yes, reproduce it as a failing test, fix it, run the tests, and close the report with the commit or pull request link. Use when the owner pastes \"First Pass problem report <id>: ...\" (the sheet's Copy for Claude, which she sends to the owner), or says \"fix the open First Pass bugs\"."
---

# Fix a First Pass problem report

She reports a problem from the page (the Report a problem button): a line of words and/or a screenshot. She does not
fix it: she sends the Copy for Claude text to the person who runs First Pass (the owner), and the owner's Claude Code
fixes it, with the owner's connector or key. The owner is the admin user (`add-user.mjs --admin`), who sees every
user's reports; anyone else sees only their own. The report is saved in the `bug_reports` table with everything needed, so there is nothing to hunt for: her words, the page address
(the key cut out), what was open (`state`: project, option, selection), the last calls with their trace ids,
breadcrumbs (taps, page changes, console errors), versions, the request traces, and two copies of the project: the
page's own (`bundle.project`, which may hold a drag that was not saved yet) and the server's (`bundle.server_project`:
doc, seq and the last 10 changes). When the two are the same, `bundle.project` is `{same_as_server_project: true}`.

## When the Copy for Claude prompt arrives

1. **Read it in full**: the connector's `bugs {action: "get", id}`. Look at the screenshot (the image block).
   `reporter` names who sent it. A report the owner cannot reach is someone else's and the connector is not the
   owner's: say so and stop.
2. **Say what you understood before changing anything**, in two or three plain lines: "What I understood: <the problem
   in her words and yours>, on <page>, option <x>. I will <the change>." Then wait for a yes or a correction.
3. Then do the steps below for that one report.

`bugs {action: "list"}` gives the open reports (newest first, everyone's for the owner, each with its reporter) when
asked to "fix the open bugs"; take them oldest first, one at a time, the same way.

## For each report

1. **Find the code.** Each trace's `route` (`POST /api/projects/:id/changes`, `mcp change_option`) is in
   `docs/agent-map.md` with the file and function that handle it. A page problem: `bundle.crumbs` say what she tapped,
   and the agent map lists every page file. A geometry or check result: the engine is `public/js/engine/` (its own
   tests are `tests/engine/`). No traces kept means the calls were quick and good, so the bug is in what the code did
   with good data, not a crash.
2. **Reproduce it as a failing test first.** Use the bundle's project as the fixture: `bundle.project` (or
   `bundle.server_project.doc` when they are the same). Server code: a test in `tests/worker/*.test.mjs` on the D1 fake
   (`tests/worker/helpers.mjs`: `setup()`, `newProject()`, then put the bundle's doc in place with
   `t.run('UPDATE projects SET doc = ? WHERE id = ?', JSON.stringify(doc), id)`, the doc without `id`, `seq` and
   `updated_at`). Engine code: a test in
   `tests/engine/` calling `evaluate` on the option's `round`. Run it and see it fail for the reason in the report.
3. **Fix it** the way CLAUDE.md says (every change to a drawing through `store/change.js`, plain words, limits only in
   `rules.js`, parameters only in `params.js`). Keep the change small and about this report.
4. **Run** `npm test` (all must pass) and `npm run map` when you added a file, a route or a tool.
5. **Commit** only when asked, on a branch named `claude/fix-<report id>`, message "Fix: <her words, short>" with the
   report id and the cause in the body. Open a pull request when asked.
6. **Close the report**: `bugs {action: "close", id, fix: "<commit or PR link>"}`. Not a bug: `state: "dropped"` with
   one plain sentence why in `fix`. Cannot be reproduced from the bundle: leave it open and say what you need.

End with one plain line per report: what was wrong, the fix, and the link.

## No connector in this session

The same over HTTP with the owner's key (in the environment as `FP_KEY`, never printed) and the site address as
`FP_URL`. `?all=1` lists everyone's reports (the owner only; anyone else gets 403); get, shot and close take any
report's id for the owner:

```
curl -sS -H "X-Key: $FP_KEY" "$FP_URL/api/bugs?all=1"
curl -sS -H "X-Key: $FP_KEY" "$FP_URL/api/bugs/<id>"
curl -sS -H "X-Key: $FP_KEY" "$FP_URL/api/bugs/<id>/shot" -o shot.png     (then read the file)
curl -sS -H "X-Key: $FP_KEY" -H 'Content-Type: application/json' -d '{"fix":"<link>"}' "$FP_URL/api/bugs/<id>/close"
```

On the dev server (`npm run dev`), `FP_URL` is `http://localhost:8788` and the key is in `.dev/dev-user.json` (the
Dev user is the owner there, so it sees every dev user's reports).
