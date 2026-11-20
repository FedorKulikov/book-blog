-- 20261125_grant_hardening.sql
--
-- Ужесточение прав на таблицах public.
--
-- Зачем: Supabase по умолчанию выдаёт ролям anon и authenticated полный набор
-- привилегий на таблицы публичной схемы. RLS ограничивает SELECT/INSERT/
-- UPDATE/DELETE, но НЕ ограничивает TRUNCATE — усечение таблицы выполняется
-- в обход политик. Проверка показала: под ролью anon проходил
-- `truncate public.external_news`.
--
-- Что делаем:
--   1) забираем TRUNCATE/REFERENCES/TRIGGER у anon и authenticated;
--   2) у external_news оставляем anon только чтение — пишет туда лишь
--      service_role из CI;
--   3) запись для authenticated возвращаем, потому что редактор русских
--      заголовков в админке ходит под пользователем, а политики
--      external_news_insert_staff / update_staff уже ограничивают доступ
--      ролью admin|moderator.
--
-- Идемпотентно: можно применять повторно.

revoke truncate, references, trigger on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;

revoke insert, update, delete on public.external_news from anon;

grant select on public.external_news to anon;

grant insert, update, delete on public.external_news to authenticated;
