-- 20261132_search_path_hardening.sql
--
-- Рекомендация аудита: SECURITY DEFINER функции должны иметь фиксированный
-- search_path. Иначе вызывающий может подсунуть свою схему в путь поиска
-- и подменить объект, к которому функция обращается с правами владельца.
--
-- Ставим явный путь pg_catalog, public: системные функции и наши таблицы,
-- без неявного $user и без временных схем. Все тела уже обращаются к таблицам
-- через public.* и к auth.* с квалификацией, поэтому поведение не меняется.
--
-- Новые функции этот файл не покрывает: их надо закрывать при создании.
-- Такую проверку добавили в security-check (предупреждение).

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef = true
      and p.proconfig is null
  loop
    execute format(
      'alter function %s set search_path = pg_catalog, public',
      fn.signature
    );
  end loop;
end;
$$;
