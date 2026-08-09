#!/usr/bin/env bash
set -euo pipefail

# PolicyManifestRegistry.activatePolicy requires effectiveAt == block.timestamp
# exactly. A broadcast transaction lands in a future block, so the value cannot
# be known in advance. This sends with the latest block timestamp and retries
# until the transaction lands in a block whose timestamp matches.
#
# Usage: activate-policy.sh <registry> <asset> <version> [rpc]

REGISTRY="${1:?registry address required}"
ASSET="${2:?asset address required}"
VERSION="${3:?policy version required}"
RPC="${4:-https://testnet-rpc.monad.xyz}"

PK="$(security find-generic-password -a "suture-v0.1" -s "suture.monad.testnet.deploy-key" -w)"
POLICY_HASH="$(cast keccak "policy-v${VERSION}")"
POLICY_REF="$(cast keccak "policy-reference-v${VERSION}")"

for attempt in 1 2 3 4 5 6 7 8; do
  TS="$(cast block latest --field timestamp --rpc-url "$RPC")"
  echo "attempt ${attempt}: effectiveAt=${TS}"
  if cast send "$REGISTRY" \
      "activatePolicy(address,uint64,bytes32,bytes32,uint64)" \
      "$ASSET" "$VERSION" "$POLICY_HASH" "$POLICY_REF" "$TS" \
      --rpc-url "$RPC" --private-key "$PK" >/dev/null 2>&1; then
    echo "activated policy v${VERSION} for ${ASSET} at ${TS}"
    exit 0
  fi
  echo "  landed in a different block; retrying"
done

echo "activation did not land in a matching block after 8 attempts." >&2
echo "This is the same-block activation constraint, not a configuration error." >&2
exit 1
