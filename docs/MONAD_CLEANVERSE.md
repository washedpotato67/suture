# Monad and Cleanverse boundary

The authenticated Cleanverse Cooperate API documentation version 5.6 accepts `monad` as a chain label in A-Pass and wallet request bodies. The documentation does not provide a Monad chain ID, RPC endpoint, explorer URL, deployed Cleanverse contract address, validator address, A-Pass address, A-Token address, pool address, transaction, or deployment verification record.

SUTURE therefore keeps Monad integration behind its existing adapter. The Cleanverse adapter sends `chain: "monad"` only after server configuration supplies a real scope address for a source asset. The Monad adapter remains `UNAVAILABLE` until an operator supplies a verified RPC and deployed-contract configuration. No deployment claim appears in the product, audit receipt, or test fixture.

For provider policy evaluation, an operator must map a SUTURE asset to one of these documented scopes:

1. An A-Token address for `/verify_apass`, `/atoken/rules`, and `/atoken/is_paused`.
2. A registered validator pool address for `/validator/verify`.

Those scopes are not interchangeable. An A-Token result does not prove a vault receipt, credit position, or derived asset inherits compliance. SUTURE tracks those relationships in its own append-only lineage registry.
