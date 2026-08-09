-- SUTURE remediation workflow
-- Replaces the uncommitted-schema hardening draft with tables and constrained
-- RPCs written against the foundation schema (20260730010000).
-- Consequential state changes happen only through the security-definer RPCs
-- below; authenticated roles get read access, not direct writes.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.remediation_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  incident_id uuid not null references public.incidents(id) on delete cascade,
  source_wallet_id uuid not null references public.wallets(id),
  replacement_wallet_id uuid not null references public.wallets(id),
  plan_type text not null default 'wallet_migration',
  status text not null default 'draft' check (status in (
    'draft', 'pending_approval', 'approved', 'executing', 'uncertain', 'resolved', 'cancelled'
  )),
  idempotency_key text not null,
  evidence public.evidence_state not null default 'none',
  is_demo boolean not null default false,
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  executed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create table public.approval_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid not null references public.remediation_plans(id) on delete cascade,
  required_role public.organization_role not null,
  decision text not null check (decision in ('requested', 'approved', 'rejected')),
  decided_by uuid references auth.users(id),
  decided_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now()
);

create table public.audit_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  incident_id uuid not null references public.incidents(id),
  plan_id uuid not null references public.remediation_plans(id),
  receipt_hash text not null,
  payload jsonb not null default '{}'::jsonb,
  issued_by uuid references auth.users(id),
  issued_at timestamptz not null default now(),
  unique (plan_id)
);

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null,
  kind text not null,
  mode text not null check (mode in ('demo', 'connected', 'degraded')),
  status text not null default 'connected',
  endpoint_label text,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (organization_id, provider)
);

create index on public.remediation_plans(organization_id, status);
create index on public.remediation_plans(incident_id);
create index on public.approval_records(plan_id, created_at);
create index on public.audit_receipts(organization_id, issued_at desc);
create index on public.integration_connections(organization_id);

create trigger remediation_plans_touch before update on public.remediation_plans
for each row execute function public.touch_updated_at();

-- Approval records and receipts are evidence: append-only.
create trigger approval_records_append_only
before update or delete on public.approval_records
for each row execute function public.reject_immutable_update();
create trigger audit_receipts_append_only
before update or delete on public.audit_receipts
for each row execute function public.reject_immutable_update();

-- ---------------------------------------------------------------------------
-- Cross-tenant reference guard
-- ---------------------------------------------------------------------------

create or replace function public.guard_workflow_org_references()
returns trigger language plpgsql set search_path = public as $$
declare
  ref_org uuid;
begin
  if tg_table_name = 'remediation_plans' then
    select organization_id into ref_org from public.incidents where id = new.incident_id;
    if ref_org is distinct from new.organization_id then raise exception 'incident organization mismatch'; end if;
    select organization_id into ref_org from public.wallets where id = new.source_wallet_id;
    if ref_org is distinct from new.organization_id then raise exception 'source wallet organization mismatch'; end if;
    select organization_id into ref_org from public.wallets where id = new.replacement_wallet_id;
    if ref_org is distinct from new.organization_id then raise exception 'replacement wallet organization mismatch'; end if;
  elsif tg_table_name = 'approval_records' then
    select organization_id into ref_org from public.remediation_plans where id = new.plan_id;
    if ref_org is distinct from new.organization_id then raise exception 'plan organization mismatch'; end if;
  elsif tg_table_name = 'audit_receipts' then
    select organization_id into ref_org from public.incidents where id = new.incident_id;
    if ref_org is distinct from new.organization_id then raise exception 'incident organization mismatch'; end if;
    select organization_id into ref_org from public.remediation_plans where id = new.plan_id;
    if ref_org is distinct from new.organization_id then raise exception 'plan organization mismatch'; end if;
  end if;
  return new;
end;
$$;

create trigger remediation_plans_org_guard before insert or update on public.remediation_plans
for each row execute function public.guard_workflow_org_references();
create trigger approval_records_org_guard before insert on public.approval_records
for each row execute function public.guard_workflow_org_references();
create trigger audit_receipts_org_guard before insert on public.audit_receipts
for each row execute function public.guard_workflow_org_references();

-- ---------------------------------------------------------------------------
-- Row level security: members read; writes only through the RPCs below.
-- ---------------------------------------------------------------------------

alter table public.remediation_plans enable row level security;
alter table public.approval_records enable row level security;
alter table public.audit_receipts enable row level security;
alter table public.integration_connections enable row level security;

