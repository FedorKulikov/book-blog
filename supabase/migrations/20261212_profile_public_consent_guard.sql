-- Require active profile_public consent before changing public profile fields
-- or uploading/replacing an avatar in the public avatars bucket.
-- INSERT is intentionally not guarded: auth.users signup trigger handle_new_user()
-- creates the initial profile. System/service-role updates (auth.uid() IS NULL)
-- and admin edits to another user's row are also outside this owner-consent guard.

begin;

create or replace function public.has_my_profile_public_consent()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select auth.uid() is not null
     and exists (
       select 1
         from private.personal_data_consents as c
        where c.user_id = auth.uid()
          and c.scope = 'profile_public'
          and c.revoked_at is null
     );
$function$;

comment on function public.has_my_profile_public_consent() is
  'Returns whether auth.uid() has an active profile_public consent; intended for avatar Storage RLS policies.';

revoke all on function public.has_my_profile_public_consent()
  from public, anon, authenticated, service_role;
grant execute on function public.has_my_profile_public_consent()
  to authenticated, service_role;

create or replace function public.enforce_profile_public_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid := auth.uid();
begin
  -- Only a signed-in owner changing their own public fields is guarded.
  -- Inserts are intentionally not handled by this trigger.
  if v_user_id is not null
     and old.id = v_user_id
     and (
       new.username is distinct from old.username
       or new.bio is distinct from old.bio
       or new.avatar_url is distinct from old.avatar_url
     )
     and not exists (
       select 1
         from private.personal_data_consents as c
        where c.user_id = v_user_id
          and c.scope = 'profile_public'
          and c.revoked_at is null
     ) then
    raise exception 'Для изменения публичных полей профиля сначала требуется согласие на их распространение'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

comment on function public.enforce_profile_public_consent() is
  'BEFORE UPDATE guard for owner changes to public profile fields; signup INSERTs and non-owner system updates are not blocked.';

revoke all on function public.enforce_profile_public_consent()
  from public, anon, authenticated, service_role;

drop trigger if exists profiles_require_public_distribution_consent on public.profiles;

create trigger profiles_require_public_distribution_consent
before update of username, bio, avatar_url
on public.profiles
for each row
execute function public.enforce_profile_public_consent();

-- Avatar objects are served from a public bucket. The storage API must not
-- allow an authenticated user to publish/replace an avatar before granting consent.
drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.has_my_profile_public_consent()
);

-- A legacy PUBLIC update policy would OR around the new authenticated policy,
-- so remove it. The authenticated owner update path is recreated with consent.
drop policy if exists avatars_owner_update on storage.objects;
drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.has_my_profile_public_consent()
)
with check (
  bucket_id = 'avatars'
  and (storage.foldername(name))[1] = (select auth.uid())::text
  and public.has_my_profile_public_consent()
);

commit;
