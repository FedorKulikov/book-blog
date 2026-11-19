-- ============================================================
-- Чистый старт для «Книжных новостей»: удаляем всё, что пришло из
-- магазинов (Литрес / Читай-город) — это были карточки товаров и
-- главные страницы, а не новости.
--
-- Выполнять в Supabase SQL Editor.
-- ============================================================

-- 1. Сколько удалим
select
  count(*) as total,
  count(*) filter (where source = 'Литрес') as litres_source,
  count(*) filter (where url ilike '%litres.ru%') as litres_url,
  count(*) filter (where url ilike '%chitai-gorod.ru%') as chitai_url
from public.external_news;

-- 2. Удаление
delete from public.external_news
where source = 'Литрес'
   or url ilike '%litres.ru%'
   or url ilike '%chitai-gorod.ru%';

-- 3. Что осталось
select source, count(*) as cnt
from public.external_news
group by source
order by cnt desc;
