#!/bin/sh
# Deploys First Pass to Cloudflare Pages in one command from the owner's Mac: checks the Cloudflare sign-in, runs the
# tests and the build, makes the D1 database and the Pages project the first time (writing the database id into
# wrangler.toml), applies the migrations and deploys to production, then prints the address.
# Run: sh scripts/deploy.sh (from firstpass/, or give the path from anywhere). Never run it from a session unasked.
#
# Why each step is here:
# - The project name and the database name come from wrangler.toml (name, database_name). The name becomes the public
#   address <name>.pages.dev, so it must not hold a user name; the script stops if it holds this Mac's.
# - `wrangler pages deploy` run here reads wrangler.toml (it has pages_build_output_dir) and sends its D1 binding,
#   compatibility date and flags with the Worker, so production gets DB without any dashboard setting. That needs the
#   real database_id in wrangler.toml, which is why the script writes it (an id is not a secret; keep the change).
# - FP_WRANGLER runs another wrangler instead of npx's (for example a copy already installed).
set -eu
cd "$(dirname "$0")/.."

WRANGLER=${FP_WRANGLER:-"npx --yes wrangler@4"}
PLACEHOLDER=00000000-0000-0000-0000-000000000000

say() { printf '%s\n' "$*"; }
stop() { printf '\n%s\n' "$*" >&2; exit 1; }

# The value of `key = "value"` in wrangler.toml (the first one), or nothing.
toml_get() {
  node -e '
    const m = require("fs").readFileSync("wrangler.toml", "utf8")
      .match(new RegExp("^" + process.argv[1] + "\\s*=\\s*\"([^\"]*)\"", "m"));
    process.stdout.write(m ? m[1] : "");' "$1"
}

# Reads wrangler JSON on stdin (from the first line that starts with [ or {, so a warning above it is skipped) and runs the expression given on it as `j`.
json() {
  node -e '
    let s = require("fs").readFileSync(0, "utf8");
    const at = s.search(/^[[{]/m);
    const j = at < 0 ? null : JSON.parse(s.slice(at));
    const out = new Function("j", "arg", "return (" + process.argv[1] + ")")(j, process.argv[2]);
    process.stdout.write(out == null ? "" : String(out));' "$1" "${2:-}"
}

# 1. Node, the build tools, the sign-in.
command -v node >/dev/null 2>&1 || stop "Node.js is not installed. Install Node.js 22.13 or newer from nodejs.org, then run this again."
node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 13) ? 0 : 1)' \
  || stop "First Pass needs Node.js 22.13 or newer, and this Mac has $(node -v). Install a newer one from nodejs.org, then run this again."
if [ ! -d node_modules/esbuild ] || [ ! -d node_modules/proj4 ]; then
  say "Installing First Pass's build tools (the first time only)..."
  npm ci --no-audit --no-fund
fi

say "Checking the Cloudflare sign-in..."
WHO=$($WRANGLER whoami --json 2>/dev/null) || stop "Wrangler is not signed in to Cloudflare, or Cloudflare could not be reached.
Sign in with: npx wrangler@4 login
Then run this again."
if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  COUNT=$(printf '%s' "$WHO" | json '(j.accounts || []).length')
  if [ "$COUNT" -gt 1 ]; then
    LIST=$(printf '%s' "$WHO" | json 'j.accounts.map((a) => "  " + a.name + ": " + a.id).join("\n")')
    FIRST=$(printf '%s' "$WHO" | json 'j.accounts[0].id')
    stop "This Cloudflare sign-in can use more than one account:
$LIST
Choose one and run this again with its id, for example:
CLOUDFLARE_ACCOUNT_ID=$FIRST sh scripts/deploy.sh"
  fi
  if [ "$COUNT" -eq 1 ]; then
    CLOUDFLARE_ACCOUNT_ID=$(printf '%s' "$WHO" | json 'j.accounts[0].id')
    export CLOUDFLARE_ACCOUNT_ID
  fi
fi

# 2. The names, from wrangler.toml.
NAME=$(toml_get name)
DB_NAME=$(toml_get database_name)
DB_ID=$(toml_get database_id)
[ -n "$NAME" ] || stop "wrangler.toml has no project name (name = \"...\" at the top). Add one, then run this again."
[ -n "$DB_NAME" ] || stop "wrangler.toml has no database name (database_name = \"...\" under d1_databases). Add one, then run this again."
case "$NAME" in
  *[!a-z0-9-]* | -* | *-) stop "The project name \"$NAME\" in wrangler.toml can use only lowercase letters, digits and dashes, and cannot start or end with a dash. Change it, then run this again." ;;
