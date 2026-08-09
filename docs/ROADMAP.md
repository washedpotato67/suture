# SUTURE — Delivery Roadmap

## Milestone 0 — Product proof

- Brand and product thesis.
- Source-to-derived lineage graph.
- Credential-revocation blast radius.
- Truthful demo evidence model.
- Initial multi-tenant schema and RLS.
- Typed integration boundaries.

## Milestone 1 — Hackathon vertical slice

- Authentication and organization onboarding.
- Database-backed overview and lineage.
- Policy preflight for deposit, collateralize, borrow, redeem, and migrate.
- Incident ingestion and immutable impact snapshot.
- Replacement-wallet remediation proposal.
- Issuer approval.
- Audit receipt.
- Monad testnet contracts and event indexing.
- Cleanverse sandbox integration using supplied documentation.

## Milestone 2 — Pilot-ready product

- Production identity and asset adapter contracts.
- Webhooks and replay protection.
- Policy-change simulation before activation.
- Protocol adapter SDK.
- Continuous lineage reconciliation.
- Role invitations and approval thresholds.
- Exportable evidence packs.
- Observability, alerts, support runbooks, backup, and recovery.

## Milestone 3 — Institutional platform

- Multiple issuers and custodians.
- Cross-protocol and cross-chain lineage.
- Qualified liquidator routing.
- Managed incident operations.
- Compliance conformance testing for protocol integrations.
- Policy analytics and historical incident intelligence.

## Release gates

No production claim until:

- tenant isolation is tested across at least two users and organizations;
- live provider responses are independently verified;
- contracts pass unit, integration, invariant, and access-control tests;
- every consequential action is idempotent and reconcilable;
- rollback and pause paths are tested;
- legal and operational authority for remediation is documented.
