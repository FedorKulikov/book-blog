-- 20261128_migration_ledger.sql
--
-- Реестр применённых миграций.
--
-- Зачем: миграции применяются через psql из GitHub Actions, а не через
-- Supabase CLI, поэтому схему supabase_migrations никто не создаёт и
-- история применения нигде не хранится. Без неё невозможно ответить,
-- применён ли конкретный файл, и легко применить его дважды.
--
-- Схема ops намеренно вне public: PostgREST отдаёт наружу только public,
-- поэтому служебная таблица через Data API недоступна.
--
-- Идемпотентно.

create schema if not exists ops;

create table if not exists ops.applied_migrations (
  filename   text primary key,
  checksum   text,
  applied_at timestamptz not null default now(),
  applied_by text default current_user
);

comment on table ops.applied_migrations is
  'История применённых SQL-миграций (заполняется workflow apply-migrations)';

-- Служебные данные не должны быть доступны ролям приложения
revoke all on schema ops from anon, authenticated, public;
revoke all on all tables in schema ops from anon, authenticated, public;

-- service_role (CI) должен видеть историю
grant usage on schema ops to service_role;
grant select, insert, update on ops.applied_migrations to service_role;
