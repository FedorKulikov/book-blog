-- B12-fix2: legacy content remains visible until the author makes an explicit choice.
-- Consent rows are created only by the synthetic users' own consent RPC calls.
-- All fixture data is rolled back at the end.

begin;

insert into auth.users (id) values
  ('44444444-4444-4444-8444-444444444444'),
  ('55555555-5555-4555-8555-555555555555'),
  ('66666666-6666-4666-8666-666666666666'),
  ('77777777-7777-4777-8777-777777777777'),
  ('88888888-8888-4888-8888-888888888888'),
  ('99999999-9999-4999-8999-999999999999'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

-- A/B/C/F are pre-cutoff profiles with no decision. D is created after its
-- cutoff and E exactly at its cutoff; neither qualifies as a legacy profile.
insert into public.profiles (
  id, username, created_at, legacy_distribution_cutoff_at, role
) values
  ('44444444-4444-4444-8444-444444444444', 'legacy_pending', now() - interval '10 minutes', now() - interval '5 minutes', 'user'),
  ('55555555-5555-4555-8555-555555555555', 'legacy_hidden', now() - interval '10 minutes', now() - interval '5 minutes', 'user'),
  ('66666666-6666-4666-8666-666666666666', 'legacy_profile_new_post', now() - interval '10 minutes', now() - interval '5 minutes', 'user'),
  ('99999999-9999-4999-8999-999999999999', 'legacy_profile_only_grant', now() - interval '10 minutes', now() - interval '5 minutes', 'user'),
  -- This profile was created after its migration cutoff; post defaults now()
  -- are therefore strictly post-cutoff and must pass the publication guard.
  ('77777777-7777-4777-8777-777777777777', 'fresh_profile', now(), now() - interval '1 second', 'user'),
  ('88888888-8888-4888-8888-888888888888', 'legacy_test_admin', now(), now(), 'admin'),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'legacy_restore_user', now() - interval '10 minutes', now() - interval '5 minutes', 'user');

-- Seed A/B legacy posts and C's post-cutoff publication before the guard.
-- D's later new-post attempt without consent must be rejected with SQLSTATE 42501.
alter table public.posts disable trigger posts_require_distribution_consent;

insert into public.posts (id, user_id, title, type, status, created_at) values
  ('44444444-aaaa-4aaa-8aaa-444444444441', '44444444-4444-4444-8444-444444444444', 'Pending legacy post', 'creative', 'approved', now() - interval '10 minutes'),
  ('55555555-aaaa-4aaa-8aaa-555555555551', '55555555-5555-4555-8555-555555555555', 'Hidden legacy post', 'creative', 'approved', now() - interval '10 minutes'),
  ('66666666-aaaa-4aaa-8aaa-666666666662', '66666666-6666-4666-8666-666666666666', 'Future publication C', 'creative', 'approved', now()),
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Restorable legacy post', 'creative', 'approved', now() - interval '10 minutes');

alter table public.posts enable trigger posts_require_distribution_consent;

