-- Production-minded lineage metadata and server-authoritative graph inputs.

alter table public.policy_manifests
  add column active_policy_version_id uuid references public.policy_versions(id),
  add column emergency_status text not null default 'normal'
    check (emergency_status in ('normal', 'exit_only', 'paused'));

alter table public.policy_versions
  add column policy_reference text not null default 'legacy:policy-reference',
  add column effective_at timestamptz not null default now();

update public.policy_manifests manifest
set active_policy_version_id = current_policy.id
from (
  select distinct on (manifest_id) manifest_id, id
  from public.policy_versions
  order by manifest_id, activated_at desc, created_at desc
) current_policy
where current_policy.manifest_id = manifest.id;

alter table public.lineage_edges
  add column owner_wallet_id uuid references public.wallets(id),
  add column protocol_id uuid references public.protocols(id),
  add column transaction_reference text,
  add column evidence_reference text,
  add column observed_at timestamptz not null default now(),
  add column idempotency_key text;

alter table public.lineage_edges disable trigger lineage_edges_append_only;
update public.lineage_edges edge
set
  owner_wallet_id = source_position.wallet_id,
  protocol_id = derived_position.protocol_id,
  transaction_reference = concat('legacy:', edge.id),
  idempotency_key = concat('legacy:', edge.id)
from public.positions source_position
cross join public.positions derived_position
where source_position.id = edge.from_position_id
  and derived_position.id = edge.to_position_id;
alter table public.lineage_edges enable trigger lineage_edges_append_only;

create or replace function public.populate_lineage_metadata()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.owner_wallet_id is null then
    select wallet_id into new.owner_wallet_id from public.positions where id = new.from_position_id;
  end if;
  if new.protocol_id is null then
    select protocol_id into new.protocol_id from public.positions where id = new.to_position_id;
  end if;
  if new.transaction_reference is null then
    new.transaction_reference = concat('demo:auto:', new.id);
  end if;
  if new.idempotency_key is null then
    new.idempotency_key = concat('demo:auto:', new.id);
  end if;
  return new;
end;
$$;

create trigger lineage_edges_defaults before insert on public.lineage_edges
for each row execute function public.populate_lineage_metadata();

alter table public.lineage_edges
  alter column owner_wallet_id set not null,
  alter column protocol_id set not null,
  alter column transaction_reference set not null,
  alter column idempotency_key set not null;

create unique index lineage_edges_org_idempotency_key
  on public.lineage_edges(organization_id, idempotency_key);
create index lineage_edges_owner_wallet_observed
  on public.lineage_edges(organization_id, owner_wallet_id, observed_at desc);
create index lineage_edges_protocol_observed
  on public.lineage_edges(organization_id, protocol_id, observed_at desc);

create or replace function public.guard_lineage_metadata()
returns trigger language plpgsql set search_path = public as $$
declare
  ref_org uuid;
begin
  select organization_id into ref_org from public.wallets where id = new.owner_wallet_id;
  if ref_org is distinct from new.organization_id then raise exception 'lineage owner wallet organization mismatch'; end if;
  select organization_id into ref_org from public.protocols where id = new.protocol_id;
  if ref_org is distinct from new.organization_id then raise exception 'lineage protocol organization mismatch'; end if;
  return new;
end;
$$;

create trigger lineage_edges_metadata_guard before insert on public.lineage_edges
for each row execute function public.guard_lineage_metadata();

