# CVI · CVA · CCP integration depth

Capability map and the evidence behind each claim. Every result below was
produced by a live request to the Cleanverse sandbox on 2026-08-09 from the
server-only adapter boundary, not from a fixture.

## A naming note, stated plainly

CVI, CVA and CCP are capability names for the integration surface. They are
**not** module names in Cleanverse Cooperate API V5.6 — the documented modules
are A-Pass Management, A-Token Management and Validator Compliance. SUTURE
therefore labels each capability with the documented endpoint it maps to, rather
than implying an API that does not exist. See `docs/CLEANVERSE_API_AUDIT.md`.

| Capability | Documented API | Console label |
| --- | --- | --- |
| **CVI** — verified identity | `POST /query_apass` | `Cleanverse A-Pass · CVI` |
| **CVA** — verified asset scope | `POST /verify_apass`, `POST /atoken/rules`, `POST /atoken/is_paused`, `POST /atoken/launch` | `Cleanverse A-Token · CVA` |
| **CCP** — compliance policy pool | `POST /validator/verify`, `POST /validator/is_register` | `Cleanverse Validator · CCP` |

## CVI — verified identity

Reads holder credential status and maps it to a policy decision.

- `query_apass` returned `0000` with an active A-Pass: `status 1`, `cvRecordId 1916`, expiry 2029, `countries` present.
- Mapped to `VALID` / `VERIFIED`, surfaced as `CLEANVERSE_APASS_ACTIVE` and `CLEANVERSE_APASS_NOT_EXPIRED`.
- `query_apass_list` is used for reconciliation: it resolves the institution from `api-id` and enumerates registered A-Pass wallets. This endpoint is not in the original audit; it was found during live integration.
- **Revocation is never inferred.** V5.6 documents no revocation field, so `REVOKED` comes only from a stored issuer observation. A guessed field would be the easiest place to fake depth and the worst place to be wrong.

## CVA — verified asset scope

The deepest surface, because it required a write.

- `atoken/rules` and `atoken/is_paused` read compliance rules and pause state.
- `verify_apass` returns the documented `data.code`: `4` allowed, `3` blocked, `2` A-Pass missing, `1` A-Token missing. Live result: `0000` with `data.code 4`, "apass verify success" → `PASS` / `CLEANVERSE_APASS_TRANSFER_ALLOWED` on `VERIFIED` evidence.
- **An A-Token was launched on this account** through the documented AES/CBC envelope: `0x215d8d76a16A0197CB576d984f68719BE7e69025` on `base`, status `ISSUED`.
- That launch is the only thing that proves **api-key authorization**. Read endpoints transmit `api-id` only; a `0000` on an encrypted envelope is possible solely if Cleanverse decrypted a payload keyed on the Base64-decoded api-key.
- Generic asset verification remains `UNAVAILABLE`: V5.6 exposes no such endpoint, so SUTURE never labels a source asset verified from a provider response. This is a deliberate refusal, and it is why `CLEANVERSE_GENERIC_ASSET_VERIFICATION_UNAVAILABLE` appears in every decision record.

## CCP — compliance policy pool

- `validator/is_register` confirmed pool `0x0cbaef79…ba56` is registered on `base`.
- `validator/verify` returned `0000` with `data.valid: false` → `BLOCK` / `CLEANVERSE_VALIDATOR_BLOCKED` on `VERIFIED` evidence.
- `valid: false` is a **compliance outcome, not a transport error**, and is recorded as such. Both decision directions are therefore demonstrated on verified evidence: CVA produced a `PASS`, CCP produced a `BLOCK`.

## Webhook: the asynchronous half

Cleanverse documents one outbound event, `ATOKEN_APPLY_RESULT`.

- Two genuine provider-originated deliveries were received by the deployed
  receiver, verified by HMAC-SHA256 over the raw body keyed on the
  Base64-decoded api-key, and stored.
- The first reported `ISSUE_FAILED` with `replacement transaction underpriced`, a
  provider-side chain fault; the retry reported `ISSUED`. **Both** arrived by
  webhook, so the failure path is evidenced alongside the success path.
- Three idempotency guards were exercised: delivery id, provider request id, and
  payload digest. Three accepted POSTs produced exactly one stored row.
- The receiver must be deployed with JWT verification disabled, because
  Cleanverse sends no JWT.

## How the capabilities compose into a decision

A preflight is not three independent checks; it is one policy decision that
fails closed:

1. Local policy and evidence gates run first. If they block, **no provider request is sent at all** — the decision record says so.
2. CVI establishes holder credential status.
3. CVA or CCP evaluates the proposed action against the configured scope.
4. Asset verification is reported `UNAVAILABLE` by design.
5. Any failure or unknown yields `BLOCK`. `PASS` requires every check to pass on verified evidence.

Each decision persists the provider request ID, a SHA-256 digest of the response
body, the immutable policy version label and hash, the scope kind and chain, and
the raw provider payload — server-side only. Response bodies are never exposed
to the browser.

## What is deliberately not claimed

- No generic asset verification. The endpoint does not exist.
- No credential revocation or policy-change webhook. V5.6 documents neither; SUTURE polls and says so.
- The sandbox API key was exposed in a session log and could not be rotated, so these results are reproducible but not independently trustworthy provenance.
