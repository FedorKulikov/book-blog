-- 20261206_storage_upload_ownership.sql
--
-- All client upload paths are already namespaced by the authenticated user's
-- UUID. Remove legacy bucket-wide INSERT policies that allowed any signed-in
-- user to write into another user's directory, then make all three buckets
-- consistently owner-scoped.

begin;

drop policy if exists "Auth upload" on storage.objects;
drop policy if exists avatars_auth_upload on storage.objects;
drop policy if exists chat_media_auth_upload on storage.objects;

drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists post_images_insert_own on storage.objects;
create policy post_images_insert_own
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists chat_media_insert_own on storage.objects;
create policy chat_media_insert_own
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

do $$
declare
  remaining_broad_policies integer;
  strict_insert_policies integer;
begin
  select count(*)
    into remaining_broad_policies
    from pg_policies
   where schemaname = 'storage'
     and tablename = 'objects'
     and policyname in ('Auth upload', 'avatars_auth_upload', 'chat_media_auth_upload');

  if remaining_broad_policies <> 0 then
    raise exception 'legacy broad Storage upload policies remain';
  end if;

  select count(*)
    into strict_insert_policies
    from pg_policies
   where schemaname = 'storage'
     and tablename = 'objects'
     and cmd = 'INSERT'
     and policyname in ('avatars_insert_own', 'post_images_insert_own', 'chat_media_insert_own');

  if strict_insert_policies <> 3 then
    raise exception 'expected three owner-scoped Storage INSERT policies, found %', strict_insert_policies;
  end if;
end;
$$;

commit;
