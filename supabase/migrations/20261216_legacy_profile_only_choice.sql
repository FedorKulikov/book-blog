-- Let authors resolve pre-consent profile visibility even when they have no posts.
-- Only the user's own explicit choice may create consent records; hiding creates none.

begin;

drop function if exists public.my_legacy_distribution_prompt_state();

create function public.my_legacy_distribution_prompt_state()
returns table (
  has_approved_posts boolean,
  already_prompted boolean,
  profile_public_active boolean,
  publication_active boolean,
  legacy_choice text,
  has_legacy_profile boolean
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
      select 1
        from public.posts post
       where post.user_id = v_user_id
         and post.status = 'approved'
         and post.created_at < profile.legacy_distribution_cutoff_at
    ),
    profile.legacy_distribution_prompted_at is not null,
    private.has_active_distribution_consent(v_user_id, 'profile_public'),
    private.has_active_distribution_consent(v_user_id, 'publication'),
    profile.legacy_distribution_choice,
    profile.created_at < profile.legacy_distribution_cutoff_at
  from public.profiles profile
  where profile.id = v_user_id;
end;
$function$;

comment on function public.my_legacy_distribution_prompt_state() is
  'Returns the current user legacy-profile and approved-legacy-post state, prompt status, consent scopes, and legacy decision.';

revoke all on function public.my_legacy_distribution_prompt_state()
  from public, anon, authenticated, service_role;
grant execute on function public.my_legacy_distribution_prompt_state()
  to authenticated, service_role;

create or replace function public.resolve_my_legacy_distribution_prompt(p_decision text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_prompted_at timestamptz;
  v_cutoff_at timestamptz;
  v_profile_created_at timestamptz;
  v_has_legacy_profile boolean := false;
  v_has_legacy_posts boolean := false;
begin
  if v_user_id is null then
    raise exception 'Authentication is required to resolve the legacy distribution prompt'
      using errcode = '28000';
  end if;

  if p_decision is null or p_decision not in ('grant_existing', 'hide_existing') then
    raise exception 'Unsupported legacy distribution prompt decision'
      using errcode = '22023';
  end if;

  select
    p.legacy_distribution_prompted_at,
    p.legacy_distribution_cutoff_at,
    p.created_at
  into
    v_prompted_at,
    v_cutoff_at,
    v_profile_created_at
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

  v_has_legacy_profile := v_profile_created_at < v_cutoff_at;

  select exists (
    select 1
      from public.posts p
     where p.user_id = v_user_id
       and p.status = 'approved'
       and p.created_at < v_cutoff_at
  )
  into v_has_legacy_posts;

  if not v_has_legacy_profile and not v_has_legacy_posts then
    raise exception 'There is no legacy profile or approved legacy publication to resolve'
      using errcode = '22023';
  end if;

  if p_decision = 'grant_existing' then
    if v_has_legacy_profile
       and not private.has_active_distribution_consent(v_user_id, 'profile_public') then
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

    if v_has_legacy_posts
       and not private.has_active_distribution_consent(v_user_id, 'publication') then
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
    -- Hide the old profile, but do not revoke publication consent: the
    -- legacy_choice marker below hides pre-cutoff posts while an active
    -- publication scope continues to authorize genuinely new posts.
    if v_has_legacy_profile then
      perform public.revoke_my_distribution_consent('profile_public');
    end if;
  end if;

  update public.profiles
     set legacy_distribution_prompted_at = pg_catalog.now(),
         legacy_distribution_choice = case
           when p_decision = 'grant_existing' then 'granted'
           else 'hidden'
         end
   where id = v_user_id
   returning legacy_distribution_prompted_at into v_prompted_at;

  return jsonb_build_object(
    'already_prompted', true,
    'decision', p_decision,
    'has_legacy_profile', v_has_legacy_profile,
    'has_approved_posts', v_has_legacy_posts,
    'profile_public_active', private.has_active_distribution_consent(v_user_id, 'profile_public'),
    'publication_active', private.has_active_distribution_consent(v_user_id, 'publication'),
    'prompted_at', v_prompted_at
  );
end;
$function$;

comment on function public.resolve_my_legacy_distribution_prompt(text) is
  'Atomically resolves the authenticated user pre-cutoff profile and/or approved publications. Only the user-scoped grant branch records the relevant consent scopes; hide creates no consent rows.';

revoke all on function public.resolve_my_legacy_distribution_prompt(text)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_my_legacy_distribution_prompt(text)
  to authenticated, service_role;


-- A new publication grant must never re-publish legacy posts after the owner
-- explicitly chose "hidden". The one-time grant_existing RPC is the only path
-- that makes pre-cutoff approved posts public again.
create or replace function private.can_read_distribution_post(p_post_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
      from public.posts post
      join public.profiles author on author.id = post.user_id
     where post.id = p_post_id
       and (
         post.user_id = auth.uid()
         or private.current_user_is_distribution_staff()
         or (
           post.status = 'approved'
           and (
             (
               private.has_active_distribution_consent(post.user_id, 'publication')
               and (
                 post.created_at >= author.legacy_distribution_cutoff_at
                 or author.legacy_distribution_choice = 'granted'
               )
             )
             or (
               post.created_at < author.legacy_distribution_cutoff_at
               and author.legacy_distribution_choice is null
             )
           )
         )
       )
  );
$function$;

comment on function private.can_read_distribution_post(uuid) is
  'Allows own/staff posts, approved post-cutoff posts with active publication consent, explicitly granted legacy posts with active consent, and undecided pre-cutoff legacy posts. A later new-post consent does not re-publish hidden legacy posts.';

revoke all on function private.can_read_distribution_post(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.can_read_distribution_post(uuid)
  to anon, authenticated;

-- Keep the SECURITY DEFINER public counter on exactly the same visibility
-- predicate as post SELECT RLS and private post-image authorization.
create or replace function public.increment_post_views(post_id_input uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.posts as target
     set views_count = coalesce(target.views_count, 0) + 1
   where target.id = post_id_input
     and target.status = 'approved'
     and exists (
       select 1
         from public.profiles author
        where author.id = target.user_id
          and (
            (
              private.has_active_distribution_consent(author.id, 'publication')
              and (
                target.created_at >= author.legacy_distribution_cutoff_at
                or author.legacy_distribution_choice = 'granted'
              )
            )
            or (
              target.created_at < author.legacy_distribution_cutoff_at
              and author.legacy_distribution_choice is null
            )
          )
     );
end;
$function$;

comment on function public.increment_post_views(uuid) is
  'Increments views only for approved posts visible under the consent-aware distribution rule; later publication consent does not count hidden legacy posts.';

revoke all on function public.increment_post_views(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.increment_post_views(uuid)
  to anon, authenticated;

commit;
