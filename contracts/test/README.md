# Contract tests

`Suture.t.sol` covers the production-minded demo flow:

- policy authority activation, immutable historical versions, effective time, and issuer emergency mode;
- verified source deposit into a bound vault receipt;
- receipt collateralization and downstream debt lineage;
- policy change and exit-only blocking for new risk with restricted exit preserved;
- revoked credential blocking through the deterministic eligibility oracle;
- recorder authorization and duplicate lineage rejection;
- policy-authority remediation with approver gating, holder-funded assets, replacement release, and replay protection;
- prevention of arbitrary escrow funding or release.

Run `forge test --summary` from `contracts/`.

The test token, eligibility oracle, credit market, transaction references, and evidence references are deterministic fixtures. No Monad deployment or external provider call occurs.
