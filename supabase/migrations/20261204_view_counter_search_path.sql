-- 20261204_view_counter_search_path.sql
--
-- Последняя SECURITY DEFINER RPC в public с search_path=public —
-- increment_book_views(uuid). Все используемые таблицы уже квалифицированы
-- как public.books, встроенные COALESCE/UPDATE не требуют public в search_path.
-- Пустой путь исключает неявное разрешение объектов из схемы public.
--
-- Поведение RPC и grants для публичного счётчика не меняются.

begin;

alter function public.increment_book_views(uuid) set search_path = '';

do $assert$
declare
  v_config text[];
begin
  select proconfig into v_config
  from pg_proc
  where oid = 'public.increment_book_views(uuid)'::regprocedure;

  if not ('search_path=' = any(v_config)) then
    raise exception 'increment_book_views must use an empty search_path';
  end if;

  if not has_function_privilege('anon', 'public.increment_book_views(uuid)'::regprocedure, 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.increment_book_views(uuid)'::regprocedure, 'EXECUTE') then
    raise exception 'public book view counter grants must remain unchanged';
  end if;
end;
$assert$;

commit;