do $fixture_integrity$
begin
  if exists (
    select 1
      from public.profiles p
     where p.id in (
       '44444444-4444-4444-8444-444444444444',
       '55555555-5555-4555-8555-555555555555',
       '66666666-6666-4666-8666-666666666666'
     )
       and not (p.created_at < p.legacy_distribution_cutoff_at)
  ) then
    raise exception 'legacy profile fixture must be before its cutoff';
  end if;

  if exists (
    select 1
      from public.posts post
      join public.profiles author on author.id = post.user_id
     where post.id in (
       '44444444-aaaa-4aaa-8aaa-444444444441',
       '55555555-aaaa-4aaa-8aaa-555555555551'
     )
       and not (post.created_at < author.legacy_distribution_cutoff_at)
  ) then
    raise exception 'legacy post fixture must be before its author cutoff';
  end if;

  if not exists (
    select 1
      from public.posts post
      join public.profiles author on author.id = post.user_id
     where post.id = '66666666-aaaa-4aaa-8aaa-666666666662'
       and post.created_at >= author.legacy_distribution_cutoff_at
  ) then
    raise exception 'C future post fixture must be at or after its author cutoff';
  end if;

  if exists (
    select 1
      from private.personal_data_consents
     where user_id in (
       '44444444-4444-4444-8444-444444444444',
       '55555555-5555-4555-8555-555555555555',
       '66666666-6666-4666-8666-666666666666',
       '77777777-7777-4777-8777-777777777777',
       '88888888-8888-4888-8888-888888888888',
       '99999999-9999-4999-8999-999999999999',
       'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
     )
  ) then
    raise exception 'migration/test setup must not fabricate consent records';
  end if;

  if not has_function_privilege('anon', 'private.can_read_distribution_profile(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'private.can_read_distribution_profile(uuid)', 'EXECUTE')
     or not has_function_privilege('anon', 'private.can_read_distribution_post(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'private.can_read_distribution_post(uuid)', 'EXECUTE') then
    raise exception 'public RLS policy predicates must be executable by anon and authenticated';
  end if;

  if has_function_privilege('anon', 'public.my_legacy_distribution_prompt_state()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.my_legacy_distribution_prompt_state()', 'EXECUTE') then
    raise exception 'legacy prompt state must remain authenticated-only';
  end if;

  if not has_function_privilege('anon', 'public.increment_post_views(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.increment_post_views(uuid)', 'EXECUTE') then
    raise exception 'public post view counter must remain executable by anon and authenticated';
  end if;
end;
$fixture_integrity$;

-- With no decision and no consent rows, pre-cutoff profiles and posts remain
-- visible. A profile exactly at its cutoff is not legacy.
set local role anon;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);

do $pending_legacy_visible$
begin
  if (select count(*) from public.profiles where id in (
    '44444444-4444-4444-8444-444444444444',
    '55555555-5555-4555-8555-555555555555',
    '66666666-6666-4666-8666-666666666666',
    '99999999-9999-4999-8999-999999999999'
  )) <> 4 then
    raise exception 'pre-cutoff profiles with NULL choice must be visible';
  end if;

  if (select count(*) from public.profiles where id = '77777777-7777-4777-8777-777777777777') <> 0 then
    raise exception 'profile created at the cutoff must not qualify as legacy';
  end if;

  if (select count(*) from public.posts where id in (
    '44444444-aaaa-4aaa-8aaa-444444444441',
    '55555555-aaaa-4aaa-8aaa-555555555551'
  )) <> 2 then
    raise exception 'pre-cutoff approved posts with NULL choice must be visible';
  end if;

  if (select count(*) from public.posts where id = '66666666-aaaa-4aaa-8aaa-666666666662') <> 0 then
    raise exception 'post-cutoff publication C must remain hidden without publication consent';
  end if;

  perform public.increment_post_views('44444444-aaaa-4aaa-8aaa-444444444441');
  if (select views_count from public.posts where id = '44444444-aaaa-4aaa-8aaa-444444444441') <> 1 then
    raise exception 'pending legacy post must accept an anonymous view increment';
  end if;
end;
$pending_legacy_visible$;

reset role;

-- A user can explicitly grant both scopes for an existing legacy profile and post.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
select public.resolve_my_legacy_distribution_prompt('grant_existing');

do $combined_legacy_grant$
begin
  if (select legacy_choice from public.my_legacy_distribution_prompt_state()) <> 'granted'
     or (select has_legacy_profile from public.my_legacy_distribution_prompt_state()) is not true
     or (select has_approved_posts from public.my_legacy_distribution_prompt_state()) is not true
     or (select count(*) from public.my_distribution_consents() where revoked_at is null) <> 2 then
    raise exception 'explicit legacy grant must enable both scopes and persist the granted decision';
  end if;
end;
$combined_legacy_grant$;

reset role;
set local role anon;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);

do $combined_legacy_grant_public$
begin
  if (select count(*) from public.posts where id = '44444444-aaaa-4aaa-8aaa-444444444441') <> 1
     or (select count(*) from public.profiles where id = '44444444-4444-4444-8444-444444444444') <> 1 then
    raise exception 'explicit legacy grant must expose its own legacy profile and approved post';
  end if;
end;
$combined_legacy_grant_public$;

reset role;

