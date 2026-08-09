import type {
  AuditReceipt,
  Incident,
  RemediationPlan,
  RemediationStatus,
} from "./types";

/**
 * Legal remediation plan transitions. Mirrors the server-side RPCs in
 * supabase/migrations/20260730020000_suture_remediation_workflow.sql —
 * the database remains authoritative; this table drives UI affordances
 * and the fixture-mode workflow.
 */
const TRANSITIONS: Record<RemediationStatus, RemediationStatus[]> = {
  draft: ["pending_approval", "cancelled"],
  pending_approval: ["approved", "cancelled"],
  approved: ["executing"],
  executing: ["resolved", "uncertain"],
  uncertain: ["executing"],
  resolved: [],
  cancelled: [],
};

export function canTransition(from: RemediationStatus, to: RemediationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: RemediationStatus, to: RemediationStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal remediation transition: ${from} -> ${to}`);
  }
}

export function buildReceiptPayload(
  plan: RemediationPlan,
  incident: Incident,
  executedAt: string,
): Record<string, unknown> {
  return {
    receipt_version: 1,
    action: plan.planType,
    plan_id: plan.id,
    incident_id: incident.id,
    source_wallet: plan.sourceWallet,
    replacement_wallet: plan.replacementWallet,
    approved_at: plan.approvedAt ?? null,
    executed_at: executedAt,
    demo: true,
    execution_mode: "simulated",
    evidence_state: "asserted",
  };
}

/**
 * Fixture receipts use the browser Web Crypto implementation to calculate the
 * SHA-256 digest displayed in the console. This keeps the labeled simulation
 * deterministic for a given receipt payload instead of presenting randomness
 * as an audit hash.
 */
export async function hashReceiptPayload(
  plan: RemediationPlan,
  incident: Incident,
  executedAt: string,
): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto is unavailable; cannot issue a demo receipt hash");
  }
  const payload = JSON.stringify(buildReceiptPayload(plan, incident, executedAt));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Fixture-mode execution: idempotent — executing an already-resolved plan
 * returns its existing receipt instead of issuing a second one.
 */
export function executePlan(
  plan: RemediationPlan,
  incident: Incident,
  existingReceipts: readonly AuditReceipt[],
  executedAt: string,
  hash: string,
): { plan: RemediationPlan; receipt: AuditReceipt } {
  if (plan.status === "resolved") {
    const existing = existingReceipts.find((receipt) => receipt.planId === plan.id);
    if (!existing) {
      throw new Error(`Plan ${plan.id} is resolved but has no receipt`);
    }
    return { plan, receipt: existing };
  }

  assertTransition(plan.status, "executing");

  const resolvedPlan: RemediationPlan = {
    ...plan,
    status: "resolved",
    executedAt,
  };
  const receipt: AuditReceipt = {
    id: `receipt-${plan.id}`,
    incidentId: incident.id,
    planId: plan.id,
    receiptHash: hash,
    payload: buildReceiptPayload(resolvedPlan, incident, executedAt),
    issuedAt: executedAt,
  };
  return { plan: resolvedPlan, receipt };
}
