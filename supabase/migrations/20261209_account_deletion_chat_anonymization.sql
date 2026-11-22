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

-- The SECURITY DEFINER lock RPCs run as postgres, regardless of the role
-- applying the migration. Make the private schema and lock table owned by the
-- same trusted role so their access does not depend on the migration runner.
alter schema private owner to postgres;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table if not exists private.account_deletion_locks (
  user_id uuid primary key references auth.users(id) on delete cascade,
  chat_mode text not null check (chat_mode in ('preserve', 'delete_own_messages')),
  requested_at timestamptz not null default now()
);

alter table private.account_deletion_locks owner to postgres;
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
  if p_user_id is null then
    raise exception 'account deletion requires a user id';
  end if;

  if p_chat_mode not in ('preserve', 'delete_own_messages') then
    raise exception 'unsupported chat deletion mode';
  end if;

  -- Serialize deletion start with all Storage/database writers that reference
  -- this user. The transaction lock is held until the RPC transaction commits.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

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
  if p_user_id is null then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

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
  v_new_json jsonb;
  v_old_json jsonb;
  v_storage_url text;
  v_uuid_pattern constant text := '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
  v_reference_user_id uuid;
  v_old_image_user_id uuid;
  v_old_audio_user_id uuid;
  v_old_user1_id uuid;
  v_old_user2_id uuid;
  v_old_sender_id uuid;
