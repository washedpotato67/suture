/**
 * Integration test for the data layer against a local Supabase stack.
 * Runs only when RUN_SUPABASE_INTEGRATION=1 and the local stack is up
 * (`supabase start`). Exercises the exact queries and RPCs the console uses,
 * as an authenticated non-service user (RLS enforced).
 */
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import { isSupabaseConfigured, supabase } from "./supabase";
import {
  createOrganization,
  loadWorkspace,
  rpcDecideApproval,
  rpcExecutePlan,
  rpcRequestApproval,
} from "./data";

const RUN = process.env.RUN_SUPABASE_INTEGRATION === "1" && isSupabaseConfigured;

describe.skipIf(!RUN)("data layer against local Supabase", () => {
  let userId: string;
  let organizationId: string;

  beforeAll(async () => {
    const email = `integration-${Date.now()}@demo.local`;
    const { data, error } = await supabase!.auth.signUp({ email, password: "integration-pass-123" });
    if (error) throw error;
    userId = data.user!.id;
    organizationId = await createOrganization("Integration Org", `integration-org-${Date.now()}`);
  });

  it("loads the demo workspace from the database", async () => {
    const workspace = await loadWorkspace(userId);
    expect(workspace.mode).toBe("connected");
    expect(workspace.organizationName).toBe("Integration Org");
    expect(workspace.role).toBe("owner");
    expect(workspace.nodes).toHaveLength(4);
    expect(workspace.edges).toHaveLength(3);
    expect(workspace.integrations).toHaveLength(4);
    expect(workspace.incident?.status).toBe("open");
    expect(workspace.wallets.map((wallet) => wallet.credentialState).sort()).toEqual(["revoked", "valid"]);

    const plan = workspace.plans[0];
    expect(plan?.status).toBe("draft");
    expect(plan?.sourceWallet).toMatch(/^0x71A4/);
    expect(plan?.replacementWallet).toMatch(/^0xB0B01/);

    const kinds = workspace.nodes.map((node) => node.kind);
    expect(kinds).toContain("asset");
    expect(kinds).toContain("vault_receipt");
    expect(kinds).toContain("collateral");
    expect(kinds).toContain("debt");

    const policyVersions = new Set(workspace.nodes.map((node) => node.policyVersion));
    expect(policyVersions).toEqual(new Set(["NSPC-4.2"]));
  });

  it("walks the remediation workflow and stays idempotent", async () => {
    const before = await loadWorkspace(userId);
    const plan = before.plans[0]!;

    await rpcRequestApproval(plan.id);
    await rpcDecideApproval(plan.id, true, "integration test");
    const receipt1 = await rpcExecutePlan(plan.id);
    const receipt2 = await rpcExecutePlan(plan.id);
    expect(receipt2).toBe(receipt1);

    const after = await loadWorkspace(userId);
    expect(after.plans[0]?.status).toBe("resolved");
    expect(after.incident?.status).toBe("resolved");
    expect(after.receipts).toHaveLength(1);
    expect(after.receipts[0]?.receiptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(after.checks.find((check) => check.id === "exit")?.status).toBe("pass");
  });

  it("records a lineage event idempotently through the server RPC", async () => {
    const { data: edge, error: edgeError } = await supabase!
      .from("lineage_edges")
      .select("from_position_id, to_position_id, protocol_id, owner_wallet_id, policy_version_id")
      .eq("organization_id", organizationId)
      .limit(1)
      .single();
    if (edgeError) throw edgeError;
    const key = `integration:lineage:${Date.now()}`;
    const input = {
      _from_position_id: edge.from_position_id,
      _to_position_id: edge.to_position_id,
      _protocol_id: edge.protocol_id,
      _owner_wallet_id: edge.owner_wallet_id,
      _action: "deposit_observed",
      _policy_version_id: edge.policy_version_id,
      _transaction_reference: `integration-tx-${Date.now()}`,
      _evidence_reference: "integration fixture",
      _evidence: "asserted",
      _idempotency_key: key,
    };
    const { data: first, error: firstError } = await supabase!.rpc("record_lineage_event", input);
    if (firstError) throw firstError;
    const { data: replay, error: replayError } = await supabase!.rpc("record_lineage_event", input);
    if (replayError) throw replayError;
    expect(replay).toBe(first);

    const { error: untrustedEvidenceError } = await supabase!.rpc("record_lineage_event", {
      ...input,
      _evidence: "verified",
      _idempotency_key: `${key}:untrusted`,
    });
    expect(untrustedEvidenceError?.message).toContain("asserted");
  });

  it("rejects verified impact labels from an operating client", async () => {
    const { data: incident, error: incidentError } = await supabase!
      .from("incidents")
      .select("id")
      .eq("organization_id", organizationId)
      .limit(1)
      .single();
    if (incidentError) throw incidentError;
    const { error } = await supabase!.rpc("create_impact_snapshot", {
      _incident_id: incident.id,
      _calculation_version: "integration-v1",
      _lineage_digest: "a".repeat(64),
      _affected_position_count: 1,
      _affected_value_usd: 100,
      _evidence: "verified",
    });
    expect(error?.message).toContain("asserted");
  });

  it("rejects a remediation target wallet from another tenant", async () => {
    const otherOrganizationId = await createOrganization("Other Integration Org", `other-integration-${Date.now()}`);
    const [{ data: incident, error: incidentError }, { data: otherWallet, error: walletError }] = await Promise.all([
      supabase!.from("incidents").select("id").eq("organization_id", organizationId).limit(1).single(),
      supabase!.from("wallets").select("id").eq("organization_id", otherOrganizationId).limit(1).single(),
    ]);
    if (incidentError) throw incidentError;
    if (walletError) throw walletError;
    const { error } = await supabase!.rpc("create_remediation_plan", {
      _incident_id: incident.id,
      _replacement_wallet_id: otherWallet.id,
      _idempotency_key: `cross-tenant-${Date.now()}`,
    });
    expect(error?.message).toContain("replacement wallet organization mismatch");
  });

  it("does not expose another organization through RLS", async () => {
    const url = import.meta.env.VITE_SUPABASE_URL as string;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
    const otherClient = createClient(url, anonKey);
    const { error: signUpError } = await otherClient.auth.signUp({
      email: `tenant-isolation-${Date.now()}@demo.local`,
      password: "integration-pass-123",
    });
    if (signUpError) throw signUpError;

    const { data, error } = await otherClient
      .from("organizations")
      .select("id")
      .eq("id", organizationId);
    if (error) throw error;
    expect(data).toEqual([]);
  });
});
