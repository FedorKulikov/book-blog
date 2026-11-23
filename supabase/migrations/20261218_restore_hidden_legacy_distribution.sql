-- Restore legacy distribution only after the owner explicitly requests it.
-- Consent rows are recorded through the existing auth.uid()-scoped RPC.
begin;

create or replace function public.restore_my_hidden_legacy_distribution()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
  v_choice text;
  v_cutoff_at timestamptz;
  v_profile_created_at timestamptz;
  v_has_legacy_profile boolean := false;
  v_has_legacy_posts boolean := false;
begin
  if v_user_id is null then
    raise exception 'Authentication is required to restore legacy distribution'
      using errcode = '28000';
  end if;

  select p.legacy_distribution_choice, p.legacy_distribution_cutoff_at, p.created_at
    into v_choice, v_cutoff_at, v_profile_created_at
    from public.profiles p
   where p.id = v_user_id
   for update;

  if not found then
    raise exception 'Profile was not found' using errcode = 'P0002';
  end if;

  if v_choice is distinct from 'hidden' then
    raise exception 'Legacy materials can be restored only after an explicit hidden choice'
      using errcode = '22023';
  end if;

  v_has_legacy_profile := v_profile_created_at < v_cutoff_at;

  select exists (
    select 1 from public.posts post
     where post.user_id = v_user_id
       and post.status = 'approved'
       and post.created_at < v_cutoff_at
  ) into v_has_legacy_posts;

  if not v_has_legacy_profile and not v_has_legacy_posts then
    raise exception 'No legacy profile or approved legacy publications remain to restore'
      using errcode = '22023';
  end if;

  if v_has_legacy_posts
     and not private.has_active_distribution_consent(v_user_id, 'publication') then
    perform public.record_my_distribution_consent(
      'publication',
      array[
        'author_username', 'author_avatar', 'publication_title', 'publication_text',
        'publication_images', 'publication_tags', 'linked_book', 'news_metadata'
      ]::text[],
      '1.0'
    );
  end if;

  if v_has_legacy_profile
     and not private.has_active_distribution_consent(v_user_id, 'profile_public') then
    perform public.record_my_distribution_consent(
      'profile_public',
      array[
        'profile_username', 'profile_avatar', 'profile_bio', 'profile_joined_at'
      ]::text[],
      '1.1'
    );
  end if;

  update public.profiles
     set legacy_distribution_choice = 'granted'
   where id = v_user_id
     and legacy_distribution_choice = 'hidden';

  return jsonb_build_object(
    'restored', true,
    'legacy_choice', 'granted',
    'has_legacy_profile', v_has_legacy_profile,
    'has_approved_posts', v_has_legacy_posts
  );
end;
$function$;

comment on function public.restore_my_hidden_legacy_distribution() is
  'Server-only restoration for the user ID verified by the route; records missing scopes through record_my_distribution_consent and changes only legacy_distribution_choice to granted.';

revoke all on function public.restore_my_hidden_legacy_distribution()
  from public, anon, authenticated, service_role;
grant execute on function public.restore_my_hidden_legacy_distribution()
  to authenticated;

commit;
