-- PostgreSQL 17 tests for profile_public consent, owner isolation, and avatar storage.
-- Uses synthetic users only; every change is rolled back.

begin;

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333');

insert into public.profiles (id, username)
values
  ('11111111-1111-4111-8111-111111111111', 'profile_a'),
  ('22222222-2222-4222-8222-222222222222', 'profile_b');

do $permissions$
declare
  v_guard oid := 'public.enforce_profile_public_consent()'::regprocedure;
  v_has_consent oid := 'public.has_my_profile_public_consent()'::regprocedure;
  v_is_definer boolean;
  v_empty_path boolean;
  v_owner_postgres boolean;
begin
  if has_function_privilege('anon', v_guard, 'EXECUTE')
     or has_function_privilege('authenticated', v_guard, 'EXECUTE')
     or has_function_privilege('service_role', v_guard, 'EXECUTE') then
    raise exception 'profile trigger function must not be directly executable by API roles';
  end if;

  if has_function_privilege('anon', v_has_consent, 'EXECUTE')
     or not has_function_privilege('authenticated', v_has_consent, 'EXECUTE')
     or not has_function_privilege('service_role', v_has_consent, 'EXECUTE') then
    raise exception 'has_my_profile_public_consent grants are incorrect';
  end if;

  select p.prosecdef,
         coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']::text[],
         p.proowner = 'postgres'::regrole
    into v_is_definer, v_empty_path, v_owner_postgres
    from pg_catalog.pg_proc p
   where p.oid = v_guard;

  if not coalesce(v_is_definer, false)
     or not coalesce(v_empty_path, false)
     or not coalesce(v_owner_postgres, false) then
    raise exception 'profile guard must be postgres-owned SECURITY DEFINER with empty search_path';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.profiles'::regclass
       and tgname = 'profiles_require_public_distribution_consent'
       and not tgisinternal
       and (tgtype & 2) = 2 -- BEFORE
       and (tgtype & 16) = 16 -- UPDATE
       and (tgtype & 4) = 0 -- not INSERT
  ) then
    raise exception 'profile consent trigger must guard UPDATE only, not registration INSERT';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and policyname = 'avatars_owner_update'
  ) then
    raise exception 'legacy PUBLIC avatar update policy would bypass the consent check';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and policyname = 'avatars_insert_own'
       and with_check ilike '%has_my_profile_public_consent%'
  ) or not exists (
    select 1 from pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and policyname = 'avatars_update_own'
       and qual ilike '%has_my_profile_public_consent%'
       and with_check ilike '%has_my_profile_public_consent%'
  ) then
    raise exception 'avatar Storage INSERT/UPDATE policies do not require profile consent';
  end if;
end;
$permissions$;

-- Signup's profile INSERT path remains usable: the consent guard is UPDATE-only.
insert into public.profiles (id, username)
values ('33333333-3333-4333-8333-333333333333', 'profile_signup_without_consent');

-- User A starts without consent. Public-field UPDATE and public avatar upload fail.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);

do $no_session$
begin
  if public.has_my_profile_public_consent() then
    raise exception 'no-session helper unexpectedly reported an active consent';
  end if;
end;
$no_session$;

select pg_catalog.set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

do $user_a_without_consent$
declare
  v_count integer;
begin
  begin
    update public.profiles set bio = 'must be blocked' where id = auth.uid();
    raise exception 'user A changed a public profile field without consent';
  exception
    when sqlstate '42501' then null;
  end;

  -- Private notification settings must remain editable without profile consent.
  update public.profiles set notifications_muted = true where id = auth.uid();
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'private notifications setting update did not succeed';
  end if;

  begin
    insert into storage.objects (bucket_id, name)
    values ('avatars', auth.uid()::text || '/without-consent.jpg');
    raise exception 'user A uploaded a public avatar without consent';
  exception
    when sqlstate '42501' then null;
  end;

  if public.has_my_profile_public_consent() then
    raise exception 'user A unexpectedly has active profile consent before grant';
  end if;
