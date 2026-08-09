#!/usr/bin/env bash
set -euo pipefail

# Resets the seeded demo scenario so the recovery loop can be rehearsed again.
#
# LOCAL DEVELOPMENT ONLY. This bypasses the append-only guards on
# remediation_actions, audit_receipts and audit_events by suppressing triggers
# for one session, which only a superuser can do. It exists so a demo can be run
# twice; it is deliberately a shell script against the local container and is
# NOT exposed as an RPC. Nothing in the product may rewrite audit history.
#
# Usage:
#   scripts/reset-demo.sh                 # reset, keep current provider scope
#   scripts/reset-demo.sh atoken          # reset and scope to the A-Token (PASS path)
#   scripts/reset-demo.sh validator_pool  # reset and scope to the validator pool (BLOCK path)

CONTAINER="${CONTAINER:-supabase_db_suture-v0-1}"
SCOPE="${1:-}"

ATOKEN_ADDRESS="${ATOKEN_ADDRESS:-0x215d8d76a16A0197CB576d984f68719BE7e69025}"
VALIDATOR_ADDRESS="${VALIDATOR_ADDRESS:-0x0cbaef799662f1df638b1ef1ae74ecb24fd9ba56}"

SCOPE_SQL=""
case "$SCOPE" in
  atoken)
    SCOPE_SQL="update public.cleanverse_asset_scopes set scope_kind='atoken', chain='base', scope_address='${ATOKEN_ADDRESS}';"
    ;;
  validator_pool)
    SCOPE_SQL="update public.cleanverse_asset_scopes set scope_kind='validator_pool', chain='base', scope_address='${VALIDATOR_ADDRESS}';"
    ;;
  "")
    ;;
  *)
    echo "unknown scope '$SCOPE' (use atoken or validator_pool)" >&2
    exit 1
    ;;
esac

docker exec -i "$CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 <<SQL
begin;
-- Suppress append-only triggers for this session only.
set local session_replication_role = replica;

delete from public.remediation_actions;
delete from public.audit_receipts;
delete from public.approval_records;
delete from public.audit_events where event_type like 'remediation%';

update public.remediation_plans
   set status = 'draft', approved_at = null, approved_by = null, executed_at = null;

update public.incidents
   set status = 'open', resolved_at = null;

${SCOPE_SQL}
commit;

select p.status as plan, i.status as incident,
       (select count(*) from public.audit_receipts) as receipts,
       (select scope_kind || ' · ' || chain from public.cleanverse_asset_scopes limit 1) as scope
  from public.remediation_plans p
  join public.incidents i on i.id = p.incident_id;
SQL

echo
echo "Demo scenario reset. Reload the console."
