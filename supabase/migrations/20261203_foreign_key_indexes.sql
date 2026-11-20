-- 20261203_foreign_key_indexes.sql
--
-- Добавляет ведущие B-tree индексы для внешних ключей, которые не были
-- покрыты существующими индексами.
--
-- Индексы нужны не только для JOIN/фильтрации, но и для проверок FK при
-- DELETE/UPDATE родительской записи (ON DELETE CASCADE/SET NULL).
-- Составные индексы с нужным FK первым столбцом повторно не создаются.
--
-- Все таблицы проекта сейчас небольшие; обычный CREATE INDEX выполняется
-- без долгой конкурентной перестройки. Идемпотентно.

begin;

create index if not exists post_images_post_id_idx
  on public.post_images (post_id);

create index if not exists likes_post_id_idx
  on public.likes (post_id);

create index if not exists reports_comment_id_idx
  on public.reports (comment_id);

create index if not exists reports_post_id_idx
  on public.reports (post_id);

create index if not exists reports_reporter_id_idx
  on public.reports (reporter_id);

create index if not exists post_tags_tag_id_idx
  on public.post_tags (tag_id);

create index if not exists follows_following_id_idx
  on public.follows (following_id);

create index if not exists books_created_by_idx
  on public.books (created_by);

create index if not exists messages_sender_id_idx
  on public.messages (sender_id);

create index if not exists notifications_actor_id_idx
  on public.notifications (actor_id);

create index if not exists notifications_comment_id_idx
  on public.notifications (comment_id);

create index if not exists notifications_message_id_idx
  on public.notifications (message_id);

create index if not exists notifications_post_id_idx
  on public.notifications (post_id);

-- Используется и для FK notifications_user_id, и для списка уведомлений
-- пользователя, отсортированного по времени (NotificationBell).
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

create index if not exists bookmarks_post_id_idx
  on public.bookmarks (post_id);

create index if not exists ticket_messages_sender_id_idx
  on public.ticket_messages (sender_id);

create index if not exists external_news_created_by_idx
  on public.external_news (created_by);

-- Убедиться, что все ранее отсутствовавшие FK теперь имеют ведущий индекс.
do $assert$
declare
  v_missing text;
begin
  select string_agg(c.conrelid::regclass::text || '.' || c.conname, ', ' order by c.conrelid::regclass::text, c.conname)
    into v_missing
  from pg_constraint c
  where c.contype = 'f'
    and c.connamespace = 'public'::regnamespace
    and not exists (
      select 1
      from pg_index i
      where i.indrelid = c.conrelid
        and i.indisvalid
        and i.indisready
        and i.indpred is null
        and i.indnkeyatts >= cardinality(c.conkey)
        and (
          select array_agg(k.attnum order by k.ord)
          from unnest(c.conkey) with ordinality k(attnum, ord)
        ) = (
          select array_agg(k.attnum order by k.ord)
          from unnest(i.indkey::smallint[]) with ordinality k(attnum, ord)
          where k.ord <= cardinality(c.conkey)
        )
    );

  if v_missing is not null then
    raise exception 'unindexed foreign keys remain: %', v_missing;
  end if;
end;
$assert$;

commit;
