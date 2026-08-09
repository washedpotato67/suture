import { describe, expect, it } from "vitest";
import { edges, nodes } from "./fixtures";
import { analyzeLineage, calculateBlastRadius, type LineageAnalysisInput } from "./lineage";

 describe("calculateBlastRadius", () => {
  it("finds every downstream position exactly once", () => {
    const result = calculateBlastRadius("asset-note", nodes, edges);
    expect(result.affectedNodeIds).toEqual(
      expect.arrayContaining(["asset-note", "vault-receipt", "credit-collateral", "stable-debt"]),
    );
    expect(new Set(result.affectedNodeIds).size).toBe(4);
  });

  it("calculates total affected value", () => {
    const result = calculateBlastRadius("asset-note", nodes, edges);
    expect(result.affectedValueUsd).toBe(3_962_000);
  });

  it("rejects an unknown source", () => {
    expect(() => calculateBlastRadius("missing", nodes, edges)).toThrow("Unknown source node");
  });
});

function analysisInput(overrides: Partial<LineageAnalysisInput> = {}): LineageAnalysisInput {
  return {
    organizationId: "org-a",
    walletId: "wallet-a",
    sourceAssetId: "asset-a",
    credential: { walletId: "wallet-a", state: "valid", evidenceState: "asserted" },
    policy: {
      assetId: "asset-a",
      version: "4.2",
      effectiveAt: "2026-01-01T00:00:00.000Z",
      active: true,
      emergencyStatus: "normal",
      safeRestrictedExit: true,
    },
    positions: [
      { id: "source", organizationId: "org-a", assetId: "asset-a", walletId: "wallet-a", protocolId: null, positionType: "source_asset", policyVersion: "4.2", representedExposureUsd: 100, evidenceState: "asserted" },
      { id: "receipt", organizationId: "org-a", assetId: "asset-a", walletId: "wallet-a", protocolId: "vault", positionType: "vault_receipt", policyVersion: "4.2", representedExposureUsd: 100, evidenceState: "asserted" },
      { id: "collateral", organizationId: "org-a", assetId: "asset-a", walletId: "wallet-a", protocolId: "credit", positionType: "collateral", policyVersion: "4.2", representedExposureUsd: 80, evidenceState: "asserted" },
      { id: "debt", organizationId: "org-a", assetId: "asset-a", walletId: "wallet-a", protocolId: "credit", positionType: "debt", policyVersion: "4.2", representedExposureUsd: 50, evidenceState: "asserted" },
    ],
    events: [
      { id: "event-1", organizationId: "org-a", sourcePositionId: "source", derivedPositionId: "receipt", protocolId: "vault", ownerWalletId: "wallet-a", transactionReference: "tx-1", policyVersion: "4.2", observedAt: "2026-01-01T00:00:00.000Z", evidenceState: "asserted" },
      { id: "event-2", organizationId: "org-a", sourcePositionId: "receipt", derivedPositionId: "collateral", protocolId: "credit", ownerWalletId: "wallet-a", transactionReference: "tx-2", policyVersion: "4.2", observedAt: "2026-01-01T00:00:00.000Z", evidenceState: "asserted" },
      { id: "event-3", organizationId: "org-a", sourcePositionId: "collateral", derivedPositionId: "debt", protocolId: "credit", ownerWalletId: "wallet-a", transactionReference: "tx-3", policyVersion: "4.2", observedAt: "2026-01-01T00:00:00.000Z", evidenceState: "asserted" },
    ],
    asOf: "2026-08-08T00:00:00.000Z",
    ...overrides,
  };
}

describe("analyzeLineage", () => {
  it("traverses source, vault receipt, collateral, and debt", () => {
    const result = analyzeLineage(analysisInput());
    expect(result.affectedPositionIds).toEqual(["source", "receipt", "collateral", "debt"]);
    expect(result.affectedProtocolIds.sort()).toEqual(["credit", "vault"]);
    expect(result.downstreamPaths).toContainEqual(["source", "receipt", "collateral", "debt"]);
    expect(result.totalRepresentedExposureUsd).toBe(330);
    expect(result.blockedActions).toEqual([]);
  });

  it("handles cycles without looping or double-counting exposure", () => {
    const input = analysisInput();
    input.events = [...input.events, {
      id: "event-cycle",
      organizationId: "org-a",
      sourcePositionId: "debt",
      derivedPositionId: "receipt",
      protocolId: "credit",
      ownerWalletId: "wallet-a",
      transactionReference: "tx-cycle",
      policyVersion: "4.2",
      observedAt: input.asOf,
      evidenceState: "asserted",
    }];
    const result = analyzeLineage(input);
    expect(result.affectedPositionIds).toHaveLength(4);
    expect(result.totalRepresentedExposureUsd).toBe(330);
    expect(result.cyclePositionIds).toEqual(["receipt"]);
  });

  it("ignores a duplicate event id", () => {
    const input = analysisInput();
    input.events = [...input.events, input.events[1]!];
    const result = analyzeLineage(input);
    expect(result.affectedPositionIds).toHaveLength(4);
    expect(result.downstreamPaths).toHaveLength(3);
  });

  it("blocks risk actions and proposes remediation for revoked credentials", () => {
    const input = analysisInput({ credential: { walletId: "wallet-a", state: "revoked", evidenceState: "asserted" } });
    const result = analyzeLineage(input);
    expect(result.blockedActions.map((item) => item.reasonCode)).toEqual([
      "CREDENTIAL_REVOKED", "CREDENTIAL_REVOKED", "CREDENTIAL_REVOKED", "CREDENTIAL_REVOKED",
    ]);
    expect(result.requiredRemediationPaths).toEqual([
      { positionId: "debt", action: "restricted_exit", reasonCode: "CREDENTIAL_REVOKED" },
    ]);
  });

  it("treats elapsed credential validity as expired", () => {
    const input = analysisInput({
      credential: { walletId: "wallet-a", state: "valid", validUntil: "2026-08-07T23:59:59.000Z", evidenceState: "asserted" },
    });
    expect(analyzeLineage(input).blockedActions[0]?.reasonCode).toBe("CREDENTIAL_EXPIRED");
  });

  it("blocks new risk when affected positions inherited an older policy version", () => {
    const input = analysisInput({
      policy: { ...analysisInput().policy, version: "4.3" },
    });
    expect(analyzeLineage(input).blockedActions[0]?.reasonCode).toBe("POLICY_VERSION_CHANGED");
  });

  it("rejects a cross-tenant edge reached from the source graph", () => {
    const input = analysisInput();
    input.events = [...input.events, {
      id: "foreign-edge",
      organizationId: "org-b",
      sourcePositionId: "debt",
      derivedPositionId: "receipt",
      protocolId: "foreign",
      ownerWalletId: "wallet-a",
      transactionReference: "tx-foreign",
      policyVersion: "4.2",
      observedAt: input.asOf,
      evidenceState: "asserted",
    }];
    expect(() => analyzeLineage(input)).toThrow("Cross-tenant lineage event");
  });
});
