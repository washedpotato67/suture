import type {
  Incident,
  IntegrationStatus,
  LineageEdge,
  LineageNode,
  PolicyCheckResult,
} from "./types";

export const DEMO_ORGANIZATION = "Northstar Capital — DEMO DATA";

export const nodes: LineageNode[] = [
  {
    id: "asset-note",
    kind: "asset",
    label: "Northstar Private Credit Note 2028",
    subtitle: "Source restricted RWA",
    amountUsd: 1_250_000,
    ownerWallet: "0x71A4…91C2",
    policyVersion: "NSPC-4.2",
    credentialState: "revoked",
    evidenceState: "asserted",
    state: "at_risk",
    x: 90,
    y: 185,
  },
  {
    id: "vault-receipt",
    kind: "vault_receipt",
    label: "bvNSPC Receipt",
    subtitle: "BoundVault position",
    amountUsd: 1_250_000,
    ownerWallet: "0x71A4…91C2",
    policyVersion: "NSPC-4.2",
    credentialState: "revoked",
    evidenceState: "asserted",
    state: "at_risk",
    x: 390,
    y: 185,
  },
  {
    id: "credit-collateral",
    kind: "collateral",
    label: "MockCredit Collateral",
    subtitle: "Receipt pledged at 68% LTV",
    amountUsd: 850_000,
    ownerWallet: "0x71A4…91C2",
    policyVersion: "NSPC-4.2",
    credentialState: "revoked",
    evidenceState: "asserted",
    state: "blocked",
    x: 690,
    y: 105,
  },
  {
    id: "stable-debt",
    kind: "debt",
    label: "USDC Borrow Position",
    subtitle: "Outstanding debt",
    amountUsd: 612_000,
    ownerWallet: "0x71A4…91C2",
    policyVersion: "NSPC-4.2",
    credentialState: "revoked",
    evidenceState: "asserted",
    state: "blocked",
    x: 690,
    y: 290,
  },
];

export const edges: LineageEdge[] = [
  {
    id: "edge-deposit",
    from: "asset-note",
    to: "vault-receipt",
    action: "deposit",
    policyVersion: "NSPC-4.2",
    evidenceState: "asserted",
  },
  {
    id: "edge-collateral",
    from: "vault-receipt",
    to: "credit-collateral",
    action: "collateralize",
    policyVersion: "NSPC-4.2",
    evidenceState: "asserted",
  },
  {
    id: "edge-borrow",
    from: "credit-collateral",
    to: "stable-debt",
    action: "borrow",
    policyVersion: "NSPC-4.2",
    evidenceState: "asserted",
  },
];

export const incident: Incident = {
  id: "incident-001",
  type: "credential_revocation",
  title: "Credential revoked after downstream composition",
  summary:
    "The source holder credential was revoked after the note was deposited, wrapped, and used as collateral.",
  sourceNodeId: "asset-note",
  createdAt: "2026-07-30T00:08:00.000Z",
  status: "open",
  severity: "critical",
};

export const checks: PolicyCheckResult[] = [
  {
    id: "cvi",
    label: "Holder credential",
    status: "fail",
    reasonCode: "CREDENTIAL_REVOKED",
    detail: "The active wallet credential is revoked.",
    evidenceState: "asserted",
  },
  {
    id: "source_asset",
    label: "Asset provenance",
    status: "pass",
    reasonCode: "SOURCE_ASSET_ASSERTED",
    detail: "Demo source-asset provenance is an asserted fixture under policy NSPC-4.2.",
    evidenceState: "asserted",
  },
  {
    id: "policy",
    label: "Policy continuity",
    status: "fail",
    reasonCode: "DERIVED_POSITION_INELIGIBLE",
    detail: "New movement is blocked across all derived positions.",
    evidenceState: "asserted",
  },
  {
    id: "exit",
    label: "Safe remediation path",
    status: "unknown",
    reasonCode: "APPROVAL_REQUIRED",
    detail: "Issuer approval is required before migration to a replacement wallet.",
    evidenceState: "none",
  },
];

export const integrations: IntegrationStatus[] = [
  { name: "Cleanverse A-Pass", state: "simulated", detail: "Deterministic fixture. No external API call." },
  { name: "Cleanverse A-Token", state: "unavailable", detail: "No documented provider scope is configured." },
  { name: "Cleanverse Validator", state: "unavailable", detail: "No documented provider scope is configured." },
  { name: "Monad", state: "unavailable", detail: "No RPC, indexer, or deployment is connected." },
];
