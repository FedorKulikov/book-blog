-- Run after 20261208_chat_media_private.sql on a disposable PostgreSQL database.

do $$
begin
  if exists (
    select 1 from storage.buckets
     where id = 'chat-media' and public is distinct from false
  ) then
    raise exception 'chat-media bucket must be private';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and policyname = 'chat_media_public_read'
  ) then
    raise exception 'anonymous chat media read policy must be removed';
  end if;
end;
$$;

-- Anonymous users must not be able to enumerate any chat attachment.
begin;
set local role anon;
do $$
declare
  visible_objects integer;
begin
  select count(*) into visible_objects
    from storage.objects
   where bucket_id = 'chat-media';

  if visible_objects <> 0 then
    raise exception 'anon can still list % chat media objects', visible_objects;
  end if;
end;
$$;
rollback;

-- Both participants may read attachments sent by the original uploader.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);
do $$
declare
  visible_objects integer;
begin
  select count(*) into visible_objects
    from storage.objects
   where bucket_id = 'chat-media';

  if visible_objects <> 2 then
    raise exception 'conversation participant should see 2 objects, saw %', visible_objects;
  end if;
end;
$$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000002', true);
do $$
declare
  visible_objects integer;
begin
  select count(*) into visible_objects
    from storage.objects
   where bucket_id = 'chat-media';

  if visible_objects <> 2 then
    raise exception 'other conversation participant should see 2 objects, saw %', visible_objects;
  end if;
end;
$$;
rollback;

-- An unrelated participant sees only attachments in their own conversation.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000003', true);
do $$
declare
  visible_objects integer;
begin
  select count(*) into visible_objects
    from storage.objects
   where bucket_id = 'chat-media';

  if visible_objects <> 1 then
    raise exception 'unrelated participant should see exactly 1 object, saw %', visible_objects;
  end if;
end;
$$;
rollback;

-- A user cannot attach another uploader's path to their own message to gain access.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000005', true);
do $$
declare
  visible_objects integer;
begin
  select count(*) into visible_objects
    from storage.objects
   where bucket_id = 'chat-media';

  if visible_objects <> 0 then
    raise exception 'forged media reference exposed % objects', visible_objects;
  end if;
end;
$$;
rollback;