end;
$user_a_without_consent$;

-- A gives a separate profile_public grant through the existing user-scoped RPC.
select public.record_my_distribution_consent(
  'profile_public',
  array[
    'profile_username',
    'profile_avatar',
    'profile_bio',
    'profile_joined_at'
  ]::text[],
  '1.1'
);

do $user_a_with_consent$
declare
  v_count integer;
  v_seen integer;
begin
  if not public.has_my_profile_public_consent() then
    raise exception 'user A profile consent was not recognized';
  end if;

  select count(*) into v_seen
    from public.my_distribution_consents()
   where scope = 'profile_public'
     and document_version = '1.1'
     and revoked_at is null;

  if v_seen <> 1 then
    raise exception 'user A cannot read their own active profile_public consent';
  end if;

  update public.profiles
     set username = 'profile_a_updated',
         bio = 'Public profile text after consent'
   where id = auth.uid();
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'user A could not change public fields with consent';
  end if;

  insert into storage.objects (bucket_id, name)
  values ('avatars', auth.uid()::text || '/with-consent.jpg');

  update storage.objects
     set name = auth.uid()::text || '/with-consent-replaced.jpg'
   where bucket_id = 'avatars'
     and name = auth.uid()::text || '/with-consent.jpg';
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'user A could not replace their own avatar with active consent';
  end if;
end;
$user_a_with_consent$;

-- User B cannot see or revoke A's consent, and cannot borrow it for their own
-- profile update or avatar upload.
select pg_catalog.set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

do $user_b$
declare
  v_seen integer;
  v_a_still_active integer;
begin
  select count(*) into v_seen
    from public.my_distribution_consents()
   where scope = 'profile_public';

  if v_seen <> 0 then
    raise exception 'user B can see user A profile consent';
  end if;

  perform public.revoke_my_distribution_consent('profile_public');

  begin
    update public.profiles set bio = 'B must be blocked' where id = auth.uid();
    raise exception 'user B changed their profile using user A consent';
  exception
    when sqlstate '42501' then null;
  end;

  begin
    insert into storage.objects (bucket_id, name)
    values ('avatars', auth.uid()::text || '/b-without-consent.jpg');
    raise exception 'user B uploaded an avatar without their own consent';
  exception
    when sqlstate '42501' then null;
  end;
end;
$user_b$;

reset role;

do $cross_user_assertion$
declare
  v_a_active integer;
  v_signup_count integer;
begin
  select count(*) into v_a_active
    from private.personal_data_consents
   where user_id = '11111111-1111-4111-8111-111111111111'
     and scope = 'profile_public'
     and revoked_at is null;

  if v_a_active <> 1 then
    raise exception 'user B revoked or changed user A profile consent';
  end if;

  select count(*) into v_signup_count
    from public.profiles
   where id = '33333333-3333-4333-8333-333333333333';

  if v_signup_count <> 1 then
    raise exception 'registration profile INSERT was blocked';
  end if;
end;
$cross_user_assertion$;

-- A revokes only their own profile_public scope. Public profile edits and
-- public avatar uploads must be blocked again, while private settings remain editable.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select public.revoke_my_distribution_consent('profile_public');

do $user_a_after_revoke$
begin
  if public.has_my_profile_public_consent() then
    raise exception 'profile consent remained active after revocation';
  end if;

  begin
    update public.profiles set bio = 'after revoke must be blocked' where id = auth.uid();
    raise exception 'public profile field changed after consent revocation';
  exception
    when sqlstate '42501' then null;
  end;

  update public.profiles set notifications_muted = false where id = auth.uid();

  begin
    insert into storage.objects (bucket_id, name)
    values ('avatars', auth.uid()::text || '/after-revoke.jpg');
    raise exception 'avatar upload succeeded after profile consent revocation';
  exception
    when sqlstate '42501' then null;
  end;
end;
$user_a_after_revoke$;

rollback;
