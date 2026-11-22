-- Minimal isolated schema used only by the local Supabase integration job.
-- It deliberately models the CURRENT pre-migration chat schema (NOT NULL /
-- ON DELETE CASCADE). CI applies the real production migration after this file.
-- This fixture is disposable and must never be applied to a hosted project.

begin;

insert into storage.buckets (id, name, public)
values
  ('chat-media', 'chat-media', false),
  ('avatars', 'avatars', true),
  ('post-images', 'post-images', true)
on conflict (id) do update
  set public = excluded.public;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  role text not null default 'user'
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user1_id uuid not null constraint conversations_user1_id_fkey references public.profiles(id) on delete cascade,
  user2_id uuid not null constraint conversations_user2_id_fkey references public.profiles(id) on delete cascade,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  muted_by_user1 boolean default false,
  muted_by_user2 boolean default false,
  constraint conversations_users_different check (user1_id <> user2_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid not null constraint messages_sender_id_fkey references public.profiles(id) on delete cascade,
  text text,
  image_url text,
  audio_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

-- Production also has a nullable creator UUID without a profile FK in this table.
create table public.external_news (
  id uuid primary key default gen_random_uuid(),
  created_by uuid,
  cover_url text
);

-- Minimal content/support tables for the deletion preflight and write lock.
-- They deliberately start empty: the migration must refuse deletion when
-- retention-sensitive rows exist.
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade
);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade
);

create table public.ticket_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade
);

create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles(id) on delete cascade
);

create table public.action_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade
);

create table public.post_images (
  id uuid primary key default gen_random_uuid(),
  post_id uuid,
  url text not null,
  sort_order integer
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade
);

grant all on public.external_news to service_role;

-- Mirror the production message/conversation guards from
-- 20261133_chat_write_least_privilege.sql. The deletion hook below must be
-- SECURITY DEFINER owned by postgres so it can perform trusted anonymization.
create or replace function public.is_staff()
returns boolean
language sql
stable
set search_path = ''
as $function$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.role = any (array['admin'::text, 'moderator'::text])
  );
$function$;

create or replace function public.protect_conversation_fields()
returns trigger
language plpgsql
set search_path = ''
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if new.user1_id is distinct from old.user1_id
     or new.user2_id is distinct from old.user2_id then
    raise exception 'нельзя менять участников беседы';
  end if;

  if v_uid = old.user1_id then
    if new.muted_by_user2 is distinct from old.muted_by_user2 then
      raise exception 'нельзя менять настройки собеседника';
    end if;
  elsif v_uid = old.user2_id then
    if new.muted_by_user1 is distinct from old.muted_by_user1 then
      raise exception 'нельзя менять настройки собеседника';
    end if;
  else
    raise exception 'только участники беседы могут менять настройки';
  end if;

  return new;
end;
$function$;

create trigger conversations_protect_fields
  before update of user1_id, user2_id, muted_by_user1, muted_by_user2
  on public.conversations
  for each row execute function public.protect_conversation_fields();

create or replace function public.protect_message_fields()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if not public.is_staff() then
    if new.sender_id is distinct from old.sender_id then
      raise exception 'нельзя менять автора сообщения';
    end if;

    if new.conversation_id is distinct from old.conversation_id then
      raise exception 'нельзя переносить сообщение в другую беседу';
    end if;

    if new.created_at is distinct from old.created_at then
      raise exception 'нельзя менять дату создания сообщения';
    end if;
  end if;

  return new;
end;
$function$;

create trigger messages_protect_fields
  before update on public.messages
  for each row execute function public.protect_message_fields();

-- No anonymization trigger is created here. The production migration under
-- test must add it after converting the old cascade constraints.

-- A deliberately unlinked row models records whose access relies on the JWT
-- subject alone. It demonstrates why deleting auth.users does not itself
-- invalidate an already-issued access JWT before its exp claim expires.
create table public.ci_session_probe (
  owner_id uuid not null,
  marker text not null
);

alter table public.ci_session_probe enable row level security;

grant select on public.ci_session_probe to authenticated;
grant all on public.ci_session_probe to service_role;

drop policy if exists ci_session_probe_read_own on public.ci_session_probe;
create policy ci_session_probe_read_own
  on public.ci_session_probe
  for select
  to authenticated
  using (owner_id = (select auth.uid()));

-- Supabase manages ownership of storage.objects separately from public tables.
-- The CI fixture is executed using the disposable local supabase_admin role.
-- Never change the managed owner of storage.objects.
alter table storage.objects enable row level security;

grant usage on schema public to authenticated, service_role;
grant select on public.conversations, public.messages to authenticated;
grant insert on public.messages to authenticated;
grant all on public.profiles, public.conversations, public.messages to service_role;
grant all on public.posts, public.comments, public.tickets,
  public.ticket_messages, public.reports, public.action_log,
  public.notifications, public.post_images to service_role;

drop policy if exists ci_conversations_read_participant on public.conversations;
create policy ci_conversations_read_participant
  on public.conversations
  for select
  to authenticated
  using (
    user1_id = (select auth.uid())
    or user2_id = (select auth.uid())
  );

drop policy if exists ci_messages_read_participant on public.messages;
create policy ci_messages_read_participant
  on public.messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.conversations c
      where c.id = messages.conversation_id
        and (
          c.user1_id = (select auth.uid())
          or c.user2_id = (select auth.uid())
        )
    )
  );

drop policy if exists messages_insert_own on public.messages;
create policy messages_insert_own
  on public.messages
  for insert
  to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1
      from public.conversations c
      where c.id = messages.conversation_id
        and (
          c.user1_id = (select auth.uid())
          or c.user2_id = (select auth.uid())
        )
    )
  );

drop policy if exists ci_chat_media_insert_own_path on storage.objects;
create policy ci_chat_media_insert_own_path
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'chat-media'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists ci_avatars_insert_own_path on storage.objects;
create policy ci_avatars_insert_own_path
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists ci_post_images_insert_own_path on storage.objects;
create policy ci_post_images_insert_own_path
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'post-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
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
      from public.messages m
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

commit;
