export type EvidenceState = "none" | "asserted" | "verified" | "contested";

export interface ServerPosition {
  id: string;
  organizationId: string;
  assetId: string;
  walletId: string;
  protocolId: string | null;
  policyVersion: string;
  representedExposureUsd: string;
  evidenceState: EvidenceState;
  positionType: string;
}

function usdCents(value: string): bigint {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error("Invalid represented exposure amount");
  const [whole = "0", fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
}

function formatUsdCents(value: bigint): string {
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, "0");
  return `${whole}.${fraction}`;
}

export interface ServerEdge {
  id: string;
  organizationId: string;
  sourcePositionId: string;
  derivedPositionId: string;
  protocolId: string;
  policyVersion: string;
  evidenceState: EvidenceState;
}

export interface ServerLineageInput {
  organizationId: string;
  walletId: string;
  sourceAssetId: string;
  credential: { state: string; validFrom: string | null; validUntil: string | null; evidenceState: EvidenceState };
  policy: { version: string; effectiveAt: string; active: boolean; emergencyStatus: string; safeRestrictedExit: boolean };
  positions: ServerPosition[];
  edges: ServerEdge[];
  asOf: string;
}

export function analyzeServerLineage(input: ServerLineageInput) {
  const asOf = new Date(input.asOf);
  // An unparseable timestamp makes every effective-at comparison false, which
  // would silently downgrade a block to a pass.
  if (Number.isNaN(asOf.getTime())) throw new Error("Invalid analysis timestamp");
  const positionById = new Map(input.positions.map((position) => [position.id, position]));
  const sources = input.positions
    .filter((position) => position.assetId === input.sourceAssetId && position.walletId === input.walletId && position.positionType === "source_asset")
    .map((position) => position.id);
  if (sources.length === 0) throw new Error("No source position for wallet and asset");

  const children = new Map<string, ServerEdge[]>();
  const seenEventIds = new Set<string>();
  for (const edge of input.edges) {
    if (seenEventIds.has(edge.id)) continue;
    seenEventIds.add(edge.id);
    if (!positionById.has(edge.sourcePositionId)) continue;
    const derived = positionById.get(edge.derivedPositionId);
    if (edge.organizationId !== input.organizationId || !derived || derived.organizationId !== input.organizationId) {
      throw new Error("Cross-tenant lineage event");
    }
    children.set(edge.sourcePositionId, [...(children.get(edge.sourcePositionId) ?? []), edge]);
  }

  const affected = new Set(sources);
  const downstreamPaths: string[][] = [];
  const cyclePositionIds = new Set<string>();
  const queue = sources.map((positionId) => ({ positionId, path: [positionId] }));
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    for (const edge of children.get(current.positionId) ?? []) {
      if (current.path.includes(edge.derivedPositionId)) {
        cyclePositionIds.add(edge.derivedPositionId);
        continue;
      }
      const path = [...current.path, edge.derivedPositionId];
      downstreamPaths.push(path);
      if (!affected.has(edge.derivedPositionId)) {
        affected.add(edge.derivedPositionId);
        queue.push({ positionId: edge.derivedPositionId, path });
      }
    }
  }

  const positions = [...affected].map((id) => positionById.get(id)).filter((position): position is ServerPosition => Boolean(position));
  const credentialNotYetValid = input.credential.validFrom && new Date(input.credential.validFrom) > asOf;
  const credentialExpired = input.credential.validUntil && new Date(input.credential.validUntil) <= asOf;
  const credentialReason = input.credential.state !== "valid"
    ? `CREDENTIAL_${input.credential.state.toUpperCase()}`
    : credentialNotYetValid ? "CREDENTIAL_NOT_YET_VALID"
    : credentialExpired ? "CREDENTIAL_EXPIRED" : null;
  // Reason codes match src/domain/lineage.ts and the preflight path so one
  // control never reports two different codes.
  const policyReason = !input.policy.active
    ? "POLICY_INACTIVE"
    : new Date(input.policy.effectiveAt) > asOf ? "POLICY_NOT_EFFECTIVE"
    : input.policy.emergencyStatus === "paused" ? "POLICY_PAUSED"
    : input.policy.emergencyStatus === "exit_only" ? "POLICY_EXIT_ONLY" : null;
  const versionChanged = positions.some((position) => position.policyVersion !== input.policy.version)
    || input.edges.some((edge) => affected.has(edge.sourcePositionId) && edge.policyVersion !== input.policy.version);
  const reasonCode = credentialReason ?? policyReason ?? (versionChanged ? "POLICY_VERSION_CHANGED" : null);
  const blockedActions = reasonCode
    ? ["deposit", "collateralize", "borrow", "transfer"].map((action) => ({ action, reasonCode }))
    : [];
  const terminalPositions = positions.filter((position) => (children.get(position.id)?.length ?? 0) === 0);
  const remediationAction = input.policy.safeRestrictedExit ? "restricted_exit" : credentialReason ? "wallet_migration" : "issuer_review";

  return {
    sourcePositionIds: sources,
    affectedPositionIds: positions.map((position) => position.id),
    affectedProtocolIds: [...new Set(positions.flatMap((position) => position.protocolId ? [position.protocolId] : []))],
    downstreamPaths,
    // Keep financial aggregation out of JavaScript floating-point arithmetic.
    totalRepresentedExposureUsd: formatUsdCents(
      positions.reduce((sum, position) => sum + usdCents(position.representedExposureUsd), 0n),
    ),
    blockedActions,
    requiredRemediationPaths: reasonCode
      ? terminalPositions.map((position) => ({ positionId: position.id, action: remediationAction, reasonCode }))
      : [],
    cyclePositionIds: [...cyclePositionIds],
    evidenceState: weakestEvidence([
      input.credential.evidenceState,
      ...positions.map((position) => position.evidenceState),
      ...input.edges.filter((edge) => affected.has(edge.sourcePositionId)).map((edge) => edge.evidenceState),
    ]),
  };
}

function weakestEvidence(states: readonly EvidenceState[]): EvidenceState {
  if (states.includes("contested")) return "contested";
  if (states.includes("none")) return "none";
  if (states.includes("asserted")) return "asserted";
  return "verified";
}
