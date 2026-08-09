import { describe, expect, it } from "vitest";
import {
  assertTransition,
  buildReceiptPayload,
  canTransition,
  executePlan,
  hashReceiptPayload,
} from "./remediation";
import type { AuditReceipt, Incident, RemediationPlan } from "./types";

const incident: Incident = {
  id: "incident-001",
  type: "credential_revocation",
  title: "Credential revoked after downstream composition",
  summary: "The source holder credential was revoked after composition.",
  sourceNodeId: "asset-note",
  createdAt: "2026-07-30T00:08:00.000Z",
  status: "open",
  severity: "critical",
};

const draftPlan: RemediationPlan = {
  id: "plan-001",
  incidentId: incident.id,
  planType: "wallet_migration",
  status: "draft",
  sourceWallet: "0x71A40000000000000000000000000000000091C2",
  replacementWallet: "0xB0B01000000000000000000000000000000B0B01",
  idempotencyKey: "demo:plan:incident-001",
  evidenceState: "asserted",
  createdAt: "2026-07-30T00:09:00.000Z",
};

describe("canTransition", () => {
  it("walks the happy path", () => {
    expect(canTransition("draft", "pending_approval")).toBe(true);
    expect(canTransition("pending_approval", "approved")).toBe(true);
    expect(canTransition("approved", "executing")).toBe(true);
    expect(canTransition("executing", "resolved")).toBe(true);
  });

  it("rejects skipped and backwards transitions", () => {
    expect(canTransition("draft", "approved")).toBe(false);
    expect(canTransition("draft", "executing")).toBe(false);
    expect(canTransition("pending_approval", "executing")).toBe(false);
    expect(canTransition("approved", "draft")).toBe(false);
  });

  it("treats resolved and cancelled as terminal", () => {
    expect(canTransition("resolved", "executing")).toBe(false);
    expect(canTransition("cancelled", "pending_approval")).toBe(false);
  });

  it("requires reconciliation before retrying an uncertain execution", () => {
    expect(canTransition("executing", "uncertain")).toBe(true);
    expect(canTransition("uncertain", "resolved")).toBe(false);
    expect(canTransition("uncertain", "executing")).toBe(true);
  });

  it("assertTransition throws on illegal transitions", () => {
    expect(() => assertTransition("draft", "resolved")).toThrow(/Illegal remediation transition/);
    expect(() => assertTransition("draft", "pending_approval")).not.toThrow();
  });
});

describe("executePlan", () => {
  const approvedPlan: RemediationPlan = {
    ...draftPlan,
    status: "approved",
    approvedAt: "2026-07-30T00:10:00.000Z",
  };

  it("executes an approved plan and issues one receipt", () => {
    const { plan, receipt } = executePlan(
      approvedPlan,
      incident,
      [],
      "2026-07-30T00:11:00.000Z",
      "deadbeef",
    );
    expect(plan.status).toBe("resolved");
    expect(plan.executedAt).toBe("2026-07-30T00:11:00.000Z");
    expect(receipt.planId).toBe(plan.id);
    expect(receipt.incidentId).toBe(incident.id);
    expect(receipt.receiptHash).toBe("deadbeef");
  });

  it("is idempotent: re-executing a resolved plan returns the existing receipt", () => {
    const first = executePlan(approvedPlan, incident, [], "2026-07-30T00:11:00.000Z", "deadbeef");
    const second = executePlan(
      first.plan,
      incident,
      [first.receipt],
      "2026-07-30T00:12:00.000Z",
      "different-hash",
    );
    expect(second.receipt.id).toBe(first.receipt.id);
    expect(second.receipt.receiptHash).toBe("deadbeef");
  });

  it("refuses to execute a plan that was never approved", () => {
    expect(() => executePlan(draftPlan, incident, [], "2026-07-30T00:11:00.000Z", "x")).toThrow(
      /Illegal remediation transition/,
    );
    const pending: RemediationPlan = { ...draftPlan, status: "pending_approval" };
    expect(() => executePlan(pending, incident, [], "2026-07-30T00:11:00.000Z", "x")).toThrow(
      /Illegal remediation transition/,
    );
  });

  it("throws when a resolved plan has no receipt on record", () => {
    const resolved: RemediationPlan = { ...approvedPlan, status: "resolved" };
    const receipts: AuditReceipt[] = [];
    expect(() => executePlan(resolved, incident, receipts, "2026-07-30T00:11:00.000Z", "x")).toThrow(
      /no receipt/,
    );
  });
});

describe("buildReceiptPayload", () => {
  it("captures the migration, both wallets, and timing", () => {
    const plan: RemediationPlan = {
      ...draftPlan,
      status: "resolved",
      approvedAt: "2026-07-30T00:10:00.000Z",
    };
    const payload = buildReceiptPayload(plan, incident, "2026-07-30T00:11:00.000Z");
    expect(payload).toMatchObject({
      receipt_version: 1,
      action: "wallet_migration",
      plan_id: "plan-001",
      incident_id: "incident-001",
      source_wallet: plan.sourceWallet,
      replacement_wallet: plan.replacementWallet,
      executed_at: "2026-07-30T00:11:00.000Z",
    });
  });

  it("hashes an identical receipt payload deterministically", async () => {
    const executedAt = "2026-07-30T00:11:00.000Z";
    const plan: RemediationPlan = { ...draftPlan, status: "resolved" };
    await expect(hashReceiptPayload(plan, incident, executedAt)).resolves.toMatch(/^[0-9a-f]{64}$/);
    await expect(hashReceiptPayload(plan, incident, executedAt)).resolves.toBe(
      await hashReceiptPayload(plan, incident, executedAt),
    );
  });
});
