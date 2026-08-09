import { supabase } from "./supabase";
import {
  checks as fixtureChecks,
  DEMO_ORGANIZATION,
  edges as fixtureEdges,
  incident as fixtureIncident,
  integrations as fixtureIntegrations,
  nodes as fixtureNodes,
} from "../domain/fixtures";
import type {
  AuditReceipt,
  ActivityEvent,
  ApprovalRecord,
  EvidenceState,
  Incident,
  IntegrationStatus,
  LineageEdge,
  LineageNode,
  NodeKind,
  PolicyCheckResult,
  PreflightResult,
  RemediationPlan,
  WorkspaceAsset,
} from "../domain/types";

export type OrgRole =
  | "owner"
  | "issuer_admin"
  | "compliance_operator"
  | "protocol_integrator"
  | "auditor";

export interface WorkspaceWallet {
  id: string;
  address: string;
  label: string;
  credentialState: LineageNode["credentialState"];
}

export interface WorkspaceData {
  mode: "demo" | "connected";
  organizationName: string;
  isDemo: boolean;
  role: OrgRole | null;
  nodes: LineageNode[];
  edges: LineageEdge[];
  incident: Incident | null;
  checks: PolicyCheckResult[];
  integrations: IntegrationStatus[];
  wallets: WorkspaceWallet[];
  plans: RemediationPlan[];
  receipts: AuditReceipt[];
  assets: WorkspaceAsset[];
  approvals: ApprovalRecord[];
  activity: ActivityEvent[];
  organizationId?: string;
}

