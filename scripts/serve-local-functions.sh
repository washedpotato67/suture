#!/usr/bin/env bash
set -euo pipefail

# Cleanverse secrets are read from the macOS Keychain so they never live in
# .env.local (Vite exposes VITE_ values to the browser) or in shell history.
#
# `supabase functions serve` populates the Edge Runtime environment ONLY from
# --env-file; exported shell variables are not forwarded into the container.
# The secrets are therefore written to a 0600 temp file that is removed when
# this script exits.

KEYCHAIN_ACCOUNT="suture-v0.1"

read_secret() {
  security find-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$1" -w 2>/dev/null || {
    echo "Missing Keychain item '$1' for account '$KEYCHAIN_ACCOUNT'." >&2
    echo "Add it with: security add-generic-password -U -a \"$KEYCHAIN_ACCOUNT\" -s \"$1\" -w" >&2
    exit 1
  }
}

API_ID="$(read_secret suture.cleanverse.sandbox.api-id)"
API_KEY="$(read_secret suture.cleanverse.sandbox.api-key)"

if [ -z "$API_ID" ] || [ -z "$API_KEY" ]; then
  echo "Keychain items exist but are empty. Re-add them with -w as the last option." >&2
  exit 1
fi

ENV_FILE="$(mktemp -t suture-cleanverse-env)"
chmod 600 "$ENV_FILE"
trap 'rm -f "$ENV_FILE"' EXIT INT TERM

{
  echo "CLEANVERSE_ENVIRONMENT=sandbox"
  echo "CLEANVERSE_API_ID=$API_ID"
  echo "CLEANVERSE_API_KEY=$API_KEY"
} >"$ENV_FILE"

supabase functions serve --env-file "$ENV_FILE" "$@"
