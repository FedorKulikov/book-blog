-- Minimal isolated schema used only by the local Supabase integration job.
-- It models the relationship changes required by account deletion; it is not a
-- production migration and must never be applied to a hosted project.

begin;

insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', false)
on conflict (id) do update
  set public = false;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user1_id uuid references public.profiles(id) on delete set null,
  user2_id uuid references public.profiles(id) on delete set null,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint conversations_keep_at_least_one_participant
    check (user1_id is not null or user2_id is not null)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id uuid references public.profiles(id) on delete set null,
  sender_label text not null default 'Удалённый пользователь',
  text text,
  image_url text,
  audio_url text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

-- Supabase manages ownership of storage.objects separately from public tables.
-- Create the test policies as its owner rather than changing managed ownership.
set local role supabase_storage_admin;
alter table storage.objects enable row level security;

grant usage on schema public to authenticated, service_role;
grant select on public.conversations, public.messages to authenticated;
grant insert on public.messages to authenticated;
grant all on public.profiles, public.conversations, public.messages to service_role;

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

drop policy if exists ci_messages_insert_own on public.messages;
create policy ci_messages_insert_own
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

drop policy if exists ci_chat_media_select_conversation_participants on storage.objects;
create policy ci_chat_media_select_conversation_participants
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'chat-media'
    and exists (
      select 1
      from public.messages m
      join public.conversations c on c.id = m.conversation_id
      where (
        c.user1_id = (select auth.uid())
        or c.user2_id = (select auth.uid())
      )
      and (
        m.image_url = storage.objects.name
        or m.audio_url = storage.objects.name
      )
    )
  );

reset role;

commit;
