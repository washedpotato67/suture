import { createClient } from "npm:@supabase/supabase-js@2";

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

/**
 * keccak256("LineageRecorded(bytes32,bytes32,bytes32,address,address,uint64,bytes32,bytes32,uint8)")
 *
 * Indexed topics: lineageId, sourcePositionId, derivedPositionId.
 * Data words:     protocol, owner, policyVersion, transactionReference,
 *                 evidenceReference, evidenceState.
 */
const LINEAGE_RECORDED_TOPIC = Deno.env.get("MONAD_LINEAGE_TOPIC") ?? "";

// The Monad public RPC rejects eth_getLogs spans wider than 100 blocks with
// HTTP 413, so the scan is chunked and the checkpoint advances per chunk —
// a failure mid-run still leaves progress behind rather than restarting.
const CHUNK = Number(Deno.env.get("MONAD_LOG_CHUNK") ?? "100");
const MAX_CHUNKS_PER_RUN = Number(Deno.env.get("MONAD_LOG_CHUNKS") ?? "25");

type Log = { address: string; topics: string[]; data: string; blockNumber: string; transactionHash: string; logIndex: string };

async function rpc(url: string, method: string, params: unknown[]) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`RPC ${method} failed with HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.error) throw new Error(`RPC ${method}: ${payload.error.message ?? "error"}`);
  return payload.result;
}

/** Splits a 32-byte data word out of the ABI-encoded log payload. */
function word(data: string, index: number): string {
  const body = data.replace(/^0x/, "");
  return body.slice(index * 64, (index + 1) * 64);
}

const asAddress = (w: string) => `0x${w.slice(24)}`;

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

  let body: { organizationId?: string; fromBlock?: number };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }
  if (!body.organizationId) return json({ error: "organizationId is required" }, 400);

  const { data: membership } = await supabase
    .from("organization_memberships")
    .select("role")
    .eq("organization_id", body.organizationId)
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!membership) return json({ error: "organization access denied" }, 403);

  const rpcUrl = Deno.env.get("MONAD_RPC_URL");
  const chainId = Number(Deno.env.get("MONAD_CHAIN_ID") ?? "");
  const registry = Deno.env.get("MONAD_LINEAGE_REGISTRY");
  if (!rpcUrl || !Number.isFinite(chainId) || chainId <= 0 || !registry || !LINEAGE_RECORDED_TOPIC) {
    return json({
      state: "unconfigured",
      detail: "Chain indexer configuration is missing. No logs were read and no lineage was written.",
    }, 503);
  }

  // Resume from the stored checkpoint so a re-run does not re-read the chain.
  const { data: checkpoint } = await service
    .from("chain_indexer_checkpoints")
    .select("last_block")
    .eq("organization_id", body.organizationId)
    .eq("chain_id", chainId)
    .eq("contract_address", registry.toLowerCase())
    .maybeSingle();

  // The head read is as failure-prone as the log reads; an unguarded throw here
  // surfaces as an opaque 500 instead of a diagnosable state.
  let head: number;
  try {
    head = Number(await rpc(rpcUrl, "eth_blockNumber", []));
  } catch (cause) {
    return json({
      state: "unavailable",
      detail: cause instanceof Error ? cause.message.slice(0, 240) : "chain head unreadable",
    }, 503);
  }
  const start = Math.max(0, body.fromBlock ?? (checkpoint?.last_block ? Number(checkpoint.last_block) + 1 : head - CHUNK));

  if (start > head) {
    return json({ state: "current", head, checkpoint: checkpoint?.last_block ?? null, observed: 0 });
  }

  const observed: unknown[] = [];
  let skipped = 0;
  let logCount = 0;
  let cursor = start;
  let chunks = 0;

  while (cursor <= head && chunks < MAX_CHUNKS_PER_RUN) {
    const chunkEnd = Math.min(head, cursor + CHUNK - 1);
    let logs: Log[];
    try {
      logs = await rpc(rpcUrl, "eth_getLogs", [{
        address: registry,
        topics: [LINEAGE_RECORDED_TOPIC],
        fromBlock: `0x${cursor.toString(16)}`,
        toBlock: `0x${chunkEnd.toString(16)}`,
      }]) as Log[];
    } catch (cause) {
      // Report progress made before the failure instead of discarding it.
      return json({
        state: "partial",
        detail: cause instanceof Error ? cause.message.slice(0, 240) : "log read failed",
        scanned: { from: start, to: cursor - 1, head },
        observed: observed.length,
        edges: observed,
      }, 503);
    }

    logCount += logs.length;
    for (const log of logs) {
      // topics: [signature, lineageId, sourcePositionId, derivedPositionId]
      const [, , sourceId, derivedId] = log.topics;
      const { data: edgeId, error } = await service.rpc("ingest_observed_lineage", {
        _organization_id: body.organizationId,
        _chain_id: chainId,
        _tx: log.transactionHash,
        _log_index: Number(log.logIndex),
        _block_number: Number(log.blockNumber),
        _source_chain_id: sourceId,
        _derived_chain_id: derivedId,
        _owner_address: asAddress(word(log.data, 1)),
        _protocol_address: asAddress(word(log.data, 0)),
        _policy_version: Number.parseInt(word(log.data, 2), 16),
        _action: "observed",
      });
      if (error) return json({ error: error.message, atBlock: Number(log.blockNumber) }, 500);

      // A null id means the source position is unknown to this organisation,
      // so the edge is not ours to claim.
      if (edgeId) {
        observed.push({ edgeId, tx: log.transactionHash, block: Number(log.blockNumber), source: sourceId, derived: derivedId });
      } else {
        skipped += 1;
      }
    }

    await service.rpc("advance_indexer_checkpoint", {
      _organization_id: body.organizationId,
      _chain_id: chainId,
      _contract_address: registry,
      _last_block: chunkEnd,
    });

    cursor = chunkEnd + 1;
    chunks += 1;
  }

  const to = cursor - 1;
  const from = start;

  return json({
    state: "indexed",
    chainId,
    registry,
    scanned: { from, to, head },
    logs: logCount,
    caughtUp: to >= head,
    observed: observed.length,
    skippedUnknownSource: skipped,
    edges: observed,
  });
});
