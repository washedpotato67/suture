-- SUTURE foundation schema
-- Compliance continuity for tokenized assets.

create extension if not exists pgcrypto;

create type public.organization_role as enum (
  'owner', 'issuer_admin', 'compliance_operator', 'protocol_integrator', 'auditor'
);
create type public.record_state as enum ('active', 'superseded', 'archived');
create type public.evidence_state as enum ('none', 'asserted', 'verified', 'contested');
create type public.credential_state as enum ('valid', 'expired', 'suspended', 'revoked', 'unknown');
create type public.position_state as enum ('healthy', 'at_risk', 'blocked', 'remediating', 'resolved');
create type public.incident_type as enum (
  'credential_revocation', 'credential_expiry', 'policy_change', 'wallet_compromise'
);
create type public.incident_status as enum ('open', 'approved', 'executing', 'resolved', 'cancelled');
create type public.risk_severity as enum ('low', 'medium', 'high', 'critical');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.organization_role not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  symbol text,
  asset_reference text not null,
  chain_id bigint,
  contract_address text,
  issuer_name text not null,
  legal_wrapper_reference text,
  amount_usd numeric(20,2) not null default 0 check (amount_usd >= 0),
  evidence public.evidence_state not null default 'none',
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, asset_reference)
);

create table public.policy_manifests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  name text not null,
  authority_reference text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, asset_id)
);

create table public.policy_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  manifest_id uuid not null references public.policy_manifests(id) on delete cascade,
  version text not null,
  policy_hash text not null,
  rules jsonb not null default '{}'::jsonb,
  state public.record_state not null default 'active',
  activated_at timestamptz not null default now(),
  supersedes_id uuid references public.policy_versions(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (manifest_id, version)
);

create table public.wallets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  address text not null,
  label text,
  credential_reference text,
  credential_state public.credential_state not null default 'unknown',
  credential_valid_from timestamptz,
  credential_valid_until timestamptz,
  evidence public.evidence_state not null default 'none',
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, address)
);

create table public.protocols (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  protocol_type text not null,
  chain_id bigint,
  adapter_key text not null,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, adapter_key)
);

create table public.positions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid references public.assets(id),
  wallet_id uuid not null references public.wallets(id),
  protocol_id uuid references public.protocols(id),
  parent_position_id uuid references public.positions(id),
  position_reference text not null,
  position_type text not null,
  label text not null,
  amount_usd numeric(20,2) not null default 0 check (amount_usd >= 0),
  policy_version_id uuid not null references public.policy_versions(id),
  state public.position_state not null default 'healthy',
  evidence public.evidence_state not null default 'none',
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, position_reference)
);

create table public.lineage_edges (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  from_position_id uuid not null references public.positions(id),
  to_position_id uuid not null references public.positions(id),
  action text not null,
  policy_version_id uuid not null references public.policy_versions(id),
  evidence public.evidence_state not null default 'none',
  external_reference text,
  supersedes_id uuid references public.lineage_edges(id),
  created_at timestamptz not null default now(),
  check (from_position_id <> to_position_id)
);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  incident_type public.incident_type not null,
  title text not null,
  summary text not null,
  source_wallet_id uuid references public.wallets(id),
  source_position_id uuid references public.positions(id),
  severity public.risk_severity not null,
  status public.incident_status not null default 'open',
  evidence public.evidence_state not null default 'none',
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  is_demo boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.incident_impacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  incident_id uuid not null references public.incidents(id) on delete cascade,
  position_id uuid not null references public.positions(id),
  impact_type text not null,
  amount_usd numeric(20,2) not null default 0,
  state public.position_state not null,
  reason_code text not null,
  created_at timestamptz not null default now(),
  unique (incident_id, position_id)
);

create table public.evidence_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subject_type text not null,
  subject_id uuid not null,
  label text not null,
  source text,
  reference text,
  state public.evidence_state not null default 'asserted',
  payload jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references auth.users(id),
  event_type text not null,
  subject_type text not null,
  subject_id uuid,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index on public.organization_memberships(user_id);
create index on public.assets(organization_id);
create index on public.positions(organization_id, state);
create index on public.positions(parent_position_id);
create index on public.lineage_edges(organization_id, from_position_id);
create index on public.lineage_edges(organization_id, to_position_id);
create index on public.incidents(organization_id, status);
create index on public.incident_impacts(incident_id);
create index on public.audit_events(organization_id, occurred_at desc);

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_touch before update on public.organizations
for each row execute function public.touch_updated_at();
create trigger wallets_touch before update on public.wallets
for each row execute function public.touch_updated_at();
create trigger positions_touch before update on public.positions
for each row execute function public.touch_updated_at();
create trigger incidents_touch before update on public.incidents
for each row execute function public.touch_updated_at();

