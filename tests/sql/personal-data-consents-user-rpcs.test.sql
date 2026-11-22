-- Authenticated RPC tests on clean PostgreSQL 17 with a Supabase auth.uid() fixture.
-- The test uses two synthetic users and rolls back every inserted row.

begin;

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

-- Seed a consent that belongs to user B. User A must never be able to revoke or read it.
insert into private.personal_data_consents (
  user_id, scope, document_version, data_categories
)
values (
  '22222222-2222-4222-8222-222222222222',
  'publication',
  'B_ONLY_VERSION',
  array['b_private_category']::text[]
);

do $permissions$
declare
  v_record oid := 'public.record_my_distribution_consent(text,text[],text)'::regprocedure;
  v_revoke oid := 'public.revoke_my_distribution_consent(text)'::regprocedure;
  v_list oid := 'public.my_distribution_consents()'::regprocedure;
  v_oid oid;
  v_is_definer boolean;
  v_has_empty_search_path boolean;
  v_owner_is_postgres boolean;
  v_arg_names text[];
begin
  if has_schema_privilege('anon', 'private', 'USAGE')
     or has_schema_privilege('authenticated', 'private', 'USAGE')
     or has_schema_privilege('service_role', 'private', 'USAGE') then
    raise exception 'an API role unexpectedly has USAGE on the private schema';
  end if;

  if has_table_privilege('anon', 'private.personal_data_consents', 'SELECT')
     or has_table_privilege('anon', 'private.personal_data_consents', 'INSERT')
     or has_table_privilege('anon', 'private.personal_data_consents', 'UPDATE')
     or has_table_privilege('anon', 'private.personal_data_consents', 'DELETE')
     or has_table_privilege('authenticated', 'private.personal_data_consents', 'SELECT')
     or has_table_privilege('authenticated', 'private.personal_data_consents', 'INSERT')
     or has_table_privilege('authenticated', 'private.personal_data_consents', 'UPDATE')
     or has_table_privilege('authenticated', 'private.personal_data_consents', 'DELETE')
     or has_table_privilege('service_role', 'private.personal_data_consents', 'SELECT')
     or has_table_privilege('service_role', 'private.personal_data_consents', 'INSERT')
     or has_table_privilege('service_role', 'private.personal_data_consents', 'UPDATE')
     or has_table_privilege('service_role', 'private.personal_data_consents', 'DELETE') then
    raise exception 'an API role unexpectedly has direct privileges on personal_data_consents';
  end if;

  if has_function_privilege('anon', v_record, 'EXECUTE')
     or has_function_privilege('anon', v_revoke, 'EXECUTE')
     or has_function_privilege('anon', v_list, 'EXECUTE') then
    raise exception 'anon or PUBLIC unexpectedly has EXECUTE on a user-scoped RPC';
  end if;

  if not has_function_privilege('authenticated', v_record, 'EXECUTE')
     or not has_function_privilege('authenticated', v_revoke, 'EXECUTE')
     or not has_function_privilege('authenticated', v_list, 'EXECUTE')
     or not has_function_privilege('service_role', v_record, 'EXECUTE')
     or not has_function_privilege('service_role', v_revoke, 'EXECUTE')
     or not has_function_privilege('service_role', v_list, 'EXECUTE') then
    raise exception 'authenticated/service_role EXECUTE grants are incomplete';
  end if;

  foreach v_oid in array array[v_record, v_revoke, v_list] loop
    select p.prosecdef,
           coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']::text[],
           p.proowner = 'postgres'::regrole
      into v_is_definer, v_has_empty_search_path, v_owner_is_postgres
      from pg_catalog.pg_proc p
     where p.oid = v_oid;

    if not coalesce(v_is_definer, false)
       or not coalesce(v_has_empty_search_path, false)
       or not coalesce(v_owner_is_postgres, false) then
      raise exception 'user-scoped RPC % must be postgres-owned SECURITY DEFINER with empty search_path', v_oid::regprocedure;
    end if;
  end loop;

  select p.proargnames
    into v_arg_names
    from pg_catalog.pg_proc p
   where p.oid = v_record;

  if v_arg_names <> array['p_scope', 'p_data_categories', 'p_document_version']::text[] then
    raise exception 'record_my_distribution_consent must not accept a user_id parameter; got %', v_arg_names;
  end if;

  if (select p.provolatile from pg_catalog.pg_proc p where p.oid = v_list) <> 's' then
    raise exception 'my_distribution_consents must be STABLE';
  end if;

  if pg_catalog.pg_get_function_result(v_list) <>
     'TABLE(scope text, document_version text, data_categories text[], granted_at timestamp with time zone, revoked_at timestamp with time zone)' then
    raise exception 'my_distribution_consents has an unexpected return signature: %',
      pg_catalog.pg_get_function_result(v_list);
  end if;
