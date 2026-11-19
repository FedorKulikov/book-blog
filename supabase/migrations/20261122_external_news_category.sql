-- ============================================================
-- «Книжный портал»: рубрика для автоматически импортируемых новостей.
--
-- Рубрики совпадают с фильтрами страницы /news:
--   news      — Новости          (что происходит в книжном мире)
--   new_book  — Новинки          (вышли новые книги)
--   event     — События          (встречи, ярмарки, презентации)
--   publisher — Издательства     (новости издательств)
--   Конкурсы (contest) намеренно НЕ автоматизируем.
--
-- Выполнять в Supabase SQL Editor. Скрипт идемпотентный.
-- ============================================================

alter table public.external_news
  add column if not exists news_category text;

comment on column public.external_news.news_category is
  'Рубрика книжного портала: news | new_book | event | publisher (NULL — вне рубрик)';

alter table public.external_news
  drop constraint if exists external_news_news_category_check;

alter table public.external_news
  add constraint external_news_news_category_check
  check (
    news_category is null
    or news_category in ('news', 'new_book', 'event', 'publisher')
  );

-- Фильтр ленты /news идёт по рубрике + дате
create index if not exists external_news_category_created_idx
  on public.external_news (news_category, created_at desc);

-- Проверка
select news_category, count(*) as cnt
from public.external_news
group by news_category
order by cnt desc;
