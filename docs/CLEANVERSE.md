# Cleanverse integration

SUTURE isolates Cleanverse Cooperate V5.6 behind `supabase/functions/_shared/cleanverse.ts`. Domain logic consumes normalized credential and scoped action decisions. It never receives API credentials, raw provider payloads, or provider-specific response fields.

The orchestration function accepts an authenticated, tenant-scoped preflight request. It blocks before calling the provider when a local credential is expired, revoked, suspended, or unknown, when a policy is paused or not effective, when the asset lacks independently stored verified evidence, or when the requested action is outside the documented provider scope.

For the documented A-Token and validator APIs, only `transfer` has a direct Cleanverse action mapping. Deposit, collateralization, borrowing, and restricted exit are enforced by SUTURE policy and contract controls. They do not claim provider action verification.

The full endpoint audit and response mapping are in `docs/CLEANVERSE_API_AUDIT.md`. Verification status is in `docs/CLEANVERSE_VERIFICATION.md`.
