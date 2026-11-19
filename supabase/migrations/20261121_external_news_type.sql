-- ============================================================
-- «Книжные новости»: тип контента (Новость / Анонс / Статья)
-- Картинки храним в уже существующей колонке cover_url.
--
-- Выполнять в Supabase SQL Editor. Скрипт идемпотентный.
-- ============================================================

alter table public.external_news
  add column if not exists news_type text;

comment on column public.external_news.news_type is
  'Тип материала: Новость | Анонс | Статья (для бейджа на карточке)';

-- Допустимые значения (мягко: null тоже разрешён для старых записей)
alter table public.external_news drop constraint if exists external_news_news_type_check;

alter table public.external_news
  add constraint external_news_news_type_check
  check (
    news_type is null
    or news_type in ('Новость', 'Анонс', 'Статья')
  );

-- Проверка
select news_type, count(*) as cnt
from public.external_news
group by news_type
order by cnt desc;
