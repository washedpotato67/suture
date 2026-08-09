-- Preserve the immutable policy context evaluated with each provider decision.

alter table public.cleanverse_decisions
  add column policy_version_label text,
  add column policy_hash text,
  add column scope_kind text check (scope_kind in ('atoken', 'validator_pool')),
  add column scope_chain text;
