# Scalability

What already scales because of a design decision, what does not yet, and what
the ceiling is. Claims here are about properties of the current code, not plans.

## What scales by construction

### Tenancy

Every table carries `organization_id` with RLS enforced at the database, not in
application code. The browser holds read access only; every consequential write
goes through a constrained security-definer RPC. Adding a tenant adds rows, not
infrastructure, and cross-tenant reference guards are enforced by triggers rather
than by convention.

Verified by an integration test that signs in as a second user and asserts the
first organisation is invisible.

### Lineage analysis

Blast radius is a breadth-first walk over stored edges with cycle detection,
linear in affected positions rather than total positions. Analysis touches only
the connected component reachable from the source, so a tenant with a million
unrelated positions costs nothing on an incident affecting four.

Financial aggregation uses integer cents via `BigInt`, so totals do not drift as
position counts grow — a correctness property that matters more, not less, at
scale.

### Provider evidence

Each decision persists the provider request ID, response digest, immutable policy
version label and hash, scope, and raw payload. Evidence is append-only and
addressable per decision, so audit retrieval is a keyed lookup rather than a
recomputation. Nothing needs replaying to answer "why was this blocked".

### Execution idempotency

Remediation actions are unique on `(plan_id, action_key)` and the table is
append-only. A retried submission returns the original action instead of
broadcasting twice; outcomes are recorded as superseding rows. This is what makes
a retry loop or a queue safe to add later without redesigning the write path.

## What does not scale yet, and why

### Chain reads are point-in-time, not indexed

`chain_status` performs a direct JSON-RPC read. There is no synced cursor, no
reorg handling, and no historical backfill. Per-tenant polling would multiply RPC
calls linearly with tenants. **This is the first thing that breaks.** It needs an
indexer with a checkpoint, which the schema already anticipates via the
`checkpoint_block` field.

### Credential freshness depends on polling

Cleanverse V5.6 documents no credential-revocation or policy-change webhook —
only an A-Token application result event. Freshness therefore costs one poll per
wallet per interval. At a few thousand wallets this is the dominant provider
cost, and no amount of engineering removes it: it is a provider capability gap,
recorded in `docs/LIMITATIONS.md` item 4.

Mitigation available today: poll on risk-weighted intervals rather than
uniformly, since a wallet with no derived positions changes nothing downstream.

### Executor throughput is single-key

The executor signs with one key, so submissions serialise on nonce. That is
correct for safety and wrong for throughput. Scaling needs a nonce-managed signer
pool or a queue with per-key partitioning — neither is present.

### Provider rate limits are undocumented

V5.6 publishes no rate-limit policy and no 429 guidance. SUTURE performs no blind
retry on consequential operations and marks retryable reads unavailable after a
bounded failure. Until limits are published, capacity planning against the
provider is guesswork, and the honest answer is that the ceiling is unknown.

## Cost shape

| Dimension | Growth | Bound |
| --- | --- | --- |
| Positions per tenant | Storage linear; analysis linear in *affected* subgraph | Postgres |
| Tenants | Rows, not infrastructure | Connection pool |
| Provider calls | One per preflight, plus polling per wallet | Undocumented provider limits |
| Chain reads | One per status check, per tenant | RPC provider, until an indexer exists |
| Executor submissions | Serialised on a single nonce | One key |

## The honest summary

The data model, tenancy, evidence trail and idempotency were built to scale and
carry test evidence for it. The **operational** layer was built to be correct
first: single-key execution, point-in-time chain reads, and polling-based
credential freshness are all deliberate simplifications with known replacements.

The binding constraint is not the schema. It is the provider's missing revocation
webhook, which no amount of engineering on this side removes.
