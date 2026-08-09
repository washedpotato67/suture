# Cleanverse verification status

Verified 2026-08-09 against the sandbox. Supersedes an earlier revision of this
document that recorded only endpoint reachability; every item it listed as
outstanding has since been satisfied.

## Credential handling

The sandbox API ID and API key live in the macOS Keychain under SUTURE-specific
entries. The browser receives neither. `scripts/serve-local-functions.sh` reads
them only to launch a local Edge Function process, writing them to a `0600`
temp file that is removed on exit — `supabase functions serve` populates the
runtime environment from `--env-file` and does not inherit exported shell
variables. Hosted deployment uses `supabase secrets set` from the same source.

## What is verified

| Claim | Evidence |
| --- | --- |
| API ID authorised | HTTP 200 with a business-level response, not the 403 documented for an invalid or missing `api-id` |
| Egress permitted | Verified from both the developer machine and the hosted Frankfurt deployment |
| Real credential evaluation | `query_apass` → `0000`, `status 1`, `cvRecordId 1916`, expiry 2029, `countries` present |
| A-Token scope | `verify_apass` → `0000` with `data.code 4`, "apass verify success" |
| Validator scope | `validator/verify` → `0000` with `data.valid: false`, a compliance verdict rather than a transport error |
| **API key authorised** | `POST /atoken/launch` accepted an AES/CBC envelope keyed on the Base64-decoded api-key and returned `0000`. Read endpoints transmit only `api-id`, so no read could have established this |
| Signed webhook delivery | Two provider-originated `ATOKEN_APPLY_RESULT` events received, HMAC-SHA256 verified over the raw body, stored |

Both decision directions are demonstrated on `VERIFIED` evidence: the A-Token
scope produced a `PASS`, the validator scope produced a `BLOCK`.

## Write endpoints

An earlier revision recorded that no write endpoint had been called. That is no
longer true. `POST /atoken/launch` was called twice with the operator's explicit
authorisation, creating A-Token `0x215d8d76a16A0197CB576d984f68719BE7e69025` on
`base`.

The first attempt returned `ISSUE_FAILED` with `replacement transaction
underpriced`, a provider-side chain submission fault; the retry returned
`ISSUED`. Both outcomes arrived by webhook, so the failure path is evidenced
alongside the success path.

No A-Pass generation, status update, or other mutation was used as a test.

## What remains unverified

- **Provenance.** The sandbox API key was exposed in cleartext in an assistant session log on 2026-08-09 and could not be rotated. Every result above is reproducible but is not independently trustworthy evidence. Rotate and re-run before citing any of it externally.
- **Generic asset verification.** V5.6 exposes no such endpoint. Every decision record carries `CLEANVERSE_GENERIC_ASSET_VERIFICATION_UNAVAILABLE` rather than a fabricated result, and no amount of integration work changes this.
- **Credential lifecycle events.** The provider documents no revocation or policy-change webhook, so freshness depends on polling. `REVOKED` is recorded only from a stored issuer observation, never inferred from a provider field.
- **Rate limits.** Undocumented, so capacity against the provider is unknown.
