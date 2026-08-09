-- remediation_actions is append-only: `remediation_actions_append_only` rejects
-- UPDATE and DELETE. The first executor implementation mutated the submitted row
-- to record confirmation, which the trigger correctly refused.
--
-- Outcomes are now recorded as superseding rows keyed `confirm:` / `uncertain:`
-- against the original `execute:onchain:` submission. The submission row remains
-- exactly as written, so the audit trail shows what was believed at submission
-- time and what was later observed, rather than only the final answer.

create or replace function public.confirm_remediation_submission(
  _plan_id uuid,
  _action_key text,
  _block_number bigint,
  _receipt jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  _plan public.remediation_plans%rowtype;
  _submission public.remediation_actions%rowtype;
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
  select * into _submission from public.remediation_actions
   where plan_id = _plan_id and action_key = trim(_action_key);
  if _submission.id is null then raise exception 'no submission recorded for this action key'; end if;

  select id into _existing from public.audit_receipts where plan_id = _plan_id;
  if _existing is not null then return _existing; end if;

  -- Superseding record; the submission row is never rewritten.
  insert into public.remediation_actions(
    organization_id, plan_id, action_type, action_key, execution_mode, status,
    external_reference, evidence, payload
  ) values (
    _plan.organization_id, _plan_id, _plan.plan_type, 'confirm:' || trim(_action_key),
    'external', 'confirmed', _submission.external_reference, 'verified',
    jsonb_build_object(
      'supersedes', _submission.action_key,
      'block_number', _block_number,
      'confirmed_at', _executed_at,
      'receipt', coalesce(_receipt, '{}'::jsonb)
    )
  ) on conflict (plan_id, action_key) do nothing;

  _payload := jsonb_build_object(
    'receipt_version', 3, 'action', _plan.plan_type, 'plan_id', _plan.id,
    'incident_id', _plan.incident_id, 'approved_by', _plan.approved_by,
    'approved_at', _plan.approved_at, 'executed_at', _executed_at,
    'demo', false, 'execution_mode', 'external', 'evidence_state', 'verified',
    'chain_id', _submission.payload -> 'chain_id', 'tx_hash', _submission.external_reference,
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
    jsonb_build_object('receipt_id', _receipt_id, 'tx_hash', _submission.external_reference, 'block_number', _block_number));
  return _receipt_id;
end;
$$;

create or replace function public.mark_remediation_uncertain(
  _plan_id uuid,
  _action_key text,
  _reason text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  _plan public.remediation_plans%rowtype;
  _submission public.remediation_actions%rowtype;
  _action uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'live remediation reconciliation requires the server executor role';
  end if;

  select * into _plan from public.remediation_plans where id = _plan_id for update;
  if _plan.id is null then raise exception 'remediation plan not found'; end if;
  select * into _submission from public.remediation_actions
   where plan_id = _plan_id and action_key = trim(_action_key);
  if _submission.id is null then raise exception 'no submission recorded for this action key'; end if;

  insert into public.remediation_actions(
    organization_id, plan_id, action_type, action_key, execution_mode, status,
    external_reference, evidence, payload
  ) values (
    _plan.organization_id, _plan_id, _plan.plan_type, 'uncertain:' || trim(_action_key),
    'external', 'uncertain', _submission.external_reference, 'asserted',
    jsonb_build_object('supersedes', _submission.action_key, 'reason', _reason, 'observed_at', now())
  )
  on conflict (plan_id, action_key) do nothing
  returning id into _action;

  update public.remediation_plans set status = 'uncertain' where id = _plan_id;

  insert into public.audit_events(organization_id, actor_id, event_type, subject_type, subject_id, payload)
  values (_plan.organization_id, null, 'remediation_uncertain', 'remediation_plan', _plan_id,
    jsonb_build_object('tx_hash', _submission.external_reference, 'reason', _reason));
  return coalesce(_action, _submission.id);
end;
$$;

revoke execute on function public.confirm_remediation_submission(uuid, text, bigint, jsonb) from anon, authenticated;
revoke execute on function public.mark_remediation_uncertain(uuid, text, text) from anon, authenticated;
