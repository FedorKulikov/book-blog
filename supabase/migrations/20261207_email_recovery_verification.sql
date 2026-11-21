-- Verified email recovery, separate from Supabase email_confirmed_at.
--
-- Existing project accounts were created while Confirm Email was disabled.
-- Their email_confirmed_at values therefore do not prove mailbox ownership.
-- The private tables store keyed hashes only; no raw email or IP is stored.

create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table if not exists private.email_recovery_addresses (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email_hash text not null,
  verified_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists private.email_recovery_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  token_hash text not null unique,
  email_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index if not exists email_recovery_tokens_expiry_idx
  on private.email_recovery_tokens (expires_at);

create table if not exists private.email_recovery_reset_attempts (
  id uuid primary key default gen_random_uuid(),
  email_hash text not null,
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists email_recovery_reset_email_created_idx
  on private.email_recovery_reset_attempts (email_hash, created_at desc);
create index if not exists email_recovery_reset_ip_created_idx
  on private.email_recovery_reset_attempts (ip_hash, created_at desc);

revoke all on table private.email_recovery_addresses,
  private.email_recovery_tokens,
  private.email_recovery_reset_attempts
  from public, anon, authenticated;

grant select, insert, update, delete on table
  private.email_recovery_addresses, private.email_recovery_tokens
  to service_role;
grant select, insert, delete on table
  private.email_recovery_reset_attempts
  to service_role;

alter table private.email_recovery_addresses enable row level security;
alter table private.email_recovery_tokens enable row level security;
alter table private.email_recovery_reset_attempts enable row level security;

drop policy if exists email_recovery_addresses_service_role_only
  on private.email_recovery_addresses;
create policy email_recovery_addresses_service_role_only
  on private.email_recovery_addresses
  for all to service_role using (true) with check (true);

drop policy if exists email_recovery_tokens_service_role_only
  on private.email_recovery_tokens;
create policy email_recovery_tokens_service_role_only
  on private.email_recovery_tokens
  for all to service_role using (true) with check (true);

drop policy if exists email_recovery_reset_attempts_service_role_only
  on private.email_recovery_reset_attempts;
create policy email_recovery_reset_attempts_service_role_only
  on private.email_recovery_reset_attempts
  for all to service_role using (true) with check (true);

create or replace function public.issue_email_recovery_token(p_user_id uuid, p_email_hash text, p_token_hash text, p_expires_at timestamptz)
returns boolean
language sql
set search_path = ''
as 'with issued as (
  insert into private.email_recovery_tokens (
    user_id, email_hash, token_hash, created_at, expires_at, consumed_at
  )
  select p_user_id, p_email_hash, p_token_hash, now(), p_expires_at, null
   where p_user_id is not null
     and length(coalesce(p_email_hash, '''')) = 64
     and translate(coalesce(p_email_hash, ''''), ''0123456789abcdef'', '''') = ''''
     and length(coalesce(p_token_hash, '''')) = 64
     and translate(coalesce(p_token_hash, ''''), ''0123456789abcdef'', '''') = ''''
     and p_expires_at is not null
     and p_expires_at > now()
     and p_expires_at <= now() + interval ''30 minutes''
  on conflict (user_id) do update
     set email_hash = excluded.email_hash,
         token_hash = excluded.token_hash,
         created_at = now(),
         expires_at = excluded.expires_at,
         consumed_at = null
   where private.email_recovery_tokens.created_at <= now() - interval ''1 minute''
      or private.email_recovery_tokens.expires_at <= now()
      or private.email_recovery_tokens.consumed_at is not null
  returning user_id
)
select exists (select 1 from issued)';

create or replace function public.consume_email_recovery_token(p_token_hash text)
returns boolean
language sql
set search_path = ''
as 'with consumed as (
  update private.email_recovery_tokens
     set consumed_at = now()
   where token_hash = p_token_hash
     and consumed_at is null
     and expires_at > now()
     and length(coalesce(p_token_hash, '''')) = 64
     and translate(coalesce(p_token_hash, ''''), ''0123456789abcdef'', '''') = ''''
  returning user_id, email_hash
), saved as (
  insert into private.email_recovery_addresses (user_id, email_hash, verified_at, updated_at)
  select user_id, email_hash, now(), now()
    from consumed
  on conflict (user_id) do update
     set email_hash = excluded.email_hash,
         verified_at = now(),
         updated_at = now()
  returning user_id
)
select exists (select 1 from saved)';

create or replace function public.email_recovery_is_verified(p_user_id uuid, p_email_hash text)
returns boolean
language sql
set search_path = ''
as 'select exists (
  select 1
    from private.email_recovery_addresses a
   where a.user_id = p_user_id
     and a.email_hash = p_email_hash
)';

create or replace function public.allow_email_recovery_reset(p_email_hash text, p_ip_hash text)
returns boolean
language sql
set search_path = ''
as 'with lock_email as materialized (
  select pg_advisory_xact_lock(hashtextextended(p_email_hash, 0)) as locked
), lock_ip as materialized (
  select pg_advisory_xact_lock(hashtextextended(p_ip_hash, 0)) as locked
    from lock_email
), stats as materialized (
  select
    (count(*) filter (where created_at > now() - interval ''1 minute''))::integer as email_last_minute,
    (count(*))::integer as email_last_hour,
    (select count(*)::integer
       from private.email_recovery_reset_attempts ip_attempts
      where ip_attempts.ip_hash = p_ip_hash
        and ip_attempts.created_at > now() - interval ''1 hour'') as ip_last_hour
    from private.email_recovery_reset_attempts
    cross join lock_ip
   where email_hash = p_email_hash
     and created_at > now() - interval ''1 hour''
), inserted as materialized (
  insert into private.email_recovery_reset_attempts (email_hash, ip_hash)
  select p_email_hash, p_ip_hash from stats
  returning id
), cleanup as (
  delete from private.email_recovery_reset_attempts
   where created_at < now() - interval ''7 days''
  returning id
)
select
  coalesce(stats.email_last_minute, 0) < 1
  and coalesce(stats.email_last_hour, 0) < 3
  and coalesce(stats.ip_last_hour, 0) < 20
  and exists (select 1 from inserted)
  and (select count(*) from cleanup) >= 0
from stats';

revoke all on function public.issue_email_recovery_token(uuid, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.consume_email_recovery_token(text)
  from public, anon, authenticated;
revoke all on function public.email_recovery_is_verified(uuid, text)
  from public, anon, authenticated;
revoke all on function public.allow_email_recovery_reset(text, text)
  from public, anon, authenticated;

grant execute on function public.issue_email_recovery_token(uuid, text, text, timestamptz)
  to service_role;
grant execute on function public.consume_email_recovery_token(text)
  to service_role;
grant execute on function public.email_recovery_is_verified(uuid, text)
  to service_role;
grant execute on function public.allow_email_recovery_reset(text, text)
  to service_role;

comment on table private.email_recovery_addresses is
  'Mailbox ownership explicitly verified by a single-use link; stores keyed email hash only.';
comment on table private.email_recovery_tokens is
  'Single-use, short-lived email verification tokens; stores keyed token and email hashes only.';
comment on table private.email_recovery_reset_attempts is
  'Rate-limit state for email recovery; stores keyed email/IP hashes only.';
