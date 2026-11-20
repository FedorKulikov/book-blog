-- 20261131_functions_lock_down_fix.sql
--
-- Исправление к 20261130.
--
-- В 20261130 event-триггер отзывал EXECUTE только у роли PUBLIC, и этого
-- оказалось мало: в default privileges Supabase есть ЯВНАЯ запись
-- anon=X и authenticated=X, поэтому новая функция получает право
-- из этой записи независимо от PUBLIC.
--
-- Проверка после 20261130: has_function_privilege('anon', новая функция,
-- 'EXECUTE') = true — то есть функция оставалась доступной анонимно.
--
-- Теперь триггер отзывает право у public, anon и authenticated сразу.
-- Публичные RPC по-прежнему открываются явным GRANT уже после создания.

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
        'revoke execute on function %s from public, anon, authenticated',
        cmd.object_identity
      );
    exception
      when undefined_object then
        raise notice 'не удалось снять EXECUTE с %', cmd.object_identity;
    end;
  end loop;
end;
$$;

revoke execute on function public.functions_lock_down() from public, anon, authenticated;