export function shortWallet(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function demoWorkspace(): WorkspaceData {
  return {
    mode: "demo",
    organizationName: DEMO_ORGANIZATION,
    isDemo: true,
    role: null,
    nodes: fixtureNodes,
    edges: fixtureEdges,
    incident: fixtureIncident,
    checks: fixtureChecks,
    integrations: fixtureIntegrations,
    wallets: [
      {
        id: "demo-wallet-source",
        address: "0x71A40000000000000000000000000000000091C2",
        label: "Source holder",
        credentialState: "revoked",
      },
      {
        id: "demo-wallet-replacement",
        address: "0xB0B01000000000000000000000000000000B0B01",
        label: "Replacement wallet",
        credentialState: "valid",
      },
    ],
    plans: [
      {
        id: "demo-plan-001",
        incidentId: fixtureIncident.id,
        planType: "wallet_migration",
        status: "draft",
        sourceWallet: "0x71A40000000000000000000000000000000091C2",
        replacementWallet: "0xB0B01000000000000000000000000000000B0B01",
        idempotencyKey: "demo:plan:incident-001",
        evidenceState: "asserted",
        createdAt: "2026-07-30T00:09:00.000Z",
      },
    ],
    receipts: [],
    assets: [{ id: "demo-asset-nspc", label: "Northstar Private Credit Note 2028", assetReference: "demo:cva:nspc28", activePolicyVersion: "NSPC-4.2", activePolicyVersionId: "demo-policy-nspc-4-2", policyHash: "demo:policy-hash:nspc-4.2", evidenceState: "asserted", positionIds: fixtureNodes.map((node) => node.id), policyHistory: [{ version: "NSPC-4.2", policyHash: "demo:policy-hash:nspc-4.2", effectiveAt: "2026-07-01T00:00:00.000Z" }] }],
    approvals: [],
    activity: [{ id: "demo-credential-revoked", eventType: "credential_revoked", subjectType: "credential", occurredAt: "2026-07-30T00:08:00.000Z", evidenceState: "simulated", detail: "Deterministic fixture event. No provider webhook was received." }],
  };
}

const NODE_LAYOUT: Record<NodeKind, { x: number; y: number }> = {
  asset: { x: 90, y: 185 },
  vault_receipt: { x: 390, y: 185 },
  collateral: { x: 690, y: 105 },
  debt: { x: 690, y: 290 },
};

function nodeKind(positionType: string): NodeKind {
  switch (positionType) {
    case "vault_receipt":
      return "vault_receipt";
    case "collateral":
      return "collateral";
    case "debt":
    case "borrow":
      return "debt";
    default:
      return "asset";
  }
}

/** True when the user has an organization membership worth loading. */
export async function hasOrganization(userId: string): Promise<boolean> {
  if (!supabase) return false;
  const { data, error } = await supabase
    .from("organization_memberships")
    .select("organization_id")
    .eq("user_id", userId)
    .limit(1);
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

export async function createOrganization(name: string, slug: string): Promise<string> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("create_organization_with_demo_data", {
    _name: name,
    _slug: slug,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function loadWorkspace(userId: string): Promise<WorkspaceData> {
  if (!supabase) return demoWorkspace();

  const { data: membership, error: membershipError } = await supabase
    .from("organization_memberships")
    .select("organization_id, role")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (membershipError) throw new Error(membershipError.message);
  if (!membership) return demoWorkspace();

  const orgId = membership.organization_id as string;
  const role = membership.role as OrgRole;

  const [
    orgRes,
    walletsRes,
    credentialsRes,
    positionsRes,
    policyRes,
    edgesRes,
    incidentsRes,
    integrationsRes,
    plansRes,
    receiptsRes,
    assetsRes,
    manifestsRes,
    protocolsRes,
    approvalsRes,
    activityRes,
  ] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", orgId).single(),
    supabase.from("wallets").select("id, address, label").eq("organization_id", orgId),
    supabase
      .from("credentials")
      .select("wallet_id, state, observed_at")
      .eq("organization_id", orgId)
      .order("observed_at", { ascending: false }),
    supabase
      .from("positions")
      .select("id, position_type, label, amount_usd, state, evidence, wallet_id, policy_version_id, asset_id, protocol_id, created_at")
      .eq("organization_id", orgId),
    supabase.from("policy_versions").select("id, manifest_id, version, policy_hash, effective_at").eq("organization_id", orgId),
    supabase
      .from("lineage_edges")
      .select("id, from_position_id, to_position_id, action, evidence, policy_version_id, protocol_id, transaction_reference, observed_at")
      .eq("organization_id", orgId),
    supabase
      .from("incidents")
      .select("id, incident_type, title, summary, source_position_id, detected_at, status, severity, is_demo")
      .eq("organization_id", orgId)
      .order("detected_at", { ascending: false })
      .limit(1),
    supabase.from("integration_connections").select("provider, mode, diagnostic_state, endpoint_label, last_checked_at, last_error_code").eq("organization_id", orgId),
    supabase
      .from("remediation_plans")
      .select(
        "id, incident_id, plan_type, status, idempotency_key, evidence, created_at, approved_at, executed_at, source_wallet_id, replacement_wallet_id, is_demo",
      )
      .eq("organization_id", orgId),
    supabase
      .from("audit_receipts")
      .select("id, incident_id, plan_id, receipt_hash, payload, issued_at")
      .eq("organization_id", orgId)
      .order("issued_at", { ascending: false }),
    supabase.from("assets").select("id, name, asset_reference, evidence").eq("organization_id", orgId),
    supabase.from("policy_manifests").select("id, asset_id, active_policy_version_id").eq("organization_id", orgId),
    supabase.from("protocols").select("id, name").eq("organization_id", orgId),
    supabase.from("approval_records").select("id, plan_id, required_role, decision, decided_at, note").eq("organization_id", orgId).order("decided_at", { ascending: false }),
    supabase.from("audit_events").select("id, event_type, subject_type, payload, occurred_at").eq("organization_id", orgId).order("occurred_at", { ascending: false }).limit(12),
  ]);

  for (const res of [orgRes, walletsRes, credentialsRes, positionsRes, policyRes, edgesRes, incidentsRes, integrationsRes, plansRes, receiptsRes, assetsRes, manifestsRes, protocolsRes, approvalsRes, activityRes]) {
    if (res.error) throw new Error(res.error.message);
  }

  const credentialByWallet = new Map<string, WorkspaceWallet["credentialState"]>();
  for (const credential of credentialsRes.data ?? []) {
    const walletId = credential.wallet_id as string;
    if (!credentialByWallet.has(walletId)) {
      credentialByWallet.set(walletId, credential.state as WorkspaceWallet["credentialState"]);
    }
  }
  const wallets = (walletsRes.data ?? []).map((row) => ({
    id: row.id as string,
    address: row.address as string,
    label: (row.label as string | null) ?? "Wallet",
    credentialState: credentialByWallet.get(row.id as string) ?? "unknown",
  }));
  const walletById = new Map(wallets.map((wallet) => [wallet.id, wallet]));
  const policyVersionById = new Map(
    (policyRes.data ?? []).map((row) => [row.id as string, row.version as string]),
  );
  const protocolById = new Map((protocolsRes.data ?? []).map((row) => [row.id as string, row.name as string]));
  const assetById = new Map((assetsRes.data ?? []).map((row) => [row.id as string, row]));

  const nodes: LineageNode[] = (positionsRes.data ?? []).map((row) => {
    const kind = nodeKind(row.position_type as string);
    const wallet = walletById.get(row.wallet_id as string);
    return {
      id: row.id as string,
      kind,
      label: row.label as string,
      subtitle: (row.position_type as string).replaceAll("_", " "),
      amountUsd: Number(row.amount_usd),
      ownerWallet: shortWallet(wallet?.address ?? ""),
      policyVersion: policyVersionById.get(row.policy_version_id as string) ?? "unknown",
      credentialState: wallet?.credentialState ?? "unknown",
      evidenceState: row.evidence as EvidenceState,
      state: row.state as LineageNode["state"],
      ...(protocolById.has(row.protocol_id as string) ? { protocolName: protocolById.get(row.protocol_id as string)! } : {}),
      ...(assetById.get(row.asset_id as string)?.asset_reference ? { assetReference: assetById.get(row.asset_id as string)!.asset_reference as string } : {}),
      observedAt: row.created_at as string,
      ...NODE_LAYOUT[kind],
    };
  });

  const edges: LineageEdge[] = (edgesRes.data ?? []).map((row) => ({
    id: row.id as string,
    from: row.from_position_id as string,
    to: row.to_position_id as string,
    action: row.action as LineageEdge["action"],
    policyVersion: policyVersionById.get(row.policy_version_id as string) ?? "unknown",
    evidenceState: row.evidence as EvidenceState,
    ...(protocolById.has(row.protocol_id as string) ? { protocolName: protocolById.get(row.protocol_id as string)! } : {}),
    transactionReference: row.transaction_reference as string,
    observedAt: row.observed_at as string,
  }));

  const incidentRow = incidentsRes.data?.[0];
  const incident: Incident | null = incidentRow
    ? {
        id: incidentRow.id as string,
        type: incidentRow.incident_type as Incident["type"],
        title: incidentRow.title as string,
        summary: incidentRow.summary as string,
        sourceNodeId: (incidentRow.source_position_id as string | null) ?? "",
        createdAt: incidentRow.detected_at as string,
        status: incidentRow.status as Incident["status"],
        severity: incidentRow.severity as Incident["severity"],
      }
    : null;

  const integrations: IntegrationStatus[] = (integrationsRes.data ?? []).map((row) => ({
    name: row.provider as string,
    state: (row.diagnostic_state ?? (row.mode === "demo" ? "simulated" : row.mode === "connected" ? "connected" : "unavailable")) as IntegrationStatus["state"],
    detail: (row.endpoint_label as string | null) ?? "",
    ...(row.last_checked_at ? { checkedAt: row.last_checked_at as string } : {}),
    ...(row.last_error_code ? { errorCode: row.last_error_code as string } : {}),
  }));

  const plans: RemediationPlan[] = (plansRes.data ?? []).map((row) => ({
    id: row.id as string,
    incidentId: row.incident_id as string,
    planType: "wallet_migration",
    status: row.status as RemediationPlan["status"],
    sourceWallet: walletById.get(row.source_wallet_id as string)?.address ?? "",
    replacementWallet: walletById.get(row.replacement_wallet_id as string)?.address ?? "",
    idempotencyKey: row.idempotency_key as string,
    evidenceState: row.evidence as EvidenceState,
    createdAt: row.created_at as string,
    ...(row.approved_at ? { approvedAt: row.approved_at as string } : {}),
    ...(row.executed_at ? { executedAt: row.executed_at as string } : {}),
  }));

  const receipts: AuditReceipt[] = (receiptsRes.data ?? []).map((row) => ({
    id: row.id as string,
    incidentId: row.incident_id as string,
    planId: row.plan_id as string,
    receiptHash: row.receipt_hash as string,
    payload: row.payload as Record<string, unknown>,
    issuedAt: row.issued_at as string,
  }));
  const manifestByAsset = new Map((manifestsRes.data ?? []).map((row) => [row.asset_id as string, row]));
  const assets: WorkspaceAsset[] = (assetsRes.data ?? []).map((row) => {
    const manifest = manifestByAsset.get(row.id as string);
    const history = (policyRes.data ?? [])
      .filter((version) => version.manifest_id === manifest?.id)
      .map((version) => ({ version: version.version as string, policyHash: version.policy_hash as string, effectiveAt: version.effective_at as string }));
    const active = (policyRes.data ?? []).find((version) => version.id === manifest?.active_policy_version_id);
    return {
      id: row.id as string,
      label: row.name as string,
      assetReference: row.asset_reference as string,
      activePolicyVersion: (active?.version as string | undefined) ?? "unavailable",
      ...(manifest?.active_policy_version_id ? { activePolicyVersionId: manifest.active_policy_version_id as string } : {}),
      ...(active?.policy_hash ? { policyHash: active.policy_hash as string } : {}),
      evidenceState: row.evidence as EvidenceState,
      positionIds: nodes.filter((node) => node.assetReference === row.asset_reference).map((node) => node.id),
      policyHistory: history,
    };
  });
  const approvals: ApprovalRecord[] = (approvalsRes.data ?? []).map((row) => ({
    id: row.id as string,
    planId: row.plan_id as string,
    requiredRole: row.required_role as string,
    decision: row.decision as ApprovalRecord["decision"],
    decidedAt: row.decided_at as string,
    ...(row.note ? { note: row.note as string } : {}),
  }));
  const activity: ActivityEvent[] = (activityRes.data ?? []).map((row) => ({
    id: row.id as string,
    eventType: row.event_type as string,
    subjectType: row.subject_type as string,
    occurredAt: row.occurred_at as string,
    evidenceState: "asserted",
    detail: JSON.stringify(row.payload ?? {}),
  }));

  // Label from the recorded demo flags, not from the mere existence of a plan.
  const isDemo = Boolean(incidentRow?.is_demo)
    || (plansRes.data ?? []).some((row) => row.is_demo === true);

  return {
    mode: "connected",
    organizationName: (orgRes.data?.name as string | undefined) ?? "Organization",
    isDemo,
    role,
    nodes,
    edges,
    incident,
    checks: deriveChecks(wallets, nodes, plans),
    integrations,
    wallets,
    plans,
    receipts,
    assets,
    approvals,
    activity,
    organizationId: orgId,
  };
}

/** Preflight summary derived from stored state — never from a live provider call. */
function deriveChecks(
  wallets: WorkspaceWallet[],
  nodes: LineageNode[],
  plans: RemediationPlan[],
): PolicyCheckResult[] {
  const sourceWallet = wallets.find((wallet) => wallet.credentialState !== "valid") ?? wallets[0];
  const credentialOk = sourceWallet?.credentialState === "valid";
  const blockedCount = nodes.filter((node) => node.state === "blocked").length;
  const plan = plans[0];

  return [
    {
      id: "credential",
      label: "Holder credential",
      status: credentialOk ? "pass" : "fail",
      reasonCode: credentialOk ? "CREDENTIAL_VALID" : `CREDENTIAL_${(sourceWallet?.credentialState ?? "unknown").toUpperCase()}`,
      detail: credentialOk
        ? "The active wallet credential is valid."
        : `The active wallet credential is ${sourceWallet?.credentialState ?? "unknown"}.`,
      evidenceState: "asserted",
    },
    {
      id: "policy",
      label: "Policy continuity",
      status: blockedCount > 0 ? "fail" : "pass",
      reasonCode: blockedCount > 0 ? "DERIVED_POSITION_INELIGIBLE" : "POLICY_CONTINUITY_OK",
      detail:
        blockedCount > 0
          ? `New movement is blocked across ${blockedCount} derived positions.`
          : "No derived position is currently blocked.",
      evidenceState: "asserted",
    },
    {
      id: "exit",
      label: "Safe remediation path",
      status: plan?.status === "resolved" ? "pass" : "unknown",
      reasonCode: plan?.status === "resolved" ? "REMEDIATION_COMPLETE" : "APPROVAL_REQUIRED",
      detail:
        plan?.status === "resolved"
          ? "Replacement-wallet migration executed and receipted."
          : "Issuer approval is required before migration to a replacement wallet.",
      evidenceState: plan?.status === "resolved" ? "asserted" : "none",
    },
  ];
}

// --- Consequential actions (server-authoritative RPCs) ---

export async function rpcRequestApproval(planId: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.rpc("request_remediation_approval", { _plan_id: planId });
  if (error) throw new Error(error.message);
}

export async function rpcDecideApproval(planId: string, approve: boolean, note?: string): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { error } = await supabase.rpc("decide_remediation_approval", {
    _plan_id: planId,
    _approve: approve,
    _note: note ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function rpcExecutePlan(planId: string): Promise<string> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.rpc("execute_remediation_plan", { _plan_id: planId });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Reads the decision body from a non-2xx Edge Function response, if there is one. */
async function decisionFromErrorContext(error: unknown): Promise<Record<string, unknown> | null> {
  const context = (error as { context?: unknown }).context;
  if (!(context instanceof Response)) return null;
  try {
    const body = await context.clone().json();
    return body && typeof body === "object" ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export async function runServerPreflight(input: {
  organizationId: string;
  walletId: string;
  sourceAssetId: string;
  policyVersionId: string;
  action: string;
}): Promise<PreflightResult> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.functions.invoke("suture-orchestrator", {
    body: { operation: "preflight", ...input },
  });
  // A fail-closed BLOCK is returned with a 4xx/5xx status and a full decision
  // body. supabase-js surfaces that as an error whose context is the Response,
  // so the decision is read from there instead of being reported as a transport
  // failure.
  const raw = error
    ? await decisionFromErrorContext(error)
    : data && typeof data === "object"
      ? data as Record<string, unknown>
      : null;
  if (!raw) {
    if (error) throw new Error(`SUTURE orchestration request failed: ${error.message}`);
    throw new Error("SUTURE orchestration returned no result");
  }
  if (!raw.decision || !Array.isArray(raw.checks)) throw new Error(String(raw.error ?? "SUTURE orchestration returned an invalid result"));
  return {
    source: "server",
    decision: raw.decision as PreflightResult["decision"],
    action: String(raw.action ?? input.action),
    checks: (raw.checks as Array<Record<string, unknown>>).map((check) => ({
      id: String(check.id), label: String(check.label), status: check.status as PolicyCheckResult["status"],
      reasonCode: String(check.reasonCode), detail: String(check.detail),
      evidenceState: check.evidenceState as EvidenceState, checkedAt: String(raw.evaluatedAt ?? ""),
    })),
    reasonCodes: (raw.reasonCodes as string[] | undefined) ?? [],
    evaluatedAt: String(raw.evaluatedAt ?? new Date().toISOString()),
    evidenceState: (String(raw.evidenceState ?? "unavailable").toLowerCase() as EvidenceState),
    providerReferences: (raw.providerReferences as PreflightResult["providerReferences"] | undefined) ?? [],
    requiredRemediationPaths: (raw.requiredRemediationPaths as PreflightResult["requiredRemediationPaths"] | undefined) ?? [],
  };
}

export interface ChainExecutionResult {
  state: string;
  txHash?: string;
  blockNumber?: number;
  chainId?: number;
  detail?: string;
}

/**
 * Live on-chain remediation. Distinct from `rpcExecutePlan`, which records a
 * simulated execution: this submits a real transaction and returns its hash.
 * A non-2xx body still carries the executor's state, so an uncertain or
 * unconfigured outcome is reported rather than collapsed into a transport error.
 */
export async function runChainExecutor(
  planId: string,
  operation?: "reconcile",
): Promise<ChainExecutionResult> {
  if (!supabase) throw new Error("Supabase is not configured");
  const { data, error } = await supabase.functions.invoke("suture-executor", {
    body: { planId, ...(operation ? { operation } : {}) },
  });
  const raw = error
    ? await decisionFromErrorContext(error)
    : data && typeof data === "object"
      ? data as Record<string, unknown>
      : null;
  if (!raw) {
    if (error) throw new Error(`Chain execution request failed: ${error.message}`);
    throw new Error("Chain execution returned no result");
  }
  if (raw.error && !raw.state) throw new Error(String(raw.error));
  return {
    state: String(raw.state ?? "unknown"),
    ...(raw.txHash ? { txHash: String(raw.txHash) } : {}),
    ...(typeof raw.blockNumber === "number" ? { blockNumber: raw.blockNumber } : {}),
    ...(typeof raw.chainId === "number" ? { chainId: raw.chainId } : {}),
    ...(raw.detail ? { detail: String(raw.detail) } : {}),
  };
}
