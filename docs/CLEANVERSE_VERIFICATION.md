# Cleanverse verification status

Local configuration stores the supplied sandbox API ID and API key in the macOS Keychain under SUTURE-specific entries. The browser receives neither value. `scripts/serve-local-functions.sh` reads them only when launching a local Edge Function process.

A read-only request to the documented sandbox `POST /query_apass` route used the `monad` chain and an intentionally nonexistent address. The provider returned business code `0002`, meaning the requested A-Pass was not found. This verifies endpoint reachability and the API-ID request path. It does not verify the API key, an IP allowlist, a real credential, a configured A-Token or validator scope, a credential lifecycle event, or an on-chain fact.

No provider write endpoint was called. No A-Pass generation, update, or status mutation was used as a test. No signed webhook was received from Cleanverse.

Required evidence for a complete sandbox verification:

1. A permitted sandbox IP and a real sandbox A-Pass wallet.
2. An operator-owned A-Token or validator-pool scope stored for the SUTURE asset.
3. An authenticated preflight receipt containing documented request references and a verified provider decision.
4. A webhook delivery signed by Cleanverse, retained as a server-only delivery record.
