-- Cleanverse Cooperate API V5.6 integration records.
-- Provider payloads stay server-only. Browser roles receive no direct access.

create table public.cleanverse_asset_scopes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  chain text not null check (chain in ('solana', 'base', 'avalanche', 'arbitrum', 'ethereum', 'polygon', 'bsc', 'monad', 'hashkey', 'platon')),
  scope_kind text not null check (scope_kind in ('atoken', 'validator_pool')),
  scope_address text not null check (char_length(trim(scope_address)) > 0),
  configured_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, asset_id)
);

create table public.cleanverse_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  wallet_id uuid not null references public.wallets(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  policy_version_id uuid references public.policy_versions(id),
  action text not null,
  decision text not null check (decision in ('PASS', 'BLOCK', 'REVIEW')),
  credential_status text not null check (credential_status in ('VALID', 'EXPIRED', 'REVOKED', 'SUSPENDED', 'UNKNOWN')),
  asset_status text not null check (asset_status in ('VERIFIED', 'ASSERTED', 'SIMULATED', 'UNAVAILABLE')),
  evidence_state text not null check (evidence_state in ('VERIFIED', 'ASSERTED', 'SIMULATED', 'UNAVAILABLE')),
  provider_request_id text not null,
  provider_code text,
  response_digest text,
  reason_codes text[] not null default '{}',
  raw_payload jsonb not null default '{}'::jsonb,
  evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index cleanverse_decisions_org_wallet_created
  on public.cleanverse_decisions(organization_id, wallet_id, created_at desc);
create index cleanverse_decisions_org_asset_created
  on public.cleanverse_decisions(organization_id, asset_id, created_at desc);

create table public.cleanverse_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null unique,
  event_type text not null,
  request_id text,
  provider_timestamp bigint,
  payload_digest text not null,
  raw_payload jsonb not null,
  received_at timestamptz not null default now()
);

alter table public.integration_connections
  add column diagnostic_state text not null default 'unavailable'
    check (diagnostic_state in ('connected', 'simulated', 'unavailable', 'misconfigured')),
  add column last_checked_at timestamptz,
  add column last_error_code text;

update public.integration_connections
set diagnostic_state = case
  when mode = 'demo' then 'simulated'
  when mode = 'connected' then 'connected'
  else 'unavailable'
end;

create or replace function public.guard_cleanverse_tenant_references()
returns trigger language plpgsql set search_path = public as $$
declare
  ref_org uuid;
begin
  if tg_table_name = 'cleanverse_asset_scopes' then
    select organization_id into ref_org from public.assets where id = new.asset_id;
    if ref_org is distinct from new.organization_id then raise exception 'Cleanverse scope asset organization mismatch'; end if;
  elsif tg_table_name = 'cleanverse_decisions' then
    select organization_id into ref_org from public.wallets where id = new.wallet_id;
    if ref_org is distinct from new.organization_id then raise exception 'Cleanverse decision wallet organization mismatch'; end if;
    select organization_id into ref_org from public.assets where id = new.asset_id;
    if ref_org is distinct from new.organization_id then raise exception 'Cleanverse decision asset organization mismatch'; end if;
    if new.policy_version_id is not null then
      select organization_id into ref_org from public.policy_versions where id = new.policy_version_id;
      if ref_org is distinct from new.organization_id then raise exception 'Cleanverse decision policy organization mismatch'; end if;
    end if;
  end if;
  return new;
end;
$$;

create trigger cleanverse_asset_scopes_tenant_guard before insert or update on public.cleanverse_asset_scopes
for each row execute function public.guard_cleanverse_tenant_references();
create trigger cleanverse_decisions_tenant_guard before insert on public.cleanverse_decisions
for each row execute function public.guard_cleanverse_tenant_references();
create trigger cleanverse_decisions_append_only before update or delete on public.cleanverse_decisions
for each row execute function public.reject_immutable_update();
create trigger cleanverse_webhook_deliveries_append_only before update or delete on public.cleanverse_webhook_deliveries
for each row execute function public.reject_immutable_update();

alter table public.cleanverse_asset_scopes enable row level security;
alter table public.cleanverse_decisions enable row level security;
alter table public.cleanverse_webhook_deliveries enable row level security;

-- No browser policy grants provider scopes, raw decisions, or webhook payloads.
revoke all on public.cleanverse_asset_scopes, public.cleanverse_decisions, public.cleanverse_webhook_deliveries from authenticated;
grant all on public.cleanverse_asset_scopes, public.cleanverse_decisions, public.cleanverse_webhook_deliveries to service_role;
