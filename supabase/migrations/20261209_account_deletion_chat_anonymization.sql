-- 20261209_account_deletion_chat_anonymization.sql
--
-- Preserve the other participant's chat history when a profile is deleted.
-- The profile BEFORE DELETE trigger runs inside the Auth -> profiles cascade.
-- Storage objects are intentionally handled by the server workflow before the
-- Auth user is deleted; this migration only changes database references/RLS.

begin;

-- Keep the surviving participant's conversation instead of cascading it away.
alter table public.conversations
  alter column user1_id drop not null,
  alter column user2_id drop not null;

alter table public.conversations
  drop constraint if exists conversations_user1_id_fkey,
  add constraint conversations_user1_id_fkey
    foreign key (user1_id) references public.profiles(id) on delete set null,
  drop constraint if exists conversations_user2_id_fkey,
  add constraint conversations_user2_id_fkey
    foreign key (user2_id) references public.profiles(id) on delete set null;

-- Keep messages and replace the deleted author's profile link with a neutral
-- display label. Existing messages keep their sender_id and get a NULL label.
alter table public.messages
  alter column sender_id drop not null,
  add column if not exists sender_label text;

alter table public.messages
  drop constraint if exists messages_sender_id_fkey,
  add constraint messages_sender_id_fkey
    foreign key (sender_id) references public.profiles(id) on delete set null;

do $constraint$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_deleted_sender_label_check'
  ) then
    alter table public.messages
      add constraint messages_deleted_sender_label_check
      check (
        sender_id is not null
        or sender_label = 'Удалённый пользователь'
      ) not valid;
  end if;
end;
$constraint$;

alter table public.messages
  validate constraint messages_deleted_sender_label_check;

comment on column public.messages.sender_label is
  'Neutral display label for messages whose original profile was deleted; set only by the profile deletion trigger.';

-- A trusted trigger is necessary because existing chat write-protection
-- triggers intentionally prevent authenticated clients from changing authors
-- or conversation participants. The SECURITY DEFINER owner is postgres and
-- the function has an empty search_path; it is not an RPC surface.
create or replace function public.anonymize_profile_before_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.messages
     set sender_id = null,
         sender_label = 'Удалённый пользователь'
   where sender_id = old.id;

  update public.conversations
     set user1_id = null
   where user1_id = old.id;

  update public.conversations
     set user2_id = null
   where user2_id = old.id;

  -- If both participants have now deleted their accounts, no one can access
  -- this conversation anymore. Remove the orphaned conversation and its
  -- messages rather than retaining an inaccessible row.
  delete from public.conversations
   where user1_id is null
     and user2_id is null;

  -- This legacy creator column has no FK to profiles, so clear it explicitly.
  update public.external_news
     set created_by = null
   where created_by = old.id;

  return old;
end;
$function$;

alter function public.anonymize_profile_before_delete() owner to postgres;
revoke all on function public.anonymize_profile_before_delete()
  from public, anon, authenticated, service_role;

drop trigger if exists profiles_anonymize_before_delete on public.profiles;
create trigger profiles_anonymize_before_delete
  before delete on public.profiles
  for each row
  execute function public.anonymize_profile_before_delete();

-- Re-home'd attachments use opaque paths without the former sender UUID.
-- Authorization is therefore based on the message-to-conversation relation.
-- The EXISTS query is also constrained by the public.messages and
-- public.conversations RLS policies for the current authenticated user.
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
      join public.conversations as c
        on c.id = m.conversation_id
      where (
        c.user1_id = (select auth.uid())
        or c.user2_id = (select auth.uid())
      )
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

-- Fail the migration if the profile trigger or key schema guarantees are absent.
do $assert$
declare
  v_function oid := 'public.anonymize_profile_before_delete()'::regprocedure;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and (
        (table_name = 'conversations' and column_name in ('user1_id', 'user2_id'))
        or (table_name = 'messages' and column_name = 'sender_id')
      )
      and is_nullable <> 'YES'
  ) then
    raise exception 'chat profile references must be nullable';
  end if;

  if (
    select count(*)
    from pg_constraint
    where conrelid in ('public.conversations'::regclass, 'public.messages'::regclass)
      and conname in (
        'conversations_user1_id_fkey',
        'conversations_user2_id_fkey',
        'messages_sender_id_fkey'
      )
      and contype = 'f'
      and confdeltype = 'n'
  ) <> 3 then
    raise exception 'chat profile foreign keys must use ON DELETE SET NULL';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname = 'profiles_anonymize_before_delete'
      and not tgisinternal
      and tgenabled <> 'D'
  ) then
    raise exception 'profile anonymization trigger is missing or disabled';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_roles r on r.oid = p.proowner
    where p.oid = v_function
      and p.prosecdef
      and r.rolname = 'postgres'
      and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=""%'
  ) then
    raise exception 'profile anonymization function must be SECURITY DEFINER owned by postgres with empty search_path';
  end if;

  if has_function_privilege('anon', v_function, 'EXECUTE')
     or has_function_privilege('authenticated', v_function, 'EXECUTE')
     or has_function_privilege('service_role', v_function, 'EXECUTE') then
    raise exception 'profile anonymization trigger function must not be exposed as an RPC';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'chat_media_select_conversation_participants'
      and cmd = 'SELECT'
      and qual ilike '%user1_id%'
      and qual ilike '%user2_id%'
      and qual ilike '%messages%'
      and qual ilike '%conversations%'
  ) then
    raise exception 'chat media participant policy does not use the message/conversation relationship';
  end if;
end;
$assert$;

commit;
