-- Consent-aware public visibility, private media, one-time legacy decision and revocation.
-- Synthetic users and storage metadata only; the transaction is rolled back.

begin;

insert into auth.users (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333');

insert into public.profiles (id, username, avatar_url)
values
  ('11111111-1111-4111-8111-111111111111', 'visibility_a', 'https://project.supabase.co/storage/v1/object/public/avatars/11111111-1111-4111-8111-111111111111/avatar.jpg'),
  ('22222222-2222-4222-8222-222222222222', 'visibility_b', 'https://project.supabase.co/storage/v1/object/public/avatars/22222222-2222-4222-8222-222222222222/avatar.jpg'),
  ('33333333-3333-4333-8333-333333333333', 'visibility_c', 'https://project.supabase.co/storage/v1/object/public/avatars/33333333-3333-4333-8333-333333333333/avatar.jpg');

-- Seed pre-existing legacy posts before the consent INSERT trigger is active.
alter table public.posts disable trigger posts_require_distribution_consent;

insert into public.posts (id, user_id, title, type, status) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '11111111-1111-4111-8111-111111111111', 'Legacy A', 'creative', 'approved'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '22222222-2222-4222-8222-222222222222', 'Legacy B', 'creative', 'approved'),
  ('cccccccc-cccc-4ccc-8ccc-ccccccccccc3', '33333333-3333-4333-8333-333333333333', 'New C', 'creative', 'approved');

update public.posts
   set created_at = (
     select legacy_distribution_cutoff_at + interval '1 second'
       from public.profiles
      where id = '33333333-3333-4333-8333-333333333333'
   )
 where id = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';

alter table public.posts enable trigger posts_require_distribution_consent;

