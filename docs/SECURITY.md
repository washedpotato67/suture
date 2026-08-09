# Security posture

The browser has read-only access to tenant data. Server functions and constrained database RPCs own compliance observations, policy activation, remediation state changes, and provider access.

Key controls:

- RLS and cross-tenant reference guards restrict organization data.
- Policy versions, credential observations, lineage, impact snapshots, approval records, remediation actions, receipts, audit events, and provider decisions are append-only.
- Browser callers cannot mark lineage or impact output verified. Those writes accept asserted evidence only until a trusted attestation bridge exists.
- Preflight fails closed for local credential downgrade, policy emergency state, unavailable asset verification, unsupported provider action, missing provider configuration, and provider failure.
- Remediation approval and execution require an owner or issuer administrator. Replays return the persisted receipt.
- Contract remediation requires an authority-opened, approved plan, policy hash match, eligible recipient, caller-funded vault position, and observed escrow balance increase.
- Provider secrets remain server-only. Audit export redacts EVM wallet addresses.

- Live execution RPCs (`record_remediation_submission`, `confirm_remediation_submission`, `mark_remediation_uncertain`) are service-role only; execute is revoked from `anon` and `authenticated`, so a browser session cannot record a chain submission.
- The chain executor holds a scoped key that can open and release a remediation but cannot approve one. Approval requires a separate key, enforced by immutable roles on the escrow and demonstrated on chain.

Known boundaries, as of 2026-08-09:

- Live provider, chain, hosted function, and browser end-to-end paths have all been exercised and are recorded in `docs/CLEANVERSE_VERIFICATION.md` and `docs/MONAD.md`.
- The executor key signs unattended with no spend limit or rotation policy, and the deploy key remains issuer, approver, and vault authority. Role separation is partial.
- The contracts are not independently audited. `docs/SECURITY_REVIEW.md` states plainly that it is not an audit.
- If a transaction is submitted but the recording step fails, reconciliation cannot settle it, because it works from a stored hash. Recovering that case needs the `RemediationOpened` event read back from chain logs, which is not implemented.
- The sandbox provider key was exposed and could not be rotated, so provider results are reproducible but not independently trustworthy provenance.

See `docs/LIMITATIONS.md`.
