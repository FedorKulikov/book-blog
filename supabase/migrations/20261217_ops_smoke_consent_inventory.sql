-- 20261217_ops_smoke_consent_inventory.sql
--
-- Read-only, service-role-only PostgREST RPC used by the explicit production
-- smoke cleanup. The consent table remains private with no API-role schema or
-- table grants; this function returns only aggregate counts for supplied IDs.

begin;

create or replace function public.ops_smoke_consent_inventory(
  p_user_ids uuid[]
)
returns table (
  user_id uuid,
  total_count integer,
  active_count integer,
  revoked_count integer
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    c.user_id,
    pg_catalog.count(*)::integer as total_count,
    pg_catalog.count(*) filter (where c.revoked_at is null)::integer as active_count,
    pg_catalog.count(*) filter (where c.revoked_at is not null)::integer as revoked_count
  from private.personal_data_consents as c
  where c.user_id = any(coalesce(p_user_ids, '{}'::uuid[]))
  group by c.user_id;
$function$;

alter function public.ops_smoke_consent_inventory(uuid[]) owner to postgres;

comment on function public.ops_smoke_consent_inventory(uuid[]) is
  'Returns aggregate consent-history counts for supplied user IDs; EXECUTE is restricted to service_role for smoke cleanup inventory.';

revoke all on function public.ops_smoke_consent_inventory(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.ops_smoke_consent_inventory(uuid[])
  to service_role;

commit;
