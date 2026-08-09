import { createClient } from "npm:@supabase/supabase-js@2";
import { verifyCleanverseWebhook } from "../_shared/cleanverse.ts";

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDeliveryId(value: string | null): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
  const apiKey = Deno.env.get("CLEANVERSE_API_KEY");
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!apiKey || !url || !serviceRoleKey) return new Response("server configuration incomplete", { status: 503 });

  const eventType = request.headers.get("X-Cleanverse-Event");
  const deliveryId = request.headers.get("X-Cleanverse-Delivery-Id");
  const signature = request.headers.get("X-Cleanverse-Signature");
  if (eventType !== "ATOKEN_APPLY_RESULT" || !validDeliveryId(deliveryId)) return new Response("invalid event", { status: 400 });

  const rawBody = await request.text();
  if (rawBody.length === 0 || rawBody.length > 262_144) return new Response("invalid payload", { status: 400 });
  if (!await verifyCleanverseWebhook(rawBody, signature, apiKey)) return new Response("invalid signature", { status: 401 });

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("invalid JSON", { status: 400 });
  }
  if (!record(payload) || payload.txType !== "ATOKEN_APPLY_RESULT" || typeof payload.requestId !== "string" || typeof payload.timestamp !== "number" || !record(payload.data)) {
    return new Response("invalid event envelope", { status: 400 });
  }

  const service = createClient(url, serviceRoleKey);
  const inserted = await service.from("cleanverse_webhook_deliveries").insert({
    delivery_id: deliveryId,
    event_type: eventType,
    request_id: payload.requestId,
    provider_timestamp: payload.timestamp,
    payload_digest: await sha256Hex(rawBody),
    raw_payload: payload,
  });
  if (inserted.error) {
    if (inserted.error.code === "23505") return new Response(null, { status: 204 });
    return new Response("delivery persistence failed", { status: 503 });
  }
  return new Response(null, { status: 204 });
});
