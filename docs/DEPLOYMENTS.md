# Deployment status

No public or sandbox deployment is recorded by this repository.

| Component | Status | Evidence |
| --- | --- | --- |
| SUTURE web app | Not deployed | No hosted URL or build receipt recorded. |
| Supabase project | Local development verified | All nine migrations applied on a fresh local stack; the authenticated integration suite passed 6/6 on 2026-08-09. |
| Edge Functions | Local invocation verified, not deployed | `suture-orchestrator` executes locally and returns its own auth response and CORS headers. No hosted deployment, and no authenticated provider decision record. |
| Monad contracts | Not deployed | Foundry tests only. |
| Monad indexer | Not configured | No verified RPC or deployment map. |
| Cleanverse provider | Sandbox reads verified | Live `query_apass` → `0000` active A-Pass and `validator/verify` → `0000` `valid: false`, persisted as a `BLOCK` on `VERIFIED` evidence with request ID and response digest. A-Token scope, API-key authorization, and signed webhook remain unexercised. |

Do not populate deployed addresses or transaction hashes without independently verifiable chain evidence.
