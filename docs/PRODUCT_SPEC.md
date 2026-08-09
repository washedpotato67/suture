# SUTURE — Product Definition v0.1

## Product thesis

Regulated tokenized assets cannot become safely composable if their identity, transfer, and policy restrictions disappear after the first wrapper or protocol deposit. SUTURE keeps the originating policy attached to every derived position and provides a controlled recovery path when eligibility changes.

## Primary promise

**Compliance that survives composition.**

SUTURE lets an issuer or protocol operator answer three operational questions:

1. Where has exposure to this regulated asset moved?
2. Which downstream positions are affected by this identity or policy event?
3. What authorized action can resolve the incident without destroying the audit trail?

## Initial users

- Issuer administrator: owns the asset policy and remediation authority.
- Compliance operator: investigates incidents and prepares remediation plans.
- Protocol integrator: maintains lineage and policy adapters.
- Auditor: inspects immutable evidence and receipts.
- Organization owner: manages access and high-impact approvals.

## Core workflow

1. Register a source asset and immutable policy version.
2. Observe or record an asset transformation into a derived position.
3. Attach policy version and evidence state to every lineage edge.
4. Ingest a credential or policy event.
5. Traverse the lineage graph and calculate affected positions and value.
6. Block unsafe new movement through policy preflight.
7. Prepare an issuer-authorized remediation plan.
8. Obtain required approval.
9. Execute idempotently, reconcile uncertain outcomes, and issue an audit receipt.

## First vertical slice

- One issuer organization.
- One private-credit note.
- One source wallet and replacement wallet.
- One vault receipt.
- One collateral position.
- One debt position.
- One credential-revocation incident.
- Blast-radius calculation.
- Read-only incident and lineage console.
- Live Cleanverse provider evaluation and a Monad testnet contract deployment, with a labelled deterministic fallback when neither is configured.

## Explicit non-goals for v0.1

- Legal eligibility determination.
- Custody of user assets.
- Live KYC or accreditation decisions.
- Automatic seizure or forced migration.
- Full multi-chain indexing.
- Unbounded autonomous remediation.
- Production mainnet deployment.

## Success criteria

The first product slice succeeds when a reviewer can:

- understand the source-to-derived position chain in under ten seconds;
- revoke the demo credential and see all affected positions;
- distinguish asserted demo evidence from verified evidence;
- see why a new movement is blocked;
- identify the approval required for the proposed recovery path;
- reproduce the blast-radius calculation from stored lineage records.
