# Contract security review

Date: 2026-08-09. Reviewer: the SUTURE development session, not a third party.

## This is not an independent audit

Everything below was produced by the same session that wrote the code under
review. It raises assurance; it does not substitute for an audit. An audit is
valuable precisely because the reviewer did not write the code, has no stake in
it shipping, and is accountable for the opinion. None of that holds here.

Do not cite this document as an audit. Do not place assets under these contracts
on the strength of it.

## What was actually done

| Activity | Result |
| --- | --- |
| Source verification | All 8 deployed contracts `exact_match` on Sourcify for chain 10143 |
| Static analysis | `forge lint`: 2 warnings. `slither` 0.11.x: 13 findings, none High or Medium |
| Unit tests | 19 passing across `Suture.t.sol` and `PolicyActivationScheduler.t.sol` |
| Invariant tests | 5 invariants, 256 runs each, 128,000 calls per invariant, 0 failures |
| Live exercise | Deployment, policy activation, deposit with lineage, and a remediation opened by the executor, all on Monad testnet |

`slither` was installed and run: 13 findings, none High or Medium — 8
`reentrancy-events`, 2 `reentrancy-benign`, 2 `timestamp`, 1
`missing-inheritance`. The reentrancy findings are event emissions and benign
state writes after external calls in `BoundVault.deposit` and
`MockCreditMarket.collateralize`; no state that governs authorisation is written
after an external call. `missing-inheritance` notes `PolicyManifestRegistry`
does not declare the `IPolicyActivation` interface the scheduler defines, which
is cosmetic.

`mythril` was not available, so no symbolic execution was performed. Storage
collision and deep path analysis remain unsearched.

## Invariants proven

Held over 128,000 calls each, with the handler driving accepted *and* rejected
calls so authority bugs surface rather than being skipped:

1. **`fundedNeverExceedsExpected`** — funding can never exceed the declared
   amount. A violation would let an over-funded release drain balance belonging
   to another remediation.
2. **`escrowSolvency`** — the escrow always holds at least the sum of everything
   funded but not released. A violation means a release paid out unbacked
   balance.
3. **`executedImpliesFullyFunded`** — a remediation that reached `Executed` paid
   out exactly its expected amount, never partially.
4. **`policyVersionMonotonic`** — the active policy version never decreases
   regardless of call ordering.
5. **`activePolicyNeverPostDated`** — an active policy's `effectiveAt` is never
   in the future, so the same-block activation rule cannot be bypassed.

## Findings

### 1. Executor key concentration — HIGH, RESOLVED 2026-08-09

Previously the executor signed with the deploy key, which was simultaneously
issuer, policy authority and approver. A dedicated executor key
(`0x96F0B49a557Cd3dE2f2Da419e2b48152a6cC5379`) now holds `policyAuthority` on a
redeployed escrow (`0x9E680FD3e2743Ff0691D27FbEA7A3Bf418fa4765`); the human
deploy key retains `approver`. Both roles are `immutable`, so separation
required redeployment rather than a setter.

Proven on chain: the executor opened and released, and approval reverted to the
separate human key. The executor cannot approve its own remediation.

Residual: the executor key still signs unattended with no spend limit or
rotation policy, and the deploy key remains issuer and approver.

### 2. `PolicyActivationScheduler` holds policy authority — MEDIUM, by design

The scheduler was written during this session to make same-block activation
reachable from an externally owned account. It now holds the policy authority on
the deployment. It is small and has 6 unit tests including one asserting the
registry still rejects a stale caller-supplied time, but it is new code written
under time pressure and reviewed only by its author.

### 3. `block.timestamp` comparisons — LOW, intentional

`forge lint` flags two uses in `PolicyManifestRegistry`. Both are the same-block
activation rule, which is the point of the design: validators can nudge
timestamps by seconds, which is immaterial to a policy that must activate in the
block it is submitted in. Accepted, not fixed.

### 4. Mock asset and eligibility oracle — INFORMATIONAL

The deployment uses `MockERC20` and `MockEligibilityOracle`. Behaviour against a
real ERC-20 with transfer fees, rebasing, or non-standard return values is
untested, as is a real credential oracle. `BoundVault.release` does check
balance deltas rather than trusting return values, which is the right instinct,
but it has not been exercised against a hostile token.

### 5. Release path — RESOLVED 2026-08-09

The full cycle now runs on chain with separated roles: executor opens, human
approves, source wallet funds through the vault, executor releases. 100e18 moved
to the replacement wallet and the remediation reached status Executed. See
`contracts/script/exercise-remediation.sh`.

The escrow binds a remediation to a specific receipt (`positionId ==
receiptPositionId`); a first attempt with a synthetic position id correctly
reverted `InvalidRemediation`.

## What would move this materially

1. An independent audit. Nothing here replaces it.
2. A symbolic execution pass (`mythril`); `slither` is now covered.
3. Fork tests against a real ERC-20 and a hostile token.
4. Spend limits and rotation for the executor key; splitting issuer from approver.
5. Splitting the remaining deploy-key roles (issuer, approver, vault authority).
