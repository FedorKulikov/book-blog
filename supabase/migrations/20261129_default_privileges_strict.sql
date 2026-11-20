-- 20261129_default_privileges_strict.sql
--
-- Профилактика по итогам аудита: новые объекты должны рождаться закрытыми,
-- а не защищёнными «когда-нибудь потом созданными политиками».
--
-- 1) FUNCTIONS: в PostgreSQL EXECUTE по умолчанию выдан роли PUBLIC, поэтому
--    любая новая функция (в том числе SECURITY DEFINER) сразу доступна anon.
--    Отзываем у PUBLIC в default privileges роли postgres. Существующие
--    функции это не затрагивает — им права выдаются точечно (см. в конце
--    файла), новые же придётся открывать осознанно.
--
-- 2) TABLES: убираем у anon и authenticated права на НОВЫЕ таблицы целиком.
--    RLS на них включается автоматически (event trigger rls_auto_enable),
--    но теперь даже в случае ошибки в политике таблица не отдаёт данные:
--    до явного GRANT роль её просто не видит.
--
-- service_role не трогаем: он нужен CI и серверным скриптам.
--
-- Идемпотентно.

-- ------------------------------------------------------------------ --
-- 1. Функции: не выдавать EXECUTE роли PUBLIC по умолчанию          --
-- ------------------------------------------------------------------ --

alter default privileges for role postgres in schema public
  revoke execute on functions from public;

-- ------------------------------------------------------------------ --
-- 2. Таблицы: не выдавать права ролям приложения по умолчанию       --
-- ------------------------------------------------------------------ --

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;

-- Последовательности: USAGE нужен для nextval при вставке, но только
-- тем ролям, которым таблица доступна явно. По умолчанию не даём ничего.
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

-- ------------------------------------------------------------------ --
-- 3. Явные права для уже существующих RPC-функций                  --
-- ------------------------------------------------------------------ --
-- Вызовы, которые должны остаться доступны приложению: их держим явно,
-- чтобы после будущих правок не потерять.

grant execute on function public.increment_post_views(uuid) to anon, authenticated;
grant execute on function public.increment_book_views(uuid) to anon, authenticated;
grant execute on function public.is_staff() to anon, authenticated;
grant execute on function public.is_blocking(uuid) to anon, authenticated;
grant execute on function public.is_blocked_by_other(uuid) to anon, authenticated;
grant execute on function public.count_unread_messages() to anon, authenticated;
grant execute on function public.create_ticket(text, text, text) to authenticated;
grant execute on function public.get_or_create_conversation(uuid) to authenticated;
grant execute on function public.check_and_log_action(text, integer, integer) to authenticated;