insert into public.comments (id, post_id, user_id, text) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '11111111-1111-4111-8111-111111111111', 'A comment'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '22222222-2222-4222-8222-222222222222', 'B comment'),
  ('cccccccc-0000-4000-8000-000000000003', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3', '33333333-3333-4333-8333-333333333333', 'C comment');

insert into public.likes (id, post_id, user_id) values
  ('aaaaaaaa-0000-4000-8000-000000000011', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-0000-4000-8000-000000000022', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '22222222-2222-4222-8222-222222222222'),
  ('cccccccc-0000-4000-8000-000000000033', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3', '33333333-3333-4333-8333-333333333333');

insert into public.post_images (id, post_id, url) values
  ('aaaaaaaa-0000-4000-8000-000000000101', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'https://project.supabase.co/storage/v1/object/public/post-images/11111111-1111-4111-8111-111111111111/a.jpg'),
  ('bbbbbbbb-0000-4000-8000-000000000202', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', 'https://project.supabase.co/storage/v1/object/public/post-images/22222222-2222-4222-8222-222222222222/b.jpg'),
  ('cccccccc-0000-4000-8000-000000000303', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3', 'https://project.supabase.co/storage/v1/object/public/post-images/33333333-3333-4333-8333-333333333333/c.jpg');

insert into public.post_tags (id, post_id) values
  ('aaaaaaaa-0000-4000-8000-000000000111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'),
  ('bbbbbbbb-0000-4000-8000-000000000222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'),
  ('cccccccc-0000-4000-8000-000000000333', 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3');

insert into public.books (id, title, cover_url) values
  ('dddddddd-dddd-4ddd-8ddd-ddddddddddd4', 'Public cover', 'https://project.supabase.co/storage/v1/object/public/post-images/11111111-1111-4111-8111-111111111111/book-cover.jpg');

insert into storage.objects (bucket_id, name) values
  ('avatars', '11111111-1111-4111-8111-111111111111/avatar.jpg'),
  ('avatars', '22222222-2222-4222-8222-222222222222/avatar.jpg'),
  ('avatars', '33333333-3333-4333-8333-333333333333/avatar.jpg'),
  ('post-images', '11111111-1111-4111-8111-111111111111/a.jpg'),
  ('post-images', '22222222-2222-4222-8222-222222222222/b.jpg'),
  ('post-images', '33333333-3333-4333-8333-333333333333/c.jpg'),
  ('post-images', '11111111-1111-4111-8111-111111111111/book-cover.jpg');

insert into public.conversations (id, user1_id, user2_id) values
  ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee5', '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');

do $column_and_bucket_privileges$
begin
  if has_column_privilege('anon', 'public.profiles', 'legacy_distribution_prompted_at', 'SELECT')
     or has_column_privilege('authenticated', 'public.profiles', 'legacy_distribution_prompted_at', 'SELECT')
     or has_column_privilege('anon', 'public.profiles', 'legacy_distribution_prompted_at', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'legacy_distribution_prompted_at', 'UPDATE')
     or has_column_privilege('anon', 'public.profiles', 'legacy_distribution_cutoff_at', 'SELECT')
     or has_column_privilege('authenticated', 'public.profiles', 'legacy_distribution_cutoff_at', 'SELECT')
     or has_column_privilege('anon', 'public.profiles', 'legacy_distribution_cutoff_at', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'legacy_distribution_cutoff_at', 'UPDATE')
     or has_column_privilege('anon', 'public.profiles', 'legacy_distribution_choice', 'SELECT')
     or has_column_privilege('authenticated', 'public.profiles', 'legacy_distribution_choice', 'SELECT')
     or has_column_privilege('anon', 'public.profiles', 'legacy_distribution_choice', 'UPDATE')
     or has_column_privilege('authenticated', 'public.profiles', 'legacy_distribution_choice', 'UPDATE') then
    raise exception 'legacy prompt timestamp must not be directly selectable or updatable';
  end if;

  if (select public from storage.buckets where id = 'avatars')
     or (select public from storage.buckets where id = 'post-images') then
    raise exception 'avatars and post-images buckets must be private';
  end if;

  if has_schema_privilege('anon', 'private', 'USAGE') = false
     or has_table_privilege('anon', 'private.personal_data_consents', 'SELECT') then
    raise exception 'private helpers require schema usage but consent table must remain unreadable';
  end if;

  if has_function_privilege('anon', 'public.resolve_my_legacy_distribution_prompt(text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.resolve_my_legacy_distribution_prompt(text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.revoke_my_all_distribution_consents()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.revoke_my_all_distribution_consents()', 'EXECUTE') then
    raise exception 'user-scoped consent decision RPC grants are incorrect';
  end if;
end;
$column_and_bucket_privileges$;

-- No consent: guests see none of A or B, including child rows and storage media.
set local role anon;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
do $anonymous_without_consent$
declare
  v_profiles integer;
  v_posts integer;
  v_comments integer;
  v_likes integer;
  v_images integer;
  v_tags integer;
  v_avatar_objects integer;
  v_post_objects integer;
  v_book_covers integer;
begin
  select count(*) into v_profiles from public.profiles;
  select count(*) into v_posts from public.posts;
  select count(*) into v_comments from public.comments;
  select count(*) into v_likes from public.likes;
  select count(*) into v_images from public.post_images;
  select count(*) into v_tags from public.post_tags;
  select count(*) into v_avatar_objects from storage.objects where bucket_id = 'avatars';
  select count(*) into v_post_objects from storage.objects where bucket_id = 'post-images';
  select count(*) into v_book_covers
    from storage.objects o
   where o.bucket_id = 'post-images'
     and o.name = '11111111-1111-4111-8111-111111111111/book-cover.jpg';

  perform public.increment_post_views('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');

  if v_profiles <> 0 or v_posts <> 0 or v_comments <> 0 or v_likes <> 0
     or v_images <> 0 or v_tags <> 0 or v_avatar_objects <> 0 or v_post_objects <> 1
     or v_book_covers <> 1 then
    raise exception 'no-consent guest visibility mismatch: profiles %, posts %, comments %, likes %, images %, tags %, avatars %, post objects %, book covers %',
      v_profiles, v_posts, v_comments, v_likes, v_images, v_tags, v_avatar_objects, v_post_objects, v_book_covers;
  end if;
end;
$anonymous_without_consent$;

reset role;

-- User A remains able to see their own profile and draft/hidden material.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
do $owner_access$
declare
  v_own_profile integer;
  v_chat_peer_profile integer;
  v_unrelated_profile integer;
  v_posts integer;
  v_images integer;
begin
  select count(*) into v_own_profile
    from public.profiles
   where id = auth.uid();
  -- A and B have a conversation, so both may read the counterpart's profile.
  select count(*) into v_chat_peer_profile
    from public.profiles
   where id = '22222222-2222-4222-8222-222222222222';
  select count(*) into v_unrelated_profile
    from public.profiles
   where id = '33333333-3333-4333-8333-333333333333';
  select count(*) into v_posts from public.posts;
  select count(*) into v_images from public.post_images;

  if v_own_profile <> 1 or v_chat_peer_profile <> 1
     or v_unrelated_profile <> 0 or v_posts <> 1 or v_images <> 1 then
    raise exception 'owner/chat privacy mismatch: uid %, own profile %, chat peer %, unrelated %, posts %, images %',
      auth.uid(), v_own_profile, v_chat_peer_profile, v_unrelated_profile, v_posts, v_images;
  end if;

  if (select has_approved_posts from public.my_legacy_distribution_prompt_state()) is not true
     or (select already_prompted from public.my_legacy_distribution_prompt_state()) is not false then
    raise exception 'legacy prompt state is incorrect for an existing owner';
  end if;
end;
$owner_access$;

-- A post created after the profile's migration cutoff must not trigger a legacy prompt.
reset role;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
do $new_user_no_legacy_prompt$
declare
  v_state record;
begin
  select * into v_state from public.my_legacy_distribution_prompt_state();
  if v_state.has_approved_posts is not false
     or v_state.already_prompted
     or v_state.legacy_choice is not null then
    raise exception 'post created after profile cutoff was misclassified as legacy';
  end if;
end;
$new_user_no_legacy_prompt$;

-- A new publication consent can expose the post created after the cutoff.
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

reset role;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);

-- NULL is not a valid prompt choice and must not fall through to "hide".
do $null_decision$
begin
  begin
    perform public.resolve_my_legacy_distribution_prompt(null);
    raise exception 'null legacy decision unexpectedly succeeded';
  exception
    when sqlstate '22023' then null;
  end;

  if (select already_prompted from public.my_legacy_distribution_prompt_state()) then
    raise exception 'invalid legacy decision marked the prompt as handled';
  end if;
end;
$null_decision$;

-- User A grants both scopes for existing content through the one-time RPC.
select public.resolve_my_legacy_distribution_prompt('grant_existing');

do $grant_assertions$
declare
  v_state record;
begin
  select * into v_state from public.my_legacy_distribution_prompt_state();
  if not v_state.already_prompted
     or not v_state.profile_public_active
     or not v_state.publication_active then
    raise exception 'legacy grant did not activate both scopes and mark the prompt';
  end if;
  if not exists (
    select 1 from public.my_distribution_consents()
     where scope = 'profile_public'
       and document_version = '1.1'
       and revoked_at is null
  ) or not exists (
    select 1 from public.my_distribution_consents()
     where scope = 'publication'
       and document_version = '1.0'
       and revoked_at is null
  ) then
    raise exception 'legacy grant did not write both correctly versioned consent rows';
  end if;
end;
$grant_assertions$;

reset role;

-- Guests can now see A, but not B; book covers remain public catalog assets.
set local role anon;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
do $anonymous_with_consent$
begin
  perform public.increment_post_views('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
  if (select views_count from public.posts where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1') <> 1 then
    raise exception 'consented approved post view counter did not increment';
  end if;

  if (select count(*) from public.profiles) <> 1
     or (select count(*) from public.posts) <> 2
     or (select count(*) from public.comments) <> 2
     or (select count(*) from public.likes) <> 2
     or (select count(*) from public.post_images) <> 2
     or (select count(*) from public.post_tags) <> 2 then
    raise exception 'guest can see hidden rows or cannot see consented A/new C rows';
  end if;

  if (select count(*) from storage.objects where bucket_id = 'avatars') <> 1
     or (select count(*) from storage.objects where bucket_id = 'post-images') <> 3 then
    raise exception 'guest Storage visibility did not follow consent (post-images includes A, new C, and public book cover)';
  end if;

  if (select count(*) from public.posts where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2') <> 0 then
    raise exception 'legacy B post is visible without a legacy grant';
  end if;
end;
$anonymous_with_consent$;

reset role;

-- User B can see A's approved post because A explicitly granted publication
-- consent. B's consent RPC remains scoped to B and cannot revoke A's consent.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
do $conversation_boundary$
begin
  if (select count(*) from public.profiles where id='11111111-1111-4111-8111-111111111111') <> 1 then
    raise exception 'private chat participant lost access to the other chat profile';
  end if;
  if (select count(*) from public.posts where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1') <> 1 then
    raise exception 'user B cannot read A post after A explicitly granted publication consent';
  end if;
  if exists (
    select 1 from public.my_distribution_consents()
     where revoked_at is null
  ) then
    raise exception 'user B can read another users consent history through the scoped RPC';
  end if;
end;
$conversation_boundary$;

-- B grants and revokes only their own profile_public scope.
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
select public.revoke_my_distribution_consent('profile_public');

do $b_own_scope_revoke$
begin
  if (select count(*) from public.my_distribution_consents()) <> 1
     or not exists (
       select 1 from public.my_distribution_consents()
        where scope='profile_public' and revoked_at is not null
     )
     or exists (
       select 1 from public.my_distribution_consents()
        where scope='publication'
     ) then
    raise exception 'user B consent RPC returned another user history or failed to revoke B own scope';
  end if;
end;
$b_own_scope_revoke$;

-- B's revoke must not change A's publication grant.
reset role;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
do $user_scoped_revoke$
begin
  if not exists (
    select 1 from public.my_distribution_consents()
     where scope='publication' and revoked_at is null
  ) then
    raise exception 'user B revoked user A publication consent';
  end if;
end;
$user_scoped_revoke$;

reset role;
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);

-- User B chooses "hide my materials". It must be one-time and must not create grants.
select public.resolve_my_legacy_distribution_prompt('hide_existing');
do $hide_and_repeat$
declare
  v_state record;
  v_active_count integer;
  v_active_scopes text;
begin
  select * into v_state from public.my_legacy_distribution_prompt_state();
  if v_state.already_prompted is not true or v_state.legacy_choice is distinct from 'hidden' then
    raise exception 'hide decision did not record the one-time legacy choice: uid %, prompted %, choice %',
      auth.uid(), v_state.already_prompted, v_state.legacy_choice;
  end if;

  perform public.resolve_my_legacy_distribution_prompt('grant_existing');

  select count(*), pg_catalog.string_agg(scope, ', ' order by scope)
    into v_active_count, v_active_scopes
    from public.my_distribution_consents()
   where revoked_at is null;

  select * into v_state from public.my_legacy_distribution_prompt_state();

  if v_active_count <> 0
     or v_state.legacy_choice is distinct from 'hidden'
     or v_state.already_prompted is not true then
    raise exception 'repeat legacy decision changed B state: uid %, active count %, scopes %, prompted %, choice %, profile active %, publication active %',
      auth.uid(), v_active_count, v_active_scopes, v_state.already_prompted,
      v_state.legacy_choice, v_state.profile_public_active, v_state.publication_active;
  end if;

  -- A later grant for new posts must not change the one-time legacy choice.
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

  if (select legacy_choice from public.my_legacy_distribution_prompt_state()) <> 'hidden'
     or (select publication_active from public.my_legacy_distribution_prompt_state()) is not true then
    raise exception 'later publication consent overwrote the hidden legacy decision';
  end if;

  -- Revoking only the publication scope must also keep legacy rows hidden
  -- if a fresh publication consent is recorded later.
  perform public.revoke_my_distribution_consent('publication');
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

  if (select legacy_choice from public.my_legacy_distribution_prompt_state()) <> 'hidden'
     or (select publication_active from public.my_legacy_distribution_prompt_state()) is not true then
    raise exception 'scoped publication revoke allowed legacy material to be re-published';
  end if;
end;
$hide_and_repeat$;

reset role;
set local role anon;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
do $user_b_legacy_stays_hidden$
begin
  if (select count(*) from public.posts where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2') <> 0
     or (select count(*) from public.comments where post_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2') <> 0
     or (select count(*) from public.post_images where post_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2') <> 0
     or (select count(*) from storage.objects where bucket_id='post-images' and name='22222222-2222-4222-8222-222222222222/b.jpg') <> 0 then
    raise exception 'future publication consent re-published B legacy material after hide choice';
  end if;
end;
$user_b_legacy_stays_hidden$;

reset role;

-- User A revokes all active scopes; rows remain in the database for audit and
-- owner access, while anonymous access to their posts/profile/storage ends.
set local role authenticated;
select pg_catalog.set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select public.revoke_my_all_distribution_consents();

-- A later publication-only grant must not re-publish the pre-cutoff post.
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

do $owner_after_revoke$
begin
  perform public.increment_post_views('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
  if (select views_count from public.posts where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1') <> 1 then
    raise exception 'hidden post view counter changed after consent withdrawal';
  end if;

  if (select count(*) from public.profiles where id=auth.uid()) <> 1
     or (select count(*) from public.profiles where id='22222222-2222-4222-8222-222222222222') <> 1
     or (select count(*) from public.profiles where id='33333333-3333-4333-8333-333333333333') <> 0
     or (select count(*) from public.posts) <> 2
     or (select count(*) from public.posts where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2') <> 0
     or (select count(*) from public.post_images) <> 2 then
    raise exception 'revocation removed own data, hid new C, or exposed legacy B';
  end if;
  if exists (
    select 1 from public.my_distribution_consents()
     where scope = 'profile_public'
       and revoked_at is null
  ) then
    raise exception 'revoke-all wrapper left profile_public active';
  end if;

  if (select legacy_choice from public.my_legacy_distribution_prompt_state()) <> 'hidden'
     or (select publication_active from public.my_legacy_distribution_prompt_state()) is not true then
    raise exception 'later publication grant changed the legacy hide decision';
  end if;

  perform public.increment_post_views('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1');
  if (select views_count from public.posts where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1') <> 1 then
    raise exception 'a new publication grant exposed or counted the hidden legacy post';
  end if;
end;
$owner_after_revoke$;

reset role;
set local role anon;
select pg_catalog.set_config('request.jwt.claim.sub', '', true);
do $anonymous_after_revoke$
begin
  if (select count(*) from public.profiles) <> 0
     or (select count(*) from public.posts) <> 1
     or (select count(*) from public.comments) <> 1
     or (select count(*) from public.likes) <> 1
     or (select count(*) from public.post_images) <> 1
     or (select count(*) from public.post_tags) <> 1 then
    raise exception 'A and B legacy rows must stay hidden while new C remains visible';
  end if;
  if (select count(*) from storage.objects where bucket_id='avatars') <> 0
     or (select count(*) from storage.objects where bucket_id='post-images') <> 2 then
    raise exception 'A/B media remains available after revoke (only new C image and public book cover should remain)';
  end if;
end;
$anonymous_after_revoke$;

rollback;
