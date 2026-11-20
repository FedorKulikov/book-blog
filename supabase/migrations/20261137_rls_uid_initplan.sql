-- 20261137_rls_uid_initplan.sql
--
-- Оптимизация RLS по рекомендации Supabase Database Advisor.
-- В policy-выражениях прямой вызов auth.uid() может вычисляться для каждой
-- проверяемой строки. Оборачиваем вызов в scalar subquery:
--   auth.uid()  ->  (select auth.uid())
-- PostgreSQL может вычислить такое значение один раз на запрос (InitPlan).
--
-- Меняем только выражения политик public, в которых auth.uid() ещё не
-- находится внутри SELECT. Роли, USING/WITH CHECK логика и тип политики
-- остаются прежними.
--
-- Идемпотентно: уже оптимизированные выражения пропускаются.

begin;

do $migration$
declare
  pol record;
  v_using text;
  v_check text;
  v_stmt text;
  v_changed integer := 0;
begin
  for pol in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (
        (
          qual is not null
          and qual ~* 'auth\.uid\(\)'
          and qual !~* 'SELECT[[:space:]]+auth\.uid\(\)'
        )
        or
        (
          with_check is not null
          and with_check ~* 'auth\.uid\(\)'
          and with_check !~* 'SELECT[[:space:]]+auth\.uid\(\)'
        )
      )
    order by tablename, policyname
  loop
    v_using := case
      when pol.qual is null then null
      else replace(pol.qual, 'auth.uid()', '(select auth.uid())')
    end;

    v_check := case
      when pol.with_check is null then null
      else replace(pol.with_check, 'auth.uid()', '(select auth.uid())')
    end;

    v_stmt := format(
      'alter policy %I on %I.%I',
      pol.policyname,
      pol.schemaname,
      pol.tablename
    );

    if v_using is not null then
      v_stmt := v_stmt || format(' using (%s)', v_using);
    end if;

    if v_check is not null then
      v_stmt := v_stmt || format(' with check (%s)', v_check);
    end if;

    execute v_stmt;
    v_changed := v_changed + 1;
  end loop;

  raise notice 'RLS auth.uid() initplan optimization updated % policies', v_changed;
end;
$migration$;

-- Миграция не должна оставлять прямые, не обёрнутые вызовы auth.uid().
do $migration$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and (
        (
          qual is not null
          and qual ~* 'auth\.uid\(\)'
          and qual !~* 'SELECT[[:space:]]+auth\.uid\(\)'
        )
        or
        (
          with_check is not null
          and with_check ~* 'auth\.uid\(\)'
          and with_check !~* 'SELECT[[:space:]]+auth\.uid\(\)'
        )
      )
  ) then
    raise exception 'RLS policies still contain unwrapped auth.uid() calls';
  end if;
end;
$migration$;

commit;