end;
$permissions$;

-- Missing auth.uid() must fail closed with SQLSTATE 28000 for all three RPCs.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);

do $no_session$
begin
  begin
    perform public.record_my_distribution_consent(
      'publication', array['title']::text[], '1.0'
    );
    raise exception 'record_my_distribution_consent accepted a missing session';
  exception
    when sqlstate '28000' then null;
  end;

  begin
    perform public.revoke_my_distribution_consent('publication');
    raise exception 'revoke_my_distribution_consent accepted a missing session';
  exception
    when sqlstate '28000' then null;
  end;

  begin
    perform * from public.my_distribution_consents();
    raise exception 'my_distribution_consents accepted a missing session';
  exception
    when sqlstate '28000' then null;
  end;
end;
$no_session$;

reset role;

do $no_session_assertion$
declare
  v_count integer;
begin
  select count(*) into v_count from private.personal_data_consents;
  if v_count <> 1 then
    raise exception 'an unauthenticated RPC unexpectedly wrote a consent row';
  end if;
end;
$no_session_assertion$;

-- Switch the JWT claim to user A. The function has no user_id parameter and
-- derives the sole owner from auth.uid().
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $user_a$
declare
  v_publication_id uuid;
  v_profile_id uuid;
  v_count integer;
  v_b_visible integer;
begin
  begin
    perform public.record_my_distribution_consent(
      'unsupported_scope', array['title']::text[], '1.0'
    );
    raise exception 'record_my_distribution_consent accepted an unsupported scope';
  exception
    when sqlstate '22023' then null;
  end;

  begin
    perform public.record_my_distribution_consent(
      'publication', array[]::text[], '1.0'
    );
    raise exception 'record_my_distribution_consent accepted empty categories';
  exception
    when sqlstate '22023' then null;
  end;

  begin
    perform public.record_my_distribution_consent(
      'publication', array['title', '   ']::text[], '1.0'
    );
    raise exception 'record_my_distribution_consent accepted an empty category item';
  exception
    when sqlstate '22023' then null;
  end;

  v_publication_id := public.record_my_distribution_consent(
    'publication',
    array['title', 'content', 'images']::text[],
    'A_PUBLICATION_V1'
  );

  v_profile_id := public.record_my_distribution_consent(
    'profile_public',
    array['username', 'avatar']::text[],
    'A_PROFILE_V1'
  );

  if v_publication_id is null or v_profile_id is null then
    raise exception 'record_my_distribution_consent did not return UUIDs';
  end if;

  perform pg_catalog.set_config('b12.user_a.publication_id', v_publication_id::text, true);
  perform pg_catalog.set_config('b12.user_a.profile_id', v_profile_id::text, true);

  select count(*) into v_count from public.my_distribution_consents();
  if v_count <> 2 then
    raise exception 'user A should see exactly two own rows; got %', v_count;
  end if;

  select count(*) into v_b_visible
    from public.my_distribution_consents()
   where document_version = 'B_ONLY_VERSION';

  if v_b_visible <> 0 then
    raise exception 'user A can read a consent belonging to user B';
  end if;

  if exists (
    select 1
      from private.personal_data_consents
     where id in (v_publication_id, v_profile_id)
       and user_id <> auth.uid()
  ) then
    raise exception 'user A recorded a consent under a different user id';
  end if;

  begin
    perform public.revoke_my_distribution_consent('unsupported_scope');
    raise exception 'revoke_my_distribution_consent accepted an unsupported scope';
  exception
    when sqlstate '22023' then null;
  end;

  perform public.revoke_my_distribution_consent('publication');
  perform public.revoke_my_distribution_consent('publication');
end;
$user_a$;

reset role;

-- The current user may revoke only their own active rows in the same scope.
do $ownership_assertions$
declare
  v_a_publication_id uuid := pg_catalog.current_setting('b12.user_a.publication_id')::uuid;
  v_a_profile_id uuid := pg_catalog.current_setting('b12.user_a.profile_id')::uuid;
  v_a_publication_revoked timestamptz;
  v_a_profile_revoked timestamptz;
  v_b_revoked timestamptz;
begin
  select revoked_at into v_a_publication_revoked
    from private.personal_data_consents where id = v_a_publication_id;
  select revoked_at into v_a_profile_revoked
    from private.personal_data_consents where id = v_a_profile_id;
  select revoked_at into v_b_revoked
    from private.personal_data_consents where document_version = 'B_ONLY_VERSION';

  if v_a_publication_revoked is null then
    raise exception 'user A could not revoke their own publication consent';
  end if;
  if v_a_profile_revoked is not null then
    raise exception 'revoking publication consent also revoked user A profile consent';
  end if;
  if v_b_revoked is not null then
    raise exception 'user A revoked user B publication consent';
  end if;
end;
$ownership_assertions$;

rollback;
