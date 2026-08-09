# SUTURE v0.1

**Compliance that survives composition.**

SUTURE is a compliance-continuity and recovery layer for tokenized assets used inside DeFi. The first vertical slice demonstrates how a credential revocation propagates from a source private-credit asset into its vault receipt, collateral position, and debt position — and how an issuer-authorized remediation resolves it with an audit receipt.

## What exists

- Desktop-first institutional product console.
- Email authentication and first-organization onboarding (Supabase Auth).
- Database-backed overview, lineage, incident, receipt, and integration views with a deterministic, visibly labeled demo-scenario fallback when Supabase is not configured.
- Position-lineage graph with policy and evidence metadata.
- Deterministic lineage analysis for source asset, vault receipt, collateral, and debt exposure. It returns affected positions, protocols, paths, represented exposure, blocked actions, and remediation paths. The client and server engines emit the same reason code for the same control.
- Policy-preflight results and incident sequence. Every outcome is a decision record with checks and reason codes, including a fail-closed block from local policy, absent server configuration, or an unavailable provider — a blocked evaluation is never reported as a transport failure.
- Incident console with the full remediation loop: draft plan → approval request → issuer decision → idempotent execution → SHA-256 audit receipt.
- Server-authoritative workflow RPCs (`create_remediation_plan`, `request_remediation_approval`, `decide_remediation_approval`, `execute_remediation_plan`); consequential writes are not possible from table-level access.
- Server-only Cleanverse Cooperate API V5.6 adapter. It performs documented A-Pass status reads and scoped A-Token or Validator eligibility reads. Generic asset verification is explicitly unavailable because the provider documentation exposes no such endpoint.
- A server-only Cleanverse A-Token application webhook receiver with raw-body HMAC verification and delivery, provider-request, and payload-digest idempotency.
- Supabase schema with tenant RLS, no browser write privileges, immutable credential and policy history, append-only lineage, impact, remediation, approval, and audit records, plus cross-tenant reference guards.
- Foundry contract slice for same-block policy activation, append-only asserted lineage, exact-amount vault receipts, collateral release after repayment, and user-funded authority-gated remediation.

## Verified evidence

Everything below is reproducible from this repository. Dates are 2026-08-09.

| Claim | Evidence |
| --- | --- |
| Live console | https://suture-one.vercel.app (hosted Supabase, EU Frankfurt) |
| Provider decision — PASS | `atoken` scope, request ID `2489d478-7553-4696-a3d5-74666858c6ab`, all Cleanverse checks `verified` |
| Provider decision — BLOCK | `validator_pool` scope, `validator/verify` → `0000` `valid: false` on `verified` evidence |
| API-key authorization | A-Token `0x215d8d76a16A0197CB576d984f68719BE7e69025` launched via the documented AES/CBC envelope, status `ISSUED` |
| Provider webhooks | Two signed `ATOKEN_APPLY_RESULT` deliveries received and HMAC-verified — one `ISSUE_FAILED`, one `ISSUED` |
| Contracts deployed | 8 contracts on Monad testnet (chain `10143`), all `exact_match` on Sourcify — `docs/MONAD.md` |
| On-chain lineage | Deposit tx `0x914c3ad5…c1f89`, block 52228000, `PositionLineageRegistry` log in the receipt |
| Live remediation | Executor tx `0xb0a63d82…4a83`, block 52238895, receipt `execution_mode: external` |
| Full recovery cycle on chain | open → approve (separate key) → fund → release; 100e18 delivered, status `Executed` |
| Assurance | 55 tests (31 app, 24 contract), 5 invariants × 128,000 calls, `slither` clean of High/Medium |

Read next: `docs/CVI_CVA_INTEGRATION.md` for capability depth, `docs/LIMITATIONS.md`
for everything not claimed, `docs/SECURITY_REVIEW.md` for findings,
and `docs/SCALABILITY.md` for the cost shape.

## What is not claimed

**The contracts are not audited.** `docs/SECURITY_REVIEW.md` was written by the
same session that wrote the code and argues against its own authority in its
first paragraph. That includes `PolicyActivationScheduler`, written during this
build, which holds policy authority on the deployment.

