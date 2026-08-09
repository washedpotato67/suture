# Monad integration

Deployed to Monad testnet on 2026-08-09. Chain configuration was read from the
live RPC, not copied from documentation.

| Field | Value |
| --- | --- |
| Chain ID | `10143` (confirmed via `cast chain-id`) |
| RPC | `https://testnet-rpc.monad.xyz` |
| Native gas token | MON |
| Deployer | `0xdF947d8ba7b60191212437373B8c80ABeeA68EA6` |

The deployer holds every role — issuer, policy authority (before transfer), and
remediation approver. A testnet demonstration has no separation-of-duties
requirement; a production deployment must split them.

## Deployment map

| Contract | Address | Deployment tx |
| --- | --- | --- |
| `MockERC20` | `0x2d22e91d030143a96cf06de2e53520606f8c60f6` | `0xd425a213b99e53412dcc2e22091ee48faf7eaa807d7cb4ba92c89330eb92cc65` |
| `MockEligibilityOracle` | `0x23b0e4aa312e85da5ac26dc92d2b6ec459033281` | `0x804dd6a105fcefa3e83fa7cac9d862dd5dace1b9f42490b98fbf31fe23f18623` |
| `PolicyManifestRegistry` | `0x586c5f4c0d64597c7ffcf5841521e6f0045935d2` | `0x75cfc7b2f21e8be7075905e7072a25dff731cf4df513ec17681f1cf86272da4e` |
| `PositionLineageRegistry` | `0xbf42ac2a7ece0a18915cf50bc5707184d85d9f98` | `0x8a92e645d1ee2192872bd9be869b4d96ccd57a0b5e55359ce4a6558760f7a485` |
| `BoundVault` | `0x6985f751982d81a51f3474d9ae1d12f072d3dcd5` | `0x7172bb7d0a3f0240ed28d2094aff0372cf91dc5cb8d8b77e7268474dbf6d9613` |
| `MockCreditMarket` | `0xb7d6697e042f251bbc9d4f898ad62b9c08eef8ff` | `0xcbb063c606a2721aaa0cc66fff074f1d4ca1b23e39ef7ce1913254a87c7fc138` |
| `RemediationEscrow` | `0x1a5dbdff02bd4a1faead7482a131755f1e4d8949` | `0x3ce6b82273a9a930e1acd2d212bbe0083e5cc41aa9aad925c8ef7dd7f7d53d94` |
| `PolicyActivationScheduler` | `0x3cB1268e7806F8b31ad5EBa96Af85E92F5e6948a` | deployed via `forge create`; holds policy authority |

`MockERC20` and `MockEligibilityOracle` are mocks. This slice demonstrates
policy activation, asserted lineage, bound receipts, and authority-gated
remediation. It is not a production asset and not a real credential oracle.

## Same-block activation and why a scheduler exists

`PolicyManifestRegistry.activatePolicy` requires `effectiveAt == block.timestamp`
exactly, so a policy can never be back-dated or silently pre-scheduled. That
invariant is correct, but it makes activation unreachable for an externally
owned account: a broadcast transaction lands in a future block whose timestamp
the sender cannot predict, so the supplied value is always stale on arrival.

This was observed, not theorised. Eight sequential attempts from
`script/activate-policy.sh` all reverted with `InvalidEffectiveTime()`; Monad
timestamps advanced roughly two seconds per attempt while inclusion took longer.

`PolicyActivationScheduler` closes the gap without weakening the invariant. It
holds the policy authority and reads `block.timestamp` inside the same
transaction that activates, so the value is correct by construction. The
registry's own test suite named this absence
(`test_policyRejectsFutureActivationUntilAnAuthorizedSchedulerExists`).

The scheduler is new code covered by six unit tests, including one asserting the
registry still rejects a stale caller-supplied time. It has not been audited.

## Verified on-chain behaviour

| Action | Transaction | Result |
| --- | --- | --- |
| Policy activation via scheduler | `0x6f6ed7af944bc41d2f3de02f10687d462b55ae2ddf860ea73743c4410010072f` | `activePolicy` returns version 1, `effectiveAt 1786276174`, status Normal, active |
| Deposit into `BoundVault` | `0x914c3ad5fa2f388f42b6af6ad1aef1ca05946f9f71f249664f3e2e0a308c1f89` | status `0x1`, block 52228000, gas 537234, vault holds 100e18 |

The deposit receipt carries two logs: one from `PositionLineageRegistry`
(lineage recorded) and one from `BoundVault` (deposit). Composition through the
credit market, collateral release, and remediation are covered by Foundry tests
but have not been executed on testnet.

## Not established

No bytecode verification on a block explorer, no indexer checkpoint, and no
mainnet deployment. `MonadAdapter` in the application remains an unavailable
boundary — the console does not yet read this deployment.
