import type { LineageEdge, LineageNode } from "./types";

export interface BlastRadius {
  sourceNodeId: string;
  affectedNodeIds: string[];
  affectedValueUsd: number;
  paths: string[][];
}

export type EngineCredentialState = "valid" | "expired" | "suspended" | "revoked" | "unknown";
export type EngineEvidenceState = "none" | "asserted" | "verified" | "contested";
export type EngineEmergencyStatus = "normal" | "exit_only" | "paused";

export interface LineagePositionRecord {
  id: string;
  organizationId: string;
  assetId: string;
  walletId: string;
  protocolId: string | null;
  positionType: "source_asset" | "vault_receipt" | "collateral" | "debt";
  policyVersion: string;
  representedExposureUsd: number;
  evidenceState: EngineEvidenceState;
}

export interface LineageEventRecord {
  id: string;
  organizationId: string;
  sourcePositionId: string;
  derivedPositionId: string;
  protocolId: string;
  ownerWalletId: string;
  transactionReference: string;
  policyVersion: string;
  observedAt: string;
  evidenceState: EngineEvidenceState;
}

export interface CredentialObservation {
  walletId: string;
  state: EngineCredentialState;
  validFrom?: string;
  validUntil?: string;
  evidenceState: EngineEvidenceState;
}

export interface ActivePolicyContext {
  assetId: string;
  version: string;
  effectiveAt: string;
  active: boolean;
  emergencyStatus: EngineEmergencyStatus;
  safeRestrictedExit: boolean;
}

export interface BlockedAction {
  action: "deposit" | "collateralize" | "borrow" | "transfer";
  reasonCode: string;
}

export interface RequiredRemediationPath {
  positionId: string;
  action: "restricted_exit" | "wallet_migration" | "issuer_review";
  reasonCode: string;
}

export interface LineageAnalysisInput {
  organizationId: string;
  walletId: string;
  sourceAssetId: string;
  credential: CredentialObservation;
  policy: ActivePolicyContext;
  positions: readonly LineagePositionRecord[];
  events: readonly LineageEventRecord[];
  asOf: string;
}

export interface LineageAnalysis {
  sourcePositionIds: string[];
  affectedPositionIds: string[];
  affectedProtocolIds: string[];
  downstreamPaths: string[][];
  totalRepresentedExposureUsd: number;
  blockedActions: BlockedAction[];
  requiredRemediationPaths: RequiredRemediationPath[];
  cyclePositionIds: string[];
  evidenceState: EngineEvidenceState;
}

const RISK_ACTIONS: BlockedAction["action"][] = ["deposit", "collateralize", "borrow", "transfer"];

function credentialReason(credential: CredentialObservation, asOf: Date): string | null {
  if (credential.state !== "valid") return `CREDENTIAL_${credential.state.toUpperCase()}`;
  if (credential.validFrom && new Date(credential.validFrom) > asOf) return "CREDENTIAL_NOT_YET_VALID";
  if (credential.validUntil && new Date(credential.validUntil) <= asOf) return "CREDENTIAL_EXPIRED";
  return null;
}

function policyReason(policy: ActivePolicyContext, asOf: Date): string | null {
  if (!policy.active) return "POLICY_INACTIVE";
  if (new Date(policy.effectiveAt) > asOf) return "POLICY_NOT_EFFECTIVE";
  if (policy.emergencyStatus === "paused") return "POLICY_PAUSED";
  if (policy.emergencyStatus === "exit_only") return "POLICY_EXIT_ONLY";
  return null;
}

function weakestEvidence(states: readonly EngineEvidenceState[]): EngineEvidenceState {
  if (states.includes("contested")) return "contested";
  if (states.includes("none")) return "none";
  if (states.includes("asserted")) return "asserted";
  return "verified";
}

/**
 * Deterministic server-domain analysis. Database and provider adapters supply
 * the records; this function neither calls providers nor labels input verified.
 */