begin
  v_new_json := pg_catalog.to_jsonb(new);
  if tg_op = 'UPDATE' then
    v_old_json := pg_catalog.to_jsonb(old);
  end if;

  -- Values that can contain a user-owned public Storage path.
  if tg_table_name = 'post_images' then
    v_storage_url := v_new_json ->> 'url';
  elsif tg_table_name = 'profiles' then
    v_storage_url := v_new_json ->> 'avatar_url';
  elsif tg_table_name = 'books' or tg_table_name = 'external_news' then
    v_storage_url := v_new_json ->> 'cover_url';
  end if;

  -- Auth profile deletion deliberately anonymizes a message by changing only
  -- sender_id + sender_label. That is a detach operation, not a new reference.
  if tg_table_name = 'messages'
     and tg_op = 'UPDATE'
     and (v_new_json - 'sender_id' - 'sender_label')
       = (v_old_json - 'sender_id' - 'sender_label')
     and v_new_json ->> 'sender_id' is null
     and v_new_json ->> 'sender_label' = 'Удалённый пользователь' then
    v_old_sender_id := case
      when v_old_json ->> 'sender_id' ~* ('^' || v_uuid_pattern || '$')
      then (v_old_json ->> 'sender_id')::uuid
      else null
    end;

    if v_old_sender_id is not null then
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_old_sender_id::text, 0)
      );

      if exists (
        select 1
        from private.account_deletion_locks l
        where l.user_id = v_old_sender_id
      ) then
        return new;
      end if;
    end if;
  end if;

  -- Profile anonymization detaches only the participant(s) being deleted.
  -- Allow that nulling operation even if the other participant is also in the
  -- process of deletion; no new participant reference is introduced.
  if tg_table_name = 'conversations'
     and tg_op = 'UPDATE'
     and (v_new_json - 'user1_id' - 'user2_id')
       = (v_old_json - 'user1_id' - 'user2_id')
     and (
       (v_new_json ->> 'user1_id') is distinct from (v_old_json ->> 'user1_id')
       or (v_new_json ->> 'user2_id') is distinct from (v_old_json ->> 'user2_id')
     )
     and (
       (v_new_json ->> 'user1_id') is not distinct from (v_old_json ->> 'user1_id')
       or (
         v_new_json ->> 'user1_id' is null
         and v_old_json ->> 'user1_id' ~* ('^' || v_uuid_pattern || '$')
       )
     )
     and (
       (v_new_json ->> 'user2_id') is not distinct from (v_old_json ->> 'user2_id')
       or (
         v_new_json ->> 'user2_id' is null
         and v_old_json ->> 'user2_id' ~* ('^' || v_uuid_pattern || '$')
       )
     ) then
    v_old_user1_id := case
      when v_old_json ->> 'user1_id' ~* ('^' || v_uuid_pattern || '$')
      then (v_old_json ->> 'user1_id')::uuid
      else null
    end;
    v_old_user2_id := case
      when v_old_json ->> 'user2_id' ~* ('^' || v_uuid_pattern || '$')
      then (v_old_json ->> 'user2_id')::uuid
      else null
    end;

    for v_reference_user_id in
      select distinct participant_id
      from (
        values
          (
            case
              when v_new_json ->> 'user1_id' is null
               and v_old_json ->> 'user1_id' ~* ('^' || v_uuid_pattern || '$')
              then v_old_user1_id
              else null
            end
          ),
          (
            case
              when v_new_json ->> 'user2_id' is null
               and v_old_json ->> 'user2_id' ~* ('^' || v_uuid_pattern || '$')
              then v_old_user2_id
              else null
            end
          )
      ) as participants(participant_id)
      where participant_id is not null
      order by participant_id
    loop
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_reference_user_id::text, 0)
      );
    end loop;

    if (
      (v_new_json ->> 'user1_id') is not distinct from (v_old_json ->> 'user1_id')
      or exists (
        select 1 from private.account_deletion_locks l
        where l.user_id = v_old_user1_id
      )
    ) and (
      (v_new_json ->> 'user2_id') is not distinct from (v_old_json ->> 'user2_id')
      or exists (
        select 1 from private.account_deletion_locks l
        where l.user_id = v_old_user2_id
      )
    ) then
      return new;
    end if;
  end if;

  -- During preserve-mode deletion, a trusted server flow may rewrite only
  -- attachment references on a message. The source object owner(s) must be
  -- locked first, and every changed path must become retained/<conversation>/.
  if tg_table_name = 'messages'
     and tg_op = 'UPDATE'
     and (v_new_json - 'image_url' - 'audio_url')
       = (v_old_json - 'image_url' - 'audio_url')
     and (
       (v_new_json ->> 'image_url') is distinct from (v_old_json ->> 'image_url')
       or (v_new_json ->> 'audio_url') is distinct from (v_old_json ->> 'audio_url')
     ) then
    v_old_image_user_id := case
      when v_old_json ->> 'image_url' is not null
       and v_old_json ->> 'image_url' !~ '(^|/)retained/'
       and pg_catalog.regexp_match(
         v_old_json ->> 'image_url',
         '(^|/)(' || v_uuid_pattern || ')/'
       ) is not null
      then (pg_catalog.regexp_match(
        v_old_json ->> 'image_url',
        '(^|/)(' || v_uuid_pattern || ')/'
      ))[2]::uuid
      else null
    end;

    v_old_audio_user_id := case
      when v_old_json ->> 'audio_url' is not null
       and v_old_json ->> 'audio_url' !~ '(^|/)retained/'
       and pg_catalog.regexp_match(
         v_old_json ->> 'audio_url',
         '(^|/)(' || v_uuid_pattern || ')/'
       ) is not null
      then (pg_catalog.regexp_match(
        v_old_json ->> 'audio_url',
        '(^|/)(' || v_uuid_pattern || ')/'
      ))[2]::uuid
      else null
    end;

    for v_reference_user_id in
      select distinct source_owner_id
      from (
        values (v_old_image_user_id), (v_old_audio_user_id)
      ) as source_owners(source_owner_id)
      where source_owner_id is not null
      order by source_owner_id
    loop
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(v_reference_user_id::text, 0)
      );
    end loop;

    if (
      (v_new_json ->> 'image_url') is not distinct from (v_old_json ->> 'image_url')
      or (
        v_old_image_user_id is not null
        and (v_new_json ->> 'image_url') like
          'retained/' || (v_new_json ->> 'conversation_id') || '/%'
        and exists (
          select 1 from private.account_deletion_locks l
          where l.user_id = v_old_image_user_id
        )
      )
    ) and (
      (v_new_json ->> 'audio_url') is not distinct from (v_old_json ->> 'audio_url')
      or (
        v_old_audio_user_id is not null
        and (v_new_json ->> 'audio_url') like
          'retained/' || (v_new_json ->> 'conversation_id') || '/%'
        and exists (
          select 1 from private.account_deletion_locks l
          where l.user_id = v_old_audio_user_id
        )
      )
    ) then
      return new;
    end if;
  end if;

  -- Serialize every new row/reference with deletion start. UUID values are
  -- accepted only in exact UUID form; URLs are parsed only for user folders,
  -- never for the retained/<conversation UUID>/ namespace.
  for v_reference_user_id in
    with raw_references(reference_value) as (
      select reference_value
      from (
        values
          (v_new_json ->> 'user_id'),
          (v_new_json ->> 'sender_id'),
          (v_new_json ->> 'reporter_id'),
          (v_new_json ->> 'actor_id'),
          (v_new_json ->> 'blocker_id'),
          (v_new_json ->> 'blocked_id'),
          (v_new_json ->> 'follower_id'),
          (v_new_json ->> 'following_id'),
          (v_new_json ->> 'created_by'),
          (v_new_json ->> 'id'),
          (v_new_json ->> 'user1_id'),
          (v_new_json ->> 'user2_id'),
          (v_storage_url),
          (case when tg_table_name = 'messages' then v_new_json ->> 'image_url' end),
          (case when tg_table_name = 'messages' then v_new_json ->> 'audio_url' end)
      ) as candidates(reference_value)
    ),
    parsed_references as (
      select
        case
          when reference_value ~* ('^' || v_uuid_pattern || '$')
          then reference_value::uuid
          when reference_value is not null
           and reference_value !~ '(^|/)retained/'
           and pg_catalog.regexp_match(
             reference_value,
             '(^|/)(' || v_uuid_pattern || ')/'
           ) is not null
          then (pg_catalog.regexp_match(
            reference_value,
            '(^|/)(' || v_uuid_pattern || ')/'
          ))[2]::uuid
          else null
        end as referenced_user_id
      from raw_references
    )
    select distinct referenced_user_id
    from parsed_references
    where referenced_user_id is not null
    order by referenced_user_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_reference_user_id::text, 0)
    );

    if exists (
      select 1
      from private.account_deletion_locks l
      where l.user_id = v_reference_user_id
    ) then
      raise exception 'account deletion is in progress'
        using errcode = '55000';
    end if;
  end loop;

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

