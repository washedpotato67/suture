-- Live remediation executor: server-authoritative chain submission with
-- uncertain-state reconciliation and retained receipts.
--
-- These functions are the only path that may record an external execution.
-- They are callable by the service role only, which means the Edge Function
-- boundary, never a browser session. Execute is revoked from anon/authenticated.

-- Records intent BEFORE the transaction is broadcast. If the executor crashes
-- between this call and confirmation, the plan is left in a recoverable state
-- with the submission on record rather than silently lost.
create or replace function public.record_remediation_submission(
  _plan_id uuid,
  _action_key text,
  _chain_id integer,
  _tx_hash text,
  _detail jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  _plan public.remediation_plans%rowtype;
  _existing uuid;
  _action uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'live remediation submission requires the server executor role';
  end if;
  if char_length(trim(coalesce(_tx_hash, ''))) = 0 then raise exception 'transaction hash required'; end if;
  if char_length(trim(coalesce(_action_key, ''))) < 8 then raise exception 'action key too short'; end if;

  select * into _plan from public.remediation_plans where id = _plan_id for update;
  if _plan.id is null then raise exception 'remediation plan not found'; end if;

  -- Idempotent: a repeated submission returns the original action.
  select id into _existing from public.remediation_actions
   where plan_id = _plan_id and action_key = trim(_action_key);
  if _existing is not null then return _existing; end if;

  if _plan.status not in ('approved', 'executing', 'uncertain') then
    raise exception 'plan must be approved before execution (current: %)', _plan.status;
  end if;

  update public.remediation_plans set status = 'executing' where id = _plan_id;

  insert into public.remediation_actions(
    organization_id, plan_id, action_type, action_key, execution_mode, status,
    external_reference, evidence, payload
  ) values (
    _plan.organization_id, _plan_id, _plan.plan_type, trim(_action_key), 'external', 'submitted',
    trim(_tx_hash), 'asserted',
    jsonb_build_object('chain_id', _chain_id, 'tx_hash', trim(_tx_hash), 'submitted_at', now()) || coalesce(_detail, '{}'::jsonb)
  ) returning id into _action;

  insert into public.audit_events(organization_id, actor_id, event_type, subject_type, subject_id, payload)
  values (_plan.organization_id, null, 'remediation_submitted', 'remediation_plan', _plan_id,
    jsonb_build_object('chain_id', _chain_id, 'tx_hash', trim(_tx_hash), 'action_id', _action));
  return _action;
end;
$$;

-- Confirms a mined transaction and issues the audit receipt. The receipt hash
-- is computed over the payload, which carries the chain identifiers, so the
-- receipt is bound to a specific on-chain result rather than to a claim.
create or replace function public.confirm_remediation_submission(
  _plan_id uuid,
  _action_key text,
  _block_number bigint,
  _receipt jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  _plan public.remediation_plans%rowtype;
  _action public.remediation_actions%rowtype;
  _existing uuid;
  _receipt_id uuid;
  _payload jsonb;
  _executed_at timestamptz := now();
begin
  if auth.role() <> 'service_role' then
    raise exception 'live remediation confirmation requires the server executor role';
  end if;

  select * into _plan from public.remediation_plans where id = _plan_id for update;
  if _plan.id is null then raise exception 'remediation plan not found'; end if;
  select * into _action from public.remediation_actions
   where plan_id = _plan_id and action_key = trim(_action_key);
  if _action.id is null then raise exception 'no submission recorded for this action key'; end if;

  select id into _existing from public.audit_receipts where plan_id = _plan_id;
  if _existing is not null then return _existing; end if;

  update public.remediation_actions
     set status = 'confirmed', evidence = 'verified',
         payload = payload || jsonb_build_object('block_number', _block_number, 'confirmed_at', _executed_at, 'receipt', coalesce(_receipt, '{}'::jsonb))
   where id = _action.id;

  _payload := jsonb_build_object(
    'receipt_version', 3, 'action', _plan.plan_type, 'plan_id', _plan.id,
    'incident_id', _plan.incident_id, 'approved_by', _plan.approved_by,
    'approved_at', _plan.approved_at, 'executed_at', _executed_at,
    'demo', false, 'execution_mode', 'external', 'evidence_state', 'verified',
    'chain', _action.payload -> 'chain_id', 'tx_hash', _action.external_reference,
    'block_number', _block_number
  );

  insert into public.audit_receipts(organization_id, incident_id, plan_id, receipt_hash, payload, issued_by)
  values (_plan.organization_id, _plan.incident_id, _plan.id,
    encode(extensions.digest(_payload::text, 'sha256'), 'hex'), _payload, null)
  returning id into _receipt_id;

  update public.remediation_plans set status = 'resolved', executed_at = _executed_at where id = _plan_id;
  update public.incidents set status = 'resolved', resolved_at = _executed_at
   where id = _plan.incident_id and status <> 'resolved';

  insert into public.audit_events(organization_id, actor_id, event_type, subject_type, subject_id, payload)
  values (_plan.organization_id, null, 'remediation_confirmed', 'remediation_plan', _plan_id,
    jsonb_build_object('receipt_id', _receipt_id, 'tx_hash', _action.external_reference, 'block_number', _block_number));
  return _receipt_id;
end;
$$;

-- Records an indeterminate outcome. The plan is NOT resolved and no receipt is
-- issued; the transaction hash is retained so reconciliation can settle it.
create or replace function public.mark_remediation_uncertain(
  _plan_id uuid,
  _action_key text,
  _reason text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  _plan public.remediation_plans%rowtype;
  _action public.remediation_actions%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'live remediation reconciliation requires the server executor role';
  end if;

  select * into _plan from public.remediation_plans where id = _plan_id for update;
  if _plan.id is null then raise exception 'remediation plan not found'; end if;
  select * into _action from public.remediation_actions
   where plan_id = _plan_id and action_key = trim(_action_key);
  if _action.id is null then raise exception 'no submission recorded for this action key'; end if;

  update public.remediation_actions
     set status = 'uncertain',
         payload = payload || jsonb_build_object('uncertain_reason', _reason, 'uncertain_at', now())
   where id = _action.id;
  update public.remediation_plans set status = 'uncertain' where id = _plan_id;

  insert into public.audit_events(organization_id, actor_id, event_type, subject_type, subject_id, payload)
  values (_plan.organization_id, null, 'remediation_uncertain', 'remediation_plan', _plan_id,
    jsonb_build_object('tx_hash', _action.external_reference, 'reason', _reason));
  return _action.id;
end;
$$;

revoke execute on function public.record_remediation_submission(uuid, text, integer, text, jsonb) from anon, authenticated;
revoke execute on function public.confirm_remediation_submission(uuid, text, bigint, jsonb) from anon, authenticated;
revoke execute on function public.mark_remediation_uncertain(uuid, text, text) from anon, authenticated;
