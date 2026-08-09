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
| Static analysis | `forge lint`: 2 warnings, both `block-timestamp`, both triaged below |
| Unit tests | 19 passing across `Suture.t.sol` and `PolicyActivationScheduler.t.sol` |
| Invariant tests | 5 invariants, 256 runs each, 128,000 calls per invariant, 0 failures |
| Live exercise | Deployment, policy activation, deposit with lineage, and a remediation opened by the executor, all on Monad testnet |

`slither` and `mythril` were not available in this environment, so no symbolic
execution or dataflow analysis was performed. That is a real gap: the classes of
bug those tools find best (reentrancy paths, unchecked external calls, storage
collisions) have not been systematically searched for.

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

### 1. Executor key concentration — HIGH, unresolved

`MONAD_EXECUTOR_KEY` is the deploy key, which is simultaneously issuer, policy
authority, remediation approver, and now the live executor's signer. Compromise
of that single key compromises every authority boundary the design defines.
Acceptable for a testnet demonstration; unacceptable for production, which needs
separated roles, spend limits, and rotation.

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

### 5. Release path unexercised on chain — INFORMATIONAL

The live run opened a remediation. Funding must originate from the source wallet
by design, so `release` has been exercised only in Foundry tests, never on a
real chain.

## What would move this materially

1. An independent audit. Nothing here replaces it.
2. `slither` and a symbolic execution pass.
3. Fork tests against a real ERC-20 and a hostile token.
4. Splitting the executor key into scoped roles with limits.
5. Exercising the full fund-and-release cycle on chain.
