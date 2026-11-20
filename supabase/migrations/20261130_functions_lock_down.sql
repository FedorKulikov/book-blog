-- 20261130_functions_lock_down.sql
--
-- Почему одного ALTER DEFAULT PRIVILEGES недостаточно.
--
-- Проверка показала: после
--   alter default privileges for role postgres in schema public
--     revoke execute on functions from public;
-- новая функция всё равно отвечает has_function_privilege('anon', …, 'EXECUTE') = true.
-- Причина: у функций встроенное право EXECUTE для роли PUBLIC, и оно не
-- убирается настройкой default privileges — ни отзывом у PUBLIC,
-- ни отзывом у anon/authenticated.
--
-- Единственный надёжный способ — отзывать право на самой функции сразу
-- после её создания. Делаем это event-триггером (в базе уже есть такой же
-- приём: rls_auto_enable включает RLS на новых таблицах).
--
-- Последствия: новая функция становится доступна только владельцу, пока ей
-- явно не выдадут EXECUTE. Это и есть нужная модель «закрыто по умолчанию».
-- Существующие функции не страдают: у публичных RPC права выданы явно
-- (миграция 20261129), а триггерные отозваны ранее.

-- ------------------------------------------------------------------ --
-- 1. Event-триггер: закрывать новые функции                         --
-- ------------------------------------------------------------------ --

create or replace function public.functions_lock_down()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  cmd record;
begin
  for cmd in
    select object_identity
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE FUNCTION', 'CREATE PROCEDURE')
  loop
    begin
      execute format(
        'revoke execute on function %s from public',
        cmd.object_identity
      );
    exception
      when undefined_object then
        -- Процедуры и функции различаются в разных версиях: не валим DDL из-за этого
        raise notice 'не удалось снять EXECUTE с %', cmd.object_identity;
    end;
  end loop;
end;
$$;

drop event trigger if exists functions_lock_down;

create event trigger functions_lock_down
  on ddl_command_end
  when tag in ('CREATE FUNCTION', 'CREATE PROCEDURE')
  execute function public.functions_lock_down();

-- ------------------------------------------------------------------ --
-- 2. Существующие функции: снять встроенное право PUBLIC            --
-- ------------------------------------------------------------------ --
-- Явные GRANT для публичных RPC (is_staff, increment_*_views, create_ticket
-- и прочие из 20261129) остаются в силе: это отдельные записи в ACL.

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke execute on function %s from public', fn.signature);
  end loop;
end;
$$;

-- Сам event-триггер тоже триггерная функция — право PUBLIC у неё не нужно
revoke execute on function public.functions_lock_down() from public;
