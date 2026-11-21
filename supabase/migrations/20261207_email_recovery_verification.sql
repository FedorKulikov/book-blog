-- Verified email recovery, separate from Supabase email_confirmed_at.
--
-- Existing project accounts were created while Confirm Email was disabled.
-- Their email_confirmed_at values therefore do not prove mailbox ownership.
-- This migration stores only keyed hashes and one-time token hashes in the
-- private schema. Only service_role can reach the tables and RPCs.

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

revoke all on table private.email_recovery_addresses
  from public, anon, authenticated;
revoke all on table private.email_recovery_tokens
  from public, anon, authenticated;
grant select, insert, update, delete on table
  private.email_recovery_addresses, private.email_recovery_tokens
  to service_role;

alter table private.email_recovery_addresses enable row level security;
alter table private.email_recovery_tokens enable row level security;

drop policy if exists email_recovery_addresses_service_role_only
  on private.email_recovery_addresses;
create policy email_recovery_addresses_service_role_only
  on private.email_recovery_addresses
  for all to service_role
  using (true)
  with check (true);

drop policy if exists email_recovery_tokens_service_role_only
  on private.email_recovery_tokens;
create policy email_recovery_tokens_service_role_only
  on private.email_recovery_tokens
  for all to service_role
  using (true)
  with check (true);

-- Issue/replace one pending verification link per user. A new request is
-- rate-limited to one per minute, including concurrent requests.
create or replace function public.issue_email_recovery_token(
  p_user_id uuid,
  p_email_hash text,
  p_token_hash text,
  p_expires_at timestamptz
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_issued boolean;
begin
  if p_user_id is null
     or p_email_hash !~ '^[0-9a-f]{64}$'
     or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_expires_at <= now()
     or p_expires_at > now() + interval '30 minutes' then
    return false;
  end if;

  insert into private.email_recovery_tokens (
    user_id, email_hash, token_hash, created_at, expires_at, consumed_at
  )
  values (
    p_user_id, p_email_hash, p_token_hash, now(), p_expires_at, null
  )
  on conflict (user_id) do update
    set email_hash = excluded.email_hash,
        token_hash = excluded.token_hash,
        created_at = now(),
        expires_at = excluded.expires_at,
        consumed_at = null
    where private.email_recovery_tokens.created_at <= now() - interval '1 minute'
       or private.email_recovery_tokens.expires_at <= now()
       or private.email_recovery_tokens.consumed_at is not null
  returning true into v_issued;

  return coalesce(v_issued, false);
end;
$$;

-- Consume once and bind the verified state to the exact email address that
-- was current when the user requested the link.
create or replace function public.consume_email_recovery_token(
  p_token_hash text
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_email_hash text;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' then
    return false;
  end if;

  update private.email_recovery_tokens
     set consumed_at = now()
   where token_hash = p_token_hash
     and consumed_at is null
     and expires_at > now()
  returning user_id, email_hash
       into v_user_id, v_email_hash;

  if v_user_id is null then
    return false;
  end if;

  insert into private.email_recovery_addresses (
    user_id, email_hash, verified_at, updated_at
  )
  values (v_user_id, v_email_hash, now(), now())
  on conflict (user_id) do update
    set email_hash = excluded.email_hash,
        verified_at = now(),
        updated_at = now();

  return true;
end;
$$;

-- Called only by the signed Auth Email Hook. Supabase's own
-- email_confirmed_at flag is deliberately not consulted.
create or replace function public.email_recovery_is_verified(
  p_user_id uuid,
  p_email_hash text
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
      from private.email_recovery_addresses a
     where a.user_id = p_user_id
       and a.email_hash = p_email_hash
  );
$$;

revoke all on function public.issue_email_recovery_token(uuid, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.consume_email_recovery_token(text)
  from public, anon, authenticated;
revoke all on function public.email_recovery_is_verified(uuid, text)
  from public, anon, authenticated;

grant execute on function public.issue_email_recovery_token(uuid, text, text, timestamptz)
  to service_role;
grant execute on function public.consume_email_recovery_token(text)
  to service_role;
grant execute on function public.email_recovery_is_verified(uuid, text)
  to service_role;

comment on table private.email_recovery_addresses is
  'Mailbox ownership explicitly verified by a signed one-time email link; stores keyed email hash only.';
comment on table private.email_recovery_tokens is
  'Single-use, short-lived email verification tokens; stores keyed token and email hashes only.';
