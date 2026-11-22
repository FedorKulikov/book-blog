-- 20261209_personal_data_consents.sql
--
-- Отдельная фиксация согласий на распространение персональных данных
-- по двум независимым основаниям продукта:
--   • profile_public — публичные поля профиля;
--   • publication    — пользовательские публикации.
--
-- Таблица находится в private, прямой доступ к ней закрыт для всех API-ролей.
-- Запись и отзыв выполняются только через SECURITY DEFINER RPC для service_role.
--
-- Идемпотентно: повторное применение не создаёт повторную таблицу/индекс
-- и безопасно заменяет определения двух функций.

begin;

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;

create table if not exists private.personal_data_consents (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  scope            text not null,
  document_version text not null,
  data_categories  text[] not null,
  granted_at       timestamptz not null default now(),
  revoked_at       timestamptz,
  constraint personal_data_consents_scope_check
    check (scope in ('profile_public', 'publication')),
  constraint personal_data_consents_document_version_check
    check (document_version <> ''),
  constraint personal_data_consents_data_categories_check
    check (cardinality(data_categories) > 0)
);

create index if not exists personal_data_consents_user_scope_idx
  on private.personal_data_consents (user_id, scope);

-- Defense in depth: private table has no direct client or service-role grants.
alter table private.personal_data_consents enable row level security;

revoke all on table private.personal_data_consents
  from public, anon, authenticated, service_role;

-- Record one explicit grant. The row is a grant event; subsequent grants create
-- new rows so the document version and data categories remain auditable.
create or replace function public.record_distribution_consent(
  p_user_id uuid,
  p_scope text,
  p_data_categories text[],
  p_document_version text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_consent_id uuid;
begin
  insert into private.personal_data_consents (
    user_id,
    scope,
    document_version,
    data_categories
  )
  values (
    p_user_id,
    p_scope,
    p_document_version,
    p_data_categories
  )
  returning id into v_consent_id;

  return v_consent_id;
end;
$function$;

-- Revoke every currently active grant for the requested user/scope.
-- Repeated calls are safe and do not alter the original revoked_at timestamp.
create or replace function public.revoke_distribution_consent(
  p_user_id uuid,
  p_scope text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_scope is null or p_scope not in ('profile_public', 'publication') then
    raise exception 'Unsupported distribution consent scope'
      using errcode = '22023';
  end if;

  update private.personal_data_consents
     set revoked_at = pg_catalog.now()
   where user_id = p_user_id
     and scope = p_scope
     and revoked_at is null;
end;
$function$;

comment on table private.personal_data_consents is
  'History of separate grants and revocations for public profile fields and user publications.';

comment on function public.record_distribution_consent(uuid, text, text[], text) is
  'Records one explicit distribution-consent grant. EXECUTE is restricted to service_role.';

comment on function public.revoke_distribution_consent(uuid, text) is
  'Revokes active distribution-consent grants for one user and scope. EXECUTE is restricted to service_role.';

-- PostgreSQL grants EXECUTE to PUBLIC by default. Revoke explicitly from
-- PUBLIC and the two client roles, then allow only the trusted server role.
revoke all on function public.record_distribution_consent(uuid, text, text[], text)
  from public, anon, authenticated;
revoke all on function public.revoke_distribution_consent(uuid, text)
  from public, anon, authenticated;

grant execute on function public.record_distribution_consent(uuid, text, text[], text)
  to service_role;
grant execute on function public.revoke_distribution_consent(uuid, text)
  to service_role;

commit;