esac
ME=$(id -un 2>/dev/null || true)
if [ "${#ME}" -ge 3 ] && printf '%s' "$NAME" | grep -qiF -- "$ME"; then
  stop "The project name \"$NAME\" in wrangler.toml holds your user name, and it becomes the public address $NAME.pages.dev. Pick a name without it (name = \"...\" in wrangler.toml), then run this again."
fi

# 3. Tests and build, before anything changes in Cloudflare.
say "Running the tests..."
npm test
say "Building the Worker..."
npm run build

# 4. The database: made the first time, its id written into wrangler.toml.
say "Looking for the database \"$DB_NAME\"..."
DBS=$($WRANGLER d1 list --json) || stop "Could not list the databases in your Cloudflare account. The message above says why."
FOUND=$(printf '%s' "$DBS" | json '(j || []).find((d) => d.name === arg)?.uuid' "$DB_NAME")
if [ -z "$FOUND" ]; then
  say "Making the database \"$DB_NAME\" (the first deploy only)..."
  $WRANGLER d1 create "$DB_NAME" --location wnam || stop "Could not make the database \"$DB_NAME\". The message above says why."
  DBS=$($WRANGLER d1 list --json) || stop "Could not list the databases in your Cloudflare account. The message above says why."
  FOUND=$(printf '%s' "$DBS" | json '(j || []).find((d) => d.name === arg)?.uuid' "$DB_NAME")
  [ -n "$FOUND" ] || stop "The database \"$DB_NAME\" was made but does not show in the list yet. Wait a minute, then run this again."
fi
if [ "$DB_ID" = "$PLACEHOLDER" ] || [ -z "$DB_ID" ]; then
  node -e '
    const fs = require("fs");
    const id = process.argv[1];
    let t = fs.readFileSync("wrangler.toml", "utf8");
    t = t.replace(/^# Placeholder: .*\n/m, "# The id of the D1 database below; scripts/deploy.sh wrote it (an id is not a secret).\n");
    t = t.replace(/^database_id\s*=\s*"[^"]*"/m, "database_id = \"" + id + "\"");
    fs.writeFileSync("wrangler.toml", t);' "$FOUND"
  say "Wrote the database id into wrangler.toml. Keep that change; it is not a secret."
elif [ "$DB_ID" != "$FOUND" ]; then
  stop "wrangler.toml names the database id $DB_ID, but the database \"$DB_NAME\" in your Cloudflare account has the id $FOUND. Put $FOUND as database_id in wrangler.toml, then run this again."
fi

# 5. The Pages project: made the first time, with main as its production branch.
PROJECTS=$($WRANGLER pages project list --json) || stop "Could not list the Pages projects in your Cloudflare account. The message above says why."
HAS=$(printf '%s' "$PROJECTS" | json '(j || []).some((p) => p["Project Name"] === arg) ? "yes" : ""' "$NAME")
if [ -z "$HAS" ]; then
  say "Making the Pages project \"$NAME\" (the first deploy only)..."
  $WRANGLER pages project create "$NAME" --production-branch main \
    || stop "Could not make the Pages project \"$NAME\". If the name is taken, change name in wrangler.toml, then run this again."
fi

# 6. Migrations, then the deploy to production.
say "Applying the database changes (migrations)..."
$WRANGLER d1 migrations apply DB --remote </dev/null || stop "The database changes could not be applied. The message above says why; nothing was deployed."
say "Deploying to production..."
$WRANGLER pages deploy --project-name "$NAME" --branch main --commit-dirty=true

PROJECTS=$($WRANGLER pages project list --json 2>/dev/null) || PROJECTS='[]'
DOMAIN=$(printf '%s' "$PROJECTS" | json '(((j || []).find((p) => p["Project Name"] === arg) || {})["Project Domains"] || "").split(", ").find((d) => d.endsWith(".pages.dev"))' "$NAME")
ADDRESS="https://${DOMAIN:-$NAME.pages.dev}"
say ""
say "First Pass is live at $ADDRESS"
say "Give someone a key with: node scripts/add-user.mjs \"Name\" --origin $ADDRESS (add --admin for yourself, to see everyone's problem reports)."
