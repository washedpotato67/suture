#!/usr/bin/env bash
set -euo pipefail

# Exercises the complete remediation cycle on chain with SEPARATED roles:
#   executor (policyAuthority) : openRemediation, release
#   approver (human key)       : approve
#   source wallet              : fundAuthorizedRemediation
#
# The executor can never approve its own remediation, and never holds user
# assets: funding originates from the source wallet through the vault.

RPC="${RPC:-https://testnet-rpc.monad.xyz}"
ESCROW="${ESCROW:?escrow address required}"
VAULT="${VAULT:-0x6985f751982d81a51f3474d9ae1d12f072d3dcd5}"
ORACLE="${ORACLE:-0x23b0e4aa312e85da5ac26dc92d2b6ec459033281}"
ASSET="${ASSET:-0x2d22e91d030143a96cf06de2e53520606f8c60f6}"
RECEIPT_ID="${RECEIPT_ID:?receipt position id required}"
AMOUNT="${AMOUNT:-100000000000000000000}"

DPK="$(security find-generic-password -a suture-v0.1 -s suture.monad.testnet.deploy-key -w)"
EPK="$(security find-generic-password -a suture-v0.1 -s suture.monad.testnet.executor-key -w)"
SOURCE="$(security find-generic-password -a suture-v0.1 -s suture.monad.testnet.deploy-address -w)"
REPLACEMENT="$(security find-generic-password -a suture-v0.1 -s suture.monad.testnet.executor-address -w)"

# The escrow binds a remediation to a specific receipt: BoundVault requires
# remediation.positionId == receiptPositionId, so the position IS the receipt.
RID="$(cast keccak "suture:remediation:onchain:${CYCLE:-2}")"
PID="$RECEIPT_ID"
PHASH="$(cast keccak "policy-v1")"

step() { printf '%-46s ' "$1"; }

step "oracle: allow replacement wallet"
cast send "$ORACLE" "setWalletAllowed(address,bool)" "$REPLACEMENT" true \
  --rpc-url "$RPC" --private-key "$DPK" --json | python3 -c "import json,sys;print(json.load(sys.stdin)['status'])"

step "executor: openRemediation"
cast send "$ESCROW" "openRemediation(bytes32,bytes32,address,address,address,uint256,bytes32)" \
  "$RID" "$PID" "$SOURCE" "$REPLACEMENT" "$ASSET" "$AMOUNT" "$PHASH" \
  --rpc-url "$RPC" --private-key "$EPK" --json | python3 -c "import json,sys;print(json.load(sys.stdin)['status'])"

step "approver: approve (separate key)"
cast send "$ESCROW" "approve(bytes32)" "$RID" \
  --rpc-url "$RPC" --private-key "$DPK" --json | python3 -c "import json,sys;print(json.load(sys.stdin)['status'])"

step "source wallet: fundAuthorizedRemediation"
cast send "$VAULT" "fundAuthorizedRemediation(bytes32,bytes32,uint256,bytes32)" \
  "$RID" "$RECEIPT_ID" "$AMOUNT" "$(cast keccak "suture:tx:fund:${CYCLE:-2}")" \
  --rpc-url "$RPC" --private-key "$DPK" --json | python3 -c "import json,sys;print(json.load(sys.stdin)['status'])"

step "executor: release"
cast send "$ESCROW" "release(bytes32)" "$RID" \
  --rpc-url "$RPC" --private-key "$EPK" --json | python3 -c "import json,sys;print(json.load(sys.stdin)['status'])"

echo
echo "replacement wallet asset balance: $(cast call "$ASSET" 'balanceOf(address)(uint256)' "$REPLACEMENT" --rpc-url "$RPC")"
echo "remediation state:"
cast call "$ESCROW" "remediation(bytes32)((bytes32,address,address,address,uint256,uint256,bytes32,uint8))" "$RID" --rpc-url "$RPC"
