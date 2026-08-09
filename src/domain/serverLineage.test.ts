import { describe, expect, it } from "vitest";
import { analyzeServerLineage, type ServerLineageInput } from "../../supabase/functions/_shared/lineage-engine";

function serverInput(): ServerLineageInput {
  return {
    organizationId: "org-1",
    walletId: "wallet-1",
    sourceAssetId: "asset-1",
    credential: { state: "valid", validFrom: null, validUntil: null, evidenceState: "asserted" },
    policy: { version: "NSPC-4.2", effectiveAt: "2026-07-01T00:00:00.000Z", active: true, emergencyStatus: "normal", safeRestrictedExit: false },
    positions: [
      { id: "position-source", organizationId: "org-1", assetId: "asset-1", walletId: "wallet-1", protocolId: null, policyVersion: "NSPC-4.2", representedExposureUsd: "1250000.00", evidenceState: "asserted", positionType: "source_asset" },
      { id: "position-receipt", organizationId: "org-1", assetId: "asset-1", walletId: "wallet-1", protocolId: "protocol-1", policyVersion: "NSPC-4.2", representedExposureUsd: "1250000.00", evidenceState: "asserted", positionType: "vault_receipt" },
    ],
    edges: [
      { id: "edge-1", organizationId: "org-1", sourcePositionId: "position-source", derivedPositionId: "position-receipt", protocolId: "protocol-1", policyVersion: "NSPC-4.2", evidenceState: "asserted" },
    ],
    asOf: "2026-08-08T00:00:00.000Z",
  };
}

describe("analyzeServerLineage", () => {
  it("walks stored edges and aggregates exposure without floating-point arithmetic", () => {
    const result = analyzeServerLineage(serverInput());
    expect(result.affectedPositionIds).toEqual(["position-source", "position-receipt"]);
    expect(result.totalRepresentedExposureUsd).toBe("2500000.00");
    expect(result.blockedActions).toEqual([]);
  });

  it("reports a not-yet-effective policy with the same reason code as the client engine", () => {
    const input = serverInput();
    input.policy.effectiveAt = "2026-09-01T00:00:00.000Z";
    expect(analyzeServerLineage(input).blockedActions[0]?.reasonCode).toBe("POLICY_NOT_EFFECTIVE");
  });

  it("distinguishes an inactive policy from an ineffective one", () => {
    const input = serverInput();
    input.policy.active = false;
    expect(analyzeServerLineage(input).blockedActions[0]?.reasonCode).toBe("POLICY_INACTIVE");
  });

  it("blocks every risk action when the credential is revoked", () => {
    const input = serverInput();
    input.credential.state = "revoked";
    const result = analyzeServerLineage(input);
    expect(result.blockedActions.map((action) => action.action)).toEqual(["deposit", "collateralize", "borrow", "transfer"]);
    expect(result.requiredRemediationPaths).toEqual([
      { positionId: "position-receipt", action: "wallet_migration", reasonCode: "CREDENTIAL_REVOKED" },
    ]);
  });

  it("rejects an unparseable analysis timestamp instead of silently passing", () => {
    const input = serverInput();
    input.asOf = "not-a-timestamp";
    expect(() => analyzeServerLineage(input)).toThrow("Invalid analysis timestamp");
  });

  it("rejects a cross-tenant lineage edge", () => {
    const input = serverInput();
    input.edges[0]!.organizationId = "org-2";
    expect(() => analyzeServerLineage(input)).toThrow("Cross-tenant lineage event");
  });
});