-- Profile-only legacy owners can resolve visibility without approved posts.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '66666666-6666-4666-8666-666666666666', true);
select public.record_my_distribution_consent(
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

do $profile_only_legacy_state$
begin
  if (select has_legacy_profile from public.my_legacy_distribution_prompt_state()) is not true
     or (select has_approved_posts from public.my_legacy_distribution_prompt_state()) is not false
     or (select already_prompted from public.my_legacy_distribution_prompt_state()) is not false then
    raise exception 'profile-only legacy user must receive a pending profile decision';
  end if;
end;
$profile_only_legacy_state$;

select public.resolve_my_legacy_distribution_prompt('hide_existing');

do $profile_only_hidden$
begin
  if (select legacy_choice from public.my_legacy_distribution_prompt_state()) <> 'hidden'
     or (select count(*) from public.my_distribution_consents()
          where scope = 'publication' and revoked_at is null) <> 1
     or exists (select 1 from public.my_distribution_consents()
                 where scope = 'profile_public') then
    raise exception 'profile-only hide must preserve unrelated publication consent and create no profile consent';
  end if;
end;
$profile_only_hidden$;

reset role;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '99999999-9999-4999-8999-999999999999', true);

do $profile_only_grant_state$
begin
  if (select has_legacy_profile from public.my_legacy_distribution_prompt_state()) is not true
     or (select has_approved_posts from public.my_legacy_distribution_prompt_state()) is not false then
    raise exception 'profile-only grant user must be identified as legacy profile without legacy posts';
  end if;
end;
$profile_only_grant_state$;

select public.resolve_my_legacy_distribution_prompt('grant_existing');

do $profile_only_grant_scope$
begin
  if (select count(*) from public.my_distribution_consents() where revoked_at is null) <> 1
     or not exists (
       select 1 from public.my_distribution_consents()
        where scope = 'profile_public' and revoked_at is null
     )
     or exists (
       select 1 from public.my_distribution_consents()
        where scope = 'publication' and revoked_at is null
     ) then
    raise exception 'profile-only grant must record profile_public only, not publication consent';
  end if;
end;
$profile_only_grant_scope$;

reset role;
set local role anon;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);

do $profile_only_public_results$
begin
  if (select count(*) from public.profiles where id = '66666666-6666-4666-8666-666666666666') <> 0
     or (select count(*) from public.profiles where id = '99999999-9999-4999-8999-999999999999') <> 1 then
    raise exception 'profile-only hide/grant decisions must produce the corresponding public visibility';
  end if;

  if (select count(*) from public.posts where id = '66666666-aaaa-4aaa-8aaa-666666666662') <> 1 then
    raise exception 'profile-only hide must preserve public access to an independently consented post-cutoff publication';
  end if;
end;
$profile_only_public_results$;

reset role;

-- The author makes the real one-time "hide" decision. No consent record is
-- inserted by this choice; the private state is only legacy_distribution_choice.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '55555555-5555-4555-8555-555555555555', true);
select public.resolve_my_legacy_distribution_prompt('hide_existing');

do $owner_after_hide$
begin
  if (select count(*) from public.profiles where id = auth.uid()) <> 1
     or (select count(*) from public.posts where id = '55555555-aaaa-4aaa-8aaa-555555555551') <> 1 then
    raise exception 'author must retain access to their own hidden legacy data';
  end if;

  if exists (select 1 from public.my_distribution_consents()) then
    raise exception 'hide decision must not create consent records';
  end if;
end;
$owner_after_hide$;

reset role;
set local role anon;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);

do $hidden_legacy_not_public$
begin
  perform public.increment_post_views('55555555-aaaa-4aaa-8aaa-555555555551');
  if (select views_count from public.posts where id = '55555555-aaaa-4aaa-8aaa-555555555551') <> 0 then
    raise exception 'hidden legacy post must not accept an anonymous view increment';
  end if;

  if (select count(*) from public.posts where id = '44444444-aaaa-4aaa-8aaa-444444444441') <> 1 then
    raise exception 'pending legacy post should remain visible';
  end if;

  if (select count(*) from public.posts where id = '55555555-aaaa-4aaa-8aaa-555555555551') <> 0 then
    raise exception 'legacy post must be hidden after choice = hidden';
  end if;

  if (select count(*) from public.profiles where id = '44444444-4444-4444-8444-444444444444') <> 1
     or (select count(*) from public.profiles where id = '55555555-5555-4555-8555-555555555555') <> 0 then
    raise exception 'profile visibility must follow pending vs hidden legacy choice';
  end if;
