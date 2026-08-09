# Monad integration

The repository contains Solidity scaffolds and Foundry tests only. It contains no deployed Monad addresses, RPC URL, explorer URL, transaction hash, contract verification result, or indexer observation.

`MonadAdapter` is an explicit unavailable boundary until an operator supplies a verified chain configuration and a deployment map. The UI and audit model must retain this unavailable state rather than infer a deployment from local tests.

Before a chain-backed demo, record the chain ID, RPC provider, explorer, contract addresses, deployment transaction hashes, bytecode verification links, and indexer checkpoint. See `docs/DEPLOYMENTS.md`.
