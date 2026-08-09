# Deployment status

Deployment status as of 2026-08-09.

| Component | Status | Evidence |
| --- | --- | --- |
| SUTURE web app | Deployed | https://suture-one.vercel.app — Vercel project `broken-moon/suture`, built from GitHub `washedpotato67/suture`. Bundle carries the hosted Supabase URL and publishable key; the app renders the auth gate against hosted Supabase. |
| Supabase project | Hosted and local verified | Hosted project `jsdlpkdhenaniejevqdp` (Central EU, Frankfurt) with all nine migrations applied. Locally, the authenticated integration suite passed 6/6. |
| Edge Functions | Deployed | `suture-orchestrator` (JWT verified) and `cleanverse-webhook` (`--no-verify-jwt`, because Cleanverse sends no JWT) are ACTIVE. Hosted CORS confirmed by experiment: a probe emitting no CORS headers received none from the platform, proving the function must set them itself. |
| Monad contracts | Deployed to testnet | Chain `10143`. Eight contracts with address and tx map in `docs/MONAD.md`. Policy activated and a deposit recorded on-chain lineage. Not explorer-verified, not audited, mock asset and oracle. |
| Monad indexer | Not configured | RPC verified live; no indexer checkpoint and `MonadAdapter` still unavailable. |
| Cleanverse provider | Sandbox reads verified | Live `query_apass` → `0000` active A-Pass and `validator/verify` → `0000` `valid: false`, persisted as a `BLOCK` on `VERIFIED` evidence with request ID and response digest. A-Token scope, API-key authorization, and signed webhook remain unexercised. |

Do not populate deployed addresses or transaction hashes without independently verifiable chain evidence.