end;
$hidden_legacy_not_public$;

reset role;

-- A later user-scoped grant applies to future publications and the current profile,
-- but must not override the one-time hidden decision for pre-cutoff posts.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '55555555-5555-4555-8555-555555555555', true);
select public.record_my_distribution_consent(
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

insert into public.posts (id, user_id, title, type, status, created_at)
values (
  '55555555-aaaa-4aaa-8aaa-555555555552',
  auth.uid(),
  'Post after cutoff with fresh consent',
  'creative',
  'approved',
  now()
);

do $real_consent_recorded$
begin
  if (select count(*) from public.my_distribution_consents() where revoked_at is null) <> 2 then
    raise exception 'real consent RPC actions must create exactly two active scoped records';
  end if;

  if (select legacy_choice from public.my_legacy_distribution_prompt_state()) <> 'hidden' then
    raise exception 'granting consent must not rewrite the explicit legacy decision';
  end if;
end;
$real_consent_recorded$;

reset role;
set local role anon;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);

do $real_consent_preserves_legacy_hide$
begin
  perform public.increment_post_views('55555555-aaaa-4aaa-8aaa-555555555551');
  if (select views_count from public.posts where id = '55555555-aaaa-4aaa-8aaa-555555555551') <> 0 then
    raise exception 'later publication consent must not increment a post hidden by the legacy decision';
  end if;

  if (select count(*) from public.posts where id = '55555555-aaaa-4aaa-8aaa-555555555551') <> 0 then
    raise exception 'later publication consent must not re-publish a hidden legacy post';
  end if;

  if (select count(*) from public.posts where id = '55555555-aaaa-4aaa-8aaa-555555555552') <> 1 then
    raise exception 'active publication consent must expose a post created after the cutoff';
  end if;

  perform public.increment_post_views('55555555-aaaa-4aaa-8aaa-555555555552');
  if (select views_count from public.posts where id = '55555555-aaaa-4aaa-8aaa-555555555552') <> 1 then
    raise exception 'post-cutoff publication with active consent must accept anonymous view increments';
  end if;

  if (select count(*) from public.profiles where id = '55555555-5555-4555-8555-555555555555') <> 1 then
    raise exception 'profile must be visible after a real profile_public consent';
  end if;

  if (select count(*) from public.profiles where id = '77777777-7777-4777-8777-777777777777') <> 0 then
    raise exception 'fresh profile without consent must remain hidden';
  end if;
end;
$real_consent_preserves_legacy_hide$;

reset role;

-- A genuinely new post after the cutoff still requires a publication consent.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '77777777-7777-4777-8777-777777777777', true);

do $new_post_requires_consent$
begin
  begin
    insert into public.posts (id, user_id, title, type, status)
    values (
      '77777777-aaaa-4aaa-8aaa-777777777771',
      auth.uid(),
      'Post after cutoff without consent',
      'creative',
      'approved'
    );

    raise exception 'new post without publication consent unexpectedly succeeded'
      using errcode = 'P0001';
  exception
    when sqlstate '42501' then
      null;
  end;

  if exists (
    select 1 from public.posts
     where id = '77777777-aaaa-4aaa-8aaa-777777777771'
  ) then
    raise exception 'post rejected by the consent guard must not be stored';
  end if;
end;
$new_post_requires_consent$;

reset role;


-- A separate owner explicitly restores their hidden legacy materials.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select public.resolve_my_legacy_distribution_prompt('hide_existing');

do $restore_starts_hidden_without_consent$
begin
  if (select legacy_choice from public.my_legacy_distribution_prompt_state()) <> 'hidden'
     or exists (select 1 from public.my_distribution_consents()) then
    raise exception 'the explicit hide decision must not fabricate consent rows';
  end if;
