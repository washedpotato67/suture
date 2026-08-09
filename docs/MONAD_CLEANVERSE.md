# Monad and Cleanverse boundary

The authenticated Cleanverse Cooperate API documentation version 5.6 accepts `monad` as a chain label in A-Pass and wallet request bodies. The documentation does not provide a Monad chain ID, RPC endpoint, explorer URL, deployed Cleanverse contract address, validator address, A-Pass address, A-Token address, pool address, transaction, or deployment verification record.

The Cleanverse adapter sends a chain label only after server configuration
supplies a real scope address for a source asset. That boundary is unchanged.

The Monad side is no longer unavailable. As of 2026-08-09 the contract slice is
deployed to Monad testnet, chain `10143` read from the live RPC rather than
copied from documentation, with a full address and transaction map in
`docs/MONAD.md`. The console reads it: the `chain_status` operation performs a
direct JSON-RPC read, asserts the reported chain id matches the configured one,
decodes `activePolicy`, and records an observation checkpoint. Audit receipts
from live execution carry `chain_id`, `tx_hash`, and `block_number`.

Two limits still apply. The chain read is point-in-time, not indexed — no synced
cursor, no reorg handling, no backfill. And the deployment uses a mock asset and
mock eligibility oracle, so it demonstrates the policy and lineage mechanism
rather than a regulated instrument.

Note that the deployed contracts and the Cleanverse scopes are on different
chains: the contracts are on Monad testnet, while the verified A-Token and
validator-pool scopes are on `base`. Nothing in the product asserts that a
Cleanverse decision on one chain governs a position on another.

For provider policy evaluation, an operator must map a SUTURE asset to one of these documented scopes:

1. An A-Token address for `/verify_apass`, `/atoken/rules`, and `/atoken/is_paused`.
2. A registered validator pool address for `/validator/verify`.

Those scopes are not interchangeable. An A-Token result does not prove a vault receipt, credit position, or derived asset inherits compliance. SUTURE tracks those relationships in its own append-only lineage registry.
