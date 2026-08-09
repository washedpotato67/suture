-- Align seeded integration labels with both the documented Cleanverse V5.6 API
-- names and the capability vocabulary used to describe the integration surface.
--
-- CVI, CVA and CCP are capability names, not V5.6 module names (see
-- docs/CLEANVERSE_API_AUDIT.md). Each label therefore carries the documented
-- endpoint it maps to in `config.documented_api`, so the console never implies
-- an API exists that does not.
--
-- The previous label migration (20260808040000) was a one-time data fix, but the
-- seed function kept inserting the legacy labels, so every organisation created
-- after that migration still received them. This patches the source.

CREATE OR REPLACE FUNCTION public.create_organization_with_demo_data(_name text, _slug text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    (_org, 'Cleanverse A-Pass · CVI', 'identity', 'demo', 'connected',
      'identity capability. no provider request yet.',
      '{"capability":"CVI","documented_api":"POST /query_apass","note":"awaiting first provider request"}'::jsonb),
    (_org, 'Cleanverse A-Token · CVA', 'asset_scope', 'demo', 'connected',
      'asset capability. no provider request yet.',
      '{"capability":"CVA","documented_api":"POST /verify_apass, POST /atoken/rules","note":"awaiting first provider request"}'::jsonb),
    (_org, 'Cleanverse Validator · CCP', 'policy_scope', 'demo', 'connected',
      'policy capability. no provider request yet.',
      '{"capability":"CCP","documented_api":"POST /validator/verify","note":"awaiting first provider request"}'::jsonb),
    (_org, 'Monad testnet', 'chain', 'demo', 'connected', 'no RPC request executed yet',
      '{"capability":"chain","note":"awaiting first chain read"}'::jsonb);

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
$function$;



-- Bring existing rows onto the same labels, preserving any live diagnostic state
-- already recorded by a real provider or chain read.
update public.integration_connections set provider = 'Cleanverse A-Pass · CVI', kind = 'identity',
  config = coalesce(config, '{}'::jsonb) || '{"capability":"CVI","documented_api":"POST /query_apass"}'::jsonb
 where provider in ('Cleanverse CVI', 'Cleanverse A-Pass');

update public.integration_connections set provider = 'Cleanverse A-Token · CVA', kind = 'asset_scope',
  config = coalesce(config, '{}'::jsonb) || '{"capability":"CVA","documented_api":"POST /verify_apass, POST /atoken/rules"}'::jsonb
 where provider in ('Cleanverse CVA', 'Cleanverse A-Token');

update public.integration_connections set provider = 'Cleanverse Validator · CCP', kind = 'policy_scope',
  config = coalesce(config, '{}'::jsonb) || '{"capability":"CCP","documented_api":"POST /validator/verify"}'::jsonb
 where provider in ('Cleanverse CCP', 'Cleanverse Validator');

update public.integration_connections set provider = 'Monad testnet', kind = 'chain'
 where provider = 'Monad';