end;
$restore_starts_hidden_without_consent$;

select public.restore_my_hidden_legacy_distribution();

do $restore_records_real_consent$
begin
  if (select legacy_choice from public.my_legacy_distribution_prompt_state()) <> 'granted'
     or (select already_prompted from public.my_legacy_distribution_prompt_state()) is not true
     or (select count(*) from public.my_distribution_consents() where revoked_at is null) <> 2
     or not exists (
       select 1 from public.my_distribution_consents()
        where scope = 'publication' and revoked_at is null
          and granted_at is not null and document_version = '1.0'
     )
     or not exists (
       select 1 from public.my_distribution_consents()
        where scope = 'profile_public' and revoked_at is null
          and granted_at is not null and document_version = '1.1'
     ) then
    raise exception 'restore must record timestamped publication and profile_public consent and set granted';
  end if;

  if (select legacy_distribution_prompted_at from public.profiles where id = auth.uid()) is null then
    raise exception 'restore must preserve the original decision timestamp';
  end if;
end;
$restore_records_real_consent$;

reset role;
set local role anon;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);

do $restored_legacy_visible_to_guest$
begin
  if (select count(*) from public.posts where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab') <> 1
     or (select count(*) from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') <> 1 then
    raise exception 'restored legacy publication and profile must be visible to a guest';
  end if;
end;
$restored_legacy_visible_to_guest$;

reset role;

-- Moderators and administrators retain their explicit staff access even when
-- the author's legacy choice is hidden.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '88888888-8888-4888-8888-888888888888', true);

do $staff_access$
begin
  if (select count(*) from public.profiles where id = '55555555-5555-4555-8555-555555555555') <> 1
     or (select count(*) from public.posts where id = '55555555-aaaa-4aaa-8aaa-555555555551') <> 1 then
    raise exception 'admin must retain access to hidden legacy profile and post';
  end if;
end;
$staff_access$;

reset role;

-- Only A/B's explicit grants, C's independent publication grant, and F's profile-only grant create fixture consent rows; no migration backfill.
do $no_consent_backfill$
begin
  if exists (
    select 1
      from private.personal_data_consents
     where user_id in (
       '77777777-7777-4777-8777-777777777777',
       '88888888-8888-4888-8888-888888888888'
     )
  ) then
    raise exception 'consent records were fabricated for users who took no consent action';
  end if;

  if (select count(*) from private.personal_data_consents
       where user_id = '44444444-4444-4444-8444-444444444444'
         and revoked_at is null) <> 2
     or not exists (
       select 1 from private.personal_data_consents
        where user_id = '44444444-4444-4444-8444-444444444444'
          and scope = 'profile_public' and revoked_at is null
     )
     or not exists (
       select 1 from private.personal_data_consents
        where user_id = '44444444-4444-4444-8444-444444444444'
          and scope = 'publication' and revoked_at is null
     ) then
    raise exception 'A explicit grant_existing action must create both legacy scopes';
  end if;

  if (select count(*) from private.personal_data_consents
       where user_id = '55555555-5555-4555-8555-555555555555'
         and revoked_at is null) <> 2 then
    raise exception 'B must have exactly two active rows from its own explicit user RPC actions';
  end if;

  if (select count(*) from private.personal_data_consents
       where user_id = '66666666-6666-4666-8666-666666666666'
         and revoked_at is null
         and scope = 'publication') <> 1
     or exists (
       select 1 from private.personal_data_consents
        where user_id = '66666666-6666-4666-8666-666666666666'
          and scope = 'profile_public'
     ) then
    raise exception 'profile-only hide must leave the independently granted publication scope active';
  end if;

  if (select count(*) from private.personal_data_consents
       where user_id = '99999999-9999-4999-8999-999999999999'
         and revoked_at is null
         and scope = 'profile_public') <> 1
     or exists (
       select 1 from private.personal_data_consents
        where user_id = '99999999-9999-4999-8999-999999999999'
          and scope = 'publication'
     ) then
    raise exception 'profile-only grant must create only its explicitly requested profile scope';
  end if;
end;
$no_consent_backfill$;

rollback;
