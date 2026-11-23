-- Expose only the author fields explicitly covered by a publication consent.
-- Do not grant SELECT on the complete profiles row when profile_public is absent.
begin;

create or replace function public.get_publication_author_details(p_post_ids uuid[])
returns table (
  post_id uuid,
  user_id uuid,
  username text,
  avatar_url text,
  can_read_profile boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if p_post_ids is null or pg_catalog.cardinality(p_post_ids) = 0 then
    return;
  end if;

  if pg_catalog.cardinality(p_post_ids) > 1000 then
    raise exception 'At most 1000 post IDs may be resolved at once'
      using errcode = '22023';
  end if;

  return query
  select
    p.id,
    p.user_id,
    author.username,
    author.avatar_url,
    private.can_read_distribution_profile(author.id)
  from public.posts p
  join public.profiles author on author.id = p.user_id
  where p.id = any(p_post_ids)
    and private.can_read_distribution_post(p.id);
end;
$function$;

comment on function public.get_publication_author_details(uuid[]) is
  'Returns only username and avatar_url for authors of posts readable under publication consent. Does not expose bio, created_at, role, or the full profiles row. can_read_profile indicates whether the current viewer may open the public profile page.';

revoke all on function public.get_publication_author_details(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.get_publication_author_details(uuid[])
  to anon, authenticated;

-- A publication consent includes author_avatar. It may authorize the avatar
-- object for an eligible public post without authorizing the full public profile.
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
        from public.profiles author
       where (
         private.can_read_distribution_profile(author.id)
         or exists (
           select 1
             from public.posts post
            where post.user_id = author.id
              and private.can_read_distribution_post(post.id)
         )
       )
         and pg_catalog.right(
               coalesce(author.avatar_url, ''),
               pg_catalog.length(
                 '/storage/v1/object/public/avatars/' || p_object_name
               )
             ) = '/storage/v1/object/public/avatars/' || p_object_name
    )
    when p_bucket_id = 'post-images' then (
      exists (
        select 1
          from public.post_images i
         where private.can_read_distribution_post(i.post_id)
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
grant execute on function private.can_read_distribution_storage_object(text, text)
  to anon, authenticated;

commit;
