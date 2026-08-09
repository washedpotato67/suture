import { describe, expect, it } from "vitest";
import {
  CleanverseClient,
  type CleanverseConfig,
  verifyCleanverseWebhook,
} from "../../../supabase/functions/_shared/cleanverse";

const config: CleanverseConfig = {
  environment: "sandbox",
  baseUrl: "https://uatapi.cleanverse.com/api/cooperate",
  apiId: "test-api-id",
  apiKey: "dGVzdC1hcGkta2V5LTMyaXRlbXMtbG9uZyE=",
};

function clientWith(payload: unknown): CleanverseClient {
  return new CleanverseClient(config, async () => new Response(JSON.stringify(payload), { status: 200 }));
}

describe("Cleanverse V5.6 response mapping", () => {
  it("maps active future-expiry A-Pass records to VALID", async () => {
    const result = await clientWith({
      code: "0000",
      message: "success",
      data: { cvRecordId: "record-1", status: 1, expirationTime: 1_900_000_000 },
    }).getCredentialStatus({ chain: "monad", wallet: "0xabc", requestId: "request-1", now: new Date("2026-08-08T00:00:00.000Z") });
    expect(result.status).toBe("VALID");
    expect(result.evidenceState).toBe("VERIFIED");
    expect(result.providerReference).toBe("record-1");
  });

  it("maps frozen and elapsed A-Pass records without inventing a revocation field", async () => {
    const frozen = await clientWith({ code: "0000", message: "success", data: { status: 2, expirationTime: 1_900_000_000 } })
      .getCredentialStatus({ chain: "monad", wallet: "0xabc", requestId: "request-2", now: new Date("2026-08-08T00:00:00.000Z") });
    const expired = await clientWith({ code: "0000", message: "success", data: { status: 1, expirationTime: 1_000 } })
      .getCredentialStatus({ chain: "monad", wallet: "0xabc", requestId: "request-3", now: new Date("2026-08-08T00:00:00.000Z") });
    expect(frozen.status).toBe("SUSPENDED");
    expect(expired.status).toBe("EXPIRED");
  });

  it("treats a successful transport response with validator valid false as BLOCK", async () => {
    const result = await clientWith({ code: "0000", message: "success", data: { valid: false } })
      .evaluateAction({ scope: { kind: "validator_pool", chain: "monad", address: "0xpool" }, wallet: "0xabc", requestId: "request-4" });
    expect(result.decision).toBe("BLOCK");
    expect(result.reasonCode).toBe("CLEANVERSE_VALIDATOR_BLOCKED");
  });

  it("validates a webhook HMAC over the raw body", async () => {
    const raw = '{"txType":"ATOKEN_APPLY_RESULT","requestId":"request-5"}';
    const key = Uint8Array.from(atob(config.apiKey), (character) => character.charCodeAt(0));
    const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", imported, new TextEncoder().encode(raw))), (byte) => byte.toString(16).padStart(2, "0")).join("");
    await expect(verifyCleanverseWebhook(raw, signature, config.apiKey)).resolves.toBe(true);
    await expect(verifyCleanverseWebhook(raw, "00", config.apiKey)).resolves.toBe(false);
  });
});
