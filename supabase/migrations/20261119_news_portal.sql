-- ============================================================
-- «Книжный информационный портал»: категории, дедлайны, источники
-- Применять в Supabase SQL Editor. Скрипт идемпотентный:
-- повторный запуск ничего не сломает.
-- ============================================================

-- 1. Новые колонки -------------------------------------------------
alter table public.posts
  add column if not exists news_category text,
  add column if not exists deadline_at  timestamptz,
  add column if not exists source_url   text;

comment on column public.posts.news_category is
  'Категория новости: news | contest | new_book | event | publisher';
comment on column public.posts.deadline_at is
  'Дедлайн конкурса или мероприятия (timestamptz)';
comment on column public.posts.source_url is
  'Ссылка на первоисточник новости';

-- 2. Допустимые категории ------------------------------------------
-- 'publisher' добавлен для кнопки «Издательства» в фильтре портала:
-- это новости издательств, отдельная витрина.
alter table public.posts drop constraint if exists posts_news_category_check;

alter table public.posts
  add constraint posts_news_category_check
  check (
    news_category is null
    or news_category in ('news', 'contest', 'new_book', 'event', 'publisher')
  );

-- 3. Ссылка на источник — только http(s) ---------------------------
alter table public.posts drop constraint if exists posts_source_url_check;

alter table public.posts
  add constraint posts_source_url_check
  check (source_url is null or source_url ~* '^https?://[^[:space:]]+$');

-- 4. Дедлайн имеет смысл только у конкурсов и мероприятий ----------
alter table public.posts drop constraint if exists posts_deadline_check;

alter table public.posts
  add constraint posts_deadline_check
  check (
    deadline_at is null
    or news_category in ('contest', 'event')
  );

-- 5. Индексы под ленту новостей и фильтры --------------------------
-- Партиальные: индексы касаются только новостей, остальные типы постов
-- (creative/discussion) не раздувают структуру.
create index if not exists posts_news_feed_idx
  on public.posts (created_at desc)
  where type = 'news' and status = 'approved';

create index if not exists posts_news_category_idx
  on public.posts (news_category, created_at desc)
  where type = 'news' and status = 'approved';

-- ============================================================
-- ПРОВЕРКА (только чтение, ничего не меняет).
-- Ожидаем: anon читает approved-новости, писать может только автор/staff.
-- ============================================================
-- select polname, polcmd, polroles::regrole[] as roles,
--        pg_get_expr(polqual, polrelid) as using_expr,
--        pg_get_expr(polwithcheck, polrelid) as check_expr
-- from pg_policy
-- where polrelid = 'public.posts'::regclass
-- order by polcmd, polname;

-- Если политики на SELECT для anon нет — добавить явную:
-- (у нас она уже есть, иначе лента на сайте не открывалась бы анонимно)
-- create policy "posts_public_read_approved_news"
--   on public.posts for select
--   to anon, authenticated
--   using (status = 'approved');
