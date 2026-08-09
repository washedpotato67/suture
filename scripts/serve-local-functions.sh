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
  # Chain executor. Absent values block live execution rather than falling back
  # to a simulation, so it is safe to run without them.
  echo "MONAD_RPC_URL=${MONAD_RPC_URL:-https://testnet-rpc.monad.xyz}"
  echo "MONAD_CHAIN_ID=${MONAD_CHAIN_ID:-10143}"
  echo "MONAD_ESCROW_ADDRESS=${MONAD_ESCROW_ADDRESS:-0x1a5dbdff02bd4a1faead7482a131755f1e4d8949}"
  echo "MONAD_ASSET_ADDRESS=${MONAD_ASSET_ADDRESS:-0x2d22e91d030143a96cf06de2e53520606f8c60f6}"
  EXEC_KEY="$(security find-generic-password -a "$KEYCHAIN_ACCOUNT" -s "suture.monad.testnet.deploy-key" -w 2>/dev/null || true)"
  [ -n "$EXEC_KEY" ] && echo "MONAD_EXECUTOR_KEY=$EXEC_KEY"
} >"$ENV_FILE"

supabase functions serve --env-file "$ENV_FILE" "$@"
