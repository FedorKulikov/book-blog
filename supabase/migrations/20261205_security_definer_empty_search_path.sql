-- 20261205_security_definer_empty_search_path.sql
--
-- Все SECURITY DEFINER функции в public переводим на пустой search_path.
-- Перед изменением проверены их тела:
--   • таблицы/схемы указаны явно (public.*, auth.*);
--   • динамический SQL для rate limit строится с public.%I;
--   • event-trigger helper использует встроенные pg_catalog функции.
--
-- Это касается внутренних триггерных функций и DDL event triggers, которые
-- не вызываются через Data API. Гранты EXECUTE, определения функций,
-- триггеры и пользовательская логика не меняются.
--
-- Идемпотентно.

begin;

do $migration$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not (coalesce(p.proconfig, array[]::text[]) @> array['search_path=""'])
  loop
    execute format('alter function %s set search_path = %L', fn.signature, '');
  end loop;
end;
$migration$;

do $assert$
declare
  v_count integer;
begin
  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and not (coalesce(p.proconfig, array[]::text[]) @> array['search_path=""']);

  if v_count <> 0 then
    raise exception '% SECURITY DEFINER public functions still have a non-empty search_path', v_count;
  end if;
end;
$assert$;

commit;
