-- 20261201_recovery_codes.sql
--
-- Восстановление пароля по резервным кодам — без почты и без SMTP.
--
-- Зачем: в проекте подтверждение email отключено, поэтому email_confirmed_at
-- у всех проставлен автоматически и НЕ доказывает владение ящиком. Значит,
-- восстановление через почту нельзя считать доверенным фактором, а SMTP не
-- должен быть обязательным условием доступа к аккаунту.
--
-- Что делаем:
--   1) закрытая схема private — PostgREST её не отдаёт, Data API её не видит;
--   2) таблица кодов: хранятся только HMAC-SHA-256, открытых кодов нет;
--   3) таблица попыток — для лимитов по IP и по имени;
--   4) функции в public, но с EXECUTE ТОЛЬКО у service_role: анонимный ключ
--      их не вызовет, а внутри private читать напрямую не может.
--
-- Важно: SECURITY INVOKER, а не DEFINER. Функции работают от имени
-- service_role и не обходят RLS «за кадром» — прав на private у других ролей
-- просто нет.
--
-- Идемпотентно.

-- ------------------------------------------------------------------ --
-- 1. Закрытая схема                                                 --
-- ------------------------------------------------------------------ --

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

-- ------------------------------------------------------------------ --
-- 2. Таблицы                                                        --
-- ------------------------------------------------------------------ --

create table if not exists private.recovery_codes (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- Один набор кодов = один batch: при перегенерации старый набор гасится
  batch_id    uuid not null,
  -- HMAC-SHA-256 (hex). Открытый код не хранится нигде
  code_hash   text not null,
  created_at  timestamptz not null default now(),
  used_at     timestamptz,
  revoked_at  timestamptz,
  used_ip_hash text,
  constraint recovery_codes_hash_unique unique (user_id, code_hash)
);

create index if not exists recovery_codes_active_idx
  on private.recovery_codes (user_id)
  where used_at is null and revoked_at is null;

create table if not exists private.recovery_attempts (
  id            bigserial primary key,
  ip_hash       text not null,
  username_hash text,
  success       boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists recovery_attempts_ip_idx
  on private.recovery_attempts (ip_hash, created_at desc);

create index if not exists recovery_attempts_user_idx
  on private.recovery_attempts (username_hash, created_at desc);

-- Никакого доступа ролям приложения
revoke all on all tables in schema private from public, anon, authenticated;
revoke all on all sequences in schema private from public, anon, authenticated;
grant all on all tables in schema private to service_role;
grant all on all sequences in schema private to service_role;

-- ------------------------------------------------------------------ --
-- 3. Функции (EXECUTE только у service_role)                        --
-- ------------------------------------------------------------------ --

-- Атомарное погашение кода. Один UPDATE ... RETURNING: при двух
-- параллельных запросах строка достанется только одному, второй получит false.
create or replace function public.consume_recovery_code(
  p_user_id uuid,
  p_code_hash text,
  p_ip_hash text default null
)
returns boolean
language sql
security invoker
set search_path = pg_catalog, private
as $$
  with consumed as (
    update private.recovery_codes
       set used_at = now(),
           used_ip_hash = p_ip_hash
     where user_id = p_user_id
       and code_hash = p_code_hash
       and used_at is null
       and revoked_at is null
    returning 1
  )
  select exists (select 1 from consumed);
$$;

-- Замена набора: старые активные коды гасятся, новые вставляются одним вызовом
create or replace function public.replace_recovery_codes(
  p_user_id uuid,
  p_hashes text[]
)
returns integer
language plpgsql
security invoker
set search_path = pg_catalog, private
as $$
declare
  v_batch uuid := gen_random_uuid();
  v_inserted integer := 0;
begin
  update private.recovery_codes
     set revoked_at = now()
   where user_id = p_user_id
     and used_at is null
     and revoked_at is null;

  insert into private.recovery_codes (user_id, batch_id, code_hash)
  select p_user_id, v_batch, h
    from unnest(p_hashes) as h;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- Сколько активных кодов осталось (для интерфейса)
create or replace function public.count_active_recovery_codes(p_user_id uuid)
returns integer
language sql
security invoker
set search_path = pg_catalog, private
as $$
  select count(*)::int
    from private.recovery_codes
   where user_id = p_user_id
     and used_at is null
     and revoked_at is null;
$$;

-- Запись попытки восстановления (для лимитов)
create or replace function public.log_recovery_attempt(
  p_ip_hash text,
  p_username_hash text,
  p_success boolean
)
returns void
language sql
security invoker
set search_path = pg_catalog, private
as $$
  insert into private.recovery_attempts (ip_hash, username_hash, success)
  values (p_ip_hash, p_username_hash, p_success);
$$;

-- Неудачные попытки за окно: по IP и по имени отдельно
create or replace function public.recovery_failures(
  p_ip_hash text,
  p_username_hash text,
  p_window_minutes integer
)
returns table (ip_failures integer, user_failures integer)
language sql
security invoker
set search_path = pg_catalog, private
as $$
  select
    (select count(*)::int
       from private.recovery_attempts a
      where a.ip_hash = p_ip_hash
        and a.success = false
        and a.created_at > now() - make_interval(mins => p_window_minutes)),
    (select count(*)::int
       from private.recovery_attempts a
      where a.username_hash = p_username_hash
        and a.success = false
        and a.created_at > now() - make_interval(mins => p_window_minutes));
$$;

-- Гашение всех сессий пользователя после смены пароля.
-- Access-token — JWT и живёт до истечения (~час), но продлить сессию
-- уже нельзя: refresh-токенов не останется.
create or replace function public.revoke_user_sessions(p_user_id uuid)
returns integer
language sql
security invoker
set search_path = pg_catalog
as $$
  with deleted as (
    delete from auth.sessions where user_id = p_user_id returning 1
  )
  select count(*)::int from deleted;
$$;

-- ------------------------------------------------------------------ --
-- 4. Права: только service_role                                     --
-- ------------------------------------------------------------------ --

revoke all on function public.consume_recovery_code(uuid, text, text) from public, anon, authenticated;
revoke all on function public.replace_recovery_codes(uuid, text[]) from public, anon, authenticated;
revoke all on function public.count_active_recovery_codes(uuid) from public, anon, authenticated;
revoke all on function public.log_recovery_attempt(text, text, boolean) from public, anon, authenticated;
revoke all on function public.recovery_failures(text, text, integer) from public, anon, authenticated;
revoke all on function public.revoke_user_sessions(uuid) from public, anon, authenticated;

grant execute on function public.consume_recovery_code(uuid, text, text) to service_role;
grant execute on function public.replace_recovery_codes(uuid, text[]) to service_role;
grant execute on function public.count_active_recovery_codes(uuid) to service_role;
grant execute on function public.log_recovery_attempt(text, text, boolean) to service_role;
grant execute on function public.recovery_failures(text, text, integer) to service_role;
grant execute on function public.revoke_user_sessions(uuid) to service_role;
