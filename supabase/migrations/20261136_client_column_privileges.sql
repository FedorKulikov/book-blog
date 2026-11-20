-- 20261136_client_column_privileges.sql
--
-- Least-privilege для клиентского Data API.
--
-- RLS уже ограничивает строки, но table-level DML grants позволяли
-- передавать системные поля в INSERT/UPDATE: created_at, read_at, views_count,
-- status и другие поля, которые должны контролироваться БД или staff.
-- В частности, подмена created_at обходила rate-limit триггеры на posts,
-- comments и likes.
--
-- Оставляем SELECT у anon; весь DML закрываем по умолчанию и выдаём
-- authenticated только нужные таблицы/колонки. service_role не меняется.
-- Админские действия остаются за RLS + защитными триггерами.
--
-- Проверены вызовы приложения:
--   profile edit/onboarding, book creation, post create/edit, comments,
--   likes/follows/bookmarks, chat, notifications, reports, support,
--   tags/stop_words и external news.
--
-- Идемпотентно.

begin;

-- ------------------------------------------------------------------ --
-- 1. DML закрыт для anon и authenticated по умолчанию                 --
-- ------------------------------------------------------------------ --

revoke insert, update, delete on all tables in schema public
  from public, anon, authenticated;

-- У anon остаётся только публичное чтение. Ни одна запись в приложении
-- не должна быть доступна без Auth-сессии.
-- (SELECT grants intentionally unchanged.)

-- ------------------------------------------------------------------ --
-- 2. INSERT privileges: только поля, которые клиент вправе задавать  --
-- ------------------------------------------------------------------ --

grant insert (user_id, action)
  on public.action_log to authenticated;

grant insert (user_id, post_id)
  on public.bookmarks to authenticated;

grant insert (title, author, year, description, cover_url, created_by)
  on public.books to authenticated;

grant insert (post_id, user_id, parent_id, text)
  on public.comments to authenticated;

-- get_or_create_conversation() inserts only these participant columns.
grant insert (user1_id, user2_id)
  on public.conversations to authenticated;

grant insert (title, url, source, summary, created_by)
  on public.external_news to authenticated;

grant insert (follower_id, following_id)
  on public.follows to authenticated;

grant insert (user_id, post_id)
  on public.likes to authenticated;

grant insert (conversation_id, sender_id, text, image_url, audio_url, audio_duration)
  on public.messages to authenticated;

grant insert (post_id, url, sort_order)
  on public.post_images to authenticated;

grant insert (post_id, tag_id)
  on public.post_tags to authenticated;

grant insert (user_id, title, content, type, book_id, news_category, deadline_at, source_url)
  on public.posts to authenticated;

grant insert (reporter_id, post_id, comment_id, reason)
  on public.reports to authenticated;

grant insert (word)
  on public.stop_words to authenticated;

grant insert (name, slug)
  on public.tags to authenticated;

grant insert (ticket_id, sender_id, message, is_staff_reply)
  on public.ticket_messages to authenticated;

-- create_ticket() writes only these ticket columns.
grant insert (user_id, subject, category)
  on public.tickets to authenticated;

grant insert (blocker_id, blocked_id)
  on public.user_blocks to authenticated;

-- ------------------------------------------------------------------ --
-- 3. UPDATE privileges: only editable profile/content/state columns   --
-- ------------------------------------------------------------------ --

grant update (bio, username, avatar_url, notifications_muted, onboarding_completed_at, role, is_banned)
  on public.profiles to authenticated;

grant update (title, author, year, description, cover_url)
  on public.books to authenticated;

grant update (title, content, type, book_id, news_category, deadline_at, source_url, status, rejection_reason)
  on public.posts to authenticated;

-- Only recipients may change read_at; row guard remains in place.
grant update (read_at)
  on public.messages to authenticated;

grant update (muted_by_user1, muted_by_user2)
  on public.conversations to authenticated;

grant update (is_read)
  on public.notifications to authenticated;

-- Staff UI only edits the translated title and report/ticket statuses.
grant update (title_ru)
  on public.external_news to authenticated;

grant update (status)
  on public.reports to authenticated;

grant update (status)
  on public.tickets to authenticated;

-- Comments, likes, follows, bookmarks, post_images/post_tags, user_blocks,
-- action_log, tags, stop_words and ticket_messages have no client UPDATE flow.

-- ------------------------------------------------------------------ --
-- 4. DELETE privileges: operations present in the UI, still RLS-scoped --
-- ------------------------------------------------------------------ --

grant delete on public.bookmarks to authenticated;
grant delete on public.comments to authenticated;
grant delete on public.conversations to authenticated;
grant delete on public.external_news to authenticated;
grant delete on public.follows to authenticated;
grant delete on public.likes to authenticated;
grant delete on public.messages to authenticated;
grant delete on public.post_images to authenticated;
grant delete on public.post_tags to authenticated;
grant delete on public.posts to authenticated;
grant delete on public.stop_words to authenticated;
grant delete on public.user_blocks to authenticated;

