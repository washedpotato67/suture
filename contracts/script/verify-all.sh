#!/usr/bin/env bash
set -uo pipefail

# Submits every deployed contract to Sourcify for source verification.
# Idempotent: re-running an already-verified contract is harmless.

CHAIN_ID="${CHAIN_ID:-10143}"
DEPLOYER="${DEPLOYER:-0xdF947d8ba7b60191212437373B8c80ABeeA68EA6}"

TOKEN=0x2d22e91d030143a96cf06de2e53520606f8c60f6
ORACLE=0x23b0e4aa312e85da5ac26dc92d2b6ec459033281
POLICIES=0x586c5f4c0d64597c7ffcf5841521e6f0045935d2
LINEAGE=0xbf42ac2a7ece0a18915cf50bc5707184d85d9f98
VAULT=0x6985f751982d81a51f3474d9ae1d12f072d3dcd5
MARKET=0xb7d6697e042f251bbc9d4f898ad62b9c08eef8ff
ESCROW=0x1a5dbdff02bd4a1faead7482a131755f1e4d8949
SCHEDULER=0x3cB1268e7806F8b31ad5EBa96Af85E92F5e6948a

submit() {
  local address="$1" target="$2" args="${3:-}"
  printf '%-28s ' "$(echo "$target" | cut -d: -f2)"
  if [ -n "$args" ]; then
    forge verify-contract "$address" "$target" --chain-id "$CHAIN_ID" --verifier sourcify \
      --constructor-args "$args" 2>&1 | grep -oE "Verification Job ID: .*" | head -1 || echo "submit failed"
  else
    forge verify-contract "$address" "$target" --chain-id "$CHAIN_ID" --verifier sourcify 2>&1 \
      | grep -oE "Verification Job ID: .*" | head -1 || echo "submit failed"
  fi
}

submit "$TOKEN"     "test/Suture.t.sol:MockERC20"
submit "$ORACLE"    "test/Suture.t.sol:MockEligibilityOracle"
submit "$POLICIES"  "src/PolicyManifestRegistry.sol:PolicyManifestRegistry" \
  "$(cast abi-encode 'constructor(address,address)' "$DEPLOYER" "$DEPLOYER")"
submit "$LINEAGE"   "src/PositionLineageRegistry.sol:PositionLineageRegistry" \
  "$(cast abi-encode 'constructor(address)' "$DEPLOYER")"
submit "$VAULT"     "src/BoundVault.sol:BoundVault" \
  "$(cast abi-encode 'constructor(address,address,address,address,address)' "$DEPLOYER" "$TOKEN" "$ORACLE" "$POLICIES" "$LINEAGE")"
submit "$MARKET"    "src/MockCreditMarket.sol:MockCreditMarket" \
  "$(cast abi-encode 'constructor(address,address,address,address)' "$VAULT" "$ORACLE" "$POLICIES" "$LINEAGE")"
submit "$ESCROW"    "src/RemediationEscrow.sol:RemediationEscrow" \
  "$(cast abi-encode 'constructor(address,address)' "$DEPLOYER" "$DEPLOYER")"
submit "$SCHEDULER" "src/PolicyActivationScheduler.sol:PolicyActivationScheduler" \
  "$(cast abi-encode 'constructor(address,address)' "$POLICIES" "$DEPLOYER")"