drop trigger if exists conversations_block_deleting_user_writes on public.conversations;
create trigger conversations_block_deleting_user_writes
  before insert or update on public.conversations
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
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    return false;
  end if;

  -- Storage INSERT/UPDATE/DELETE serializes with the transaction that opens
  -- the account-deletion fence. A pre-existing upload must finish before
  -- deletion preflight can begin; a later upload waits and then sees the fence.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::text, 0)
  );

  return exists (
    select 1
    from public.profiles p
    where p.id = v_user_id
  ) and not exists (
    select 1
    from private.account_deletion_locks l
    where l.user_id = v_user_id
  );
end;
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

-- Retained paths are server-managed. Without this guard a client could
-- attach a known retained/ object to an arbitrary new or existing message and
-- gain access through the participant-based Storage policy below.
create or replace function public.reject_untrusted_retained_chat_media_refs()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if coalesce(new.image_url, '') like 'retained/%'
     or coalesce(new.audio_url, '') like 'retained/%'
     or coalesce(new.image_url, '') like '%/chat-media/retained/%'
     or coalesce(new.audio_url, '') like '%/chat-media/retained/%' then
    raise exception 'retained chat media references are server-managed'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

alter function public.reject_untrusted_retained_chat_media_refs() owner to postgres;
revoke all on function public.reject_untrusted_retained_chat_media_refs()
  from public, anon, authenticated, service_role;

