-- 20261208_chat_media_private.sql
--
-- Chat attachments must not be publicly listable or retrievable. Only a
-- participant in a conversation containing the original sender's attachment
-- may request a signed URL for that object.
--
-- Legacy messages store /object/public/chat-media/<path> URLs. New messages
-- store the bucket-relative object path. Both formats are supported.

begin;

update storage.buckets
   set public = false
 where id = 'chat-media';

do $$
begin
  if not exists (
    select 1
      from storage.buckets
     where id = 'chat-media'
       and public = false
  ) then
    raise exception 'chat-media bucket is missing or could not be made private';
  end if;
end;
$$;

drop policy if exists chat_media_public_read on storage.objects;
drop policy if exists chat_media_select_conversation_participants on storage.objects;

create policy chat_media_select_conversation_participants
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'chat-media'
    and exists (
      select 1
        from public.messages as m
       where m.sender_id::text = (storage.foldername(storage.objects.name))[1]
         and (
           m.image_url = storage.objects.name
           or m.audio_url = storage.objects.name
           or right(
             coalesce(m.image_url, ''),
             char_length('/storage/v1/object/public/chat-media/' || storage.objects.name)
           ) = '/storage/v1/object/public/chat-media/' || storage.objects.name
           or right(
             coalesce(m.audio_url, ''),
             char_length('/storage/v1/object/public/chat-media/' || storage.objects.name)
           ) = '/storage/v1/object/public/chat-media/' || storage.objects.name
         )
    )
  );

do $$
begin
  if exists (
    select 1
      from pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and policyname = 'chat_media_public_read'
  ) then
    raise exception 'public chat media read policy still exists';
  end if;

  if not exists (
    select 1
      from pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and policyname = 'chat_media_select_conversation_participants'
       and cmd = 'SELECT'
  ) then
    raise exception 'participant-only chat media read policy was not created';
  end if;
end;
$$;

commit;
