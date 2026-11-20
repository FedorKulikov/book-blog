-- 20261126_message_integrity_and_privilege_defaults.sql
--
-- Закрывает находки аудита PostgreSQL от 20.11.2026.
-- Дата — порядковый номер, а не календарь: он должен быть больше
-- предыдущих миграций (2026 1122…1125).
--
-- 1) Целостность переписки: участник мог переписать sender_id своего
--    сообщения на собеседника (RLS проверяет только участие в беседе,
--    а WITH CHECK на автора нельзя навесить — тот же UPDATE используется
--    для отметки «прочитано» на чужих сообщениях). Лечится триггером.
--
-- 2) DEFAULT PRIVILEGES: Supabase выдаёт полный набор прав на НОВЫЕ объекты
--    от имени postgres и supabase_admin. Значит, следующая созданная таблица
--    снова получила бы TRUNCATE у anon, а последовательность — UPDATE (setval).
--    Отзываем для обоих создателей.
--
-- 3) Существующие последовательности: отзываем UPDATE (это право на setval),
--    USAGE и SELECT оставляем — они нужны для nextval при вставке.
--
-- 4) Триггерные SECURITY DEFINER функции: через RPC они не вызываются
--    (Postgres запрещает), но EXECUTE у anon/authenticated лишний.
--    increment_post_views намеренно НЕ трогаем: без него не работает
--    счётчик просмотров.
--
-- Идемпотентно: можно применять повторно.

-- ------------------------------------------------------------------ --
-- 1. Целостность сообщений                                          --
-- ------------------------------------------------------------------ --

create or replace function public.protect_message_fields()
returns trigger
language plpgsql
as $$
begin
  -- staff может править всё: модерация и разбор жалоб
  if not public.is_staff() then
    if new.sender_id is distinct from old.sender_id then
      raise exception 'нельзя менять автора сообщения';
    end if;

    if new.conversation_id is distinct from old.conversation_id then
      raise exception 'нельзя переносить сообщение в другую беседу';
    end if;

    if new.created_at is distinct from old.created_at then
      raise exception 'нельзя менять дату создания сообщения';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists messages_protect_fields on public.messages;

create trigger messages_protect_fields
  before update on public.messages
  for each row execute function public.protect_message_fields();

-- ------------------------------------------------------------------ --
-- 2. Права на будущие объекты                                       --
-- ------------------------------------------------------------------ --

alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke update on sequences from anon, authenticated;

-- Для роли supabase_admin изменить defaults нельзя: наш пользователь
-- (postgres) не является её членом, а Supabase не даёт такой возможности.
-- Поэтому пробуем и, если прав нет, продолжаем — расхождение поймает
-- еженедельный security-check в CI, который сравнит фактические
-- default privileges с ожидаемым набором.
do $$
begin
  begin
    execute 'alter default privileges for role supabase_admin in schema public '
         || 'revoke truncate, references, trigger on tables from anon, authenticated';
  exception
    when insufficient_privilege then
      raise notice 'нет прав менять default privileges supabase_admin (таблицы) — пропущено';
  end;

  begin
    execute 'alter default privileges for role supabase_admin in schema public '
         || 'revoke update on sequences from anon, authenticated';
  exception
    when insufficient_privilege then
      raise notice 'нет прав менять default privileges supabase_admin (последовательности) — пропущено';
  end;
end;
$$;

-- ------------------------------------------------------------------ --
-- 3. Существующие последовательности                                --
-- ------------------------------------------------------------------ --

revoke update on all sequences in schema public from anon, authenticated;

-- ------------------------------------------------------------------ --
-- 4. EXECUTE у триггерных функций                                   --
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
      and p.prorettype = 'trigger'::regtype
  loop
    execute format(
      'revoke execute on function %s from anon, authenticated',
      fn.signature
    );
  end loop;
end;
$$;

-- ------------------------------------------------------------------ --
-- 5. MAINTAIN (PostgreSQL 17+): на 16-й версии инструкции нет       --
-- ------------------------------------------------------------------ --

do $$
begin
  execute 'revoke maintain on all tables in schema public from anon, authenticated';
exception
  when undefined_object or syntax_error then
    raise notice 'MAINTAIN недоступен на этой версии PostgreSQL — пропущено';
end;
$$;
