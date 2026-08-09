-- SUTURE authoritative orchestration hardening.
-- This migration removes browser-writable compliance state, adds the missing
-- credential, impact snapshot, and remediation action records, and closes
-- cross-tenant foreign-key paths left open by the initial foundation schema.

create table public.credentials (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  provider text not null,
  provider_reference text,
  state public.credential_state not null default 'unknown',
  valid_from timestamptz,
  valid_until timestamptz,
  observed_at timestamptz not null default now(),
  evidence public.evidence_state not null default 'none',
  is_demo boolean not null default false,
  created_at timestamptz not null default now()
);

create index credentials_organization_wallet_observed
  on public.credentials(organization_id, wallet_id, observed_at desc);

create table public.impact_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  incident_id uuid not null references public.incidents(id) on delete cascade,
  calculation_version text not null,
  lineage_digest text not null,
  affected_position_count integer not null check (affected_position_count >= 0),
  affected_value_usd numeric(20,2) not null default 0 check (affected_value_usd >= 0),
  evidence public.evidence_state not null default 'none',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index impact_snapshots_incident_created on public.impact_snapshots(incident_id, created_at desc);

alter table public.incident_impacts
  add column snapshot_id uuid references public.impact_snapshots(id);
create index incident_impacts_snapshot on public.incident_impacts(snapshot_id);

create table public.remediation_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.remediation_plans(id) on delete cascade,
  action_type text not null,
  action_key text not null,
  execution_mode text not null check (execution_mode in ('simulated', 'external')),
  status text not null check (status in ('submitted', 'confirmed', 'uncertain', 'simulated', 'failed')),
  external_reference text,
  evidence public.evidence_state not null default 'none',
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (plan_id, action_key)
);

create index remediation_actions_plan_created on public.remediation_actions(plan_id, created_at);

-- Normalize the legacy wallet credential fields into immutable observations.
insert into public.credentials (
  organization_id, wallet_id, provider, provider_reference, state, valid_from,
  valid_until, observed_at, evidence, is_demo
)
select
  organization_id,
  id,
  'legacy_wallet_record',
  credential_reference,
  credential_state,
  credential_valid_from,
  credential_valid_until,
  updated_at,
  evidence,
  is_demo
from public.wallets;

create or replace function public.record_wallet_credential_observation()
returns trigger language plpgsql set search_path = public as $$
begin
  insert into public.credentials(
    organization_id, wallet_id, provider, provider_reference, state, valid_from,
    valid_until, observed_at, evidence, is_demo
  ) values (
    new.organization_id, new.id, 'wallet_record', new.credential_reference,
    new.credential_state, new.credential_valid_from, new.credential_valid_until,
    new.updated_at, new.evidence, new.is_demo
  );
  return new;
end;
$$;

create trigger wallets_record_credential_observation
after insert on public.wallets
for each row execute function public.record_wallet_credential_observation();

create or replace function public.guard_tenant_references()
returns trigger language plpgsql set search_path = public as $$
declare
  ref_org uuid;
