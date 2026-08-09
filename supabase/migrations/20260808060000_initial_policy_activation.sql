-- New organizations receive a policy manifest and first immutable version in
-- one transaction. Mark that first effective version active without allowing
-- browser writes or changes to historical policy records.

create or replace function public.activate_initial_policy_version()
returns trigger language plpgsql set search_path = public as $$
begin
  update public.policy_manifests
  set active_policy_version_id = new.id
  where id = new.manifest_id
    and organization_id = new.organization_id
    and active_policy_version_id is null
    and new.effective_at <= now();
  return new;
end;
$$;

create trigger policy_versions_activate_initial
after insert on public.policy_versions
for each row execute function public.activate_initial_policy_version();

update public.policy_manifests manifest
set active_policy_version_id = candidate.id
from (
  select distinct on (manifest_id) manifest_id, id
  from public.policy_versions
  where effective_at <= now()
  order by manifest_id, activated_at desc, created_at desc
) candidate
where manifest.id = candidate.manifest_id
  and manifest.active_policy_version_id is null;
