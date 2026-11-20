-- ============================================================
-- «Книжный радар»: третий вид тренда — книжные названия.
--
-- Было: kind in ('theme','name'). Темы и имена ловились, а названия книг
-- в кавычках («Мастер и Маргарита») — нет, поэтому трендов набиралось мало.
--
-- Выполнять в Supabase SQL Editor. Скрипт идемпотентный.
-- ============================================================

alter table public.news_trends
  drop constraint if exists news_trends_kind_check;

alter table public.news_trends
  add constraint news_trends_kind_check
  check (kind in ('theme', 'name', 'book'));

comment on column public.news_trends.kind is
  'Вид тренда: theme (тема) | name (имя) | book (название книги в кавычках)';

-- Проверка
select kind, count(*) as cnt
from public.news_trends
group by kind
order by cnt desc;
