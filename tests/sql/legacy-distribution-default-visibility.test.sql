-- B12-fix2: legacy content remains visible until the author makes an explicit choice.
-- Consent rows are created only by the synthetic users' own consent RPC calls.
-- All fixture data is rolled back at the end.

begin;

insert into auth.users (id) values
  ('44444444-4444-4444-8444-444444444444'),
  ('55555555-5555-4555-8555-555555555555'),
  ('66666666-6666-4666-8666-666666666666'),
  ('77777777-7777-4777-8777-777777777777'),
  ('88888888-8888-4888-8888-888888888888');

-- A/B/C are pre-cutoff profiles with no decision. D/E are created exactly at
-- their cutoff and therefore must not qualify as legacy profiles.
insert into public.profiles (
  id, username, created_at, legacy_distribution_cutoff_at, role
) values
  ('44444444-4444-4444-8444-444444444444', 'legacy_pending', now() - interval '10 minutes', now() - interval '5 minutes', 'user'),
  ('55555555-5555-4555-8555-555555555555', 'legacy_hidden', now() - interval '10 minutes', now() - interval '5 minutes', 'user'),
  ('66666666-6666-4666-8666-666666666666', 'legacy_profile_new_post', now() - interval '10 minutes', now() - interval '5 minutes', 'user'),
  ('77777777-7777-4777-8777-777777777777', 'fresh_profile', now(), now(), 'user'),
  ('88888888-8888-4888-8888-888888888888', 'legacy_test_admin', now(), now(), 'admin');

-- Seed only historical posts before the publication-consent guard. C has no
-- post yet: its attempted post below must be rejected with SQLSTATE 42501.
alter table public.posts disable trigger posts_require_distribution_consent;

insert into public.posts (id, user_id, title, type, status, created_at) values
  ('44444444-aaaa-4aaa-8aaa-444444444441', '44444444-4444-4444-8444-444444444444', 'Pending legacy post', 'creative', 'approved', now() - interval '10 minutes'),
  ('55555555-aaaa-4aaa-8aaa-555555555551', '55555555-5555-4555-8555-555555555555', 'Hidden legacy post', 'creative', 'approved', now() - interval '10 minutes');

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

  if exists (
    select 1
      from private.personal_data_consents
     where user_id in (
       '44444444-4444-4444-8444-444444444444',
       '55555555-5555-4555-8555-555555555555',
       '66666666-6666-4666-8666-666666666666',
       '77777777-7777-4777-8777-777777777777',
       '88888888-8888-4888-8888-888888888888'
     )
  ) then
    raise exception 'migration/test setup must not fabricate consent records';
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
    '66666666-6666-4666-8666-666666666666'
  )) <> 3 then
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

  perform public.increment_post_views('44444444-aaaa-4aaa-8aaa-444444444441');
  if (select views_count from public.posts where id = '44444444-aaaa-4aaa-8aaa-444444444441') <> 1 then
    raise exception 'pending legacy post must accept an anonymous view increment';
  end if;
end;
$pending_legacy_visible$;

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

-- A genuine user-scoped consent grant overrides the prior hidden legacy choice
-- for its own scope; this is a real test-user action through the public RPC.
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

do $real_consent_restores_visibility$
begin
  perform public.increment_post_views('55555555-aaaa-4aaa-8aaa-555555555551');
  if (select views_count from public.posts where id = '55555555-aaaa-4aaa-8aaa-555555555551') <> 1 then
    raise exception 'legacy post must accept anonymous view increments after real publication consent';
  end if;

  if (select count(*) from public.posts where id = '55555555-aaaa-4aaa-8aaa-555555555551') <> 1 then
    raise exception 'approved legacy post must be visible after a real publication consent';
  end if;

  if (select count(*) from public.profiles where id = '55555555-5555-4555-8555-555555555555') <> 1 then
    raise exception 'profile must be visible after a real profile_public consent';
  end if;

  if (select count(*) from public.profiles where id = '77777777-7777-4777-8777-777777777777') <> 0 then
    raise exception 'fresh profile without consent must remain hidden';
  end if;
end;
$real_consent_restores_visibility$;

reset role;

-- A genuinely new post after the cutoff still requires a publication consent.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '66666666-6666-4666-8666-666666666666', true);

do $new_post_requires_consent$
begin
  begin
    insert into public.posts (id, user_id, title, type, status)
    values (
      '66666666-aaaa-4aaa-8aaa-666666666661',
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
     where id = '66666666-aaaa-4aaa-8aaa-666666666661'
  ) then
    raise exception 'post rejected by the consent guard must not be stored';
  end if;
end;
$new_post_requires_consent$;

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

-- Only B's own explicit actions created consent records; no migration backfill.
do $no_consent_backfill$
begin
  if exists (
    select 1
      from private.personal_data_consents
     where user_id in (
       '44444444-4444-4444-8444-444444444444',
       '66666666-6666-4666-8666-666666666666',
       '77777777-7777-4777-8777-777777777777',
       '88888888-8888-4888-8888-888888888888'
     )
  ) then
    raise exception 'consent records were fabricated for users who took no consent action';
  end if;

  if (select count(*) from private.personal_data_consents
       where user_id = '55555555-5555-4555-8555-555555555555'
         and revoked_at is null) <> 2 then
    raise exception 'the only active consent rows must come from B explicit user RPC actions';
  end if;
end;
$no_consent_backfill$;

rollback;
