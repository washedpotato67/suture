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

Known boundary: full live provider, chain, hosted function, and browser end-to-end validation remain incomplete. See `docs/LIMITATIONS.md`.
