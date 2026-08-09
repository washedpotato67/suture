export type EvidenceState = "none" | "asserted" | "verified" | "contested" | "simulated" | "unavailable";
export type CredentialState = "valid" | "expired" | "suspended" | "revoked" | "unknown";
export type PositionState = "healthy" | "at_risk" | "blocked" | "remediating" | "resolved";
export type NodeKind = "asset" | "vault_receipt" | "collateral" | "debt";

export interface LineageNode {
  id: string;
  kind: NodeKind;
  label: string;
  subtitle: string;
  amountUsd: number;
  ownerWallet: string;
  policyVersion: string;
  credentialState: CredentialState;
  evidenceState: EvidenceState;
  state: PositionState;
  protocolName?: string;
  assetReference?: string;
  observedAt?: string;
  x: number;
  y: number;
}

export interface LineageEdge {
  id: string;
  from: string;
  to: string;
  action: "deposit" | "mint_receipt" | "collateralize" | "borrow";
  policyVersion: string;
  evidenceState: EvidenceState;
  protocolName?: string;
  transactionReference?: string;
  observedAt?: string;
}

export interface Incident {
  id: string;
  type: "credential_revocation" | "credential_expiry" | "policy_change" | "wallet_compromise";
  title: string;
  summary: string;
  sourceNodeId: string;
  createdAt: string;
  status: "open" | "approved" | "executing" | "resolved";
  severity: "low" | "medium" | "high" | "critical";
}

export interface PolicyCheckResult {
  id: string;
  label: string;
  status: "pass" | "fail" | "unknown";
  reasonCode: string;
  detail: string;
  evidenceState: EvidenceState;
  checkedAt?: string;
}

export interface PreflightResult {
  source: "server" | "fixture";
  decision: "PASS" | "BLOCK" | "REVIEW";
  action: string;
  checks: PolicyCheckResult[];
  reasonCodes: string[];
  evaluatedAt: string;
  evidenceState: EvidenceState;
  providerReferences: Array<{ requestId?: string; providerCode?: string; responseDigest?: string }>;
  requiredRemediationPaths: Array<{ action: string; reasonCode: string }>;
  recovery?: string;
}

export interface WorkspaceAsset {
  id: string;
  label: string;
  assetReference: string;
  activePolicyVersion: string;
  activePolicyVersionId?: string;
  policyHash?: string;
  evidenceState: EvidenceState;
  positionIds: string[];
  policyHistory: Array<{ version: string; policyHash?: string; effectiveAt?: string }>;
}

export interface ActivityEvent {
  id: string;
  eventType: string;
  subjectType: string;
  occurredAt: string;
  evidenceState: EvidenceState;
  detail: string;
}

export interface IntegrationStatus {
  name: string;
  state: "connected" | "simulated" | "unavailable" | "misconfigured";
  detail: string;
  checkedAt?: string;
  errorCode?: string;
}

export type RemediationStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "executing"
  | "uncertain"
  | "resolved"
  | "cancelled";

export interface RemediationPlan {
  id: string;
  incidentId: string;
  planType: "wallet_migration";
  status: RemediationStatus;
  sourceWallet: string;
  replacementWallet: string;
  idempotencyKey: string;
  evidenceState: EvidenceState;
  createdAt: string;
  approvedAt?: string;
  executedAt?: string;
}

export type ApprovalDecision = "requested" | "approved" | "rejected";

export interface ApprovalRecord {
  id: string;
  planId: string;
  requiredRole: string;
  decision: ApprovalDecision;
  decidedAt: string;
  note?: string;
}

export interface AuditReceipt {
  id: string;
  incidentId: string;
  planId: string;
  receiptHash: string;
  payload: Record<string, unknown>;
  issuedAt: string;
}
