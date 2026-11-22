-- Authenticated, user-scoped entry points for distribution-consent records.
-- The user identity is derived exclusively from auth.uid(); there is no user_id argument.
-- The private table remains inaccessible directly to every API role.

begin;

create or replace function public.record_my_distribution_consent(
  p_scope text,
  p_data_categories text[],
  p_document_version text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_consent_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication is required to record distribution consent'
      using errcode = '28000';
  end if;

  if p_scope is null or p_scope not in ('profile_public', 'publication') then
    raise exception 'Unsupported distribution consent scope'
      using errcode = '22023';
  end if;

  if p_data_categories is null
     or pg_catalog.cardinality(p_data_categories) = 0
     or exists (
       select 1
         from pg_catalog.unnest(p_data_categories) as categories(category)
        where category is null or pg_catalog.btrim(category) = ''
     ) then
    raise exception 'At least one non-empty personal-data category is required'
      using errcode = '22023';
  end if;

  if p_document_version is null or pg_catalog.btrim(p_document_version) = '' then
    raise exception 'A distribution-consent document version is required'
      using errcode = '22023';
  end if;

  insert into private.personal_data_consents (
    user_id,
    scope,
    document_version,
    data_categories
  )
  values (
    v_user_id,
    p_scope,
    p_document_version,
    p_data_categories
  )
  returning id into v_consent_id;

  return v_consent_id;
end;
$function$;

create or replace function public.revoke_my_distribution_consent(
  p_scope text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication is required to revoke distribution consent'
      using errcode = '28000';
  end if;

  if p_scope is null or p_scope not in ('profile_public', 'publication') then
    raise exception 'Unsupported distribution consent scope'
      using errcode = '22023';
  end if;

  update private.personal_data_consents
     set revoked_at = pg_catalog.now()
   where user_id = v_user_id
     and scope = p_scope
     and revoked_at is null;
end;
$function$;

create or replace function public.my_distribution_consents()
returns table (
  scope text,
  document_version text,
  data_categories text[],
  granted_at timestamptz,
  revoked_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication is required to view distribution consents'
      using errcode = '28000';
  end if;

  return query
  select
    c.scope,
    c.document_version,
    c.data_categories,
    c.granted_at,
    c.revoked_at
  from private.personal_data_consents as c
  where c.user_id = v_user_id
  order by c.granted_at desc, c.id desc;
end;
$function$;

comment on function public.record_my_distribution_consent(text, text[], text) is
  'Records a distribution-consent grant for auth.uid() only. No user_id can be supplied by the caller.';

comment on function public.revoke_my_distribution_consent(text) is
  'Revokes active distribution-consent grants for auth.uid() and the supplied scope only.';

comment on function public.my_distribution_consents() is
  'Returns the distribution-consent history for auth.uid() only.';

-- PostgreSQL grants EXECUTE to PUBLIC by default. Remove inherited access,
-- then grant the narrow user-scoped functions only to authenticated/service_role.
revoke all on function public.record_my_distribution_consent(text, text[], text)
  from public, anon, authenticated, service_role;
revoke all on function public.revoke_my_distribution_consent(text)
  from public, anon, authenticated, service_role;
revoke all on function public.my_distribution_consents()
  from public, anon, authenticated, service_role;

grant execute on function public.record_my_distribution_consent(text, text[], text)
  to authenticated, service_role;
grant execute on function public.revoke_my_distribution_consent(text)
  to authenticated, service_role;
grant execute on function public.my_distribution_consents()
  to authenticated, service_role;

commit;