begin
  if tg_table_name = 'credentials' then
    select organization_id into ref_org from public.wallets where id = new.wallet_id;
    if ref_org is distinct from new.organization_id then raise exception 'credential wallet organization mismatch'; end if;

  elsif tg_table_name = 'policy_manifests' then
    select organization_id into ref_org from public.assets where id = new.asset_id;
    if ref_org is distinct from new.organization_id then raise exception 'policy manifest asset organization mismatch'; end if;

  elsif tg_table_name = 'policy_versions' then
    select organization_id into ref_org from public.policy_manifests where id = new.manifest_id;
    if ref_org is distinct from new.organization_id then raise exception 'policy version manifest organization mismatch'; end if;
    if new.supersedes_id is not null then
      select organization_id into ref_org from public.policy_versions where id = new.supersedes_id;
      if ref_org is distinct from new.organization_id then raise exception 'policy version supersedes organization mismatch'; end if;
    end if;

  elsif tg_table_name = 'positions' then
    if new.asset_id is not null then
      select organization_id into ref_org from public.assets where id = new.asset_id;
      if ref_org is distinct from new.organization_id then raise exception 'position asset organization mismatch'; end if;
    end if;
    select organization_id into ref_org from public.wallets where id = new.wallet_id;
    if ref_org is distinct from new.organization_id then raise exception 'position wallet organization mismatch'; end if;
    if new.protocol_id is not null then
      select organization_id into ref_org from public.protocols where id = new.protocol_id;
      if ref_org is distinct from new.organization_id then raise exception 'position protocol organization mismatch'; end if;
    end if;
    if new.parent_position_id is not null then
      select organization_id into ref_org from public.positions where id = new.parent_position_id;
      if ref_org is distinct from new.organization_id then raise exception 'position parent organization mismatch'; end if;
    end if;
    select organization_id into ref_org from public.policy_versions where id = new.policy_version_id;
    if ref_org is distinct from new.organization_id then raise exception 'position policy organization mismatch'; end if;

  elsif tg_table_name = 'lineage_edges' then
    select organization_id into ref_org from public.positions where id = new.from_position_id;
    if ref_org is distinct from new.organization_id then raise exception 'lineage source organization mismatch'; end if;
    select organization_id into ref_org from public.positions where id = new.to_position_id;
    if ref_org is distinct from new.organization_id then raise exception 'lineage target organization mismatch'; end if;
    select organization_id into ref_org from public.policy_versions where id = new.policy_version_id;
    if ref_org is distinct from new.organization_id then raise exception 'lineage policy organization mismatch'; end if;
    if new.supersedes_id is not null then
      select organization_id into ref_org from public.lineage_edges where id = new.supersedes_id;
      if ref_org is distinct from new.organization_id then raise exception 'lineage supersedes organization mismatch'; end if;
    end if;

  elsif tg_table_name = 'incidents' then
    if new.source_wallet_id is not null then
      select organization_id into ref_org from public.wallets where id = new.source_wallet_id;
      if ref_org is distinct from new.organization_id then raise exception 'incident wallet organization mismatch'; end if;
    end if;
    if new.source_position_id is not null then
      select organization_id into ref_org from public.positions where id = new.source_position_id;
      if ref_org is distinct from new.organization_id then raise exception 'incident position organization mismatch'; end if;
    end if;

  elsif tg_table_name = 'impact_snapshots' then
    select organization_id into ref_org from public.incidents where id = new.incident_id;
    if ref_org is distinct from new.organization_id then raise exception 'impact snapshot incident organization mismatch'; end if;

  elsif tg_table_name = 'incident_impacts' then
    select organization_id into ref_org from public.incidents where id = new.incident_id;
    if ref_org is distinct from new.organization_id then raise exception 'incident impact incident organization mismatch'; end if;
    select organization_id into ref_org from public.positions where id = new.position_id;
    if ref_org is distinct from new.organization_id then raise exception 'incident impact position organization mismatch'; end if;
    if new.snapshot_id is not null then
      select organization_id into ref_org from public.impact_snapshots where id = new.snapshot_id;
      if ref_org is distinct from new.organization_id then raise exception 'incident impact snapshot organization mismatch'; end if;
    end if;

  elsif tg_table_name = 'remediation_actions' then
    select organization_id into ref_org from public.remediation_plans where id = new.plan_id;
    if ref_org is distinct from new.organization_id then raise exception 'remediation action plan organization mismatch'; end if;
  end if;
  return new;
end;
$$;

create trigger credentials_tenant_guard before insert or update on public.credentials
for each row execute function public.guard_tenant_references();
create trigger policy_manifests_tenant_guard before insert or update on public.policy_manifests
for each row execute function public.guard_tenant_references();
create trigger policy_versions_tenant_guard before insert or update on public.policy_versions
for each row execute function public.guard_tenant_references();
create trigger positions_tenant_guard before insert or update on public.positions
for each row execute function public.guard_tenant_references();
create trigger lineage_edges_tenant_guard before insert on public.lineage_edges
for each row execute function public.guard_tenant_references();
create trigger incidents_tenant_guard before insert or update on public.incidents
for each row execute function public.guard_tenant_references();
create trigger impact_snapshots_tenant_guard before insert on public.impact_snapshots
for each row execute function public.guard_tenant_references();
create trigger incident_impacts_tenant_guard before insert or update on public.incident_impacts
for each row execute function public.guard_tenant_references();
create trigger remediation_actions_tenant_guard before insert on public.remediation_actions
for each row execute function public.guard_tenant_references();

