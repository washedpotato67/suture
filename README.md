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

## What is not claimed

On 2026-08-09 a read-only Cleanverse sandbox preflight ran end to end from the browser through the `suture-orchestrator` Edge Function against an authenticated session. `query_apass` returned `0000` with an active A-Pass (`status 1`, `cvRecordId 1916`) and `validator/verify` returned `0000` with `valid: false`, yielding a `BLOCK` decision on `VERIFIED` evidence with a stored provider request ID and SHA-256 response digest. This proves credential status evaluation and scoped validator-pool evaluation against the sandbox.

It does not prove the A-Token scope path — the one unpaused sandbox A-Token returns `ComplianceFailed` for every tested wallet, including wallets holding active A-Passes. It does not prove API-key authorization, because the documented read endpoints transmit only `api-id`. It does not prove signed webhook delivery. The source asset evidence label was set manually for that run and is not provider-attested. No Monad RPC request, contract deployment, KYC result, or on-chain transaction has been independently verified. Simulated results use asserted or unavailable evidence and are labeled DEMO DATA from the stored `is_demo` flags on the incident and remediation plan. Remediation execution in v0.1 is simulated. It records the authorized migration and issues a receipt, but moves no assets.

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
