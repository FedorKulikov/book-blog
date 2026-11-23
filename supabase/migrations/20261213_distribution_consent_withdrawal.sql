-- Enforce withdrawal of public distribution consent at the database and Storage layers.
-- Existing rows and objects are retained; only anonymous/public visibility changes.
-- The original public bucket URLs stop working when these buckets become private.
begin;

alter table public.profiles
  add column if not exists legacy_distribution_prompted_at timestamptz;

create schema if not exists private;

create or replace function private.has_active_distribution_consent(
  p_user_id uuid,
  p_scope text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_user_id is not null
     and p_scope in ('profile_public', 'publication')
     and exists (
       select 1
         from private.personal_data_consents c
        where c.user_id = p_user_id
          and c.scope = p_scope
          and c.revoked_at is null
     );
$function$;

revoke all on function private.has_active_distribution_consent(uuid, text)
  from public, anon, authenticated, service_role;

create or replace function private.current_user_is_distribution_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid() is not null
     and exists (
       select 1
         from public.profiles p
        where p.id = auth.uid()
          and p.role in ('admin', 'moderator')
     );
$function$;

revoke all on function private.current_user_is_distribution_staff()
  from public, anon, authenticated, service_role;

create or replace function private.can_read_distribution_profile(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_profile_id is not null
     and (
       p_profile_id = auth.uid()
       or private.current_user_is_distribution_staff()
       or private.has_active_distribution_consent(p_profile_id, 'profile_public')
       or exists (
         select 1
           from public.conversations c
          where auth.uid() is not null
            and (
              (c.user1_id = auth.uid() and c.user2_id = p_profile_id)
              or (c.user2_id = auth.uid() and c.user1_id = p_profile_id)
            )
       )
     );
$function$;

revoke all on function private.can_read_distribution_profile(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.can_read_distribution_profile(uuid)
  to anon, authenticated;

create or replace function private.can_read_distribution_post(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
      from public.posts p
     where p.id = p_post_id
       and (
         p.user_id = auth.uid()
         or private.current_user_is_distribution_staff()
         or (
           p.status = 'approved'
           and private.has_active_distribution_consent(p.user_id, 'publication')
         )
       )
  );
$function$;

revoke all on function private.can_read_distribution_post(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.can_read_distribution_post(uuid)
  to anon, authenticated;

create or replace function private.can_read_distribution_storage_object(
  p_bucket_id text,
  p_object_name text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select case
    when p_bucket_id not in ('avatars', 'post-images') then false
    when auth.uid() is not null
      and pg_catalog.split_part(p_object_name, '/', 1) = auth.uid()::text then true
    when private.current_user_is_distribution_staff() then true
    when p_bucket_id = 'avatars' then exists (
      select 1
        from public.profiles p
       where private.can_read_distribution_profile(p.id)
         and pg_catalog.right(
               coalesce(p.avatar_url, ''),
               pg_catalog.length(
                 '/storage/v1/object/public/avatars/' || p_object_name
               )
             ) = '/storage/v1/object/public/avatars/' || p_object_name
    )
    when p_bucket_id = 'post-images' then (
      exists (
        select 1
          from public.post_images i
          join public.posts p on p.id = i.post_id
         where p.status = 'approved'
           and private.has_active_distribution_consent(p.user_id, 'publication')
           and pg_catalog.right(
                 coalesce(i.url, ''),
                 pg_catalog.length(
                   '/storage/v1/object/public/post-images/' || p_object_name
                 )
               ) = '/storage/v1/object/public/post-images/' || p_object_name
      )
      or exists (
        select 1
          from public.books b
         where pg_catalog.right(
                 coalesce(b.cover_url, ''),
                 pg_catalog.length(
                   '/storage/v1/object/public/post-images/' || p_object_name
                 )
               ) = '/storage/v1/object/public/post-images/' || p_object_name
      )
    )
    else false
  end;
$function$;

revoke all on function private.can_read_distribution_storage_object(text, text)
  from public, anon, authenticated, service_role;
grant usage on schema private to anon, authenticated;
grant execute on function private.can_read_distribution_storage_object(text, text)
  to anon, authenticated;

-- Profile rows are public only with profile_public consent. Owners and staff
-- retain access; conversation participants keep access inside their private chat.
drop policy if exists profiles_read_all on public.profiles;
drop policy if exists profiles_read_distribution_consent on public.profiles;
create policy profiles_read_distribution_consent
on public.profiles
for select
to anon, authenticated
using (private.can_read_distribution_profile(id));

-- A post remains visible to its owner and staff for editing/moderation.
-- Guests and other members see approved posts only while publication consent is active.
drop policy if exists posts_read_approved_or_own on public.posts;
drop policy if exists posts_read_distribution_consent on public.posts;
create policy posts_read_distribution_consent
on public.posts
for select
to anon, authenticated
using (private.can_read_distribution_post(id));

-- Child records must not reveal material belonging to a hidden publication.
drop policy if exists comments_read_all on public.comments;
drop policy if exists comments_read_visible_posts on public.comments;
create policy comments_read_visible_posts
on public.comments
for select
to anon, authenticated
using (private.can_read_distribution_post(post_id));

drop policy if exists likes_read_all on public.likes;
drop policy if exists likes_read_visible_posts on public.likes;
create policy likes_read_visible_posts
on public.likes
for select
to anon, authenticated
using (private.can_read_distribution_post(post_id));

drop policy if exists post_images_read_all on public.post_images;
drop policy if exists post_images_read_visible_posts on public.post_images;
create policy post_images_read_visible_posts
on public.post_images
for select
to anon, authenticated
using (private.can_read_distribution_post(post_id));

drop policy if exists post_tags_read_all on public.post_tags;
drop policy if exists post_tags_read_visible_posts on public.post_tags;
create policy post_tags_read_visible_posts
on public.post_tags
for select
to anon, authenticated
using (private.can_read_distribution_post(post_id));

-- Public bucket URLs bypass storage.objects RLS. Make both user-media buckets
-- private and require signed URLs backed by the consent-aware SELECT policy.
update storage.buckets
   set public = false
 where id in ('avatars', 'post-images');

drop policy if exists avatars_public_read on storage.objects;
drop policy if exists "Public read" on storage.objects;
drop policy if exists "public read covers" on storage.objects;
drop policy if exists distribution_media_read on storage.objects;
create policy distribution_media_read
on storage.objects
for select
to anon, authenticated
using (
  bucket_id in ('avatars', 'post-images')
  and private.can_read_distribution_storage_object(bucket_id, name)
);

-- Private settings and state RPC: the profile flag is not granted as a column.
create or replace function public.my_legacy_distribution_prompt_state()
returns table (
  has_approved_posts boolean,
  already_prompted boolean,
  profile_public_active boolean,
  publication_active boolean
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
    raise exception 'Authentication is required to read legacy distribution prompt state'
      using errcode = '28000';
  end if;

  return query
  select
    exists (
      select 1 from public.posts p
       where p.user_id = v_user_id
         and p.status = 'approved'
    ),
    p.legacy_distribution_prompted_at is not null,
    private.has_active_distribution_consent(v_user_id, 'profile_public'),
    private.has_active_distribution_consent(v_user_id, 'publication')
  from public.profiles p
  where p.id = v_user_id;
end;
$function$;

comment on function public.my_legacy_distribution_prompt_state() is
  'Returns whether the current user has approved legacy posts, whether the one-time prompt was handled, and their own active public-distribution scopes.';

revoke all on function public.my_legacy_distribution_prompt_state()
  from public, anon, authenticated, service_role;
grant execute on function public.my_legacy_distribution_prompt_state()
  to authenticated, service_role;

-- A single atomic user action: either grant both scopes for existing material,
-- or revoke both. Fixed categories/versions live in SQL, never in caller input.
create or replace function public.resolve_my_legacy_distribution_prompt(p_decision text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_prompted_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Authentication is required to resolve the legacy distribution prompt'
      using errcode = '28000';
  end if;

  if p_decision is null or p_decision not in ('grant_existing', 'hide_existing') then
    raise exception 'Unsupported legacy distribution prompt decision'
      using errcode = '22023';
  end if;

  select p.legacy_distribution_prompted_at
    into v_prompted_at
    from public.profiles p
   where p.id = v_user_id
   for update;

  if not found then
    raise exception 'Profile was not found'
      using errcode = 'P0002';
  end if;

  if v_prompted_at is not null then
    return jsonb_build_object('already_prompted', true);
  end if;

  if not exists (
    select 1 from public.posts p
     where p.user_id = v_user_id
       and p.status = 'approved'
  ) then
    raise exception 'There are no approved legacy publications to resolve'
      using errcode = '22023';
  end if;

  if p_decision = 'grant_existing' then
    if not private.has_active_distribution_consent(v_user_id, 'profile_public') then
      perform public.record_my_distribution_consent(
        'profile_public',
        array[
          'profile_username',
          'profile_avatar',
          'profile_bio',
          'profile_joined_at'
        ]::text[],
        '1.1'
      );
    end if;

    if not private.has_active_distribution_consent(v_user_id, 'publication') then
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
    end if;
  else
    perform public.revoke_my_distribution_consent('profile_public');
    perform public.revoke_my_distribution_consent('publication');
  end if;

  update public.profiles
     set legacy_distribution_prompted_at = pg_catalog.now()
   where id = v_user_id
   returning legacy_distribution_prompted_at into v_prompted_at;

  return jsonb_build_object(
    'already_prompted', true,
    'decision', p_decision,
    'profile_public_active', private.has_active_distribution_consent(v_user_id, 'profile_public'),
    'publication_active', private.has_active_distribution_consent(v_user_id, 'publication'),
    'prompted_at', v_prompted_at
  );
end;
$function$;

comment on function public.resolve_my_legacy_distribution_prompt(text) is
  'Atomically handles the one-time legacy-publication prompt for auth.uid(): grants both fixed consent scopes or revokes both and marks the prompt handled.';

revoke all on function public.resolve_my_legacy_distribution_prompt(text)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_my_legacy_distribution_prompt(text)
  to authenticated, service_role;

create or replace function public.revoke_my_all_distribution_consents()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication is required to revoke distribution consents'
      using errcode = '28000';
  end if;

  perform public.revoke_my_distribution_consent('profile_public');
  perform public.revoke_my_distribution_consent('publication');
end;
$function$;

comment on function public.revoke_my_all_distribution_consents() is
  'Atomically revokes the current user profile_public and publication distribution scopes; user is derived only from auth.uid().';

revoke all on function public.revoke_my_all_distribution_consents()
  from public, anon, authenticated, service_role;
grant execute on function public.revoke_my_all_distribution_consents()
  to authenticated, service_role;

commit;
