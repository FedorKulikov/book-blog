-- 20261127_function_execute_and_maintain.sql
--
-- Дополнение к 20261126: два хвоста, найденные проверкой.
--
-- 1) EXECUTE у функций по умолчанию выдан роли PUBLIC, поэтому простой
--    `revoke execute ... from anon` ничего не менял: право приходило через
--    PUBLIC. Отзываем у PUBLIC, но ТОЛЬКО у триггерных и событийных функций:
--    вызвать их напрямую всё равно нельзя, а лишнее право ни к чему.
--
--    Хелперы, которые вызываются из RLS-политик (is_staff, is_blocking,
--    is_blocked_by_other) и RPC-функции (increment_*_views, create_ticket,
--    get_or_create_conversation, check_and_log_action, count_unread_messages)
--    НЕ трогаем: без EXECUTE политики и счётчики просмотров сломаются.
--
-- 2) В default privileges таблиц остался MAINTAIN (PostgreSQL 17+).
--    Право не про доступ к данным, но лишнее — отзываем.
--
-- Идемпотентно.

-- ------------------------------------------------------------------ --
-- 1. EXECUTE у триггерных и событийных функций                      --
-- ------------------------------------------------------------------ --

do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype in ('trigger'::regtype, 'event_trigger'::regtype)
  loop
    execute format('revoke execute on function %s from public', fn.signature);
    execute format('revoke execute on function %s from anon, authenticated', fn.signature);
  end loop;
end;
$$;

-- ------------------------------------------------------------------ --
-- 2. MAINTAIN в default privileges                                  --
-- ------------------------------------------------------------------ --

do $$
begin
  execute 'alter default privileges for role postgres in schema public '
       || 'revoke maintain on tables from anon, authenticated';
exception
  when undefined_object or syntax_error then
    raise notice 'MAINTAIN недоступен на этой версии PostgreSQL — пропущено';
end;
$$;

do $$
begin
  execute 'revoke maintain on all tables in schema public from anon, authenticated';
exception
  when undefined_object or syntax_error then
    raise notice 'MAINTAIN недоступен для существующих таблиц — пропущено';
end;
$$;
