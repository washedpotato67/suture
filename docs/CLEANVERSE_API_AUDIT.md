# Cleanverse API audit

Audit source: authenticated Cleanverse Cooperate API documentation, version 5.6, dated 2026-07-21. This document records documented behavior only. It does not assert a Cleanverse account, allowlisted IP, API credential, live request, or Monad deployment.

## Base URLs and authentication

| Environment | Base URL |
| --- | --- |
| Sandbox | `https://uatapi.cleanverse.com/api/cooperate` |
| Production | `https://api.cleanverse.com/api/cooperate` |

Every request requires the `api-id` HTTP header. `api-id` identifies the integration. The provider `api-key` is local server secret material. The API key must never appear in a browser, request header, log, audit payload, or frontend build artifact.

Selected write endpoints require an encrypted JSON envelope: `{ "data": "<Base64 ciphertext>" }`. The documented algorithm is AES/CBC/PKCS5Padding with a Base64-decoded API key, UTF-8 plaintext, Base64 ciphertext, and an IV of sixteen zero bytes. Read endpoints used by SUTURE are plain JSON.

`X-Request-ID` is optional, expects a UUID, and is used by the provider for tracking. SUTURE sends one for every provider request and records only the opaque identifier plus a SHA-256 response digest.

## Documented endpoints used by SUTURE

### Credential and holder status

`POST /query_apass`

- Roles: Issue Member, Gateway Member, Service Partner.
- Plain JSON body: `{ "chain": "monad", "address": "0x..." }`.
- Supported chain labels include `monad`.
- Successful response has top-level `code: "0000"` and flat `data` fields: `cvRecordId`, `tier`, `subTier`, `group`, `subGroup`, `status`, `expirationTime`, `currentKycHash`, and `countries`.
- `status` is `1` for active and `2` for frozen. `expirationTime` is Unix seconds.
- The response contains no nested wallet list. SUTURE never assumes one.

SUTURE maps this response to `VALID`, `EXPIRED`, `SUSPENDED`, or `UNKNOWN`. The provider documents no explicit revocation state in this response. `REVOKED` therefore comes only from an existing SUTURE issuer observation or a future documented provider signal, never from a guessed Cleanverse field.

`POST /verify_apass`

- Roles: Issue Member, Gateway Member, Service Partner.
- Plain JSON body: `{ "chain": "monad", "atoken": "0x...", "address": "0x..." }`.
- Checks eligibility to receive or transfer the supplied A-Token or wrapped A-Token.
- Top-level `code: "0000"` means the request completed. `data.code` is the compliance result: `1` A-Token missing, `2` A-Pass missing, `3` A-Pass expired or frozen, `4` valid A-Pass and transfer allowed.

### Asset and policy reads

`POST /atoken/rules`

- Role: Issue Member.
- Plain JSON body: `{ "chain": "monad", "atoken_address": "0x..." }`.
- Returns A-Token rules containing `allowed_group`, `allowed_sub_group`, `min_tier`, `min_sub_tier`, `is_black_list`, and `countries`.

`POST /atoken/is_paused`

- Role: Issue Member.
- Plain JSON body: `{ "chain": "monad", "atoken_address": "0x..." }`.
- Returns `data.paused` and the requested chain and A-Token address.

`POST /validator/verify`

- Role: Issue Member.
- Plain JSON body: `{ "chain": "monad", "contract_address": "0x...", "user_address": "0x..." }`.
- Checks a wallet against a registered validator compliance pool.
- Top-level `code: "0000"` means the read completed. `data.valid` is the eligibility result. `false` is a compliance outcome, not a transport error.
- A paused pool may return `12027` instead of `data.valid`.

These APIs establish state for a particular A-Token or registered validator pool. The documentation exposes no generic asset-verification API. SUTURE therefore does not label a source asset `VERIFIED` from a Cleanverse response unless a documented A-Token or validator scope has been configured for that asset.

### Audit evidence

`POST /download_travel_rule`

- Roles: Issue Member, Gateway Member, Service Partner.
- Plain JSON body requires `txHash` and `wallet: { chain, address }`. `customerId` and `cvRecordId` are optional.
- Returns a time-limited `downloadUrl` and `fileName` for a Travel Rule withdrawal report or A-Token transfer report.