-- ------------------------------------------------------------------ --
-- 5. Correct ownership condition for book creation                  --
-- ------------------------------------------------------------------ --

drop policy if exists books_insert_auth on public.books;
drop policy if exists books_insert_own on public.books;

create policy books_insert_own
  on public.books
  for insert
  to authenticated
  with check (created_by = (select auth.uid()));

-- Tags are shared vocabulary, but creating one still requires a real session.
drop policy if exists tags_insert_auth on public.tags;
create policy tags_insert_auth
  on public.tags
  for insert
  to authenticated
  with check ((select auth.uid()) is not null);

-- ------------------------------------------------------------------ --
-- 6. Notification read state is monotonic: read cannot be undone       --
-- ------------------------------------------------------------------ --

create or replace function public.protect_notification_read_state()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if current_user in ('postgres', 'service_role') then
    return new;
  end if;

  if old.is_read is true and new.is_read is false then
    raise exception 'нельзя сбрасывать отметку прочтения уведомления'
      using errcode = '42501';
  end if;

  return new;
end;
$function$;

revoke execute on function public.protect_notification_read_state() from public, anon, authenticated;

drop trigger if exists notifications_protect_read_state on public.notifications;
create trigger notifications_protect_read_state
  before update of is_read on public.notifications
  for each row execute function public.protect_notification_read_state();

-- ------------------------------------------------------------------ --
-- 7. Assertions: миграция падает, если не закрыла критические права   --
-- ------------------------------------------------------------------ --

do $function$
declare
  v_table record;
begin
  for v_table in
    select format('%I.%I', schemaname, tablename) as fqtn
    from pg_tables
    where schemaname = 'public'
  loop
    if has_table_privilege('anon', v_table.fqtn, 'INSERT')
       or has_table_privilege('anon', v_table.fqtn, 'UPDATE')
       or has_table_privilege('anon', v_table.fqtn, 'DELETE') then
      raise exception 'anon retains DML privileges on %', v_table.fqtn;
    end if;
  end loop;

  if has_column_privilege('authenticated', 'public.books', 'created_at', 'INSERT')
     or has_column_privilege('authenticated', 'public.books', 'views_count', 'INSERT')
     or has_column_privilege('authenticated', 'public.posts', 'created_at', 'INSERT')
     or has_column_privilege('authenticated', 'public.posts', 'views_count', 'INSERT')
     or has_column_privilege('authenticated', 'public.posts', 'status', 'INSERT')
     or has_column_privilege('authenticated', 'public.comments', 'created_at', 'INSERT')
     or has_column_privilege('authenticated', 'public.likes', 'created_at', 'INSERT')
     or has_column_privilege('authenticated', 'public.messages', 'created_at', 'INSERT')
     or has_column_privilege('authenticated', 'public.messages', 'read_at', 'INSERT')
     or has_column_privilege('authenticated', 'public.reports', 'status', 'INSERT')
     or has_column_privilege('authenticated', 'public.tickets', 'status', 'INSERT')
     or has_column_privilege('authenticated', 'public.ticket_messages', 'created_at', 'INSERT') then
    raise exception 'authenticated can still set protected system columns on INSERT';
  end if;

  if has_column_privilege('authenticated', 'public.profiles', 'created_at', 'UPDATE')
     or has_column_privilege('authenticated', 'public.posts', 'created_at', 'UPDATE')
     or has_column_privilege('authenticated', 'public.posts', 'views_count', 'UPDATE')
     or has_column_privilege('authenticated', 'public.notifications', 'actor_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.notifications', 'type', 'UPDATE')
     or has_column_privilege('authenticated', 'public.messages', 'text', 'UPDATE')
     or has_column_privilege('authenticated', 'public.messages', 'sender_id', 'UPDATE') then
    raise exception 'authenticated retains excessive UPDATE column privileges';
  end if;

  if not has_column_privilege('authenticated', 'public.profiles', 'bio', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.posts', 'title', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.messages', 'read_at', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.notifications', 'is_read', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.tickets', 'status', 'UPDATE')
     or not has_column_privilege('authenticated', 'public.books', 'title', 'INSERT')
     or not has_column_privilege('authenticated', 'public.comments', 'text', 'INSERT')
     or not has_column_privilege('authenticated', 'public.messages', 'text', 'INSERT') then
    raise exception 'authenticated lost a required application column privilege';
  end if;

  if not has_table_privilege('service_role', 'public.posts', 'INSERT')
     or not has_table_privilege('service_role', 'public.posts', 'UPDATE')
     or not has_table_privilege('service_role', 'public.posts', 'DELETE') then
    raise exception 'service_role privileges were unexpectedly changed';
  end if;
end;
$function$;

commit;
