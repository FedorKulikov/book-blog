-- Publication inserts require an active, user-scoped publication consent.
-- Two synthetic users verify no-session, no-consent, success, isolation and revoke.
-- All fixtures are rolled back.

begin;

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222');

do $privileges$
declare
  v_fn oid := 'public.enforce_post_distribution_consent()'::regprocedure;
  v_is_definer boolean;
  v_empty_path boolean;
  v_postgres_owner boolean;
begin
  if has_function_privilege('anon', v_fn, 'EXECUTE')
     or has_function_privilege('authenticated', v_fn, 'EXECUTE')
     or has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception 'trigger function must not be directly executable by API roles';
  end if;

  select p.prosecdef,
         coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']::text[],
         p.proowner = 'postgres'::regrole
    into v_is_definer, v_empty_path, v_postgres_owner
    from pg_catalog.pg_proc p
   where p.oid = v_fn;

  if not coalesce(v_is_definer, false)
     or not coalesce(v_empty_path, false)
     or not coalesce(v_postgres_owner, false) then
    raise exception 'post-consent trigger must be postgres-owned SECURITY DEFINER with empty search_path';
  end if;
end;
$privileges$;

set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);

do $no_session$
begin
  begin
    insert into public.posts (user_id, title, type)
    values ('11111111-1111-4111-8111-111111111111', 'Unauthenticated post', 'creative');
    raise exception 'a post was created without auth.uid()';
  exception
    when sqlstate '28000' then null;
  end;
end;
$no_session$;

select pg_catalog.set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $user_a$
declare
  v_rows integer;
begin
  -- A has no consent yet: the direct table INSERT must be rejected.
  begin
    insert into public.posts (user_id, title, type)
    values (auth.uid(), 'Post without consent', 'creative');
    raise exception 'user A created a post without consent';
  exception
    when sqlstate '42501' then null;
  end;

  -- The user-scoped RPC is the only supported way to record their grant.
  perform public.record_my_distribution_consent(
    'publication',
    array[
      'author_username',
      'author_avatar',
      'publication_title',
      'publication_text',
      'publication_images',
      'publication_tags',
      'linked_book',
      'news_metadata'
    ]::text[],
    '1.0'
  );

  insert into public.posts (user_id, title, type)
  values (auth.uid(), 'Post with consent', 'creative');

  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'post with active consent was not created';
  end if;

  -- User B must not benefit from user A's consent.
  perform pg_catalog.set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

  begin
    insert into public.posts (user_id, title, type)
    values (auth.uid(), 'User B without consent', 'creative');
    raise exception 'user B used user A publication consent';
  exception
    when sqlstate '42501' then null;
  end;

  -- Revoke A's own publication scope; subsequent inserts must fail.
  perform pg_catalog.set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
  perform public.revoke_my_distribution_consent('publication');

  begin
    insert into public.posts (user_id, title, type)
    values (auth.uid(), 'Post after revoke', 'creative');
    raise exception 'user A created a post after revoking consent';
  exception
    when sqlstate '42501' then null;
  end;
end;
$user_a$;

reset role;

do $stored_rows$
declare
  v_posts integer;
  v_consent_rows integer;
  v_active_rows integer;
  v_revoked_rows integer;
begin
  select count(*) into v_posts
    from public.posts
   where user_id = '11111111-1111-4111-8111-111111111111';

  select count(*),
         count(*) filter (where revoked_at is null),
         count(*) filter (where revoked_at is not null)
    into v_consent_rows, v_active_rows, v_revoked_rows
    from private.personal_data_consents
   where user_id = '11111111-1111-4111-8111-111111111111'
     and scope = 'publication';

  if v_posts <> 1 then
    raise exception 'expected exactly one successfully consented post, got %', v_posts;
  end if;
  if v_consent_rows <> 1 or v_active_rows <> 0 or v_revoked_rows <> 1 then
    raise exception 'expected one revoked consent audit row, got total %, active %, revoked %',
      v_consent_rows, v_active_rows, v_revoked_rows;
  end if;

  if exists (
    select 1 from private.personal_data_consents
     where user_id = '22222222-2222-4222-8222-222222222222'
  ) then
    raise exception 'user B unexpectedly received a consent row';
  end if;
end;
$stored_rows$;

rollback;
