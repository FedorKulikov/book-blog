-- Restricted PostgREST inventory RPC for smoke cleanup.
-- All fixture rows are rolled back.

begin;

insert into auth.users (id) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2');

insert into private.personal_data_consents (
  user_id, scope, document_version, data_categories, revoked_at
) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'publication', '1.0', array['title'], null),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'profile_public', '1.0', array['username'], now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'publication', '1.0', array['title'], null);

do $permissions$
declare
  v_function oid := 'public.ops_smoke_consent_inventory(uuid[])'::regprocedure;
  v_owner_is_postgres boolean;
  v_is_definer boolean;
  v_empty_search_path boolean;
begin
  select p.proowner = 'postgres'::regrole,
         p.prosecdef,
         coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']::text[]
    into v_owner_is_postgres, v_is_definer, v_empty_search_path
    from pg_catalog.pg_proc p
   where p.oid = v_function;

  if not coalesce(v_owner_is_postgres, false)
     or not coalesce(v_is_definer, false)
     or not coalesce(v_empty_search_path, false) then
    raise exception 'smoke consent inventory must be postgres-owned SECURITY DEFINER with an empty search_path';
  end if;

  if has_function_privilege('anon', v_function, 'EXECUTE')
     or has_function_privilege('authenticated', v_function, 'EXECUTE')
     or has_function_privilege('public', v_function, 'EXECUTE')
     or not has_function_privilege('service_role', v_function, 'EXECUTE') then
    raise exception 'smoke consent inventory EXECUTE grants are incorrect';
  end if;

  if has_schema_privilege('service_role', 'private', 'USAGE')
     or has_table_privilege('service_role', 'private.personal_data_consents', 'SELECT') then
    raise exception 'service_role must not gain direct access to private consent storage';
  end if;
end;
$permissions$;

set local role service_role;

do $inventory$
declare
  v_total integer;
  v_active integer;
  v_revoked integer;
begin
  select i.total_count, i.active_count, i.revoked_count
    into v_total, v_active, v_revoked
    from public.ops_smoke_consent_inventory(
      array['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1']::uuid[]
    ) as i;

  if v_total <> 2 or v_active <> 1 or v_revoked <> 1 then
    raise exception 'unexpected aggregate consent inventory: total %, active %, revoked %',
      v_total, v_active, v_revoked;
  end if;
end;
$inventory$;

reset role;

rollback;