-- Policy versions are historical records. A successor refers to its predecessor;
-- no version record is ever edited or deleted.
drop trigger if exists policy_versions_immutable on public.policy_versions;
create trigger policy_versions_append_only
before update or delete on public.policy_versions
for each row execute function public.reject_immutable_update();
create trigger credentials_append_only
before update or delete on public.credentials
for each row execute function public.reject_immutable_update();
create trigger impact_snapshots_append_only
before update or delete on public.impact_snapshots
for each row execute function public.reject_immutable_update();
create trigger remediation_actions_append_only
before update or delete on public.remediation_actions
for each row execute function public.reject_immutable_update();

alter table public.credentials enable row level security;
alter table public.impact_snapshots enable row level security;
alter table public.remediation_actions enable row level security;
create policy credentials_read on public.credentials for select to authenticated
using (public.is_organization_member(organization_id, auth.uid()));
create policy impact_snapshots_read on public.impact_snapshots for select to authenticated
using (public.is_organization_member(organization_id, auth.uid()));
create policy remediation_actions_read on public.remediation_actions for select to authenticated
using (public.is_organization_member(organization_id, auth.uid()));

-- The browser receives read-only tables plus constrained security-definer RPCs.
-- Provider ingestion and future live execution belong in server-side functions.
revoke insert, update, delete on public.organizations, public.organization_memberships,
  public.assets, public.policy_manifests, public.policy_versions, public.wallets,
  public.protocols, public.positions, public.lineage_edges, public.incidents,
  public.incident_impacts, public.evidence_items, public.audit_events,
  public.remediation_plans, public.approval_records, public.audit_receipts,
  public.integration_connections, public.credentials, public.impact_snapshots,
  public.remediation_actions from authenticated;
grant select on public.credentials, public.impact_snapshots, public.remediation_actions to authenticated;
grant all on public.credentials, public.impact_snapshots, public.remediation_actions to service_role;