create policy remediation_plans_read on public.remediation_plans for select to authenticated
using (public.is_organization_member(organization_id, auth.uid()));
create policy approval_records_read on public.approval_records for select to authenticated
using (public.is_organization_member(organization_id, auth.uid()));
create policy audit_receipts_read on public.audit_receipts for select to authenticated
using (public.is_organization_member(organization_id, auth.uid()));
create policy integration_connections_read on public.integration_connections for select to authenticated
using (public.is_organization_member(organization_id, auth.uid()));

grant select on public.remediation_plans, public.approval_records,
  public.audit_receipts, public.integration_connections to authenticated;
grant all on public.remediation_plans, public.approval_records,
  public.audit_receipts, public.integration_connections to service_role;

-- ---------------------------------------------------------------------------
-- Consequential-action RPCs
-- ---------------------------------------------------------------------------

create or replace function public.create_remediation_plan(
  _incident_id uuid,
  _replacement_wallet_id uuid,
  _idempotency_key text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  _user uuid := auth.uid();
  _org uuid;
  _source_wallet uuid;
  _existing uuid;
  _plan uuid;
begin
  if _user is null then raise exception 'authentication required'; end if;
  if char_length(trim(_idempotency_key)) < 4 then raise exception 'idempotency key too short'; end if;

  select organization_id, source_wallet_id into _org, _source_wallet
  from public.incidents where id = _incident_id;
  if _org is null then raise exception 'incident not found'; end if;
  if _source_wallet is null then raise exception 'incident has no source wallet'; end if;
  if not public.can_operate_organization(_org, _user) then
    raise exception 'insufficient role to create remediation plans';
  end if;

  select id into _existing from public.remediation_plans
  where organization_id = _org and idempotency_key = trim(_idempotency_key);
  if _existing is not null then return _existing; end if;

  insert into public.remediation_plans(
    organization_id, incident_id, source_wallet_id, replacement_wallet_id,
    idempotency_key, created_by
  ) values (
    _org, _incident_id, _source_wallet, _replacement_wallet_id,
    trim(_idempotency_key), _user
  ) returning id into _plan;

  insert into public.audit_events(organization_id, actor_id, event_type, subject_type, subject_id, payload)
  values (_org, _user, 'remediation_plan_created', 'remediation_plan', _plan,
    jsonb_build_object('incident_id', _incident_id, 'idempotency_key', trim(_idempotency_key)));

  return _plan;
end;
$$;

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
  from public.remediation_plans where id = _plan_id;
  if _org is null then raise exception 'remediation plan not found'; end if;
  if not public.can_operate_organization(_org, _user) then
    raise exception 'insufficient role to request approval';
  end if;
  if _status <> 'draft' then
    raise exception 'approval can only be requested from draft status (current: %)', _status;
  end if;

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
  from public.remediation_plans where id = _plan_id;
  if _org is null then raise exception 'remediation plan not found'; end if;
  if not public.is_organization_admin(_org, _user) then
    raise exception 'only an owner or issuer administrator may decide approvals';
  end if;
  if _status <> 'pending_approval' then
    raise exception 'plan is not pending approval (current: %)', _status;
  end if;

  if _approve then
    update public.remediation_plans
    set status = 'approved', approved_by = _user, approved_at = now()
    where id = _plan_id;
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
  _payload jsonb;
  _source_address text;
  _replacement_address text;
begin
  if _user is null then raise exception 'authentication required'; end if;

  select * into _plan from public.remediation_plans where id = _plan_id;
  if _plan.id is null then raise exception 'remediation plan not found'; end if;
  if not public.can_operate_organization(_plan.organization_id, _user) then
    raise exception 'insufficient role to execute remediation';
  end if;

  -- Idempotent: an executed plan returns its original receipt.
  if _plan.status = 'resolved' then
    select id into _existing_receipt from public.audit_receipts where plan_id = _plan_id;
    return _existing_receipt;
  end if;

  if _plan.status <> 'approved' then
    raise exception 'plan must be approved before execution (current: %)', _plan.status;
  end if;

  update public.remediation_plans set status = 'executing' where id = _plan_id;

  select address into _source_address from public.wallets where id = _plan.source_wallet_id;
  select address into _replacement_address from public.wallets where id = _plan.replacement_wallet_id;

  _payload := jsonb_build_object(
    'receipt_version', 1,
    'action', _plan.plan_type,
    'plan_id', _plan.id,
    'incident_id', _plan.incident_id,
    'source_wallet', _source_address,
    'replacement_wallet', _replacement_address,
    'approved_by', _plan.approved_by,
    'approved_at', _plan.approved_at,
    'executed_at', now(),
    'demo', _plan.is_demo
  );

  insert into public.audit_receipts(
    organization_id, incident_id, plan_id, receipt_hash, payload, issued_by
  ) values (
    _plan.organization_id, _plan.incident_id, _plan.id,
    encode(extensions.digest(_payload::text, 'sha256'), 'hex'), _payload, _user
  ) returning id into _receipt;

  update public.remediation_plans set status = 'resolved', executed_at = now() where id = _plan_id;

  update public.incidents set status = 'resolved', resolved_at = now()
  where id = _plan.incident_id and status <> 'resolved';

  insert into public.audit_events(organization_id, actor_id, event_type, subject_type, subject_id, payload)
  values (_plan.organization_id, _user, 'remediation_executed', 'remediation_plan', _plan.id,
    jsonb_build_object('receipt_id', _receipt));

  return _receipt;
end;
$$;

revoke all on function public.create_remediation_plan(uuid, uuid, text) from public;
revoke all on function public.request_remediation_approval(uuid) from public;
revoke all on function public.decide_remediation_approval(uuid, boolean, text) from public;
revoke all on function public.execute_remediation_plan(uuid) from public;
grant execute on function public.create_remediation_plan(uuid, uuid, text) to authenticated;
grant execute on function public.request_remediation_approval(uuid) to authenticated;
grant execute on function public.decide_remediation_approval(uuid, boolean, text) to authenticated;
grant execute on function public.execute_remediation_plan(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Demo bootstrap: extend the foundation function with the replacement wallet,
-- integration connections, and a draft remediation plan.
-- ---------------------------------------------------------------------------

create or replace function public.create_organization_with_demo_data(
  _name text,
  _slug text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  _user uuid := auth.uid();
  _org uuid;
  _asset uuid;
  _manifest uuid;
  _policy uuid;
  _wallet uuid;
  _replacement_wallet uuid;
  _vault uuid;
  _credit uuid;
  _source_position uuid;
  _receipt_position uuid;
  _collateral_position uuid;
  _debt_position uuid;
  _incident uuid;
begin
  if _user is null then raise exception 'authentication required'; end if;
  if char_length(trim(_name)) < 2 then raise exception 'organization name too short'; end if;

  insert into public.organizations(name, slug, created_by)
  values (trim(_name), lower(trim(_slug)), _user)
  returning id into _org;

  insert into public.organization_memberships(organization_id, user_id, role)
  values (_org, _user, 'owner');

  insert into public.assets(
    organization_id, name, symbol, asset_reference, issuer_name,
    legal_wrapper_reference, amount_usd, evidence, is_demo
  ) values (
    _org, 'Northstar Private Credit Note 2028', 'NSPC28', 'demo:cva:nspc28',
    'Northstar Capital', 'DEMO-LEGAL-WRAPPER-001', 1250000, 'asserted', true
  ) returning id into _asset;

  insert into public.policy_manifests(organization_id, asset_id, name, authority_reference)
  values (_org, _asset, 'Northstar eligible-holder policy', 'demo:authority:northstar')
  returning id into _manifest;

  insert into public.policy_versions(
    organization_id, manifest_id, version, policy_hash, rules, created_by
  ) values (
    _org, _manifest, 'NSPC-4.2', 'demo:hash:nspc-4.2',
    '{"credential_required":true,"allowed_actions":["deposit","collateralize","borrow","migrate"],"safe_exit":true}'::jsonb,
    _user
  ) returning id into _policy;

  insert into public.wallets(
    organization_id, address, label, credential_reference, credential_state,
    credential_valid_from, evidence, is_demo
  ) values (
    _org, '0x71A40000000000000000000000000000000091C2', 'Source holder',
    'demo:cvi:holder-001', 'revoked', now() - interval '30 days', 'asserted', true
  ) returning id into _wallet;

  insert into public.wallets(
    organization_id, address, label, credential_reference, credential_state,
    credential_valid_from, credential_valid_until, evidence, is_demo
  ) values (
    _org, '0xB0B01000000000000000000000000000000B0B01', 'Replacement wallet',
    'demo:cvi:holder-002', 'valid', now() - interval '10 days', now() + interval '355 days',
    'asserted', true
  ) returning id into _replacement_wallet;

  insert into public.protocols(organization_id, name, protocol_type, adapter_key, is_demo)
  values (_org, 'BoundVault', 'vault', 'demo-bound-vault', true) returning id into _vault;
  insert into public.protocols(organization_id, name, protocol_type, adapter_key, is_demo)
  values (_org, 'MockCreditMarket', 'lending', 'demo-mock-credit', true) returning id into _credit;

  insert into public.positions(
    organization_id, asset_id, wallet_id, position_reference, position_type,
    label, amount_usd, policy_version_id, state, evidence, is_demo
  ) values (
    _org, _asset, _wallet, 'demo:position:source', 'source_asset',
    'Northstar Private Credit Note 2028', 1250000, _policy, 'at_risk', 'asserted', true
  ) returning id into _source_position;

  insert into public.positions(
    organization_id, asset_id, wallet_id, protocol_id, parent_position_id,
    position_reference, position_type, label, amount_usd, policy_version_id,
    state, evidence, is_demo
  ) values (
    _org, _asset, _wallet, _vault, _source_position,
    'demo:position:vault-receipt', 'vault_receipt', 'bvNSPC Receipt',
    1250000, _policy, 'at_risk', 'asserted', true
  ) returning id into _receipt_position;

  insert into public.positions(
    organization_id, asset_id, wallet_id, protocol_id, parent_position_id,
    position_reference, position_type, label, amount_usd, policy_version_id,
    state, evidence, is_demo
  ) values (
    _org, _asset, _wallet, _credit, _receipt_position,
    'demo:position:collateral', 'collateral', 'MockCredit Collateral',
    850000, _policy, 'blocked', 'asserted', true
  ) returning id into _collateral_position;

  insert into public.positions(
    organization_id, asset_id, wallet_id, protocol_id, parent_position_id,
    position_reference, position_type, label, amount_usd, policy_version_id,
    state, evidence, is_demo
  ) values (
    _org, _asset, _wallet, _credit, _collateral_position,
    'demo:position:debt', 'debt', 'USDC Borrow Position',
    612000, _policy, 'blocked', 'asserted', true
  ) returning id into _debt_position;

  insert into public.lineage_edges(organization_id, from_position_id, to_position_id, action, policy_version_id, evidence)
  values
    (_org, _source_position, _receipt_position, 'deposit', _policy, 'asserted'),
    (_org, _receipt_position, _collateral_position, 'collateralize', _policy, 'asserted'),
    (_org, _collateral_position, _debt_position, 'borrow', _policy, 'asserted');

  insert into public.incidents(
    organization_id, incident_type, title, summary, source_wallet_id, source_position_id,
    severity, status, evidence, is_demo, created_by
  ) values (
    _org, 'credential_revocation', 'Credential revoked after downstream composition',
    'The source holder credential was revoked after the note was deposited, wrapped, and used as collateral.',
    _wallet, _source_position, 'critical', 'open', 'asserted', true, _user
  ) returning id into _incident;

  insert into public.incident_impacts(
    organization_id, incident_id, position_id, impact_type, amount_usd, state, reason_code
  ) values
    (_org, _incident, _source_position, 'credential_invalid', 1250000, 'at_risk', 'CVI_REVOKED'),
    (_org, _incident, _receipt_position, 'derived_exposure', 1250000, 'at_risk', 'POLICY_CONTINUITY_BROKEN'),
    (_org, _incident, _collateral_position, 'movement_blocked', 850000, 'blocked', 'DERIVED_POSITION_INELIGIBLE'),
    (_org, _incident, _debt_position, 'movement_blocked', 612000, 'blocked', 'DERIVED_POSITION_INELIGIBLE');

  insert into public.integration_connections(organization_id, provider, kind, mode, status, endpoint_label, config)
  values
    (_org, 'Cleanverse CVI', 'identity', 'demo', 'connected', 'deterministic demo adapter',
      '{"note":"DEMO DATA - no live Cleanverse credentials configured"}'::jsonb),
    (_org, 'Cleanverse CVA', 'asset', 'demo', 'connected', 'deterministic demo adapter',
      '{"note":"DEMO DATA - no live Cleanverse credentials configured"}'::jsonb),
    (_org, 'Cleanverse CCP', 'policy', 'demo', 'connected', 'locally simulated policy checks',
      '{"note":"DEMO DATA - no live Cleanverse credentials configured"}'::jsonb),
    (_org, 'Monad', 'chain', 'demo', 'connected', 'no RPC, indexer, or deployment connected',
      '{"note":"DEMO DATA - no Monad RPC request executed"}'::jsonb);

  insert into public.remediation_plans(
    organization_id, incident_id, source_wallet_id, replacement_wallet_id,
    status, idempotency_key, evidence, is_demo, created_by
  ) values (
    _org, _incident, _wallet, _replacement_wallet,
    'draft', 'demo:plan:incident-001', 'asserted', true, _user
  );

  insert into public.audit_events(organization_id, actor_id, event_type, subject_type, subject_id, payload)
  values (
    _org, _user, 'demo_workspace_created', 'organization', _org,
    jsonb_build_object('demo_data', true, 'incident_id', _incident, 'policy_version', 'NSPC-4.2')
  );

  return _org;
end;
$$;

revoke all on function public.create_organization_with_demo_data(text, text) from public;
grant execute on function public.create_organization_with_demo_data(text, text) to authenticated;
