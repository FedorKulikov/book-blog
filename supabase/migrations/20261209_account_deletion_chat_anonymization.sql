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
-- Lock content writes while a deletion request is running. The service
-- functions are only executable by service_role; callers cannot choose another
-- user's ID because the route supplies the verified Auth user id.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table if not exists private.account_deletion_locks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chat_mode text not null check (chat_mode in ('preserve', 'delete_own_messages')),
  requested_at timestamptz not null default now()
);

alter table private.account_deletion_locks enable row level security;
revoke all on private.account_deletion_locks from public, anon, authenticated, service_role;

create or replace function public.begin_account_deletion(
  p_user_id uuid,
  p_chat_mode text
)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_existing_mode text;
begin
  if p_chat_mode not in ('preserve', 'delete_own_messages') then
    raise exception 'unsupported chat deletion mode';
  end if;

  insert into private.account_deletion_locks (user_id, chat_mode)
  values (p_user_id, p_chat_mode)
  on conflict (user_id) do nothing;

  select chat_mode
    into v_existing_mode
    from private.account_deletion_locks
   where user_id = p_user_id;

  return v_existing_mode;
end;
$function$;

create or replace function public.end_account_deletion(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
begin
  delete from private.account_deletion_locks
   where user_id = p_user_id;
  return true;
end;
$function$;

alter function public.begin_account_deletion(uuid, text) owner to postgres;
alter function public.end_account_deletion(uuid) owner to postgres;
revoke all on function public.begin_account_deletion(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.end_account_deletion(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.begin_account_deletion(uuid, text) to service_role;
grant execute on function public.end_account_deletion(uuid) to service_role;

-- SECURITY DEFINER is used only to read the private lock table and block new
-- references to an account while deletion is in progress.
create or replace function public.prevent_writes_for_deleting_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_storage_url text;
begin
  -- A public image URL may be reused by another user's post or a news card.
  -- Do not allow any writer (including staff/service code) to create a new
  -- reference to a UID-scoped object after deletion preflight has started.
  if tg_table_name = 'post_images' then
    v_storage_url := to_jsonb(new) ->> 'url';
  elsif tg_table_name = 'profiles' then
    v_storage_url := to_jsonb(new) ->> 'avatar_url';
  elsif tg_table_name = 'books' or tg_table_name = 'external_news' then
    v_storage_url := to_jsonb(new) ->> 'cover_url';
  end if;

  if v_storage_url is not null and exists (
    select 1
    from private.account_deletion_locks l
    where v_storage_url ilike l.user_id::text || '/%'
       or v_storage_url ilike '%/' || l.user_id::text || '/%'
  ) then
    raise exception 'storage reference belongs to an account being deleted'
      using errcode = '55000';
  end if;

  -- Reject new references to a deleting UUID regardless of who performs
  -- the write. This closes races such as another user creating a notification
  -- whose actor_id points to the account currently being removed.
  if exists (
    select 1
    from private.account_deletion_locks l
    cross join lateral (
      values
        (nullif(to_jsonb(new) ->> 'user_id', '')::uuid),
        (nullif(to_jsonb(new) ->> 'sender_id', '')::uuid),
        (nullif(to_jsonb(new) ->> 'reporter_id', '')::uuid),
        (nullif(to_jsonb(new) ->> 'actor_id', '')::uuid),
        (nullif(to_jsonb(new) ->> 'blocker_id', '')::uuid),
        (nullif(to_jsonb(new) ->> 'blocked_id', '')::uuid),
        (nullif(to_jsonb(new) ->> 'follower_id', '')::uuid),
        (nullif(to_jsonb(new) ->> 'following_id', '')::uuid),
        (nullif(to_jsonb(new) ->> 'created_by', '')::uuid),
        (nullif(to_jsonb(new) ->> 'id', '')::uuid)
    ) as refs(referenced_user_id)
    where refs.referenced_user_id = l.user_id
  ) then
    raise exception 'account deletion is in progress'
      using errcode = '55000';
  end if;

  return new;
end;
$function$;

alter function public.prevent_writes_for_deleting_account() owner to postgres;
revoke all on function public.prevent_writes_for_deleting_account()
  from public, anon, authenticated, service_role;

drop trigger if exists profiles_block_deleting_user_writes on public.profiles;
create trigger profiles_block_deleting_user_writes
  before insert or update on public.profiles
  for each row execute function public.prevent_writes_for_deleting_account();

drop trigger if exists posts_block_deleting_user_writes on public.posts;
create trigger posts_block_deleting_user_writes
  before insert or update on public.posts
  for each row execute function public.prevent_writes_for_deleting_account();

drop trigger if exists comments_block_deleting_user_writes on public.comments;
create trigger comments_block_deleting_user_writes
  before insert or update on public.comments
  for each row execute function public.prevent_writes_for_deleting_account();

drop trigger if exists tickets_block_deleting_user_writes on public.tickets;
create trigger tickets_block_deleting_user_writes
  before insert or update on public.tickets
  for each row execute function public.prevent_writes_for_deleting_account();

drop trigger if exists ticket_messages_block_deleting_user_writes on public.ticket_messages;
create trigger ticket_messages_block_deleting_user_writes
  before insert or update on public.ticket_messages
  for each row execute function public.prevent_writes_for_deleting_account();

drop trigger if exists reports_block_deleting_user_writes on public.reports;
create trigger reports_block_deleting_user_writes
  before insert or update on public.reports
  for each row execute function public.prevent_writes_for_deleting_account();

drop trigger if exists action_log_block_deleting_user_writes on public.action_log;
create trigger action_log_block_deleting_user_writes
  before insert or update on public.action_log
  for each row execute function public.prevent_writes_for_deleting_account();

drop trigger if exists messages_block_deleting_user_writes on public.messages;
create trigger messages_block_deleting_user_writes
  before insert or update on public.messages
  for each row execute function public.prevent_writes_for_deleting_account();

drop trigger if exists notifications_block_deleting_user_writes on public.notifications;
create trigger notifications_block_deleting_user_writes
  before insert or update on public.notifications
  for each row execute function public.prevent_writes_for_deleting_account();

drop trigger if exists likes_block_deleting_user_writes on public.likes;
create trigger likes_block_deleting_user_writes
  before insert or update on public.likes
  for each row execute function public.prevent_writes_for_deleting_account();

drop trigger if exists bookmarks_block_deleting_user_writes on public.bookmarks;
create trigger bookmarks_block_deleting_user_writes
  before insert or update on public.bookmarks
  for each row execute function public.prevent_writes_for_deleting_account();

drop trigger if exists follows_block_deleting_user_writes on public.follows;
create trigger follows_block_deleting_user_writes
  before insert or update on public.follows
  for each row execute function public.prevent_writes_for_deleting_account();

drop trigger if exists user_blocks_block_deleting_user_writes on public.user_blocks;
create trigger user_blocks_block_deleting_user_writes
  before insert or update on public.user_blocks
  for each row execute function public.prevent_writes_for_deleting_account();

drop trigger if exists post_images_block_deleting_user_references on public.post_images;
create trigger post_images_block_deleting_user_references
  before insert or update on public.post_images
  for each row execute function public.prevent_writes_for_deleting_account();

drop trigger if exists external_news_block_deleting_user_references on public.external_news;
create trigger external_news_block_deleting_user_references
  before insert or update on public.external_news
  for each row execute function public.prevent_writes_for_deleting_account();

drop trigger if exists books_block_deleting_user_references on public.books;
create trigger books_block_deleting_user_references
  before insert or update on public.books
  for each row execute function public.prevent_writes_for_deleting_account();

-- A signed JWT can remain cryptographically valid for its remaining
-- lifetime after Auth user deletion. Storage write policies must therefore
-- also verify that auth.uid() still has a profile and no deletion lock.
create or replace function public.current_user_storage_writes_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.profiles p
      where p.id = (select auth.uid())
    )
    and not exists (
      select 1
      from private.account_deletion_locks l
      where l.user_id = (select auth.uid())
    );
$function$;

alter function public.current_user_storage_writes_allowed() owner to postgres;
revoke all on function public.current_user_storage_writes_allowed()
  from public, anon, authenticated, service_role;
grant execute on function public.current_user_storage_writes_allowed()
  to anon, authenticated;

-- Replace every authenticated owner write policy for these account-owned
-- buckets. Public reads remain public by design. These checks also reject
-- a stale access JWT once its profile row has been deleted.
drop policy if exists avatars_insert_own on storage.objects;
create policy avatars_insert_own
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.current_user_storage_writes_allowed()
  );

drop policy if exists chat_media_insert_own on storage.objects;
create policy chat_media_insert_own
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.current_user_storage_writes_allowed()
  );

