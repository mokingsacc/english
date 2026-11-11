#!/bin/sh
# Deploys First Pass to Cloudflare Pages by hand: tests, build, the database migrations, then the site with its Worker.
# Run from anywhere: sh firstpass/scripts/deploy.sh. Needs wrangler logged in (npx wrangler@4 login) and the real
# database_id in wrangler.toml. Never run from a session unasked.
set -eu
cd "$(dirname "$0")/.."
npm test
npm run build
npx wrangler@4 d1 migrations apply DB --remote
npx wrangler@4 pages deploy
