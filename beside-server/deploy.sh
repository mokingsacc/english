#!/usr/bin/env bash
# Deploys Beside's call server to Mo's Cloudflare account (run by .github/workflows/beside-server.yml).
# Needs the CLOUDFLARE_API_TOKEN secret. The first time, it also makes the relay (TURN) key and stores it
# as the Worker's secrets, so nothing is ever pasted by hand or kept in the repo.
set -euo pipefail
cd "$(dirname "$0")"
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "::error::Add the CLOUDFLARE_API_TOKEN secret to the repo (Settings, Secrets and variables, Actions)."
  exit 1
fi
CF=https://api.cloudflare.com/client/v4
api() { curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'Content-Type: application/json' "$@"; }
if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  CLOUDFLARE_ACCOUNT_ID=$(api "$CF/accounts" | jq -r '.result[0].id // empty')
  [ -n "$CLOUDFLARE_ACCOUNT_ID" ] || { echo "::error::The token can't see any Cloudflare account."; exit 1; }
  export CLOUDFLARE_ACCOUNT_ID
fi
W="npx -y wrangler@4.151.0"
$W deploy

if $W secret list --format json 2>/dev/null | jq -e 'map(.name) | index("TURN_KEY_ID")' >/dev/null; then
  echo "Relay key already set."
else
  r=$(api -X POST "$CF/accounts/$CLOUDFLARE_ACCOUNT_ID/calls/turn_keys" -d '{"name":"beside"}')
  uid=$(jq -r '.result.uid // empty' <<<"$r")
  key=$(jq -r '.result.key // empty' <<<"$r")
  if [ -n "$uid" ] && [ -n "$key" ]; then
    echo "::add-mask::$key"
    printf %s "$uid" | $W secret put TURN_KEY_ID
    printf %s "$key" | $W secret put TURN_KEY_TOKEN
    echo "Relay key made and stored."
  else
    echo "::warning::Couldn't make the relay key (the token needs the Calls Edit permission): $(jq -c '.errors' <<<"$r")"
  fi
fi