create or replace function public.request_remediation_approval(_plan_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  _user uuid := auth.uid();
  _org uuid;
  _status text;
begin
  if _user is null then raise exception 'authentication required'; end if;
  select organization_id, status into _org, _status
  from public.remediation_plans where id = _plan_id for update;
  if _org is null then raise exception 'remediation plan not found'; end if;
  if not public.can_operate_organization(_org, _user) then raise exception 'insufficient role to request approval'; end if;
  if _status <> 'draft' then raise exception 'approval can only be requested from draft status (current: %)', _status; end if;

  update public.remediation_plans set status = 'pending_approval' where id = _plan_id;
  insert into public.approval_records(organization_id, plan_id, required_role, decision, decided_by)
  values (_org, _plan_id, 'issuer_admin', 'requested', _user);
  insert into public.audit_events(organization_id, actor_id, event_type, subject_type, subject_id, payload)
  values (_org, _user, 'remediation_approval_requested', 'remediation_plan', _plan_id, '{}'::jsonb);
  return _plan_id;
end;
$$;

create or replace function public.decide_remediation_approval(
  _plan_id uuid,
  _approve boolean,
  _note text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  _user uuid := auth.uid();
  _org uuid;
  _status text;
begin
  if _user is null then raise exception 'authentication required'; end if;
  select organization_id, status into _org, _status
  from public.remediation_plans where id = _plan_id for update;
  if _org is null then raise exception 'remediation plan not found'; end if;
  if not public.is_organization_admin(_org, _user) then raise exception 'only an owner or issuer administrator may decide approvals'; end if;
  if _status <> 'pending_approval' then raise exception 'plan is not pending approval (current: %)', _status; end if;

  if _approve then
    update public.remediation_plans set status = 'approved', approved_by = _user, approved_at = now() where id = _plan_id;
  else
    update public.remediation_plans set status = 'cancelled' where id = _plan_id;
  end if;
  insert into public.approval_records(organization_id, plan_id, required_role, decision, decided_by, note)
  values (_org, _plan_id, 'issuer_admin', case when _approve then 'approved' else 'rejected' end, _user, _note);
  insert into public.audit_events(organization_id, actor_id, event_type, subject_type, subject_id, payload)
  values (_org, _user, case when _approve then 'remediation_approved' else 'remediation_rejected' end,
    'remediation_plan', _plan_id, jsonb_build_object('note', _note));
  return _plan_id;
end;
$$;

create or replace function public.execute_remediation_plan(_plan_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  _user uuid := auth.uid();
  _plan public.remediation_plans%rowtype;
  _existing_receipt uuid;
  _receipt uuid;
  _action uuid;
  _payload jsonb;
  _source_address text;
  _replacement_address text;
  _executed_at timestamptz := now();
begin
  if _user is null then raise exception 'authentication required'; end if;
  select * into _plan from public.remediation_plans where id = _plan_id for update;
  if _plan.id is null then raise exception 'remediation plan not found'; end if;
  if not public.can_operate_organization(_plan.organization_id, _user) then raise exception 'insufficient role to execute remediation'; end if;

  select id into _existing_receipt from public.audit_receipts where plan_id = _plan_id;
  if _existing_receipt is not null then return _existing_receipt; end if;
  if _plan.status <> 'approved' then raise exception 'plan must be approved before execution (current: %)', _plan.status; end if;

  if not _plan.is_demo then
    raise exception 'live remediation execution is not configured; no external action was attempted';
  end if;

  update public.remediation_plans set status = 'executing' where id = _plan_id;
  select address into _source_address from public.wallets where id = _plan.source_wallet_id;
  select address into _replacement_address from public.wallets where id = _plan.replacement_wallet_id;
  _payload := jsonb_build_object(
    'receipt_version', 2,
    'action', _plan.plan_type,
    'plan_id', _plan.id,
    'incident_id', _plan.incident_id,
    'source_wallet', _source_address,
    'replacement_wallet', _replacement_address,
    'approved_by', _plan.approved_by,
    'approved_at', _plan.approved_at,
    'executed_at', _executed_at,
    'demo', _plan.is_demo,
    'execution_mode', case when _plan.is_demo then 'simulated' else 'external' end,
    'evidence_state', case when _plan.is_demo then 'asserted' else 'none' end
  );
  insert into public.remediation_actions(
    organization_id, plan_id, action_type, action_key, execution_mode, status,
    evidence, payload, created_by
  ) values (
    _plan.organization_id, _plan.id, _plan.plan_type, 'execute:' || _plan.idempotency_key,
    'simulated', 'simulated', 'asserted', _payload, _user
  ) returning id into _action;

  insert into public.audit_receipts(
    organization_id, incident_id, plan_id, receipt_hash, payload, issued_by
  ) values (
    _plan.organization_id, _plan.incident_id, _plan.id,
    encode(extensions.digest(_payload::text, 'sha256'), 'hex'), _payload, _user
  ) returning id into _receipt;
  update public.remediation_plans set status = 'resolved', executed_at = _executed_at where id = _plan_id;
  update public.incidents set status = 'resolved', resolved_at = _executed_at
  where id = _plan.incident_id and status <> 'resolved';
  insert into public.audit_events(organization_id, actor_id, event_type, subject_type, subject_id, payload)
  values (_plan.organization_id, _user, 'remediation_simulated', 'remediation_plan', _plan.id,
    jsonb_build_object('receipt_id', _receipt, 'action_id', _action));
  return _receipt;
end;
$$;

revoke all on function public.request_remediation_approval(uuid) from public;
revoke all on function public.decide_remediation_approval(uuid, boolean, text) from public;
revoke all on function public.execute_remediation_plan(uuid) from public;
grant execute on function public.request_remediation_approval(uuid) to authenticated;
grant execute on function public.decide_remediation_approval(uuid, boolean, text) to authenticated;
grant execute on function public.execute_remediation_plan(uuid) to authenticated;
