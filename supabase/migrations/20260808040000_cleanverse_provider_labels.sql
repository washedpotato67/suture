-- Replace legacy internal provider labels in seeded demo rows.
-- These labels now match documented Cleanverse module names.

update public.integration_connections
set provider = 'Cleanverse A-Pass',
    kind = 'identity',
    endpoint_label = 'deterministic fixture. no external API call.',
    diagnostic_state = 'simulated'
where provider = 'Cleanverse CVI'
  and not exists (
    select 1 from public.integration_connections existing
    where existing.organization_id = integration_connections.organization_id
      and existing.provider = 'Cleanverse A-Pass'
  );

update public.integration_connections
set provider = 'Cleanverse A-Token',
    kind = 'asset_scope',
    endpoint_label = 'deterministic fixture. no external API call.',
    diagnostic_state = 'simulated'
where provider = 'Cleanverse CVA'
  and not exists (
    select 1 from public.integration_connections existing
    where existing.organization_id = integration_connections.organization_id
      and existing.provider = 'Cleanverse A-Token'
  );

update public.integration_connections
set provider = 'Cleanverse Validator',
    kind = 'policy_scope',
    endpoint_label = 'deterministic fixture. no external API call.',
    diagnostic_state = 'simulated'
where provider = 'Cleanverse CCP'
  and not exists (
    select 1 from public.integration_connections existing
    where existing.organization_id = integration_connections.organization_id
      and existing.provider = 'Cleanverse Validator'
  );