create or replace function public.record_lineage_event(
  _from_position_id uuid,
  _to_position_id uuid,
  _protocol_id uuid,
  _owner_wallet_id uuid,
  _action text,
  _policy_version_id uuid,
  _transaction_reference text,
  _evidence_reference text,
  _evidence public.evidence_state,
  _idempotency_key text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  _user uuid := auth.uid();
  _org uuid;
  _from_policy uuid;
  _to_policy uuid;
  _existing uuid;
  _edge uuid;
begin
  if _user is null then raise exception 'authentication required'; end if;
  if char_length(trim(_idempotency_key)) < 8 then raise exception 'idempotency key too short'; end if;
  if char_length(trim(_transaction_reference)) = 0 then raise exception 'transaction reference required'; end if;

  select organization_id, policy_version_id into _org, _from_policy from public.positions where id = _from_position_id;
  if _org is null then raise exception 'source position not found'; end if;
  if not public.can_operate_organization(_org, _user) then raise exception 'insufficient role to record lineage'; end if;
  select policy_version_id into _to_policy from public.positions where id = _to_position_id and organization_id = _org;
  if _to_policy is null then raise exception 'derived position organization mismatch'; end if;
  if _from_policy <> _policy_version_id or _to_policy <> _policy_version_id then
    raise exception 'lineage policy version must match both positions';
  end if;

  select id into _existing from public.lineage_edges
  where organization_id = _org and idempotency_key = trim(_idempotency_key);
  if _existing is not null then return _existing; end if;

  insert into public.lineage_edges(
    organization_id, from_position_id, to_position_id, action, policy_version_id,
    owner_wallet_id, protocol_id, transaction_reference, evidence_reference,
    evidence, idempotency_key
  ) values (
    _org, _from_position_id, _to_position_id, trim(_action), _policy_version_id,
    _owner_wallet_id, _protocol_id, trim(_transaction_reference), nullif(trim(_evidence_reference), ''),
    _evidence, trim(_idempotency_key)
  ) returning id into _edge;
  insert into public.audit_events(organization_id, actor_id, event_type, subject_type, subject_id, payload)
  values (_org, _user, 'lineage_recorded', 'lineage_edge', _edge,
    jsonb_build_object('transaction_reference', trim(_transaction_reference), 'idempotency_key', trim(_idempotency_key)));
  return _edge;
end;
$$;

create or replace function public.activate_policy_version(_policy_version_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  _user uuid := auth.uid();
  _org uuid;
  _manifest uuid;
  _effective_at timestamptz;
begin
  if _user is null then raise exception 'authentication required'; end if;
  select organization_id, manifest_id, effective_at into _org, _manifest, _effective_at
  from public.policy_versions where id = _policy_version_id;
  if _org is null then raise exception 'policy version not found'; end if;
  if not public.is_organization_admin(_org, _user) then raise exception 'issuer authority required'; end if;
  if _effective_at > now() then raise exception 'policy version is not effective yet'; end if;
  update public.policy_manifests set active_policy_version_id = _policy_version_id where id = _manifest;
  insert into public.audit_events(organization_id, actor_id, event_type, subject_type, subject_id, payload)
  values (_org, _user, 'policy_version_activated', 'policy_version', _policy_version_id, '{}'::jsonb);
  return _policy_version_id;
end;
$$;

create or replace function public.create_impact_snapshot(
  _incident_id uuid,
  _calculation_version text,
  _lineage_digest text,
  _affected_position_count integer,
  _affected_value_usd numeric,
  _evidence public.evidence_state
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  _user uuid := auth.uid();
  _org uuid;
  _snapshot uuid;
begin
  if _user is null then raise exception 'authentication required'; end if;
  select organization_id into _org from public.incidents where id = _incident_id;
  if _org is null then raise exception 'incident not found'; end if;
  if not public.can_operate_organization(_org, _user) then raise exception 'insufficient role to create impact snapshot'; end if;
  if char_length(trim(_calculation_version)) = 0 or char_length(trim(_lineage_digest)) = 0 then
    raise exception 'calculation version and lineage digest required';
  end if;
  insert into public.impact_snapshots(
    organization_id, incident_id, calculation_version, lineage_digest,
    affected_position_count, affected_value_usd, evidence, created_by
  ) values (
    _org, _incident_id, trim(_calculation_version), trim(_lineage_digest),
    _affected_position_count, _affected_value_usd, _evidence, _user
  ) returning id into _snapshot;
  insert into public.audit_events(organization_id, actor_id, event_type, subject_type, subject_id, payload)
  values (_org, _user, 'impact_snapshot_created', 'impact_snapshot', _snapshot,
    jsonb_build_object('incident_id', _incident_id));
  return _snapshot;
end;
$$;

revoke all on function public.record_lineage_event(uuid, uuid, uuid, uuid, text, uuid, text, text, public.evidence_state, text) from public;
revoke all on function public.activate_policy_version(uuid) from public;
revoke all on function public.create_impact_snapshot(uuid, text, text, integer, numeric, public.evidence_state) from public;
grant execute on function public.record_lineage_event(uuid, uuid, uuid, uuid, text, uuid, text, text, public.evidence_state, text) to authenticated;
grant execute on function public.activate_policy_version(uuid) to authenticated;
grant execute on function public.create_impact_snapshot(uuid, text, text, integer, numeric, public.evidence_state) to authenticated;
