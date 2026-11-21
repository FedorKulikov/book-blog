-- Runs only against an ephemeral PostgreSQL instance in GitHub Actions.
-- The fixture deliberately models the three Supabase API roles and auth.users.

do $assert$
begin
  if has_schema_privilege('anon', 'private', 'USAGE') then
    raise exception 'anon unexpectedly has USAGE on private schema';
  end if;
  if has_schema_privilege('authenticated', 'private', 'USAGE') then
    raise exception 'authenticated unexpectedly has USAGE on private schema';
  end if;

  if has_table_privilege('anon', 'private.email_recovery_addresses', 'SELECT')
     or has_table_privilege('authenticated', 'private.email_recovery_addresses', 'SELECT') then
    raise exception 'application roles unexpectedly have access to private email table';
  end if;

  if has_function_privilege(
       'anon',
       'public.issue_email_recovery_token(uuid,text,text,timestamp with time zone)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'public.consume_email_recovery_token(text)',
       'EXECUTE'
     ) then
    raise exception 'application roles unexpectedly can execute private recovery RPCs';
  end if;

  if not has_table_privilege('service_role', 'private.email_recovery_addresses', 'INSERT')
     or not has_table_privilege('service_role', 'private.email_recovery_tokens', 'UPDATE')
     or not has_table_privilege('service_role', 'private.email_recovery_reset_attempts', 'DELETE') then
    raise exception 'service_role is missing required private table privileges';
  end if;
end;
$assert$;

insert into auth.users(id)
values ('11111111-1111-4111-8111-111111111111');

begin;
set local role service_role;

do $recovery$
declare
  v_user_id constant uuid := '11111111-1111-4111-8111-111111111111';
  v_email_hash constant text := repeat('a', 64);
  v_token_hash constant text := repeat('b', 64);
  v_ip_hash constant text := repeat('e', 64);
  v_email text;
  i integer;
begin
  if not public.issue_email_recovery_token(
    v_user_id, v_email_hash, v_token_hash, now() + interval '20 minutes'
  ) then
    raise exception 'could not issue valid email verification token';
  end if;

  if public.email_recovery_email_hash_verified(v_email_hash) then
    raise exception 'mailbox was marked verified before the owner consumed the token';
  end if;

  if not public.consume_email_recovery_token(v_token_hash) then
    raise exception 'valid email verification token was not consumed';
  end if;

  if not public.email_recovery_is_verified(v_user_id, v_email_hash) then
    raise exception 'consumed token did not verify the exact user/email pair';
  end if;

  if not public.email_recovery_email_hash_verified(v_email_hash) then
    raise exception 'email hash preflight did not find the confirmed address';
  end if;

  if public.email_recovery_is_verified(v_user_id, repeat('c', 64)) then
    raise exception 'email verification matched a different email hash';
  end if;

  if public.consume_email_recovery_token(v_token_hash) then
    raise exception 'email verification token was reusable';
  end if;

  if not public.issue_email_recovery_token(
    v_user_id, v_email_hash, repeat('d', 64), now() + interval '20 minutes'
  ) then
    raise exception 'consumed verification token could not be replaced';
  end if;

  if not public.allow_email_recovery_reset(repeat('1', 64), v_ip_hash) then
    raise exception 'first reset request should be allowed';
  end if;

  if public.allow_email_recovery_reset(repeat('1', 64), v_ip_hash) then
    raise exception 'same email reset request was not rate-limited';
  end if;

  if not public.allow_email_recovery_reset(repeat('2', 64), v_ip_hash) then
    raise exception 'second distinct email request from same IP should be allowed';
  end if;

  for i in 3..20 loop
    v_email := lpad(to_hex(i), 64, '0');
    if not public.allow_email_recovery_reset(v_email, v_ip_hash) then
      raise exception 'IP limit blocked request % before the twentieth attempt', i;
    end if;
  end loop;

  if public.allow_email_recovery_reset(repeat('f', 64), v_ip_hash) then
    raise exception 'IP limit did not block the twenty-first attempt';
  end if;
end;
$recovery$;

rollback;
