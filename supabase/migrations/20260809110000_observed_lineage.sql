-- Chain-observed lineage.
--
-- Until now every lineage edge was asserted: written by the demo seed or by an
-- operator through record_lineage_event, which deliberately refuses anything
-- stronger than 'asserted' because a browser caller cannot attest to a fact.
-- The product claim is that SUTURE traces derived positions, but it could only
-- record what it was told.
--
-- A server-side read of PositionLineageRegistry logs is the trusted attestation
-- bridge that rule was waiting for. Edges ingested from a chain log carry
-- 'verified' evidence together with the chain id, block, transaction and log
-- index that produced them, so the provenance of the claim is inspectable.
--
-- Positions discovered this way are created as observed stubs: the chain knows
-- the position id, owner, protocol and policy version, but not a label or a
-- valuation, so those stay explicitly unknown rather than invented.

-- On-chain identity for a protocol, so an observed edge can be attributed to the
-- contract that emitted it rather than falling back to an arbitrary row.
alter table public.protocols
  add column if not exists chain_address text;

create unique index if not exists protocols_chain_address_unique
  on public.protocols(organization_id, lower(chain_address))
  where chain_address is not null;

-- On-chain identity for a position. Nullable: seeded demo rows have none until
-- an operator maps them.
alter table public.positions
  add column if not exists chain_position_id text;

create unique index if not exists positions_chain_identity_unique
  on public.positions(organization_id, chain_position_id)
  where chain_position_id is not null;

-- Provenance for an edge that came from a chain log rather than an assertion.
alter table public.lineage_edges
  add column if not exists chain_id integer,
  add column if not exists block_number bigint,
  add column if not exists log_index integer,
  add column if not exists observed_tx text;

-- One row per on-chain log. Re-running the indexer over the same range is a
-- no-op rather than a duplicate edge.
create unique index if not exists lineage_edges_chain_log_unique
  on public.lineage_edges(chain_id, observed_tx, log_index)
  where observed_tx is not null;

create table if not exists public.chain_indexer_checkpoints (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  chain_id integer not null,
  contract_address text not null,
  last_block bigint not null default 0,
  last_indexed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (organization_id, chain_id, contract_address)
);

alter table public.chain_indexer_checkpoints enable row level security;

create policy chain_indexer_checkpoints_read on public.chain_indexer_checkpoints
  for select using (public.is_organization_member(organization_id, auth.uid()));

/**
 * Ingests one LineageRecorded log.
 *
 * Service role only: this is the one path that may write 'verified' lineage,
 * because only a server-side chain read can attest to it. Returns the edge id,
 * or the existing one when the log has already been ingested.
 */
create or replace function public.ingest_observed_lineage(
  _organization_id uuid,
  _chain_id integer,
  _tx text,
  _log_index integer,
  _block_number bigint,
  _source_chain_id text,
  _derived_chain_id text,
  _owner_address text,
  _protocol_address text,
  _policy_version bigint,
  _action text default 'observed'
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  _existing uuid;
  _from uuid;
  _to uuid;
  _wallet uuid;
  _protocol uuid;
  _policy uuid;
  _asset uuid;
  _edge uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'observed lineage ingest requires the server indexer role';
  end if;

  select id into _existing from public.lineage_edges
   where chain_id = _chain_id and observed_tx = _tx and log_index = _log_index;
  if _existing is not null then return _existing; end if;

  -- The source must already be known. An edge from an unknown source is not
  -- something this organisation can claim, so it is skipped rather than guessed.
  select id, wallet_id, asset_id, policy_version_id
    into _from, _wallet, _asset, _policy
    from public.positions
   where organization_id = _organization_id and chain_position_id = _source_chain_id;
  if _from is null then return null; end if;

  select id into _protocol from public.protocols
   where organization_id = _organization_id and lower(coalesce(chain_address, '')) = lower(_protocol_address);
  if _protocol is null then
    select id into _protocol from public.protocols
     where organization_id = _organization_id order by created_at limit 1;
  end if;

  -- Derived position may be new. That is the point: composition SUTURE was
  -- never told about still becomes visible.
  select id into _to from public.positions
   where organization_id = _organization_id and chain_position_id = _derived_chain_id;

  if _to is null then
    insert into public.positions(
      organization_id, asset_id, wallet_id, protocol_id, parent_position_id,
      position_reference, position_type, label, amount_usd, policy_version_id,
      state, evidence, is_demo, chain_position_id
    ) values (
      _organization_id, _asset, _wallet, _protocol, _from,
      'chain:' || _derived_chain_id, 'vault_receipt',
      'Observed position ' || substr(_derived_chain_id, 3, 10),
      0, _policy, 'at_risk', 'verified', false, _derived_chain_id
    ) returning id into _to;
  end if;

  insert into public.lineage_edges(
    organization_id, from_position_id, to_position_id, action, policy_version_id,
    owner_wallet_id, protocol_id, transaction_reference, evidence,
    idempotency_key, chain_id, block_number, log_index, observed_tx
  ) values (
    _organization_id, _from, _to, trim(_action), _policy,
    _wallet, _protocol, _tx, 'verified',
    'chain:' || _chain_id || ':' || _tx || ':' || _log_index,
    _chain_id, _block_number, _log_index, _tx
  ) returning id into _edge;

  insert into public.audit_events(organization_id, actor_id, event_type, subject_type, subject_id, payload)
  values (_organization_id, null, 'lineage_observed', 'lineage_edge', _edge,
    jsonb_build_object('chain_id', _chain_id, 'tx', _tx, 'log_index', _log_index,
                       'block_number', _block_number, 'evidence', 'verified'));
  return _edge;
end;
$$;

/** Advances the indexer checkpoint. Service role only. */
create or replace function public.advance_indexer_checkpoint(
  _organization_id uuid,
  _chain_id integer,
  _contract_address text,
  _last_block bigint
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() <> 'service_role' then
    raise exception 'checkpoint advance requires the server indexer role';
  end if;
  insert into public.chain_indexer_checkpoints(
    organization_id, chain_id, contract_address, last_block, last_indexed_at, updated_at)
  values (_organization_id, _chain_id, lower(_contract_address), _last_block, now(), now())
  on conflict (organization_id, chain_id, contract_address) do update
    set last_block = greatest(public.chain_indexer_checkpoints.last_block, excluded.last_block),
        last_indexed_at = now(), updated_at = now();
end;
$$;

revoke execute on function public.ingest_observed_lineage(uuid, integer, text, integer, bigint, text, text, text, text, bigint, text) from anon, authenticated;
revoke execute on function public.advance_indexer_checkpoint(uuid, integer, text, bigint) from anon, authenticated;
