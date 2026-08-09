# SUTURE — one-page summary

**Compliance that survives composition.**

| | |
| --- | --- |
| Repository | https://github.com/washedpotato67/suture |
| Live console | https://suture-one.vercel.app |
| Chain | Monad testnet (`10143`) — 8 contracts, all `exact_match` on Sourcify |

## Problem

A regulated tokenized asset is compliant at issuance. Then it composes: deposited
into a vault, the receipt used as collateral, the collateral backing a loan. The
policy that governed the original asset does not travel with it.

When the issuer revokes a holder's credential, every derived position downstream
is non-compliant — and nobody can say which ones, or repair them, without
freezing the market. Compliance is checked once and then lost at the first
wrapper.

## Solution

SUTURE keeps the originating policy attached to every derived position and
provides an authorised recovery path when eligibility changes.

- **Lineage** — append-only edges from source asset to vault receipt to collateral to debt, each carrying the policy version in force when it was created. Blast radius is computed from stored lineage, not guessed.
- **Preflight** — a server-authoritative decision before any consequential action. The browser never sees a provider response body and never decides compliance.
- **Remediation** — draft → issuer approval → on-chain execution → audit receipt bound to a transaction hash. Approval and execution are separate keys, enforced on chain.
- **Fail closed** — an unavailable provider blocks the action and says so. Success is never inferred from an absent answer.

## CVI · CVA integration points

CVI, CVA and CCP are capability names, not Cleanverse V5.6 module names. Each is
mapped to the documented endpoint it uses, so the console never implies an API
that does not exist. Full evidence in `docs/CVI_CVA_INTEGRATION.md`.

| Capability | Documented API | Live result |
| --- | --- | --- |
| **CVI** — verified identity | `POST /query_apass` | `0000`, active A-Pass, `cvRecordId 1916`, expiry 2029 → `VALID` / `VERIFIED` |
| **CVA** — verified asset scope | `POST /verify_apass`, `/atoken/rules`, `/atoken/is_paused`, `/atoken/launch` | `0000` with `data.code 4`, "apass verify success" → `PASS` / `VERIFIED` |
| **CCP** — compliance policy pool | `POST /validator/verify`, `/validator/is_register` | `0000` with `valid: false` → `BLOCK` / `VERIFIED` |

Three things worth noting:

1. **Both decision directions are demonstrated on verified evidence.** The A-Token scope returns `PASS`; the validator pool returns `BLOCK`. Same engine, real verdicts.
2. **API-key authorization is proven.** We launched an A-Token on the sandbox (`0x215d8d76a16A0197CB576d984f68719BE7e69025`, chain `base`, status `ISSUED`) through the documented AES/CBC envelope. Read endpoints transmit only `api-id`, so no read could establish this.
3. **Two provider-originated signed webhooks** were received and HMAC-verified — one `ISSUE_FAILED`, one `ISSUED` — so the failure path is evidenced alongside the success path.

Generic asset verification is reported `UNAVAILABLE` in every decision record.
V5.6 documents no such endpoint, so SUTURE refuses to claim one.

## Deployed chains

**Monad testnet, chain `10143`** — chain id read from the live RPC, not copied
from documentation. Eight contracts, all `exact_match` source-verified on
Sourcify. Address and transaction map in `docs/MONAD.md`.

Executed and verified on chain: policy activation, a deposit that recorded
lineage, and a complete remediation cycle — open, approve with a separate key,
fund from the source wallet, release.

- Deposit `0x914c3ad5…c1f89` (block 52228000) — receipt carries a `PositionLineageRegistry` log
- Live remediation `0xb0a63d82…4a83` (block 52238895) — audit receipt `execution_mode: external`, bound to hash and block

Cleanverse scopes are on `base`; the contracts are on Monad testnet. Nothing
asserts that a decision on one chain governs a position on another.

## What we do not claim

The contracts are **not independently audited**, including a scheduler written
during this build that holds policy authority. The deployment uses a mock asset
and mock oracle. The sandbox API key was exposed in a session log and could not
be rotated, so provider results are reproducible but not independently
trustworthy provenance. Chain reads are point-in-time, not indexed.

All of it, with the evidence for everything we do claim, is in
`docs/LIMITATIONS.md`, `docs/SECURITY_REVIEW.md`, and `docs/DEPLOYMENTS.md`.

> A compliance product that overstates its own assurance is the product failing
> at the thing it sells.
