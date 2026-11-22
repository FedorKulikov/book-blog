-- Runs against a clean ephemeral PostgreSQL 17 database in GitHub Actions.
-- No production data or Supabase project is used.

begin;

insert into auth.users (id)
values ('11111111-1111-4111-8111-111111111111');

do $permissions$
declare
  v_record_fn oid := 'public.record_distribution_consent(uuid,text,text[],text)'::regprocedure;
  v_revoke_fn oid := 'public.revoke_distribution_consent(uuid,text)'::regprocedure;
  v_is_definer boolean;
  v_has_empty_search_path boolean;
begin
  if has_schema_privilege('anon', 'private', 'USAGE')
     or has_schema_privilege('authenticated', 'private', 'USAGE') then
    raise exception 'anon/authenticated unexpectedly have USAGE on private schema';
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

  if has_function_privilege('anon', v_record_fn, 'EXECUTE')
     or has_function_privilege('authenticated', v_record_fn, 'EXECUTE')
     or not has_function_privilege('service_role', v_record_fn, 'EXECUTE') then
    raise exception 'record_distribution_consent EXECUTE grants are incorrect';
  end if;

  if has_function_privilege('anon', v_revoke_fn, 'EXECUTE')
     or has_function_privilege('authenticated', v_revoke_fn, 'EXECUTE')
     or not has_function_privilege('service_role', v_revoke_fn, 'EXECUTE') then
    raise exception 'revoke_distribution_consent EXECUTE grants are incorrect';
  end if;

  select p.prosecdef,
         coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']::text[]
    into v_is_definer, v_has_empty_search_path
    from pg_catalog.pg_proc p
   where p.oid = v_record_fn;

  if not coalesce(v_is_definer, false) or not coalesce(v_has_empty_search_path, false) then
    raise exception 'record_distribution_consent must be SECURITY DEFINER with an empty search_path';
  end if;

  select p.prosecdef,
         coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']::text[]
    into v_is_definer, v_has_empty_search_path
    from pg_catalog.pg_proc p
   where p.oid = v_revoke_fn;

  if not coalesce(v_is_definer, false) or not coalesce(v_has_empty_search_path, false) then
    raise exception 'revoke_distribution_consent must be SECURITY DEFINER with an empty search_path';
  end if;

  if pg_catalog.to_regclass('private.personal_data_consents_user_scope_idx') is null then
    raise exception 'required (user_id, scope) index is missing';
  end if;
end;
$permissions$;

-- The server role has no direct table access, but can use the two narrow RPCs.
set local role service_role;

do $record$
declare
  v_user_id constant uuid := '11111111-1111-4111-8111-111111111111';
  v_publication_id uuid;
  v_profile_id uuid;
begin
  begin
    perform public.revoke_distribution_consent(v_user_id, 'unsupported_scope');
    raise exception 'revoke_distribution_consent accepted an unsupported scope';
  exception
    when sqlstate '22023' then
      null;
  end;

  v_publication_id := public.record_distribution_consent(
    v_user_id,
    'publication',
    array['title', 'body', 'attachments']::text[],
    '1.0'
  );

  v_profile_id := public.record_distribution_consent(
    v_user_id,
    'profile_public',
    array['username', 'avatar', 'description', 'city']::text[],
    '1.0'
  );

  if v_publication_id is null or v_profile_id is null then
    raise exception 'record_distribution_consent did not return UUIDs';
  end if;

  perform pg_catalog.set_config('b12.consent.publication_id', v_publication_id::text, true);
  perform pg_catalog.set_config('b12.consent.profile_id', v_profile_id::text, true);

  -- A SECURITY DEFINER function works while the caller has no schema/table grants.
  begin
    execute 'select count(*) from private.personal_data_consents';
    raise exception 'service_role unexpectedly read the private table directly';
  exception
    when insufficient_privilege then
      null;
  end;
end;
$record$;

reset role;

do $record_assertions$
declare
  v_publication_id uuid := pg_catalog.current_setting('b12.consent.publication_id')::uuid;
  v_profile_id uuid := pg_catalog.current_setting('b12.consent.profile_id')::uuid;
  v_scope text;
  v_version text;
  v_categories text[];
  v_granted_at timestamptz;
  v_revoked_at timestamptz;
begin
  select scope, document_version, data_categories, granted_at, revoked_at
    into v_scope, v_version, v_categories, v_granted_at, v_revoked_at
    from private.personal_data_consents
   where id = v_publication_id;

  if not found
     or v_scope <> 'publication'
     or v_version <> '1.0'
     or v_categories <> array['title', 'body', 'attachments']::text[]
     or v_granted_at is null
     or v_revoked_at is not null then
    raise exception 'publication consent was not recorded with the expected values';
  end if;

  select scope, document_version, data_categories, granted_at, revoked_at
    into v_scope, v_version, v_categories, v_granted_at, v_revoked_at
    from private.personal_data_consents
   where id = v_profile_id;

  if not found
     or v_scope <> 'profile_public'
     or v_version <> '1.0'
     or v_categories <> array['username', 'avatar', 'description', 'city']::text[]
     or v_granted_at is null
     or v_revoked_at is not null then
    raise exception 'profile_public consent was not recorded with the expected values';
  end if;
end;
$record_assertions$;

-- Revoking one scope must not revoke the other. Repeating the same revoke
-- must be harmless and must leave the original revocation timestamp intact.
set local role service_role;

select public.revoke_distribution_consent(
  '11111111-1111-4111-8111-111111111111',
  'publication'
);
select public.revoke_distribution_consent(
  '11111111-1111-4111-8111-111111111111',
  'publication'
);

reset role;

do $publication_revoked$
declare
  v_publication_id uuid := pg_catalog.current_setting('b12.consent.publication_id')::uuid;
  v_profile_id uuid := pg_catalog.current_setting('b12.consent.profile_id')::uuid;
  v_publication_revoked_at timestamptz;
  v_profile_revoked_at timestamptz;
begin
  select revoked_at into v_publication_revoked_at
    from private.personal_data_consents where id = v_publication_id;
  select revoked_at into v_profile_revoked_at
    from private.personal_data_consents where id = v_profile_id;

  if v_publication_revoked_at is null then
    raise exception 'publication consent was not revoked';
  end if;
  if v_profile_revoked_at is not null then
    raise exception 'revoking publication consent also revoked profile consent';
  end if;
end;
$publication_revoked$;

set local role service_role;
select public.revoke_distribution_consent(
  '11111111-1111-4111-8111-111111111111',
  'profile_public'
);
reset role;

do $all_revoked$
declare
  v_active_count integer;
begin
  select count(*) into v_active_count
    from private.personal_data_consents
   where user_id = '11111111-1111-4111-8111-111111111111'
     and revoked_at is null;

  if v_active_count <> 0 then
    raise exception 'revoking profile_public did not revoke all remaining active consent rows';
  end if;
end;
$all_revoked$;

rollback;
