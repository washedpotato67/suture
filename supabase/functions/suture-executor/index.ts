import { createClient } from "npm:@supabase/supabase-js@2";
import { createPublicClient, createWalletClient, defineChain, http, type Hex } from "npm:viem@2";
import { privateKeyToAccount } from "npm:viem@2/accounts";

// Supabase does not add CORS headers to Edge Function responses.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  Vary: "Origin",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const ESCROW_ABI = [
  {
    type: "function",
    name: "openRemediation",
    stateMutability: "nonpayable",
    inputs: [
      { name: "remediationId", type: "bytes32" },
      { name: "positionId", type: "bytes32" },
      { name: "sourceWallet", type: "address" },
      { name: "replacementWallet", type: "address" },
      { name: "asset", type: "address" },
      { name: "expectedAmount", type: "uint256" },
      { name: "policyHash", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "remediation",
    stateMutability: "view",
    inputs: [{ name: "remediationId", type: "bytes32" }],
    outputs: [{
      name: "",
      type: "tuple",
      components: [
        { name: "positionId", type: "bytes32" },
        { name: "sourceWallet", type: "address" },
        { name: "replacementWallet", type: "address" },
        { name: "asset", type: "address" },
        { name: "expectedAmount", type: "uint256" },
        { name: "fundedAmount", type: "uint256" },
        { name: "policyHash", type: "bytes32" },
        { name: "status", type: "uint8" },
      ],
    }],
  },
  { type: "error", name: "DuplicateRemediation", inputs: [] },
  { type: "error", name: "Unauthorized", inputs: [] },
  { type: "error", name: "InvalidStatus", inputs: [] },
  { type: "error", name: "ZeroReference", inputs: [] },
  { type: "error", name: "InvalidFunding", inputs: [] },
  { type: "error", name: "TransferFailed", inputs: [] },
  { type: "error", name: "FundingNotPrepared", inputs: [] },
] as const;

type ChainConfig = {
  rpcUrl: string;
  chainId: number;
  escrow: Hex;
  asset: Hex;
  key: Hex;
};

/** Server chain configuration. Absent configuration blocks execution; it never falls back to a simulation. */
function chainConfig(): ChainConfig | null {
  const rpcUrl = Deno.env.get("MONAD_RPC_URL");
  const chainId = Number(Deno.env.get("MONAD_CHAIN_ID") ?? "");
  const escrow = Deno.env.get("MONAD_ESCROW_ADDRESS");
  const asset = Deno.env.get("MONAD_ASSET_ADDRESS");
  const key = Deno.env.get("MONAD_EXECUTOR_KEY");
  if (!rpcUrl || !Number.isFinite(chainId) || chainId <= 0 || !escrow || !asset || !key) return null;
  return { rpcUrl, chainId, escrow: escrow.toLowerCase() as Hex, asset: asset.toLowerCase() as Hex, key: key as Hex };
}

function chainFor(config: ChainConfig) {
  return defineChain({
    id: config.chainId,
    name: `chain-${config.chainId}`,
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
}

/**
 * Stored addresses may be in any case. viem treats a mixed-case address as
 * EIP-55 checksummed and rejects it if the checksum does not match, so
 * normalise to lowercase before use rather than trusting database casing.
 */
function address(value: string): Hex {
  return value.trim().toLowerCase() as Hex;
}

/** Deterministic per-plan identifiers so a retry addresses the same remediation. */
async function bytes32(value: string): Promise<Hex> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `0x${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}` as Hex;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authorization = request.headers.get("Authorization");
  if (!authorization) return json({ error: "authentication required" }, 401);
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceRoleKey) return json({ error: "server configuration incomplete" }, 500);

  const supabase = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } });
  const service = createClient(url, serviceRoleKey);

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return json({ error: "authentication required" }, 401);

  let body: { planId?: string; operation?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  if (!body.planId) return json({ error: "planId is required" }, 400);

  // The plan is read through the caller's session, so RLS decides visibility.
  const { data: plan, error: planError } = await supabase
    .from("remediation_plans")
    .select("id, organization_id, status, idempotency_key, source_wallet_id, replacement_wallet_id, incident_id")
    .eq("id", body.planId)
    .maybeSingle();
  if (planError) return json({ error: planError.message }, 500);
  if (!plan) return json({ error: "remediation plan not found" }, 404);

  const { data: membership } = await supabase
    .from("organization_memberships")
    .select("role")
    .eq("organization_id", plan.organization_id)
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!membership || !["owner", "issuer_admin"].includes(membership.role as string)) {
    return json({ error: "only an owner or issuer administrator may execute remediation" }, 403);
  }

  const config = chainConfig();
  if (!config) {
    return json({
      decision: "BLOCK",
      reasonCodes: ["CHAIN_EXECUTOR_UNCONFIGURED"],
      detail: "Chain executor configuration is missing. No transaction was submitted and no receipt was issued.",
    }, 503);
  }

  const chain = chainFor(config);
  const account = privateKeyToAccount(config.key);
  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
  const actionKey = `execute:onchain:${plan.idempotency_key}`;
  // Derived from the idempotency key rather than the plan id. The key identifies
  // the attempt, so re-running a reset demo scenario opens a fresh remediation
  // instead of colliding with one already on chain — chain state cannot be reset.
  const remediationId = await bytes32(`suture:remediation:${plan.idempotency_key}`);

  // Reconciliation path: settle a submission whose outcome was never observed.
  if (body.operation === "reconcile") {
    const { data: action } = await service
      .from("remediation_actions")
      .select("external_reference, status, payload")
      .eq("plan_id", plan.id)
      .eq("action_key", actionKey)
      .maybeSingle();
    if (!action?.external_reference) return json({ error: "no submission to reconcile" }, 404);
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: action.external_reference as Hex });
      if (receipt.status === "success") {
        const { data: receiptId, error } = await service.rpc("confirm_remediation_submission", {
          _plan_id: plan.id,
          _action_key: actionKey,
          _block_number: Number(receipt.blockNumber),
          _receipt: { transactionHash: receipt.transactionHash, gasUsed: String(receipt.gasUsed), status: receipt.status },
        });
        if (error) return json({ error: error.message }, 500);
        return json({ state: "confirmed", receiptId, txHash: receipt.transactionHash, blockNumber: Number(receipt.blockNumber) });
      }
      return json({ state: "failed", txHash: action.external_reference, detail: "Transaction reverted on chain." }, 409);
    } catch {
      return json({ state: "still_uncertain", txHash: action.external_reference, detail: "Receipt is not yet observable." }, 202);
    }
  }

  // Idempotency: never broadcast twice for the same plan.
  const { data: existing } = await service
    .from("remediation_actions")
    .select("id, status, external_reference")
    .eq("plan_id", plan.id)
    .eq("action_key", actionKey)
    .maybeSingle();
  if (existing) {
    return json({
      state: existing.status,
      txHash: existing.external_reference,
      detail: "A submission already exists for this plan. Use operation reconcile to settle it.",
    }, 200);
  }

  const [{ data: sourceWallet }, { data: replacementWallet }] = await Promise.all([
    supabase.from("wallets").select("address").eq("id", plan.source_wallet_id).maybeSingle(),
    supabase.from("wallets").select("address").eq("id", plan.replacement_wallet_id).maybeSingle(),
  ]);
  if (!sourceWallet || !replacementWallet) return json({ error: "wallet addresses unavailable" }, 409);

  const walletClient = createWalletClient({ account, chain, transport: http(config.rpcUrl) });

  let txHash: Hex;
  try {
    txHash = await walletClient.writeContract({
      address: config.escrow,
      abi: ESCROW_ABI,
      functionName: "openRemediation",
      args: [
        remediationId,
        await bytes32(`suture:position:${plan.idempotency_key}`),
        address(sourceWallet.address as string),
        address(replacementWallet.address as string),
        address(config.asset),
        1n,
        await bytes32(`suture:policy:${plan.idempotency_key}`),
      ],
    });
  } catch (cause) {
    // Submission never left the executor: nothing to reconcile, plan untouched.
    const message = cause instanceof Error ? cause.message : "Chain submission was rejected.";
    const duplicate = message.includes("DuplicateRemediation") || message.includes("0xf5e4b902");
    return json({
      state: "not_submitted",
      reasonCodes: [duplicate ? "CHAIN_REMEDIATION_ALREADY_OPEN" : "CHAIN_SUBMISSION_REJECTED"],
      detail: duplicate
        ? "A remediation with this identifier is already open on chain. Chain state cannot be reset; rotate the plan idempotency key to open a new one."
        : message.slice(0, 300),
    }, 502);
  }

  // Record BEFORE waiting. A crash here leaves a recoverable submission.
  const { error: submitError } = await service.rpc("record_remediation_submission", {
    _plan_id: plan.id,
    _action_key: actionKey,
    _chain_id: config.chainId,
    _tx_hash: txHash,
    _detail: { escrow: config.escrow, remediation_id: remediationId },
  });
  if (submitError) return json({ error: submitError.message, txHash }, 500);

  try {
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 45_000 });
    if (receipt.status !== "success") {
      await service.rpc("mark_remediation_uncertain", {
        _plan_id: plan.id,
        _action_key: actionKey,
        _reason: "transaction reverted on chain",
      });
      return json({ state: "failed", txHash, blockNumber: Number(receipt.blockNumber) }, 409);
    }
    const { data: receiptId, error } = await service.rpc("confirm_remediation_submission", {
      _plan_id: plan.id,
      _action_key: actionKey,
      _block_number: Number(receipt.blockNumber),
      _receipt: { transactionHash: receipt.transactionHash, gasUsed: String(receipt.gasUsed), status: receipt.status },
    });
    if (error) return json({ error: error.message, txHash }, 500);
    return json({
      state: "confirmed",
      txHash,
      blockNumber: Number(receipt.blockNumber),
      chainId: config.chainId,
      receiptId,
    });
  } catch {
    // The transaction may still confirm. Retain the hash and settle by reconciliation.
    await service.rpc("mark_remediation_uncertain", {
      _plan_id: plan.id,
      _action_key: actionKey,
      _reason: "receipt not observed within timeout",
    });
    return json({
      state: "uncertain",
      txHash,
      detail: "Submitted but the receipt was not observed. Call operation reconcile to settle.",
    }, 202);
  }
});
