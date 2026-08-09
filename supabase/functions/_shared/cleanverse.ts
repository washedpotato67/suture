export type CredentialStatus = "VALID" | "EXPIRED" | "REVOKED" | "SUSPENDED" | "UNKNOWN";
export type ComplianceDecision = "PASS" | "BLOCK" | "REVIEW";
export type EvidenceState = "VERIFIED" | "ASSERTED" | "SIMULATED" | "UNAVAILABLE";
export type IntegrationDiagnosticState = "connected" | "simulated" | "unavailable" | "misconfigured";
export type CleanverseScope =
  | { kind: "atoken"; chain: string; address: string }
  | { kind: "validator_pool"; chain: string; address: string };

export interface CleanverseConfig {
  baseUrl: string;
  apiId: string;
  apiKey: string;
  environment: "sandbox" | "production";
}

export interface ProviderReference {
  requestId: string;
  responseDigest?: string;
  providerCode?: string;
}

export interface CredentialStatusResult {
  status: CredentialStatus;
  evidenceState: EvidenceState;
  observedAt: string;
  providerReference?: string;
  expiresAt?: string;
  checks: Array<{ id: string; status: "PASS" | "FAIL" | "UNKNOWN"; reasonCode: string; detail: string }>;
  raw: Record<string, unknown> | null;
  request: ProviderReference;
}

export interface ActionEvaluationResult {
  decision: ComplianceDecision;
  evidenceState: EvidenceState;
  reasonCode: string;
  reason: string;
  raw: Record<string, unknown> | null;
  request: ProviderReference;
}

export interface AssetVerificationResult {
  status: "UNAVAILABLE";
  evidenceState: "UNAVAILABLE";
  reasonCode: "CLEANVERSE_GENERIC_ASSET_VERIFICATION_UNAVAILABLE";
}

export interface CleanverseAdapter {
  getCredentialStatus(input: { chain: string; wallet: string; requestId: string; now?: Date }): Promise<CredentialStatusResult>;
  getAssetVerification(assetReference: string): Promise<AssetVerificationResult>;
  evaluateAction(input: { scope: CleanverseScope; wallet: string; requestId: string }): Promise<ActionEvaluationResult>;
  getTravelRuleEvidence(input: {
    chain: string;
    wallet: string;
    transactionHash: string;
    requestId: string;
    customerId?: string;
    cvRecordId?: string;
  }): Promise<{ downloadUrl: string; fileName?: string; raw: Record<string, unknown> | null; request: ProviderReference }>;
}

export class CleanverseProviderError extends Error {
  constructor(
    message: string,
    readonly requestId: string,
    readonly httpStatus?: number,
    readonly providerCode?: string,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = "CleanverseProviderError";
  }
}

