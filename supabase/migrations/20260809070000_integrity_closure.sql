-- Close trust-boundary gaps found during the pre-submission security review.

create unique index cleanverse_webhook_deliveries_request_id_unique
  on public.cleanverse_webhook_deliveries(request_id)
  where request_id is not null;

create unique index cleanverse_webhook_deliveries_payload_digest_unique
  on public.cleanverse_webhook_deliveries(payload_digest);

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
  if _evidence <> 'asserted' then raise exception 'lineage observations are asserted until a trusted attestation bridge is available'; end if;
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
    'asserted', trim(_idempotency_key)
  ) returning id into _edge;
  insert into public.audit_events(organization_id, actor_id, event_type, subject_type, subject_id, payload)
  values (_org, _user, 'lineage_recorded', 'lineage_edge', _edge,
    jsonb_build_object('transaction_reference', trim(_transaction_reference), 'idempotency_key', trim(_idempotency_key), 'evidence', 'asserted'));
  return _edge;
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
  if _evidence <> 'asserted' then raise exception 'impact snapshots are asserted until independently verified evidence is attached'; end if;
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
    _affected_position_count, _affected_value_usd, 'asserted', _user
  ) returning id into _snapshot;
  insert into public.audit_events(organization_id, actor_id, event_type, subject_type, subject_id, payload)
  values (_org, _user, 'impact_snapshot_created', 'impact_snapshot', _snapshot,
    jsonb_build_object('incident_id', _incident_id, 'evidence', 'asserted'));
  return _snapshot;
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
  if not public.is_organization_admin(_plan.organization_id, _user) then raise exception 'only an owner or issuer administrator may execute remediation'; end if;
  select id into _existing_receipt from public.audit_receipts where plan_id = _plan_id;
  if _existing_receipt is not null then return _existing_receipt; end if;
  if _plan.status <> 'approved' then raise exception 'plan must be approved before execution (current: %)', _plan.status; end if;
  if not _plan.is_demo then raise exception 'live remediation execution is not configured; no external action was attempted'; end if;

  update public.remediation_plans set status = 'executing' where id = _plan_id;
  select address into _source_address from public.wallets where id = _plan.source_wallet_id;
  select address into _replacement_address from public.wallets where id = _plan.replacement_wallet_id;
  _payload := jsonb_build_object(
    'receipt_version', 2, 'action', _plan.plan_type, 'plan_id', _plan.id,
    'incident_id', _plan.incident_id, 'source_wallet', _source_address,
    'replacement_wallet', _replacement_address, 'approved_by', _plan.approved_by,
    'approved_at', _plan.approved_at, 'executed_at', _executed_at, 'demo', true,
    'execution_mode', 'simulated', 'evidence_state', 'asserted'
  );
  insert into public.remediation_actions(
    organization_id, plan_id, action_type, action_key, execution_mode, status,
    evidence, payload, created_by
  ) values (
    _plan.organization_id, _plan.id, _plan.plan_type, 'execute:' || _plan.idempotency_key,
    'simulated', 'simulated', 'asserted', _payload, _user
  ) returning id into _action;
  insert into public.audit_receipts(organization_id, incident_id, plan_id, receipt_hash, payload, issued_by)
  values (_plan.organization_id, _plan.incident_id, _plan.id,
    encode(extensions.digest(_payload::text, 'sha256'), 'hex'), _payload, _user)
  returning id into _receipt;
  update public.remediation_plans set status = 'resolved', executed_at = _executed_at where id = _plan_id;
  update public.incidents set status = 'resolved', resolved_at = _executed_at
  where id = _plan.incident_id and status <> 'resolved';
  insert into public.audit_events(organization_id, actor_id, event_type, subject_type, subject_id, payload)
  values (_plan.organization_id, _user, 'remediation_simulated', 'remediation_plan', _plan.id,
    jsonb_build_object('receipt_id', _receipt, 'action_id', _action));
  return _receipt;
end;
$$;
