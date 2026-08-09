import { createClient } from "npm:@supabase/supabase-js@2";
import {
  CleanverseClient,
  CleanverseProviderError,
  cleanverseConfigFromEnvironment,
  type CleanverseScope,
  type CredentialStatus,
  type EvidenceState as CleanverseEvidenceState,
} from "../_shared/cleanverse.ts";
import { analyzeServerLineage } from "../_shared/lineage-engine.ts";

// Supabase does not add CORS headers to Edge Function responses. Without an
// explicit allow-origin the browser blocks every preflight call from the console.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

type RequestBody = {
  operation?: "preflight" | "analyze_lineage" | "chain_status";
  organizationId?: string;
  walletId?: string;
  sourceAssetId?: string;
  policyVersionId?: string;
  action?: string;
};

type Check = {
  id: string;
  label: string;
  status: "pass" | "fail" | "unknown";
  reasonCode: string;
  detail: string;
  evidenceState: "none" | "asserted" | "verified" | "contested";
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function storedCredentialState(state: CredentialStatus): "valid" | "expired" | "revoked" | "suspended" | "unknown" {
  return state.toLowerCase() as "valid" | "expired" | "revoked" | "suspended" | "unknown";
}

function asScope(row: Record<string, unknown> | null): CleanverseScope | null {
  if (!row || (row.scope_kind !== "atoken" && row.scope_kind !== "validator_pool")) return null;
  if (typeof row.chain !== "string" || typeof row.scope_address !== "string") return null;
  return { kind: row.scope_kind, chain: row.chain, address: row.scope_address };
}

function isRiskAction(action: string): boolean {
  return !["restricted_exit", "remediation_exit", "remediation_recovery"].includes(action);
}

function isSupportedProviderAction(action: string): boolean {
  return action === "transfer";
}

/**
 * A blocked evaluation still returns a decision record. The console renders
 * `checks`, so every fail-closed body carries the control that blocked it.
 */
function blockingCheck(id: string, label: string, reasonCode: string, detail: string, evidenceState: Check["evidenceState"]): Check[] {
  return [{ id, label, status: "fail", reasonCode, detail, evidenceState }];
}

function remediationFor(action: string, decision: "PASS" | "BLOCK" | "REVIEW") {
  if (decision === "PASS") return [];
  return [{ action: isRiskAction(action) ? "restricted_exit" : "manual_review", reasonCode: decision === "BLOCK" ? "COMPLIANCE_PREFLIGHT_BLOCKED" : "COMPLIANCE_PREFLIGHT_REVIEW" }];
}

async function persistProviderDecision(
  service: ReturnType<typeof createClient>,
  input: {
    organizationId: string;
    walletId: string;
    assetId: string;
    policyVersionId: string;
    action: string;
    decision: "PASS" | "BLOCK" | "REVIEW";
    credentialStatus: CredentialStatus;
    assetStatus: CleanverseEvidenceState;
    evidenceState: CleanverseEvidenceState;
    requestId: string;
    providerCode?: string;
    responseDigest?: string;
    policyVersionLabel: string;
    policyHash: string;
    scope?: CleanverseScope;
    reasonCodes: string[];
    rawPayload: Record<string, unknown>;
    providerCredential?: { status: CredentialStatus; reference?: string; expiresAt?: string; observedAt: string };
  },
) {
  if (input.providerCredential) {
    const credentialInsert = await service.from("credentials").insert({
      organization_id: input.organizationId,
      wallet_id: input.walletId,
      provider: "cleanverse_apass_v5_6",
      provider_reference: input.providerCredential.reference ?? null,
      state: storedCredentialState(input.providerCredential.status),
      valid_until: input.providerCredential.expiresAt ?? null,
      observed_at: input.providerCredential.observedAt,
      evidence: "verified",
      is_demo: false,
    });
    if (credentialInsert.error) throw new Error(`credential observation persistence failed: ${credentialInsert.error.message}`);
  }
  const decisionInsert = await service.from("cleanverse_decisions").insert({
    organization_id: input.organizationId,
    wallet_id: input.walletId,
    asset_id: input.assetId,
    policy_version_id: input.policyVersionId,
    action: input.action,
    decision: input.decision,
    credential_status: input.credentialStatus,
    asset_status: input.assetStatus,
    evidence_state: input.evidenceState,
    provider_request_id: input.requestId,
    provider_code: input.providerCode ?? null,
    response_digest: input.responseDigest ?? null,
    policy_version_label: input.policyVersionLabel,
    policy_hash: input.policyHash,
    scope_kind: input.scope?.kind ?? null,
    scope_chain: input.scope?.chain ?? null,
    reason_codes: input.reasonCodes,
    raw_payload: input.rawPayload,
  });
  if (decisionInsert.error) throw new Error(`Cleanverse decision persistence failed: ${decisionInsert.error.message}`);
}

/**
 * Capability-scoped diagnostics.
 *
 * CVI, CVA and CCP are capability names, not Cleanverse V5.6 module names. Each
 * row therefore records the documented endpoint it maps to, so the console shows
 * the capability surface without implying an API that does not exist.
 */
const CAPABILITY_PROVIDERS = {
  CVI: { provider: "Cleanverse A-Pass \u00b7 CVI", kind: "identity", api: "POST /query_apass" },
  CVA: { provider: "Cleanverse A-Token \u00b7 CVA", kind: "asset_scope", api: "POST /verify_apass, POST /atoken/rules" },
  CCP: { provider: "Cleanverse Validator \u00b7 CCP", kind: "policy_scope", api: "POST /validator/verify" },
} as const;

async function upsertCapability(
  service: ReturnType<typeof createClient>,
  organizationId: string,
  capability: keyof typeof CAPABILITY_PROVIDERS,
  state: "connected" | "unavailable" | "misconfigured",
  detail: string,
  extra: Record<string, unknown> = {},
) {
  const meta = CAPABILITY_PROVIDERS[capability];
  const result = await service.from("integration_connections").upsert({
    organization_id: organizationId,
    provider: meta.provider,
    kind: meta.kind,
    mode: state === "connected" ? "connected" : "degraded",
    status: state,
    diagnostic_state: state,
    endpoint_label: detail,
    last_checked_at: new Date().toISOString(),
    config: { capability, documented_api: meta.api, providerApi: "Cleanverse Cooperate V5.6", ...extra },
  }, { onConflict: "organization_id,provider" });
  if (result.error) throw new Error(`capability diagnostic persistence failed: ${result.error.message}`);
}

/** Marks every Cleanverse capability with the same state, for whole-boundary faults. */
async function upsertCleanverseDiagnostic(
  service: ReturnType<typeof createClient>,
  organizationId: string,
  state: "connected" | "unavailable" | "misconfigured",
  detail: string,
  errorCode?: string,
) {
  for (const capability of ["CVI", "CVA", "CCP"] as const) {
    await upsertCapability(service, organizationId, capability, state, detail, errorCode ? { lastErrorCode: errorCode } : {});
  }
}

async function preflight(
  supabase: ReturnType<typeof createClient>,
  service: ReturnType<typeof createClient> | null,
  body: Required<Pick<RequestBody, "organizationId" | "walletId" | "sourceAssetId" | "policyVersionId" | "action">>,
) {
  const [{ data: wallet, error: walletError }, { data: asset, error: assetError }, { data: manifest, error: manifestError }, { data: policyVersion, error: policyError }, { data: localCredential, error: credentialError }] = await Promise.all([
    supabase.from("wallets").select("id, address").eq("id", body.walletId).eq("organization_id", body.organizationId).single(),
    supabase.from("assets").select("id, asset_reference, evidence").eq("id", body.sourceAssetId).eq("organization_id", body.organizationId).single(),
    supabase.from("policy_manifests").select("active_policy_version_id, emergency_status").eq("organization_id", body.organizationId).eq("asset_id", body.sourceAssetId).maybeSingle(),
    supabase.from("policy_versions").select("id, version, policy_hash, effective_at, rules").eq("id", body.policyVersionId).eq("organization_id", body.organizationId).maybeSingle(),
    supabase.from("credentials").select("state, observed_at").eq("organization_id", body.organizationId).eq("wallet_id", body.walletId).order("observed_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  for (const result of [walletError, assetError, manifestError, policyError, credentialError]) if (result) throw new Error(result.message);
  if (!wallet || !asset) return { status: 404, body: { error: "wallet or asset not found" } };
  if (!manifest || !policyVersion || manifest.active_policy_version_id !== body.policyVersionId) return { status: 409, body: { error: "policy version is not active for source asset" } };
  const localPolicyBlocked = new Date(policyVersion.effective_at as string) > new Date()
    || manifest.emergency_status === "paused"
    || (manifest.emergency_status === "exit_only" && isRiskAction(body.action))
    || !isSupportedProviderAction(body.action)
    || asset.evidence !== "verified";
  const localCredentialBlocked = Boolean(localCredential && localCredential.state !== "valid");
  if (localPolicyBlocked || localCredentialBlocked) {
    const reasonCode = localCredentialBlocked
      ? `LOCAL_CREDENTIAL_${String(localCredential?.state).toUpperCase()}`
      : asset.evidence !== "verified" ? "SOURCE_ASSET_NOT_VERIFIED"
      : !isSupportedProviderAction(body.action) ? "CLEANVERSE_ACTION_UNSUPPORTED"
      : manifest.emergency_status === "paused" ? "POLICY_PAUSED"
      : manifest.emergency_status === "exit_only" ? "POLICY_EXIT_ONLY"
      : "POLICY_NOT_EFFECTIVE";
    const detail = "Local policy or evidence control blocks this action before provider evaluation.";
    return { status: 409, body: { decision: "BLOCK", action: body.action, checks: blockingCheck("local_policy_control", "Local policy and evidence control", reasonCode, detail, "asserted"), reasonCodes: [reasonCode], detail, evidenceState: "ASSERTED", evaluatedAt: new Date().toISOString(), requiredRemediationPaths: remediationFor(body.action, "BLOCK") } };
  }
  if (!service) {
    return {
      status: 503,
      body: {
        decision: "BLOCK",
        action: body.action,
        checks: blockingCheck(
          "server_persistence",
          "Server persistence role",
          "SERVER_PERSISTENCE_UNAVAILABLE",
          "The server-side persistence role is unavailable. No provider request was sent.",
          "none",
        ),
        reasonCodes: ["SERVER_PERSISTENCE_UNAVAILABLE"],
        detail: "The server-side persistence role is unavailable. No provider request was sent.",
        evidenceState: "UNAVAILABLE",
        evaluatedAt: new Date().toISOString(),
        requiredRemediationPaths: remediationFor(body.action, "BLOCK"),
      },
    };
  }

  const config = cleanverseConfigFromEnvironment((key) => Deno.env.get(key));
  if (!config) {
    await upsertCleanverseDiagnostic(service, body.organizationId, "misconfigured", "Required Cleanverse server secrets are missing.");
    return {
      status: 503,
      body: {
        decision: "BLOCK",
        action: body.action,
        wallet: { id: wallet.id, address: wallet.address },
        asset: { id: asset.id, reference: asset.asset_reference, status: "UNAVAILABLE" },
        credential: { status: "UNKNOWN", evidenceState: "UNAVAILABLE" },
        policy: { versionId: body.policyVersionId, version: policyVersion.version, hash: policyVersion.policy_hash, active: true, emergencyStatus: manifest.emergency_status },
        checks: [{ id: "provider_configuration", label: "Cleanverse server configuration", status: "fail", reasonCode: "CLEANVERSE_MISCONFIGURED", detail: "Required server secrets are missing.", evidenceState: "none" }],
        reasonCodes: ["CLEANVERSE_MISCONFIGURED"],
        evidenceState: "UNAVAILABLE",
        evaluatedAt: new Date().toISOString(),
        requiredRemediationPaths: remediationFor(body.action, "BLOCK"),
      },
    };
  }

  const scopeResult = await service.from("cleanverse_asset_scopes")
    .select("scope_kind, chain, scope_address")
    .eq("organization_id", body.organizationId)
    .eq("asset_id", body.sourceAssetId)
    .maybeSingle();
  if (scopeResult.error) throw new Error(scopeResult.error.message);
  const scope = asScope(scopeResult.data as Record<string, unknown> | null);
  const client = new CleanverseClient(config);
  const credentialRequestId = crypto.randomUUID();

  try {
    const providerCredential = await client.getCredentialStatus({ chain: scope?.chain ?? "monad", wallet: wallet.address as string, requestId: credentialRequestId });
    const recordedRevocation = localCredential?.state === "revoked";
    const credentialStatus: CredentialStatus = recordedRevocation ? "REVOKED" : providerCredential.status;
    const checks: Check[] = providerCredential.checks.map((check) => ({
      id: check.id,
      label: check.id === "cleanverse_apass_status" ? "Cleanverse A-Pass status" : "Cleanverse A-Pass expiry",
      status: check.status === "PASS" ? "pass" : check.status === "FAIL" ? "fail" : "unknown",
      reasonCode: check.reasonCode,
      detail: check.detail,
      evidenceState: "verified",
    }));
    if (recordedRevocation) checks.push({
      id: "recorded_revocation",
      label: "Issuer credential observation",
      status: "fail",
      reasonCode: "SUTURE_CREDENTIAL_REVOKED",
      detail: "A prior issuer credential observation is revoked. Cleanverse A-Pass reads do not document a revocation field.",
      evidenceState: "asserted",
    });

    let actionEvaluation = null;
    if (scope) {
      actionEvaluation = await client.evaluateAction({ scope, wallet: wallet.address as string, requestId: crypto.randomUUID() });
      checks.push({
        id: "cleanverse_action_scope",
        label: scope.kind === "atoken" ? "Cleanverse A-Token transfer eligibility" : "Cleanverse validator pool eligibility",
        status: actionEvaluation.decision === "PASS" ? "pass" : actionEvaluation.decision === "BLOCK" ? "fail" : "unknown",
        reasonCode: actionEvaluation.reasonCode,
        detail: actionEvaluation.reason,
        evidenceState: "verified",
      });
    } else {
      checks.push({
        id: "cleanverse_action_scope",
        label: "Cleanverse action scope",
        status: "unknown",
        reasonCode: "CLEANVERSE_SCOPE_UNCONFIGURED",
        detail: "No documented A-Token or validator-pool scope is configured for this source asset.",
        evidenceState: "none",
      });
    }
    checks.push({
      id: "source_asset_verification",
      label: "Source asset verification",
      status: "unknown",
      reasonCode: "CLEANVERSE_GENERIC_ASSET_VERIFICATION_UNAVAILABLE",
      detail: "Cleanverse V5.6 documents no generic source asset verification endpoint.",
      evidenceState: "none",
    });

    const hasFailure = credentialStatus !== "VALID" || actionEvaluation?.decision === "BLOCK";
    const hasUnknown = !scope || actionEvaluation?.decision === "REVIEW" || asset.evidence !== "verified";
    const decision = hasFailure ? "BLOCK" as const : hasUnknown ? "BLOCK" as const : "PASS" as const;
    const reasonCodes = checks.filter((check) => check.status !== "pass").map((check) => check.reasonCode);
    const rawPayload = {
      credential: providerCredential.raw,
      ...(actionEvaluation ? { action: actionEvaluation.raw } : {}),
    };
    await persistProviderDecision(service, {
      organizationId: body.organizationId,
      walletId: body.walletId,
      assetId: body.sourceAssetId,
      policyVersionId: body.policyVersionId,
      action: body.action,
      decision,
      credentialStatus,
      assetStatus: "UNAVAILABLE",
      evidenceState: actionEvaluation ? "VERIFIED" : "UNAVAILABLE",
      requestId: actionEvaluation?.request.requestId ?? providerCredential.request.requestId,
      providerCode: actionEvaluation?.request.providerCode ?? providerCredential.request.providerCode,
      responseDigest: actionEvaluation?.request.responseDigest ?? providerCredential.request.responseDigest,
      policyVersionLabel: policyVersion.version as string,
      policyHash: policyVersion.policy_hash as string,
      ...(scope ? { scope } : {}),
      reasonCodes,
      rawPayload,
      providerCredential: {
        status: providerCredential.status,
        ...(providerCredential.providerReference ? { reference: providerCredential.providerReference } : {}),
        ...(providerCredential.expiresAt ? { expiresAt: providerCredential.expiresAt } : {}),
        observedAt: providerCredential.observedAt,
      },
    });
    await upsertCapability(
      service, body.organizationId, "CVI", "connected",
      `A-Pass ${credentialStatus} observed via query_apass.`,
      { credentialStatus, providerReference: providerCredential.providerReference ?? null, evidence: "verified" },
    );
    if (scope && actionEvaluation) {
      const capability = scope.kind === "atoken" ? "CVA" : "CCP";
      await upsertCapability(
        service, body.organizationId, capability, "connected",
        `${actionEvaluation.decision} \u00b7 ${actionEvaluation.reasonCode} on chain ${scope.chain}.`,
        { decision: actionEvaluation.decision, reasonCode: actionEvaluation.reasonCode, scopeAddress: scope.address, evidence: "verified" },
      );
    } else {
      await upsertCapability(
        service, body.organizationId, "CVA", "unavailable",
        "No documented A-Token or validator scope is configured for this asset.",
      );
    }
    return {
      status: 200,
      body: {
        decision,
        action: body.action,
        wallet: { id: wallet.id, address: wallet.address },
        asset: { id: asset.id, reference: asset.asset_reference, status: "UNAVAILABLE" },
        credential: { status: credentialStatus, evidenceState: providerCredential.evidenceState, observedAt: providerCredential.observedAt, providerReference: providerCredential.providerReference ?? null },
        policy: { versionId: body.policyVersionId, version: policyVersion.version, hash: policyVersion.policy_hash, active: true, emergencyStatus: manifest.emergency_status, scope: scope ? { kind: scope.kind, chain: scope.chain } : null },
        checks,
        reasonCodes,
        evidenceState: actionEvaluation ? "VERIFIED" : "UNAVAILABLE",
        providerReferences: [providerCredential.request, ...(actionEvaluation ? [actionEvaluation.request] : [])],
        evaluatedAt: new Date().toISOString(),
        requiredRemediationPaths: remediationFor(body.action, decision),
      },
    };
  } catch (cause) {
    const error = cause instanceof CleanverseProviderError ? cause : null;
    const requestId = error?.requestId ?? credentialRequestId;
    const reasonCode = error?.providerCode === "12027" ? "CLEANVERSE_VALIDATOR_UNAVAILABLE" : "CLEANVERSE_PROVIDER_UNAVAILABLE";
    // Preserve the underlying failure. Without this the stored record cannot
    // distinguish a provider rejection from a transport or persistence fault.
    const failure = {
      message: cause instanceof Error ? cause.message : String(cause),
      name: cause instanceof Error ? cause.name : "unknown",
      ...(error?.httpStatus ? { httpStatus: error.httpStatus } : {}),
      ...(error ? {} : { origin: "non_provider_error" }),
    };
    console.error("preflight failed", failure);
    await persistProviderDecision(service, {
      organizationId: body.organizationId,
      walletId: body.walletId,
      assetId: body.sourceAssetId,
      policyVersionId: body.policyVersionId,
      action: body.action,
      decision: "BLOCK",
      credentialStatus: "UNKNOWN",
      assetStatus: "UNAVAILABLE",
      evidenceState: "UNAVAILABLE",
      requestId,
      providerCode: error?.providerCode,
      policyVersionLabel: policyVersion.version as string,
      policyHash: policyVersion.policy_hash as string,
      reasonCodes: [reasonCode],
      rawPayload: {
        failure,
        ...(error?.payload && typeof error.payload === "object" ? { provider: error.payload as Record<string, unknown> } : {}),
      },
    });
    await upsertCleanverseDiagnostic(service, body.organizationId, "unavailable", "Cleanverse provider evaluation failed. Risk actions are blocked.", error?.providerCode);
    return {
      status: 503,
      body: {
        decision: "BLOCK",
        action: body.action,
        checks: blockingCheck(
          "provider_evaluation",
          "Cleanverse provider evaluation",
          reasonCode,
          "Cleanverse evaluation is unavailable. Risk actions fail closed.",
          "none",
        ),
        reasonCodes: [reasonCode],
        detail: "Cleanverse evaluation is unavailable. Risk actions fail closed.",
        evidenceState: "UNAVAILABLE",
        evaluatedAt: new Date().toISOString(),
        requiredRemediationPaths: remediationFor(body.action, "BLOCK"),
      },
    };
  }
}


/**
 * Reads chain state directly over JSON-RPC. No indexer is involved, so the
 * block number recorded is an observation checkpoint, not a synced cursor.
 */
async function readChain(rpcUrl: string, expectedChainId: number, registry: string, asset: string) {
  const call = async (method: string, params: unknown[]) => {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!response.ok) throw new Error(`RPC ${method} failed with HTTP ${response.status}`);
    const payload = await response.json();
    if (payload.error) throw new Error(`RPC ${method}: ${payload.error.message ?? "error"}`);
    return payload.result as string;
  };

  const reportedChainId = Number(await call("eth_chainId", []));
  if (reportedChainId !== expectedChainId) {
    throw new Error(`chain id mismatch: expected ${expectedChainId}, RPC reported ${reportedChainId}`);
  }
  const blockNumber = Number(await call("eth_blockNumber", []));

  // activePolicy(address) -> (bytes32,bytes32,uint64,uint64,uint8,bool)
  // cast sig "activePolicy(address)"
  const selector = "0x237a06fb";
  const encoded = `${selector}${asset.replace(/^0x/, "").toLowerCase().padStart(64, "0")}`;
  const raw = await call("eth_call", [{ to: registry, data: encoded }, "latest"]);
  const words = (raw.replace(/^0x/, "").match(/.{1,64}/g) ?? []);
  if (words.length < 6) throw new Error("activePolicy returned an unexpected shape");
  return {
    chainId: reportedChainId,
    blockNumber,
    registry,
    asset,
    policyHash: `0x${words[0]}`,
    policyVersion: Number.parseInt(words[2] ?? "0", 16),
    effectiveAt: Number.parseInt(words[3] ?? "0", 16),
    active: Number.parseInt(words[5] ?? "0", 16) === 1,
    observedAt: new Date().toISOString(),
  };
}

async function upsertChainDiagnostic(
  service: ReturnType<typeof createClient>,
  organizationId: string,
  state: "connected" | "unavailable",
  detail: string,
  checkpoint: number | null,
) {
  await service.from("integration_connections").upsert({
    organization_id: organizationId,
    provider: "Monad testnet",
    kind: "chain",
    mode: state === "connected" ? "connected" : "degraded",
    status: state,
    diagnostic_state: state,
    endpoint_label: detail,
    last_checked_at: new Date().toISOString(),
    config: { checkpoint_block: checkpoint, source: "direct_rpc_read", indexer: null },
  }, { onConflict: "organization_id,provider" });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization) return json({ error: "authentication required" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey) return json({ error: "server configuration incomplete" }, 500);

  const supabase = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const service = serviceRoleKey ? createClient(url, serviceRoleKey) : null;
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return json({ error: "authentication required" }, 401);
  let body: RequestBody;
  try {
    body = await request.json() as RequestBody;
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  if (!body.organizationId || !body.walletId) return json({ error: "organization and wallet are required" }, 400);

  const { data: membership, error: membershipError } = await supabase
    .from("organization_memberships")
    .select("organization_id, role")
    .eq("organization_id", body.organizationId)
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (membershipError || !membership) return json({ error: "organization access denied" }, 403);

  if (body.operation === "chain_status") {
    if (!service) return json({ state: "unavailable", detail: "Server persistence role unavailable." }, 503);
    const rpcUrl = Deno.env.get("MONAD_RPC_URL");
    const chainId = Number(Deno.env.get("MONAD_CHAIN_ID") ?? "");
    const registry = Deno.env.get("MONAD_POLICY_REGISTRY");
    const asset = Deno.env.get("MONAD_ASSET_ADDRESS");
    if (!rpcUrl || !Number.isFinite(chainId) || chainId <= 0 || !registry || !asset) {
      await upsertChainDiagnostic(service, body.organizationId, "unavailable", "No verified chain configuration is present.", null);
      return json({ state: "unavailable", detail: "Chain configuration is absent. No RPC request was made." }, 503);
    }
    try {
      const observed = await readChain(rpcUrl, chainId, registry, asset);
      await upsertChainDiagnostic(
        service,
        body.organizationId,
        "connected",
        `chain ${chainId} · block ${observed.blockNumber} · policy v${observed.policyVersion}`,
        observed.blockNumber,
      );
      return json({ state: "connected", ...observed });
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message.slice(0, 200) : "Chain read failed.";
      await upsertChainDiagnostic(service, body.organizationId, "unavailable", detail, null);
      return json({ state: "unavailable", detail }, 503);
    }
  }

  if (body.operation === "preflight") {
    if (!["owner", "issuer_admin", "compliance_operator", "protocol_integrator"].includes(membership.role as string)) {
      return json({ error: "insufficient role to run preflight" }, 403);
    }
    if (!body.action || !body.sourceAssetId || !body.policyVersionId) {
      return json({ error: "action, source asset, and policy version are required" }, 400);
    }
    try {
      const result = await preflight(supabase, service, {
        organizationId: body.organizationId,
        walletId: body.walletId,
        sourceAssetId: body.sourceAssetId,
        policyVersionId: body.policyVersionId,
        action: body.action,
      });
      return json(result.body, result.status);
    } catch (cause) {
      return json({ error: cause instanceof Error ? cause.message : "preflight failed" }, 500);
    }
  }

  if (body.operation !== "analyze_lineage" || !body.sourceAssetId || !body.policyVersionId) {
    return json({ error: "invalid orchestration request" }, 400);
  }

  const { data: wallet, error: walletError } = await supabase
    .from("wallets")
    .select("id")
    .eq("id", body.walletId)
    .eq("organization_id", body.organizationId)
    .single();
  if (walletError || !wallet) return json({ error: "wallet not found" }, 404);
  const { data: credential, error: credentialError } = await supabase
    .from("credentials")
    .select("state, valid_from, valid_until, evidence")
    .eq("organization_id", body.organizationId)
    .eq("wallet_id", body.walletId)
    .order("observed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (credentialError) return json({ error: credentialError.message }, 500);
  if (!credential) return json({ error: "credential observation not found" }, 404);

  const [positionsRes, edgesRes, versionsRes, manifestRes] = await Promise.all([
    supabase.from("positions").select("id, organization_id, asset_id, wallet_id, protocol_id, position_type, policy_version_id, amount_usd, evidence").eq("organization_id", body.organizationId),
    supabase.from("lineage_edges").select("id, organization_id, from_position_id, to_position_id, protocol_id, policy_version_id, evidence").eq("organization_id", body.organizationId),
    supabase.from("policy_versions").select("id, manifest_id, version, effective_at, rules").eq("organization_id", body.organizationId),
    supabase.from("policy_manifests").select("asset_id, active_policy_version_id, emergency_status").eq("organization_id", body.organizationId).eq("asset_id", body.sourceAssetId).maybeSingle(),
  ]);
  for (const result of [positionsRes, edgesRes, versionsRes, manifestRes]) if (result.error) return json({ error: result.error.message }, 500);
  if (!manifestRes.data || manifestRes.data.active_policy_version_id !== body.policyVersionId) return json({ error: "policy version is not active for source asset" }, 409);
  const policyById = new Map((versionsRes.data ?? []).map((version) => [version.id as string, version]));
  const activePolicy = policyById.get(body.policyVersionId);
  if (!activePolicy) return json({ error: "policy version not found" }, 404);

  const rules = activePolicy.rules && typeof activePolicy.rules === "object" && !Array.isArray(activePolicy.rules)
    ? activePolicy.rules as Record<string, unknown>
    : {};
  try {
    const analysis = analyzeServerLineage({
      organizationId: body.organizationId,
      walletId: body.walletId,
      sourceAssetId: body.sourceAssetId,
      credential: { state: credential.state as string, validFrom: credential.valid_from as string | null, validUntil: credential.valid_until as string | null, evidenceState: credential.evidence as "none" | "asserted" | "verified" | "contested" },
      policy: {
        version: activePolicy.version as string,
        effectiveAt: activePolicy.effective_at as string,
        active: true,
        emergencyStatus: manifestRes.data.emergency_status as string,
        safeRestrictedExit: rules.safe_restricted_exit === true,
      },
      positions: (positionsRes.data ?? []).map((position) => ({
        id: position.id as string, organizationId: position.organization_id as string, assetId: position.asset_id as string, walletId: position.wallet_id as string, protocolId: position.protocol_id as string | null, positionType: position.position_type as string,
        policyVersion: (policyById.get(position.policy_version_id as string)?.version as string | undefined) ?? "unknown", representedExposureUsd: String(position.amount_usd), evidenceState: position.evidence as "none" | "asserted" | "verified" | "contested",
      })),
      edges: (edgesRes.data ?? []).map((edge) => ({
        id: edge.id as string, organizationId: edge.organization_id as string, sourcePositionId: edge.from_position_id as string, derivedPositionId: edge.to_position_id as string, protocolId: edge.protocol_id as string,
        policyVersion: (policyById.get(edge.policy_version_id as string)?.version as string | undefined) ?? "unknown", evidenceState: edge.evidence as "none" | "asserted" | "verified" | "contested",
      })),
      asOf: new Date().toISOString(),
    });
    return json({ analysis });
  } catch (cause) {
    return json({ error: cause instanceof Error ? cause.message : "lineage analysis failed" }, 422);
  }
});