SUTURE stores an opaque evidence reference, filename, provider request ID, response digest, and retrieval timestamp. Provider decisions also preserve the SUTURE asset ID, immutable policy version label and hash, configured scope kind and chain, decision codes, and raw provider result in a server-only record. SUTURE does not store the signed URL in a public receipt or expose report contents in the client.

`POST /query_txs` exists for indexed Cleanverse transactions. It is not a source of SUTURE position lineage because the provider documents no position lineage model or receipt-token inheritance semantics.

### A-Token application webhook

Cleanverse documents an A-Token application result webhook only. It is available after the four A-Token apply submissions when an Issue Member supplies `callback_url`. The event is `ATOKEN_APPLY_RESULT` and contains `requestId`, `timestamp`, `data.flowType`, `data.applyStatus`, chain, optional token and transaction addresses, and issue or rejection details.

The webhook headers are:

| Header | Meaning |
| --- | --- |
| `X-Cleanverse-Event` | Event type |
| `X-Cleanverse-Delivery-Id` | Unique delivery UUID used for idempotency |
| `X-Cleanverse-Signature` | HMAC-SHA256 hex digest of the raw JSON body |

The signature key is the Base64-decoded API key. Verify the raw body bytes before JSON parsing. The documented retry delays are 1, 5, 15, 60, and 240 minutes, with five attempts total. A 2xx response acknowledges delivery.

This is not a credential-status, policy-change, revocation, or expiration webhook. SUTURE uses periodic server polling of `/query_apass` for current credential observations. Polling cadence must be configured by the operator. Until then, a credential state is `UNKNOWN` for fresh-risk checks.

## Capability matrix

| SUTURE capability | Provider endpoint | Support | SUTURE behavior |
| --- | --- | --- | --- |
| `getCredentialStatus` | `POST /query_apass` | Supported | Uses wallet, chain, status, and expiry. |
| `getVerifiedIdentity` | None | Unsupported | A-Pass query returns an opaque record ID and KYC hash, not a verified identity document. |
| `getAssetVerification` | None | Unsupported | Returns `UNAVAILABLE`. No generic CVA claim. |
| `evaluateAction` | `POST /verify_apass` or `POST /validator/verify` | Scoped | Requires a configured A-Token or registered validator-pool address. |
| `getDecisionReason` | `POST /verify_apass` | Supported for A-Token scope | Uses documented `data.code` and `data.message`. |
| `getComplianceReport` | None | Unsupported | Returns `UNAVAILABLE`. |
| `getTravelRuleEvidence` | `POST /download_travel_rule` | Supported | Returns temporary provider URL only to server-side retrieval flow. |
| Credential lifecycle webhooks | None | Unsupported | Server polling required. |
| Policy change webhooks | None | Unsupported | Server polling or issuer event required. |

The requested terms CVI, CVA, and CCP do not appear as documented Cleanverse API modules in version 5.6. SUTURE uses the documented A-Pass, A-Token, and Validator Compliance names for provider integrations.

## Responses, errors, and rate limits

Top-level provider response codes include `0000` for success, `0001` for invalid parameters, `0002` for business failure, `12026` for validator write failure, and `12027` for validator read failure. The docs list HTTP 400 for invalid request or encryption, 403 for invalid or missing `api-id`, IP restrictions, unauthorized access, or decryption failure, 404, 409, and 500.

The documentation contains no general rate-limit policy and no HTTP 429 guidance. SUTURE treats rate limits as undocumented, performs no blind retry on consequential operations, and marks retryable provider reads as unavailable after a bounded failure.

## Monad notes

Cleanverse lists `monad` as an accepted chain value for A-Pass query and related wallet requests. The audited documentation contains no Monad chain ID, RPC URL, explorer, validator address, A-Pass contract address, A-Token contract address, or deployed pool address. SUTURE does not invent any of these values.

See `docs/MONAD_CLEANVERSE.md` for the integration boundary.

## Configuration and live-call status

Required server-only environment variables are `CLEANVERSE_ENVIRONMENT`, `CLEANVERSE_API_ID`, and `CLEANVERSE_API_KEY`. Action evaluation also requires an approved per-asset A-Token contract or validator pool mapping. Webhook verification requires the API key and a public server callback URL for an A-Token application flow.

No credentials were provided for this audit. No Cleanverse request was executed.