drop trigger if exists messages_block_untrusted_retained_media on public.messages;
create trigger messages_block_untrusted_retained_media
  before insert or update of image_url, audio_url
  on public.messages
  for each row execute function public.reject_untrusted_retained_chat_media_refs();

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
      -- Preserve the original uploader-folder check for ordinary objects.
      -- The neutral retained/ exception is safe because client INSERT/UPDATE
      -- references to that prefix are rejected by the trigger above.
      and (
        (storage.foldername(storage.objects.name))[1] = m.sender_id::text
        or (
          (storage.foldername(storage.objects.name))[1] = 'retained'
          and (storage.foldername(storage.objects.name))[2] = m.conversation_id::text
        )
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
-- Recalculate conversation ordering in the same transaction as a bulk
-- message deletion. A transition table keeps this to one update per affected
-- conversation, including when a failed request is retried after the delete.
create or replace function public.refresh_conversation_last_message_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update public.conversations as c
  set last_message_at = (
    select max(m.created_at)
    from public.messages as m
    where m.conversation_id = c.id
  )
  where c.id in (
    select distinct deleted.conversation_id
    from deleted_messages as deleted
  )
  and exists (
    select 1
    from public.messages as remaining
    where remaining.conversation_id = c.id
  );

  return null;
end;
$function$;

alter function public.refresh_conversation_last_message_after_delete() owner to postgres;
revoke all on function public.refresh_conversation_last_message_after_delete()
  from public, anon, authenticated, service_role;

drop trigger if exists messages_refresh_conversation_last_message on public.messages;
create trigger messages_refresh_conversation_last_message
  after delete on public.messages
  referencing old table as deleted_messages
  for each statement
  execute function public.refresh_conversation_last_message_after_delete();

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
    from pg_namespace n
    join pg_roles r on r.oid = n.nspowner
    where n.nspname = 'private'
      and r.rolname = 'postgres'
  ) or not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_roles r on r.oid = c.relowner
    where n.nspname = 'private'
      and c.relname = 'account_deletion_locks'
      and r.rolname = 'postgres'
  ) then
    raise exception 'private deletion lock schema and table must be owned by postgres';
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
    select 1
    from pg_trigger
    where tgrelid = 'public.messages'::regclass
      and tgname = 'messages_refresh_conversation_last_message'
      and not tgisinternal
      and tgenabled <> 'D'
  ) or not exists (
    select 1
    from pg_proc p
    join pg_roles r on r.oid = p.proowner
    where p.oid = 'public.refresh_conversation_last_message_after_delete()'::regprocedure
      and p.prosecdef
      and r.rolname = 'postgres'
      and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=""%'
  ) then
    raise exception 'message deletion timestamp maintenance trigger is missing or unsafe';
  end if;

  if has_function_privilege('anon', 'public.refresh_conversation_last_message_after_delete()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.refresh_conversation_last_message_after_delete()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.refresh_conversation_last_message_after_delete()', 'EXECUTE') then
    raise exception 'conversation timestamp trigger function must not be exposed as an RPC';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.conversations'::regclass
      and tgname = 'conversations_block_deleting_user_writes'
      and not tgisinternal and tgenabled <> 'D'
  ) then
    raise exception 'conversation participant write-lock trigger is missing or disabled';
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

  if (
    select provolatile
    from pg_proc
    where oid = 'public.current_user_storage_writes_allowed()'::regprocedure
  ) <> 'v'
     or position('pg_advisory_xact_lock' in pg_get_functiondef('public.current_user_storage_writes_allowed()'::regprocedure)) = 0
     or position('pg_advisory_xact_lock' in pg_get_functiondef('public.begin_account_deletion(uuid, text)'::regprocedure)) = 0
     or position('pg_advisory_xact_lock' in pg_get_functiondef('public.end_account_deletion(uuid)'::regprocedure)) = 0
     or position('pg_advisory_xact_lock' in pg_get_functiondef('public.prevent_writes_for_deleting_account()'::regprocedure)) = 0 then
    raise exception 'account deletion and user write paths must share the transaction advisory lock';
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
      and qual ilike '%sender_id%'
      and qual ilike '%retained%'
      and qual ilike '%conversation_id%'
  ) then
    raise exception 'chat media policy must scope managed retained paths to their conversation';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.messages'::regclass
      and tgname = 'messages_block_untrusted_retained_media'
      and not tgisinternal
      and tgenabled <> 'D'
  ) then
    raise exception 'client retained-media reference guard is missing or disabled';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_roles r on r.oid = p.proowner
    where p.oid = 'public.reject_untrusted_retained_chat_media_refs()'::regprocedure
      and not p.prosecdef
      and r.rolname = 'postgres'
  ) then
    raise exception 'retained-media reference guard must be an invoker trigger owned by postgres';
  end if;

  if has_function_privilege('anon', 'public.reject_untrusted_retained_chat_media_refs()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.reject_untrusted_retained_chat_media_refs()', 'EXECUTE')
     or has_function_privilege('service_role', 'public.reject_untrusted_retained_chat_media_refs()', 'EXECUTE') then
    raise exception 'retained-media trigger function must not be executable through the Data API';
  end if;

end;
$assert$;

commit;

-- Make the newly created account-deletion RPCs visible to PostgREST.
notify pgrst, 'reload schema';
