# Deployment status

Deployment status as of 2026-08-09.

| Component | Status | Evidence |
| --- | --- | --- |
| SUTURE web app | Deployed | https://suture-one.vercel.app — Vercel project `broken-moon/suture`, built from GitHub `washedpotato67/suture`. Bundle carries the hosted Supabase URL and publishable key; the app renders the auth gate against hosted Supabase. |
| Supabase project | Hosted and local verified | Hosted project `jsdlpkdhenaniejevqdp` (Central EU, Frankfurt) with all nine migrations applied. Locally, the authenticated integration suite passed 6/6. |
| Edge Functions | Deployed | `suture-orchestrator` (JWT verified) and `cleanverse-webhook` (`--no-verify-jwt`, because Cleanverse sends no JWT) are ACTIVE. Hosted CORS confirmed by experiment: a probe emitting no CORS headers received none from the platform, proving the function must set them itself. |
| Monad contracts | Deployed to testnet | Chain `10143`. Eight contracts with address and tx map in `docs/MONAD.md`. Policy activated and a deposit recorded on-chain lineage. Not explorer-verified, not audited, mock asset and oracle. |
| Monad indexer | Not configured | RPC verified live; no indexer checkpoint and `MonadAdapter` still unavailable. |
| Cleanverse provider | Sandbox reads and writes verified | `PASS` on `VERIFIED` evidence via `atoken` scope (request ID `2489d478-7553-4696-a3d5-74666858c6ab`), and `BLOCK` on `VERIFIED` via validator-pool scope. A-Token `0x215d8d76a16A0197CB576d984f68719BE7e69025` launched through the AES envelope, proving api-key authorization. Two provider-originated signed webhooks received and verified. API key exposed and unrotated — see LIMITATIONS item 5. |

Do not populate deployed addresses or transaction hashes without independently verifiable chain evidence.