drop policy if exists post_images_insert_own on storage.objects;
create policy post_images_insert_own
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.current_user_storage_writes_allowed()
  );

drop policy if exists avatars_owner_update on storage.objects;
drop policy if exists avatars_update_own on storage.objects;
create policy avatars_update_own
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.current_user_storage_writes_allowed()
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.current_user_storage_writes_allowed()
  );

drop policy if exists post_images_update_own on storage.objects;
create policy post_images_update_own
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.current_user_storage_writes_allowed()
  )
  with check (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.current_user_storage_writes_allowed()
  );

drop policy if exists chat_media_owner_delete on storage.objects;
create policy chat_media_owner_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.current_user_storage_writes_allowed()
  );

drop policy if exists avatars_owner_delete on storage.objects;
create policy avatars_owner_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.current_user_storage_writes_allowed()
  );

drop policy if exists "Owner delete" on storage.objects;
drop policy if exists post_images_delete_own on storage.objects;
create policy post_images_delete_own
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.current_user_storage_writes_allowed()
  );

-- A conversation with a deleted counterpart remains readable as history,
-- but the surviving member must not be able to continue sending into it.
drop policy if exists messages_insert_own on public.messages;
create policy messages_insert_own
  on public.messages
  for insert
  to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1
      from public.conversations as c
      where c.id = messages.conversation_id
        and c.user1_id is not null
        and c.user2_id is not null
        and (
          c.user1_id = (select auth.uid())
          or c.user2_id = (select auth.uid())
        )
    )
  );

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

  if has_function_privilege('anon', 'public.begin_account_deletion(uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.begin_account_deletion(uuid, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.begin_account_deletion(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.end_account_deletion(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.end_account_deletion(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.end_account_deletion(uuid)', 'EXECUTE') then
    raise exception 'account deletion lock RPCs must be restricted to service_role';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.messages'::regclass
      and tgname = 'messages_block_deleting_user_writes'
      and not tgisinternal and tgenabled <> 'D'
  ) then
    raise exception 'messages write-lock trigger is missing or disabled';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.post_images'::regclass
      and tgname = 'post_images_block_deleting_user_references'
      and not tgisinternal and tgenabled <> 'D'
  ) then
    raise exception 'post_images reference-lock trigger is missing or disabled';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.external_news'::regclass
      and tgname = 'external_news_block_deleting_user_references'
      and not tgisinternal and tgenabled <> 'D'
  ) then
    raise exception 'external_news reference-lock trigger is missing or disabled';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_roles r on r.oid = p.proowner
    where p.oid = 'public.current_user_storage_writes_allowed()'::regprocedure
      and p.prosecdef
      and r.rolname = 'postgres'
      and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=""%'
  ) then
    raise exception 'Storage write guard must be SECURITY DEFINER owned by postgres with empty search_path';
  end if;

  if exists (
       select 1
       from pg_proc p
       cross join lateral aclexplode(
         coalesce(p.proacl, acldefault('f', p.proowner))
       ) privilege
       where p.oid = 'public.current_user_storage_writes_allowed()'::regprocedure
         and privilege.grantee = 0
         and privilege.privilege_type = 'EXECUTE'
     )
     or not has_function_privilege('anon', 'public.current_user_storage_writes_allowed()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.current_user_storage_writes_allowed()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.current_user_storage_writes_allowed()', 'EXECUTE') then
    raise exception 'Storage write guard must be callable by anon/authenticated only, not PUBLIC or service_role';
  end if;

  if (
    select count(*)
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd = 'INSERT'
      and policyname in ('avatars_insert_own','chat_media_insert_own','post_images_insert_own')
      and coalesce(with_check, '') ilike '%current_user_storage_writes_allowed%'
  ) <> 3 then
    raise exception 'all three account-owned Storage buckets must validate active-profile status';
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

-- Make the newly created account-deletion RPCs visible to PostgREST.
notify pgrst, 'reload schema';
