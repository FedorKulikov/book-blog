-- Run after 20261209_account_deletion_chat_anonymization.sql on disposable Supabase.

do $assert$
declare
  v_function oid := 'public.anonymize_profile_before_delete()'::regprocedure;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and (
        (table_name = 'conversations' and column_name in ('user1_id', 'user2_id'))
        or (table_name = 'messages' and column_name in ('sender_id', 'sender_label'))
      )
      and is_nullable <> 'YES'
  ) then
    raise exception 'conversation participants, sender_id and sender_label must allow NULL';
  end if;

  if (
    select count(*)
    from pg_constraint
    where conrelid in ('public.conversations'::regclass, 'public.messages'::regclass)
      and conname in (
        'conversations_user1_id_fkey',
        'conversations_user2_id_fkey',
        'messages_sender_id_fkey'
      )
      and contype = 'f'
      and confdeltype = 'n'
  ) <> 3 then
    raise exception 'all three profile references must use ON DELETE SET NULL';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname = 'profiles_anonymize_before_delete'
      and not tgisinternal
      and tgenabled <> 'D'
  ) then
    raise exception 'profiles BEFORE DELETE trigger is missing or disabled';
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_roles r on r.oid = p.proowner
    where p.oid = v_function
      and p.prosecdef
      and r.rolname = 'postgres'
      and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=""%'
  ) then
    raise exception 'trigger function must be SECURITY DEFINER, postgres-owned, and use an empty search_path';
  end if;

  if has_function_privilege('anon', v_function, 'EXECUTE')
     or has_function_privilege('authenticated', v_function, 'EXECUTE')
     or has_function_privilege('service_role', v_function, 'EXECUTE') then
    raise exception 'trigger function must not be callable through the Data API';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'chat_media_select_conversation_participants'
      and cmd = 'SELECT'
      and qual ilike '%messages%'
      and qual ilike '%conversations%'
      and qual ilike '%user1_id%'
      and qual ilike '%user2_id%'
  ) then
    raise exception 'chat media policy must authorize by message/conversation participation';
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'messages'
      and policyname = 'messages_insert_own'
      and cmd = 'INSERT'
      and with_check ilike '%sender_id%'
      and with_check ilike '%user1_id%'
      and with_check ilike '%user2_id%'
      and with_check ilike '%IS NOT NULL%'
  ) then
    raise exception 'message insertion must require two live conversation participants';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'messages'
      and cmd = 'INSERT'
      and policyname <> 'messages_insert_own'
  ) then
    raise exception 'an additional permissive INSERT policy can bypass the deleted-participant guard';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname <> 'chat_media_select_conversation_participants'
      and cmd = 'SELECT'
      and qual ilike '%chat-media%'
      and (qual ilike '%foldername%' or qual ilike '%sender_id%')
  ) then
    raise exception 'legacy sender-folder chat media SELECT policy remains';
  end if;

  if to_regclass('private.account_deletion_locks') is null then
    raise exception 'private account deletion lock table is missing';
  end if;

  if has_table_privilege('authenticated', 'private.account_deletion_locks', 'SELECT')
     or has_table_privilege('authenticated', 'private.account_deletion_locks', 'INSERT')
     or has_table_privilege('anon', 'private.account_deletion_locks', 'SELECT') then
    raise exception 'account deletion lock table must not be accessible to API roles';
  end if;

  if has_function_privilege('authenticated', 'public.begin_account_deletion(uuid, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.end_account_deletion(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.begin_account_deletion(uuid, text)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.end_account_deletion(uuid)', 'EXECUTE') then
    raise exception 'deletion lock RPC functions must only be executable by service_role';
  end if;

  if (
    select count(*)
    from pg_trigger
    where not tgisinternal
      and tgenabled <> 'D'
      and tgname in (
        'posts_block_deleting_user_writes',
        'comments_block_deleting_user_writes',
        'tickets_block_deleting_user_writes',
        'ticket_messages_block_deleting_user_writes',
        'reports_block_deleting_user_writes',
        'action_log_block_deleting_user_writes',
        'messages_block_deleting_user_writes',
        'post_images_block_deleting_user_references',
        'external_news_block_deleting_user_references'
      )
  ) <> 9 then
    raise exception 'all retention-sensitive write-lock triggers must be enabled';
  end if;
end;
$assert$;