export function analyzeLineage(input: LineageAnalysisInput): LineageAnalysis {
  const asOf = new Date(input.asOf);
  if (Number.isNaN(asOf.getTime())) throw new Error("Invalid analysis timestamp");
  if (input.credential.walletId !== input.walletId) throw new Error("Credential wallet mismatch");
  if (input.policy.assetId !== input.sourceAssetId) throw new Error("Policy asset mismatch");

  const positionsById = new Map<string, LineagePositionRecord>();
  for (const position of input.positions) {
    if (position.organizationId !== input.organizationId) continue;
    if (positionsById.has(position.id)) throw new Error(`Duplicate position: ${position.id}`);
    positionsById.set(position.id, position);
  }

  const sourcePositionIds = [...positionsById.values()]
    .filter(
      (position) =>
        position.assetId === input.sourceAssetId
        && position.walletId === input.walletId
        && position.positionType === "source_asset",
    )
    .map((position) => position.id);
  if (sourcePositionIds.length === 0) throw new Error("No source position for wallet and asset");

  const children = new Map<string, LineageEventRecord[]>();
  const eventIds = new Set<string>();
  for (const event of input.events) {
    if (eventIds.has(event.id)) continue;
    eventIds.add(event.id);
    if (!positionsById.has(event.sourcePositionId)) continue;
    const derived = positionsById.get(event.derivedPositionId);
    if (event.organizationId !== input.organizationId || !derived || derived.organizationId !== input.organizationId) {
      throw new Error("Cross-tenant lineage event");
    }
    const entries = children.get(event.sourcePositionId) ?? [];
    entries.push(event);
    children.set(event.sourcePositionId, entries);
  }

  const affected = new Set<string>(sourcePositionIds);
  const downstreamPaths: string[][] = [];
  const cyclePositionIds = new Set<string>();
  const queue = sourcePositionIds.map((id) => ({ positionId: id, path: [id] }));

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    for (const event of children.get(current.positionId) ?? []) {
      if (current.path.includes(event.derivedPositionId)) {
        cyclePositionIds.add(event.derivedPositionId);
        continue;
      }
      const path = [...current.path, event.derivedPositionId];
      downstreamPaths.push(path);
      if (!affected.has(event.derivedPositionId)) {
        affected.add(event.derivedPositionId);
        queue.push({ positionId: event.derivedPositionId, path });
      }
    }
  }

  const affectedPositions = [...affected]
    .map((id) => positionsById.get(id))
    .filter((position): position is LineagePositionRecord => Boolean(position));
  const credentialBlock = credentialReason(input.credential, asOf);
  const policyBlock = policyReason(input.policy, asOf);
  const inheritedVersionBlock = affectedPositions.some((position) => position.policyVersion !== input.policy.version)
    || input.events.some(
      (event) => affected.has(event.sourcePositionId) && event.policyVersion !== input.policy.version,
    );
  const reasonCode = credentialBlock ?? policyBlock ?? (inheritedVersionBlock ? "POLICY_VERSION_CHANGED" : null);
  const blockedActions = reasonCode ? RISK_ACTIONS.map((action) => ({ action, reasonCode })) : [];

  const terminalPositionIds = affectedPositions
    .filter((position) => (children.get(position.id)?.length ?? 0) === 0)
    .map((position) => position.id);
  const remediationAction: RequiredRemediationPath["action"] = input.policy.safeRestrictedExit
    ? "restricted_exit"
    : credentialBlock
      ? "wallet_migration"
      : "issuer_review";
  const requiredRemediationPaths = reasonCode
    ? terminalPositionIds.map((positionId) => ({ positionId, action: remediationAction, reasonCode }))
    : [];

  return {
    sourcePositionIds,
    affectedPositionIds: affectedPositions.map((position) => position.id),
    affectedProtocolIds: [...new Set(affectedPositions.flatMap((position) => position.protocolId ? [position.protocolId] : []))],
    downstreamPaths,
    totalRepresentedExposureUsd: affectedPositions.reduce(
      (sum, position) => sum + position.representedExposureUsd,
      0,
    ),
    blockedActions,
    requiredRemediationPaths,
    cyclePositionIds: [...cyclePositionIds],
    evidenceState: weakestEvidence([
      input.credential.evidenceState,
      ...affectedPositions.map((position) => position.evidenceState),
      ...input.events.filter((event) => affected.has(event.sourcePositionId)).map((event) => event.evidenceState),
    ]),
  };
}

export function calculateBlastRadius(
  sourceNodeId: string,
  nodes: readonly LineageNode[],
  edges: readonly LineageEdge[],
): BlastRadius {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  if (!nodeById.has(sourceNodeId)) {
    throw new Error(`Unknown source node: ${sourceNodeId}`);
  }

  const children = new Map<string, string[]>();
  for (const edge of edges) {
    const next = children.get(edge.from) ?? [];
    next.push(edge.to);
    children.set(edge.from, next);
  }

  const visited = new Set<string>([sourceNodeId]);
  const queue: Array<{ id: string; path: string[] }> = [{ id: sourceNodeId, path: [sourceNodeId] }];
  const paths: string[][] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    for (const childId of children.get(current.id) ?? []) {
      const childPath = [...current.path, childId];
      paths.push(childPath);
      if (!visited.has(childId)) {
        visited.add(childId);
        queue.push({ id: childId, path: childPath });
      }
    }
  }

  const affectedNodeIds = [...visited];
  const affectedValueUsd = affectedNodeIds.reduce(
    (sum, id) => sum + (nodeById.get(id)?.amountUsd ?? 0),
    0,
  );

  return { sourceNodeId, affectedNodeIds, affectedValueUsd, paths };
}
