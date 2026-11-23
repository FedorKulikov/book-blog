-- Keep pre-consent content publicly visible until its author makes an explicit choice.
-- This migration changes read predicates only; it never creates consent records.

begin;

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
           from public.profiles profile
          where profile.id = p_profile_id
            and profile.created_at < profile.legacy_distribution_cutoff_at
            and profile.legacy_distribution_choice is null
       )
       -- Preserve existing private-chat access to the conversation counterpart.
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

comment on function private.can_read_distribution_profile(uuid) is
  'Allows own/staff/chat-counterpart profile reads, active profile_public consent, or pre-cutoff legacy profiles while legacy_distribution_choice is null.';

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
             private.has_active_distribution_consent(post.user_id, 'publication')
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
  'Allows own/staff post reads, approved posts with active publication consent, or approved pre-cutoff legacy posts while legacy_distribution_choice is null.';


-- Keep the callable public view counter consistent with the same visibility
-- predicate. Pending legacy posts are viewable; explicitly hidden posts are not.
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
            private.has_active_distribution_consent(author.id, 'publication')
            or (
              target.created_at < author.legacy_distribution_cutoff_at
              and author.legacy_distribution_choice is null
            )
          )
     );
end;
$function$;

comment on function public.increment_post_views(uuid) is
  'Increments views only for approved posts that are publicly distributed through active publication consent or undecided pre-cutoff legacy visibility.';

-- The public counter is intentionally callable by guests and signed-in users.
-- Default privileges are otherwise restrictive, so retain this grant explicitly.
revoke all on function public.increment_post_views(uuid) from public;
grant execute on function public.increment_post_views(uuid) to anon, authenticated;

commit;
