-- ============================================================
-- «Книжные новости»: удаляем иностранные записи из external_news.
--
-- Правило (совпадает с фильтром в scripts/fetch-rss-news.ts):
--   заголовок считается русским, если в нём минимум 3 буквы кириллицы
--   И кириллицы не меньше, чем латиницы.
-- Простого «есть хоть одна кириллическая буква» мало: немецкие книги
-- проходят его из-за «и др.» в названии.
--
-- Выполнять в Supabase SQL Editor (RLS не мешает: редактор работает
-- от имени владельца базы).
-- ============================================================

-- 1. Что удалим и что останется (сухой прогон)
with counted as (
  select
    id,
    title,
    length(regexp_replace(coalesce(title, ''), '[^а-яА-ЯёЁ]', '', 'g')) as cyr,
    length(regexp_replace(coalesce(title, ''), '[^a-zA-Z]', '', 'g')) as lat
  from public.external_news
)
select
  count(*) as total,
  count(*) filter (where cyr >= 3 and cyr >= lat) as russian,
  count(*) filter (where cyr < 3 or cyr < lat) as foreign
from counted;

-- 2. Удаление
with counted as (
  select
    id,
    length(regexp_replace(coalesce(title, ''), '[^а-яА-ЯёЁ]', '', 'g')) as cyr,
    length(regexp_replace(coalesce(title, ''), '[^a-zA-Z]', '', 'g')) as lat
  from public.external_news
)
delete from public.external_news e
using counted c
where e.id = c.id
  and (c.cyr < 3 or c.cyr < c.lat);

-- 3. Контроль после удаления
select count(*) as total_left
from public.external_news;