const textEncoder = new TextEncoder();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asProviderResponse(value: unknown): { code?: string; message?: string; data: Record<string, unknown> | null } {
  if (!isRecord(value)) return { data: null };
  const code = stringValue(value.code);
  const message = stringValue(value.message);
  return {
    ...(code ? { code } : {}),
    ...(message ? { message } : {}),
    data: isRecord(value.data) ? value.data : null,
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function expiresAtFromUnixSeconds(value: unknown): string | undefined {
  const seconds = numberValue(value);
  if (seconds === undefined || seconds <= 0) return undefined;
  return new Date(seconds * 1000).toISOString();
}

export function cleanverseConfigFromEnvironment(read: (key: string) => string | undefined): CleanverseConfig | null {
  const environment = read("CLEANVERSE_ENVIRONMENT");
  const apiId = read("CLEANVERSE_API_ID");
  const apiKey = read("CLEANVERSE_API_KEY");
  if ((environment !== "sandbox" && environment !== "production") || !apiId || !apiKey) return null;
  return {
    environment,
    apiId,
    apiKey,
    baseUrl: environment === "sandbox"
      ? "https://uatapi.cleanverse.com/api/cooperate"
      : "https://api.cleanverse.com/api/cooperate",
  };
}

export function integrationDiagnostic(config: CleanverseConfig | null): {
  state: IntegrationDiagnosticState;
  detail: string;
} {
  return config
    ? { state: "unavailable", detail: "Credentials are configured. No provider request has succeeded in this runtime." }
    : { state: "misconfigured", detail: "CLEANVERSE_ENVIRONMENT, CLEANVERSE_API_ID, and CLEANVERSE_API_KEY are required server secrets." };
}

/**
 * Cleanverse V5.6 read-only client. The provider docs describe no generic asset
 * verification endpoint, so this client never manufactures a CVA result.
 */
export class CleanverseClient implements CleanverseAdapter {
  constructor(
    private readonly config: CleanverseConfig,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async getCredentialStatus(input: { chain: string; wallet: string; requestId: string; now?: Date }): Promise<CredentialStatusResult> {
    const response = await this.request("/query_apass", { chain: input.chain, address: input.wallet }, input.requestId);
    const now = input.now ?? new Date();
    const active = response.data?.status === 1;
    const frozen = response.data?.status === 2;
    const expiresAt = expiresAtFromUnixSeconds(response.data?.expirationTime);
    const expired = expiresAt ? new Date(expiresAt).getTime() <= now.getTime() : false;
    const status: CredentialStatus = frozen ? "SUSPENDED" : expired ? "EXPIRED" : active ? "VALID" : "UNKNOWN";
    const providerReference = stringValue(response.data?.cvRecordId);
    const checks = [
      {
        id: "cleanverse_apass_status",
        status: active ? "PASS" as const : frozen ? "FAIL" as const : "UNKNOWN" as const,
        reasonCode: active ? "CLEANVERSE_APASS_ACTIVE" : frozen ? "CLEANVERSE_APASS_FROZEN" : "CLEANVERSE_APASS_STATUS_UNKNOWN",
        detail: active ? "Cleanverse reports an active A-Pass." : frozen ? "Cleanverse reports a frozen A-Pass." : "Cleanverse did not return an active or frozen A-Pass status.",
      },
      {
        id: "cleanverse_apass_expiry",
        status: expiresAt ? expired ? "FAIL" as const : "PASS" as const : "UNKNOWN" as const,
        reasonCode: expired ? "CLEANVERSE_APASS_EXPIRED" : expiresAt ? "CLEANVERSE_APASS_NOT_EXPIRED" : "CLEANVERSE_APASS_EXPIRY_UNKNOWN",
        detail: expired ? "Cleanverse A-Pass expiry has elapsed." : expiresAt ? "Cleanverse A-Pass expiry has not elapsed." : "Cleanverse did not return an expiry timestamp.",
      },
    ];
    return {
      status,
      evidenceState: "VERIFIED",
      observedAt: now.toISOString(),
      ...(providerReference ? { providerReference } : {}),
      ...(expiresAt ? { expiresAt } : {}),
      checks,
      raw: response.raw,
      request: response.request,
    };
  }

  async evaluateAction(input: { scope: CleanverseScope; wallet: string; requestId: string }): Promise<ActionEvaluationResult> {
    if (input.scope.kind === "atoken") {
      const response = await this.request("/verify_apass", {
        chain: input.scope.chain,
        atoken: input.scope.address,
        address: input.wallet,
      }, input.requestId);
      const outcome = numberValue(response.data?.code);
      const message = stringValue(response.data?.message) ?? response.message ?? "Cleanverse did not provide a decision detail.";
      if (outcome === 4) return this.actionResult("PASS", "CLEANVERSE_APASS_TRANSFER_ALLOWED", message, response);
      if (outcome === 1) return this.actionResult("BLOCK", "CLEANVERSE_ATOKEN_NOT_FOUND", message, response);
      if (outcome === 2) return this.actionResult("BLOCK", "CLEANVERSE_APASS_NOT_FOUND", message, response);
      if (outcome === 3) return this.actionResult("BLOCK", "CLEANVERSE_APASS_TRANSFER_BLOCKED", message, response);
      return this.actionResult("REVIEW", "CLEANVERSE_APASS_DECISION_UNKNOWN", message, response);
    }

    const response = await this.request("/validator/verify", {
      chain: input.scope.chain,
      contract_address: input.scope.address,
      user_address: input.wallet,
    }, input.requestId);
    const valid = response.data?.valid;
    if (valid === true) return this.actionResult("PASS", "CLEANVERSE_VALIDATOR_ALLOWED", "Cleanverse validator pool reports the wallet eligible.", response);
    if (valid === false) return this.actionResult("BLOCK", "CLEANVERSE_VALIDATOR_BLOCKED", "Cleanverse validator pool reports the wallet ineligible.", response);
    return this.actionResult("REVIEW", "CLEANVERSE_VALIDATOR_DECISION_UNKNOWN", response.message ?? "Cleanverse did not return a validator decision.", response);
  }

  async getAssetVerification(assetReference: string): Promise<AssetVerificationResult> {
    void assetReference;
    return {
      status: "UNAVAILABLE",
      evidenceState: "UNAVAILABLE",
      reasonCode: "CLEANVERSE_GENERIC_ASSET_VERIFICATION_UNAVAILABLE",
    };
  }

  async getTravelRuleEvidence(input: {
    chain: string;
    wallet: string;
    transactionHash: string;
    requestId: string;
    customerId?: string;
    cvRecordId?: string;
  }): Promise<{ downloadUrl: string; fileName?: string; raw: Record<string, unknown> | null; request: ProviderReference }> {
    const response = await this.request("/download_travel_rule", {
      ...(input.customerId ? { customerId: input.customerId } : {}),
      ...(input.cvRecordId ? { cvRecordId: input.cvRecordId } : {}),
      txHash: input.transactionHash,
      wallet: { chain: input.chain, address: input.wallet },
    }, input.requestId);
    const downloadUrl = stringValue(response.data?.downloadUrl);
    if (!downloadUrl) throw new CleanverseProviderError("Cleanverse response omitted the travel-rule download URL.", input.requestId, 200, response.request.providerCode, response.raw);
    const fileName = stringValue(response.data?.fileName);
    return { downloadUrl, ...(fileName ? { fileName } : {}), raw: response.raw, request: response.request };
  }

  private actionResult(
    decision: ComplianceDecision,
    reasonCode: string,
    reason: string,
    response: { raw: Record<string, unknown> | null; request: ProviderReference },
  ): ActionEvaluationResult {
    return { decision, evidenceState: "VERIFIED", reasonCode, reason, raw: response.raw, request: response.request };
  }

  private async request(
    path: string,
    body: Record<string, unknown>,
    requestId: string,
  ): Promise<{ data: Record<string, unknown> | null; message?: string; raw: Record<string, unknown> | null; request: ProviderReference }> {
    let networkResponse: Response;
    try {
      networkResponse = await this.fetcher(`${this.config.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-id": this.config.apiId,
          "X-Request-ID": requestId,
        },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new CleanverseProviderError(error instanceof Error ? error.message : "Cleanverse request failed.", requestId);
    }

    const rawText = await networkResponse.text();
    let rawValue: unknown = null;
    try {
      rawValue = rawText ? JSON.parse(rawText) : null;
    } catch {
      throw new CleanverseProviderError("Cleanverse returned a non-JSON response.", requestId, networkResponse.status);
    }
    const parsed = asProviderResponse(rawValue);
    const responseDigest = await sha256Hex(rawText);
    const request = { requestId, responseDigest, ...(parsed.code ? { providerCode: parsed.code } : {}) };
    if (!networkResponse.ok || parsed.code !== "0000") {
      throw new CleanverseProviderError(
        parsed.message ?? `Cleanverse request failed with HTTP ${networkResponse.status}.`,
        requestId,
        networkResponse.status,
        parsed.code,
        rawValue,
      );
    }
    return { data: parsed.data, ...(parsed.message ? { message: parsed.message } : {}), raw: isRecord(rawValue) ? rawValue : null, request };
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return mismatch === 0;
}

export async function verifyCleanverseWebhook(rawBody: string, signature: string | null, apiKey: string): Promise<boolean> {
  if (!signature) return false;
  try {
    const keyBytes = Uint8Array.from(atob(apiKey), (character) => character.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const digest = await crypto.subtle.sign("HMAC", key, textEncoder.encode(rawBody));
    return constantTimeEqual(bytesToHex(new Uint8Array(digest)), signature.toLowerCase());
  } catch {
    return false;
  }
}