**There is no generic asset verification.** Cleanverse V5.6 exposes no such
endpoint, so every decision record carries
`CLEANVERSE_GENERIC_ASSET_VERIFICATION_UNAVAILABLE` rather than a fabricated
result. There is likewise no credential-revocation or policy-change webhook;
freshness depends on polling.

**The deployment uses a mock asset and a mock eligibility oracle.** Behaviour
against a real ERC-20 with transfer fees or non-standard returns is untested.
Remediation moved 100e18 of a mock token, not a regulated instrument.

**The sandbox API key was exposed in a session log and could not be rotated.**
Every provider result is reproducible but is not independently trustworthy
provenance.

**Key roles are not fully separated.** The executor key is scoped and cannot
approve its own remediation, but the deploy key remains issuer, approver and
vault authority.

**Chain reads are point-in-time, not indexed.** No synced cursor, no reorg
handling, no backfill.

## Run locally

```bash
npm install
npm run dev
```

Without Supabase credentials the console runs in local demo mode from fixtures, and the full incident → approval → execution → receipt loop works against in-memory state.

Verification:

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

The unit suite covers the client and server lineage engines, remediation transitions and receipt hashing, and the Cleanverse V5.6 response mapping and webhook HMAC.

## Supabase

### Local stack (verified path)

1. Start Docker, then:

   ```bash
   supabase start   # first run pulls images
   supabase db reset
   ```

   Note: `[analytics] enabled = false` in `supabase/config.toml` — the local vector/logflare container fails its health check on some machines; analytics is not needed for v0.1. If `supabase start` still fails on health checks, use `supabase start --ignore-health-check`.

   Note: `project_id` must not end in a dot followed by digits. It becomes the Edge Runtime container hostname, and a host whose final label is numeric is parsed as an IPv4 address, which makes every local function call fail with `TypeError: Invalid URL`. The id is `suture-v0-1`, not the directory name `suture-v0.1`.

2. Copy `.env.example` to `.env.local` and fill in the local URL and publishable key from `supabase status`.
3. `npm run dev`, sign up, and create your organization — onboarding calls the transactional RPC `create_organization_with_demo_data`, which seeds the Northstar demo scenario (source + replacement wallet, four positions, lineage edges, one open incident, one draft remediation plan, four demo integration connections).

### Hosted project

1. Create a Supabase project.
2. Apply every migration in `supabase/migrations/` in timestamp order. `supabase db push` is the preferred path.
3. Copy `.env.example` to `.env.local` and fill in the URL and anonymous key.

Authenticated browser clients have read access only. Onboarding and remediation lifecycle writes use constrained security-definer RPCs. The `suture-orchestrator` Edge Function is the server-only provider adapter boundary. Preflight requires `CLEANVERSE_ENVIRONMENT`, `CLEANVERSE_API_ID`, `CLEANVERSE_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and an approved asset scope stored in `cleanverse_asset_scopes`. Missing configuration blocks risk actions without sending a provider request. See `docs/CLEANVERSE_API_AUDIT.md`.

### Local Cleanverse sandbox secrets

Keep Cleanverse secrets out of `.env.local` because Vite exposes `VITE_` values to the browser. The local launcher reads `suture.cleanverse.sandbox.api-id` and `suture.cleanverse.sandbox.api-key` from the macOS Keychain, then starts local Edge Functions with server-only environment values:

```bash
scripts/serve-local-functions.sh suture-orchestrator --no-verify-jwt
```

Use an authenticated request and an approved `cleanverse_asset_scopes` record for a full preflight. Do not use an A-Pass generation or status-update request to test an API key because those APIs mutate provider state.

### Integration test against the local stack

```bash
RUN_SUPABASE_INTEGRATION=1 npm run test
```

This exercises `loadWorkspace`, remediation and lineage idempotency RPCs, evidence-state enforcement, cross-tenant remediation protection, and a second-user tenant-isolation check as authenticated RLS-bound users. The suite is skipped by default.

## Contracts

```bash
cd contracts
forge test
```

## Next implementation pass

1. Configure an approved Cleanverse sandbox account, IP allowlist, and a per-asset A-Token or validator-pool scope.
2. Execute and preserve an independently reviewed sandbox preflight receipt against a real test credential.
3. Configure a verified Monad RPC and deployed contract map.
4. Add a live remediation executor with submission reconciliation.