create or replace function public.organization_role_for(_organization uuid, _user uuid)
returns public.organization_role
language sql stable security definer set search_path = public as $$
  select role
  from public.organization_memberships
  where organization_id = _organization and user_id = _user
$$;

create or replace function public.is_organization_member(_organization uuid, _user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_memberships
    where organization_id = _organization and user_id = _user
  )
$$;

create or replace function public.can_operate_organization(_organization uuid, _user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.organization_role_for(_organization, _user) in (
    'owner', 'issuer_admin', 'compliance_operator', 'protocol_integrator'
  ), false)
$$;

create or replace function public.is_organization_admin(_organization uuid, _user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.organization_role_for(_organization, _user) in ('owner', 'issuer_admin'), false)
$$;

revoke all on function public.organization_role_for(uuid, uuid) from public;
revoke all on function public.is_organization_member(uuid, uuid) from public;
revoke all on function public.can_operate_organization(uuid, uuid) from public;
revoke all on function public.is_organization_admin(uuid, uuid) from public;
grant execute on function public.organization_role_for(uuid, uuid) to authenticated;
grant execute on function public.is_organization_member(uuid, uuid) to authenticated;
grant execute on function public.can_operate_organization(uuid, uuid) to authenticated;
grant execute on function public.is_organization_admin(uuid, uuid) to authenticated;

alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.assets enable row level security;
alter table public.policy_manifests enable row level security;
alter table public.policy_versions enable row level security;
alter table public.wallets enable row level security;
alter table public.protocols enable row level security;
alter table public.positions enable row level security;
alter table public.lineage_edges enable row level security;
alter table public.incidents enable row level security;
alter table public.incident_impacts enable row level security;
alter table public.evidence_items enable row level security;
alter table public.audit_events enable row level security;

create policy organizations_read on public.organizations for select to authenticated
using (public.is_organization_member(id, auth.uid()));
create policy organizations_update on public.organizations for update to authenticated
using (public.is_organization_admin(id, auth.uid()))
with check (public.is_organization_admin(id, auth.uid()));

create policy memberships_read on public.organization_memberships for select to authenticated
using (public.is_organization_member(organization_id, auth.uid()));
create policy memberships_manage on public.organization_memberships for all to authenticated
using (public.is_organization_admin(organization_id, auth.uid()))
with check (public.is_organization_admin(organization_id, auth.uid()));

-- Uniform tenant-table policies. Audit and lineage are read/insert only below.
do $$
declare t text;
begin
  foreach t in array array[
    'assets','policy_manifests','policy_versions','wallets','protocols',
    'positions','incidents','incident_impacts','evidence_items'
  ] loop
    execute format('create policy %I on public.%I for select to authenticated using (public.is_organization_member(organization_id, auth.uid()))', t || '_read', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_operate_organization(organization_id, auth.uid()))', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.can_operate_organization(organization_id, auth.uid())) with check (public.can_operate_organization(organization_id, auth.uid()))', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_organization_admin(organization_id, auth.uid()))', t || '_delete', t);
  end loop;
end $$;

create policy lineage_read on public.lineage_edges for select to authenticated
using (public.is_organization_member(organization_id, auth.uid()));
create policy lineage_insert on public.lineage_edges for insert to authenticated
with check (public.can_operate_organization(organization_id, auth.uid()));

create policy audit_read on public.audit_events for select to authenticated
using (public.is_organization_member(organization_id, auth.uid()));
create policy audit_insert on public.audit_events for insert to authenticated
with check (public.can_operate_organization(organization_id, auth.uid()));

create or replace function public.reject_immutable_update()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'record is immutable; create a superseding record';
end;
$$;

create trigger policy_versions_immutable
before update or delete on public.policy_versions
for each row when (old.state = 'active') execute function public.reject_immutable_update();
create trigger lineage_edges_append_only
before update or delete on public.lineage_edges
for each row execute function public.reject_immutable_update();
create trigger audit_events_append_only
before update or delete on public.audit_events
for each row execute function public.reject_immutable_update();

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

-- Table grants remain narrow; RLS is still authoritative.
grant select on all tables in schema public to authenticated;
grant insert, update, delete on public.organizations, public.organization_memberships,
  public.assets, public.policy_manifests, public.policy_versions, public.wallets,
  public.protocols, public.positions, public.incidents, public.incident_impacts,
  public.evidence_items to authenticated;
grant insert on public.lineage_edges, public.audit_events to authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
